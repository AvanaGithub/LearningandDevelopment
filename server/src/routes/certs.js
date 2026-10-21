const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { query } = require('../db');
const { requireRole, audit } = require('../auth');
const { generateCertPdf, DEFAULT_LAYOUT, DEFAULT_FIELDS } = require('../certgen');
const { UPLOAD_DIR } = require('./files');
const SITE = require('../config').baseUrl || 'https://academy.avanasurgical.com';

// Certificate management: templates (background + layout) and bulk
// generation of personalised PDFs for a training's participants.
// Duplicates are blocked by the (training, employee) unique constraint;
// eligibility (≥75% attendance) is computed and shown, with an admin
// override. Participants download their own copies on the learner portal.
const router = express.Router();
router.use(requireRole('admin'));

const fmtD = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : null);

// Issue one certificate (shared with the automatic workflow). t needs
// first_day/last_day; tpl may be null (built-in design); extra holds the
// generation-form texts (description, signatory, custom fields). Throws on
// a duplicate via the unique constraint unless the caller checked first.
async function issueCertFor(t, e, tpl, issuedBy, extra) {
  const label = `${t.title}${t.batch ? ' — ' + t.batch : ''}`;
  const dates = t.first_day
    ? (t.first_day === t.last_day ? fmtD(t.first_day) : `${fmtD(t.first_day)} - ${fmtD(t.last_day)}`)
    : null;
  const certNo = `AVA-${new Date().getFullYear()}-${(t.code || 'TRG').replace(/\s+/g, '')}-${(e.zoho_emp_id || 'E' + e.id).replace(/\s+/g, '')}`;
  const details = {};
  for (const [k, v] of Object.entries(extra || {})) {
    const s = String(v ?? '').trim().slice(0, 600);
    if (s) details[k] = s;
  }
  const pdf = await generateCertPdf({
    bgPath: tpl?.bg_file_id ? path.join(UPLOAD_DIR, tpl.bg_file_id) : null,
    layout: tpl?.layout,
    values: {
      name: e.name, training: label,
      dates: [dates, t.location].filter(Boolean).join(' · '),
      issue_date: fmtD(new Date()),
      cert_no: certNo,
      ...details,
    },
    verifyUrl: `${SITE}/p/cert/${certNo}`,
  });
  const fileId = crypto.randomBytes(12).toString('hex') + '.pdf';
  fs.writeFileSync(path.join(UPLOAD_DIR, fileId), pdf);
  await query('INSERT INTO files (id, orig_name, mime, size, uploaded_by) VALUES ($1,$2,$3,$4,$5)',
    [fileId, `Certificate - ${e.name} - ${label}.pdf`, 'application/pdf', pdf.length, issuedBy || null]);
  const { rows } = await query(
    `INSERT INTO certificates (cert_no, training_id, employee_id, template_id, file_id, issued_by, details)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [certNo, t.id, e.id, tpl?.id || null, fileId, issuedBy || null,
     Object.keys(details).length ? JSON.stringify(details) : null]);
  return rows[0];
}

// E-mail one issued certificate to its participant; marks emailed_at.
async function emailCert(certId) {
  const { rows } = await query(
    `SELECT c.*, e.name, e.email, t.title, t.batch
     FROM certificates c JOIN employees e ON e.id=c.employee_id
     JOIN trainings t ON t.id=c.training_id WHERE c.id=$1`, [certId]);
  if (!rows.length) throw new Error('Certificate not found');
  const c = rows[0];
  if (!c.email) throw new Error('No e-mail on the employee record');
  const mailer = require('../mailer');
  const pdf = fs.readFileSync(path.join(UPLOAD_DIR, c.file_id));
  const label = `${c.title}${c.batch ? ' — ' + c.batch : ''}`;
  await mailer.sendRaw(c.email, `Your certificate — ${label}`,
    `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#2b2317">
       <p>Dear ${mailer.esc(c.name)},</p>
       <p>Congratulations on completing <b>${mailer.esc(label)}</b>! Your certificate is attached
       (no: ${mailer.esc(c.cert_no)}). It is also available any time on your learner portal.</p>
       ${mailer.SITE_BTN}${mailer.FOOT}</div>`,
    [{ name: `Certificate - ${c.name}.pdf`, content: pdf, contentType: 'application/pdf' }]);
  await query('UPDATE certificates SET emailed_at=now() WHERE id=$1', [c.id]);
}

// ---- templates -----------------------------------------------------------

router.get('/templates', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT ct.*, f.orig_name AS bg_name FROM cert_templates ct
       LEFT JOIN files f ON f.id = ct.bg_file_id
       WHERE ct.active ORDER BY ct.id DESC`);
    res.json(rows);
  } catch (e) { next(e); }
});

