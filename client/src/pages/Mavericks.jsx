import React, { useEffect, useState } from 'react';
import { api, fmtDate } from '../api.js';
import { useAuth, useToast, useSettings } from '../App.jsx';
import { toXlsx } from '../xlsx.js';

const M_STATUS = {
  classroom: ['Classroom', 'soft'], field: ['Field', 'warn'],
  completed: ['Completed', 'good'], dropped: ['Dropped', 'crit'],
  in_training: ['Classroom', 'soft'], extended: ['Extended', 'neutral'],
};
const ASSESS_TYPES = ['Written Assessment', 'Presentation', 'Teach Back', 'Product Demonstration',
  'Viva', 'Final Assessment', 'Reassessment'];
const pct100 = (score, max) => Math.round((Number(score) / Number(max)) * 100);

export default function Mavericks() {
  const { user: me } = useAuth();
  const { settings } = useSettings();
  const toast = useToast();
  const isAdmin = me.role === 'admin' || me.role === 'super_admin';
  const [batches, setBatches] = useState(null);
  const [sel, setSel] = useState(null);
  const [tab, setTab] = useState('trainees');
  const [emps, setEmps] = useState([]);
  const [form, setForm] = useState(null);
  const [assessForm, setAssessForm] = useState(null);
  const [scoresFor, setScoresFor] = useState(null);
  const [err, setErr] = useState(null);

  const loadList = () => api.get('/api/mavericks').then(setBatches).catch((e) => setErr(e.message));
  useEffect(() => {
    loadList();
    api.get('/api/employees?active=true').then(setEmps).catch(() => {});
  }, []);

  const open = async (id) => {
    setErr(null);
    const d = await api.get('/api/mavericks/' + id).catch((e) => { setErr(e.message); return null; });
    if (!d) return;
    setSel(d); setTab('trainees');
  };

  const saveBatch = async (e) => {
    e.preventDefault();
    try {
      if (form.id) {
        await api.patch('/api/mavericks/' + form.id, form);
        toast('Batch updated.');
        if (sel && form.id === sel.id) open(sel.id);
      } else {
        const b = await api.post('/api/mavericks', form);
        toast('Batch created — it blocks its dates on the Training Calendar.');
        open(b.id);
      }
      setForm(null); loadList();
    } catch (e2) { setErr(e2.message); }
  };

  const addMember = async (empId) => {
    try {
      await api.post(`/api/mavericks/${sel.id}/members`, { employee_id: Number(empId) });
      toast('Trainee added.');
      open(sel.id); loadList();
    } catch (e2) { setErr(e2.message); }
  };
  const updMember = async (empId, patch, msg) => {
    try {
      await api.patch(`/api/mavericks/${sel.id}/members/${empId}`, patch);
      toast(msg || 'Updated.');
      open(sel.id);
    } catch (e2) { setErr(e2.message); }
  };
  const removeMember = async (empId) => {
    const reason = window.prompt('Reason for removing this trainee? (audit trail)');
    if (!reason?.trim()) return;
    try {
      await api.del(`/api/mavericks/${sel.id}/members/${empId}?reason=` + encodeURIComponent(reason.trim()));
      toast('Trainee removed — reason recorded.');
      open(sel.id); loadList();
    } catch (e2) { setErr(e2.message); }
  };

  const saveScores = async (e) => {
    e.preventDefault();
    try {
      await api.put(`/api/mavericks/assessments/${scoresFor.id}/scores`, { scores: scoresFor.entries });
      toast('Scores saved — normalised to /100 automatically.');
      setScoresFor(null); open(sel.id);
    } catch (e2) { setErr(e2.message); }
  };

  const divisions = settings?.divisions || [];
  const mentorsOf = () => {
    const g = {};
    (sel?.members || []).forEach((m) => {
      const k = m.mentor_employee_id || 0;
      (g[k] = g[k] || { name: m.mentor_name, department: m.mentor_department, location: m.mentor_location, trainees: [] })
        .trainees.push(m);
    });
    return g;
  };
  const range = (b) => (b.start_date
    ? fmtDate(b.start_date) + (b.end_date ? ' → ' + fmtDate(b.end_date) : '')
    : '—');

  return (
    <>
      <div className="page-head">
        <h2>MedTech Mavericks</h2>
        {isAdmin && !sel && <button className="btn gold" onClick={() => setForm({ name: '', mentor: '', start_date: '', end_date: '', notes: '' })}>Create batch</button>}
        {sel && <button className="btn" onClick={() => { setSel(null); loadList(); }}>← All batches</button>}
      </div>
      {err && <p className="err">{err}</p>}

      {form && (
        <form className="card" onSubmit={saveBatch}>
          <div className="form-grid">
            <div><label>Batch name *</label><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Mavericks B-4" /></div>
            <div><label>Programme lead</label><input value={form.mentor || ''} onChange={(e) => setForm({ ...form, mentor: e.target.value })} /></div>
            <div><label>Training start date</label><input type="date" value={form.start_date || ''} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></div>
            <div><label>Training end date</label><input type="date" min={form.start_date || undefined} value={form.end_date || ''} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></div>
            {form.id && <div><label>Status</label>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="active">Active</option><option value="completed">Completed</option><option value="closed">Closed</option>
              </select></div>}
            <div style={{ gridColumn: '1/-1' }}><label>Notes</label><input value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <p className="muted mini" style={{ marginTop: 8 }}>
            The start→end range shows as blocked Mavericks dates on the Training Calendar.
          </p>
          <div className="form-actions">
            <button className="btn gold" type="submit">Save</button>
            <button className="btn" type="button" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </form>
      )}

      {!sel && (batches ? (
        <>
          <p className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
            Open a batch for its <b>Trainees</b>, <b>Assessments</b> and <b>Mentors</b>. Attendance for
            Mavericks is marked under the Attendance tab, on trainings in the Mavericks category.
          </p>
          <div className="card" style={{ padding: 0 }}>
            <table>
              <thead><tr><th>Batch</th><th>Lead</th><th>Training dates</th><th style={{ textAlign: 'right' }}>Trainees</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id} className="rowlink" onClick={() => open(b.id)}>
                    <td>{b.name}</td><td>{b.mentor}</td><td className="muted">{range(b)}</td>
                    <td style={{ textAlign: 'right' }}>{b.member_count}</td>
                    <td><span className={'pill ' + (b.status === 'active' ? 'good' : b.status === 'completed' ? 'soft' : 'neutral')}>{b.status}</span></td>
                    <td><button className="btn gold" onClick={(e) => { e.stopPropagation(); open(b.id); }}>Open →</button></td>
                  </tr>
                ))}
                {!batches.length && <tr><td colSpan={6} className="muted">No batches yet — create the first one.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      ) : <p className="muted">Loading…</p>)}

      {sel && (
        <>
          <div className="card">
            <div className="toolbar" style={{ marginBottom: 0, alignItems: 'center' }}>
              <b style={{ fontFamily: 'Fira Sans', fontSize: 16 }}>{sel.name}</b>
              {sel.mentor && <span className="muted">Lead: {sel.mentor}</span>}
              {sel.start_date && <span className="muted">{range(sel)}</span>}
              <span className={'pill ' + (sel.status === 'active' ? 'good' : 'soft')}>{sel.status}</span>
              <span style={{ flex: 1 }} />
              {isAdmin && <button className="btn" onClick={() => setForm({ id: sel.id, name: sel.name, mentor: sel.mentor || '', start_date: sel.start_date ? sel.start_date.slice(0, 10) : '', end_date: sel.end_date ? sel.end_date.slice(0, 10) : '', status: sel.status, notes: sel.notes || '' })}>Edit batch</button>}
            </div>
            {sel.notes && <p className="muted mini" style={{ marginTop: 8 }}>{sel.notes}</p>}
          </div>

          <div className="toolbar">
            {[['trainees', `Trainees (${sel.members.length})`],
              ['assessments', 'Assessments'], ['mentors', 'Mentors']].map(([t, label]) => (
              <button key={t} className={'btn' + (tab === t ? ' gold' : '')} onClick={() => setTab(t)}>{label}</button>
            ))}
          </div>

          {tab === 'trainees' && (
            <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
              <table style={{ minWidth: 980 }}>
                <thead><tr>
                  <th>Employee ID</th><th>Employee Name</th><th>Designation</th><th>Department</th><th>Location</th>
                  <th>Training Status</th><th style={{ minWidth: 180 }}>Mentor</th><th style={{ minWidth: 160 }}>Comment</th>{isAdmin && <th></th>}
                </tr></thead>
                <tbody>
                  {sel.members.map((m) => {
                    const needsMentor = m.status === 'field' && !m.mentor_employee_id;
                    return (
                      <tr key={m.employee_id}>
                        <td className="muted">{m.zoho_emp_id || '—'}</td>
                        <td>{m.name}<div className="muted" style={{ fontSize: 11 }}>{m.email}</div></td>
                        <td>{m.designation}</td>
                        <td>{m.department}</td>
                        <td>{m.location}</td>
                        <td>{isAdmin ? (
                          <select value={m.status === 'in_training' ? 'classroom' : m.status}
                            onChange={(e) => updMember(m.employee_id, { status: e.target.value },
                              e.target.value === 'field' ? 'Moved to field training — assign a mentor.' : 'Training status updated.')}>
                            <option value="classroom">Classroom</option><option value="field">Field</option>
                            <option value="completed">Completed</option><option value="dropped">Dropped</option>
                          </select>
                        ) : <span className={'pill ' + M_STATUS[m.status][1]}>{M_STATUS[m.status][0]}</span>}</td>
                        <td>{isAdmin ? (
                          <select value={m.mentor_employee_id || ''} style={needsMentor ? { borderColor: 'var(--crit)' } : {}}
                            onChange={(e) => updMember(m.employee_id, { mentor_employee_id: e.target.value || null }, 'Mentor assigned.')}>
                            <option value="">{needsMentor ? '⚠ assign a mentor' : '— no mentor —'}</option>
                            {emps.filter((e) => e.id !== m.employee_id)
                              .map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                          </select>
                        ) : (m.mentor_name || '—')}</td>
                        <td>{isAdmin ? (
                          <input defaultValue={m.comment || ''} placeholder="Comment…"
                            onBlur={(e) => { if (e.target.value !== (m.comment || '')) updMember(m.employee_id, { comment: e.target.value }, 'Comment saved.'); }} />
                        ) : (m.comment || '—')}</td>
                        {isAdmin && <td><button className="btn link" onClick={() => removeMember(m.employee_id)}>Remove</button></td>}
                      </tr>
                    );
                  })}
                  {!sel.members.length && <tr><td colSpan={9} className="muted">No trainees yet — add them below.</td></tr>}
                </tbody>
              </table>
              {isAdmin && (
                <div style={{ padding: 12, display: 'flex', gap: 8 }}>
                  <select id="mavAdd" style={{ flex: 1 }} defaultValue="">
                    <option value="" disabled>Add trainee from employees…</option>
                    {emps.filter((e) => !sel.members.some((m) => m.employee_id === e.id))
                      .map((e) => <option key={e.id} value={e.id}>{e.name} — {e.division || e.entity}</option>)}
                  </select>
                  <button className="btn gold" onClick={() => { const s = document.getElementById('mavAdd'); if (s.value) { addMember(s.value); s.value = ''; } }}>Add</button>
                </div>
              )}
            </div>
          )}

          {tab === 'assessments' && (
            <>
              {isAdmin && !assessForm && (
                <button className="btn gold" style={{ marginBottom: 12 }}
                  onClick={() => setAssessForm({ atype: ASSESS_TYPES[0], division: '', max_marks: 100, assess_date: '' })}>+ New assessment</button>
              )}
              {assessForm && (
                <form className="card" onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await api.post(`/api/mavericks/${sel.id}/assessments`, assessForm);
                    toast('Assessment created — enter scores; they normalise to /100 automatically.');
                    setAssessForm(null); open(sel.id);
                  } catch (e2) { setErr(e2.message); }
                }}>
                  <div className="form-grid">
                    <div><label>Assessment type *</label>
                      <select value={assessForm.atype} onChange={(e) => setAssessForm({ ...assessForm, atype: e.target.value })}>
                        {ASSESS_TYPES.map((t) => <option key={t}>{t}</option>)}
                      </select></div>
                    <div><label>Division (assessed separately per division)</label>
                      <select value={assessForm.division} onChange={(e) => setAssessForm({ ...assessForm, division: e.target.value })}>
                        <option value="">All divisions</option>
                        {divisions.map((d) => <option key={d}>{d}</option>)}
                      </select></div>
                    <div><label>Assessment date</label><input type="date" value={assessForm.assess_date} onChange={(e) => setAssessForm({ ...assessForm, assess_date: e.target.value })} /></div>
                    <div><label>Conducted out of (marks)</label><input type="number" min="1" value={assessForm.max_marks} onChange={(e) => setAssessForm({ ...assessForm, max_marks: e.target.value })} placeholder="20 / 25 / 50 / 100" /></div>
                  </div>
                  <div className="form-actions">
                    <button className="btn gold" type="submit">Create</button>
                    <button className="btn" type="button" onClick={() => setAssessForm(null)}>Cancel</button>
                  </div>
                </form>
              )}
              {sel.assessments.map((a) => {
                const sc = a.scores || [];
                const scored = sel.members
                  .map((m) => ({ m, s: sc.find((x) => x.employee_id === m.employee_id) }))
                  .filter((x) => x.s);
                return (
                  <div key={a.id} className="card" style={{ padding: 0, overflowX: 'auto' }}>
                    <div className="toolbar" style={{ padding: '12px 14px 0', marginBottom: 6 }}>
                      <b>{a.atype || a.name}</b>
                      <span className="pill soft mini">{a.division || 'All divisions'}</span>
                      <span className="muted mini">{fmtDate(a.assess_date)} · out of {Number(a.max_marks)}</span>
                      <span style={{ flex: 1 }} />
                      {isAdmin && <button className="btn" onClick={() => setScoresFor({
                        ...a,
                        entries: [...sel.members]
                          .sort((x, y) => ((y.division === a.division) - (x.division === a.division)) || x.name.localeCompare(y.name))
                          .map((m) => ({
                            employee_id: m.employee_id, name: m.name, division: m.division,
                            score: (sc.find((x) => x.employee_id === m.employee_id) || {}).score ?? '',
                          })),
                      })}>Enter scores</button>}
                      <button className="btn" onClick={() => toXlsx(`Scores-${(a.atype || a.name).replace(/[^\w]+/g, '-')}.xlsx`,
                        ['Employee ID', 'Employee Name', 'Assessment type', 'Date', `Score /${Number(a.max_marks)}`, 'Out of 100', 'Result'],
                        scored.map(({ m, s }) => [m.zoho_emp_id || '', m.name, a.atype || a.name, a.assess_date ? a.assess_date.slice(0, 10) : '',
                          Number(s.score), pct100(s.score, a.max_marks), pct100(s.score, a.max_marks) >= 80 ? 'Passed' : 'Failed']))}>⬇</button>
                    </div>
                    <table style={{ minWidth: 720 }}>
                      <thead><tr><th>Employee ID</th><th>Employee Name</th><th>Assessment type</th><th>Date</th>
                        <th style={{ textAlign: 'right' }}>Score /{Number(a.max_marks)}</th>
                        <th style={{ textAlign: 'right' }}>Out of 100</th><th>Result</th></tr></thead>
                      <tbody>
                        {scored.map(({ m, s }) => {
                          const p = pct100(s.score, a.max_marks);
                          return (
                            <tr key={m.employee_id}>
                              <td className="muted">{m.zoho_emp_id || '—'}</td>
                              <td>{m.name}</td>
                              <td>{a.atype || a.name}</td>
                              <td className="muted">{fmtDate(a.assess_date)}</td>
                              <td style={{ textAlign: 'right' }}>{Number(s.score)}</td>
                              <td style={{ textAlign: 'right', fontWeight: 600 }}>{p}</td>
                              <td><span className={'pill ' + (p >= 80 ? 'good' : 'crit')}>{p >= 80 ? 'Passed' : 'Failed'}</span></td>
                            </tr>
                          );
                        })}
                        {!scored.length && <tr><td colSpan={7} className="muted">No scores entered yet.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                );
              })}
              {!sel.assessments.length && <p className="muted">No assessments yet — create one; divisions are assessed separately, and any max-marks paper auto-converts to /100 with an 80% pass mark.</p>}
            </>
          )}

          {tab === 'mentors' && (
            <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
              <table style={{ minWidth: 720 }}>
                <thead><tr><th>Mentor Name</th><th>Department</th><th>Location</th><th>Assigned Trainees</th></tr></thead>
                <tbody>
                  {Object.entries(mentorsOf()).filter(([k]) => k !== '0').map(([k, g]) => (
                    <tr key={k}>
                      <td>{g.name}</td><td>{g.department || '—'}</td><td>{g.location || '—'}</td>
                      <td>{g.trainees.map((t) => t.name).join(', ')} <span className="muted mini">({g.trainees.length})</span></td>
                    </tr>
                  ))}
                  {mentorsOf()['0'] && (
                    <tr>
                      <td className="muted" colSpan={3}>Not yet assigned to a mentor</td>
                      <td>{mentorsOf()['0'].trainees.map((t) => (
                        <span key={t.employee_id} className={'pill mini ' + (t.status === 'field' ? 'crit' : 'neutral')} style={{ marginRight: 6 }}>
                          {t.name}{t.status === 'field' ? ' ⚠ field' : ''}
                        </span>
                      ))}</td>
                    </tr>
                  )}
                  {!sel.members.length && <tr><td colSpan={4} className="muted">No trainees yet.</td></tr>}
                </tbody>
              </table>
              <p className="muted mini" style={{ padding: '8px 14px' }}>
                Assign or change mentors on the Trainees tab — a trainee moved to Field training without a mentor is flagged ⚠ here.
              </p>
            </div>
          )}
        </>
      )}

      {scoresFor && (
        <div className="modal-backdrop" onClick={() => setScoresFor(null)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={saveScores}>
            <h3>{scoresFor.atype || scoresFor.name} · {scoresFor.division || 'All divisions'}
              <span className="muted"> (out of {Number(scoresFor.max_marks)})</span></h3>
            {scoresFor.entries.length ? scoresFor.entries.map((en, i) => {
              const p = en.score === '' ? null : pct100(en.score, scoresFor.max_marks);
              return (
                <div key={en.employee_id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '4px 0' }}>
                  <span style={{ flex: 1, fontSize: 13 }}>{en.name}
                    {en.division !== scoresFor.division && scoresFor.division &&
                      <span className="muted mini"> · {en.division || 'no division set'}</span>}
                  </span>
                  <input type="number" min="0" max={Number(scoresFor.max_marks)} step="0.5" style={{ width: 90 }}
                    value={en.score} placeholder="—"
                    onChange={(e) => {
                      const entries = [...scoresFor.entries];
                      entries[i] = { ...en, score: e.target.value === '' ? '' : Number(e.target.value) };
                      setScoresFor({ ...scoresFor, entries });
                    }} />
                  <span style={{ width: 96, textAlign: 'right', fontSize: 12 }}>
                    {p === null ? <span className="muted">—</span> : <>
                      <b>{p}</b>/100 <span className={'pill mini ' + (p >= 80 ? 'good' : 'crit')}>{p >= 80 ? 'Pass' : 'Fail'}</span>
                    </>}
                  </span>
                </div>
              );
            }) : <p className="muted">This batch has no trainees yet.</p>}
            <p className="muted mini" style={{ marginTop: 6 }}>
              Enter raw marks out of {Number(scoresFor.max_marks)} — the /100 conversion and the 80% pass mark apply automatically. Blank = not assessed.
            </p>
            <div className="form-actions">
              <button className="btn gold" type="submit">Save scores</button>
              <button className="btn" type="button" onClick={() => setScoresFor(null)}>Cancel</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
