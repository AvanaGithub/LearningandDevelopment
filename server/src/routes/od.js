const express = require('express');
const { query, pool } = require('../db');
const { audit } = require('../auth');

// Organization Development: events (celebrations, offsites, engagement
// programmes …) with their budgets and expenses. CONFIDENTIAL — only
// authorised OD users (users.od_access), the configured budget approvers and
// the super admin get in; every route enforces it server-side.
//
// An event has location rows (headcount + budget envelope per place) and
// expense lines. Money SPENT is counted only from the expense lines; a line
// is tagged to one location or is Company-wide, and a company-wide line can
// be allocated across locations purely for the location-wise view — so no
// amount is ever counted twice. Payments live on the event.
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

// ---- categories (editable from the OD screen) ----------------------------

const DEFAULT_CATS = {
  expense: ['Decorations and Materials', 'Cakes and Refreshments', 'Sweets and Gifts', 'Employee Gifting',
    'Travel and Logistics', 'Venue and Activities', 'Other Expenses'],
  event: ['Festival Celebration', 'Employee Engagement', 'Team Outing', 'Offsite', 'Awards and Recognition',
    'Wellness', 'CSR Activity', 'Other'],
};
async function categories() {
  const { rows } = await query(`SELECT key, value FROM settings WHERE key IN ('od_categories','od_event_categories')`);
  const get = (k) => rows.find((r) => r.key === k)?.value;
  return {
    expense: Array.isArray(get('od_categories')) ? get('od_categories') : DEFAULT_CATS.expense,
    event: Array.isArray(get('od_event_categories')) ? get('od_event_categories') : DEFAULT_CATS.event,
  };
}

router.get('/categories', async (req, res, next) => {
  try { res.json(await categories()); } catch (e) { next(e); }
});

router.put('/categories', express.json(), async (req, res, next) => {
  try {
    const clean = (a) => [...new Set((Array.isArray(a) ? a : []).map((s) => String(s || '').trim().slice(0, 80)).filter(Boolean))];
    const expense = clean(req.body?.expense);
    const event = clean(req.body?.event);
    if (!expense.length || !event.length) return res.status(400).json({ error: 'Keep at least one category in each list' });
    for (const [key, value] of [['od_categories', expense], ['od_event_categories', event]]) {
      await query(
        `INSERT INTO settings (key, value, updated_by) VALUES ($1,$2,$3)
         ON CONFLICT (key) DO UPDATE SET value=$2, updated_by=$3, updated_at=now()`,
        [key, JSON.stringify(value), req.user.id]);
    }
    await audit(req.user.id, 'od.categories', 'setting', null, { expense, event });
    res.json({ expense, event });
  } catch (e) { next(e); }
});

// Active employees per location — suggests location names and fills headcounts.
router.get('/headcount', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT initcap(btrim(location)) AS location, count(*)::int AS n
       FROM employees WHERE active AND coalesce(btrim(location), '') <> ''
       GROUP BY 1 ORDER BY 1`);
    res.json(rows);
  } catch (e) { next(e); }
});

// Bills, invoices, quotations … (OD users need not be admins).
const files = require('./files');
router.post('/upload', files.upload.array('files', 10), async (req, res, next) => {
  try { res.status(201).json(await files.saveFiles(req.files, req.user.id)); } catch (e) { next(e); }
});

// ---- events --------------------------------------------------------------

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT e.*,
              coalesce((SELECT json_agg(l ORDER BY l.sort, l.id) FROM od_locations l WHERE l.event_id=e.id), '[]') AS locations,
              coalesce((SELECT json_agg(i ORDER BY i.sort, i.id) FROM od_items i WHERE i.event_id=e.id), '[]') AS items,
              b.id AS apr_id, b.status AS apr_status, b.amount AS apr_amount,
              b.approver_name AS apr_approver, b.decision_comment AS apr_comment, b.decided_at AS apr_decided
       FROM od_events e
       LEFT JOIN LATERAL (
         SELECT * FROM budget_approvals b2 WHERE b2.od_event_id = e.id AND b2.status <> 'superseded'
         ORDER BY b2.id DESC LIMIT 1) b ON TRUE
       WHERE e.active ORDER BY e.event_date DESC NULLS LAST, e.id DESC`);
    res.json(rows);
  } catch (e) { next(e); }
});

