const express = require('express');
const { query } = require('../db');
const { requireRole, audit } = require('../auth');

const router = express.Router();
const ENTITIES = ['AMD', 'ASS', 'ATS'];

const FIELD_LABELS = {
  zoho_emp_id: 'Zoho employee ID', email: 'Official e-mail', mobile: 'Mobile',
  division: 'Division', department: 'Department', designation: 'Designation',
  manager: 'Reporting manager', date_joined: 'Date of joining', location: 'Location',
  employment_type: 'Employment type',
};

// Employees and Users & Access stay in sync: a new/updated employee with an
// e-mail gets a learner login automatically; deactivating the employee
// disables the login (sessions revoked); reactivating restores it.
// Super admin logins are never touched automatically.
async function syncUserForEmployee(emp, becameInactive, becameActive, actorId) {
  try {
    if (!emp.email) return;
    const email = String(emp.email).toLowerCase();
    if (becameInactive) {
      const { rows } = await query(
        `UPDATE users SET active=FALSE, updated_at=now()
         WHERE email=$1 AND role <> 'super_admin' AND active RETURNING id`, [email]);
      for (const u of rows) await query('DELETE FROM sessions WHERE user_id=$1', [u.id]);
      if (rows.length) await audit(actorId, 'user.auto_disable', 'user', rows[0].id, { email, reason: 'employee deactivated' });
      return;
    }
    if (becameActive) {
      const { rows } = await query(
        `UPDATE users SET active=TRUE, updated_at=now()
         WHERE email=$1 AND NOT active RETURNING id`, [email]);
      if (rows.length) {
        await audit(actorId, 'user.auto_enable', 'user', rows[0].id, { email, reason: 'employee reactivated' });
        return;
      }
    }
    if (emp.active === false) return;
    const { rows: created } = await query(
      `INSERT INTO users (email, name, role, entity)
       VALUES ($1,$2,'learner',$3) ON CONFLICT (email) DO NOTHING RETURNING id`,
      [email, emp.name, emp.entity]);
    if (created.length) await audit(actorId, 'user.auto_learner', 'user', created[0].id, { email, name: emp.name });
  } catch (e) { console.error('[user-sync]', e.message); }
}

// The Settings screen decides which optional fields are mandatory — enforced
// here so the rule holds regardless of client.
async function missingRequired(f) {
  const { rows } = await query(`SELECT value FROM settings WHERE key='required_employee_fields'`);
  const req = rows.length ? rows[0].value : [];
  return req.filter((k) => FIELD_LABELS[k] && !f[k]).map((k) => FIELD_LABELS[k]);
}

// Any signed-in role can view; adding/editing needs admin.
router.get('/', async (req, res, next) => {
  try {
    const { q, entity, active } = req.query;
    const cond = [];
    const params = [];
    if (q) {
      params.push('%' + String(q).toLowerCase() + '%');
      cond.push(`(lower(name) LIKE $${params.length} OR lower(coalesce(email,'')) LIKE $${params.length} OR lower(coalesce(zoho_emp_id,'')) LIKE $${params.length})`);
    }
    if (entity && ENTITIES.includes(entity)) {
      params.push(entity);
      cond.push(`entity = $${params.length}`);
    }
    if (active === 'true' || active === 'false') {
      params.push(active === 'true');
      cond.push(`active = $${params.length}`);
    }
    // Managers see only their own reportees (matched on the "Reporting
    // manager" field, "Mentor:" prefix ignored); leaders and above see all.
    if (req.user.role === 'manager') {
      params.push(String(req.user.name || '').trim().toLowerCase());
      cond.push(`lower(btrim(regexp_replace(coalesce(manager,''), '^mentor:\\s*', '', 'i'))) = $${params.length}`);
    }
    const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
    const { rows } = await query(
      `SELECT e.*,
         coalesce((SELECT round(sum(t.hours_per_day * CASE a.mark WHEN 'P' THEN 1 WHEN 'H' THEN 0.5 ELSE 0 END)::numeric, 1)
                   FROM attendance a JOIN trainings t ON t.id = a.training_id
                   WHERE a.employee_id = e.id), 0) AS hours_fy
       FROM employees e ${where} ORDER BY name LIMIT 500`, params);
    res.json(rows);
  } catch (e) { next(e); }
});

