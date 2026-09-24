import React, { useEffect, useState } from 'react';
import { api, fmtDate } from '../api.js';
import { useAuth, useToast, useSettings } from '../App.jsx';

// New-joiner onboarding: everyone who joined recently, their induction
// training state, and the configurable checklist (Settings → joiner steps).
export default function NewJoiners() {
  const { user: me } = useAuth();
  const { settings } = useSettings();
  const toast = useToast();
  const isAdmin = me.role === 'admin' || me.role === 'super_admin';
  const [days, setDays] = useState(180);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  const load = (d = days) => api.get('/api/joiners?days=' + d).then(setData).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const steps = settings?.joiner_steps || [];

  const toggle = async (emp, step, done) => {
    try {
      await api.post(`/api/joiners/${emp.id}/steps`, { step, done });
      toast(`"${step}" ${done ? 'completed' : 'reopened'} for ${emp.name}.`);
      load();
    } catch (e2) { setErr(e2.message); }
  };

  const inductionState = (e) => {
    if (!e.induction.length) return ['Not enrolled', 'crit'];
    const done = e.induction.some((i) => i.status === 'completed' || (i.day_count > 0 && i.attended >= i.day_count));
    if (done) return ['Induction done', 'good'];
    return ['In progress', 'warn'];
  };

  return (
    <>
      <div className="page-head">
        <h2>New Joiners</h2>
        <label className="muted mini">Joined within
          <select style={{ marginLeft: 8 }} value={days}
            onChange={(e) => { setDays(Number(e.target.value)); load(Number(e.target.value)); }}>
            <option value={90}>90 days</option><option value={180}>180 days</option><option value={365}>1 year</option>
          </select>
        </label>
      </div>
      {err && <p className="err">{err}</p>}
      {!data ? <p className="muted">Loading…</p> : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table style={{ minWidth: 760 }}>
            <thead><tr>
              <th>Joiner</th><th>Entity</th><th>Division</th><th>DOJ</th><th>Days in</th><th>Induction</th>
              {steps.map((s) => <th key={s} style={{ fontSize: 11 }}>{s}</th>)}
            </tr></thead>
            <tbody>
              {data.employees.map((e) => {
                const [txt, cls] = inductionState(e);
                const daysIn = Math.floor((Date.now() - new Date(e.date_joined)) / 86400000);
                return (
                  <tr key={e.id}>
                    <td>{e.name}<div className="muted" style={{ fontSize: 11 }}>{e.zoho_emp_id} · {e.designation}</div></td>
                    <td>{e.entity}</td><td>{e.division}</td>
                    <td className="muted">{fmtDate(e.date_joined)}</td>
                    <td>{daysIn}</td>
                    <td><span className={'pill ' + cls}>{txt}</span>
                      {e.induction.map((i) => (
                        <div key={i.id} className="muted" style={{ fontSize: 11 }}>
                          {i.title}{i.batch ? ' — ' + i.batch : ''} · {i.attended}/{i.day_count} days attended
                        </div>
                      ))}
                    </td>
                    {steps.map((s) => (
                      <td key={s} style={{ textAlign: 'center' }}>
                        <input type="checkbox" checked={e.steps.includes(s)} disabled={!isAdmin}
                          onChange={(ev) => toggle(e, s, ev.target.checked)} />
                      </td>
                    ))}
                  </tr>
                );
              })}
              {!data.employees.length && (
                <tr><td colSpan={6 + steps.length} className="muted">
                  No joiners in this window — joiners appear automatically from the employee master's date of joining.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted" style={{ fontSize: 12 }}>
        Induction status comes from trainings in the "Induction" category the joiner is enrolled on.
        The checklist columns are configurable under Settings → New-joiner checklist steps.
      </p>
    </>
  );
}
