const express = require('express');
const { query } = require('../db');

const router = express.Router();

// Foundation dashboard: headcounts now; training/compliance tiles arrive with
// the trainings module.
router.get('/', async (req, res, next) => {
  try {
    const [emp, users, trn, up] = await Promise.all([
      query(`SELECT entity, count(*)::int AS n FROM employees WHERE active GROUP BY entity`),
      query(`SELECT count(*)::int AS n FROM users WHERE active`),
      query(`SELECT status, count(*)::int AS n FROM trainings GROUP BY status`),
      query(`SELECT t.code, t.title, t.batch, t.mode, t.trainer_type, min(d.day) AS first_day
             FROM trainings t JOIN training_days d ON d.training_id = t.id
             WHERE t.status IN ('planned','confirmed','in_progress') AND d.day >= current_date
             GROUP BY t.id ORDER BY min(d.day) LIMIT 5`),
    ]);
    const byEntity = { AMD: 0, ASS: 0, ATS: 0 };
    emp.rows.forEach(r => { byEntity[r.entity] = r.n; });
    const byStatus = {};
    trn.rows.forEach(r => { byStatus[r.status] = r.n; });
    res.json({
      employees: { total: Object.values(byEntity).reduce((a, b) => a + b, 0), byEntity },
      activeUsers: users.rows[0].n,
      trainings: {
        total: Object.values(byStatus).reduce((a, b) => a + b, 0),
        byStatus,
        upcoming: up.rows,
      },
    });
  } catch (e) { next(e); }
});

// Everything the filterable dashboard needs in one call; the client slices it
// by entity/employee/training/division/department/team/date exactly like the
// prototype. Expense figures are included for admins only (checklist K6).
router.get('/full', async (req, res, next) => {
  try {
    const isAdmin = req.user.role === 'admin' || req.user.role === 'super_admin';
    const [emps, trns, att, exp] = await Promise.all([
      query(`SELECT id, name, entity, division, department, manager FROM employees WHERE active ORDER BY name`),
      query(`SELECT t.id, t.code, t.title, t.batch, t.status, t.mandatory, t.trainer_type, t.mode,
               t.hours_per_day, t.seats,
               (SELECT json_agg(d.day ORDER BY d.day) FROM training_days d WHERE d.training_id=t.id) AS days,
               (SELECT json_agg(p.employee_id) FROM training_participants p WHERE p.training_id=t.id) AS participant_ids,
               (SELECT count(*)::int FROM feedback_responses f WHERE f.training_id=t.id) AS response_count
             FROM trainings t ORDER BY t.id`),
      query(`SELECT training_id, employee_id,
               sum(CASE mark WHEN 'P' THEN 1 WHEN 'H' THEN 0.5 ELSE 0 END)::float AS units
             FROM attendance GROUP BY training_id, employee_id`),
      isAdmin
        ? query(`SELECT training_id, training_label, entity_split, budget, actual, approval FROM expenses WHERE active`)
        : Promise.resolve({ rows: null }),
    ]);
    res.json({ employees: emps.rows, trainings: trns.rows, attendance: att.rows, expenses: exp.rows });
  } catch (e) { next(e); }
});

module.exports = router;
