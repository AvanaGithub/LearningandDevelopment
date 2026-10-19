import React, { useEffect, useState } from 'react';
import { api, fmtDate, fmtRange, gradeOf, GRADES, entLabel } from '../api.js';
import { useAuth, useToast } from '../App.jsx';
import { toXlsx } from '../xlsx.js';
import ScoreImport from '../components/ScoreImport.jsx';

const ASSESS_TYPES = ['Written Assessment', 'Presentation', 'Teach Back', 'Product Demonstration',
  'Viva', 'Final Assessment', 'Reassessment'];
const pct100 = (score, max) => Math.round((Number(score) / Number(max)) * 100);

const GradeBadge = ({ pct }) => {
  const g = gradeOf(pct);
  return <span style={{ background: g.color, color: '#fff', borderRadius: 999, padding: '1px 9px', fontSize: 11, whiteSpace: 'nowrap' }}>{g.label}</span>;
};

const Legend = () => (
  <p className="muted mini" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
    <span>Grades:</span>
    {GRADES.map((g) => (
      <span key={g.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <span style={{ width: 9, height: 9, borderRadius: 999, background: g.color, display: 'inline-block' }} />
        {g.min === 0 ? 'Below 50%' : `${g.min}%+`} {g.label}
      </span>
    ))}
  </p>
);

export default function Assessments() {
  const { user: me } = useAuth();
  const toast = useToast();
  const isAdmin = me.role === 'admin' || me.role === 'super_admin';
  const [list, setList] = useState(null);
  const [counts, setCounts] = useState({});
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(null);       // {t, assessments, participants}
  const [form, setForm] = useState(null);     // new/edit assessment
  const [scoresFor, setScoresFor] = useState(null);
  const [importing, setImporting] = useState(null);
  const [err, setErr] = useState(null);

  const load = () => Promise.all([api.get('/api/trainings'), api.get('/api/assessments')])
    .then(([rows, as]) => {
      setList(rows.filter((t) => t.status !== 'cancelled'));
      const c = {};
      as.forEach((a) => { c[a.training_id] = (c[a.training_id] || 0) + 1; });
      setCounts(c);
    })
    .catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const open = async (t) => {
    try {
      const d = await api.get('/api/assessments/training/' + t.id);
      setSel({ t, ...d });
    } catch (e) { setErr(e.message); }
  };
  const reopen = () => { open(sel.t); load(); };

  const saveForm = async (e) => {
    e.preventDefault();
    try {
      if (form.id) await api.patch('/api/assessments/' + form.id, form);
      else await api.post('/api/assessments/training/' + sel.t.id, form);
      toast(form.id ? 'Assessment updated.' : 'Assessment created.');
      setForm(null); reopen();
    } catch (e2) { setErr(e2.message); }
  };

  const saveScores = async (e) => {
    e.preventDefault();
    try {
      await api.put(`/api/assessments/${scoresFor.id}/scores`, { scores: scoresFor.entries });
      toast('Scores saved.');
      setScoresFor(null); reopen();
    } catch (e2) { setErr(e2.message); }
  };

  const syncNow = async (a) => {
    try {
      const r = await api.post(`/api/assessments/${a.id}/sync`, {});
      toast(`Synced from the Form — ${r.matched} matched${r.unmatched ? `, ${r.unmatched} respondent(s) not in the participant list` : ''}.`);
      reopen();
    } catch (e2) { setErr(e2.message); }
  };

  const del = async (a) => {
    const reason = prompt(`Delete "${a.name}"?\n\nThis removes its scores too (a snapshot is kept in the audit log).\nReason for deleting:`);
    if (reason === null) return;
    try {
      await api.del(`/api/assessments/${a.id}?reason=` + encodeURIComponent(reason));
      toast('Assessment deleted — snapshot kept in the audit log.');
      reopen();
    } catch (e2) { setErr(e2.message); }
  };

  const exportA = (a) => {
    const sc = a.scores || [];
    const rows = sel.participants.map((p) => {
      const s = sc.find((x) => x.employee_id === p.id);
      const pct = s ? pct100(s.score, a.max_marks) : null;
      return [p.zoho_emp_id || '', p.name, entLabel(p.entity), p.department || '',
        s ? Number(s.score) : '', Number(a.max_marks), s ? pct + '%' : '',
        s ? gradeOf(pct).label : '', s ? 'Completed' : 'Pending',
        s?.submitted_at ? new Date(s.submitted_at).toLocaleString('en-IN') : ''];
    });
    toXlsx(`Assessment-${(sel.t.code || sel.t.id)}-${a.name.replace(/[^\w]+/g, '-')}.xlsx`,
      ['Employee ID', 'Name', 'Entity', 'Department', 'Marks obtained', 'Maximum marks',
        'Percentage', 'Grade', 'Status', 'Submitted at'], rows, 'Scores');
  };

  const filtered = (list || []).filter((t) =>
    !q || (t.title + ' ' + (t.batch || '') + ' ' + (t.code || '')).toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <div className="page-head">
        <h2>Assessments</h2>
        <input placeholder="Search training…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 260 }} />
      </div>
      <p className="muted mini">
        Create an assessment on a training, share the <b>Microsoft Form</b> with participants, and bring
        marks in by <b>auto-sync</b> (link the Form's response workbook), <b>Import</b> (Forms Excel export)
        or manual entry. Marks convert to a percentage — (marks ÷ maximum) × 100 — and the grade.
      </p>
      <Legend />
      {err && <p className="err" onClick={() => setErr(null)}>{err}</p>}
      {!list ? <p className="muted">Loading…</p> : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>Code</th><th>Training</th><th>Dates</th><th>Status</th>
              <th style={{ textAlign: 'right' }}>Assessments</th><th /></tr></thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.id}>
                  <td className="muted mini">{t.code}</td>
                  <td><b>{t.title}</b>{t.batch ? <span className="muted"> — {t.batch}</span> : null}</td>
                  <td className="muted mini">{fmtRange(t.days || [])}</td>
                  <td><span className="pill mini">{t.status}</span></td>
                  <td style={{ textAlign: 'right' }}>{counts[t.id] || '—'}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn" onClick={() => open(t)}>{counts[t.id] ? 'Open' : '+ Assess'}</button>
                  </td>
                </tr>
              ))}
              {!filtered.length && <tr><td colSpan={6} className="muted">No trainings match.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {sel && (
        <div className="modal-backdrop" onClick={() => setSel(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 940 }}>
            <h3>Assessments — {sel.t.title}{sel.t.batch ? ' — ' + sel.t.batch : ''}</h3>
            <Legend />
            {isAdmin && (
              <button className="btn gold" style={{ marginBottom: 10 }}
                onClick={() => setForm({ name: '', atype: ASSESS_TYPES[0], max_marks: 100, assess_date: '', external_form_url: '', workbook_url: '' })}>
                + New assessment</button>
            )}
            {sel.assessments.map((a) => {
              const sc = a.scores || [];
              const pending = sel.participants.filter((p) => !sc.some((s) => s.employee_id === p.id));
              const done = sel.participants.length - pending.length;
              return (
                <div key={a.id} className="card" style={{ marginBottom: 14, padding: 12 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <b>{a.name}</b>
                    {a.atype && a.atype !== a.name && <span className="pill mini">{a.atype}</span>}
                    <span className="muted mini">{fmtDate(a.assess_date)} · out of {Number(a.max_marks)}</span>
                    <span className="muted mini">· {done}/{sel.participants.length} completed</span>
                    <span style={{ flex: 1 }} />
                    {a.external_form_url && <a className="btn" href={a.external_form_url} target="_blank" rel="noreferrer">Open Form</a>}
                    {isAdmin && a.workbook_url && <button className="btn" onClick={() => syncNow(a)}>⟳ Sync now</button>}
                    {isAdmin && <button className="btn" onClick={() => setImporting(a)}>Import</button>}
                    {isAdmin && <button className="btn" onClick={() => setScoresFor({
                      ...a,
                      entries: sel.participants.map((p) => ({
                        employee_id: p.id, name: p.name, zoho_emp_id: p.zoho_emp_id,
                        score: (sc.find((x) => x.employee_id === p.id) || {}).score ?? '',
                      })),
                    })}>Enter scores</button>}
                    {isAdmin && <button className="btn" onClick={() => setForm({ ...a, assess_date: a.assess_date ? String(a.assess_date).slice(0, 10) : '', external_form_url: a.external_form_url || '', workbook_url: a.workbook_url || '' })}>Edit</button>}
                    <button className="btn" onClick={() => exportA(a)}>⬇</button>
                    {isAdmin && <button className="btn" onClick={() => del(a)}>🗑</button>}
                  </div>
                  {a.workbook_url && (
                    <p className="muted mini" style={{ margin: '4px 0 0' }}>
                      Auto-sync from the Form's workbook is on (hourly).
                      {a.last_synced && <> Last checked {new Date(a.last_synced).toLocaleString('en-IN')}.</>}
                      {a.sync_error && <span style={{ color: 'var(--crit)' }}> Sync problem: {a.sync_error}</span>}
                    </p>
                  )}
                  {pending.length > 0 && (
                    <details style={{ margin: '6px 0 2px' }}>
                      <summary style={{ cursor: 'pointer', fontSize: 12 }}>
                        <b style={{ color: 'var(--crit)' }}>Not yet completed ({pending.length})</b> — click to view
                      </summary>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                        {pending.map((p) => (
                          <span key={p.id} className="pill crit mini" title={[p.zoho_emp_id, p.department].filter(Boolean).join(' · ')}>{p.name}</span>
                        ))}
                      </div>
                    </details>
                  )}
                  <div style={{ overflowX: 'auto', marginTop: 6 }}>
                    <table>
                      <thead><tr><th>Employee ID</th><th>Name</th>
                        <th style={{ textAlign: 'right' }}>Marks /{Number(a.max_marks)}</th>
                        <th style={{ textAlign: 'right' }}>%</th><th>Grade</th><th>Status</th><th>Submitted</th></tr></thead>
                      <tbody>
                        {sel.participants.map((p) => {
                          const s = sc.find((x) => x.employee_id === p.id);
                          const pct = s ? pct100(s.score, a.max_marks) : null;
                          return (
                            <tr key={p.id}>
                              <td className="muted mini">{p.zoho_emp_id || '—'}</td>
                              <td>{p.name}</td>
                              <td style={{ textAlign: 'right' }}>{s ? Number(s.score) : '—'}</td>
                              <td style={{ textAlign: 'right' }}>{s ? pct + '%' : '—'}</td>
                              <td>{s ? <GradeBadge pct={pct} /> : <span className="muted mini">—</span>}</td>
                              <td>{s ? <span className="pill good mini">Completed</span> : <span className="pill crit mini">Pending</span>}</td>
                              <td className="muted mini">{s?.submitted_at ? new Date(s.submitted_at).toLocaleString('en-IN') : (s ? (s.source === 'manual' ? 'entered manually' : '') : '')}</td>
                            </tr>
                          );
                        })}
                        {!sel.participants.length && <tr><td colSpan={7} className="muted">This training has no participants yet.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
            {!sel.assessments.length && <p className="muted">No assessments on this training yet.</p>}
            <div className="form-actions"><button className="btn" onClick={() => setSel(null)}>Close</button></div>
          </div>
        </div>
      )}

      {form && (
        <div className="modal-backdrop" onClick={() => setForm(null)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={saveForm} style={{ maxWidth: 560 }}>
            <h3>{form.id ? 'Edit assessment' : 'New assessment'} — {sel.t.title}</h3>
            <div className="form-grid">
              <div><label>Name</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={form.atype} /></div>
              <div><label>Assessment type</label>
                <select value={form.atype || ''} onChange={(e) => setForm({ ...form, atype: e.target.value })}>
                  {ASSESS_TYPES.map((t) => <option key={t}>{t}</option>)}
                </select></div>
              <div><label>Assessment date</label>
                <input type="date" value={form.assess_date || ''} onChange={(e) => setForm({ ...form, assess_date: e.target.value })} /></div>
              <div><label>Maximum marks *</label>
                <input type="number" min="1" value={form.max_marks} onChange={(e) => setForm({ ...form, max_marks: e.target.value })} placeholder="20 / 50 / 100" /></div>
            </div>
            <div style={{ marginTop: 8 }}><label>Microsoft Form link (what participants answer)</label>
              <input style={{ width: '100%' }} value={form.external_form_url} placeholder="https://forms.office.com/…"
                onChange={(e) => setForm({ ...form, external_form_url: e.target.value })} /></div>
            <div style={{ marginTop: 8 }}><label>Response workbook link (for automatic score sync)</label>
              <input style={{ width: '100%' }} value={form.workbook_url} placeholder="https://… (Form → Responses → Open results in Excel → share link)"
                onChange={(e) => setForm({ ...form, workbook_url: e.target.value })} />
              <p className="muted mini" style={{ margin: '4px 0 0' }}>
                The Form must be a <b>quiz</b> (so it has points) set to "Only people in my organization
                can respond" (so e-mails are recorded). In the Form's Responses tab choose
                <b> Open results in Excel</b>, then copy that workbook's share link here — scores then
                sync automatically every hour, matched to the assigned participants by e-mail.
              </p></div>
            {err && <p className="err">{err}</p>}
            <div className="form-actions">
              <button className="btn gold" type="submit">{form.id ? 'Save changes' : 'Create assessment'}</button>
              <button className="btn" type="button" onClick={() => setForm(null)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {scoresFor && (
        <div className="modal-backdrop" onClick={() => setScoresFor(null)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={saveScores} style={{ maxWidth: 540 }}>
            <h3>{scoresFor.name} <span className="muted">(out of {Number(scoresFor.max_marks)})</span></h3>
            {scoresFor.entries.length ? scoresFor.entries.map((en, i) => {
              const p = en.score === '' ? null : pct100(en.score, scoresFor.max_marks);
              return (
                <div key={en.employee_id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', borderBottom: '1px solid var(--line)' }}>
                  <span style={{ flex: 1, fontSize: 13 }}>{en.name} <span className="muted mini">{en.zoho_emp_id}</span></span>
                  <input type="number" min="0" max={Number(scoresFor.max_marks)} step="0.5" style={{ width: 90 }}
                    value={en.score} placeholder="—"
                    onChange={(e) => {
                      const entries = [...scoresFor.entries];
                      entries[i] = { ...en, score: e.target.value === '' ? '' : Number(e.target.value) };
                      setScoresFor({ ...scoresFor, entries });
                    }} />
                  <span style={{ width: 120, textAlign: 'right' }}>{p === null ? <span className="muted mini">—</span> : <GradeBadge pct={p} />}</span>
                </div>
              );
            }) : <p className="muted">This training has no participants yet.</p>}
            <p className="muted mini" style={{ marginTop: 8 }}>Blank = not assessed. Manual entries are never overwritten by the Forms sync.</p>
            <div className="form-actions">
              <button className="btn gold" type="submit">Save scores</button>
              <button className="btn" type="button" onClick={() => setScoresFor(null)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {importing && (
        <ScoreImport title={importing.name + ' — ' + sel.t.title} people={sel.participants}
          maxMarks={Number(importing.max_marks)} postTo={`/api/assessments/${importing.id}/import`}
          onClose={() => setImporting(null)}
          onDone={(msg) => { toast(msg); setImporting(null); reopen(); }} />
      )}
    </div>
  );
}
