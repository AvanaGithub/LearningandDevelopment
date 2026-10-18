const express = require('express');
const { query } = require('../db');
const { requireRole, audit } = require('../auth');

const router = express.Router();

// A question is a plain string (1–5 rating) or {q, type:'text'} for an
// open answer; qT/qIsTxt normalize both shapes.
const qT = (q) => (typeof q === 'string' ? q : (q && q.q) || '');
const qIsTxt = (q) => Boolean(q && typeof q === 'object' && q.type === 'text');
const normQ = (x) => {
  if (typeof x === 'string') return x.trim().slice(0, 300);
  if (x && x.q) return { q: String(x.q).trim().slice(0, 300), type: 'text' };
  return '';
};
// Ratings are required; text answers are optional. Returns the cleaned
// scores object or null when a rating is missing/invalid.
function cleanScores(questions, scores) {
  const out = {};
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const v = scores?.[i];
    if (qIsTxt(q)) {
      const s = String(v ?? '').trim();
      if (s) out[i] = s.slice(0, 1000);
      continue;
    }
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 5) return null;
    out[i] = n;
  }
  return out;
}
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
      `SELECT respondent, user_id, employee_id, scores, comment, created_at
       FROM feedback_responses WHERE training_id=$1 ORDER BY created_at`, [trainingId]);
    // Who has NOT responded yet, from the participant list (matched by
    // employee id, or by name for responses recorded without one).
    const { rows: parts } = await query(
      `SELECT e.id, e.name, e.zoho_emp_id, e.department
       FROM training_participants p JOIN employees e ON e.id = p.employee_id
       WHERE p.training_id=$1 ORDER BY e.name`, [trainingId]);
    const doneIds = new Set(responses.map((r) => r.employee_id).filter(Boolean));
    const doneNames = new Set(responses.map((r) => String(r.respondent || '').trim().toLowerCase()));
    const pending = parts.filter((p) => !doneIds.has(p.id) && !doneNames.has(p.name.trim().toLowerCase()));
    res.json({
      questions: t[0].feedback_questions || DEFAULT_QUESTIONS,
      external_form_url: t[0].external_form_url || null,
      responses,
      participant_count: parts.length,
      pending,
      my_response: responses.find((r) => r.user_id === req.user.id) || null,
    });
  } catch (e) { next(e); }
});

// Replace the questionnaire (admin).
router.put('/:trainingId/form', requireRole('admin'), express.json(), async (req, res, next) => {
  try {
    const trainingId = Number(req.params.trainingId);
    const questions = (req.body?.questions || []).map(normQ).filter((x) => qT(x));
    // Questions are optional when only the Microsoft Form link is being
    // set — the stored in-hub questions then stay as they are.
    const onlyExt = !questions.length && req.body?.external_form_url !== undefined;
    if (!onlyExt && (questions.length < 1 || questions.length > 50)) {
      return res.status(400).json({ error: 'Between 1 and 50 questions' });
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
      `UPDATE trainings SET
         feedback_questions = CASE WHEN $5::boolean THEN $2::jsonb ELSE feedback_questions END,
         external_form_url = CASE WHEN $3::boolean THEN $4 ELSE external_form_url END,
         updated_at=now() WHERE id=$1`,
      [trainingId, JSON.stringify(questions), req.body?.external_form_url !== undefined, ext, !onlyExt]);
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    await audit(req.user.id, 'feedback.form_update', 'training', trainingId, { questions, external_form_url: ext });
    res.json({ ok: true, questions });
  } catch (e) { next(e); }
});

// Open/close feedback collection for the learner portal (admin).
router.post('/:trainingId/open', requireRole('admin'), express.json(), async (req, res, next) => {
  try {
    const trainingId = Number(req.params.trainingId);
    const open = Boolean(req.body?.open);
    const { rowCount } = await query(
      'UPDATE trainings SET feedback_open=$2, updated_at=now() WHERE id=$1', [trainingId, open]);
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    await audit(req.user.id, open ? 'feedback.opened' : 'feedback.closed', 'training', trainingId);
    res.json({ ok: true, open });
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
    let questions = t[0].feedback_questions || DEFAULT_QUESTIONS;
    // The sheet brings its own questions (each training has its own set):
    // they become this training's feedback form.
    if (Array.isArray(req.body?.questions)) {
      const qs = req.body.questions.map(normQ).filter((x) => qT(x));
      if (qs.length < 1 || qs.length > 50) return res.status(400).json({ error: 'Between 1 and 50 question columns' });
      questions = qs;
      await query('UPDATE trainings SET feedback_questions=$2, updated_at=now() WHERE id=$1',
        [trainingId, JSON.stringify(qs)]);
      await audit(req.user.id, 'feedback.form_update', 'training', trainingId, { questions: qs, via: 'import' });
    }
    const { rows: parts } = await query(
      'SELECT employee_id FROM training_participants WHERE training_id=$1', [trainingId]);
    const partIds = new Set(parts.map((p) => p.employee_id));
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (rows.length > 1000) return res.status(400).json({ error: 'At most 1000 rows per import' });
    if (!rows.length && !Array.isArray(req.body?.questions)) {
      return res.status(400).json({ error: 'The sheet has no data rows' });
    }
    let ok = 0, skipped = 0;
    for (const r of rows) {
      const empId = Number(r.employee_id);
      const scores = {};
      let any = false;
      questions.forEach((q, i) => {
        const raw = r.scores?.[i];
        if (raw === undefined || raw === null || String(raw).trim() === '') return;
        const v = Number(raw);
        if (Number.isInteger(v) && v >= 1 && v <= 5) { scores[i] = v; any = true; }
        // Text answers (open questions) are kept verbatim.
        else { scores[i] = String(raw).trim().slice(0, 1000); any = true; }
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
    const clean = cleanScores(questions, req.body?.scores || {});
    if (!clean) return res.status(400).json({ error: 'Answer every rating question with 1 to 5' });
    await query(
      `INSERT INTO feedback_responses (training_id, user_id, respondent, scores, comment)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (training_id, user_id)
       DO UPDATE SET scores=$4, comment=$5, created_at=now()`,
      [trainingId, req.user.id, req.user.name, JSON.stringify(clean), req.body?.comment?.trim() || null]);
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.helpers = { qT, qIsTxt, normQ, cleanScores };
