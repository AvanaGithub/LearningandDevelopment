const express = require('express');
const { query } = require('../db');
const { requireRole, audit } = require('../auth');

const router = express.Router();
const STATUSES = ['planned', 'confirmed', 'in_progress', 'completed', 'postponed', 'cancelled'];

const listSelect = `
  SELECT t.*,
    (SELECT json_agg(d.day ORDER BY d.day) FROM training_days d WHERE d.training_id = t.id) AS days,
    (SELECT count(*)::int FROM training_participants p WHERE p.training_id = t.id) AS participant_count,
    (SELECT count(*)::int FROM feedback_responses f WHERE f.training_id = t.id) AS response_count
  FROM trainings t`;

// Any signed-in role can view trainings and the calendar.
router.get('/', async (req, res, next) => {
  try {
    const { q, status, from, to, employee_id } = req.query;
    const cond = [];
    const params = [];
    if (q) {
      params.push('%' + String(q).toLowerCase() + '%');
      cond.push(`(lower(t.title) LIKE $${params.length} OR lower(t.code) LIKE $${params.length} OR lower(coalesce(t.batch,'')) LIKE $${params.length})`);
    }
    if (status && STATUSES.includes(status)) {
      params.push(status);
      cond.push(`t.status = $${params.length}`);
    }
    if (from && to) {
      params.push(from, to);
      cond.push(`EXISTS (SELECT 1 FROM training_days d WHERE d.training_id = t.id AND d.day BETWEEN $${params.length - 1} AND $${params.length})`);
    }
    if (employee_id) {
      params.push(Number(employee_id));
      cond.push(`EXISTS (SELECT 1 FROM training_participants p WHERE p.training_id = t.id AND p.employee_id = $${params.length})`);
    }
    const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
    const { rows } = await query(`${listSelect} ${where} ORDER BY t.id DESC LIMIT 500`, params);
    // The QR token is an admin credential — managers browse without it.
    if (req.user.role === 'manager') rows.forEach((r) => delete r.public_token);
    res.json(rows);
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await query(`${listSelect} WHERE t.id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const { rows: parts } = await query(
      `SELECT e.id, e.name, e.zoho_emp_id, e.entity, e.division, e.department
       FROM training_participants p JOIN employees e ON e.id = p.employee_id
       WHERE p.training_id = $1 ORDER BY e.name`, [id]);
    if (req.user.role === 'manager') delete rows[0].public_token;
    res.json({ ...rows[0], participants: parts });
  } catch (e) { next(e); }
});

const pickFields = (b) => ({
  title: b.title?.trim(),
  batch: b.batch?.trim() || null,
  category: b.category?.trim() || null,
  mode: b.mode?.trim() || null,
  trainer_type: b.trainer_type === 'external' ? 'external' : 'internal',
  trainer_name: b.trainer_name?.trim() || null,
  agency: b.agency?.trim() || null,
  hours_per_day: Number(b.hours_per_day) > 0 ? Number(b.hours_per_day) : 8,
  seats: Number(b.seats) > 0 ? Math.floor(Number(b.seats)) : 20,
  mandatory: Boolean(b.mandatory),
  status: STATUSES.includes(b.status) ? b.status : 'planned',
});

const validDays = (days) =>
  Array.isArray(days) && days.length >= 1 && days.length <= 60 &&
  days.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));

router.post('/', requireRole('admin'), express.json(), async (req, res, next) => {
  try {
    const f = pickFields(req.body || {});
    const days = [...new Set(req.body.days || [])].sort();
    if (!f.title) return res.status(400).json({ error: 'Title is required' });
    if (!validDays(days)) return res.status(400).json({ error: 'Pick between 1 and 60 training dates' });
    if (f.trainer_type === 'external' && !f.agency) return res.status(400).json({ error: 'External agency name is required' });
    if (f.trainer_type === 'internal' && !f.trainer_name) return res.status(400).json({ error: 'Trainer name is required' });
    const { rows: code } = await query(`SELECT 'TRG-' || nextval('training_code_seq') AS code`);
    const token = require('crypto').randomBytes(12).toString('hex');
    const { rows } = await query(
      `INSERT INTO trainings (code, title, batch, category, mode, trainer_type, trainer_name, agency,
         hours_per_day, seats, mandatory, status, created_by, public_token)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [code[0].code, f.title, f.batch, f.category, f.mode, f.trainer_type, f.trainer_name, f.agency,
       f.hours_per_day, f.seats, f.mandatory, f.status, req.user.id, token]);
    for (const d of days) await query('INSERT INTO training_days (training_id, day) VALUES ($1,$2)', [rows[0].id, d]);
    await audit(req.user.id, 'training.create', 'training', rows[0].id, { code: code[0].code, title: f.title, days });
    res.status(201).json({ ...rows[0], days });
  } catch (e) { next(e); }
});

router.patch('/:id', requireRole('admin'), express.json(), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows: cur } = await query('SELECT * FROM trainings WHERE id=$1', [id]);
    if (!cur.length) return res.status(404).json({ error: 'Not found' });
    const b = req.body || {};
    const f = pickFields({ ...cur[0], ...b });
    if (!f.title) return res.status(400).json({ error: 'Title is required' });
    const { rows } = await query(
      `UPDATE trainings SET title=$2, batch=$3, category=$4, mode=$5, trainer_type=$6, trainer_name=$7,
         agency=$8, hours_per_day=$9, seats=$10, mandatory=$11, status=$12, updated_at=now()
       WHERE id=$1 RETURNING *`,
      [id, f.title, f.batch, f.category, f.mode, f.trainer_type, f.trainer_name, f.agency,
       f.hours_per_day, f.seats, f.mandatory, f.status]);
    if (b.days !== undefined) {
      const days = [...new Set(b.days)].sort();
      if (!validDays(days)) return res.status(400).json({ error: 'Pick between 1 and 60 training dates' });
      await query('DELETE FROM training_days WHERE training_id=$1 AND day <> ALL($2::date[])', [id, days]);
      await query('DELETE FROM attendance WHERE training_id=$1 AND day <> ALL($2::date[])', [id, days]);
      for (const d of days) {
        await query('INSERT INTO training_days (training_id, day) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, d]);
      }
    }
    await audit(req.user.id, 'training.update', 'training', id, { changes: b }, b.reason);
    res.json(rows[0]);
  } catch (e) { next(e); }
});

router.post('/:id/participants', requireRole('admin'), express.json(), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const employeeId = Number(req.body?.employee_id);
    const { rows: t } = await query('SELECT seats FROM trainings WHERE id=$1', [id]);
    if (!t.length) return res.status(404).json({ error: 'Not found' });
    const { rows: n } = await query('SELECT count(*)::int AS n FROM training_participants WHERE training_id=$1', [id]);
    if (n[0].n >= t[0].seats) return res.status(409).json({ error: `Batch is full (${t[0].seats} seats)` });
    await query(
      'INSERT INTO training_participants (training_id, employee_id, added_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [id, employeeId, req.user.id]);
    await audit(req.user.id, 'training.participant_add', 'training', id, { employee_id: employeeId });
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});

router.delete('/:id/participants/:empId', requireRole('admin'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const empId = Number(req.params.empId);
    const reason = String(req.query.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'A reason is required to remove a participant' });
    await query('DELETE FROM training_participants WHERE training_id=$1 AND employee_id=$2', [id, empId]);
    await query('DELETE FROM attendance WHERE training_id=$1 AND employee_id=$2', [id, empId]);
    await audit(req.user.id, 'training.participant_remove', 'training', id, { employee_id: empId }, reason);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
