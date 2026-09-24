const express = require('express');
const { query } = require('../db');

const router = express.Router();

// Training hours per employee: hours_per_day × (P=1, H=0.5) over marked days.
router.get('/manhours', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT e.id, e.name, e.entity, e.division, e.department,
              coalesce(round(sum(t.hours_per_day * CASE a.mark WHEN 'P' THEN 1 WHEN 'H' THEN 0.5 ELSE 0 END)::numeric, 1), 0) AS hours
       FROM employees e
       LEFT JOIN attendance a ON a.employee_id = e.id
       LEFT JOIN trainings t ON t.id = a.training_id
       WHERE e.active
       GROUP BY e.id ORDER BY e.name`);
    res.json(rows);
  } catch (e) { next(e); }
});

// Mandatory-training compliance: enrolment status per active employee.
router.get('/compliance', async (req, res, next) => {
  try {
    const { rows: mand } = await query(
      `SELECT id, code, title, batch, status FROM trainings
       WHERE mandatory AND status NOT IN ('postponed','cancelled') ORDER BY id`);
    const { rows: emps } = await query(
      `SELECT id, name, entity FROM employees WHERE active ORDER BY name`);
    const { rows: parts } = await query('SELECT training_id, employee_id FROM training_participants');
    const inTraining = new Set(parts.map((p) => p.training_id + ':' + p.employee_id));
    res.json({
      trainings: mand,
      employees: emps.map((e) => ({
        ...e,
        status: mand.map((t) =>
          inTraining.has(t.id + ':' + e.id) ? (t.status === 'completed' ? 'done' : 'booked') : 'due'),
      })),
    });
  } catch (e) { next(e); }
});

// One employee's training passport: every training with attendance % and hours.
router.get('/passport/:employeeId', async (req, res, next) => {
  try {
    const empId = Number(req.params.employeeId);
    const { rows } = await query(
      `SELECT t.id, t.code, t.title, t.batch, t.status, t.hours_per_day,
              (SELECT count(*)::int FROM training_days d WHERE d.training_id = t.id) AS day_count,
              min(d2.day) AS first_day, max(d2.day) AS last_day,
              count(a.mark) FILTER (WHERE a.mark IS NOT NULL)::int AS marked,
              coalesce(sum(CASE a.mark WHEN 'P' THEN 1 WHEN 'H' THEN 0.5 ELSE 0 END), 0)::float AS present_units
       FROM trainings t
       JOIN training_participants p ON p.training_id = t.id AND p.employee_id = $1
       LEFT JOIN training_days d2 ON d2.training_id = t.id
       LEFT JOIN attendance a ON a.training_id = t.id AND a.employee_id = $1 AND a.day = d2.day
       GROUP BY t.id ORDER BY min(d2.day) NULLS LAST`, [empId]);
    res.json(rows.map((r) => {
      const attPct = r.day_count ? Math.round((r.present_units / r.day_count) * 100) : null;
      return { ...r, att_pct: attPct, hours: Math.round(r.present_units * r.hours_per_day * 10) / 10 };
    }));
  } catch (e) { next(e); }
});

module.exports = router;
