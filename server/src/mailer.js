const nodemailer = require('nodemailer');
const { query } = require('./db');

// Outlook / Microsoft 365 notifications. The SMTP settings (incl. the app
// password) live in the settings table, managed from the admin Settings
// screen — never in git. Every send is fire-and-forget: a mail failure
// must never fail the nomination itself.

async function cfg() {
  const { rows } = await query(`SELECT value FROM settings WHERE key='smtp'`);
  const c = rows.length ? rows[0].value : null;
  if (!c || !c.enabled) return null;
  if ((c.method || 'smtp') === 'graph') {
    return c.tenant_id && c.client_id && c.client_secret ? c : null;
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
    client_id: c.client_id, client_secret: c.client_secret,
    scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials',
  });
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
  await transport(c).sendMail({ from: c.from || c.user, to, subject, html });
}

const esc = (s) => String(s || '').replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));

// One mail to every newly nominated/assigned employee (who has an e-mail),
// plus a summary copy to the L&D notify address.
async function notifyNomination({ trainingId, employeeIds, source, byName, slot }) {
  try {
    const c = await cfg();
    if (!c || !employeeIds.length) return;
    const { rows: t } = await query(
      `SELECT t.code, t.title, t.batch, t.mode,
              (SELECT min(d.day) FROM training_days d WHERE d.training_id=t.id) AS first_day,
              (SELECT max(d.day) FROM training_days d WHERE d.training_id=t.id) AS last_day
       FROM trainings t WHERE t.id=$1`, [trainingId]);
    if (!t.length) return;
    const tr = t[0];
    const fmt = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : null);
    const dates = fmt(tr.first_day)
      ? (tr.first_day === tr.last_day ? fmt(tr.first_day) : `${fmt(tr.first_day)} → ${fmt(tr.last_day)}`)
      : 'dates to be announced';
    const label = `${tr.title}${tr.batch ? ' — ' + tr.batch : ''}`;
    const verb = source === 'admin' ? 'assigned to' : 'nominated for';
    const bySrc = { self: 'Self-nomination', manager: `Nominated by your manager${byName ? `, ${byName}` : ''}`,
      leader: `Nominated by your leader${byName ? `, ${byName}` : ''}`, admin: `Assigned by L&D${byName ? ` (${byName})` : ''}` }[source] || '';
    const { rows: emps } = await query(
      'SELECT name, email FROM employees WHERE id = ANY($1::int[])', [employeeIds]);
    const html = (name) => `
      <div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#2b2317">
        <p>Dear ${esc(name)},</p>
        <p>You have been <b>${verb}</b> the training below:</p>
        <table style="border-collapse:collapse;font-size:14px">
          <tr><td style="padding:3px 14px 3px 0;color:#8a7a5c">Training</td><td><b>${esc(label)}</b> (${esc(tr.code)})</td></tr>
          <tr><td style="padding:3px 14px 3px 0;color:#8a7a5c">Dates</td><td>${esc(dates)}</td></tr>
          ${tr.mode ? `<tr><td style="padding:3px 14px 3px 0;color:#8a7a5c">Mode</td><td>${esc(tr.mode)}</td></tr>` : ''}
          ${slot ? `<tr><td style="padding:3px 14px 3px 0;color:#8a7a5c">Preferred slot</td><td>${esc(slot)}</td></tr>` : ''}
          <tr><td style="padding:3px 14px 3px 0;color:#8a7a5c">How</td><td>${esc(bySrc)}</td></tr>
        </table>
        <p>Please block the dates in your calendar. Attendance is recorded on the training day.</p>
        <p style="color:#8a7a5c;font-size:12px">Avana Learning Hub · Learning &amp; Development · Avana Group</p>
      </div>`;
    for (const e of emps) {
      if (e.email) sendMail(c, e.email, `Training ${source === 'admin' ? 'assignment' : 'nomination'} — ${label}`, html(e.name))
        .catch((err) => console.error('[mail]', e.email, err.message));
    }
    if (c.notify) {
      const list = emps.map((e) => `<li>${esc(e.name)}${e.email ? ` &lt;${esc(e.email)}&gt;` : ' (no e-mail on record)'}</li>`).join('');
      sendMail(c, c.notify, `Nomination update — ${label}`,
        `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px">
           <p>${emps.length} employee(s) ${verb} <b>${esc(label)}</b> (${esc(dates)}) — ${esc(bySrc)}.</p>
           <ul>${list}</ul>
           <p style="color:#8a7a5c;font-size:12px">Avana Learning Hub</p>
         </div>`)
        .catch((err) => console.error('[mail notify]', err.message));
    }
  } catch (e) { console.error('[mail]', e.message); }
}

// Settings-screen test button.
async function sendTest() {
  const c = await cfg();
  if (!c) throw new Error('E-mail is not enabled or the password is missing — save the SMTP settings first.');
  const to = c.notify || c.user;
  await sendMail(c, to, 'Avana Learning Hub — test e-mail',
    '<p>This is a test from the Avana Learning Hub. Outlook notifications are working. ✓</p>');
  return to;
}

module.exports = { notifyNomination, sendTest };
