const express = require('express');
const { query } = require('../db');
const { requireRole, audit } = require('../auth');

// MedTech Mavericks trainee batches: members with status/comments, separate
// classroom and field attendance, and per-division assessments with scores.
const router = express.Router();
const MEMBER_STATUS = ['in_training', 'completed', 'dropped', 'extended'];
const BATCH_STATUS = ['active', 'completed', 'closed'];

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT b.*, (SELECT count(*)::int FROM mav_members m WHERE m.batch_id=b.id) AS member_count
       FROM mav_batches b WHERE b.active ORDER BY b.id DESC`);
    res.json(rows);
  } catch (e) { next(e); }
});

router.post('/', requireRole('admin'), express.json(), async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.name?.trim()) return res.status(400).json({ error: 'Batch name is required' });
    const { rows } = await query(
      'INSERT INTO mav_batches (name, mentor, start_date, notes) VALUES ($1,$2,$3,$4) RETURNING *',
      [b.name.trim(), b.mentor?.trim() || null, b.start_date || null, b.notes?.trim() || null]);
    await audit(req.user.id, 'mav.batch_create', 'mav_batch', rows[0].id, { name: b.name });
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

router.patch('/:id', requireRole('admin'), express.json(), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows: cur } = await query('SELECT * FROM mav_batches WHERE id=$1', [id]);
    if (!cur.length) return res.status(404).json({ error: 'Not found' });
    const b = req.body || {};
    if (b.active === false) {
      const reason = String(b.reason || '').trim();
      if (!reason) return res.status(400).json({ error: 'A reason is required to close a batch' });
      await query('UPDATE mav_batches SET active=FALSE WHERE id=$1', [id]);
      await audit(req.user.id, 'mav.batch_close', 'mav_batch', id, null, reason);
      return res.json({ ok: true });
    }
    const f = {
      name: (b.name ?? cur[0].name)?.trim(),
      mentor: b.mentor !== undefined ? (b.mentor?.trim() || null) : cur[0].mentor,
      start_date: b.start_date !== undefined ? (b.start_date || null) : cur[0].start_date,
      status: BATCH_STATUS.includes(b.status) ? b.status : cur[0].status,
      notes: b.notes !== undefined ? (b.notes?.trim() || null) : cur[0].notes,
    };
    const { rows } = await query(
      'UPDATE mav_batches SET name=$2, mentor=$3, start_date=$4, status=$5, notes=$6 WHERE id=$1 RETURNING *',
      [id, f.name, f.mentor, f.start_date, f.status, f.notes]);
    await audit(req.user.id, 'mav.batch_update', 'mav_batch', id, { changes: b }, b.reason);
    res.json(rows[0]);
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows: batch } = await query('SELECT * FROM mav_batches WHERE id=$1', [id]);
    if (!batch.length) return res.status(404).json({ error: 'Not found' });
    const { rows: members } = await query(
      `SELECT m.employee_id, m.status, m.comment, e.name, e.zoho_emp_id, e.entity, e.division,
              e.department, e.designation, e.date_joined, e.email, e.mobile
       FROM mav_members m JOIN employees e ON e.id = m.employee_id
       WHERE m.batch_id=$1 ORDER BY e.name`, [id]);
    const { rows: assessments } = await query(
      `SELECT a.*, (SELECT json_agg(json_build_object('employee_id', s.employee_id, 'score', s.score))
                    FROM mav_scores s WHERE s.assessment_id=a.id) AS scores
       FROM mav_assessments a WHERE a.batch_id=$1 ORDER BY a.division, a.assess_date NULLS LAST, a.id`, [id]);
    res.json({ ...batch[0], members, assessments });
  } catch (e) { next(e); }
});

router.post('/:id/members', requireRole('admin'), express.json(), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const employeeId = Number(req.body?.employee_id);
    await query('INSERT INTO mav_members (batch_id, employee_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, employeeId]);
    await audit(req.user.id, 'mav.member_add', 'mav_batch', id, { employee_id: employeeId });
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});

router.patch('/:id/members/:empId', requireRole('admin'), express.json(), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const empId = Number(req.params.empId);
    const b = req.body || {};
    const status = MEMBER_STATUS.includes(b.status) ? b.status : undefined;
    const { rows } = await query(
      `UPDATE mav_members SET status = coalesce($3, status),
              comment = CASE WHEN $4::boolean THEN $5 ELSE comment END
       WHERE batch_id=$1 AND employee_id=$2 RETURNING *`,
      [id, empId, status, b.comment !== undefined, b.comment?.trim() || null]);
    if (!rows.length) return res.status(404).json({ error: 'Not a member of this batch' });
    await audit(req.user.id, 'mav.member_update', 'mav_batch', id, { employee_id: empId, changes: b });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

router.delete('/:id/members/:empId', requireRole('admin'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const empId = Number(req.params.empId);
    const reason = String(req.query.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'A reason is required to remove a trainee' });
    await query('DELETE FROM mav_members WHERE batch_id=$1 AND employee_id=$2', [id, empId]);
    await query('DELETE FROM mav_attendance WHERE batch_id=$1 AND employee_id=$2', [id, empId]);
    await audit(req.user.id, 'mav.member_remove', 'mav_batch', id, { employee_id: empId }, reason);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.get('/:id/attendance', async (req, res, next) => {
  try {
    const kind = req.query.kind === 'field' ? 'field' : 'classroom';
    const { rows } = await query(
      'SELECT employee_id, day, mark, updated_at FROM mav_attendance WHERE batch_id=$1 AND kind=$2',
      [Number(req.params.id), kind]);
    res.json(rows);
  } catch (e) { next(e); }
});

router.put('/:id/attendance', requireRole('admin'), express.json(), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { employee_id, day, kind, mark, reason } = req.body || {};
    const k = kind === 'field' ? 'field' : 'classroom';
    if (!employee_id || !day) return res.status(400).json({ error: 'employee_id and day are required' });
    if (mark !== null && !['P', 'A', 'H'].includes(mark)) return res.status(400).json({ error: 'mark must be P, A, H or null' });
    if (mark === null) {
      await query('DELETE FROM mav_attendance WHERE batch_id=$1 AND employee_id=$2 AND day=$3 AND kind=$4',
        [id, employee_id, day, k]);
    } else {
      await query(
        `INSERT INTO mav_attendance (batch_id, employee_id, day, kind, mark, marked_by)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (batch_id, employee_id, day, kind)
         DO UPDATE SET mark=$5, marked_by=$6, updated_at=now()`,
        [id, employee_id, day, k, mark, req.user.id]);
    }
    await audit(req.user.id, 'mav.attendance', 'mav_batch', id, { employee_id, day, kind: k, mark }, reason);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/:id/assessments', requireRole('admin'), express.json(), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const b = req.body || {};
    if (!b.name?.trim() || !b.division?.trim()) {
      return res.status(400).json({ error: 'Assessment name and division are required' });
    }
    const { rows } = await query(
      'INSERT INTO mav_assessments (batch_id, division, name, max_marks, assess_date) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [id, b.division.trim(), b.name.trim(), Number(b.max_marks) > 0 ? Number(b.max_marks) : 100, b.assess_date || null]);
    await audit(req.user.id, 'mav.assessment_create', 'mav_batch', id, { name: b.name, division: b.division });
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

router.put('/assessments/:aid/scores', requireRole('admin'), express.json(), async (req, res, next) => {
  try {
    const aid = Number(req.params.aid);
    const scores = Array.isArray(req.body?.scores) ? req.body.scores : [];
    for (const s of scores) {
      if (s.score === null || s.score === '') {
        await query('DELETE FROM mav_scores WHERE assessment_id=$1 AND employee_id=$2', [aid, Number(s.employee_id)]);
      } else {
        await query(
          `INSERT INTO mav_scores (assessment_id, employee_id, score) VALUES ($1,$2,$3)
           ON CONFLICT (assessment_id, employee_id) DO UPDATE SET score=$3`,
          [aid, Number(s.employee_id), Number(s.score)]);
      }
    }
    await audit(req.user.id, 'mav.scores_update', 'mav_assessment', aid, { count: scores.length });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
