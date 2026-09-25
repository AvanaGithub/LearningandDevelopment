const express = require('express');
const { query } = require('../db');
const { requireRole, audit } = require('../auth');

const router = express.Router();

// Defaults — the Settings screen overrides any of these; unknown keys rejected.
const DEFAULTS = {
  divisions: ['Sports Medicine', 'Dex & Bio', 'Endospine', 'Orthotics', 'Business Support'],
  departments: ['Accounts', 'Administration', 'Clinical Support', 'Commercial', 'Graphic Design',
    'Human Resource', 'IT', 'Marketing', 'Medical Education', 'Operations', 'Quality', 'Sales', 'SCM', 'Service'],
  emp_types: ['Permanent', 'Trainee', 'Probation', 'TalentPro'],
  trn_categories: ['Induction', 'Product', 'Soft skill', 'Technical', 'Compliance', 'Safety', 'On-the-job', 'Mavericks'],
  exp_categories: ['Food / Catering', 'Flight', 'Venue / Conference room', 'Accommodation',
    'Local Transportation', 'Train', 'Training materials', 'Printing', 'Others'],
  entity_budgets: { AMD: 700000, ASS: 450000, ATS: 250000 },
  required_employee_fields: ['name', 'entity'],
  joiner_steps: ['Induction training', 'Product training', 'Department orientation', 'Systems access set up'],
};

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT key, value FROM settings');
    const out = { ...DEFAULTS };
    rows.forEach((r) => { if (r.key in DEFAULTS) out[r.key] = r.value; });
    res.json(out);
  } catch (e) { next(e); }
});

router.put('/:key', requireRole('admin'), express.json(), async (req, res, next) => {
  try {
    const key = req.params.key;
    if (!(key in DEFAULTS)) return res.status(400).json({ error: 'Unknown setting' });
    const value = req.body?.value;
    if (value === undefined) return res.status(400).json({ error: 'value is required' });
    await query(
      `INSERT INTO settings (key, value, updated_by) VALUES ($1,$2,$3)
       ON CONFLICT (key) DO UPDATE SET value=$2, updated_by=$3, updated_at=now()`,
      [key, JSON.stringify(value), req.user.id]);
    await audit(req.user.id, 'settings.update', 'setting', null, { key, value });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = { router, DEFAULTS };
