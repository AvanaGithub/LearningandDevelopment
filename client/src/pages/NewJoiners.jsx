import React, { useEffect, useState } from 'react';
import { api, fmtDate, fmtRange, entLabel, toISODay } from '../api.js';
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
  const [inds, setInds] = useState([]);         // induction-category trainings (managed here, not on the calendar)
  const [indForm, setIndForm] = useState(null); // {title, from, numDays, hours_per_day, trainer_name}
  const [err, setErr] = useState(null);

  const load = (d = days) => api.get('/api/joiners?days=' + d).then(setData).catch((e) => setErr(e.message));
  const loadInds = () => api.get('/api/trainings')
    .then((rows) => setInds(rows.filter((t) => t.category === 'Induction' && t.status !== 'cancelled')))
    .catch(() => {});
  useEffect(() => { load(); loadInds(); }, []);

  const saveInd = async (e) => {
    e.preventDefault();
    try {
      const n = Math.min(60, Math.max(1, Number(indForm.numDays) || 1));
      const d0 = new Date(indForm.from + 'T00:00:00');
      const trainingDays = Array.from({ length: n }, (_, i) => {
        const d = new Date(d0); d.setDate(d.getDate() + i); return toISODay(d);
      });
      await api.post('/api/trainings', {
        title: indForm.title, category: 'Induction', mode: 'Classroom',
        trainer_type: 'internal', trainer_name: indForm.trainer_name || 'HR / L&D',
        hours_per_day: Number(indForm.hours_per_day) || 8, days: trainingDays,
      });
      toast('Induction training created — it stays off the Training Calendar.');
      setIndForm(null); loadInds();
    } catch (e2) { setErr(e2.message); }
  };

  const setIndStatus = async (t, status) => {
    try {
      await api.patch('/api/trainings/' + t.id, { status });
      toast(`${t.title} marked ${status.replace('_', ' ')}.`);
      loadInds(); load();
    } catch (e2) { setErr(e2.message); }
  };

  const delInd = async (t) => {
    const reason = window.prompt(`Delete ${t.title}? Only test/wrong entries can be deleted — one with attendance or feedback must be cancelled instead.\n\nReason (audit trail):`);
    if (!reason?.trim()) return;
    try {
      await api.del(`/api/trainings/${t.id}?reason=` + encodeURIComponent(reason.trim()));
      toast('Induction training deleted — reason recorded.');
      loadInds(); load();
    } catch (e2) { setErr(e2.message); }
  };

  const enrol = async (emp, trainingId) => {
    try {
      await api.post(`/api/trainings/${trainingId}/participants`, { employee_id: emp.id });
      toast(`${emp.name} enrolled — mark their attendance under the Attendance tab.`);
      load(); loadInds();
    } catch (e2) { setErr(e2.message); }
  };

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

      {isAdmin && (
        <div className="card">
          <div className="toolbar" style={{ marginBottom: inds.length || indForm ? 10 : 0, alignItems: 'center' }}>
            <b style={{ fontFamily: 'Fira Sans', fontSize: 14 }}>Induction trainings</b>
            <span className="muted mini">managed here — never shown on the Training Calendar</span>
            <span style={{ flex: 1 }} />
            {!indForm && <button className="btn gold" onClick={() => setIndForm({ title: '', from: '', numDays: 1, hours_per_day: 8, trainer_name: '' })}>+ New induction training</button>}
          </div>
          {indForm && (
            <form onSubmit={saveInd}>
              <div className="form-grid">
                <div><label>Title *</label><input required value={indForm.title} onChange={(e) => setIndForm({ ...indForm, title: e.target.value })} placeholder="e.g. Induction — October batch" /></div>
                <div><label>Start date *</label><input required type="date" value={indForm.from} onChange={(e) => setIndForm({ ...indForm, from: e.target.value })} /></div>
                <div><label>No. of days</label><input type="number" min="1" max="60" value={indForm.numDays} onChange={(e) => setIndForm({ ...indForm, numDays: e.target.value })} /></div>
                <div><label>Hours per day</label><input type="number" min="1" max="12" step="0.5" value={indForm.hours_per_day} onChange={(e) => setIndForm({ ...indForm, hours_per_day: e.target.value })} /></div>
                <div><label>Trainer</label><input value={indForm.trainer_name} onChange={(e) => setIndForm({ ...indForm, trainer_name: e.target.value })} placeholder="HR / L&D" /></div>
              </div>
              <div className="form-actions">
                <button className="btn gold" type="submit">Create</button>
                <button className="btn" type="button" onClick={() => setIndForm(null)}>Cancel</button>
              </div>
            </form>
          )}
          {inds.map((t) => (
            <div key={t.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 0', borderBottom: '1px dashed var(--line)', fontSize: 13, flexWrap: 'wrap' }}>
              <span style={{ flex: 1, minWidth: 180 }}><b>{t.title}</b> <span className="muted">· {fmtRange(t.days)} · {t.participant_count} joiner(s)</span></span>
              <select value={t.status} onChange={(e) => setIndStatus(t, e.target.value)}>
                <option value="planned">Planned</option><option value="in_progress">In progress</option>
                <option value="completed">Completed</option><option value="postponed">Postponed</option>
              </select>
              <button className="btn link" onClick={() => delInd(t)}>Delete…</button>
            </div>
          ))}
          {!inds.length && !indForm && <p className="muted mini" style={{ margin: 0 }}>No induction trainings yet — create one, then enrol joiners from the list below.</p>}
        </div>
      )}

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
                    <td>{entLabel(e.entity)}</td>
                    <td className="muted">{fmtDate(e.date_joined)}</td>
                    <td className="muted">{jt?.start_date
                      ? `${fmtDate(jt.start_date)}${jt.end_date ? ' → ' + fmtDate(jt.end_date) : ''}` : '—'}</td>
                    <td><span className={'pill ' + sc}>{st}</span></td>
                    <td>
                      {scores ? e.assessments.map((a) => {
                        const p = pct100(a.score, a.max_marks);
                        return (
                          <div key={a.id} style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                            {a.atype}: <b>{p}</b>/100{' '}
                            <span className={'pill mini ' + (p >= 80 ? 'good' : 'crit')}>{p >= 80 ? 'Pass' : 'Fail'}</span>
                          </div>
                        );
                      }) : (!isAdmin && <span className="muted">—</span>)}
                      {isAdmin && <button className="btn link" style={{ fontSize: 11, padding: 0 }} onClick={() => openEdit(e)}>＋ Add score</button>}
                    </td>
                    <td className="muted mini">{jt?.comment || '—'}</td>
                    <td><span className={'pill ' + cls}>{txt}</span>
                      {e.induction.map((i) => (
                        <div key={i.id} className="muted" style={{ fontSize: 11 }}>
                          {i.title}{i.batch ? ' — ' + i.batch : ''} · {i.attended}/{i.day_count} days
                        </div>
                      ))}
                      {isAdmin && (() => {
                        const opts = inds.filter((t) => !e.induction.some((i) => i.id === t.id));
                        return opts.length ? (
                          <select defaultValue="" style={{ marginTop: 4, fontSize: 11, maxWidth: 150 }}
                            onChange={(ev) => { if (ev.target.value) { enrol(e, Number(ev.target.value)); ev.target.value = ''; } }}>
                            <option value="" disabled>Enrol in…</option>
                            {opts.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                          </select>
                        ) : null;
                      })()}
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
