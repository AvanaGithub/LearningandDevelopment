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
    const { rows: t } = await query('SELECT id, feedback_questions, external_form_url FROM trainings WHERE id=$1', [trainingId]);
    if (!t.length) return res.status(404).json({ error: 'Not found' });
    const { rows: responses } = await query(
      `SELECT respondent, user_id, scores, comment, created_at
       FROM feedback_responses WHERE training_id=$1 ORDER BY created_at`, [trainingId]);
    res.json({
      questions: t[0].feedback_questions || DEFAULT_QUESTIONS,
      external_form_url: t[0].external_form_url || null,
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
    // Optional external form (Microsoft Forms): the QR page redirects there.
    let ext = null;
    if (req.body?.external_form_url !== undefined) {
      const v = String(req.body.external_form_url || '').trim();
      if (v && !/^https:\/\/\S+$/i.test(v)) {
        return res.status(400).json({ error: 'The external form link must start with https://' });
      }
      if (v.length > 500) return res.status(400).json({ error: 'The external form link is too long' });
      ext = v || null;
    }
    const { rowCount } = await query(
      `UPDATE trainings SET feedback_questions=$2,
         external_form_url = CASE WHEN $3::boolean THEN $4 ELSE external_form_url END,
         updated_at=now() WHERE id=$1`,
      [trainingId, JSON.stringify(questions), req.body?.external_form_url !== undefined, ext]);
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    await audit(req.user.id, 'feedback.form_update', 'training', trainingId, { questions, external_form_url: ext });
    res.json({ ok: true, questions });
  } catch (e) { next(e); }
});

// Bulk import (admin): responses collected on paper/Excel, each matched to
// a participant employee. An employee's earlier imported/QR response is
// updated in place; nothing is ever deleted.
router.post('/:trainingId/import', requireRole('admin'), express.json({ limit: '2mb' }), async (req, res, next) => {
  try {
    const trainingId = Number(req.params.trainingId);
    const { rows: t } = await query('SELECT feedback_questions FROM trainings WHERE id=$1', [trainingId]);
    if (!t.length) return res.status(404).json({ error: 'Not found' });
    const questions = t[0].feedback_questions || DEFAULT_QUESTIONS;
    const { rows: parts } = await query(
      'SELECT employee_id FROM training_participants WHERE training_id=$1', [trainingId]);
    const partIds = new Set(parts.map((p) => p.employee_id));
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length || rows.length > 1000) return res.status(400).json({ error: 'Send between 1 and 1000 rows' });
    let ok = 0, skipped = 0;
    for (const r of rows) {
      const empId = Number(r.employee_id);
      const scores = {};
      let any = false;
      questions.forEach((q, i) => {
        const v = Number(r.scores?.[i]);
        if (Number.isInteger(v) && v >= 1 && v <= 5) { scores[i] = v; any = true; }
      });
      if (!empId || !partIds.has(empId) || !any) { skipped++; continue; }
      await query(
        `INSERT INTO feedback_responses (training_id, employee_id, respondent, scores, comment)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (training_id, employee_id) WHERE employee_id IS NOT NULL
         DO UPDATE SET scores=$4, comment=$5, created_at=now()`,
        [trainingId, empId, String(r.respondent || 'Imported').slice(0, 120),
         JSON.stringify(scores), r.comment ? String(r.comment).trim().slice(0, 2000) : null]);
      ok++;
    }
    await audit(req.user.id, 'feedback.import', 'training', trainingId, { imported: ok, skipped });
    res.json({ ok, skipped });
  } catch (e) { next(e); }
});

// Submit (or update) my own response. One per user per training.
// Managers/leaders are view-only — participants respond via the QR link.
router.post('/:trainingId', requireRole('admin'), express.json(), async (req, res, next) => {
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
