const express = require('express');
const { query } = require('../db');
const { requireRole, audit } = require('../auth');

const router = express.Router();

// Standard questionnaire from the prototype; a training can override it.
const DEFAULT_QUESTIONS = [
  'Relevance of content to my job',
  "Trainer's subject knowledge",
  "Trainer's delivery and clarity",
  'Confidence to apply this at work',
  'Overall rating',
];

// Form + responses for one training. Any signed-in role can view.
router.get('/:trainingId', async (req, res, next) => {
  try {
    const trainingId = Number(req.params.trainingId);
    const { rows: t } = await query('SELECT id, feedback_questions FROM trainings WHERE id=$1', [trainingId]);
    if (!t.length) return res.status(404).json({ error: 'Not found' });
    const { rows: responses } = await query(
      `SELECT respondent, user_id, scores, comment, created_at
       FROM feedback_responses WHERE training_id=$1 ORDER BY created_at`, [trainingId]);
    res.json({
      questions: t[0].feedback_questions || DEFAULT_QUESTIONS,
      responses,
      my_response: responses.find((r) => r.user_id === req.user.id) || null,
    });
  } catch (e) { next(e); }
});

// Replace the questionnaire (admin).
router.put('/:trainingId/form', requireRole('admin'), express.json(), async (req, res, next) => {
  try {
    const trainingId = Number(req.params.trainingId);
    const questions = (req.body?.questions || []).map((q) => String(q).trim()).filter(Boolean);
    if (questions.length < 1 || questions.length > 20) {
      return res.status(400).json({ error: 'Between 1 and 20 questions' });
    }
    const { rowCount } = await query(
      'UPDATE trainings SET feedback_questions=$2, updated_at=now() WHERE id=$1', [trainingId, JSON.stringify(questions)]);
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    await audit(req.user.id, 'feedback.form_update', 'training', trainingId, { questions });
    res.json({ ok: true, questions });
  } catch (e) { next(e); }
});

// Submit (or update) my own response. One per user per training.
router.post('/:trainingId', express.json(), async (req, res, next) => {
  try {
    const trainingId = Number(req.params.trainingId);
    const { rows: t } = await query('SELECT feedback_questions FROM trainings WHERE id=$1', [trainingId]);
    if (!t.length) return res.status(404).json({ error: 'Not found' });
    const questions = t[0].feedback_questions || DEFAULT_QUESTIONS;
    const scores = req.body?.scores || {};
    const ok = questions.every((q, i) => {
      const v = Number(scores[i]);
      return Number.isInteger(v) && v >= 1 && v <= 5;
    });
    if (!ok) return res.status(400).json({ error: 'Answer every question with a rating from 1 to 5' });
    await query(
      `INSERT INTO feedback_responses (training_id, user_id, respondent, scores, comment)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (training_id, user_id)
       DO UPDATE SET scores=$4, comment=$5, created_at=now()`,
      [trainingId, req.user.id, req.user.name, JSON.stringify(scores), req.body?.comment?.trim() || null]);
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
