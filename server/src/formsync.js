const XLSX = require('xlsx');
const { query } = require('./db');

// Microsoft Forms score synchronisation.
//
// Forms has no public API for responses, but every Form keeps its responses
// in an Excel workbook on the owner's OneDrive/SharePoint ("Open results in
// Excel"). The admin pastes that workbook's share link on the assessment;
// we download the file through Microsoft Graph with the SAME certificate
// credentials the mailer uses (extra permission needed: Files.Read.All,
// application, admin-consented) and read the quiz's "Total points" column.
//
// Matching: the Form must collect sign-in (an "Email"/"Name" column in the
// export) — rows are matched to employees by e-mail first, then by name.
// Manual entries always win: sync never overwrites a score whose source is
// 'manual'.

async function graphCreds() {
  const mailer = require('./mailer');
  const c = await mailer.cfg(true); // creds may exist even if mail is off
  if (!c || (c.method || 'smtp') !== 'graph') return null;
  return { c, token: () => mailer.graphToken(c) };
}

// Share URL -> Graph share id (u! + base64url of the URL).
const shareId = (url) =>
  'u!' + Buffer.from(String(url).trim()).toString('base64')
    .replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');

// A Forms link is the FORM, not its response workbook — the most common
// paste mistake. Caught at save time and again before every download.
const isFormsUrl = (u) => /\/\/(forms\.office\.com|forms\.cloud\.microsoft|forms\.microsoft\.com|forms\.office\.net)/i.test(String(u || ''));
const FORMS_LINK_MSG = 'That is the Form\'s own link, not the response workbook. Open the Form → Responses → "Open results in Excel"; the workbook opens in Excel Online — there choose Share → Copy link (it looks like https://…sharepoint.com/:x:/…) and paste THAT.';
function assertWorkbookUrl(u) {
  if (u && isFormsUrl(u)) throw Object.assign(new Error(FORMS_LINK_MSG), { status: 400 });
  return u;
}

async function downloadWorkbook(workbookUrl) {
  if (isFormsUrl(workbookUrl)) throw new Error(FORMS_LINK_MSG);
  const g = await graphCreds();
  if (!g) throw new Error('Microsoft Graph is not configured (Settings → E-mail notifications)');
  const tok = await g.token();
  const r = await fetch(
    `https://graph.microsoft.com/v1.0/shares/${shareId(workbookUrl)}/driveItem/content`,
    { headers: { Authorization: 'Bearer ' + tok } });
  if (!r.ok) {
    const txt = (await r.text()).slice(0, 200);
    if (r.status === 403 || r.status === 401) throw new Error('Microsoft refused this link (403). Make sure it is the WORKBOOK\'s share link from Excel Online (Share → Copy link, looks like https://…sharepoint.com/:x:/…), not the Form link; if the link is right, ask IT to confirm the app\'s Files.Read.All admin consent.');
    if (r.status === 404 || r.status === 400) throw new Error('The workbook link could not be opened — paste the share link of the Form\'s "Open results in Excel" file. ' + txt);
    throw new Error(`Graph workbook download failed (${r.status}): ${txt}`);
  }
  return Buffer.from(await r.arrayBuffer());
}

// Parse the Forms export: find Email / Name / Total points / Completion time
// columns and return one row per respondent.
function parseResponses(buf) {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error('The workbook has no sheets');
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  if (!aoa.length) throw new Error('The workbook is empty');
  const headers = (aoa[0] || []).map((h) => String(h).trim().toLowerCase());
  const col = (re) => headers.findIndex((h) => re.test(h));
  const emailC = col(/^e-?mail/);
  const nameC = col(/^name$/) >= 0 ? col(/^name$/) : col(/name/);
  const pointsC = col(/^total points|^points$|^score$|^total score|^marks?$/);
  const timeC = col(/^completion time|^submit/);
  if (pointsC < 0) throw new Error('No "Total points" column found — the Form must be a quiz (Forms adds that column to quiz exports).');
  if (emailC < 0 && nameC < 0) throw new Error('No "Email" or "Name" column found — set the Form to "Only people in my organization can respond" so sign-in is recorded.');
  return aoa.slice(1)
    .filter((r) => String(r[pointsC] ?? '').toString().trim() !== '')
    .map((r) => ({
      email: emailC >= 0 ? String(r[emailC] || '').trim().toLowerCase() : '',
      name: nameC >= 0 ? String(r[nameC] || '').trim().toLowerCase() : '',
      score: Number(r[pointsC]),
      submitted_at: timeC >= 0 && r[timeC] ? new Date(r[timeC]) : null,
    }))
    .filter((r) => Number.isFinite(r.score));
}

