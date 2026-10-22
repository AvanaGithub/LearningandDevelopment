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

// Templates may be uploaded as PDFs — page 1 is converted to a PNG
// (poppler's pdftoppm) because both the editor and pdfkit need an image.
async function pdfBgToPng(fileId, userId) {
  const { execFile } = require('child_process');
  const src = path.join(UPLOAD_DIR, fileId);
  const outBase = path.join(UPLOAD_DIR, 'tmp_' + crypto.randomBytes(6).toString('hex'));
  await new Promise((resolve, reject) => {
    execFile('pdftoppm', ['-png', '-r', '150', '-f', '1', '-l', '1', '-singlefile', src, outBase],
      (e) => (e ? reject(Object.assign(new Error('The PDF could not be converted to an image — upload the design as JPG/PNG instead. (' + e.message.slice(0, 120) + ')'), { status: 400 })) : resolve()));
  });
  const buf = fs.readFileSync(outBase + '.png');
  fs.unlinkSync(outBase + '.png');
  const id = crypto.randomBytes(12).toString('hex') + '.png';
  fs.writeFileSync(path.join(UPLOAD_DIR, id), buf);
  await query('INSERT INTO files (id, orig_name, mime, size, uploaded_by) VALUES ($1,$2,$3,$4,$5)',
    [id, 'certificate-template.png', 'image/png', buf.length, userId || null]);
  return id;
}

// A PDF background becomes its page-1 PNG; images pass through untouched.
// Returns {id, w, h} — the pixel size drives the PDF page proportions.
function measureBg(fileId) {
  try {
    const dim = require('image-size')(fs.readFileSync(path.join(UPLOAD_DIR, fileId)));
    return { w: dim?.width || null, h: dim?.height || null };
  } catch { return { w: null, h: null }; }
}
async function resolveBg(fileId, userId) {
  if (!fileId) return null;
  const { rows } = await query('SELECT mime, orig_name FROM files WHERE id=$1', [fileId]);
  if (!rows.length) return null;
  let id = fileId;
  if (/pdf/i.test(rows[0].mime || '') || /\.pdf$/i.test(rows[0].orig_name || '')) {
    id = await pdfBgToPng(fileId, userId);
  }
  return { id, ...measureBg(id) };
}

// Issue one certificate (shared with the automatic workflow). t needs
// first_day/last_day; tpl may be null (built-in design); extra holds the
// generation-form texts (description, signatory, custom fields). Throws on
// a duplicate via the unique constraint unless the caller checked first.
// Certificate number: AVA-<year>-<6 random digits>, e.g. AVA-2026-482913.
// Random rather than sequential so the public verification page can't be
// walked to list every holder; no personal data in it.
async function newCertNo() {
  const year = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', year: 'numeric' });
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const no = `AVA-${year}-${code}`;
    const { rows } = await query('SELECT 1 FROM certificates WHERE cert_no=$1', [no]);
    if (!rows.length) return no;   // the UNIQUE constraint remains the final guard
  }
  throw new Error('Could not allocate a unique certificate number — please try again');
}

const cleanDetails = (extra) => {
  const details = {};
  for (const [k, v] of Object.entries(extra || {})) {
    const s = String(v ?? '').trim().slice(0, 600);
    if (s) details[k] = s;
  }
  return details;
};

// Render + store one certificate PDF; returns the new file id.
async function renderCertFile(t, e, tpl, certNo, issuedOn, details, userId) {
  const label = `${t.title}${t.batch ? ' — ' + t.batch : ''}`;
  const dates = t.first_day
    ? (t.first_day === t.last_day ? fmtD(t.first_day) : `${fmtD(t.first_day)} - ${fmtD(t.last_day)}`)
    : null;
  const pdf = await generateCertPdf({
    bgPath: tpl?.bg_file_id ? path.join(UPLOAD_DIR, tpl.bg_file_id) : null,
    bgDims: tpl ? { w: tpl.bg_w, h: tpl.bg_h } : null,
    layout: tpl?.layout,
    values: {
      name: e.name, training: label,
      dates: [dates, t.location].filter(Boolean).join(' · '),
      issue_date: fmtD(issuedOn || new Date()),
      cert_no: certNo,
      ...details,
    },
    verifyUrl: `${SITE}/p/cert/${certNo}`,
  });
  const fileId = crypto.randomBytes(12).toString('hex') + '.pdf';
  fs.writeFileSync(path.join(UPLOAD_DIR, fileId), pdf);
  await query('INSERT INTO files (id, orig_name, mime, size, uploaded_by) VALUES ($1,$2,$3,$4,$5)',
    [fileId, `Certificate - ${e.name} - ${label}.pdf`, 'application/pdf', pdf.length, userId || null]);
  return fileId;
}

