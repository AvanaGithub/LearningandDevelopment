const express = require('express');
const { query } = require('../db');
const { audit } = require('../auth');
const mailer = require('../mailer');

// The learner portal: a signed-in employee sees ONLY their own world —
// their trainings, their attendance, their feedback, and trainings open
// for self-nomination. Identity = users.email matched to employees.email.
const router = express.Router();

const DEFAULT_QUESTIONS = [
  'Relevance of content to my job', "Trainer's subject knowledge",
  "Trainer's delivery and clarity", 'Confidence to apply this at work', 'Overall rating',
];

const localDay = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const inScope = (listStr, val) => {
  if (!listStr) return true;
  const list = listStr.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.includes(String(val || '').trim().toLowerCase());
};

async function myEmployee(req) {
  const { rows } = await query(
    'SELECT * FROM employees WHERE email=$1 AND active=TRUE', [String(req.user.email).toLowerCase()]);
  return rows[0] || null;
}

router.get('/overview', async (req, res, next) => {
  try {
    const me = await myEmployee(req);
    if (!me) {
      return res.json({ employee: null, my: [], open: [], upcoming: [] });
    }
    const today = localDay();
    const { rows: my } = await query(
      `SELECT t.id, t.code, t.title, t.batch, t.status, t.mode, t.trainer_type, t.trainer_name, t.agency,
              t.feedback_questions, t.external_form_url, t.agenda_file,
              (SELECT json_agg(d.day ORDER BY d.day) FROM training_days d WHERE d.training_id=t.id) AS days,
              n.slot AS nom_slot, n.source AS nom_source,
              (SELECT json_agg(json_build_object('day', a.day, 'mark', a.mark))
                 FROM attendance a WHERE a.training_id=t.id AND a.employee_id=$1) AS my_attendance,
              EXISTS (SELECT 1 FROM feedback_responses f WHERE f.training_id=t.id AND f.employee_id=$1) AS feedback_given
       FROM training_participants p
       JOIN trainings t ON t.id = p.training_id
       LEFT JOIN nominations n ON n.training_id=t.id AND n.employee_id=$1 AND n.status='confirmed'
       WHERE p.employee_id=$1 AND t.status <> 'cancelled'
       ORDER BY (SELECT min(d.day) FROM training_days d WHERE d.training_id=t.id) DESC NULLS LAST`, [me.id]);
    const { rows: openRows } = await query(
      `SELECT t.id, t.code, t.title, t.batch, t.department, t.division, t.nom_deadline, t.mode,
              (SELECT json_agg(d.day ORDER BY d.day) FROM training_days d WHERE d.training_id=t.id) AS days
       FROM trainings t
       WHERE t.nom_self AND t.status IN ('planned','confirmed','in_progress')
         AND (t.nom_deadline IS NULL OR t.nom_deadline >= $2::date)
         AND NOT EXISTS (SELECT 1 FROM training_participants p WHERE p.training_id=t.id AND p.employee_id=$1)
       ORDER BY t.id DESC`, [me.id, today]);
    const open = openRows.filter((t) => inScope(t.department, me.department) && inScope(t.division, me.division));
    const { rows: upcoming } = await query(
      `SELECT t.id, t.title, t.batch, t.mode,
              (SELECT json_agg(d.day ORDER BY d.day) FROM training_days d WHERE d.training_id=t.id) AS days
       FROM trainings t
       WHERE t.status IN ('planned','confirmed','in_progress')
         AND EXISTS (SELECT 1 FROM training_days d WHERE d.training_id=t.id AND d.day >= $1::date)
       ORDER BY (SELECT min(d.day) FROM training_days d WHERE d.training_id=t.id) LIMIT 20`, [today]);
    res.json({
      employee: { id: me.id, name: me.name, department: me.department, division: me.division, entity: me.entity },
      today,
      my: my.map((t) => ({ ...t, questions: t.feedback_questions || DEFAULT_QUESTIONS, feedback_questions: undefined })),
      open, upcoming,
    });
  } catch (e) { next(e); }
});

