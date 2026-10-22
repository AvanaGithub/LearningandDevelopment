const express = require('express');
const crypto = require('crypto');
const { query } = require('../db');
const { requireRole, audit } = require('../auth');

// Training budget approvals. Admins raise a request on a training and send
// it to a configured approver (Vivek / Sundar). The approver decides via
// the secure token link in the e-mail (no sign-in needed) or from their
// dashboard when they are logged in. The requester gets the decision
// summary by mail, ready to share with Accounts.
const router = express.Router();

async function approversList() {
  const { rows } = await query(`SELECT value FROM settings WHERE key='budget_approvers'`);
  const def = require('./settings').DEFAULTS.budget_approvers;
  const v = rows.length ? rows[0].value : def;
  return Array.isArray(v) && v.length ? v : def;
}

// Approver endpoints go by the configured e-mail list, not by role — so
// Vivek/Sundar can decide whatever their portal role is.
async function requireApprover(req, res, next) {
  try {
    if (req.user.role === 'super_admin') return next();
    const list = await approversList();
    if (list.some((a) => (a.email || '').toLowerCase() === (req.user.email || '').toLowerCase())) return next();
    res.status(403).json({ error: 'Only configured budget approvers can do this' });
  } catch (e) { next(e); }
}

// History for a training (leaders can view, like the rest of the plan).
router.get('/training/:tid', requireRole('leader'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, training_id, requester_name, approver_email, approver_name, amount, note,
              status, decision_comment, decided_at, created_at
       FROM budget_approvals WHERE training_id=$1 ORDER BY id DESC`, [Number(req.params.tid)]);
    res.json(rows);
  } catch (e) { next(e); }
});

// Raise + send a request. Any earlier still-pending request on the same
// training is superseded so only one is ever actionable.
router.post('/training/:tid/request', requireRole('admin'), express.json(), async (req, res, next) => {
  try {
    const tid = Number(req.params.tid);
    const { rows: tr } = await query(`SELECT id, title FROM trainings WHERE id=$1 AND status <> 'cancelled'`, [tid]);
    if (!tr.length) return res.status(404).json({ error: 'Training not found' });
    const b = req.body || {};
    const amount = Number(b.amount);
    if (!(amount > 0)) return res.status(400).json({ error: 'Enter the budget amount (₹)' });
    const approvers = await approversList();
    const ap = approvers.find((a) => (a.email || '').toLowerCase() === String(b.approver_email || '').toLowerCase());
    if (!ap) return res.status(400).json({ error: 'Pick an approver from the configured list' });
    await query(
      `UPDATE budget_approvals SET status='superseded' WHERE training_id=$1 AND status='pending'`, [tid]);
    const token = crypto.randomBytes(24).toString('hex');
    const { rows } = await query(
      `INSERT INTO budget_approvals (training_id, requested_by, requester_name, approver_email, approver_name, amount, note, token)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [tid, req.user.id, req.user.name, ap.email.toLowerCase(), ap.name || null, amount, b.note?.trim() || null, token]);
    await audit(req.user.id, 'budget.request', 'training', tid,
      { approver: ap.email, amount, note: b.note || null });
    let mail_ok = true, mail_error = null;
    try { await require('../mailer').budgetRequest(rows[0]); }
    catch (e2) { mail_ok = false; mail_error = e2.message; }
    res.status(201).json({ ...rows[0], mail_ok, mail_error });
  } catch (e) { next(e); }
});

// Pending requests addressed to the signed-in user (approver's dashboard).
router.get('/mine', async (req, res, next) => {
  try {
    if (!req.user.email) return res.json([]);
    const { rows } = await query(
      `SELECT b.*, t.title, t.batch, t.code, t.location, t.mode,
              (SELECT min(d.day) FROM training_days d WHERE d.training_id=t.id) AS first_day,
              (SELECT max(d.day) FROM training_days d WHERE d.training_id=t.id) AS last_day,
              (SELECT count(*)::int FROM training_participants p WHERE p.training_id=t.id) AS participants,
              o.name AS od_name, o.location AS od_location, o.event_date AS od_date, o.employee_count AS od_employees
       FROM budget_approvals b
       LEFT JOIN trainings t ON t.id=b.training_id
       LEFT JOIN od_events o ON o.id=b.od_event_id
       WHERE b.status='pending' AND lower(b.approver_email)=lower($1)
       ORDER BY b.id DESC`, [req.user.email]);
    res.json(rows);
  } catch (e) { next(e); }
});

// ---- OD event budget requests (authorised OD users) ---------------------

