import React, { useEffect, useState } from 'react';
import { api, fmtDate } from '../api.js';
import { useAuth, useToast, useSettings } from '../App.jsx';

// New-joiner onboarding: everyone who joined recently, their induction
// training state, the configurable checklist (Settings → joiner steps),
// plus the training phase (dates / status / comment) and assessments.
// Managers and leaders see only their own reportees still in training.
const J_STATUS = {
  not_started: ['Not started', 'neutral'], in_progress: ['In progress', 'warn'],
  completed: ['Completed', 'good'], extended: ['Extended', 'soft'], dropped: ['Dropped', 'crit'],
};
const ASSESS_TYPES = ['Written Assessment', 'Presentation', 'Teach Back', 'Product Demonstration',
  'Viva', 'Final Assessment', 'Reassessment'];
const pct100 = (score, max) => Math.round((Number(score) / Number(max)) * 100);

export default function NewJoiners() {
  const { user: me } = useAuth();
  const { settings } = useSettings();
  const toast = useToast();
  const isAdmin = me.role === 'admin' || me.role === 'super_admin';
  const [days, setDays] = useState(180);
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null); // {emp, start_date, end_date, status, comment, newA}
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

  const openEdit = (e) => setEditing({
    emp: e,
    start_date: e.training?.start_date ? e.training.start_date.slice(0, 10) : '',
    end_date: e.training?.end_date ? e.training.end_date.slice(0, 10) : '',
    status: e.training?.status || 'not_started',
    comment: e.training?.comment || '',
    newA: { atype: ASSESS_TYPES[0], assess_date: '', max_marks: 100, score: '' },
  });

  const saveTraining = async () => {
    try {
      await api.put(`/api/joiners/${editing.emp.id}/training`, {
        start_date: editing.start_date || null, end_date: editing.end_date || null,
        status: editing.status, comment: editing.comment,
      });
      toast(`Training details saved for ${editing.emp.name}.`);
      setEditing(null); load();
    } catch (e2) { setErr(e2.message); }
  };

  const addAssessment = async () => {
    const a = editing.newA;
    try {
      const created = await api.post(`/api/joiners/${editing.emp.id}/assessments`, a);
      toast('Assessment score added.');
      setEditing({
        ...editing,
        emp: { ...editing.emp, assessments: [...editing.emp.assessments, created] },
        newA: { atype: ASSESS_TYPES[0], assess_date: '', max_marks: 100, score: '' },
      });
      load();
    } catch (e2) { setErr(e2.message); }
  };

  const delAssessment = async (aid) => {
    const reason = window.prompt('Reason for removing this assessment entry? (audit trail)');
    if (!reason?.trim()) return;
    try {
      await api.del(`/api/joiners/${editing.emp.id}/assessments/${aid}?reason=` + encodeURIComponent(reason.trim()));
      setEditing({
        ...editing,
        emp: { ...editing.emp, assessments: editing.emp.assessments.filter((x) => x.id !== aid) },
      });
      toast('Assessment entry removed — reason recorded.');
      load();
    } catch (e2) { setErr(e2.message); }
  };

  const bestOf = (e) => {
    if (!e.assessments?.length) return null;
    return e.assessments.map((a) => pct100(a.score, a.max_marks));
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
          <table style={{ minWidth: 1050 }}>
            <thead><tr>
              <th>Joiner</th><th>Entity</th><th>DOJ</th><th>Training dates</th><th>Training status</th>
              <th>Assessments</th><th style={{ minWidth: 140 }}>Comment</th><th>Induction</th>
              {steps.map((s) => <th key={s} style={{ fontSize: 11 }}>{s}</th>)}
              {isAdmin && <th></th>}
            </tr></thead>
            <tbody>
              {data.employees.map((e) => {
                const [txt, cls] = inductionState(e);
                const jt = e.training;
                const [st, sc] = J_STATUS[jt?.status || 'not_started'];
                const scores = bestOf(e);
                return (
                  <tr key={e.id}>
                    <td>{e.name}<div className="muted" style={{ fontSize: 11 }}>{e.zoho_emp_id} · {e.designation} · {e.division || e.department || ''}</div></td>
                    <td>{e.entity}</td>
                    <td className="muted">{fmtDate(e.date_joined)}</td>
                    <td className="muted">{jt?.start_date
                      ? `${fmtDate(jt.start_date)}${jt.end_date ? ' → ' + fmtDate(jt.end_date) : ''}` : '—'}</td>
                    <td><span className={'pill ' + sc}>{st}</span></td>
                    <td>{scores ? e.assessments.map((a) => {
                      const p = pct100(a.score, a.max_marks);
                      return (
                        <div key={a.id} style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                          {a.atype}: <b>{p}</b>/100{' '}
                          <span className={'pill mini ' + (p >= 80 ? 'good' : 'crit')}>{p >= 80 ? 'Pass' : 'Fail'}</span>
                        </div>
                      );
                    }) : <span className="muted">—</span>}</td>
                    <td className="muted mini">{jt?.comment || '—'}</td>
                    <td><span className={'pill ' + cls}>{txt}</span>
                      {e.induction.map((i) => (
                        <div key={i.id} className="muted" style={{ fontSize: 11 }}>
                          {i.title}{i.batch ? ' — ' + i.batch : ''} · {i.attended}/{i.day_count} days
                        </div>
                      ))}
                    </td>
                    {steps.map((s) => (
                      <td key={s} style={{ textAlign: 'center' }}>
                        <input type="checkbox" checked={e.steps.includes(s)} disabled={!isAdmin}
                          onChange={(ev) => toggle(e, s, ev.target.checked)} />
                      </td>
                    ))}
                    {isAdmin && <td><button className="btn link" onClick={() => openEdit(e)}>Edit</button></td>}
                  </tr>
                );
              })}
              {!data.employees.length && (
                <tr><td colSpan={8 + steps.length + (isAdmin ? 1 : 0)} className="muted">
                  {isAdmin
                    ? 'No joiners in this window — joiners appear automatically from the employee master\'s date of joining.'
                    : 'None of your reportees are in the training phase right now.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted" style={{ fontSize: 12 }}>
        Induction status comes from trainings in the "Induction" category the joiner is enrolled on.
        {!isAdmin && ' You see only joiners reporting to you, until their training phase is completed.'}
      </p>

      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
            <h3>Training — {editing.emp.name}</h3>
            <div className="form-grid">
              <div><label>Training start date</label>
                <input type="date" value={editing.start_date} onChange={(e) => setEditing({ ...editing, start_date: e.target.value })} /></div>
              <div><label>Training end date</label>
                <input type="date" min={editing.start_date || undefined} value={editing.end_date} onChange={(e) => setEditing({ ...editing, end_date: e.target.value })} /></div>
              <div><label>Training status</label>
                <select value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })}>
                  {Object.entries(J_STATUS).map(([k, [label]]) => <option key={k} value={k}>{label}</option>)}
                </select></div>
              <div style={{ gridColumn: '1/-1' }}><label>Comment</label>
                <input value={editing.comment} placeholder="e.g. strong on product knowledge, extend field phase…"
                  onChange={(e) => setEditing({ ...editing, comment: e.target.value })} /></div>
            </div>

            <h3 style={{ fontSize: 14, margin: '16px 0 6px' }}>Assessment scores</h3>
            {editing.emp.assessments.map((a) => {
              const p = pct100(a.score, a.max_marks);
              return (
                <div key={a.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', borderBottom: '1px dashed var(--line)', fontSize: 13 }}>
                  <span style={{ flex: 1 }}>{a.atype}{a.assess_date ? ` · ${fmtDate(a.assess_date)}` : ''}</span>
                  <span className="muted mini">{Number(a.score)}/{Number(a.max_marks)}</span>
                  <b>{p}</b>/100
                  <span className={'pill mini ' + (p >= 80 ? 'good' : 'crit')}>{p >= 80 ? 'Pass' : 'Fail'}</span>
                  <button className="btn link" onClick={() => delAssessment(a.id)}>✕</button>
                </div>
              );
            })}
            {!editing.emp.assessments.length && <p className="muted mini">No assessment scores yet.</p>}
            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', marginTop: 8, flexWrap: 'wrap' }}>
              <div><label className="muted mini">Type</label><br />
                <select value={editing.newA.atype} onChange={(e) => setEditing({ ...editing, newA: { ...editing.newA, atype: e.target.value } })}>
                  {ASSESS_TYPES.map((t) => <option key={t}>{t}</option>)}
                </select></div>
              <div><label className="muted mini">Date</label><br />
                <input type="date" value={editing.newA.assess_date} onChange={(e) => setEditing({ ...editing, newA: { ...editing.newA, assess_date: e.target.value } })} /></div>
              <div><label className="muted mini">Out of</label><br />
                <input type="number" min="1" style={{ width: 70 }} value={editing.newA.max_marks}
                  onChange={(e) => setEditing({ ...editing, newA: { ...editing.newA, max_marks: e.target.value } })} /></div>
              <div><label className="muted mini">Score</label><br />
                <input type="number" min="0" step="0.5" style={{ width: 70 }} value={editing.newA.score}
                  onChange={(e) => setEditing({ ...editing, newA: { ...editing.newA, score: e.target.value } })} /></div>
              <span style={{ fontSize: 12, paddingBottom: 6 }}>
                {editing.newA.score === '' ? <span className="muted">—</span> : <>
                  = <b>{pct100(editing.newA.score, editing.newA.max_marks || 100)}</b>/100
                </>}
              </span>
              <button className="btn" type="button" disabled={editing.newA.score === ''} onClick={addAssessment}>+ Add</button>
            </div>
            <p className="muted mini" style={{ marginTop: 6 }}>Any max marks auto-convert to /100 · pass mark 80.</p>

            <div className="form-actions">
              <button className="btn gold" onClick={saveTraining}>Save training details</button>
              <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
