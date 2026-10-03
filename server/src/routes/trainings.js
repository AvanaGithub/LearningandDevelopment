const express = require('express');
const { query } = require('../db');
const { requireRole, audit } = require('../auth');

const router = express.Router();
const STATUSES = ['planned', 'confirmed', 'in_progress', 'completed', 'postponed', 'cancelled'];

const listSelect = `
  SELECT t.*,
    (SELECT json_agg(d.day ORDER BY d.day) FROM training_days d WHERE d.training_id = t.id) AS days,
    (SELECT count(*)::int FROM training_participants p WHERE p.training_id = t.id) AS participant_count,
    (SELECT count(*)::int FROM feedback_responses f WHERE f.training_id = t.id) AS response_count,
    (SELECT count(DISTINCT a.employee_id)::int FROM attendance a WHERE a.training_id = t.id AND a.mark IN ('P','H')) AS attended_count,
    (SELECT count(*)::int FROM attendance a WHERE a.training_id = t.id) AS marked_count
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
      `SELECT e.id, e.name, e.zoho_emp_id, e.entity, e.division, e.department, e.email, p.comment,
              n.slot AS nom_slot, n.source AS nom_source, n.nominated_by
       FROM training_participants p JOIN employees e ON e.id = p.employee_id
       LEFT JOIN nominations n ON n.training_id = p.training_id AND n.employee_id = p.employee_id AND n.status='confirmed'
       WHERE p.training_id = $1 ORDER BY e.name`, [id]);
    if (req.user.role === 'manager') delete rows[0].public_token;
    res.json({ ...rows[0], participants: parts });
  } catch (e) { next(e); }
});

const pickFields = (b) => ({
  title: b.title?.trim(),
  batch: b.batch?.trim() || null,
  category: b.category?.trim() || null,
  // Accepts one department, several (array -> comma-separated), or none.
  department: Array.isArray(b.department)
    ? (b.department.map((d) => String(d).trim()).filter(Boolean).join(', ') || null)
    : (b.department?.trim() || null),
  division: Array.isArray(b.division)
    ? (b.division.map((d) => String(d).trim()).filter(Boolean).join(', ') || null)
    : (b.division?.trim() || null),
  mode: b.mode?.trim() || null,
  trainer_type: b.trainer_type === 'external' ? 'external' : 'internal',
  trainer_name: b.trainer_name?.trim() || null,
  agency: b.agency?.trim() || null,
  hours_per_day: Number(b.hours_per_day) > 0 ? Number(b.hours_per_day) : 8,
  seats: Number(b.seats) > 0 ? Math.floor(Number(b.seats)) : 20,
  mandatory: Boolean(b.mandatory),
  status: STATUSES.includes(b.status) ? b.status : 'planned',
  validity_months: Number(b.validity_months) > 0 ? Math.floor(Number(b.validity_months)) : null,
  agenda_file: b.agenda_file || null,
});

// Nomination settings are controlled completely by the super admin;
// anyone else's edits keep the current values.
const nomFields = (b, cur, role) => (role === 'super_admin' ? {
  nom_self: b.nom_self !== undefined ? Boolean(b.nom_self) : cur.nom_self || false,
  nom_manager: b.nom_manager !== undefined ? Boolean(b.nom_manager) : cur.nom_manager || false,
  nom_leader: b.nom_leader !== undefined ? Boolean(b.nom_leader) : cur.nom_leader || false,
  nom_deadline: b.nom_deadline !== undefined ? (b.nom_deadline || null) : cur.nom_deadline || null,
  completion_deadline: b.completion_deadline !== undefined ? (b.completion_deadline || null) : cur.completion_deadline || null,
} : {
  nom_self: cur.nom_self || false, nom_manager: cur.nom_manager || false, nom_leader: cur.nom_leader || false,
  nom_deadline: cur.nom_deadline || null, completion_deadline: cur.completion_deadline || null,
});

const validDays = (days) =>
  Array.isArray(days) && days.length >= 1 && days.length <= 60 &&
  days.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));

router.post('/', requireRole('admin'), express.json(), async (req, res, next) => {
  try {
    const f = pickFields(req.body || {});
    const nf = nomFields(req.body || {}, {}, req.user.role);
    const days = [...new Set(req.body.days || [])].sort();
    if (!f.title) return res.status(400).json({ error: 'Title is required' });
    if (!validDays(days)) return res.status(400).json({ error: 'Pick between 1 and 60 training dates' });
    if (f.trainer_type === 'external' && !f.agency) return res.status(400).json({ error: 'External agency name is required' });
    if (f.trainer_type === 'internal' && !f.trainer_name) return res.status(400).json({ error: 'Trainer name is required' });
    const { rows: code } = await query(`SELECT 'TRG-' || nextval('training_code_seq') AS code`);
    const token = require('crypto').randomBytes(12).toString('hex');
    const { rows } = await query(
      `INSERT INTO trainings (code, title, batch, category, department, division, mode, trainer_type, trainer_name, agency,
         hours_per_day, seats, mandatory, status, created_by, public_token, validity_months, agenda_file,
         nom_self, nom_manager, nom_leader, nom_deadline, completion_deadline)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) RETURNING *`,
      [code[0].code, f.title, f.batch, f.category, f.department, f.division, f.mode, f.trainer_type, f.trainer_name, f.agency,
       f.hours_per_day, f.seats, f.mandatory, f.status, req.user.id, token, f.validity_months, f.agenda_file,
       nf.nom_self, nf.nom_manager, nf.nom_leader, nf.nom_deadline, nf.completion_deadline]);
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
    const nf = nomFields(b, cur[0], req.user.role);
    if (!f.title) return res.status(400).json({ error: 'Title is required' });
    const { rows } = await query(
      `UPDATE trainings SET title=$2, batch=$3, category=$4, department=$5, division=$6, mode=$7,
         trainer_type=$8, trainer_name=$9, agency=$10, hours_per_day=$11, seats=$12, mandatory=$13,
         status=$14, validity_months=$15, agenda_file=$16,
         nom_self=$17, nom_manager=$18, nom_leader=$19, nom_deadline=$20, completion_deadline=$21,
         updated_at=now()
       WHERE id=$1 RETURNING *`,
      [id, f.title, f.batch, f.category, f.department, f.division, f.mode, f.trainer_type, f.trainer_name,
       f.agency, f.hours_per_day, f.seats, f.mandatory, f.status, f.validity_months, f.agenda_file,
       nf.nom_self, nf.nom_manager, nf.nom_leader, nf.nom_deadline, nf.completion_deadline]);
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
    // Seats are informational only — org-wide trainings may exceed them.
    const { rows: t } = await query('SELECT seats FROM trainings WHERE id=$1', [id]);
    if (!t.length) return res.status(404).json({ error: 'Not found' });
    await query(
      'INSERT INTO training_participants (training_id, employee_id, added_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [id, employeeId, req.user.id]);
    await query(
      `INSERT INTO nominations (training_id, employee_id, source, nominated_by)
       VALUES ($1,$2,'admin',$3)
       ON CONFLICT (training_id, employee_id) DO UPDATE
         SET status='confirmed', source=EXCLUDED.source, nominated_by=EXCLUDED.nominated_by, created_at=now()
         WHERE nominations.status='cancelled'`,
      [id, employeeId, req.user.name]);
    await audit(req.user.id, 'training.participant_add', 'training', id, { employee_id: employeeId });
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});

// Organizer's note on one participant (late, not attentive, …). Audited.
router.patch('/:id/participants/:empId', requireRole('admin'), express.json(), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const empId = Number(req.params.empId);
    const comment = req.body?.comment !== undefined ? (String(req.body.comment).trim().slice(0, 500) || null) : undefined;
    if (comment === undefined) return res.status(400).json({ error: 'comment is required' });
    const { rowCount } = await query(
      'UPDATE training_participants SET comment=$3 WHERE training_id=$1 AND employee_id=$2',
      [id, empId, comment]);
    if (!rowCount) return res.status(404).json({ error: 'Not a participant of this training' });
    await audit(req.user.id, 'training.participant_comment', 'training', id, { employee_id: empId, comment });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Nomination by a manager or leader (when the training allows it), or a
// direct admin assignment. Managers/leaders can only nominate their own
// reportees — enforced here against the Reporting manager field.
router.post('/:id/nominate', express.json(), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows: tr } = await query('SELECT * FROM trainings WHERE id=$1', [id]);
    if (!tr.length) return res.status(404).json({ error: 'Not found' });
    const t = tr[0];
    const role = req.user.role;
    const source = role === 'manager' ? 'manager' : role === 'leader' ? 'leader'
      : (role === 'admin' || role === 'super_admin') ? 'admin' : null;
    if (!source) return res.status(403).json({ error: 'Insufficient permissions' });
    if (source === 'manager' && !t.nom_manager) {
      return res.status(403).json({ error: 'Manager nomination is not enabled for this training' });
    }
    if (source === 'leader' && !t.nom_leader) {
      return res.status(403).json({ error: 'Leader nomination is not enabled for this training' });
    }
    if (source !== 'admin' && t.nom_deadline && new Date(t.nom_deadline) < new Date(new Date().toDateString())) {
      return res.status(400).json({ error: 'The nomination deadline for this training has passed' });
    }
    const ids = [...new Set((req.body?.employee_ids || []).map(Number).filter(Boolean))];
    if (!ids.length || ids.length > 500) return res.status(400).json({ error: 'Pick at least one employee' });
    let allowed = ids;
    if (source !== 'admin') {
      const { rows: mine } = await query(
        `SELECT id FROM employees WHERE id = ANY($1::int[]) AND active
           AND lower(btrim(regexp_replace(coalesce(manager,''), '^mentor:\\s*', '', 'i'))) = $2`,
        [ids, String(req.user.name || '').trim().toLowerCase()]);
      allowed = mine.map((r) => r.id);
    }
    const slot = String(req.body?.slot || '').trim().slice(0, 80) || null;
    let added = 0;
    for (const empId of allowed) {
      const r = await query(
        'INSERT INTO training_participants (training_id, employee_id, added_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [id, empId, req.user.id]);
      await query(
        `INSERT INTO nominations (training_id, employee_id, slot, source, nominated_by)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (training_id, employee_id) DO UPDATE
           SET status='confirmed', slot=EXCLUDED.slot, source=EXCLUDED.source,
               nominated_by=EXCLUDED.nominated_by, created_at=now()
           WHERE nominations.status='cancelled'`,
        [id, empId, slot, source, req.user.name]);
      if (r.rowCount) added++;
    }
    await audit(req.user.id, 'training.nominate', 'training', id,
      { source, slot, employee_ids: allowed, not_reportees: ids.length - allowed.length });
    res.status(201).json({ added, already: allowed.length - added, not_reportees: ids.length - allowed.length });
  } catch (e) { next(e); }
});

router.delete('/:id/participants/:empId', requireRole('admin'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const empId = Number(req.params.empId);
    const reason = String(req.query.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'A reason is required to remove a participant' });
    await query('DELETE FROM training_participants WHERE training_id=$1 AND employee_id=$2', [id, empId]);
    await query(`UPDATE nominations SET status='cancelled' WHERE training_id=$1 AND employee_id=$2`, [id, empId]);
    await query('DELETE FROM attendance WHERE training_id=$1 AND employee_id=$2', [id, empId]);
    await audit(req.user.id, 'training.participant_remove', 'training', id, { employee_id: empId }, reason);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Hard delete for test entries and wrong records only: a roster alone does
// not block it (nothing was conducted), but any REAL record — attendance,
// feedback or an expense sheet — does, and those must be cancelled instead.
router.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const reason = String(req.query.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'A reason is required to delete a training' });
    const { rows: hist } = await query(
      `SELECT (SELECT count(*) FROM attendance WHERE training_id=$1)::int AS att,
              (SELECT count(*) FROM feedback_responses WHERE training_id=$1)::int AS fb,
              (SELECT count(*) FROM expenses WHERE training_id=$1)::int AS exp,
              (SELECT count(*) FROM training_participants WHERE training_id=$1)::int AS parts`, [id]);
    const h = hist[0];
    if (h.att + h.fb + h.exp > 0) {
      const what = [h.att && `${h.att} attendance mark(s)`, h.fb && `${h.fb} feedback response(s)`,
        h.exp && `${h.exp} expense sheet(s)`].filter(Boolean).join(', ');
      return res.status(409).json({ error: `This training has real records (${what}) — set its status to Cancelled instead (ISO 13485).` });
    }
    await query('DELETE FROM training_participants WHERE training_id=$1', [id]);
    const { rows } = await query('DELETE FROM trainings WHERE id=$1 RETURNING code, title', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    await audit(req.user.id, 'training.delete', 'training', id, { ...rows[0], participants_removed: h.parts }, reason);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
