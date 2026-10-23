const express = require('express');
const { query } = require('../db');

const router = express.Router();

// Optional ?from=YYYY-MM-DD&to=YYYY-MM-DD; missing ends are open.
const dateRange = (q) => {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  return { from: iso.test(q.from || '') ? q.from : '1900-01-01', to: iso.test(q.to || '') ? q.to : '2999-12-31' };
};

// Training attendance report: every training with at least one day in
// [from, to], each participant's status from the attendance marks, and the
// per-training counts. Status rules (all of a training's days count):
//   no marks at all          → Not marked
//   present on every day     → Attended            (H counts as half a day)
//   present on some days     → Partially attended
//   no presence, any Leave   → Leave (if never marked Absent)
//   otherwise                → Absent
// Managers see only their own reportees; Mavericks stays leader-and-above.
router.get('/attendance', async (req, res, next) => {
  try {
    const { from, to } = dateRange(req.query);
    const lowRole = ['manager', 'learner'].includes(req.user.role);
    const { rows: trainings } = await query(
      `SELECT t.id, t.code, t.title, t.batch, t.category, t.mode, t.location, t.status,
              t.trainer_type, t.trainer_name, t.agency, t.hours_per_day, t.mandatory,
              (SELECT json_agg(to_char(d.day, 'YYYY-MM-DD') ORDER BY d.day) FROM training_days d WHERE d.training_id=t.id) AS days
       FROM trainings t
       WHERE t.status <> 'cancelled'
         AND EXISTS (SELECT 1 FROM training_days d WHERE d.training_id=t.id AND d.day BETWEEN $1::date AND $2::date)
         ${lowRole ? `AND coalesce(t.category, '') !~* 'maverick' AND t.title !~* 'maverick'` : ''}
       ORDER BY (SELECT min(d.day) FROM training_days d WHERE d.training_id=t.id), t.id`, [from, to]);
    if (!trainings.length) return res.json({ from, to, trainings: [], participants: [] });

    const params = [trainings.map((t) => t.id)];
    let scope = '';
    if (req.user.role === 'manager') {
      params.push(String(req.user.name || '').trim().toLowerCase());
      scope = `AND lower(btrim(regexp_replace(coalesce(e.manager,''), '^mentor:\\s*', '', 'i'))) = $2`;
    }
    const { rows: parts } = await query(
      `SELECT p.training_id, e.id AS employee_id, e.name, e.zoho_emp_id, e.entity, e.department, e.division,
              e.designation, e.manager, e.location, e.active,
              count(*) FILTER (WHERE a.mark = 'P')::int AS p,
              count(*) FILTER (WHERE a.mark = 'H')::int AS h,
              count(*) FILTER (WHERE a.mark = 'A')::int AS a,
              count(*) FILTER (WHERE a.mark = 'L')::int AS l
       FROM training_participants p
       JOIN employees e ON e.id = p.employee_id
       LEFT JOIN attendance a ON a.training_id = p.training_id AND a.employee_id = p.employee_id
       WHERE p.training_id = ANY($1::int[]) ${scope}
       GROUP BY p.training_id, e.id
       ORDER BY e.name`, params);

    const byId = Object.fromEntries(trainings.map((t) => [t.id, t]));
    const participants = parts.map((r) => {
      const t = byId[r.training_id];
      const dayCount = (t.days || []).length;
      const units = r.p + r.h * 0.5;
      const marked = r.p + r.h + r.a + r.l;
      const status = !marked ? 'not_marked'
        : dayCount && units >= dayCount ? 'attended'
        : units > 0 ? 'partial'
        : r.l > 0 && r.a === 0 ? 'leave'
        : 'absent';
      return {
        ...r, day_count: dayCount, present_days: units, status,
        att_pct: marked && dayCount ? Math.round((units / dayCount) * 100) : null,
        hours: Math.round(units * Number(t.hours_per_day || 0) * 10) / 10,
      };
    });
    res.json({ from, to, trainings, participants });
  } catch (e) { next(e); }
});

