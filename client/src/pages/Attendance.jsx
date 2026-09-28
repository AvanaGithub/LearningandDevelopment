import React, { useEffect, useState } from 'react';
import { api, fmtDay, fmtDate, fmtRange } from '../api.js';
import { useAuth, useToast } from '../App.jsx';
import { toXlsx, readSheet } from '../xlsx.js';
import QrModal from '../components/QrModal.jsx';
import MSel from '../components/MSel.jsx';

const CYCLE = { '': 'P', P: 'A', A: 'H', H: '' };

// Excel import: one row per participant, one column per date (header = the
// date). Cells P/Present, A/Absent, H/Half. Rows map to the participant
// list by Zoho ID, name or e-mail; only this training's dates are used.
function AttImport({ t, participants, onClose, onDone }) {
  const [sheet, setSheet] = useState(null);
  const [idCol, setIdCol] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const trnDays = (t.days || []).map((d) => d.slice(0, 10));

  const pick = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const aoa = await readSheet(f);
      const headers = (aoa[0] || []).map((h) => String(h).trim());
      const rows = aoa.slice(1).filter((r) => r.some((c) => String(c).trim() !== ''));
      if (!headers.length || !rows.length) throw new Error('The first sheet needs a header row plus data rows.');
      const dateCols = headers.map((h, i) => {
        const ts = Date.parse(h);
        return isNaN(ts) ? null : { i, day: new Date(ts).toISOString().slice(0, 10) };
      }).filter(Boolean);
      const matched = dateCols.filter((d) => trnDays.includes(d.day));
      if (!matched.length) {
        throw new Error(`No column matches this training's dates (${trnDays.map(fmtDate).join(', ')}) — column headers must be dates.`);
      }
      const guess = headers.findIndex((h) => /emp|id|name|participant|mail/i.test(h));
      setIdCol(guess >= 0 ? guess : 0);
      setSheet({ headers, rows, dateCols: matched, ignored: dateCols.length - matched.length });
    } catch (e2) { setErr(e2.message); }
  };

  const markOf = (v) => {
    const s = String(v).trim().toLowerCase();
    if (!s) return null;
    if (/^(p|present|1|yes|y)$/.test(s)) return 'P';
    if (/^(a|absent|0|no|n)$/.test(s)) return 'A';
    if (/^(h|half|hd|0\.5)$/.test(s)) return 'H';
    return null;
  };

  const run = async () => {
    setBusy(true); setErr(null);
    let set = 0, unmatched = 0, blank = 0;
    try {
      for (const r of sheet.rows) {
        const key = String(r[idCol] || '').trim().toLowerCase();
        const p = participants.find((x) =>
          (x.zoho_emp_id || '').toLowerCase() === key ||
          x.name.toLowerCase() === key ||
          (x.email || '').toLowerCase() === key);
        if (!p) { unmatched++; continue; }
        for (const { i, day } of sheet.dateCols) {
          const mark = markOf(r[i]);
          if (!mark) { blank++; continue; }
          await api.put('/api/attendance/' + t.id, { employee_id: p.id, day, mark, reason: 'Imported from Excel' });
          set++;
        }
      }
      onDone(`${set} mark(s) imported${unmatched ? ` · ${unmatched} row(s) skipped (not in the participant list)` : ''}${blank ? ` · ${blank} empty/unreadable cell(s) skipped` : ''}. Existing marks were only added to or updated, never removed.`);
    } catch (e2) { setErr(e2.message); setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Import attendance — {t.title}</h3>
        {!sheet ? (
          <>
            <p className="muted mini">One row per participant, one column per date (header = the date, e.g. 01-Oct-2026).
              Cells: P/Present, A/Absent, H/Half. Rows are matched to this training's participant list by Zoho ID, name or e-mail.</p>
            <input type="file" accept=".xlsx,.xls,.csv" onChange={pick} style={{ marginTop: 8 }} />
          </>
        ) : (
          <>
            <div className="form-grid">
              <div><label>Participant column (Zoho ID / Name / E-mail)</label>
                <select value={idCol} onChange={(e) => setIdCol(Number(e.target.value))}>
                  {sheet.headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                </select></div>
            </div>
            <p className="muted mini" style={{ marginTop: 8 }}>
              {sheet.rows.length} row(s) · {sheet.dateCols.length} date column(s) matching this training:
              {' '}{sheet.dateCols.map((d) => fmtDay(d.day)).join(', ')}
              {sheet.ignored ? ` · ${sheet.ignored} other date column(s) ignored (not this training's dates)` : ''}
            </p>
          </>
        )}
        {err && <p className="err">{err}</p>}
        <div className="form-actions">
          {sheet && <button className="btn gold" disabled={busy} onClick={run}>{busy ? 'Importing…' : 'Import attendance'}</button>}
          <button className="btn" disabled={busy} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default function Attendance() {
  const { user: me } = useAuth();
  const toast = useToast();
  const isAdmin = me.role === 'admin' || me.role === 'super_admin';
  const [list, setList] = useState(null);         // trainings with days
  const [selIds, setSelIds] = useState([]);       // filter: empty = all
  const [data, setData] = useState({});           // id -> {detail, marks:{empId|day:mark}}
  const [editing, setEditing] = useState(null);   // {tid, emp, marks:{day:m}, reason}
  const [importing, setImporting] = useState(null); // training being imported into
  const [qr, setQr] = useState(null);
  const [err, setErr] = useState(null);

  const doExport = () => {
    const out = [];
    shown.forEach((t) => {
      const d = data[t.id];
      if (!d) return;
      const days = (t.days || []).map((x) => x.slice(0, 10));
      d.detail.participants.forEach((p) => {
        const pc = pct(t.id, p.id, days);
        out.push([t.title, t.batch || '', fmtRange(t.days), p.name,
          days.map((day) => `${fmtDay(day)}: ${d.marks[p.id + '|' + day] || '–'}`).join(' | '),
          pc === null ? '—' : pc + '%']);
      });
    });
    toXlsx('Attendance.xlsx', ['Training', 'Batch', 'Dates', 'Participant', 'Day-wise marks', 'Percent'], out, 'Attendance');
  };

  useEffect(() => {
    api.get('/api/trainings').then((rows) =>
      setList(rows.filter((t) => (t.days || []).length && t.participant_count > 0 && t.status !== 'cancelled')))
      .catch((e) => setErr(e.message));
  }, []);

  const shown = (list || []).filter((t) => !selIds.length || selIds.includes(t.id));

  const loadOne = async (id) => {
    const [detail, marks] = await Promise.all([
      api.get('/api/trainings/' + id),
      api.get('/api/attendance/' + id),
    ]);
    const m = {}; const meta = {};
    marks.forEach((r) => {
      const k = r.employee_id + '|' + r.day.slice(0, 10);
      m[k] = r.mark;
      meta[k] = { label: `${r.mark} · ${new Date(r.updated_at).toLocaleString('en-IN')} · ${r.marked_by}`, ts: r.updated_at, by: r.marked_by };
    });
    setData((d) => ({ ...d, [id]: { detail, marks: m, meta } }));
  };
  useEffect(() => { shown.forEach((t) => { if (!data[t.id]) loadOne(t.id).catch((e) => setErr(e.message)); }); }, [list, selIds]);

  const setMark = async (tid, empId, day, mark, reason) => {
    await api.put('/api/attendance/' + tid, { employee_id: empId, day, mark: mark || null, reason });
    setData((d) => {
      const cur = { ...d[tid].marks };
      if (mark) cur[empId + '|' + day] = mark; else delete cur[empId + '|' + day];
      return { ...d, [tid]: { ...d[tid], marks: cur } };
    });
  };

  const cycle = (tid, empId, day) => {
    if (!isAdmin) { toast('View-only in this role — attendance is marked by the organizer.'); return; }
    const cur = data[tid].marks[empId + '|' + day] || '';
    setMark(tid, empId, day, CYCLE[cur]).catch((e) => setErr(e.message));
  };

  const markAll = async (tid) => {
    try {
      await api.post(`/api/attendance/${tid}/mark-all`);
      await loadOne(tid);
      toast('All participants marked present — logged to the audit trail.');
    } catch (e) { setErr(e.message); }
  };

  const pct = (tid, empId, days) => {
    const marks = days.map((d) => data[tid].marks[empId + '|' + d.slice(0, 10)]);
    if (marks.every((m) => !m)) return null;
    const units = marks.reduce((s, m) => s + (m === 'P' ? 1 : m === 'H' ? 0.5 : 0), 0);
    return Math.round((units / days.length) * 100);
  };

  const saveEdit = async () => {
    try {
      const { tid, emp, marks, orig, reason } = editing;
      for (const day of Object.keys(marks)) {
        if (marks[day] !== orig[day]) await setMark(tid, emp.id, day, marks[day], reason);
      }
      toast('Correction saved — reason recorded in the audit trail.');
      setEditing(null);
    } catch (e) { setErr(e.message); }
  };

  return (
    <>
      <div className="page-head"><h2>Attendance</h2></div>
      <p className="muted" style={{ marginBottom: 12, fontSize: 12 }}>
        – not marked · P present · A absent · H half-day. {isAdmin ? 'Click a cell to cycle, or use Edit for a correction with a recorded reason.' : 'View-only for your role.'} Eligibility assumes minimum 75% attendance.
      </p>
      <div className="toolbar">
        <MSel label="Trainings" sel={selIds} onChange={setSelIds}
          options={(list || []).map((t) => ({ v: t.id, t: `${t.title}${t.batch ? ' — ' + t.batch : ''} (${fmtRange(t.days)})` }))} />
        <span style={{ flex: 1 }} />
        {isAdmin && <button className="btn" onClick={doExport}>⬇ Export</button>}
      </div>
      {qr && <QrModal {...qr} onClose={() => setQr(null)} />}
      {err && <p className="err">{err}</p>}
      {!list ? <p className="muted">Loading…</p> :
        !shown.length ? <p className="muted">No trainings with participants yet — plan a training and add participants first.</p> :
          shown.map((t) => {
            const d = data[t.id];
            if (!d) return <div key={t.id} className="card muted">Loading {t.title}…</div>;
            const days = (t.days || []).map((x) => x.slice(0, 10));
            return (
              <div key={t.id} className="card" style={{ overflowX: 'auto' }}>
                <div className="toolbar" style={{ alignItems: 'center', marginBottom: 8 }}>
                  <b style={{ fontFamily: 'Fira Sans' }}>{t.title}{t.batch ? ' — ' + t.batch : ''}</b>
                  <span className="pill soft mini">{fmtRange(t.days)}</span>
                  <span style={{ flex: 1 }} />
                  {isAdmin && t.public_token && (
                    <button className="btn" onClick={() => setQr({
                      title: 'QR check-in — ' + t.title,
                      url: `${location.origin}/p/att/${t.public_token}`,
                      desc: 'Display this at the venue. A participant scans it, picks their name and is marked Present — tagged to this training automatically.',
                    })}>▦ QR check-in</button>
                  )}
                  {isAdmin && <button className="btn" onClick={() => setImporting(t)}>⬆ Import</button>}
                  {isAdmin && <button className="btn" onClick={() => markAll(t.id)}>✓ Mark all present</button>}
                </div>
                <table style={{ minWidth: 480 }}>
                  <thead><tr>
                    <th>Participant</th>
                    {days.map((day) => <th key={day}>{fmtDay(day)}</th>)}
                    <th style={{ textAlign: 'right' }}>%</th><th>Eligible</th><th>Last marked</th>{isAdmin && <th></th>}
                  </tr></thead>
                  <tbody>
                    {d.detail.participants.map((p) => {
                      const pc = pct(t.id, p.id, days);
                      return (
                        <tr key={p.id}>
                          <td>{p.name}</td>
                          {days.map((day) => {
                            const m = d.marks[p.id + '|' + day] || '–';
                            return <td key={day}>
                              <button className={'attcell ' + (m === '–' ? '' : m)}
                                title={d.meta?.[p.id + '|' + day]?.label || 'Not marked'}
                                onClick={() => cycle(t.id, p.id, day)}>{m}</button>
                            </td>;
                          })}
                          <td style={{ textAlign: 'right' }}>{pc === null ? '—' : pc + '%'}</td>
                          <td>{pc === null ? <span className="pill soft mini">Not marked</span>
                            : pc >= 75 ? <span className="pill good mini">Eligible</span>
                              : <span className="pill crit mini">Below 75%</span>}</td>
                          <td className="muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{(() => {
                            const metas = days.map((day) => d.meta?.[p.id + '|' + day]).filter(Boolean);
                            if (!metas.length) return '—';
                            const last = metas.reduce((a, b) => (a.ts > b.ts ? a : b));
                            return `${new Date(last.ts).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${last.by}`;
                          })()}</td>
                          {isAdmin && <td><button className="btn link" onClick={() => {
                            const orig = {};
                            days.forEach((day) => { orig[day] = d.marks[p.id + '|' + day] || ''; });
                            setEditing({ tid: t.id, emp: p, days, marks: { ...orig }, orig, reason: '' });
                          }}>Edit</button></td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}

      {importing && data[importing.id] && (
        <AttImport t={importing} participants={data[importing.id].detail.participants}
          onClose={() => setImporting(null)}
          onDone={(msg) => { const tid = importing.id; setImporting(null); toast(msg); loadOne(tid).catch((e) => setErr(e.message)); }} />
      )}

      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Edit attendance — {editing.emp.name}</h3>
            <div className="form-grid">
              {editing.days.map((day) => (
                <div key={day}><label>{fmtDay(day)}</label>
                  <select value={editing.marks[day]} onChange={(e) => setEditing({ ...editing, marks: { ...editing.marks, [day]: e.target.value } })}>
                    <option value="">– not marked</option><option value="P">P — present</option>
                    <option value="A">A — absent</option><option value="H">H — half-day</option>
                  </select></div>
              ))}
            </div>
            <div style={{ marginTop: 12 }}>
              <label className="muted mini">Reason for correction (required — goes to the audit trail)</label>
              <input autoFocus style={{ width: '100%', marginTop: 4 }} value={editing.reason}
                onChange={(e) => setEditing({ ...editing, reason: e.target.value })}
                placeholder="e.g. was present, forgot to scan" />
            </div>
            <div className="form-actions">
              <button className="btn gold" disabled={!editing.reason.trim()} onClick={saveEdit}>Save correction</button>
              <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