// Self check-in from the portal — own record, today only, training days only.
router.post('/checkin', express.json(), async (req, res, next) => {
  try {
    const me = await myEmployee(req);
    if (!me) return res.status(403).json({ error: 'No employee record matches your e-mail — contact L&D.' });
    const trainingId = Number(req.body?.training_id);
    const { rows: ok } = await query(
      `SELECT 1 FROM training_participants p JOIN training_days d ON d.training_id = p.training_id
       WHERE p.training_id=$1 AND p.employee_id=$2 AND d.day = $3::date`, [trainingId, me.id, localDay()]);
    if (!ok.length) return res.status(400).json({ error: 'Today is not a day of this training, or you are not on it.' });
    await query(
      `INSERT INTO attendance (training_id, employee_id, day, mark)
       VALUES ($1,$2,$3,'P')
       ON CONFLICT (training_id, employee_id, day) DO UPDATE SET mark='P', updated_at=now()`,
      [trainingId, me.id, localDay()]);
    await audit(null, 'attendance.self_checkin', 'training', trainingId, { employee_id: me.id, day: localDay(), via: 'learner_portal' });
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});

// Feedback from the portal — one response per employee per training.
router.post('/feedback', express.json(), async (req, res, next) => {
  try {
    const me = await myEmployee(req);
    if (!me) return res.status(403).json({ error: 'No employee record matches your e-mail — contact L&D.' });
    const trainingId = Number(req.body?.training_id);
    const { rows: t } = await query(
      `SELECT feedback_questions FROM trainings t
       WHERE t.id=$1 AND EXISTS (SELECT 1 FROM training_participants p WHERE p.training_id=t.id AND p.employee_id=$2)`,
      [trainingId, me.id]);
    if (!t.length) return res.status(403).json({ error: 'You are not a participant of this training.' });
    const questions = t[0].feedback_questions || DEFAULT_QUESTIONS;
    const scores = req.body?.scores || {};
    const ok = questions.every((q, i) => {
      const v = Number(scores[i]);
      return Number.isInteger(v) && v >= 1 && v <= 5;
    });
    if (!ok) return res.status(400).json({ error: 'Answer every question with a rating from 1 to 5.' });
    await query(
      `INSERT INTO feedback_responses (training_id, employee_id, respondent, scores, comment)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (training_id, employee_id) WHERE employee_id IS NOT NULL
       DO UPDATE SET scores=$4, comment=$5, created_at=now()`,
      [trainingId, me.id, me.name, JSON.stringify(scores), req.body?.comment?.trim() || null]);
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});

// Self-nomination from the portal — same rules as the QR page.
router.post('/nominate', express.json(), async (req, res, next) => {
  try {
    const me = await myEmployee(req);
    if (!me) return res.status(403).json({ error: 'No employee record matches your e-mail — contact L&D.' });
    const trainingId = Number(req.body?.training_id);
    const { rows: tr } = await query('SELECT * FROM trainings WHERE id=$1 AND status <> \'cancelled\'', [trainingId]);
    if (!tr.length) return res.status(404).json({ error: 'Not found' });
    const t = tr[0];
    if (!t.nom_self || (t.nom_deadline && new Date(t.nom_deadline) < new Date(new Date().toDateString()))) {
      return res.status(403).json({ error: 'Self-nomination is not open for this training.' });
    }
    if (!inScope(t.department, me.department) || !inScope(t.division, me.division)) {
      return res.status(403).json({ error: 'This training targets other departments/divisions.' });
    }
    const slot = String(req.body?.slot || '').trim().slice(0, 80) || null;
    await query('INSERT INTO training_participants (training_id, employee_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [trainingId, me.id]);
    await query(
      `INSERT INTO nominations (training_id, employee_id, slot, source, nominated_by)
       VALUES ($1,$2,$3,'self',$4)
       ON CONFLICT (training_id, employee_id) DO UPDATE
         SET status='confirmed', slot=EXCLUDED.slot, source=EXCLUDED.source,
             nominated_by=EXCLUDED.nominated_by, created_at=now()
         WHERE nominations.status='cancelled'`,
      [trainingId, me.id, slot, me.name]);
    await audit(null, 'nomination.self', 'training', trainingId, { employee_id: me.id, slot, via: 'learner_portal' });
    mailer.notifyNomination({ trainingId, employeeIds: [me.id], source: 'self', byName: me.name, slot });
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