router.get('/od/:id', async (req, res, next) => {
  try {
    if (!(await require('./od').isOD(req.user))) return res.status(403).json({ error: 'Restricted to authorised OD users' });
    const { rows } = await query(
      `SELECT id, od_event_id, requester_name, approver_email, approver_name, amount, note,
              status, decision_comment, decided_at, created_at
       FROM budget_approvals WHERE od_event_id=$1 ORDER BY id DESC`, [Number(req.params.id)]);
    res.json(rows);
  } catch (e) { next(e); }
});

router.post('/od/:id/request', express.json(), async (req, res, next) => {
  try {
    if (!(await require('./od').isOD(req.user))) return res.status(403).json({ error: 'Restricted to authorised OD users' });
    const oid = Number(req.params.id);
    const { rows: ev } = await query('SELECT id, name FROM od_events WHERE id=$1 AND active', [oid]);
    if (!ev.length) return res.status(404).json({ error: 'Event not found' });
    const b = req.body || {};
    const amount = Number(b.amount);
    if (!(amount > 0)) return res.status(400).json({ error: 'Enter the budget amount (₹)' });
    const approvers = await approversList();
    const ap = approvers.find((a) => (a.email || '').toLowerCase() === String(b.approver_email || '').toLowerCase());
    if (!ap) return res.status(400).json({ error: 'Pick an approver from the configured list' });
    await query(`UPDATE budget_approvals SET status='superseded' WHERE od_event_id=$1 AND status='pending'`, [oid]);
    const token = crypto.randomBytes(24).toString('hex');
    const { rows } = await query(
      `INSERT INTO budget_approvals (od_event_id, requested_by, requester_name, approver_email, approver_name, amount, note, token)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [oid, req.user.id, req.user.name, ap.email.toLowerCase(), ap.name || null, amount, b.note?.trim() || null, token]);
    await query('UPDATE od_events SET requested_budget=$2, updated_at=now() WHERE id=$1', [oid, amount]);
    await audit(req.user.id, 'budget.od_request', 'od_event', oid, { approver: ap.email, amount });
    let mail_ok = true, mail_error = null;
    try { await require('../mailer').budgetRequest(rows[0]); }
    catch (e2) { mail_ok = false; mail_error = e2.message; }
    res.status(201).json({ ...rows[0], mail_ok, mail_error });
  } catch (e) { next(e); }
});

// Shared decision logic (also used by the public token route).
async function applyDecision(apr, action, comment, actorLabel, actorUserId) {
  const ACTIONS = { approved: 'approved', rejected: 'rejected', clarify: 'clarify' };
  const status = ACTIONS[action];
  if (!status) throw Object.assign(new Error('Action must be approve, reject or clarify'), { status: 400 });
  if (apr.status !== 'pending') throw Object.assign(new Error('This request has already been decided'), { status: 409 });
  if ((status === 'rejected' || status === 'clarify') && !String(comment || '').trim()) {
    throw Object.assign(new Error('Please add a comment so the requester knows why'), { status: 400 });
  }
  const { rows } = await query(
    `UPDATE budget_approvals SET status=$2, decision_comment=$3, decided_at=now()
     WHERE id=$1 AND status='pending' RETURNING *`,
    [apr.id, status, String(comment || '').trim() || null]);
  if (!rows.length) throw Object.assign(new Error('This request has already been decided'), { status: 409 });
  // An approved OD request records itself as the event's approved budget.
  if (status === 'approved' && apr.od_event_id) {
    await query('UPDATE od_events SET approved_budget=$2, updated_at=now() WHERE id=$1',
      [apr.od_event_id, apr.amount]);
  }
  await audit(actorUserId || null, 'budget.' + status,
    apr.od_event_id ? 'od_event' : 'training', apr.od_event_id || apr.training_id,
    { approval_id: apr.id, amount: apr.amount, by: actorLabel, comment: comment || null });
  require('../mailer').budgetDecision(rows[0]).catch((e) => console.error('[mail budget]', e.message));
  return rows[0];
}

// In-portal decision by the signed-in approver.
router.post('/:id/decide', requireApprover, express.json(), async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM budget_approvals WHERE id=$1', [Number(req.params.id)]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const apr = rows[0];
    if ((apr.approver_email || '').toLowerCase() !== (req.user.email || '').toLowerCase()) {
      return res.status(403).json({ error: 'This request is addressed to ' + apr.approver_email });
    }
    const out = await applyDecision(apr, req.body?.action, req.body?.comment, req.user.name, req.user.id);
    res.json(out);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

module.exports = router;
module.exports.applyDecision = applyDecision;
