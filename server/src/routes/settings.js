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
  // Mandatory optional-fields per form, set from the Settings screen and
  // enforced server-side (employees has its own legacy key).
  required_fields: { trainings: [], expenses: [], mavericks: [] },
  // Outlook / Microsoft 365 notifications. The password is write-only:
  // it is stored here but never sent back to any client.
  smtp: {
    enabled: false, method: 'graph', host: 'smtp.office365.com', port: 587,
    user: 'lokshni@avanasurgical.com', from: 'lokshni@avanasurgical.com',
    from_name: 'Avana Academy',
    notify: 'lokshni@avanasurgical.com', pass: '',
    tenant_id: '', client_id: '', client_secret: '',
  },
};

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT key, value FROM settings');
    const out = { ...DEFAULTS };
    rows.forEach((r) => { if (r.key in DEFAULTS) out[r.key] = r.value; });
    // Never expose the mailbox password or client secret; only whether saved.
    out.smtp = {
      ...DEFAULTS.smtp, ...out.smtp,
      pass: '', has_pass: Boolean(out.smtp?.pass),
      client_secret: '', has_secret: Boolean(out.smtp?.client_secret),
      cert_available: require('../mailer').certAvailable(),
    };
    res.json(out);
  } catch (e) { next(e); }
});

router.put('/:key', requireRole('admin'), express.json(), async (req, res, next) => {
  try {
    const key = req.params.key;
    if (!(key in DEFAULTS)) return res.status(400).json({ error: 'Unknown setting' });
    let value = req.body?.value;
    if (value === undefined) return res.status(400).json({ error: 'value is required' });
    if (key === 'smtp') {
      const { rows: cur } = await query(`SELECT value FROM settings WHERE key='smtp'`);
      const prev = cur.length ? cur[0].value : DEFAULTS.smtp;
      value = {
        enabled: Boolean(value.enabled),
        method: value.method === 'graph' ? 'graph' : 'smtp',
        host: String(value.host || 'smtp.office365.com').trim(),
        port: Number(value.port) || 587,
        user: String(value.user || '').trim().toLowerCase(),
        from: String(value.from || value.user || '').trim(),
        from_name: String(value.from_name || 'Avana Academy').trim(),
        notify: String(value.notify || '').trim().toLowerCase(),
        tenant_id: String(value.tenant_id || '').trim(),
        client_id: String(value.client_id || '').trim(),
        // Blank secrets = keep the saved ones.
        pass: String(value.pass || '') || prev.pass || '',
        client_secret: String(value.client_secret || '') || prev.client_secret || '',
      };
    }
    await query(
      `INSERT INTO settings (key, value, updated_by) VALUES ($1,$2,$3)
       ON CONFLICT (key) DO UPDATE SET value=$2, updated_by=$3, updated_at=now()`,
      [key, JSON.stringify(value), req.user.id]);
    await audit(req.user.id, 'settings.update', 'setting', null,
      { key, value: key === 'smtp' ? { ...value, pass: value.pass ? '(saved)' : '(none)', client_secret: value.client_secret ? '(saved)' : '(none)' } : value });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Settings-screen "send test e-mail" button.
router.post('/test-mail', requireRole('admin'), async (req, res, next) => {
  try {
    const to = await require('../mailer').sendTest();
    res.json({ ok: true, to });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Which optional fields of a form the admins promoted to mandatory.
async function requiredFields(section) {
  const { rows } = await query(`SELECT value FROM settings WHERE key='required_fields'`);
  const v = rows.length ? rows[0].value : DEFAULTS.required_fields;
  return Array.isArray(v?.[section]) ? v[section] : [];
}

module.exports = { router, DEFAULTS, requiredFields };
