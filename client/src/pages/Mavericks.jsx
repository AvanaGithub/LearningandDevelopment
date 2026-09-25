import React, { useEffect, useState } from 'react';
import { api, fmtDate, fmtDay } from '../api.js';
import { useAuth, useToast, useSettings } from '../App.jsx';
import { toXlsx } from '../xlsx.js';

const M_STATUS = { in_training: ['In training', 'soft'], completed: ['Completed', 'good'], dropped: ['Dropped', 'crit'], extended: ['Extended', 'warn'] };
const CYCLE = { '': 'P', P: 'A', A: 'H', H: '' };

export default function Mavericks() {
  const { user: me } = useAuth();
  const { settings } = useSettings();
  const toast = useToast();
  const isAdmin = me.role === 'admin' || me.role === 'super_admin';
  const [batches, setBatches] = useState(null);
  const [sel, setSel] = useState(null);           // full batch detail
  const [tab, setTab] = useState('members');
  const [emps, setEmps] = useState([]);
  const [form, setForm] = useState(null);         // new-batch form
  const [att, setAtt] = useState({});             // 'classroom'|'field' -> {emp|day: {mark, at}}
  const [newDay, setNewDay] = useState('');
  const [days, setDays] = useState({ classroom: [], field: [] });
  const [assessForm, setAssessForm] = useState(null);
  const [scoresFor, setScoresFor] = useState(null); // assessment being scored
  const [err, setErr] = useState(null);

  const loadList = () => api.get('/api/mavericks').then(setBatches).catch((e) => setErr(e.message));
  useEffect(() => { loadList(); api.get('/api/employees?active=true').then(setEmps).catch(() => {}); }, []);

  const open = async (id) => {
    setErr(null);
    const d = await api.get('/api/mavericks/' + id).catch((e) => { setErr(e.message); return null; });
    if (!d) return;
    setSel(d); setTab('members');
    for (const kind of ['classroom', 'field']) loadAtt(id, kind);
  };
  const loadAtt = async (id, kind) => {
    const rows = await api.get(`/api/mavericks/${id}/attendance?kind=${kind}`).catch(() => []);
    const m = {}; const ds = new Set();
    rows.forEach((r) => { const day = r.day.slice(0, 10); m[r.employee_id + '|' + day] = { mark: r.mark, at: r.updated_at }; ds.add(day); });
    setAtt((a) => ({ ...a, [kind]: m }));
    setDays((d) => ({ ...d, [kind]: [...ds].sort() }));
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
        toast('Batch created — add trainees, then use the Classroom / Field attendance and Assessments tabs.');
        open(b.id); // straight into the batch workspace
      }
      setForm(null); loadList();
    } catch (e2) { setErr(e2.message); }
  };

  const addMember = async (empId) => {
    try {
      await api.post(`/api/mavericks/${sel.id}/members`, { employee_id: Number(empId) });
      toast('Trainee added to the batch.');
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

  const kind = tab === 'field' ? 'field' : 'classroom';
  const cycleMark = async (empId, day) => {
    if (!isAdmin) return;
    const cur = att[kind]?.[empId + '|' + day]?.mark || '';
    const next = CYCLE[cur];
    try {
      await api.put(`/api/mavericks/${sel.id}/attendance`, { employee_id: empId, day, kind, mark: next || null });
      loadAtt(sel.id, kind);
    } catch (e2) { setErr(e2.message); }
  };

  const saveScores = async (e) => {
    e.preventDefault();
    try {
      await api.put(`/api/mavericks/assessments/${scoresFor.id}/scores`, { scores: scoresFor.entries });
      toast('Scores saved.');
      setScoresFor(null); open(sel.id);
    } catch (e2) { setErr(e2.message); }
  };

  const attPctOf = (empId, k) => {
    const ds = days[k] || [];
    if (!ds.length) return null;
    const marks = ds.map((d) => att[k]?.[empId + '|' + d]?.mark).filter(Boolean);
    if (!marks.length) return null;
    const units = marks.reduce((s, m) => s + (m === 'P' ? 1 : m === 'H' ? 0.5 : 0), 0);
    return Math.round((units / ds.length) * 100);
  };

  const divisions = settings?.divisions || [];

  return (
    <>
      <div className="page-head">
        <h2>MedTech Mavericks</h2>
        {isAdmin && !sel && <button className="btn gold" onClick={() => setForm({ name: '', mentor: '', start_date: '', notes: '' })}>Create batch</button>}
        {sel && <button className="btn" onClick={() => { setSel(null); loadList(); }}>← All batches</button>}
      </div>
      {err && <p className="err">{err}</p>}

      {form && (
        <form className="card" onSubmit={saveBatch}>
          <div className="form-grid">
            <div><label>Batch name *</label><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Mavericks B-4" /></div>
            <div><label>Mentor</label><input value={form.mentor || ''} onChange={(e) => setForm({ ...form, mentor: e.target.value })} /></div>
            <div><label>Start date</label><input type="date" value={form.start_date || ''} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></div>
            {form.id && <div><label>Status</label>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="active">Active</option><option value="completed">Completed</option><option value="closed">Closed</option>
              </select></div>}
            <div style={{ gridColumn: '1/-1' }}><label>Notes</label><input value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <div className="form-actions">
            <button className="btn gold" type="submit">Save</button>
            <button className="btn" type="button" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </form>
      )}

      {!sel && (batches ? (
        <>
          <p className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
            Open a batch to manage its trainees, mark <b>Classroom</b> and <b>Field</b> attendance
            (separate tabs), and run per-division <b>Assessments</b> with score entry.
          </p>
          <div className="card" style={{ padding: 0 }}>
            <table>
              <thead><tr><th>Batch</th><th>Mentor</th><th>Start</th><th style={{ textAlign: 'right' }}>Trainees</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id} className="rowlink" onClick={() => open(b.id)}>
                    <td>{b.name}</td><td>{b.mentor}</td><td className="muted">{fmtDate(b.start_date)}</td>
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
              {sel.mentor && <span className="muted">Mentor: {sel.mentor}</span>}
              {sel.start_date && <span className="muted">since {fmtDate(sel.start_date)}</span>}
              <span className={'pill ' + (sel.status === 'active' ? 'good' : 'soft')}>{sel.status}</span>
              <span style={{ flex: 1 }} />
              {isAdmin && <button className="btn" onClick={() => setForm({ id: sel.id, name: sel.name, mentor: sel.mentor || '', start_date: sel.start_date ? sel.start_date.slice(0, 10) : '', status: sel.status, notes: sel.notes || '' })}>Edit batch</button>}
            </div>
            {sel.notes && <p className="muted mini" style={{ marginTop: 8 }}>{sel.notes}</p>}
          </div>

          <div className="toolbar">
            {['members', 'classroom', 'field', 'assessments'].map((t) => (
              <button key={t} className={'btn' + (tab === t ? ' gold' : '')} onClick={() => setTab(t)}>
                {t === 'members' ? `Trainees (${sel.members.length})` : t === 'classroom' ? 'Classroom attendance' : t === 'field' ? 'Field attendance' : 'Assessments'}
              </button>
            ))}
          </div>

          {tab === 'members' && (
            <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
              <table style={{ minWidth: 860 }}>
                <thead><tr><th>Trainee</th><th>Entity</th><th>Division</th><th>Designation</th><th>DOJ</th>
                  <th>Class %</th><th>Field %</th><th>Status</th><th style={{ minWidth: 200 }}>Comment</th>{isAdmin && <th></th>}</tr></thead>
                <tbody>
                  {sel.members.map((m) => (
                    <tr key={m.employee_id}>
                      <td>{m.name}<div className="muted" style={{ fontSize: 11 }}>{m.zoho_emp_id} · {m.email}</div></td>
                      <td>{m.entity}</td><td>{m.division}</td><td>{m.designation}</td>
                      <td className="muted">{fmtDate(m.date_joined)}</td>
                      <td>{attPctOf(m.employee_id, 'classroom') ?? '—'}{attPctOf(m.employee_id, 'classroom') !== null && '%'}</td>
                      <td>{attPctOf(m.employee_id, 'field') ?? '—'}{attPctOf(m.employee_id, 'field') !== null && '%'}</td>
                      <td>{isAdmin ? (
                        <select value={m.status} onChange={(e) => updMember(m.employee_id, { status: e.target.value }, 'Training status updated.')}>
                          {Object.entries(M_STATUS).map(([k, [v]]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                      ) : <span className={'pill ' + M_STATUS[m.status][1]}>{M_STATUS[m.status][0]}</span>}</td>
                      <td>{isAdmin ? (
                        <input defaultValue={m.comment || ''} placeholder="Comment…"
                          onBlur={(e) => { if (e.target.value !== (m.comment || '')) updMember(m.employee_id, { comment: e.target.value }, 'Comment saved.'); }} />
                      ) : (m.comment || '—')}</td>
                      {isAdmin && <td><button className="btn link" onClick={() => removeMember(m.employee_id)}>Remove</button></td>}
                    </tr>
                  ))}
                  {!sel.members.length && <tr><td colSpan={10} className="muted">No trainees yet — add them below.</td></tr>}
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

          {(tab === 'classroom' || tab === 'field') && (
            <div className="card" style={{ overflowX: 'auto' }}>
              {isAdmin && (
                <div className="toolbar">
                  <input type="date" value={newDay} onChange={(e) => setNewDay(e.target.value)} />
                  <button className="btn" disabled={!newDay || days[kind].includes(newDay)}
                    onClick={() => { setDays((d) => ({ ...d, [kind]: [...d[kind], newDay].sort() })); setNewDay(''); }}>+ Add day</button>
                  <span className="muted mini">Click a cell to cycle – → P → A → H. Timestamps show on hover.</span>
                </div>
              )}
              <table style={{ minWidth: 640 }}>
                <thead><tr><th>Trainee</th><th>Emp ID</th><th>E-mail</th>{days[kind].map((d) => <th key={d}>{fmtDay(d)}</th>)}<th style={{ textAlign: 'right' }}>%</th></tr></thead>
                <tbody>
                  {sel.members.map((m) => (
                    <tr key={m.employee_id}>
                      <td>{m.name}</td>
                      <td className="muted">{m.zoho_emp_id || '—'}</td>
                      <td className="muted" style={{ fontSize: 12 }}>{m.email || '—'}</td>
                      {days[kind].map((d) => {
                        const cell = att[kind]?.[m.employee_id + '|' + d];
                        return <td key={d}>
                          <button className={'attcell ' + (cell?.mark || '')} disabled={!isAdmin}
                            title={cell ? `Marked ${cell.mark} · ${new Date(cell.at).toLocaleString('en-IN')}` : 'Not marked'}
                            onClick={() => cycleMark(m.employee_id, d)}>{cell?.mark || '–'}</button>
                        </td>;
                      })}
                      <td style={{ textAlign: 'right' }}>{attPctOf(m.employee_id, kind) ?? '—'}{attPctOf(m.employee_id, kind) !== null && '%'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!days[kind].length && <p className="muted" style={{ marginTop: 10 }}>No {kind} days yet{isAdmin ? ' — add the first day above.' : '.'}</p>}
            </div>
          )}

          {tab === 'assessments' && (
            <>
              {isAdmin && !assessForm && (
                <button className="btn gold" style={{ marginBottom: 12 }}
                  onClick={() => setAssessForm({ division: divisions[0] || '', name: '', max_marks: 100, assess_date: '' })}>+ New assessment</button>
              )}
              {assessForm && (
                <form className="card" onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await api.post(`/api/mavericks/${sel.id}/assessments`, assessForm);
                    toast('Assessment created — open it to enter scores.');
                    setAssessForm(null); open(sel.id);
                  } catch (e2) { setErr(e2.message); }
                }}>
                  <div className="form-grid">
                    <div><label>Division *</label>
                      <select value={assessForm.division} onChange={(e) => setAssessForm({ ...assessForm, division: e.target.value })}>
                        {divisions.map((d) => <option key={d}>{d}</option>)}
                      </select></div>
                    <div><label>Assessment name *</label><input required value={assessForm.name} onChange={(e) => setAssessForm({ ...assessForm, name: e.target.value })} placeholder="e.g. Product knowledge — Month 3" /></div>
                    <div><label>Max marks</label><input type="number" min="1" value={assessForm.max_marks} onChange={(e) => setAssessForm({ ...assessForm, max_marks: e.target.value })} /></div>
                    <div><label>Date</label><input type="date" value={assessForm.assess_date} onChange={(e) => setAssessForm({ ...assessForm, assess_date: e.target.value })} /></div>
                  </div>
                  <div className="form-actions">
                    <button className="btn gold" type="submit">Create</button>
                    <button className="btn" type="button" onClick={() => setAssessForm(null)}>Cancel</button>
                  </div>
                </form>
              )}
              {divisions.filter((dv) => sel.assessments.some((a) => a.division === dv)).map((dv) => (
                <div key={dv} className="card" style={{ padding: 0 }}>
                  <table>
                    <thead><tr><th colSpan={5} style={{ background: 'var(--panel2)' }}>{dv}</th></tr>
                      <tr><th>Assessment</th><th>Date</th><th style={{ textAlign: 'right' }}>Max</th><th style={{ textAlign: 'right' }}>Avg</th><th></th></tr></thead>
                    <tbody>
                      {sel.assessments.filter((a) => a.division === dv).map((a) => {
                        const sc = a.scores || [];
                        const avg = sc.length ? (sc.reduce((s, x) => s + Number(x.score), 0) / sc.length).toFixed(1) : '—';
                        return (
                          <tr key={a.id}>
                            <td>{a.name}</td><td className="muted">{fmtDate(a.assess_date)}</td>
                            <td style={{ textAlign: 'right' }}>{Number(a.max_marks)}</td>
                            <td style={{ textAlign: 'right' }}>{avg} <span className="muted mini">({sc.length} scored)</span></td>
                            <td style={{ textAlign: 'right' }}>
                              {isAdmin && <button className="btn link" onClick={() => setScoresFor({
                                ...a,
                                // Every trainee of the batch — division-matching ones first,
                                // so nobody disappears when division fields differ.
                                entries: [...sel.members]
                                  .sort((x, y) => ((y.division === a.division) - (x.division === a.division)) || x.name.localeCompare(y.name))
                                  .map((m) => ({
                                    employee_id: m.employee_id, name: m.name, division: m.division,
                                    score: (sc.find((x) => x.employee_id === m.employee_id) || {}).score ?? '',
                                  })),
                              })}>Enter scores</button>}
                              <button className="btn link" onClick={() => toXlsx(`Scores-${a.name.replace(/[^\w]+/g, '-')}.xlsx`,
                                ['Trainee', 'Division', 'Score', 'Max', '%'],
                                sel.members.map((m) => {
                                  const s = (sc.find((x) => x.employee_id === m.employee_id) || {}).score;
                                  return [m.name, m.division || '', s ?? '—', Number(a.max_marks), s != null ? Math.round(s / a.max_marks * 100) + '%' : '—'];
                                }))}>⬇</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
              {!sel.assessments.length && <p className="muted">No assessments yet — they are created per division, since each division is assessed separately.</p>}
            </>
          )}
        </>
      )}

      {scoresFor && (
        <div className="modal-backdrop" onClick={() => setScoresFor(null)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={saveScores}>
            <h3>{scoresFor.name} · {scoresFor.division} <span className="muted">(max {Number(scoresFor.max_marks)})</span></h3>
            {scoresFor.entries.length ? scoresFor.entries.map((en, i) => (
              <div key={en.employee_id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '4px 0' }}>
                <span style={{ flex: 1, fontSize: 13 }}>{en.name}
                  {en.division !== scoresFor.division &&
                    <span className="muted mini"> · {en.division || 'no division set'}</span>}
                </span>
                <input type="number" min="0" max={Number(scoresFor.max_marks)} step="0.5" style={{ width: 100 }}
                  value={en.score} placeholder="—"
                  onChange={(e) => {
                    const entries = [...scoresFor.entries];
                    entries[i] = { ...en, score: e.target.value === '' ? '' : Number(e.target.value) };
                    setScoresFor({ ...scoresFor, entries });
                  }} />
              </div>
            )) : <p className="muted">This batch has no trainees yet — add them on the Trainees tab first.</p>}
            <p className="muted mini" style={{ marginTop: 6 }}>
              All trainees of the batch are listed; those from other divisions are tagged. Leave a score blank to skip.
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
