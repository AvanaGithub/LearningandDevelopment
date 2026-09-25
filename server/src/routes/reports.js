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
      // No marks at all (e.g. an upcoming training) reads "—", not 0%.
      const attPct = r.day_count && r.marked ? Math.round((r.present_units / r.day_count) * 100) : null;
      return { ...r, att_pct: attPct, hours: Math.round(r.present_units * r.hours_per_day * 10) / 10 };
    }));
  } catch (e) { next(e); }
});

// Feedback summary: per training, response count and average score across
// every question (scores are JSONB objects keyed by question index).
router.get('/feedback-summary', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT t.id, t.code, t.title, t.batch, t.trainer_type, t.trainer_name, t.agency, t.status,
              count(DISTINCT r.id)::int AS responses,
              round(avg((v.value)::numeric), 2) AS avg_score,
              (SELECT count(*)::int FROM training_participants p WHERE p.training_id=t.id) AS participant_count
       FROM trainings t
       LEFT JOIN feedback_responses r ON r.training_id = t.id
       LEFT JOIN LATERAL jsonb_each_text(r.scores) v ON TRUE
       WHERE t.status <> 'cancelled'
       GROUP BY t.id ORDER BY t.id`);
    res.json(rows);
  } catch (e) { next(e); }
});

// Everything an ISO 13485 auditor asks for, in one payload — the client
// turns it into a multi-sheet Excel evidence pack. Admin only.
router.get('/evidence', async (req, res, next) => {
  try {
    if (req.user.role === 'manager') return res.status(403).json({ error: 'Insufficient permissions' });
    const [trainings, participants, attendance, feedback, expensesR, auditR] = await Promise.all([
      query(`SELECT t.code, t.title, t.batch, t.category, t.mode, t.trainer_type, t.trainer_name, t.agency,
                    t.hours_per_day, t.seats, t.mandatory, t.status, t.validity_months,
                    (SELECT string_agg(d.day::text, ', ' ORDER BY d.day) FROM training_days d WHERE d.training_id=t.id) AS days
             FROM trainings t ORDER BY t.id`),
      query(`SELECT t.code, t.title, e.name, e.zoho_emp_id, e.entity, e.division, e.department
             FROM training_participants p JOIN trainings t ON t.id=p.training_id JOIN employees e ON e.id=p.employee_id
             ORDER BY t.id, e.name`),
      query(`SELECT t.code, e.name, a.day, a.mark, a.updated_at,
                    coalesce(u.name, 'QR self check-in') AS marked_by
             FROM attendance a JOIN trainings t ON t.id=a.training_id JOIN employees e ON e.id=a.employee_id
             LEFT JOIN users u ON u.id=a.marked_by ORDER BY t.id, a.day, e.name`),
      query(`SELECT t.code, r.respondent, r.scores, r.comment, r.created_at
             FROM feedback_responses r JOIN trainings t ON t.id=r.training_id ORDER BY t.id, r.created_at`),
      query(`SELECT training_label, dates, category, training_type, vendor, budget, actual, approval, remark
             FROM expenses WHERE active ORDER BY id`),
      query(`SELECT a.created_at, coalesce(u.name,'system/QR') AS who, a.action, a.record_type, a.record_id, a.reason
             FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 2000`),
    ]);
    res.json({
      trainings: trainings.rows, participants: participants.rows, attendance: attendance.rows,
      feedback: feedback.rows, expenses: expensesR.rows, audit: auditR.rows,
    });
  } catch (e) { next(e); }
});

module.exports = router;