async function issueCertFor(t, e, tpl, issuedBy, extra) {
  const certNo = await newCertNo();
  const details = cleanDetails(extra);
  const fileId = await renderCertFile(t, e, tpl, certNo, new Date(), details, issuedBy);
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

// ---- fonts (for the editor's live preview) -------------------------------

router.get('/fonts', (req, res) => res.json(require('../certfonts').fontList()));

router.get('/fonts/:key/:variant', (req, res) => {
  const { FONTS, pkgFile } = require('../certfonts');
  const f = FONTS[req.params.key];
  if (!f?.pkg || !/^(400|700)-(normal|italic)$/.test(req.params.variant)) return res.status(404).end();
  const p = pkgFile(f.pkg, req.params.variant);
  if (!p) return res.status(404).end();
  res.setHeader('Cache-Control', 'private, max-age=604800');
  res.type('font/woff').sendFile(p);
});

// ---- templates -----------------------------------------------------------

router.get('/templates', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT ct.*, f.orig_name AS bg_name FROM cert_templates ct
       LEFT JOIN files f ON f.id = ct.bg_file_id
       WHERE ct.active ORDER BY ct.id DESC`);
    // Templates saved before the sizing change get measured on first read.
    for (const r of rows) {
      if (r.bg_file_id && !r.bg_w) {
        const d = measureBg(r.bg_file_id);
        if (d.w) {
          await query('UPDATE cert_templates SET bg_w=$2, bg_h=$3 WHERE id=$1', [r.id, d.w, d.h]);
          r.bg_w = d.w; r.bg_h = d.h;
        }
      }
    }
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
    const bg = await resolveBg(b.bg_file_id || null, req.user.id);
    const { rows } = await query(
      'INSERT INTO cert_templates (name, bg_file_id, layout, bg_w, bg_h) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [b.name.trim(), bg?.id || null, JSON.stringify(layout), bg?.w || null, bg?.h || null]);
    await audit(req.user.id, 'cert.template_create', 'cert_template', rows[0].id, { name: b.name });
    res.status(201).json(rows[0]);
  } catch (e) { e.status === 400 ? res.status(400).json({ error: e.message }) : next(e); }
});

router.patch('/templates/:id', express.json(), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows: cur } = await query('SELECT * FROM cert_templates WHERE id=$1', [id]);
    if (!cur.length) return res.status(404).json({ error: 'Not found' });
    const b = req.body || {};
    const bg = b.bg_file_id !== undefined
      ? await resolveBg(b.bg_file_id || null, req.user.id)
      : { id: cur[0].bg_file_id, w: cur[0].bg_w, h: cur[0].bg_h };
    const f = {
      name: b.name?.trim() || cur[0].name,
      // A fields layout is stored as-is; legacy layouts keep their defaults.
      layout: b.layout
        ? (Array.isArray(b.layout.fields) ? b.layout : { ...DEFAULT_LAYOUT, ...b.layout })
        : cur[0].layout,
      active: b.active === undefined ? cur[0].active : Boolean(b.active),
    };
    const { rows } = await query(
      'UPDATE cert_templates SET name=$2, bg_file_id=$3, layout=$4, active=$5, bg_w=$6, bg_h=$7 WHERE id=$1 RETURNING *',
      [id, f.name, bg?.id || null, JSON.stringify(f.layout), f.active, bg?.w || null, bg?.h || null]);
    await audit(req.user.id, 'cert.template_update', 'cert_template', id, { changes: b });
    res.json(rows[0]);
  } catch (e) { e.status === 400 ? res.status(400).json({ error: e.message }) : next(e); }
});

// Sample PDF so the layout can be adjusted against the real background.
router.get('/templates/:id/preview', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM cert_templates WHERE id=$1', [Number(req.params.id)]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const t = rows[0];
    const pdf = await generateCertPdf({
      bgPath: t.bg_file_id ? path.join(UPLOAD_DIR, t.bg_file_id) : null,
      bgDims: { w: t.bg_w, h: t.bg_h },
      layout: t.layout,
      values: {
        name: 'Participant Name',
        training: 'Sample Training Programme — Batch 1',
        dates: '01 Jan 2026 - 03 Jan 2026 · Chennai',
        issue_date: fmtD(new Date()),
        cert_no: 'AVA-2026-000000',
      },
      verifyUrl: `${SITE}/p/cert/AVA-2026-000000`,
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
              c.id AS cert_id, c.cert_no, c.file_id, c.issued_at, c.emailed_at,
              c.template_id, (SELECT ct.name FROM cert_templates ct WHERE ct.id=c.template_id) AS template_name
       FROM training_participants p
       JOIN employees e ON e.id = p.employee_id
       LEFT JOIN certificates c ON c.training_id = p.training_id AND c.employee_id = e.id
       WHERE p.training_id=$1 ORDER BY e.name`, [tid]);
    // Only people marked present (P or half-day) on at least one day can get
    // a certificate. Anyone already holding one stays listed so it can be
    // revoked if their attendance was corrected afterwards.
    const rows = participants.map((r) => ({
      ...r,
      present: r.present_units > 0,
      att_pct: r.day_count && r.marked ? Math.round((r.present_units / r.day_count) * 100) : null,
    }));
    const shown = rows.filter((r) => r.present || r.cert_id);
    res.json({ participants: shown, not_present: rows.length - shown.length });
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
    // Enforced here, not just in the list: no attendance mark of P or H on
    // this training means no certificate.
    const { rows: emps } = await query(
      `SELECT e.id, e.name, e.zoho_emp_id FROM employees e
       JOIN training_participants p ON p.employee_id=e.id AND p.training_id=$1
       WHERE e.id = ANY($2::int[])
         AND EXISTS (SELECT 1 FROM attendance a WHERE a.training_id=$1 AND a.employee_id=e.id AND a.mark IN ('P','H'))`,
      [tid, ids]);
    const extra = (b.values && typeof b.values === 'object') ? b.values : {};
    const issued = []; const skipped = [];
    const notPresent = ids.length - emps.length;
    if (notPresent > 0) skipped.push(`${notPresent} participant(s) not marked present`);
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

// Re-render already-issued certificates with a (new) template. The
// certificate number and issue date stay the same, so printed QR codes keep
// verifying; e-mail status resets so the new version can be sent.
router.post('/training/:tid/reissue', express.json(), async (req, res, next) => {
  try {
    const tid = Number(req.params.tid);
    const b = req.body || {};
    const { rows: tr } = await query(
      `SELECT t.*, (SELECT min(d.day) FROM training_days d WHERE d.training_id=t.id) AS first_day,
              (SELECT max(d.day) FROM training_days d WHERE d.training_id=t.id) AS last_day
       FROM trainings t WHERE t.id=$1`, [tid]);
    if (!tr.length) return res.status(404).json({ error: 'Training not found' });
    let tpl = null;
    if (b.template_id) {
      const { rows: tp } = await query('SELECT * FROM cert_templates WHERE id=$1', [Number(b.template_id)]);
      if (!tp.length) return res.status(400).json({ error: 'Template not found' });
      tpl = tp[0];
    }
    const ids = Array.isArray(b.employee_ids) ? b.employee_ids.map(Number).filter(Boolean) : null;
    const { rows: certs } = await query(
      `SELECT c.*, e.name, e.zoho_emp_id FROM certificates c JOIN employees e ON e.id=c.employee_id
       WHERE c.training_id=$1 ${ids ? 'AND c.employee_id = ANY($2::int[])' : ''} ORDER BY e.name`,
      ids ? [tid, ids] : [tid]);
    if (!certs.length) return res.status(400).json({ error: 'No issued certificates to re-issue on this training' });
    const newDetails = b.values && typeof b.values === 'object' ? cleanDetails(b.values) : null;
    let done = 0;
    for (const c of certs) {
      const details = newDetails || c.details || {};
      const fileId = await renderCertFile(tr[0], { id: c.employee_id, name: c.name, zoho_emp_id: c.zoho_emp_id },
        tpl, c.cert_no, c.issued_at, details, req.user.id);
      await query(
        `UPDATE certificates SET file_id=$2, template_id=$3, details=$4, emailed_at=NULL WHERE id=$1`,
        [c.id, fileId, tpl?.id || null, Object.keys(details).length ? JSON.stringify(details) : null]);
      done++;
    }
    await audit(req.user.id, 'cert.reissue', 'training', tid,
      { reissued: done, template: tpl?.name || 'built-in', previous_files: certs.map((c) => c.file_id) });
    res.json({ reissued: done });
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
