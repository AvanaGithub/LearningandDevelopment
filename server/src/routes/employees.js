const express = require('express');
const { query } = require('../db');
const { requireRole, audit } = require('../auth');

const router = express.Router();
const ENTITIES = ['AMD', 'ASS', 'ATS'];

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
    const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
    const { rows } = await query(
      `SELECT * FROM employees ${where} ORDER BY name LIMIT 500`, params);
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
  location: b.location?.trim() || null,
  date_joined: b.date_joined || null,
});

router.post('/', requireRole('admin'), express.json(), async (req, res, next) => {
  try {
    const f = pickFields(req.body || {});
    if (!f.name || !ENTITIES.includes(f.entity)) {
      return res.status(400).json({ error: 'name and entity (AMD/ASS/ATS) are required' });
    }
    const { rows } = await query(
      `INSERT INTO employees (zoho_emp_id, name, email, entity, division, department, designation, location, date_joined)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [f.zoho_emp_id, f.name, f.email, f.entity, f.division, f.department, f.designation, f.location, f.date_joined]);
    await audit(req.user.id, 'employee.create', 'employee', rows[0].id, { name: f.name, entity: f.entity });
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
    const active = b.active === undefined ? cur[0].active : Boolean(b.active);
    const { rows } = await query(
      `UPDATE employees SET zoho_emp_id=$2, name=$3, email=$4, entity=$5, division=$6,
         department=$7, designation=$8, location=$9, date_joined=$10, active=$11, updated_at=now()
       WHERE id=$1 RETURNING *`,
      [id, f.zoho_emp_id, f.name, f.email, f.entity, f.division, f.department, f.designation, f.location, f.date_joined, active]);
    await audit(req.user.id, 'employee.update', 'employee', id, { changes: b }, b.reason);
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'An employee with this e-mail already exists' });
    next(e);
  }
});

module.exports = router;
