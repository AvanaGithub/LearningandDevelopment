const express = require('express');
const { query } = require('../db');
const { audit } = require('../auth');

// Organization Development: events (offsites, engagement programmes …)
// with location, headcount, estimated/approved budget, actual spend,
// payments and cost per employee. CONFIDENTIAL — only authorised OD users
// (users.od_access), the configured budget approvers and the super admin
// get in; every route enforces it server-side.
const router = express.Router();

async function isOD(user) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;      // (a view-as preview drops this)
  if (user.od_access) return true;
  const { rows } = await query(`SELECT value FROM settings WHERE key='budget_approvers'`);
  const def = require('./settings').DEFAULTS.budget_approvers;
  const list = rows.length && Array.isArray(rows[0].value) && rows[0].value.length ? rows[0].value : def;
  return list.some((a) => (a.email || '').toLowerCase() === (user.email || '').toLowerCase());
}

router.use(async (req, res, next) => {
  try {
    if (await isOD(req.user)) return next();
    res.status(403).json({ error: 'The Organization Development module is restricted to authorised OD users.' });
  } catch (e) { next(e); }
});

const paidOf = (p) => (Array.isArray(p) ? p.reduce((a, x) => a + (Number(x.amt) || 0), 0) : 0);

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT e.*, b.id AS apr_id, b.status AS apr_status, b.amount AS apr_amount,
              b.approver_name AS apr_approver, b.decision_comment AS apr_comment, b.decided_at AS apr_decided
       FROM od_events e
       LEFT JOIN LATERAL (
         SELECT * FROM budget_approvals b2 WHERE b2.od_event_id = e.id AND b2.status <> 'superseded'
         ORDER BY b2.id DESC LIMIT 1) b ON TRUE
       WHERE e.active ORDER BY e.event_date DESC NULLS LAST, e.id DESC`);
    res.json(rows.map((r) => ({
      ...r,
      paid: paidOf(r.payments),
      cost_per_emp: r.employee_count > 0 ? Math.round(Number(r.actual) / r.employee_count) : null,
    })));
  } catch (e) { next(e); }
});

const pick = (b) => ({
  name: b.name?.trim(),
  location: b.location?.trim() || null,
  event_date: b.event_date || null,
  end_date: b.end_date || null,
  employee_count: Number(b.employee_count) >= 0 ? Math.floor(Number(b.employee_count)) : 0,
  est_budget: Number(b.est_budget) || 0,
  approved_budget: b.approved_budget === '' || b.approved_budget === undefined || b.approved_budget === null
    ? null : Number(b.approved_budget),
  actual: Number(b.actual) || 0,
  payments: Array.isArray(b.payments)
    ? b.payments.filter((p) => Number(p.amt) > 0)
      .map((p) => ({ date: p.date || null, amt: Number(p.amt), note: String(p.note || '').slice(0, 200) }))
    : [],
  notes: b.notes?.trim() || null,
});

router.post('/', express.json(), async (req, res, next) => {
  try {
    const f = pick(req.body || {});
    if (!f.name) return res.status(400).json({ error: 'Event name is required' });
    const { rows } = await query(
      `INSERT INTO od_events (name, location, event_date, end_date, employee_count, est_budget,
         approved_budget, actual, payments, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [f.name, f.location, f.event_date, f.end_date, f.employee_count, f.est_budget,
       f.approved_budget, f.actual, JSON.stringify(f.payments), f.notes, req.user.id]);
    await audit(req.user.id, 'od.create', 'od_event', rows[0].id, { name: f.name, location: f.location });
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

router.patch('/:id', express.json(), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows: cur } = await query('SELECT * FROM od_events WHERE id=$1', [id]);
    if (!cur.length) return res.status(404).json({ error: 'Not found' });
    const b = req.body || {};
    // Deactivate (never delete) needs a reason.
    if (b.active === false) {
      const reason = String(b.reason || '').trim();
      if (!reason) return res.status(400).json({ error: 'A reason is required to remove an event' });
      await query('UPDATE od_events SET active=FALSE, updated_at=now() WHERE id=$1', [id]);
      await audit(req.user.id, 'od.deactivate', 'od_event', id, { name: cur[0].name }, reason);
      return res.json({ ok: true });
    }
    const f = pick({ ...cur[0], ...b });
    if (!f.name) return res.status(400).json({ error: 'Event name is required' });
    const { rows } = await query(
      `UPDATE od_events SET name=$2, location=$3, event_date=$4, end_date=$5, employee_count=$6,
         est_budget=$7, approved_budget=$8, actual=$9, payments=$10, notes=$11, updated_at=now()
       WHERE id=$1 RETURNING *`,
      [id, f.name, f.location, f.event_date, f.end_date, f.employee_count, f.est_budget,
       f.approved_budget, f.actual, JSON.stringify(f.payments), f.notes]);
    await audit(req.user.id, 'od.update', 'od_event', id, { changes: b }, b.reason);
    res.json(rows[0]);
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.isOD = isOD;
