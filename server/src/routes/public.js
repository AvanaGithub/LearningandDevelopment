const express = require('express');
const { query } = require('../db');
const { audit } = require('../auth');

// QR participant pages — reachable WITHOUT a session. The training's
// unguessable public_token is the credential; these routes expose only
// what a venue check-in sheet would (title, days, participant names)
// and accept only self check-in marks and feedback responses.
const router = express.Router();

const DEFAULT_QUESTIONS = [
  'Relevance of content to my job', "Trainer's subject knowledge",
  "Trainer's delivery and clarity", 'Confidence to apply this at work', 'Overall rating',
];

async function byToken(token) {
  const { rows } = await query(
    `SELECT t.id, t.code, t.title, t.batch, t.status, t.feedback_questions,
       (SELECT json_agg(d.day ORDER BY d.day) FROM training_days d WHERE d.training_id=t.id) AS days,
       (SELECT json_agg(json_build_object('id', e.id, 'name', e.name) ORDER BY e.name)
          FROM training_participants p JOIN employees e ON e.id=p.employee_id
          WHERE p.training_id=t.id) AS participants
     FROM trainings t WHERE t.public_token=$1 AND t.status <> 'cancelled'`, [String(token)]);
  return rows[0] || null;
}

router.get('/training/:token', async (req, res, next) => {
  try {
    const t = await byToken(req.params.token);
    if (!t) return res.status(404).json({ error: 'This link is not valid any more.' });
    res.json({
      code: t.code, title: t.title, batch: t.batch,
      days: t.days || [], participants: t.participants || [],
      questions: t.feedback_questions || DEFAULT_QUESTIONS,
    });
  } catch (e) { next(e); }
});

// Self check-in: marks the participant Present for one training day.
router.post('/att/:token', express.json(), async (req, res, next) => {
  try {
    const t = await byToken(req.params.token);
    if (!t) return res.status(404).json({ error: 'This link is not valid any more.' });
    const employeeId = Number(req.body?.employee_id);
    const day = String(req.body?.day || '');
    if (!(t.participants || []).some((p) => p.id === employeeId)) {
      return res.status(403).json({ error: 'Only employees assigned to this training can check in.' });
    }
    if (!(t.days || []).some((d) => d.slice(0, 10) === day)) {
      return res.status(400).json({ error: 'That date is not a day of this training.' });
    }
    await query(
      `INSERT INTO attendance (training_id, employee_id, day, mark)
       VALUES ($1,$2,$3,'P')
       ON CONFLICT (training_id, employee_id, day) DO UPDATE SET mark='P', updated_at=now()`,
      [t.id, employeeId, day]);
    await audit(null, 'attendance.self_checkin', 'training', t.id, { employee_id: employeeId, day });
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});

// Feedback via the QR link. Tagged to the training; respondent picks who
// they are from the participant list.
router.post('/fb/:token', express.json(), async (req, res, next) => {
  try {
    const t = await byToken(req.params.token);
    if (!t) return res.status(404).json({ error: 'This link is not valid any more.' });
    const questions = t.feedback_questions || DEFAULT_QUESTIONS;
    const scores = req.body?.scores || {};
    const ok = questions.every((q, i) => {
      const v = Number(scores[i]);
      return Number.isInteger(v) && v >= 1 && v <= 5;
    });
    if (!ok) return res.status(400).json({ error: 'Answer every question with a rating from 1 to 5.' });
    const emp = (t.participants || []).find((p) => p.id === Number(req.body?.employee_id));
    const respondent = emp ? emp.name : String(req.body?.respondent || '').trim() || 'Participant';
    await query(
      `INSERT INTO feedback_responses (training_id, user_id, respondent, scores, comment)
       VALUES ($1, NULL, $2, $3, $4)`,
      [t.id, respondent, JSON.stringify(scores), req.body?.comment?.trim() || null]);
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