// Training hours per employee: hours_per_day × (P=1, H=0.5) over marked days.
router.get('/manhours', async (req, res, next) => {
  try {
    // Deactivated employees keep their history: they stay in the report
    // whenever they have recorded hours. Optional from/to: only attendance
    // days inside the range count.
    const { from, to } = dateRange(req.query);
    const { rows } = await query(
      `SELECT e.id, e.name, e.entity, e.division, e.department, e.location, e.active,
              coalesce(round(sum(t.hours_per_day * CASE a.mark WHEN 'P' THEN 1 WHEN 'H' THEN 0.5 ELSE 0 END)::numeric, 1), 0) AS hours
       FROM employees e
       LEFT JOIN attendance a ON a.employee_id = e.id AND a.day BETWEEN $1::date AND $2::date
       LEFT JOIN trainings t ON t.id = a.training_id
       GROUP BY e.id
       HAVING e.active OR sum(CASE a.mark WHEN 'P' THEN 1 WHEN 'H' THEN 0.5 ELSE 0 END) > 0
       ORDER BY e.name`, [from, to]);
    res.json(rows);
  } catch (e) { next(e); }
});

// Mandatory-training compliance: enrolment status per active employee.
// Batches with the same title are ONE training — any batch covers the
// employee — and department/division targeting scopes who is expected.
router.get('/compliance', async (req, res, next) => {
  try {
    const { rows: mand } = await query(
      `SELECT id, code, title, batch, status, department, division FROM trainings
       WHERE mandatory AND status NOT IN ('postponed','cancelled') ORDER BY id`);
    const { rows: emps } = await query(
      `SELECT id, name, entity, department, division FROM employees WHERE active ORDER BY name`);
    const { rows: parts } = await query('SELECT training_id, employee_id FROM training_participants');
    const inTraining = new Set(parts.map((p) => p.training_id + ':' + p.employee_id));
    const inList = (listStr, val) => !listStr ||
      listStr.split(',').map((s) => s.trim().toLowerCase()).includes(String(val || '').trim().toLowerCase());
    const groups = Object.values(mand.reduce((g, t) => {
      const k = t.title.trim().toLowerCase();
      (g[k] = g[k] || []).push(t);
      return g;
    }, {}));
    res.json({
      trainings: groups.map((grp) => ({
        id: grp[0].id, code: grp[0].code, title: grp[0].title,
        batch: grp.length > 1 ? `${grp.length} batches` : grp[0].batch,
        status: grp.every((t) => t.status === 'completed') ? 'completed' : grp[0].status,
      })),
      employees: emps.map((e) => ({
        id: e.id, name: e.name, entity: e.entity,
        status: groups.map((grp) => {
          const inScope = grp.some((t) => inList(t.department, e.department) && inList(t.division, e.division));
          if (!inScope) return 'na';
          const batch = grp.find((t) => inTraining.has(t.id + ':' + e.id));
          return batch ? (batch.status === 'completed' ? 'done' : 'booked') : 'due';
        }),
      })),
    });
  } catch (e) { next(e); }
});

// Training register: one row per training — details, dates, headcount and
// the participant name list.
router.get('/register', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT t.code, t.title, t.batch, t.category, t.mode, t.location, t.status,
              t.trainer_type, t.trainer_name, t.agency, t.hours_per_day,
              (SELECT json_agg(d.day ORDER BY d.day) FROM training_days d WHERE d.training_id=t.id) AS days,
              (SELECT count(*)::int FROM training_days d WHERE d.training_id=t.id) AS day_count,
              (SELECT count(*)::int FROM training_participants p WHERE p.training_id=t.id) AS participant_count,
              (SELECT string_agg(e.name, ', ' ORDER BY e.name)
                 FROM training_participants p JOIN employees e ON e.id=p.employee_id
                 WHERE p.training_id=t.id) AS participants
       FROM trainings t WHERE t.status <> 'cancelled'
       ORDER BY (SELECT min(d.day) FROM training_days d WHERE d.training_id=t.id) DESC NULLS LAST`);
    res.json(rows);
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
              round(avg(CASE WHEN v.value ~ '^\\s*[0-9]+(\\.[0-9]+)?\\s*$' THEN v.value::numeric END), 2) AS avg_score,
              (SELECT count(*)::int FROM training_participants p WHERE p.training_id=t.id) AS participant_count
       FROM trainings t
       LEFT JOIN feedback_responses r ON r.training_id = t.id
       LEFT JOIN LATERAL jsonb_each_text(r.scores) v ON TRUE
       WHERE t.status <> 'cancelled'
       GROUP BY t.id ORDER BY t.id`);
    res.json(rows);
  } catch (e) { next(e); }
});

