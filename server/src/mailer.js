const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { query } = require('./db');
const config = require('./config');

const SITE = config.baseUrl || 'https://academy.avanasurgical.com';

// Certificate credentials for Microsoft Graph (used when the tenant blocks
// client secrets). The private key lives ONLY on the server, outside git;
// the matching public certificate is uploaded to the app registration.
const CERT_DIR = process.env.GRAPH_CERT_DIR || path.join(__dirname, '..', 'graphcert');
const certFiles = () => ({ key: path.join(CERT_DIR, 'key.pem'), crt: path.join(CERT_DIR, 'cert.pem') });
function certAvailable() {
  const f = certFiles();
  try { return fs.existsSync(f.key) && fs.existsSync(f.crt); } catch { return false; }
}

const b64u = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

// Signed JWT client assertion (RS256, x5t thumbprint header) per the
// Microsoft identity platform certificate-credential spec.
function clientAssertion(c) {
  const f = certFiles();
  const key = fs.readFileSync(f.key, 'utf8');
  const pem = fs.readFileSync(f.crt, 'utf8');
  const der = Buffer.from(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64');
  const x5t = b64u(crypto.createHash('sha1').update(der).digest());
  const now = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT', x5t }));
  const payload = b64u(JSON.stringify({
    aud: `https://login.microsoftonline.com/${c.tenant_id}/oauth2/v2.0/token`,
    iss: c.client_id, sub: c.client_id,
    jti: crypto.randomUUID(), nbf: now - 60, exp: now + 600,
  }));
  const data = header + '.' + payload;
  const sig = crypto.createSign('RSA-SHA256').update(data).sign(key);
  return data + '.' + b64u(sig);
}

// Outlook / Microsoft 365 notifications. The SMTP settings (incl. the app
// password) live in the settings table, managed from the admin Settings
// screen — never in git. Every send is fire-and-forget: a mail failure
// must never fail the nomination itself.

async function cfg(ignoreEnabled = false) {
  const { rows } = await query(`SELECT value FROM settings WHERE key='smtp'`);
  const c = rows.length ? rows[0].value : null;
  if (!c || (!c.enabled && !ignoreEnabled)) return null;
  if ((c.method || 'smtp') === 'graph') {
    return c.tenant_id && c.client_id && (c.client_secret || certAvailable()) ? c : null;
  }
  return c.user && c.pass ? c : null;
}

function transport(c) {
  return nodemailer.createTransport({
    host: c.host || 'smtp.office365.com',
    port: Number(c.port) || 587,
    secure: false,                 // STARTTLS on 587 (Microsoft 365)
    auth: { user: c.user, pass: c.pass },
  });
}

// Microsoft Graph (client credentials) — the path for tenants that have
// app passwords / SMTP AUTH disabled by security policy.
async function graphToken(c) {
  const body = new URLSearchParams({
    client_id: c.client_id,
    scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials',
  });
  if (c.client_secret) {
    body.set('client_secret', c.client_secret);
  } else {
    body.set('client_assertion_type', 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer');
    body.set('client_assertion', clientAssertion(c));
  }
  const r = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(c.tenant_id)}/oauth2/v2.0/token`, { method: 'POST', body });
  const d = await r.json();
  if (!d.access_token) throw new Error(d.error_description || 'Microsoft sign-in failed — check tenant ID, client ID and secret');
  return d.access_token;
}

async function sendGraph(c, to, subject, html) {
  const tok = await graphToken(c);
  const sender = c.from || c.user;
  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject,
        from: { emailAddress: { address: sender, name: c.from_name || 'Avana Academy' } },
        body: { contentType: 'HTML', content: html },
        toRecipients: [{ emailAddress: { address: to } }],
      },
      saveToSentItems: true,
    }),
  });
  if (!r.ok) {
    const txt = (await r.text()).slice(0, 300);
    throw new Error(`Microsoft Graph refused the mail (${r.status}): ${txt}`);
  }
}

async function sendMail(c, to, subject, html) {
  if ((c.method || 'smtp') === 'graph') return sendGraph(c, to, subject, html);
  await transport(c).sendMail({ from: `"${c.from_name || 'Avana Academy'}" <${c.from || c.user}>`, to, subject, html });
}

const esc = (s) => String(s || '').replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));

const fmtD = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : null);
const FOOT = `<p style="color:#8a7a5c;font-size:12px">Avana Academy · Learning &amp; Development · Avana Group · <a href="${SITE}">${SITE.replace('https://', '')}</a></p>`;
const LOGO = ''; // logo removed from e-mails by request
const SITE_BTN = `<p><a href="${SITE}" style="display:inline-block;background:#C8930A;color:#fff;text-decoration:none;padding:8px 18px;border-radius:8px;font-weight:600">Open the Avana Learning Hub</a></p>`;
const row = (k, v) => `<tr><td style="padding:3px 14px 3px 0;color:#8a7a5c;vertical-align:top">${k}</td><td>${v}</td></tr>`;

// Editable wording from Settings (merged over the defaults there).
async function templates() {
  const { DEFAULTS } = require('./routes/settings');
  const { rows } = await query(`SELECT value FROM settings WHERE key='email_templates'`);
  return { ...DEFAULTS.email_templates, ...(rows.length ? rows[0].value : {}) };
}

// Fill {placeholders}; drop "Label: " lines whose value came up empty;
// escape HTML and convert newlines for the mail body.
function fill(tpl, map, asHtml) {
  let out = String(tpl || '');
  for (const [k, v] of Object.entries(map)) out = out.split(`{${k}}`).join(v || '');
  if (!asHtml) return out;
  out = out.split('\n').filter((line) => !/^[^:\n]{1,40}:\s*$/.test(line.trim())).join('\n');
  return esc(out).replace(/\n/g, '<br>');
}

async function loadTraining(trainingId) {
  const { rows } = await query(
    `SELECT t.*, (SELECT min(d.day) FROM training_days d WHERE d.training_id=t.id) AS first_day,
            (SELECT max(d.day) FROM training_days d WHERE d.training_id=t.id) AS last_day,
            (SELECT count(*)::int FROM training_days d WHERE d.training_id=t.id) AS day_count
     FROM trainings t WHERE t.id=$1`, [trainingId]);
  if (!rows.length) return null;
  const t = rows[0];
  t._label = `${t.title}${t.batch ? ' — ' + t.batch : ''}`;
  t._dates = fmtD(t.first_day)
    ? (t.first_day === t.last_day ? fmtD(t.first_day) : `${fmtD(t.first_day)} → ${fmtD(t.last_day)}`)
    : 'dates to be announced';
  return t;
}

// One mail to every newly nominated/assigned employee (who has an e-mail),
// with a sign-in link to the hub.
async function notifyNomination({ trainingId, employeeIds, source, byName, slot }) {
  try {
    const c = await cfg();
    if (!c || !employeeIds.length) return;
    const tr = await loadTraining(trainingId);
    if (!tr) return;
    const verb = source === 'admin' ? 'assigned to' : 'nominated for';
    const bySrc = { self: 'Self-nomination', manager: `Nominated by your manager${byName ? `, ${byName}` : ''}`,
      leader: `Nominated by your leader${byName ? `, ${byName}` : ''}`, admin: `Assigned by L&D${byName ? ` (${byName})` : ''}` }[source] || '';
    const { rows: emps } = await query(
      'SELECT name, email FROM employees WHERE id = ANY($1::int[])', [employeeIds]);
    const tpl = await templates();
    const mapFor = (name) => ({
      name, kind: source === 'admin' ? 'assignment' : 'nomination', verb,
      training: tr._label, code: tr.code, dates: tr._dates, mode: tr.mode || '',
      slot: slot || '', how: bySrc,
    });
    for (const e of emps) {
      if (!e.email) continue;
      const map = mapFor(e.name);
      sendMail(c, e.email, fill(tpl.nominee_subject, map, false),
        `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#2b2317">
           ${LOGO}<p>${fill(tpl.nominee_body, map, true)}</p>${SITE_BTN}${FOOT}
         </div>`)
        .catch((err) => console.error('[mail]', e.email, err.message));
    }
  } catch (e) { console.error('[mail]', e.message); }
}

const inScope = (listStr, val) => {
  if (!listStr) return true;
  const list = listStr.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.includes(String(val || '').trim().toLowerCase());
};

// When the super admin opens self-nomination on a training, every eligible
// employee is invited with the nomination link.
async function announceSelfNomination(trainingId) {
  try {
    const c = await cfg();
    if (!c) return;
    const tr = await loadTraining(trainingId);
    if (!tr || !tr.nom_self || !tr.public_token) return;
    const { rows: emps } = await query(
      `SELECT e.id, e.name, e.email, e.department, e.division FROM employees e
       WHERE e.active AND e.email IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM training_participants p WHERE p.training_id=$1 AND p.employee_id=e.id)`,
      [trainingId]);
    const eligible = emps.filter((e) => inScope(tr.department, e.department) && inScope(tr.division, e.division));
    const link = `${SITE}/p/nom/${tr.public_token}`;
    const tpl = await templates();
    for (const e of eligible) {
      const map = {
        name: e.name, training: tr._label, code: tr.code, dates: tr._dates,
        mode: tr.mode || '', deadline: tr.nom_deadline ? fmtD(tr.nom_deadline) : '', link,
      };
      await sendMail(c, e.email, fill(tpl.announce_subject, map, false),
        `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#2b2317">
           ${LOGO}<p>${fill(tpl.announce_body, map, true)}</p>
           <p><a href="${link}" style="display:inline-block;background:#C8930A;color:#fff;text-decoration:none;padding:8px 18px;border-radius:8px;font-weight:600">Nominate myself</a></p>
           ${FOOT}
         </div>`)
        .catch((err) => console.error('[mail announce]', e.email, err.message));
    }
    console.log(`[mail] nomination announcement for ${tr.code} sent to ${eligible.length} employee(s)`);
  } catch (e) { console.error('[mail announce]', e.message); }
}

// Shared recipient mapping: managers get their own reportees on the
// training; leaders get the participants of their division.
async function recipientsFor(trainingId) {
  const { rows: parts } = await query(
    `SELECT e.id, e.name, e.email, e.zoho_emp_id, e.department, e.division, e.manager,
            n.slot, n.source
     FROM training_participants p JOIN employees e ON e.id = p.employee_id
     LEFT JOIN nominations n ON n.training_id = p.training_id AND n.employee_id = p.employee_id AND n.status='confirmed'
     WHERE p.training_id=$1 ORDER BY e.name`, [trainingId]);
  const { rows: dir } = await query(`SELECT name, email FROM employees WHERE active AND email IS NOT NULL`);
  const emailByName = {};
  dir.forEach((e) => { emailByName[e.name.trim().toLowerCase()] = e.email; });
  const mgrOf = (m) => String(m || '').replace(/^Mentor:\s*/i, '').trim();
  const managers = {};
  parts.forEach((p) => {
    const m = mgrOf(p.manager);
    if (m) (managers[m] = managers[m] || []).push(p);
  });
  const { rows: leaders } = await query(
    `SELECT u.name, u.email, e.division FROM users u
     LEFT JOIN employees e ON e.email = u.email
     WHERE u.role='leader' AND u.active`);
  return { parts, managers, emailByName, leaders };
}

const SRC_LABEL = { self: 'Self', manager: 'Manager', leader: 'Leader', admin: 'Admin' };

// After the nomination deadline: consolidated participant list to each
// manager (their team) and each leader (their division).
async function nominationDigest(trainingId) {
  const c = await cfg();
  if (!c) return false;
  const tr = await loadTraining(trainingId);
  if (!tr) return false;
  const { parts, managers, emailByName, leaders } = await recipientsFor(trainingId);
  const table = (list) => `
    <table style="border-collapse:collapse;font-size:13px;border:1px solid #e7ddc8">
      <tr style="background:#f6f0e2"><th style="padding:5px 10px;text-align:left">Employee</th>
        <th style="padding:5px 10px;text-align:left">ID</th><th style="padding:5px 10px;text-align:left">Department</th>
        <th style="padding:5px 10px;text-align:left">Slot</th><th style="padding:5px 10px;text-align:left">Nominated via</th></tr>
      ${list.map((p) => `<tr><td style="padding:4px 10px">${esc(p.name)}</td><td style="padding:4px 10px">${esc(p.zoho_emp_id || '—')}</td>
        <td style="padding:4px 10px">${esc(p.department || '—')}</td><td style="padding:4px 10px">${esc(p.slot || 'Any')}</td>
        <td style="padding:4px 10px">${SRC_LABEL[p.source] || 'Admin'}</td></tr>`).join('')}
    </table>`;
  const wrap = (who, intro, list) => `
    <div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#2b2317">
      ${LOGO}
      <p>Dear ${esc(who)},</p>
      <p>${intro} <b>${esc(tr._label)}</b> (${esc(tr.code)}, ${esc(tr._dates)}):</p>
      ${table(list)}
      <p>Please make sure they attend — attendance is recorded on the training day.</p>
      ${SITE_BTN}${FOOT}
    </div>`;
  for (const [mgr, list] of Object.entries(managers)) {
    const to = emailByName[mgr.toLowerCase()];
    if (to) await sendMail(c, to, `Your team on ${tr._label} — ${list.length} participant(s)`,
      wrap(mgr, 'Nominations have closed. These members of your team are confirmed for', list))
      .catch((err) => console.error('[mail digest]', to, err.message));
  }
  for (const l of leaders) {
    if (!l.email) continue;
    const list = l.division ? parts.filter((p) => p.division === l.division) : parts;
    if (!list.length) continue;
    await sendMail(c, l.email, `${l.division || 'All divisions'} on ${tr._label} — ${list.length} participant(s)`,
      wrap(l.name, `Nominations have closed. Confirmed participants from ${l.division ? 'your division (' + esc(l.division) + ')' : 'all divisions'} for`, list))
      .catch((err) => console.error('[mail digest]', l.email, err.message));
  }
  await query('UPDATE trainings SET nom_digest_sent=TRUE WHERE id=$1', [trainingId]);
  console.log(`[mail] nomination digest sent for ${tr.code}`);
  return true;
}

// After the training completes: attendance status per participant to the
// managers (their team) and leaders (their division).
async function attendanceDigest(trainingId) {
  const c = await cfg();
  if (!c) return false;
  const tr = await loadTraining(trainingId);
  if (!tr) return false;
  const { rows: att } = await query(
    `SELECT employee_id, sum(CASE mark WHEN 'P' THEN 1 WHEN 'H' THEN 0.5 ELSE 0 END)::float AS units,
            count(*)::int AS marked
     FROM attendance WHERE training_id=$1 GROUP BY employee_id`, [trainingId]);
  const attMap = {};
  att.forEach((a) => { attMap[a.employee_id] = a; });
  const { parts, managers, emailByName, leaders } = await recipientsFor(trainingId);
  const statusOf = (p) => {
    const a = attMap[p.id];
    if (!a || a.units <= 0) return ['Not attended', '#B3261E'];
    const pct = tr.day_count ? Math.round((a.units / tr.day_count) * 100) : 100;
    return [`Attended · ${pct}%${pct < 75 ? ' (below 75%)' : ''}`, pct >= 75 ? '#2E7D32' : '#A8720E'];
  };
  const table = (list) => `
    <table style="border-collapse:collapse;font-size:13px;border:1px solid #e7ddc8">
      <tr style="background:#f6f0e2"><th style="padding:5px 10px;text-align:left">Employee</th>
        <th style="padding:5px 10px;text-align:left">ID</th><th style="padding:5px 10px;text-align:left">Department</th>
        <th style="padding:5px 10px;text-align:left">Attendance</th></tr>
      ${list.map((p) => { const [s, col] = statusOf(p); return `<tr><td style="padding:4px 10px">${esc(p.name)}</td>
        <td style="padding:4px 10px">${esc(p.zoho_emp_id || '—')}</td><td style="padding:4px 10px">${esc(p.department || '—')}</td>
        <td style="padding:4px 10px;color:${col};font-weight:600">${s}</td></tr>`; }).join('')}
    </table>`;
  const wrap = (who, scope, list) => `
    <div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#2b2317">
      ${LOGO}
      <p>Dear ${esc(who)},</p>
      <p><b>${esc(tr._label)}</b> (${esc(tr.code)}, ${esc(tr._dates)}) is completed. Attendance for ${scope}:</p>
      ${table(list)}
      <p>Please follow up with anyone who did not attend.</p>
      ${SITE_BTN}${FOOT}
    </div>`;
  for (const [mgr, list] of Object.entries(managers)) {
    const to = emailByName[mgr.toLowerCase()];
    if (to) await sendMail(c, to, `Attendance — ${tr._label} (your team)`, wrap(mgr, 'your team', list))
      .catch((err) => console.error('[mail att]', to, err.message));
  }
  for (const l of leaders) {
    if (!l.email) continue;
    const list = l.division ? parts.filter((p) => p.division === l.division) : parts;
    if (!list.length) continue;
    await sendMail(c, l.email, `Attendance — ${tr._label} (${l.division || 'all divisions'})`,
      wrap(l.name, l.division ? `your division (${esc(l.division)})` : 'all divisions', list))
      .catch((err) => console.error('[mail att]', l.email, err.message));
  }
  await query('UPDATE trainings SET att_digest_sent=TRUE WHERE id=$1', [trainingId]);
  console.log(`[mail] attendance digest sent for ${tr.code}`);
  return true;
}

// Hourly: send the nomination digest for every training whose deadline has
// passed and that has not had one yet.
async function runDigests() {
  const c = await cfg();
  if (!c) return;
  const { rows } = await query(
    `SELECT id FROM trainings
     WHERE (nom_self OR nom_manager OR nom_leader) AND nom_deadline IS NOT NULL
       AND nom_deadline < current_date AND NOT nom_digest_sent AND status <> 'cancelled'`);
  for (const r of rows) await nominationDigest(r.id).catch((e) => console.error('[digest]', e.message));
}

// Settings-screen test button — works even before sending is enabled, so
// credentials can be verified first.
async function sendTest() {
  const c = await cfg(true);
  if (!c) {
    throw new Error('Credentials are incomplete — for Graph: tenant ID + client ID plus a client secret or the server certificate; for SMTP: mailbox + app password.');
  }
  const to = c.notify || c.user;
  await sendMail(c, to, 'Avana Academy — test e-mail',
    `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#2b2317">${LOGO}
     <p>This is a test from the Avana Learning Hub. Outlook notifications are working. ✓</p>${FOOT}</div>`);
  return to;
}

module.exports = {
  notifyNomination, announceSelfNomination, nominationDigest, attendanceDigest,
  runDigests, sendTest, certAvailable,
};
