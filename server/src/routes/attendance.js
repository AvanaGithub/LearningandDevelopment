const express = require('express');
const { query } = require('../db');
const { requireRole, audit } = require('../auth');

const router = express.Router();
const MARKS = ['P', 'A', 'H'];

// Marks for one training. Any signed-in role can view.
router.get('/:trainingId', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT a.employee_id, a.day, a.mark, a.updated_at,
              coalesce(u.name, 'QR self check-in') AS marked_by
       FROM attendance a LEFT JOIN users u ON u.id = a.marked_by
       WHERE a.training_id=$1`, [Number(req.params.trainingId)]);
    res.json(rows);
  } catch (e) { next(e); }
});

// Set / change / clear one mark. Organizer (admin) only; every change audited.
router.put('/:trainingId', requireRole('admin'), express.json(), async (req, res, next) => {
  try {
    const trainingId = Number(req.params.trainingId);
    const { employee_id, day, mark, reason } = req.body || {};
    if (!employee_id || !day) return res.status(400).json({ error: 'employee_id and day are required' });
    if (mark !== null && !MARKS.includes(mark)) return res.status(400).json({ error: 'mark must be P, A, H or null' });
    const { rows: prev } = await query(
      'SELECT mark FROM attendance WHERE training_id=$1 AND employee_id=$2 AND day=$3',
      [trainingId, employee_id, day]);
    if (mark === null) {
      await query('DELETE FROM attendance WHERE training_id=$1 AND employee_id=$2 AND day=$3',
        [trainingId, employee_id, day]);
    } else {
      await query(
        `INSERT INTO attendance (training_id, employee_id, day, mark, marked_by)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (training_id, employee_id, day)
         DO UPDATE SET mark=$4, marked_by=$5, updated_at=now()`,
        [trainingId, employee_id, day, mark, req.user.id]);
    }
    await audit(req.user.id, 'attendance.mark', 'training', trainingId,
      { employee_id, day, from: prev[0]?.mark || null, to: mark }, reason);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Mark every participant present on every training day.
router.post('/:trainingId/mark-all', requireRole('admin'), async (req, res, next) => {
  try {
    const trainingId = Number(req.params.trainingId);
    await query(
      `INSERT INTO attendance (training_id, employee_id, day, mark, marked_by)
       SELECT p.training_id, p.employee_id, d.day, 'P', $2
       FROM training_participants p JOIN training_days d ON d.training_id = p.training_id
       WHERE p.training_id = $1
       ON CONFLICT (training_id, employee_id, day) DO UPDATE SET mark='P', marked_by=$2, updated_at=now()`,
      [trainingId, req.user.id]);
    await audit(req.user.id, 'attendance.mark_all_present', 'training', trainingId);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
