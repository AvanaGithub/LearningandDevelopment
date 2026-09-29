const express = require('express');
const { query } = require('../db');
const { requireRole, audit } = require('../auth');

// New-joiner onboarding: recent joiners with their induction-training state,
// the configurable checklist (settings.joiner_steps), the training phase
// (dates/status/comment) and typed assessments. Managers and leaders see
// only their own reportees, and only until the training phase completes.
const router = express.Router();

const J_STATUS = ['not_started', 'in_progress', 'completed', 'extended', 'dropped'];
const ASSESS_TYPES = ['Written Assessment', 'Presentation', 'Teach Back', 'Product Demonstration',
  'Viva', 'Final Assessment', 'Reassessment'];

const normMgr = (m) => String(m || '').replace(/^mentor:\s*/i, '').trim().toLowerCase();

router.get('/', async (req, res, next) => {
  try {
    const days = Math.min(730, Math.max(7, Number(req.query.days) || 180));
    const { rows: empRows } = await query(
      `SELECT id, name, zoho_emp_id, entity, division, department, designation, manager, date_joined
       FROM employees WHERE active AND date_joined IS NOT NULL
         AND date_joined >= current_date - $1::int ORDER BY date_joined DESC`, [days]);
    const { rows: ind } = await query(
      `SELECT t.id, t.title, t.batch, t.status, p.employee_id,
              (SELECT count(*)::int FROM training_days d WHERE d.training_id=t.id) AS day_count,
              (SELECT count(*)::int FROM attendance a WHERE a.training_id=t.id AND a.employee_id=p.employee_id AND a.mark IN ('P','H')) AS attended
       FROM trainings t JOIN training_participants p ON p.training_id=t.id
       WHERE t.category='Induction' AND t.status <> 'cancelled'`);
    const { rows: steps } = await query('SELECT employee_id, step, done_at FROM joiner_steps');
    const { rows: jt } = await query('SELECT * FROM joiner_training');
    const { rows: ja } = await query(
      'SELECT * FROM joiner_assessments ORDER BY assess_date NULLS LAST, id');
    const jtMap = {};
    jt.forEach((r) => { jtMap[r.employee_id] = r; });

    let emps = empRows;
    if (req.user.role === 'manager' || req.user.role === 'leader') {
      const myName = String(req.user.name || '').trim().toLowerCase();
      emps = emps.filter((e) => normMgr(e.manager) === myName &&
        (jtMap[e.id]?.status || 'not_started') !== 'completed');
    }
    res.json({
      employees: emps.map((e) => ({
        ...e,
        induction: ind.filter((i) => i.employee_id === e.id)
          .map(({ id, title, batch, status, day_count, attended }) => ({ id, title, batch, status, day_count, attended })),
        steps: steps.filter((s) => s.employee_id === e.id).map((s) => s.step),
        training: jtMap[e.id] || null,
        assessments: ja.filter((a) => a.employee_id === e.id),
      })),
    });
  } catch (e) { next(e); }
});

router.post('/:empId/steps', requireRole('admin'), express.json(), async (req, res, next) => {
  try {
    const empId = Number(req.params.empId);
    const step = String(req.body?.step || '').trim();
    const done = Boolean(req.body?.done);
    if (!step) return res.status(400).json({ error: 'step is required' });
    if (done) {
      await query(
        `INSERT INTO joiner_steps (employee_id, step, done_by) VALUES ($1,$2,$3)
         ON CONFLICT (employee_id, step) DO NOTHING`, [empId, step, req.user.id]);
    } else {
      await query('DELETE FROM joiner_steps WHERE employee_id=$1 AND step=$2', [empId, step]);
    }
    await audit(req.user.id, done ? 'joiner.step_done' : 'joiner.step_undone', 'employee', empId, { step });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Training phase per joiner: dates, status, comment (upsert).
router.put('/:empId/training', requireRole('admin'), express.json(), async (req, res, next) => {
  try {
    const empId = Number(req.params.empId);
    const b = req.body || {};
    const status = J_STATUS.includes(b.status) ? b.status : 'not_started';
    const { rows } = await query(
      `INSERT INTO joiner_training (employee_id, start_date, end_date, status, comment)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (employee_id)
       DO UPDATE SET start_date=$2, end_date=$3, status=$4, comment=$5, updated_at=now()
       RETURNING *`,
      [empId, b.start_date || null, b.end_date || null, status, b.comment?.trim() || null]);
    await audit(req.user.id, 'joiner.training_update', 'employee', empId,
      { start_date: b.start_date || null, end_date: b.end_date || null, status, comment: b.comment || null });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// Typed assessment score for a joiner (raw score vs max marks; the client
// shows the /100 conversion with the 80% pass mark).
router.post('/:empId/assessments', requireRole('admin'), express.json(), async (req, res, next) => {
  try {
    const empId = Number(req.params.empId);
    const b = req.body || {};
    if (!ASSESS_TYPES.includes(b.atype)) {
      return res.status(400).json({ error: 'Assessment type must be one of: ' + ASSESS_TYPES.join(', ') });
    }
    const max = Number(b.max_marks) > 0 ? Number(b.max_marks) : 100;
    const score = Number(b.score);
    if (!(score >= 0) || score > max) return res.status(400).json({ error: `Score must be between 0 and ${max}` });
    const { rows } = await query(
      `INSERT INTO joiner_assessments (employee_id, atype, assess_date, max_marks, score)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [empId, b.atype, b.assess_date || null, max, score]);
    await audit(req.user.id, 'joiner.assessment_add', 'employee', empId, { atype: b.atype, score, max_marks: max });
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

router.delete('/:empId/assessments/:aid', requireRole('admin'), async (req, res, next) => {
  try {
    const empId = Number(req.params.empId);
    const aid = Number(req.params.aid);
    const reason = String(req.query.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'A reason is required to remove an assessment entry' });
    const { rows } = await query(
      'DELETE FROM joiner_assessments WHERE id=$1 AND employee_id=$2 RETURNING atype, score, max_marks', [aid, empId]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    await audit(req.user.id, 'joiner.assessment_remove', 'employee', empId, rows[0], reason);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
