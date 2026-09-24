const express = require('express');
const { query } = require('../db');
const { requireRole, audit } = require('../auth');

const router = express.Router();
const ROLES = ['super_admin', 'admin', 'manager'];
const ENTITIES = ['AMD', 'ASS', 'ATS'];

// All user-management routes need admin; writes that touch super_admins need super_admin.
router.use(requireRole('admin'));

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT id, email, name, role, entity, active, last_login_at, created_at FROM users ORDER BY name');
    res.json(rows);
  } catch (e) { next(e); }
});

router.post('/', express.json(), async (req, res, next) => {
  try {
    const { email, name, role, entity } = req.body || {};
    const em = String(email || '').toLowerCase().trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return res.status(400).json({ error: 'Valid e-mail required' });
    if (!name || !ROLES.includes(role) || !ENTITIES.includes(entity)) {
      return res.status(400).json({ error: 'name, role and entity are required' });
    }
    if (role === 'super_admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Only a super admin can create super admins' });
    }
    const { rows } = await query(
      `INSERT INTO users (email, name, role, entity) VALUES ($1,$2,$3,$4)
       ON CONFLICT (email) DO NOTHING RETURNING *`,
      [em, String(name).trim(), role, entity]);
    if (!rows.length) return res.status(409).json({ error: 'A user with this e-mail already exists' });
    await audit(req.user.id, 'user.create', 'user', rows[0].id, { email: em, role, entity });
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

router.patch('/:id', express.json(), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows: cur } = await query('SELECT * FROM users WHERE id=$1', [id]);
    if (!cur.length) return res.status(404).json({ error: 'Not found' });
    const target = cur[0];
    // Admins cannot modify super admins; nobody deactivates themselves.
    if (target.role === 'super_admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Only a super admin can modify super admins' });
    }
    const { name, role, entity, active, reason } = req.body || {};
    if (role !== undefined && !ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
    if (role === 'super_admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Only a super admin can grant super admin' });
    }
    if (entity !== undefined && !ENTITIES.includes(entity)) return res.status(400).json({ error: 'Invalid entity' });
    if (active === false && target.id === req.user.id) {
      return res.status(400).json({ error: 'You cannot deactivate your own account' });
    }
    const { rows } = await query(
      `UPDATE users SET
         name   = COALESCE($2, name),
         role   = COALESCE($3, role),
         entity = COALESCE($4, entity),
         active = COALESCE($5, active),
         updated_at = now()
       WHERE id=$1 RETURNING *`,
      [id, name ?? null, role ?? null, entity ?? null, active ?? null]);
    // Revoking access kills the person's live sessions immediately.
    if (active === false) await query('DELETE FROM sessions WHERE user_id=$1', [id]);
    await audit(req.user.id, 'user.update', 'user', id,
      { changes: { name, role, entity, active } }, reason);
    res.json(rows[0]);
  } catch (e) { next(e); }
});

module.exports = router;
