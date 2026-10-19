const { query } = require('./db');

// Configurable post-training workflow.
//
// Per training the admin picks which steps are required: assessment,
// feedback, certificate. Once the training is COMPLETED, each participant
// is walked through their pending steps in order:
//   attended → assessment (if required) → feedback (if required)
//     → certificate (if required; auto-issued + e-mailed when cert_auto)
// A step's notification goes out exactly once (wf_notices), with a link to
// sign in to Avana Academy. Runs on completion and hourly, so a step
// finished today triggers the next step's nudge within the hour.

const SITE = require('./config').baseUrl || 'https://academy.avanasurgical.com';

// Per-participant workflow state for one training.
async function stateRows(tid) {
  const { rows } = await query(
    `SELECT e.id, e.name, e.email, e.zoho_emp_id,
            (SELECT count(*)::int FROM training_days d WHERE d.training_id=$1) AS day_count,
            (SELECT count(a.mark)::int FROM attendance a WHERE a.training_id=$1 AND a.employee_id=e.id) AS marked,
            coalesce((SELECT sum(CASE a.mark WHEN 'P' THEN 1 WHEN 'H' THEN 0.5 ELSE 0 END)
                      FROM attendance a WHERE a.training_id=$1 AND a.employee_id=e.id), 0)::float AS present_units,
            EXISTS (SELECT 1 FROM assessment_scores s JOIN assessments a2 ON a2.id=s.assessment_id
                    WHERE a2.training_id=$1 AND s.employee_id=e.id) AS assess_done,
            EXISTS (SELECT 1 FROM feedback_responses fr
                    WHERE fr.training_id=$1 AND fr.employee_id=e.id) AS fb_done,
            c.id AS cert_id, c.cert_no, c.file_id AS cert_file_id, c.emailed_at AS cert_emailed_at,
            (SELECT json_agg(n.step) FROM wf_notices n
             WHERE n.training_id=$1 AND n.employee_id=e.id) AS notices
     FROM training_participants p
     JOIN employees e ON e.id = p.employee_id
     LEFT JOIN certificates c ON c.training_id=$1 AND c.employee_id=e.id
     WHERE p.training_id=$1 ORDER BY e.name`, [tid]);
  const anyMarks = rows.some((r) => r.marked > 0);
  return rows.map((r) => ({
    ...r,
    att_pct: r.day_count && r.marked ? Math.round((r.present_units / r.day_count) * 100) : null,
    // No attendance marked at all on the training → don't block anyone.
    attended: anyMarks ? r.present_units > 0 : true,
    notices: r.notices || [],
  }));
}

async function noticeSent(tid, empId, step) {
  const { rows } = await query(
    `INSERT INTO wf_notices (training_id, employee_id, step) VALUES ($1,$2,$3)
     ON CONFLICT DO NOTHING RETURNING 1`, [tid, empId, step]);
  return rows.length > 0; // false = already sent earlier
}

async function stepMail(t, p, step) {
  const mailer = require('./mailer');
  const label = `${t.title}${t.batch ? ' — ' + t.batch : ''}`;
  const what = step === 'assessment'
    ? { subj: `Assessment pending — ${label}`,
        body: 'please complete your assessment for the training below', btnTxt: 'Complete the assessment' }
    : { subj: `Feedback pending — ${label}`,
        body: 'please share your feedback for the training below', btnTxt: 'Give feedback' };
  // Assessment: prefer the Microsoft Form link when one is set up.
  let link = SITE;
  if (step === 'assessment') {
    const { rows } = await query(
      `SELECT external_form_url FROM assessments
       WHERE training_id=$1 AND external_form_url IS NOT NULL ORDER BY id LIMIT 1`, [t.id]);
    if (rows.length) link = rows[0].external_form_url;
  }
  await mailer.sendRaw(p.email, what.subj,
    `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#2b2317">
       <p>Dear ${mailer.esc(p.name)},</p>
       <p>You attended <b>${mailer.esc(label)}</b> — ${what.body}.</p>
       <p><a href="${link}" style="display:inline-block;background:#C8930A;color:#fff;text-decoration:none;padding:9px 20px;border-radius:8px;font-weight:600">${what.btnTxt}</a></p>
       ${link === SITE ? '<p style="color:#8a7a5c;font-size:12px">Sign in to Avana Academy with your Zoho account — the pending step is on your portal.</p>' : ''}
       ${mailer.FOOT}</div>`);
}

// One pass over a single completed training.
async function kick(tid) {
  const { rows: tr } = await query(
    `SELECT t.*, (SELECT min(d.day) FROM training_days d WHERE d.training_id=t.id) AS first_day,
            (SELECT max(d.day) FROM training_days d WHERE d.training_id=t.id) AS last_day
     FROM trainings t WHERE t.id=$1`, [tid]);
  if (!tr.length) return;
  const t = tr[0];
  if (t.status !== 'completed') return;
  if (!t.req_assessment && !t.req_feedback && !t.req_certificate) return;

  // Feedback step implies the learner-portal feedback form must be open.
  if (t.req_feedback && !t.feedback_open) {
    await query('UPDATE trainings SET feedback_open=TRUE WHERE id=$1', [tid]);
  }

  const parts = await stateRows(tid);
  const certs = require('./routes/certs');
  let tpl = null;
  if (t.req_certificate && t.cert_auto && t.cert_template_id) {
    const { rows: tp } = await query('SELECT * FROM cert_templates WHERE id=$1', [t.cert_template_id]);
    tpl = tp[0] || null;
  }

  for (const p of parts) {
    try {
      if (!p.attended) continue;
      // A failed send releases the one-shot flag so the hourly pass retries.
      const notify = async (step) => {
        if (!p.email || !(await noticeSent(tid, p.id, step))) return;
        try { await stepMail(t, p, step); }
        catch (e) {
          console.error('[wf mail]', p.email, e.message);
          await query('DELETE FROM wf_notices WHERE training_id=$1 AND employee_id=$2 AND step=$3', [tid, p.id, step]);
        }
      };
      // Step: assessment.
      if (t.req_assessment && !p.assess_done) {
        await notify('assessment');
        continue; // next steps wait until the assessment is done
      }
      // Step: feedback.
      if (t.req_feedback && !p.fb_done) {
        await notify('feedback');
        continue;
      }
      // Step: certificate (auto mode only; manual stays on the Certificates tab).
      if (t.req_certificate && t.cert_auto && !p.cert_id) {
        const c = await certs.issueCertFor(t, p, tpl, null);
        if (p.email) await certs.emailCert(c.id).catch((e) => console.error('[wf cert mail]', p.email, e.message));
        console.log(`[workflow] auto-issued ${c.cert_no} for ${p.name}`);
      }
    } catch (e) { console.error('[workflow]', t.code, p.name, e.message); }
  }
}

// Hourly: every completed training that has any workflow step configured.
async function runWorkflow() {
  try {
    const { rows } = await query(
      `SELECT id FROM trainings
       WHERE status='completed' AND (req_assessment OR req_feedback OR req_certificate)
         AND updated_at > now() - interval '90 days'`);
    for (const r of rows) await kick(r.id).catch((e) => console.error('[workflow]', r.id, e.message));
  } catch (e) { console.error('[workflow]', e.message); }
}

module.exports = { kick, runWorkflow, stateRows };