class Bad extends Error {}
const num = (v, label) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Bad(`${label}: enter a positive number`);
  return Math.round(n * 100) / 100;
};
const int = (v, label) => { const n = num(v, label); return n === null ? null : Math.round(n); };
const txt = (v, max = 500) => (String(v ?? '').trim().slice(0, max) || null);
const fileList = (a) => (Array.isArray(a) ? a : []).filter((f) => f && f.id)
  .slice(0, 30).map((f) => ({ id: String(f.id).slice(0, 60), name: String(f.name || 'file').slice(0, 150), kind: txt(f.kind, 40) }));

// Validate + normalise the whole event payload (details, locations, lines,
// payments). Locations are matched by name, case-insensitively.
function clean(b) {
  const name = txt(b.name, 200);
  if (!name) throw new Bad('Event name is required');
  const ev = {
    name,
    category: txt(b.category, 80),
    event_date: b.event_date || null,
    end_date: b.end_date || null,
    expense_type: b.expense_type === 'company' ? 'company' : 'location',
    employee_count: int(b.employee_count, 'Total headcount') ?? 0,
    participants: int(b.participants, 'Participants'),
    est_budget: num(b.est_budget, 'Estimated budget') ?? 0,
    requested_budget: num(b.requested_budget, 'Requested budget'),
    approved_budget: num(b.approved_budget, 'Approved budget'),
    notes: txt(b.notes, 2000),
    files: fileList(b.files),
  };
  if (ev.end_date && ev.event_date && ev.end_date < ev.event_date) throw new Bad('The To date is before the From date');

  const locations = [];
  const seen = new Set();
  for (const l of Array.isArray(b.locations) ? b.locations : []) {
    const loc = txt(l.location, 80);
    if (!loc) continue;
    if (seen.has(loc.toLowerCase())) throw new Bad(`Location "${loc}" is listed twice`);
    seen.add(loc.toLowerCase());
    locations.push({
      location: loc,
      headcount: int(l.headcount, `${loc} headcount`),
      est_budget: num(l.est_budget, `${loc} estimated budget`),
      approved_budget: num(l.approved_budget, `${loc} approved budget`),
      category: txt(l.category, 80),
      remarks: txt(l.remarks, 500),
    });
  }
  const canon = (s) => locations.find((l) => l.location.toLowerCase() === String(s || '').trim().toLowerCase())?.location || null;

  const items = [];
  for (const [n, it] of (Array.isArray(b.items) ? b.items : []).entries()) {
    const label = `Line ${n + 1}${it.description ? ` (${String(it.description).slice(0, 30)})` : ''}`;
    const row = {
      category: txt(it.category, 80),
      description: txt(it.description, 300),
      quantity: num(it.quantity, `${label} quantity`),
      est_amount: num(it.est_amount, `${label} estimated`),
      approved_amount: num(it.approved_amount, `${label} approved`),
      actual_amount: num(it.actual_amount, `${label} actual`),
      location: null,
      allocations: [],
      remarks: txt(it.remarks, 500),
      files: fileList(it.files),
    };
    if (!row.category && !row.description && row.est_amount === null && row.approved_amount === null && row.actual_amount === null) continue;
    if (it.location) {
      row.location = canon(it.location);
      if (!row.location) throw new Bad(`${label}: location "${it.location}" is not one of this event's locations`);
    } else {
      // Company-wide: optional manual split across the event's locations.
      for (const a of Array.isArray(it.allocations) ? it.allocations : []) {
        const loc = canon(a.location);
        const amt = num(a.amount, `${label} allocation`);
        if (loc && amt) row.allocations.push({ location: loc, amount: amt });
      }
      const base = row.actual_amount ?? row.approved_amount ?? row.est_amount ?? 0;
      const allocated = row.allocations.reduce((s, a) => s + a.amount, 0);
      if (allocated > base + 0.005) {
        throw new Bad(`${label}: allocated ₹${allocated.toLocaleString('en-IN')} is more than the line's amount ₹${Number(base).toLocaleString('en-IN')}`);
      }
    }
    items.push(row);
  }

  const payments = [];
  for (const [n, p] of (Array.isArray(b.payments) ? b.payments : []).entries()) {
    const amt = num(p.amt, `Payment ${n + 1} amount`);
    if (!amt) continue;
    payments.push({
      date: p.date || null, amt,
      location: p.location ? canon(p.location) : null,
      reference: txt(p.reference, 120), note: txt(p.note, 200),
    });
  }

  // The legacy summary columns stay filled for the rest of the hub (mails).
  ev.location = locations.map((l) => l.location).join(', ') || (ev.expense_type === 'company' ? 'Company-wide' : null);
  ev.actual = items.reduce((s, i) => s + (i.actual_amount || 0), 0);
  return { ev, locations, items, payments };
}