router.post('/templates', express.json(), async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.name?.trim()) return res.status(400).json({ error: 'Template name is required' });
    // New templates use the visual fields editor from the start.
    const layout = b.layout && Array.isArray(b.layout.fields)
      ? b.layout
      : { fields: JSON.parse(JSON.stringify(DEFAULT_FIELDS)) };
    const { rows } = await query(
      'INSERT INTO cert_templates (name, bg_file_id, layout) VALUES ($1,$2,$3) RETURNING *',
      [b.name.trim(), b.bg_file_id || null, JSON.stringify(layout)]);
    await audit(req.user.id, 'cert.template_create', 'cert_template', rows[0].id, { name: b.name });
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

router.patch('/templates/:id', express.json(), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows: cur } = await query('SELECT * FROM cert_templates WHERE id=$1', [id]);
    if (!cur.length) return res.status(404).json({ error: 'Not found' });
    const b = req.body || {};
    const f = {
      name: b.name?.trim() || cur[0].name,
      bg_file_id: b.bg_file_id !== undefined ? (b.bg_file_id || null) : cur[0].bg_file_id,
      // A fields layout is stored as-is; legacy layouts keep their defaults.
      layout: b.layout
        ? (Array.isArray(b.layout.fields) ? b.layout : { ...DEFAULT_LAYOUT, ...b.layout })
        : cur[0].layout,
      active: b.active === undefined ? cur[0].active : Boolean(b.active),
    };
    const { rows } = await query(
      'UPDATE cert_templates SET name=$2, bg_file_id=$3, layout=$4, active=$5 WHERE id=$1 RETURNING *',
      [id, f.name, f.bg_file_id, JSON.stringify(f.layout), f.active]);
    await audit(req.user.id, 'cert.template_update', 'cert_template', id, { changes: b });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// Sample PDF so the layout can be adjusted against the real background.
router.get('/templates/:id/preview', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM cert_templates WHERE id=$1', [Number(req.params.id)]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const t = rows[0];
    const pdf = await generateCertPdf({
      bgPath: t.bg_file_id ? path.join(UPLOAD_DIR, t.bg_file_id) : null,
      layout: t.layout,
      values: {
        name: 'Participant Name',
        training: 'Sample Training Programme — Batch 1',
        dates: '01 Jan 2026 - 03 Jan 2026 · Chennai',
        issue_date: fmtD(new Date()),
        cert_no: 'AVA-2026-SAMPLE-000',
      },
      verifyUrl: `${SITE}/p/cert/AVA-2026-SAMPLE-000`,
    });
    res.setHeader('Content-Disposition', 'inline; filename="preview.pdf"');
    res.type('application/pdf').send(pdf);
  } catch (e) { next(e); }
});

// ---- per-training view + generation -------------------------------------

// Participants with attendance %, eligibility and any issued certificate.
router.get('/training/:tid', async (req, res, next) => {
  try {
    const tid = Number(req.params.tid);
    const { rows: participants } = await query(
      `SELECT e.id, e.name, e.zoho_emp_id, e.email, e.department, e.entity,
              (SELECT count(*)::int FROM training_days d WHERE d.training_id=$1) AS day_count,
              (SELECT count(a.mark)::int FROM attendance a WHERE a.training_id=$1 AND a.employee_id=e.id) AS marked,
              coalesce((SELECT sum(CASE a.mark WHEN 'P' THEN 1 WHEN 'H' THEN 0.5 ELSE 0 END)
                        FROM attendance a WHERE a.training_id=$1 AND a.employee_id=e.id), 0)::float AS present_units,
              c.id AS cert_id, c.cert_no, c.file_id, c.issued_at, c.emailed_at
       FROM training_participants p
       JOIN employees e ON e.id = p.employee_id
       LEFT JOIN certificates c ON c.training_id = p.training_id AND c.employee_id = e.id
       WHERE p.training_id=$1 ORDER BY e.name`, [tid]);
    res.json(participants.map((r) => ({
      ...r,
      att_pct: r.day_count && r.marked ? Math.round((r.present_units / r.day_count) * 100) : null,
    })));
  } catch (e) { next(e); }
});

