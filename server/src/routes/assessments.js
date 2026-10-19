const express = require('express');
const { query } = require('../db');
const { requireRole, audit } = require('../auth');
const { syncTrainingAssessment } = require('../formsync');

// Assessments for regular trainings: conducted on a Microsoft Form (link +
// optional response-workbook sync) or marked offline (manual entry / Excel
// import). Scores are raw marks out of max_marks; the client converts to a
// percentage and the 4-band grade. Leaders can view, admins manage.
const router = express.Router();
const ASSESS_TYPES = ['Written Assessment', 'Presentation', 'Teach Back', 'Product Demonstration',
  'Viva', 'Final Assessment', 'Reassessment'];

router.use(requireRole('leader'));

// Light list for tab badges: every assessment with its training id.
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT a.id, a.training_id, a.name, a.atype, a.assess_date,
              (SELECT count(*)::int FROM assessment_scores s WHERE s.assessment_id=a.id) AS score_count
       FROM assessments a ORDER BY a.id`);
    res.json(rows);
  } catch (e) { next(e); }
});

// Everything for one training: its assessments with scores + participants.
router.get('/training/:tid', async (req, res, next) => {
  try {
    const tid = Number(req.params.tid);
    const { rows: assessments } = await query(
      `SELECT a.*, (SELECT json_agg(json_build_object('employee_id', s.employee_id, 'score', s.score,
                      'source', s.source, 'submitted_at', s.submitted_at))
                    FROM assessment_scores s WHERE s.assessment_id=a.id) AS scores
       FROM assessments a WHERE a.training_id=$1 ORDER BY a.assess_date NULLS LAST, a.id`, [tid]);
    const { rows: participants } = await query(
      `SELECT e.id, e.name, e.zoho_emp_id, e.email, e.department, e.division, e.entity
       FROM training_participants p JOIN employees e ON e.id=p.employee_id
       WHERE p.training_id=$1 ORDER BY e.name`, [tid]);
    res.json({ assessments, participants });
  } catch (e) { next(e); }
});

const pickA = (b) => ({
  name: b.name?.trim() || b.atype || 'Assessment',
  atype: ASSESS_TYPES.includes(b.atype) ? b.atype : null,
  max_marks: Number(b.max_marks) > 0 ? Number(b.max_marks) : 100,
  assess_date: b.assess_date || null,
  external_form_url: httpsOrNull(b.external_form_url),
  workbook_url: httpsOrNull(b.workbook_url),
});
function httpsOrNull(u) {
  const s = String(u || '').trim();
  if (!s) return null;
  if (!/^https:\/\//i.test(s)) throw Object.assign(new Error('Links must start with https://'), { status: 400 });
  return s;
}

router.post('/training/:tid', requireRole('admin'), express.json(), async (req, res, next) => {
  try {
    const tid = Number(req.params.tid);
    const { rows: t } = await query('SELECT id FROM trainings WHERE id=$1', [tid]);
    if (!t.length) return res.status(404).json({ error: 'Training not found' });
    const f = pickA(req.body || {});
    const { rows } = await query(
      `INSERT INTO assessments (training_id, name, atype, max_marks, assess_date, external_form_url, workbook_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [tid, f.name, f.atype, f.max_marks, f.assess_date, f.external_form_url, f.workbook_url]);
    await audit(req.user.id, 'assessment.create', 'assessment', rows[0].id, { training_id: tid, name: f.name });
    res.status(201).json(rows[0]);
  } catch (e) { e.status === 400 ? res.status(400).json({ error: e.message }) : next(e); }
});

router.patch('/:id', requireRole('admin'), express.json(), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows: cur } = await query('SELECT * FROM assessments WHERE id=$1', [id]);
    if (!cur.length) return res.status(404).json({ error: 'Not found' });
    const f = pickA({ ...cur[0], ...req.body });
    const { rows } = await query(
      `UPDATE assessments SET name=$2, atype=$3, max_marks=$4, assess_date=$5,
         external_form_url=$6, workbook_url=$7, sync_error=NULL WHERE id=$1 RETURNING *`,
      [id, f.name, f.atype, f.max_marks, f.assess_date, f.external_form_url, f.workbook_url]);
    await audit(req.user.id, 'assessment.update', 'assessment', id, { changes: req.body });
    res.json(rows[0]);
  } catch (e) { e.status === 400 ? res.status(400).json({ error: e.message }) : next(e); }
});

