import React, { useEffect, useState } from 'react';
import { api, fmtDay, fmtRange } from '../api.js';
import { useAuth, useToast } from '../App.jsx';

const CYCLE = { '': 'P', P: 'A', A: 'H', H: '' };

export default function Attendance() {
  const { user: me } = useAuth();
  const toast = useToast();
  const isAdmin = me.role === 'admin' || me.role === 'super_admin';
  const [list, setList] = useState(null);         // trainings with days
  const [selIds, setSelIds] = useState([]);       // filter: empty = all
  const [data, setData] = useState({});           // id -> {detail, marks:{empId|day:mark}}
  const [editing, setEditing] = useState(null);   // {tid, emp, marks:{day:m}, reason}
  const [err, setErr] = useState(null);

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
    const m = {};
    marks.forEach((r) => { m[r.employee_id + '|' + r.day.slice(0, 10)] = r.mark; });
    setData((d) => ({ ...d, [id]: { detail, marks: m } }));
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
        <details className="msel">
          <summary>Trainings: {selIds.length ? selIds.length + ' selected' : 'All'} ▾</summary>
          <div className="menu">
            <label><input type="checkbox" checked={!selIds.length} onChange={() => setSelIds([])} /> All</label>
            <hr style={{ border: 0, borderTop: '1px solid var(--line)' }} />
            {(list || []).map((t) => (
              <label key={t.id}>
                <input type="checkbox" checked={selIds.includes(t.id)}
                  onChange={(e) => setSelIds((s) => e.target.checked ? [...s, t.id] : s.filter((x) => x !== t.id))} />
                {t.title}{t.batch ? ' — ' + t.batch : ''} ({fmtRange(t.days)})
              </label>
            ))}
          </div>
        </details>
      </div>
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
                  {isAdmin && <button className="btn" onClick={() => markAll(t.id)}>✓ Mark all present</button>}
                </div>
                <table style={{ minWidth: 480 }}>
                  <thead><tr>
                    <th>Participant</th>
                    {days.map((day) => <th key={day}>{fmtDay(day)}</th>)}
                    <th style={{ textAlign: 'right' }}>%</th><th>Eligible</th>{isAdmin && <th></th>}
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
                              <button className={'attcell ' + (m === '–' ? '' : m)} disabled={!isAdmin && false}
                                onClick={() => cycle(t.id, p.id, day)}>{m}</button>
                            </td>;
                          })}
                          <td style={{ textAlign: 'right' }}>{pc === null ? '—' : pc + '%'}</td>
                          <td>{pc === null ? <span className="pill soft mini">Not marked</span>
                            : pc >= 75 ? <span className="pill good mini">Eligible</span>
                              : <span className="pill crit mini">Below 75%</span>}</td>
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