async function writeChildren(client, eventId, locations, items) {
  await client.query('DELETE FROM od_locations WHERE event_id=$1', [eventId]);
  await client.query('DELETE FROM od_items WHERE event_id=$1', [eventId]);
  for (const [i, l] of locations.entries()) {
    await client.query(
      `INSERT INTO od_locations (event_id, location, headcount, est_budget, approved_budget, category, remarks, sort)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [eventId, l.location, l.headcount, l.est_budget, l.approved_budget, l.category, l.remarks, i]);
  }
  for (const [i, it] of items.entries()) {
    await client.query(
      `INSERT INTO od_items (event_id, category, description, quantity, est_amount, approved_amount, actual_amount,
         location, allocations, remarks, files, sort)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [eventId, it.category, it.description, it.quantity, it.est_amount, it.approved_amount, it.actual_amount,
       it.location, JSON.stringify(it.allocations), it.remarks, JSON.stringify(it.files), i]);
  }
}

const EV_COLS = ['name', 'category', 'event_date', 'end_date', 'expense_type', 'employee_count', 'participants',
  'est_budget', 'requested_budget', 'approved_budget', 'notes', 'files', 'location', 'actual'];
const evVals = (ev) => EV_COLS.map((k) => (k === 'files' ? JSON.stringify(ev.files) : ev[k]));

router.post('/', express.json({ limit: '2mb' }), async (req, res, next) => {
  let data;
  try { data = clean(req.body || {}); } catch (e) { return e instanceof Bad ? res.status(400).json({ error: e.message }) : next(e); }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ph = EV_COLS.map((_, i) => '$' + (i + 1)).join(',');
    const { rows } = await client.query(
      `INSERT INTO od_events (${EV_COLS.join(',')}, payments, created_by) VALUES (${ph}, $${EV_COLS.length + 1}, $${EV_COLS.length + 2}) RETURNING id`,
      [...evVals(data.ev), JSON.stringify(data.payments), req.user.id]);
    await writeChildren(client, rows[0].id, data.locations, data.items);
    await client.query('COMMIT');
    await audit(req.user.id, 'od.create', 'od_event', rows[0].id, { name: data.ev.name, locations: data.locations.length, lines: data.items.length });
    res.status(201).json({ id: rows[0].id });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); next(e); } finally { client.release(); }
});

// Save the whole event. The previous version goes to the audit log first,
// so every earlier figure stays traceable.
router.put('/:id', express.json({ limit: '2mb' }), async (req, res, next) => {
  const id = Number(req.params.id);
  let data;
  try { data = clean(req.body || {}); } catch (e) { return e instanceof Bad ? res.status(400).json({ error: e.message }) : next(e); }
  const client = await pool.connect();
  try {
    const { rows: cur } = await client.query('SELECT * FROM od_events WHERE id=$1 AND active', [id]);
    if (!cur.length) return res.status(404).json({ error: 'Not found' });
    const { rows: prevLocs } = await client.query('SELECT * FROM od_locations WHERE event_id=$1 ORDER BY sort', [id]);
    const { rows: prevItems } = await client.query('SELECT * FROM od_items WHERE event_id=$1 ORDER BY sort', [id]);
    await client.query('BEGIN');
    const set = EV_COLS.map((k, i) => `${k}=$${i + 2}`).join(', ');
    await client.query(
      `UPDATE od_events SET ${set}, payments=$${EV_COLS.length + 2}, updated_at=now() WHERE id=$1`,
      [id, ...evVals(data.ev), JSON.stringify(data.payments)]);
    await writeChildren(client, id, data.locations, data.items);
    await client.query('COMMIT');
    await audit(req.user.id, 'od.update', 'od_event', id,
      { previous: { event: cur[0], locations: prevLocs, items: prevItems } }, req.body?.reason);
    res.json({ ok: true });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); next(e); } finally { client.release(); }
});

// Remove = deactivate (never delete); needs a reason.
router.patch('/:id', express.json(), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows: cur } = await query('SELECT name FROM od_events WHERE id=$1', [id]);
    if (!cur.length) return res.status(404).json({ error: 'Not found' });
    if (req.body?.active !== false) return res.status(400).json({ error: 'Use the event form to edit' });
    const reason = String(req.body.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'A reason is required to remove an event' });
    await query('UPDATE od_events SET active=FALSE, updated_at=now() WHERE id=$1', [id]);
    await audit(req.user.id, 'od.deactivate', 'od_event', id, { name: cur[0].name }, reason);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.isOD = isOD;
module.exports.cleanPayload = clean;
