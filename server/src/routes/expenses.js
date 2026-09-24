const express = require('express');
const { query } = require('../db');
const { requireRole, audit } = require('../auth');

// Cost data is admin-only in its entirety (checklist K6).
const router = express.Router();
router.use(requireRole('admin'));

const APPROVALS = ['pending', 'approved', 'rejected'];
const ENTS = ['AMD', 'ASS', 'ATS'];

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM expenses WHERE active ORDER BY id DESC LIMIT 500');
    res.json(rows);
  } catch (e) { next(e); }
});

function pick(b) {
  const split = (Array.isArray(b.entity_split) ? b.entity_split : [])
    .filter((s) => ENTS.includes(s.ent) && Number(s.n) > 0)
    .map((s) => ({ ent: s.ent, n: Math.floor(Number(s.n)) }));
  const payments = (Array.isArray(b.payments) ? b.payments : [])
    .filter((p) => p.date && Number(p.amt) > 0)
    .map((p) => ({
      date: String(p.date), amt: Number(p.amt),
      invoices: (Array.isArray(p.invoices) ? p.invoices : [])
        .filter((x) => x && x.id).map((x) => ({ id: String(x.id), name: String(x.name || x.id) })),
    }));
  return {
    training_id: b.training_id ? Number(b.training_id) : null,
    training_label: b.training_label?.trim(),
    dates: b.dates?.trim() || null,
    location: b.location?.trim() || null,
    participants: Number(b.participants) > 0 ? Math.floor(Number(b.participants)) : split.reduce((a, s) => a + s.n, 0),
    entity_split: split,
    category: b.category?.trim() || null,
    training_type: b.training_type === 'External' ? 'External' : 'Internal',
    vendor: b.vendor?.trim() || null,
    description: b.description?.trim() || null,
    budget: Number(b.budget) || 0,
    actual: Number(b.actual) || 0,
    payments,
    invoices: (Array.isArray(b.invoices) ? b.invoices : []).map((x) => String(x).trim()).filter(Boolean),
    approval: APPROVALS.includes(b.approval) ? b.approval : 'pending',
    payment_status: ['paid', 'partial', 'unpaid'].includes(b.payment_status) ? b.payment_status : null,
    remark: b.remark?.trim() || null,
  };
}

function validate(f) {
  if (!f.training_label) return 'Training name is required';
  if (!f.entity_split.length) return 'Tick at least one entity with its participant count';
  if (f.budget <= 0) return 'Approved budget cannot be zero';
  if (f.actual <= 0) return 'Actual expense cannot be zero';
  const paid = f.payments.reduce((a, p) => a + p.amt, 0);
  if (paid > f.actual) return `Amount paid (${paid}) exceeds the actual expense (${f.actual})`;
  return null;
}

router.post('/', express.json(), async (req, res, next) => {
  try {
    const f = pick(req.body || {});
    const bad = validate(f);
    if (bad) return res.status(400).json({ error: bad });
    const { rows } = await query(
      `INSERT INTO expenses (training_id, training_label, dates, location, participants, entity_split,         category, training_type, vendor, description, budget, actual, payments, invoices, approval, payment_status, remark)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [f.training_id, f.training_label, f.dates, f.location, f.participants, JSON.stringify(f.entity_split),
       f.category, f.training_type, f.vendor, f.description, f.budget, f.actual,
       JSON.stringify(f.payments), JSON.stringify(f.invoices), f.approval, f.payment_status, f.remark]);
    await audit(req.user.id, 'expense.create', 'expense', rows[0].id, { training: f.training_label, actual: f.actual });
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

router.patch('/:id', express.json(), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows: cur } = await query('SELECT * FROM expenses WHERE id=$1', [id]);
    if (!cur.length) return res.status(404).json({ error: 'Not found' });
    const b = req.body || {};
    if (b.active === false) {
      const reason = String(b.reason || '').trim();
      if (!reason) return res.status(400).json({ error: 'A reason is required to cancel an expense record' });
      const { rows } = await query('UPDATE expenses SET active=FALSE, updated_at=now() WHERE id=$1 RETURNING *', [id]);
      await audit(req.user.id, 'expense.cancel', 'expense', id, null, reason);
      return res.json(rows[0]);
    }
    const f = pick({ ...cur[0], ...b });
    const bad = validate(f);
    if (bad) return res.status(400).json({ error: bad });
    const { rows } = await query(
      `UPDATE expenses SET training_id=$2, training_label=$3, dates=$4, location=$5, participants=$6,
         entity_split=$7, category=$8, training_type=$9, vendor=$10, description=$11, budget=$12,
         actual=$13, payments=$14, invoices=$15, approval=$16, payment_status=$17, remark=$18, updated_at=now()
       WHERE id=$1 RETURNING *`,
      [id, f.training_id, f.training_label, f.dates, f.location, f.participants, JSON.stringify(f.entity_split),
       f.category, f.training_type, f.vendor, f.description, f.budget, f.actual,
       JSON.stringify(f.payments), JSON.stringify(f.invoices), f.approval, f.payment_status, f.remark]);
    await audit(req.user.id, 'expense.update', 'expense', id, { changes: b }, b.reason);
    res.json(rows[0]);
  } catch (e) { next(e); }
});

module.exports = router;
