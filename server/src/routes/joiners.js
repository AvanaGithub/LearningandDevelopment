const express = require('express');
const { query } = require('../db');
const { requireRole, audit } = require('../auth');

// New-joiner onboarding: recent joiners with their induction-training state
// and the configurable checklist (step list lives in settings.joiner_steps).
const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const days = Math.min(730, Math.max(7, Number(req.query.days) || 180));
    const { rows: emps } = await query(
      `SELECT id, name, zoho_emp_id, entity, division, department, designation, date_joined
       FROM employees WHERE active AND date_joined IS NOT NULL
         AND date_joined >= current_date - $1::int ORDER BY date_joined DESC`, [days]);
    const { rows: ind } = await query(
      `SELECT t.id, t.title, t.batch, t.status, p.employee_id,
              (SELECT count(*)::int FROM training_days d WHERE d.training_id=t.id) AS day_count,
              (SELECT count(*)::int FROM attendance a WHERE a.training_id=t.id AND a.employee_id=p.employee_id AND a.mark IN ('P','H')) AS attended
       FROM trainings t JOIN training_participants p ON p.training_id=t.id
       WHERE t.category='Induction' AND t.status <> 'cancelled'`);
    const { rows: steps } = await query('SELECT employee_id, step, done_at FROM joiner_steps');
    res.json({
      employees: emps.map((e) => ({
        ...e,
        induction: ind.filter((i) => i.employee_id === e.id)
          .map(({ id, title, batch, status, day_count, attended }) => ({ id, title, batch, status, day_count, attended })),
        steps: steps.filter((s) => s.employee_id === e.id).map((s) => s.step),
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

module.exports = router;