// people: [{id, name, email, zoho_emp_id}] — the eligible set (training
// participants / batch members). Returns {matched:[...], unmatched:n}.
function matchPeople(resp, people) {
  const byEmail = {}; const byName = {};
  for (const p of people) {
    if (p.email) byEmail[String(p.email).toLowerCase()] = p;
    byName[String(p.name).trim().toLowerCase()] = p;
  }
  const out = {}; let unmatched = 0;
  for (const r of resp) {
    const p = (r.email && byEmail[r.email]) || (r.name && byName[r.name]);
    if (!p) { unmatched++; continue; }
    out[p.id] = { employee_id: p.id, score: r.score, submitted_at: r.submitted_at }; // last row wins
  }
  return { matched: Object.values(out), unmatched };
}

const clamp = (v, max) => Math.max(0, Math.min(Number(v), Number(max)));

// ---- per-table sync ------------------------------------------------------

async function syncTrainingAssessment(a) {
  const { rows: people } = await query(
    `SELECT e.id, e.name, e.email, e.zoho_emp_id FROM training_participants p
     JOIN employees e ON e.id = p.employee_id WHERE p.training_id=$1`, [a.training_id]);
  const { matched, unmatched } = matchPeople(parseResponses(await downloadWorkbook(a.workbook_url)), people);
  for (const m of matched) {
    await query(
      `INSERT INTO assessment_scores (assessment_id, employee_id, score, source, submitted_at)
       VALUES ($1,$2,$3,'forms_sync',$4)
       ON CONFLICT (assessment_id, employee_id) DO UPDATE
         SET score=$3, submitted_at=$4, updated_at=now(), source='forms_sync'
         WHERE assessment_scores.source <> 'manual'`,
      [a.id, m.employee_id, clamp(m.score, a.max_marks), m.submitted_at]);
  }
  await query('UPDATE assessments SET last_synced=now(), sync_error=NULL WHERE id=$1', [a.id]);
  return { matched: matched.length, unmatched };
}

async function syncMavAssessment(a) {
  const { rows: people } = await query(
    `SELECT e.id, e.name, e.email, e.zoho_emp_id FROM mav_members m
     JOIN employees e ON e.id = m.employee_id WHERE m.batch_id=$1`, [a.batch_id]);
  const { matched, unmatched } = matchPeople(parseResponses(await downloadWorkbook(a.workbook_url)), people);
  for (const m of matched) {
    await query(
      `INSERT INTO mav_scores (assessment_id, employee_id, score, source, submitted_at)
       VALUES ($1,$2,$3,'forms_sync',$4)
       ON CONFLICT (assessment_id, employee_id) DO UPDATE
         SET score=$3, submitted_at=$4, source='forms_sync'
         WHERE mav_scores.source <> 'manual'`,
      [a.id, m.employee_id, clamp(m.score, a.max_marks), m.submitted_at]);
  }
  await query('UPDATE mav_assessments SET last_synced=now(), sync_error=NULL WHERE id=$1', [a.id]);
  return { matched: matched.length, unmatched };
}

// ---- feedback sync -------------------------------------------------------
//
// A feedback Form isn't a quiz: every non-meta column IS a question. The
// sheet's question columns become (or confirm) the training's stored
// questions, and each matched respondent's answers upsert into
// feedback_responses — exactly like a manual Import, but automatic.

const FB_META = /^(id|start ?time|completion ?time|last modified|e-?mail|name|employee|emp ?id|zoho|timestamp|total points|quiz feedback|points|grade|language)/i;