// Delete needs a reason; scores are snapshotted in the audit log first.
router.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const reason = String(req.query.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'A reason is required to delete an assessment' });
    const { rows: cur } = await query('SELECT * FROM assessments WHERE id=$1', [id]);
    if (!cur.length) return res.status(404).json({ error: 'Not found' });
    const { rows: scores } = await query('SELECT * FROM assessment_scores WHERE assessment_id=$1', [id]);
    await query('DELETE FROM assessments WHERE id=$1', [id]);
    await audit(req.user.id, 'assessment.delete', 'assessment', id,
      { assessment: cur[0], scores }, reason);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Manual score entry (blank = not assessed → row removed).
router.put('/:id/scores', requireRole('admin'), express.json(), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows: cur } = await query('SELECT max_marks FROM assessments WHERE id=$1', [id]);
    if (!cur.length) return res.status(404).json({ error: 'Not found' });
    const max = Number(cur[0].max_marks);
    const scores = Array.isArray(req.body?.scores) ? req.body.scores : [];
    for (const s of scores) {
      if (s.score === null || s.score === '') {
        await query('DELETE FROM assessment_scores WHERE assessment_id=$1 AND employee_id=$2', [id, Number(s.employee_id)]);
      } else {
        const v = Math.max(0, Math.min(Number(s.score), max));
        await query(
          `INSERT INTO assessment_scores (assessment_id, employee_id, score, source)
           VALUES ($1,$2,$3,'manual')
           ON CONFLICT (assessment_id, employee_id)
           DO UPDATE SET score=$3, source='manual', updated_at=now()`,
          [id, Number(s.employee_id), v]);
      }
    }
    await audit(req.user.id, 'assessment.scores', 'assessment', id, { count: scores.length });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Excel import — the client parses the sheet and sends matched rows.
router.post('/:id/import', requireRole('admin'), express.json(), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows: cur } = await query('SELECT max_marks FROM assessments WHERE id=$1', [id]);
    if (!cur.length) return res.status(404).json({ error: 'Not found' });
    const max = Number(cur[0].max_marks);
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ error: 'No rows to import' });
    let ok = 0;
    for (const r of rows) {
      const v = Number(r.score);
      if (!Number.isFinite(v) || !r.employee_id) continue;
      await query(
        `INSERT INTO assessment_scores (assessment_id, employee_id, score, source, submitted_at)
         VALUES ($1,$2,$3,'import',$4)
         ON CONFLICT (assessment_id, employee_id)
         DO UPDATE SET score=$3, source='import', submitted_at=$4, updated_at=now()`,
        [id, Number(r.employee_id), Math.max(0, Math.min(v, max)), r.submitted_at || null]);
      ok++;
    }
    await audit(req.user.id, 'assessment.import', 'assessment', id, { imported: ok });
    res.json({ ok });
  } catch (e) { next(e); }
});

// Pull scores from the linked Microsoft Forms response workbook right now.
router.post('/:id/sync', requireRole('admin'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows: cur } = await query('SELECT * FROM assessments WHERE id=$1', [id]);
    if (!cur.length) return res.status(404).json({ error: 'Not found' });
    if (!cur[0].workbook_url) return res.status(400).json({ error: 'No response workbook linked — edit the assessment and paste the Form\'s "Open results in Excel" share link.' });
    try {
      const r = await syncTrainingAssessment(cur[0]);
      await audit(req.user.id, 'assessment.sync', 'assessment', id, r);
      res.json({ ok: true, ...r });
    } catch (e2) {
      await query('UPDATE assessments SET sync_error=$2, last_synced=now() WHERE id=$1', [id, String(e2.message).slice(0, 400)]);
      res.status(502).json({ error: e2.message });
    }
  } catch (e) { next(e); }
});

module.exports = router;