// Compliance dataset: every mandatory training with per-participant status.
// Status progresses Assigned -> Nominated -> Attended -> Completed; a
// nomination alone NEVER counts as complete. "Leader" is derived as the
// reporting manager's own manager from the employee master.
router.get('/compliance-detail', async (req, res, next) => {
  try {
    if (req.user.role === 'manager') return res.status(403).json({ error: 'Insufficient permissions' });
    const [trns, parts, att, emps] = await Promise.all([
      query(`SELECT t.id, t.code, t.title, t.batch, t.status, t.nom_deadline, t.completion_deadline,
               (SELECT json_agg(d.day ORDER BY d.day) FROM training_days d WHERE d.training_id=t.id) AS days
             FROM trainings t WHERE t.mandatory AND t.status <> 'cancelled' ORDER BY t.id`),
      query(`SELECT p.training_id, p.added_at, e.id AS employee_id, e.name, e.zoho_emp_id, e.entity,
                    e.department, e.division, e.location, e.manager,
                    n.slot, n.source, n.nominated_by, n.created_at AS nominated_at
             FROM training_participants p
             JOIN employees e ON e.id = p.employee_id
             LEFT JOIN nominations n ON n.training_id = p.training_id AND n.employee_id = p.employee_id AND n.status='confirmed'
             ORDER BY e.name`),
      query(`SELECT training_id, employee_id,
               sum(CASE mark WHEN 'P' THEN 1 WHEN 'H' THEN 0.5 ELSE 0 END)::float AS units
             FROM attendance GROUP BY training_id, employee_id`),
      query(`SELECT name, manager FROM employees`),
    ]);
    const mgrOfName = {};
    emps.rows.forEach((e) => {
      mgrOfName[e.name.trim().toLowerCase()] = (e.manager || '').replace(/^Mentor:\s*/i, '').trim();
    });
    const attMap = {};
    att.rows.forEach((a) => { attMap[a.training_id + ':' + a.employee_id] = a.units; });
    const today = new Date().toISOString().slice(0, 10);
    const rows = [];
    for (const t of trns.rows) {
      const days = (t.days || []).map((d) => d.slice(0, 10));
      const over = t.status === 'completed' || (days.length && days[days.length - 1] < today);
      for (const p of parts.rows.filter((x) => x.training_id === t.id)) {
        const manager = (p.manager || '').replace(/^Mentor:\s*/i, '').trim();
        const units = attMap[t.id + ':' + p.employee_id] || 0;
        const attended = units > 0;
        const status = t.status === 'completed' && attended ? 'completed'
          : attended ? 'attended' : over ? 'not_attended' : 'pending';
        rows.push({
          training_id: t.id, code: t.code, title: t.title, batch: t.batch,
          training_date: days[0] || null, last_day: days[days.length - 1] || null,
          employee_id: p.employee_id, name: p.name, zoho_emp_id: p.zoho_emp_id,
          entity: p.entity, department: p.department, division: p.division, location: p.location,
          manager, leader: mgrOfName[manager.toLowerCase()] || '',
          slot: p.slot, source: p.source || 'admin', nominated_by: p.nominated_by,
          assigned_at: p.added_at || p.nominated_at || null,
          status,
        });
      }
    }
    res.json({ trainings: trns.rows, rows });
  } catch (e) { next(e); }
});