const pickFields = (b) => ({
  zoho_emp_id: b.zoho_emp_id?.trim() || null,
  name: b.name?.trim(),
  email: b.email ? String(b.email).toLowerCase().trim() : null,
  entity: b.entity,
  division: b.division?.trim() || null,
  department: b.department?.trim() || null,
  designation: b.designation?.trim() || null,
  manager: b.manager?.trim() || null,
  employment_type: b.employment_type?.trim() || null,
  mobile: b.mobile?.trim() || null,
  location: b.location?.trim() || null,
  date_joined: b.date_joined || null,
});

router.post('/', requireRole('admin'), express.json(), async (req, res, next) => {
  try {
    const f = pickFields(req.body || {});
    if (!f.name || !ENTITIES.includes(f.entity)) {
      return res.status(400).json({ error: 'name and entity (AMD/ASS/ATS) are required' });
    }
    const missing = await missingRequired(f);
    if (missing.length) return res.status(400).json({ error: 'Mandatory field(s) missing: ' + missing.join(', ') });
    const { rows } = await query(
      `INSERT INTO employees (zoho_emp_id, name, email, entity, division, department, designation, manager, employment_type, mobile, location, date_joined)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [f.zoho_emp_id, f.name, f.email, f.entity, f.division, f.department, f.designation, f.manager, f.employment_type, f.mobile, f.location, f.date_joined]);
    await audit(req.user.id, 'employee.create', 'employee', rows[0].id, { name: f.name, entity: f.entity });
    await syncUserForEmployee(rows[0], false, false, req.user.id);
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'An employee with this e-mail already exists' });
    next(e);
  }
});

router.patch('/:id', requireRole('admin'), express.json(), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows: cur } = await query('SELECT * FROM employees WHERE id=$1', [id]);
    if (!cur.length) return res.status(404).json({ error: 'Not found' });
    const b = req.body || {};
    if (b.entity !== undefined && !ENTITIES.includes(b.entity)) return res.status(400).json({ error: 'Invalid entity' });
    const f = { ...cur[0], ...pickFields({ ...cur[0], ...b }) };
    const missing = await missingRequired(f);
    if (missing.length) return res.status(400).json({ error: 'Mandatory field(s) missing: ' + missing.join(', ') });
    const active = b.active === undefined ? cur[0].active : Boolean(b.active);
    const { rows } = await query(
      `UPDATE employees SET zoho_emp_id=$2, name=$3, email=$4, entity=$5, division=$6,
         department=$7, designation=$8, manager=$9, employment_type=$10, mobile=$11,
         location=$12, date_joined=$13, active=$14, updated_at=now()
       WHERE id=$1 RETURNING *`,
      [id, f.zoho_emp_id, f.name, f.email, f.entity, f.division, f.department, f.designation,
       f.manager, f.employment_type, f.mobile, f.location, f.date_joined, active]);
    await audit(req.user.id, 'employee.update', 'employee', id, { changes: b }, b.reason);
    await syncUserForEmployee(rows[0], cur[0].active && !active, !cur[0].active && active, req.user.id);
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'An employee with this e-mail already exists' });
    next(e);
  }
});

// Hard delete is allowed ONLY for a record with no history (a mistaken
// entry): no training participation, attendance, batch membership or
// feedback. Anything with history must be deactivated instead (ISO 13485).
router.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const reason = String(req.query.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'A reason is required to delete a record' });
    const { rows: hist } = await query(
      `SELECT (SELECT count(*) FROM training_participants WHERE employee_id=$1)
            + (SELECT count(*) FROM attendance WHERE employee_id=$1)
            + (SELECT count(*) FROM mav_members WHERE employee_id=$1) AS n`, [id]);
    if (Number(hist[0].n) > 0) {
      return res.status(409).json({ error: 'This employee has training history — deactivate instead of deleting (ISO 13485).' });
    }
    const { rows } = await query('DELETE FROM employees WHERE id=$1 RETURNING name', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    await audit(req.user.id, 'employee.delete', 'employee', id, { name: rows[0].name }, reason);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
