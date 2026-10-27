const crypto = require('crypto');
const { query } = require('./db');

// Outlook / Teams calendar blocking for training participants.
//
// When a training has cal_block on, every participant (with an e-mail) gets
// their OWN meeting invitation from the academy mailbox, so adding or
// removing one person never notifies anyone else. Consecutive training days
// become one daily-recurring invitation; separate runs of days get separate
// invitations. Each slot = start_time (default 09:30 IST) + hours_per_day.
// What was sent is fingerprinted, so a sync only touches people whose
// invitation actually changed. Removed people (or a cancelled / postponed
// training) get a cancellation. Completed trainings are never touched.

const TZ = 'India Standard Time';
const DEFAULT_START = '09:30';
const mailer = () => require('./mailer');

async function graph() {
  const m = mailer();
  const c = await m.cfg(true);
  if (!c || (c.method || 'smtp') !== 'graph') {
    throw new Error('Microsoft 365 is not connected — Settings → E-mail notifications');
  }
  const tok = await m.graphToken(c);
  const mailbox = c.from || c.user;
  const base = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/events`;
  const call = async (method, path, body) => {
    const r = await fetch(base + path, {
      method,
      headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 202 || r.status === 204) return null;
    const txt = await r.text();
    if (!r.ok) {
      const e = new Error(`Microsoft 365 refused the calendar update (${r.status}): ${txt.slice(0, 200)}`);
      e.status = r.status;
      throw e;
    }
    return txt ? JSON.parse(txt) : null;
  };
  return { call, mailbox };
}

const validTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || ''));
const addMinutes = (hhmm, mins) => {
  const [h, m] = hhmm.split(':').map(Number);
  const t = Math.min(h * 60 + m + Math.round(mins), 23 * 60 + 59);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};
const nextDay = (iso) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
// ['2026-11-02','2026-11-03','2026-11-05'] → [['2026-11-02','2026-11-03'], ['2026-11-05']]
function runsOf(days) {
  const runs = [];
  for (const d of [...new Set(days)].sort()) {
    const last = runs[runs.length - 1];
    if (last && nextDay(last[last.length - 1]) === d) last.push(d);
    else runs.push([d]);
  }
  return runs;
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

// The invitation body: the same training details as the assignment e-mail.
function bodyHtml(t, info, start, end, site) {
  const row = (k, v) => (v ? `<tr><td style="padding:3px 16px 3px 0;color:#8a7a5c;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:3px 0;font-weight:600">${v}</td></tr>` : '');
  const link = t.online_link ? `<a href="${esc(t.online_link)}">${esc(t.online_link)}</a>` : '';
  return `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#2b2317">
    <p>This invitation blocks your calendar for the training below. Please accept it — attendance is recorded on the training day.</p>
    <table style="border-collapse:collapse;font-size:14px">
      ${row('Training', esc(info.training))}${row('Training code', esc(info.code))}
      ${row('Dates', esc(info.dates))}${row('Daily time', esc(`${start} – ${end} IST`))}
      ${row('Duration', esc(info.duration))}${row('Location', esc(info.location))}
      ${row('Training mode', esc(info.mode))}${row('Trainer', esc(info.trainer))}${row('Online meeting link', link)}
    </table>
    <p style="color:#8a7a5c;font-size:12px">Avana Academy · Learning &amp; Development · <a href="${site}">${site.replace('https://', '')}</a></p>
  </div>`;
}

function payloads(t, info, person, site) {
  const start = validTime(t.start_time) ? t.start_time : DEFAULT_START;
  const end = addMinutes(start, (Number(t.hours_per_day) || 1) * 60);
  const location = [t.location, t.online_link ? 'Online meeting (link in the invitation)' : null].filter(Boolean).join(' · ')
    || (String(t.mode || '').toLowerCase() === 'online' ? 'Online' : 'To be announced');
  return runsOf(t.days || []).map((run) => ({
    subject: `Training: ${info.training}`,
    body: { contentType: 'HTML', content: bodyHtml(t, info, start, end, site) },
    start: { dateTime: `${run[0]}T${start}:00`, timeZone: TZ },
    end: { dateTime: `${run[0]}T${end}:00`, timeZone: TZ },
    location: { displayName: location },
    attendees: [{ emailAddress: { address: person.email, name: person.name }, type: 'required' }],
    showAs: 'busy',
    isReminderOn: true,
    reminderMinutesBeforeStart: 60,
    responseRequested: true,
    allowNewTimeProposals: false,
    recurrence: run.length > 1 ? {
      pattern: { type: 'daily', interval: 1 },
      range: { type: 'numbered', startDate: run[0], numberOfOccurrences: run.length, recurrenceTimeZone: TZ },
    } : null,
  }));
}

async function cancelEvents(g, ids, comment) {
  for (const id of ids || []) {
    try {
      await g.call('POST', `/${encodeURIComponent(id)}/cancel`, { comment });
    } catch (e) {
      if (e.status === 404) continue;                       // already gone
      // Not cancellable (e.g. no attendees left) — just remove it.
      try { await g.call('DELETE', `/${encodeURIComponent(id)}`); } catch (e2) { if (e2.status !== 404) throw e; }
    }
  }
}

async function loadTraining(tid) {
  const { rows } = await query(
    `SELECT t.*, (SELECT json_agg(to_char(d.day, 'YYYY-MM-DD') ORDER BY d.day) FROM training_days d WHERE d.training_id=t.id) AS days
     FROM trainings t WHERE t.id=$1`, [tid]);
  return rows[0] || null;
}

async function syncTraining(tid) {
  const t = await loadTraining(tid);
  if (!t || t.status === 'completed') return;
  const { rows: invites } = await query('SELECT * FROM cal_invites WHERE training_id=$1', [tid]);
  const want = t.cal_block && !['cancelled', 'postponed'].includes(t.status) && (t.days || []).length > 0;
  if (!want && !invites.length) {
    if (t.cal_error) await query('UPDATE trainings SET cal_error=NULL WHERE id=$1', [tid]);
    return;
  }
  const g = await graph();
  const label = `${t.title}${t.batch ? ' — ' + t.batch : ''}`;
  const { rows: parts } = want ? await query(
    `SELECT e.id, e.name, lower(btrim(e.email)) AS email FROM training_participants p
     JOIN employees e ON e.id = p.employee_id
     WHERE p.training_id=$1 AND coalesce(btrim(e.email), '') <> ''`, [tid]) : { rows: [] };
  const byEmp = new Map(parts.map((p) => [p.id, p]));
  let errors = 0;

  // People no longer on the training (or the whole training withdrawn).
  const reason = !want
    ? (t.status === 'cancelled' ? `The training "${label}" has been cancelled.`
      : t.status === 'postponed' ? `The training "${label}" has been postponed — a new invitation will follow when it is rescheduled.`
      : `Calendar invitations for "${label}" have been withdrawn.`)
    : `You are no longer a participant of "${label}".`;
  for (const inv of invites) {
    const p = byEmp.get(inv.employee_id);
    if (p && p.email === inv.email) continue;
    try {
      await cancelEvents(g, inv.event_ids, reason);
      await query('DELETE FROM cal_invites WHERE training_id=$1 AND employee_id=$2', [tid, inv.employee_id]);
    } catch (e) {
      errors++;
      await query('UPDATE cal_invites SET error=$3, synced_at=now() WHERE training_id=$1 AND employee_id=$2',
        [tid, inv.employee_id, String(e.message).slice(0, 300)]);
    }
  }

  if (want) {
    const tr = await mailer().loadTraining(tid);
    const fields = mailer().trainingFields(tr);
    const site = require('./config').baseUrl || 'https://academy.avanasurgical.com';
    for (const p of parts) {
      const pls = payloads(t, fields, p, site);
      const fp = crypto.createHash('sha1').update(JSON.stringify(pls)).digest('hex');
      const inv = invites.find((i) => i.employee_id === p.id && i.email === p.email);
      if (inv && inv.fingerprint === fp && !inv.error) continue;
      try {
        let ids = null;
        if (inv && inv.event_ids.length && inv.event_ids.length === pls.length) {
          // Same shape: update each invitation in place (attendee unchanged).
          ids = [];
          for (let k = 0; k < pls.length; k++) {
            const { attendees, ...upd } = pls[k];
            try {
              await g.call('PATCH', `/${encodeURIComponent(inv.event_ids[k])}`, upd);
              ids.push(inv.event_ids[k]);
            } catch (e) {
              if (e.status !== 404) throw e;
              const ev = await g.call('POST', '', pls[k]);        // deleted meanwhile: re-create
              ids.push(ev.id);
            }
          }
        } else {
          if (inv && inv.event_ids.length) await cancelEvents(g, inv.event_ids, `The schedule of "${label}" changed — an updated invitation follows.`);
          ids = [];
          for (const [k, pl] of pls.entries()) {
            const ev = await g.call('POST', '', { ...pl, transactionId: `hub-${tid}-${p.id}-${k}-${fp.slice(0, 12)}` });
            ids.push(ev.id);
          }
        }
        await query(
          `INSERT INTO cal_invites (training_id, employee_id, email, event_ids, fingerprint, synced_at, error)
           VALUES ($1,$2,$3,$4,$5,now(),NULL)
           ON CONFLICT (training_id, employee_id)
           DO UPDATE SET email=$3, event_ids=$4, fingerprint=$5, synced_at=now(), error=NULL`,
          [tid, p.id, p.email, JSON.stringify(ids), fp]);
      } catch (e) {
        errors++;
        await query(
          `INSERT INTO cal_invites (training_id, employee_id, email, event_ids, fingerprint, synced_at, error)
           VALUES ($1,$2,$3,$4,NULL,now(),$5)
           ON CONFLICT (training_id, employee_id) DO UPDATE SET synced_at=now(), error=$5`,
          [tid, p.id, p.email, JSON.stringify(inv ? inv.event_ids : []), String(e.message).slice(0, 300)]);
      }
    }
  }
  await query('UPDATE trainings SET cal_synced_at=now(), cal_error=$2 WHERE id=$1',
    [tid, errors ? `${errors} invitation(s) could not be sent or updated — use Re-sync to retry.` : null]);
}

// ---- scheduling: changes made in quick succession go out in one pass ----
const timers = new Map();
const running = new Map();

function runNow(tid) {
  const prev = running.get(tid) || Promise.resolve();
  const next = prev.then(() => syncTraining(tid)).catch(async (e) => {
    console.error('[calendar]', tid, e.message);
    await query('UPDATE trainings SET cal_error=$2, cal_synced_at=now() WHERE id=$1', [tid, String(e.message).slice(0, 300)]).catch(() => {});
  });
  running.set(tid, next);
  next.finally(() => { if (running.get(tid) === next) running.delete(tid); });
  return next;
}

function schedule(tid, delayMs = 4000) {
  clearTimeout(timers.get(tid));
  timers.set(tid, setTimeout(() => { timers.delete(tid); runNow(tid); }, delayMs));
}

// Before a training is deleted: withdraw every invitation (throws on failure
// so the deletion can be stopped rather than leaving orphan invitations).
async function cancelAll(tid) {
  const { rows: invites } = await query('SELECT * FROM cal_invites WHERE training_id=$1', [tid]);
  if (!invites.length) return;
  const t = await loadTraining(tid);
  const g = await graph();
  for (const inv of invites) {
    await cancelEvents(g, inv.event_ids, `The training "${t ? t.title : ''}" has been removed.`);
    await query('DELETE FROM cal_invites WHERE training_id=$1 AND employee_id=$2', [tid, inv.employee_id]);
  }
}

// Hourly: retry trainings whose last sync left errors.
async function retryFailed() {
  try {
    const { rows } = await query(
      `SELECT id FROM trainings WHERE cal_error IS NOT NULL AND status NOT IN ('completed')
         AND EXISTS (SELECT 1 FROM training_days d WHERE d.training_id=trainings.id AND d.day >= current_date)`);
    for (const r of rows) await runNow(r.id);
  } catch (e) { console.error('[calendar retry]', e.message); }
}

module.exports = { schedule, runNow, cancelAll, retryFailed, runsOf, payloads, validTime, DEFAULT_START };