// Reports employees submitted for courses taken outside the hub.
router.get('/external-courses', async (req, res, next) => {
  try {
    if (req.user.role === 'manager' || req.user.role === 'learner') {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    const { rows } = await query(
      `SELECT x.*, e.name, e.zoho_emp_id, e.department, e.division, e.entity
       FROM external_courses x JOIN employees e ON e.id = x.employee_id
       ORDER BY x.id DESC`);
    res.json(rows);
  } catch (e) { next(e); }
});

// Everything an ISO 13485 auditor asks for, in one payload — the client
// turns it into a multi-sheet Excel evidence pack. Admin only.
router.get('/evidence', async (req, res, next) => {
  try {
    if (req.user.role === 'manager') return res.status(403).json({ error: 'Insufficient permissions' });
    // Optional from/to: trainings with a day in the range (and their
    // participants, attendance in range, feedback and expenses), plus audit
    // entries made in the range. Without dates: everything, as before.
    const { from, to } = dateRange(req.query);
    const inRange = `EXISTS (SELECT 1 FROM training_days d WHERE d.training_id=t.id AND d.day BETWEEN $1::date AND $2::date)`;
    const [trainings, participants, attendance, feedback, expensesR, auditR] = await Promise.all([
      query(`SELECT t.code, t.title, t.batch, t.category, t.mode, t.trainer_type, t.trainer_name, t.agency,
                    t.hours_per_day, t.seats, t.mandatory, t.status, t.validity_months,
                    (SELECT string_agg(d.day::text, ', ' ORDER BY d.day) FROM training_days d WHERE d.training_id=t.id) AS days
             FROM trainings t WHERE ${inRange} ORDER BY t.id`, [from, to]),
      query(`SELECT t.code, t.title, e.name, e.zoho_emp_id, e.entity, e.division, e.department
             FROM training_participants p JOIN trainings t ON t.id=p.training_id JOIN employees e ON e.id=p.employee_id
             WHERE ${inRange} ORDER BY t.id, e.name`, [from, to]),
      query(`SELECT t.code, e.name, a.day, a.mark, a.updated_at,
                    coalesce(u.name, 'QR self check-in') AS marked_by
             FROM attendance a JOIN trainings t ON t.id=a.training_id JOIN employees e ON e.id=a.employee_id
             LEFT JOIN users u ON u.id=a.marked_by
             WHERE a.day BETWEEN $1::date AND $2::date ORDER BY t.id, a.day, e.name`, [from, to]),
      query(`SELECT t.code, r.respondent, r.scores, r.comment, r.created_at
             FROM feedback_responses r JOIN trainings t ON t.id=r.training_id
             WHERE ${inRange} ORDER BY t.id, r.created_at`, [from, to]),
      query(`SELECT x.training_label, x.dates, x.category, x.training_type, x.vendor, x.budget, x.actual, x.approval, x.remark
             FROM expenses x LEFT JOIN trainings t ON t.id = x.training_id
             WHERE x.active AND (CASE WHEN t.id IS NOT NULL THEN ${inRange}
                                     ELSE x.created_at::date BETWEEN $1::date AND $2::date END)
             ORDER BY x.id`, [from, to]),
      query(`SELECT a.created_at, coalesce(u.name,'system/QR') AS who, a.action, a.record_type, a.record_id, a.reason
             FROM audit_log a LEFT JOIN users u ON u.id=a.user_id
             WHERE (a.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1::date AND $2::date
             ORDER BY a.id DESC LIMIT 5000`, [from, to]),
    ]);
    res.json({
      trainings: trainings.rows, participants: participants.rows, attendance: attendance.rows,
      feedback: feedback.rows, expenses: expensesR.rows, audit: auditR.rows,
    });
  } catch (e) { next(e); }
});

module.exports = router;
