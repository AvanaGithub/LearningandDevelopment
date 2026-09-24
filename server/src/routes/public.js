const express = require('express');
const crypto = require('crypto');
const { query } = require('../db');
const { audit } = require('../auth');
const config = require('../config');

// QR participant pages. The training's unguessable token opens the page;
// the PERSON is identified by their own Zoho sign-in (participant session),
// so nobody can mark attendance or feedback for someone else.
const router = express.Router();

const sha256 = (t) => crypto.createHash('sha256').update(t).digest('hex');

const DEFAULT_QUESTIONS = [
  'Relevance of content to my job', "Trainer's subject knowledge",
  "Trainer's delivery and clarity", 'Confidence to apply this at work', 'Overall rating',
];

async function byToken(token) {
  const { rows } = await query(
    `SELECT t.id, t.code, t.title, t.batch, t.status, t.feedback_questions,
       (SELECT json_agg(d.day ORDER BY d.day) FROM training_days d WHERE d.training_id=t.id) AS days
     FROM trainings t WHERE t.public_token=$1 AND t.status <> 'cancelled'`, [String(token)]);
  return rows[0] || null;
}

async function participantOf(req) {
  const token = req.cookies?.psession;
  if (!token) return null;
  const { rows } = await query(
    `SELECT e.id, e.name FROM participant_sessions p JOIN employees e ON e.id = p.employee_id
     WHERE p.token_hash=$1 AND p.expires_at > now() AND e.active=TRUE`, [sha256(token)]);
  return rows[0] || null;
}

const isAssigned = async (trainingId, employeeId) => {
  const { rows } = await query(
    'SELECT 1 FROM training_participants WHERE training_id=$1 AND employee_id=$2', [trainingId, employeeId]);
  return rows.length > 0;
};

router.get('/training/:token', async (req, res, next) => {
  try {
    const t = await byToken(req.params.token);
    if (!t) return res.status(404).json({ error: 'This link is not valid any more.' });
    const me = await participantOf(req);
    res.json({
      code: t.code, title: t.title, batch: t.batch, days: t.days || [],
      questions: t.feedback_questions || DEFAULT_QUESTIONS,
      sso: config.zoho.configured,
      me: me ? { name: me.name, assigned: await isAssigned(t.id, me.id) } : null,
    });
  } catch (e) { next(e); }
});

// Self check-in — only for the signed-in participant themselves.
router.post('/att/:token', express.json(), async (req, res, next) => {
  try {
    const t = await byToken(req.params.token);
    if (!t) return res.status(404).json({ error: 'This link is not valid any more.' });
    const me = await participantOf(req);
    if (!me) return res.status(401).json({ error: 'Sign in with Zoho first.', need_login: true });
    if (!(await isAssigned(t.id, me.id))) {
      return res.status(403).json({ error: 'Your account is not assigned to this training — contact the organizer.' });
    }
    const day = String(req.body?.day || '');
    if (!(t.days || []).some((d) => d.slice(0, 10) === day)) {
      return res.status(400).json({ error: 'That date is not a day of this training.' });
    }
    await query(
      `INSERT INTO attendance (training_id, employee_id, day, mark)
       VALUES ($1,$2,$3,'P')
       ON CONFLICT (training_id, employee_id, day) DO UPDATE SET mark='P', updated_at=now()`,
      [t.id, me.id, day]);
    await audit(null, 'attendance.self_checkin', 'training', t.id, { employee_id: me.id, day });
    res.status(201).json({ ok: true, name: me.name, at: new Date().toISOString() });
  } catch (e) { next(e); }
});

// Feedback — tied to the verified participant, one response each (updating replaces).
router.post('/fb/:token', express.json(), async (req, res, next) => {
  try {
    const t = await byToken(req.params.token);
    if (!t) return res.status(404).json({ error: 'This link is not valid any more.' });
    const me = await participantOf(req);
    if (!me) return res.status(401).json({ error: 'Sign in with Zoho first.', need_login: true });
    const questions = t.feedback_questions || DEFAULT_QUESTIONS;
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
      [t.id, me.id, me.name, JSON.stringify(scores), req.body?.comment?.trim() || null]);
    res.status(201).json({ ok: true, name: me.name, at: new Date().toISOString() });
  } catch (e) { next(e); }
});

module.exports = router;
