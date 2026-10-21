import React, { useEffect, useState } from 'react';
import { api, fmtDate, fmtRange, gradeOf, GRADES, entLabel } from '../api.js';
import { useAuth, useToast } from '../App.jsx';
import { toXlsx } from '../xlsx.js';
import ScoreImport from '../components/ScoreImport.jsx';
import QrModal from '../components/QrModal.jsx';

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

// One row per assessment, with the same row of actions as the Feedback tab:
// Open assessment · Results · Import · Edit · QR / Link.
export default function Assessments() {
  const { user: me } = useAuth();
  const toast = useToast();
  const isAdmin = me.role === 'admin' || me.role === 'super_admin';
  const [list, setList] = useState(null);       // trainings
  const [assess, setAssess] = useState([]);     // all assessments
  const [q, setQ] = useState('');
  const [onlyWith, setOnlyWith] = useState(false);
  const [results, setResults] = useState(null); // {t, a, participants}
  const [form, setForm] = useState(null);       // new/edit assessment {…, t}
  const [scoresFor, setScoresFor] = useState(null);
  const [importing, setImporting] = useState(null); // {t, a, participants}
  const [qr, setQr] = useState(null);
  const [err, setErr] = useState(null);

  const load = () => Promise.all([api.get('/api/trainings'), api.get('/api/assessments')])
    .then(([rows, as]) => {
      setList(rows.filter((t) => t.status !== 'cancelled'));
      setAssess(as);
    })
    .catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  // The assessment with its scores + the training's participants.
  const detail = async (t, aId) => {
    const d = await api.get('/api/assessments/training/' + t.id);
    return { a: d.assessments.find((x) => x.id === aId), participants: d.participants };
  };
  const openResults = async (t, a) => {
    try { setResults({ t, ...(await detail(t, a.id)) }); } catch (e) { setErr(e.message); }
  };
  // After any change: refresh the list and, if open, the results dialog.
  const refresh = async () => {
    load();
    if (results) {
      try {
        const d = await detail(results.t, results.a.id);
        setResults(d.a ? { t: results.t, ...d } : null);
      } catch { /* list refresh is enough */ }
    }
  };

  const openImport = async (t, a) => {
    try {
      const d = await detail(t, a.id);
      if (!d.participants.length) { setErr('This training has no participants yet — add them first.'); return; }
      setImporting({ t, ...d });
    } catch (e) { setErr(e.message); }
  };

  const newForm = (t) => setForm({ t, name: '', atype: ASSESS_TYPES[0], max_marks: 100, assess_date: '', external_form_url: '', workbook_url: '' });
  const editForm = (t, a) => setForm({ ...a, t, assess_date: a.assess_date ? String(a.assess_date).slice(0, 10) : '',
    external_form_url: a.external_form_url || '', workbook_url: a.workbook_url || '' });

  const saveForm = async (e) => {
    e.preventDefault();
    const { t, ...body } = form;
    try {
      if (form.id) await api.patch('/api/assessments/' + form.id, body);
      else await api.post('/api/assessments/training/' + t.id, body);
      toast(form.id ? 'Assessment updated.' : 'Assessment created — use ▦ QR / Link to share it.');
      setForm(null); refresh();
    } catch (e2) { setErr(e2.message); }
  };

  const saveScores = async (e) => {
    e.preventDefault();
    try {
      await api.put(`/api/assessments/${scoresFor.id}/scores`, { scores: scoresFor.entries });
      toast('Scores saved.');
      setScoresFor(null); refresh();
    } catch (e2) { setErr(e2.message); }
  };

  const syncNow = async (a) => {
    try {
      const r = await api.post(`/api/assessments/${a.id}/sync`, {});
      toast(`Synced from the Form — ${r.matched} matched${r.unmatched ? `, ${r.unmatched} respondent(s) not in the participant list` : ''}.`);
    } catch (e2) { setErr(e2.message); }
    refresh();
  };

  const del = async (a) => {
    const reason = prompt(`Delete "${a.name}"?\n\nThis removes its scores too (a snapshot is kept in the audit log).\nReason for deleting:`);
    if (!reason?.trim()) return;
    try {
      await api.del(`/api/assessments/${a.id}?reason=` + encodeURIComponent(reason.trim()));
      toast('Assessment deleted — snapshot kept in the audit log.');
      setResults(null); load();
    } catch (e2) { setErr(e2.message); }
  };

  const exportA = ({ t, a, participants }) => {
    const sc = a.scores || [];
    const rows = participants.map((p) => {
      const s = sc.find((x) => x.employee_id === p.id);
      const pct = s ? pct100(s.score, a.max_marks) : null;
      return [p.zoho_emp_id || '', p.name, entLabel(p.entity), p.department || '',
        s ? Number(s.score) : '', Number(a.max_marks), s ? pct + '%' : '',
        s ? gradeOf(pct).label : '', s ? 'Completed' : 'Pending',
        s?.submitted_at ? new Date(s.submitted_at).toLocaleString('en-IN') : ''];
    });
    toXlsx(`Assessment-${(t.code || t.id)}-${a.name.replace(/[^\w]+/g, '-')}.xlsx`,
      ['Employee ID', 'Name', 'Entity', 'Department', 'Marks obtained', 'Maximum marks',
        'Percentage', 'Grade', 'Status', 'Submitted at'], rows, 'Scores');
  };

  // One row per assessment; trainings without one get a single row.
  const rows = [];
  (list || []).filter((t) =>
    !q || (t.title + ' ' + (t.batch || '') + ' ' + (t.code || '')).toLowerCase().includes(q.toLowerCase()))
    .forEach((t) => {
      const as = assess.filter((a) => a.training_id === t.id);
      if (!as.length) { if (!onlyWith) rows.push({ t, a: null, last: true }); return; }
      as.forEach((a, i) => rows.push({ t, a, last: i === as.length - 1 }));
    });

  return (
    <div>
      <div className="page-head">
        <h2>Assessments</h2>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label className="muted mini" style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={onlyWith} onChange={(e) => setOnlyWith(e.target.checked)} />
            Only trainings with an assessment
          </label>
          <input placeholder="Search training…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 240 }} />
        </div>
      </div>
      <p className="muted mini">
        Create an assessment on a training and share it with <b>▦ QR / Link</b> — it opens the
        assessment's <b>Microsoft Form</b>. Marks come in by <b>auto-sync</b> (link the Form's response
        workbook), <b>Import</b> (Forms Excel export) or manual entry, and convert to a percentage —
        (marks ÷ maximum) × 100 — and a grade.
      </p>
      <Legend />
      {qr && <QrModal {...qr} onClose={() => setQr(null)} />}
      {err && <p className="err" onClick={() => setErr(null)}>{err}</p>}
      {!list ? <p className="muted">Loading…</p> : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table>
            <thead><tr><th>Training</th><th>Assessment</th><th>Date</th><th>Completed</th><th style={{ width: 300 }}>Actions</th></tr></thead>
            <tbody>
              {rows.map(({ t, a, last }) => (
                <tr key={t.id + '-' + (a ? a.id : 'none')}>
                  <td>{t.title}{t.batch && <span className="pill soft mini" style={{ marginLeft: 6 }}>{t.batch}</span>}</td>
                  <td>
                    {a ? (
                      <>
                        <b>{a.name}</b>
                        {a.atype && a.atype !== a.name && <span className="pill mini" style={{ marginLeft: 6 }}>{a.atype}</span>}
                        <div className="muted mini">out of {Number(a.max_marks)}{a.external_form_url ? ' · Microsoft Form' : ''}</div>
                      </>
                    ) : <span className="muted mini">No assessment yet</span>}
                  </td>
                  <td className="muted">{a ? fmtDate(a.assess_date) : fmtRange(t.days || [])}</td>
                  <td>
                    {a ? (
                      <span style={a.score_count < (t.participant_count || 0) ? {} : { color: 'var(--good)' }}>
                        {a.score_count} / {t.participant_count ?? '—'}
                      </span>
                    ) : '—'}
                  </td>
                  <td>
                    {a ? (
                      <>
                        {a.external_form_url
                          ? <a className="btn link" href={a.external_form_url} target="_blank" rel="noreferrer">Open assessment</a>
                          : isAdmin && <button className="btn link" title="No Microsoft Form linked yet" onClick={() => editForm(t, a)}>Add Form link</button>}
                        <button className="btn link" onClick={() => openResults(t, a)}>Results</button>
                        {isAdmin && <button className="btn link" onClick={() => openImport(t, a)}>Import</button>}
                        {isAdmin && <button className="btn link" onClick={() => editForm(t, a)}>Edit</button>}
                        {isAdmin && a.public_token && (
                          <button className="btn link" onClick={() => setQr({
                            title: 'Assessment QR — ' + a.name,
                            url: `${location.origin}/p/as/${a.public_token}`,
                            desc: a.external_form_url
                              ? `${t.title}${t.batch ? ' — ' + t.batch : ''}. Scan or share the link — it opens the assessment's Microsoft Form; participants sign in with their Avana account so scores match them.`
                              : 'No Microsoft Form is linked yet — the link will show "not open yet" until you add one under Edit.',
                          })}>▦ QR / Link</button>
                        )}
                        {isAdmin && last && <button className="btn link" title="Add another assessment on this training" onClick={() => newForm(t)}>+ Another</button>}
                      </>
                    ) : (
                      isAdmin
                        ? <button className="btn link" onClick={() => newForm(t)}>+ Create assessment</button>
                        : <span className="muted mini">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={5} className="muted">{onlyWith ? 'No assessments yet.' : 'No trainings match.'}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {results && (() => {
        const { t, a, participants } = results;
        const sc = a.scores || [];
        const pending = participants.filter((p) => !sc.some((s) => s.employee_id === p.id));
        const done = participants.length - pending.length;
        return (
          <div className="modal-backdrop" onClick={() => setResults(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 940 }}>
              <h3>Results — {a.name} · {t.title}{t.batch ? ' — ' + t.batch : ''}</h3>
              <p className="muted mini">
                {done} of {participants.length} participant(s) completed
                {pending.length > 0 && <> · <b style={{ color: 'var(--crit)' }}>{pending.length} pending</b></>}
                {' '}· out of {Number(a.max_marks)}{a.assess_date ? ` · ${fmtDate(a.assess_date)}` : ''}
              </p>
              <Legend />
              {(a.external_form_url || a.workbook_url) && (
                <p className="muted mini" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span>
                    {a.external_form_url && <>Taken on a <a href={a.external_form_url} target="_blank" rel="noreferrer">Microsoft Form</a>. </>}
                    {a.workbook_url
                      ? <>Scores <b>sync automatically</b> every hour.
                          {a.last_synced && <> Last checked {new Date(a.last_synced).toLocaleString('en-IN')}.</>}
                          {a.sync_error && <span style={{ color: 'var(--crit)' }}> Sync problem: {a.sync_error}</span>}</>
                      : <>Link its response workbook under <b>Edit</b> for automatic sync, or use <b>Import</b>.</>}
                  </span>
                  {isAdmin && a.workbook_url && <button className="btn" onClick={() => syncNow(a)}>⟳ Sync now</button>}
                </p>
              )}
              {pending.length > 0 && (
                <details style={{ margin: '6px 0 10px' }}>
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
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead><tr><th>Employee ID</th><th>Name</th>
                    <th style={{ textAlign: 'right' }}>Marks /{Number(a.max_marks)}</th>
                    <th style={{ textAlign: 'right' }}>%</th><th>Grade</th><th>Status</th><th>Submitted</th></tr></thead>
                  <tbody>
                    {participants.map((p) => {
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
                    {!participants.length && <tr><td colSpan={7} className="muted">This training has no participants yet.</td></tr>}
                  </tbody>
                </table>
              </div>
              <div className="form-actions" style={{ flexWrap: 'wrap' }}>
                <button className="btn gold" onClick={() => exportA(results)}>⬇ Excel</button>
                {isAdmin && <button className="btn" onClick={() => setScoresFor({
                  ...a,
                  entries: participants.map((p) => ({
                    employee_id: p.id, name: p.name, zoho_emp_id: p.zoho_emp_id,
                    score: (sc.find((x) => x.employee_id === p.id) || {}).score ?? '',
                  })),
                })}>Enter scores</button>}
                {isAdmin && <button className="btn" style={{ color: 'var(--crit)' }} onClick={() => del(a)}>Delete…</button>}
                <button className="btn" onClick={() => setResults(null)}>Close</button>
              </div>
            </div>
          </div>
        );
      })()}

      {form && (
        <div className="modal-backdrop" onClick={() => setForm(null)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={saveForm} style={{ maxWidth: 560 }}>
            <h3>{form.id ? 'Edit assessment' : 'New assessment'} — {form.t.title}{form.t.batch ? ' — ' + form.t.batch : ''}</h3>
            <div className="form-grid">
              <div><label>Name</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={form.atype} /></div>
              <div><label>Assessment type</label>
                <select value={form.atype || ''} onChange={(e) => setForm({ ...form, atype: e.target.value })}>
                  {ASSESS_TYPES.map((x) => <option key={x}>{x}</option>)}
                </select></div>
              <div><label>Assessment date</label>
                <input type="date" value={form.assess_date || ''} onChange={(e) => setForm({ ...form, assess_date: e.target.value })} /></div>
              <div><label>Maximum marks *</label>
                <input type="number" min="1" value={form.max_marks} onChange={(e) => setForm({ ...form, max_marks: e.target.value })} placeholder="20 / 50 / 100" /></div>
            </div>
            <div style={{ marginTop: 8 }}><label>Microsoft Form link (what participants answer — the QR opens this)</label>
              <input style={{ width: '100%' }} value={form.external_form_url} placeholder="https://forms.office.com/…"
                onChange={(e) => setForm({ ...form, external_form_url: e.target.value })} /></div>
            <div style={{ marginTop: 8 }}><label>Response workbook link (for automatic score sync)</label>
              <input style={{ width: '100%' }} value={form.workbook_url} placeholder="https://…sharepoint.com/:x:/… (Form → Responses → Open results in Excel → Share → Copy link)"
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
        <ScoreImport title={importing.a.name + ' — ' + importing.t.title} people={importing.participants}
          maxMarks={Number(importing.a.max_marks)} postTo={`/api/assessments/${importing.a.id}/import`}
          onClose={() => setImporting(null)}
          onDone={(msg) => { toast(msg); setImporting(null); refresh(); }} />
      )}
    </div>
  );
}