// Bulk generation. Already-issued participants are skipped (duplicate
// guard); ineligible ones are only included because the admin ticked them.
router.post('/training/:tid/generate', express.json(), async (req, res, next) => {
  try {
    const tid = Number(req.params.tid);
    const b = req.body || {};
    const ids = Array.isArray(b.employee_ids) ? b.employee_ids.map(Number).filter(Boolean) : [];
    if (!ids.length) return res.status(400).json({ error: 'Pick at least one participant' });
    const { rows: tr } = await query(
      `SELECT t.*, (SELECT min(d.day) FROM training_days d WHERE d.training_id=t.id) AS first_day,
              (SELECT max(d.day) FROM training_days d WHERE d.training_id=t.id) AS last_day
       FROM trainings t WHERE t.id=$1`, [tid]);
    if (!tr.length) return res.status(404).json({ error: 'Training not found' });
    const t = tr[0];
    let tpl = null;
    if (b.template_id) {
      const { rows: tp } = await query('SELECT * FROM cert_templates WHERE id=$1', [Number(b.template_id)]);
      if (!tp.length) return res.status(400).json({ error: 'Template not found' });
      tpl = tp[0];
    }
    const { rows: emps } = await query(
      `SELECT e.id, e.name, e.zoho_emp_id FROM employees e
       JOIN training_participants p ON p.employee_id=e.id AND p.training_id=$1
       WHERE e.id = ANY($2::int[])`, [tid, ids]);
    const extra = (b.values && typeof b.values === 'object') ? b.values : {};
    const issued = []; const skipped = [];
    for (const e of emps) {
      const { rows: dup } = await query(
        'SELECT cert_no FROM certificates WHERE training_id=$1 AND employee_id=$2', [tid, e.id]);
      if (dup.length) { skipped.push(e.name + ' (already issued ' + dup[0].cert_no + ')'); continue; }
      await issueCertFor(t, e, tpl, req.user.id, extra);
      issued.push(e.name);
    }
    await audit(req.user.id, 'cert.generate', 'training', tid,
      { issued: issued.length, skipped: skipped.length, template: tpl?.name || 'built-in' });
    res.json({ issued: issued.length, skipped });
  } catch (e) { next(e); }
});

// E-mail participants their certificate (PDF attached). Only ones not yet
// e-mailed unless resend is set.
router.post('/training/:tid/email', express.json(), async (req, res, next) => {
  try {
    const tid = Number(req.params.tid);
    const resend = Boolean(req.body?.resend);
    const { rows } = await query(
      `SELECT c.*, e.name, e.email, t.title, t.batch
       FROM certificates c
       JOIN employees e ON e.id=c.employee_id
       JOIN trainings t ON t.id=c.training_id
       WHERE c.training_id=$1 ${resend ? '' : 'AND c.emailed_at IS NULL'} ORDER BY e.name`, [tid]);
    if (!rows.length) return res.json({ sent: 0, failed: [], info: 'Nothing to send — generate certificates first (or everyone already got theirs).' });
    let sent = 0; const failed = [];
    for (const c of rows) {
      try { await emailCert(c.id); sent++; }
      catch (e2) { failed.push(c.name + ' (' + e2.message.slice(0, 120) + ')'); }
    }
    await audit(req.user.id, 'cert.email', 'training', tid, { sent, failed: failed.length });
    res.json({ sent, failed });
  } catch (e) { next(e); }
});

// Revoke/regenerate: delete needs a reason; the PDF file goes too.
router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const reason = String(req.query.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'A reason is required to revoke a certificate' });
    const { rows } = await query('DELETE FROM certificates WHERE id=$1 RETURNING *', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    if (rows[0].file_id) {
      await query('DELETE FROM files WHERE id=$1', [rows[0].file_id]);
      try { fs.unlinkSync(path.join(UPLOAD_DIR, rows[0].file_id)); } catch {}
    }
    await audit(req.user.id, 'cert.revoke', 'certificate', id, rows[0], reason);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.issueCertFor = issueCertFor;
module.exports.emailCert = emailCert;
