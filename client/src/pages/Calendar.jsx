import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, TRN_STATUSES, fmtRange, statusPill } from '../api.js';

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function Calendar() {
  const nav = useNavigate();
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [rows, setRows] = useState(null);

  const first = new Date(ym.y, ym.m, 1);
  const last = new Date(ym.y, ym.m + 1, 0);

  useEffect(() => {
    setRows(null);
    api.get(`/api/trainings?from=${iso(first)}&to=${iso(last)}`).then(setRows).catch(() => setRows([]));
  }, [ym.y, ym.m]);

  const step = (d) => setYm(({ y, m }) => {
    const n = m + d;
    return { y: y + Math.floor(n / 12), m: ((n % 12) + 12) % 12 };
  });

  const byDay = {};
  (rows || []).forEach((t) => (t.days || []).forEach((d) => {
    const k = d.slice(0, 10);
    (byDay[k] = byDay[k] || []).push(t);
  }));

  const offset = (first.getDay() + 6) % 7; // Monday-first grid
  const daysInMonth = last.getDate();
  const todayIso = iso(new Date());
  const label = first.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  return (
    <>
      <div className="page-head"><h2>Training calendar</h2></div>
      <div className="card">
        <div className="toolbar" style={{ alignItems: 'center' }}>
          <button className="btn" onClick={() => step(-1)}>◀</button>
          <b style={{ minWidth: 160, textAlign: 'center', fontFamily: 'Fira Sans' }}>{label}</b>
          <button className="btn" onClick={() => step(1)}>▶</button>
          <span style={{ flex: 1 }} />
          <span className="pill soft mini">Internal</span>
          <span className="pill crit mini">External</span>
          <span className="muted mini">• = mandatory</span>
        </div>
        <div className="cal">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="dow">{d}</div>)}
          {Array.from({ length: offset }, (_, i) => <div key={'b' + i} className="day blank" />)}
          {Array.from({ length: daysInMonth }, (_, i) => {
            const d = i + 1;
            const k = `${ym.y}-${String(ym.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            return (
              <div key={k} className={'day' + (k === todayIso ? ' today' : '')}>
                <span className="dnum">{d}{k === todayIso ? ' · today' : ''}</span>
                {(byDay[k] || []).map((t) => (
                  <button key={t.id} className={'evt' + (t.trainer_type === 'external' ? ' ext' : '')}
                    title={`${t.title}${t.batch ? ' (' + t.batch + ')' : ''} — ${TRN_STATUSES[t.status]}`}
                    onClick={() => nav('/trainings?open=' + t.id)}>
                    {t.mandatory ? '• ' : ''}{t.title}{t.batch ? ' · ' + t.batch : ''}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Dates</th><th>Training</th><th>Mode</th><th>Trainer</th><th>Status</th></tr></thead>
          <tbody>
            {(rows || []).map((t) => (
              <tr key={t.id} className="rowlink" onClick={() => nav('/trainings?open=' + t.id)}>
                <td className="muted">{fmtRange(t.days)}</td>
                <td>{t.title}{t.batch && <span className="pill soft mini" style={{ marginLeft: 6 }}>{t.batch}</span>}
                  {t.mandatory && <span className="pill warn mini" style={{ marginLeft: 6 }}>Mandatory</span>}</td>
                <td>{t.mode}</td>
                <td>{t.trainer_type === 'external' ? (t.agency || t.trainer_name) : t.trainer_name}</td>
                <td><span className={'pill ' + statusPill(t.status)}>{TRN_STATUSES[t.status]}</span></td>
              </tr>
            ))}
            {rows && !rows.length && <tr><td colSpan={5} className="muted">No trainings planned this month.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