async function syncFeedback(t) {
  const buf = await downloadWorkbook(t.fb_workbook_url);
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error('The workbook has no sheets');
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  if (!aoa.length) throw new Error('The workbook is empty');
  const headers = (aoa[0] || []).map((h) => String(h).trim());
  const low = headers.map((h) => h.toLowerCase());
  const emailC = low.findIndex((h) => /^e-?mail/.test(h));
  const nameC = low.findIndex((h) => h === 'name');
  const timeC = low.findIndex((h) => /^completion time|^submit/.test(h));
  if (emailC < 0 && nameC < 0) throw new Error('No "Email" or "Name" column — set the Form to "Only people in my organization can respond" so sign-in is recorded.');
  const rows = aoa.slice(1).filter((r) => r.some((c) => String(c).trim() !== ''));

  // Question columns + their kind (rating when most answers are 1–5).
  const qcols = headers.map((h, i) => i)
    .filter((i) => headers[i] && !FB_META.test(headers[i]) && i !== emailC && i !== nameC)
    .slice(0, 50);
  if (!qcols.length) throw new Error('No question columns found in the workbook');
  const kinds = qcols.map((c) => {
    const vals = rows.map((r) => String(r[c] ?? '').trim()).filter(Boolean);
    if (!vals.length) return 'rating';
    const ok = vals.filter((v) => Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 5).length;
    return ok / vals.length >= 0.5 ? 'rating' : 'text';
  });
  const questions = qcols.map((c, i) => {
    const h = headers[c].slice(0, 300);
    return kinds[i] === 'rating' ? h : { q: h, type: 'text' };
  });

  // The Form is the source of truth: its columns become the stored form
  // (skipped when nothing changed, so manual tweaks aren't churned).
  const qText = (q) => (typeof q === 'string' ? q : (q && q.q) || '');
  const stored = Array.isArray(t.feedback_questions) ? t.feedback_questions : [];
  if (JSON.stringify(stored.map(qText)) !== JSON.stringify(questions.map(qText))) {
    await query('UPDATE trainings SET feedback_questions=$2, updated_at=now() WHERE id=$1',
      [t.id, JSON.stringify(questions)]);
  }

  const { rows: people } = await query(
    `SELECT e.id, e.name, e.email, e.zoho_emp_id FROM training_participants p
     JOIN employees e ON e.id = p.employee_id WHERE p.training_id=$1`, [t.id]);
  const byEmail = {}; const byName = {};
  for (const p of people) {
    if (p.email) byEmail[String(p.email).toLowerCase()] = p;
    byName[String(p.name).trim().toLowerCase()] = p;
  }

  let matched = 0, unmatched = 0;
  const seen = new Set();
  for (const r of rows) {
    const em = emailC >= 0 ? String(r[emailC] || '').trim().toLowerCase() : '';
    const nm = nameC >= 0 ? String(r[nameC] || '').trim().toLowerCase() : '';
    const p = (em && byEmail[em]) || (nm && byName[nm]);
    if (!p) { unmatched++; continue; }
    const scores = {};
    let any = false;
    qcols.forEach((c, i) => {
      const raw = String(r[c] ?? '').trim();
      if (!raw) return;
      const v = Number(raw);
      if (kinds[i] === 'rating' && Number.isInteger(v) && v >= 1 && v <= 5) scores[i] = v;
      else scores[i] = raw.slice(0, 1000);
      any = true;
    });
    if (!any) continue;
    const at = timeC >= 0 && r[timeC] ? new Date(r[timeC]) : null;
    await query(
      `INSERT INTO feedback_responses (training_id, employee_id, respondent, scores, created_at)
       VALUES ($1,$2,$3,$4, coalesce($5, now()))
       ON CONFLICT (training_id, employee_id) WHERE employee_id IS NOT NULL
       DO UPDATE SET scores=$4, created_at=coalesce($5, feedback_responses.created_at)`,
      [t.id, p.id, p.name, JSON.stringify(scores), at && !isNaN(at) ? at : null]);
    seen.add(p.id);
    matched++;
  }
  await query('UPDATE trainings SET fb_last_synced=now(), fb_sync_error=NULL WHERE id=$1', [t.id]);
  return { matched: seen.size, rows: matched, unmatched };
}

async function markError(table, id, msg) {
  try { await query(`UPDATE ${table} SET sync_error=$2, last_synced=now() WHERE id=$1`, [id, String(msg).slice(0, 400)]); }
  catch (e) { console.error('[formsync]', e.message); }
}

// Hourly background pass over every assessment that has a workbook linked.
async function runFormsSync() {
  try {
    if (!(await graphCreds())) return;
    const { rows: ta } = await query(`SELECT * FROM assessments WHERE workbook_url IS NOT NULL`);
    for (const a of ta) {
      try { await syncTrainingAssessment(a); }
      catch (e) { await markError('assessments', a.id, e.message); }
    }
    const { rows: ma } = await query(`SELECT * FROM mav_assessments WHERE workbook_url IS NOT NULL`);
    for (const a of ma) {
      try { await syncMavAssessment(a); }
      catch (e) { await markError('mav_assessments', a.id, e.message); }
    }
    const { rows: fb } = await query(
      `SELECT id, feedback_questions, fb_workbook_url FROM trainings
       WHERE fb_workbook_url IS NOT NULL AND status <> 'cancelled'`);
    for (const t of fb) {
      try { await syncFeedback(t); }
      catch (e) {
        try { await query('UPDATE trainings SET fb_sync_error=$2, fb_last_synced=now() WHERE id=$1', [t.id, String(e.message).slice(0, 400)]); }
        catch (e2) { console.error('[formsync]', e2.message); }
      }
    }
  } catch (e) { console.error('[formsync]', e.message); }
}

module.exports = { syncTrainingAssessment, syncMavAssessment, syncFeedback, runFormsSync, assertWorkbookUrl };
