import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, apiUpload, entLabel, toISODay, DEPARTMENTS, DIVISIONS, TRN_CATEGORIES, TRN_MODES, TRN_STATUSES, fmtRange, fmtDate, statusPill } from '../api.js';
import { useAuth, useToast, useSettings } from '../App.jsx';
import { toXlsx } from '../xlsx.js';
import ImportDialog from '../components/ImportDialog.jsx';
import QrModal from '../components/QrModal.jsx';
import MSel from '../components/MSel.jsx';

const IMPORT_FIELDS = [
  { key: 'title', label: 'Training title', req: true, syn: ['title', 'training title', 'training name', 'training', 'name'] },
  { key: 'batch', label: 'Batch', syn: ['batch'] },
  { key: 'category', label: 'Category', syn: ['category'] },
  { key: 'mode', label: 'Mode', syn: ['mode', 'delivery'] },
  { key: 'trainer_type', label: 'Trainer type (internal/external)', syn: ['trainer type', 'internal/external'] },
  { key: 'trainer_name', label: 'Trainer name', syn: ['trainer', 'faculty'] },
  { key: 'agency', label: 'Agency', syn: ['agency', 'vendor'] },
  { key: 'dates', label: 'Dates (comma-separated)', req: true, syn: ['dates', 'date', 'schedule', 'days'] },
  { key: 'hours_per_day', label: 'Hours per day', syn: ['hours per day', 'hours/day', 'hours'] },
  { key: 'seats', label: 'Seats', syn: ['seats', 'capacity', 'max seats'] },
  { key: 'mandatory', label: 'Mandatory (yes/no)', syn: ['mandatory', 'compulsory'] },
];

const iso = (d) => toISODay(d);
const addDays = (isoDate, n) => {
  const d = new Date(isoDate + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return iso(d);
};
const spanDays = (from, to) =>
  Math.round((new Date(to + 'T00:00:00') - new Date(from + 'T00:00:00')) / 86400000) + 1;

const EMPTY = {
  title: '', batch: '', category: 'Product', department: [], division: [], mode: 'Classroom',
  trainer_type: 'internal', trainer_name: '', agency: '',
  numDays: 1, from: '', to: '', hours_per_day: 8, seats: 20,
  mandatory: false, status: 'planned', validity_months: '',
  agenda_file: null, agenda_name: '', reason: '',
  nom_self: false, nom_manager: false, nom_leader: false, nom_deadline: '', completion_deadline: '',
};

export default function Trainings() {
  const { user: me } = useAuth();
  const { settings } = useSettings();
  const toast = useToast();
  const isAdmin = me.role === 'admin' || me.role === 'super_admin';
  const categories = settings?.trn_categories || TRN_CATEGORIES;
  const departments = settings?.departments || DEPARTMENTS;
  const divisions = settings?.divisions || DIVISIONS;

  const uploadAgenda = async (files) => {
    try {
      const [f] = await apiUpload(files);
      setForm((fm) => ({ ...fm, agenda_file: f.id, agenda_name: f.name }));
      toast('Agenda attached — it will show on the training and the calendar.');
    } catch (e2) { setErr(e2.message); }
  };

  const deleteTrn = async (t) => {
    const reason = window.prompt(`Delete ${t.code} permanently? For test entries and wrong records only — a training with attendance, feedback or expenses must be set to Cancelled instead. Its participant roster (if any) is removed with it.\n\nReason (required, audit trail):`);
    if (!reason?.trim()) return;
    try {
      await api.del(`/api/trainings/${t.id}?reason=` + encodeURIComponent(reason.trim()));
      toast(`${t.code} deleted — reason recorded in the audit trail.`);
      setSel(null); load();
    } catch (e2) { setErr(e2.message); }
  };
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [form, setForm] = useState(null);
  const [sel, setSel] = useState(null);       // training detail (with participants)
  const [emps, setEmps] = useState([]);
  const [addEmps, setAddEmps] = useState([]);   // multi-choice add-participant selection
  const [pDept, setPDept] = useState([]);       // narrow the add-participant list by departments
  const [pDiv, setPDiv] = useState([]);         // …divisions
  const [pMgr, setPMgr] = useState([]);         // …and reporting managers
  const [nomSlot, setNomSlot] = useState('');   // preferred slot for a manager/leader nomination
  const [removing, setRemoving] = useState(null); // {empId, reason}
  const [importing, setImporting] = useState(false);
  const [qr, setQr] = useState(null);             // {title, url, desc}
  const [err, setErr] = useState(null);

  const doImport = async (objs) => {
    let ok = 0, fail = 0, firstErr = null;
    for (const o of objs) {
      try {
        const days = String(o.dates || '').split(/[,;|]/).map((s) => {
          const t = Date.parse(s.trim());
          return isNaN(t) ? null : toISODay(new Date(t));
        }).filter(Boolean);
        if (!days.length) throw new Error('No valid dates in "' + o.dates + '"');
        const external = /ext/i.test(o.trainer_type || '');
        await api.post('/api/trainings', {
          title: o.title, batch: o.batch, category: o.category || 'Product', mode: o.mode || 'Classroom',
          trainer_type: external ? 'external' : 'internal',
          trainer_name: o.trainer_name || (external ? '' : 'To be assigned'),
          agency: o.agency, days,
          hours_per_day: Number(o.hours_per_day) || 8, seats: Number(o.seats) || 20,
          mandatory: /yes|true|1|mand/i.test(o.mandatory || ''), status: 'planned',
        });
        ok++;
      } catch (e2) { fail++; if (!firstErr) firstErr = e2.message; }
    }
    load();
    return `${ok} training(s) imported${fail ? ` · ${fail} skipped (${firstErr})` : ''}.`;
  };

  const doExport = () => toXlsx('Trainings.xlsx',
    ['Code', 'Title', 'Batch', 'Category', 'Mode', 'Trainer type', 'Trainer/Agency', 'Dates', 'Hours', 'Seats', 'Participants', 'Mandatory', 'Status'],
    (rows || []).map((t) => [t.code, t.title, t.batch || '', t.category || '', t.mode || '', t.trainer_type,
      t.trainer_type === 'external' ? (t.agency || t.trainer_name || '') : (t.trainer_name || ''),
      (t.days || []).map((d) => d.slice(0, 10)).join(', '),
      (t.days?.length || 0) * Number(t.hours_per_day), t.seats, t.participant_count,
      t.mandatory ? 'Yes' : 'No', TRN_STATUSES[t.status]]),
    'Trainings');
  const [params, setParams] = useSearchParams();

  const load = () => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (status) p.set('status', status);
    return api.get('/api/trainings?' + p).then(setRows).catch((e) => setErr(e.message));
  };
  useEffect(() => { load(); }, [status]);
  useEffect(() => { api.get('/api/employees?active=true').then(setEmps).catch(() => {}); }, []);

  const openDetail = (id) => {
    setErr(null); setRemoving(null); setAddEmps([]);
    setPDept([]); setPDiv([]); setPMgr([]);
    api.get('/api/trainings/' + id).then(setSel).catch((e) => setErr(e.message));
  };
  // Calendar deep-link: /trainings?open=<id>
  useEffect(() => {
    const id = params.get('open');
    if (id) { openDetail(id); setParams({}, { replace: true }); }
  }, []);

  const totalHours = form ? (Number(form.numDays) || 1) * (Number(form.hours_per_day) || 0) : 0;

  const setNumDays = (n) => {
    n = Math.min(60, Math.max(1, Number(n) || 1));
    setForm((f) => ({ ...f, numDays: n, to: f.from && n > 1 ? addDays(f.from, n - 1) : f.from }));
  };
  const setFrom = (v) => setForm((f) => ({ ...f, from: v, to: f.numDays > 1 && v ? addDays(v, f.numDays - 1) : v }));
  const setTo = (v) => setForm((f) => {
    if (!f.from || !v || v < f.from) return { ...f, to: v };
    return { ...f, to: v, numDays: Math.min(60, spanDays(f.from, v)) };
  });

  const save = async (e) => {
    e.preventDefault();
    setErr(null);
    if (!form.from) return setErr(form.numDays > 1 ? 'Pick the from date.' : 'Pick the training date.');
    const n = Number(form.numDays) || 1;
    const days = Array.from({ length: n }, (_, i) => addDays(form.from, i));
    const body = { ...form, days };
    try {
      if (form.id) {
        await api.patch('/api/trainings/' + form.id, body);
        toast(`${form.title} updated — logged to the audit trail.`);
        if (sel && sel.id === form.id) openDetail(form.id);
      } else {
        const t = await api.post('/api/trainings', body);
        toast(`${t.code} saved — ${days.length} day(s), ${totalHours} h total. It is on the Training Calendar.`);
      }
      setForm(null);
      load();
    } catch (e2) { setErr(e2.message); }
  };

  const edit = (t) => {
    const days = t.days || [];
    setSel(null);
    setForm({
      id: t.id, title: t.title, batch: t.batch || '', category: t.category || 'Product',
      department: t.department ? t.department.split(',').map((s) => s.trim()).filter(Boolean) : [],
      division: t.division ? t.division.split(',').map((s) => s.trim()).filter(Boolean) : [],
      mode: t.mode || 'Classroom', trainer_type: t.trainer_type, trainer_name: t.trainer_name || '',
      agency: t.agency || '', numDays: days.length || 1,
      from: days[0] ? days[0].slice(0, 10) : '', to: days.length ? days[days.length - 1].slice(0, 10) : '',
      hours_per_day: Number(t.hours_per_day), seats: t.seats, mandatory: t.mandatory,
      status: t.status, validity_months: t.validity_months || '',
      agenda_file: t.agenda_file || null, agenda_name: t.agenda_file ? 'Current agenda' : '', reason: '',
      nom_self: Boolean(t.nom_self), nom_manager: Boolean(t.nom_manager), nom_leader: Boolean(t.nom_leader),
      nom_deadline: t.nom_deadline ? t.nom_deadline.slice(0, 10) : '',
      completion_deadline: t.completion_deadline ? t.completion_deadline.slice(0, 10) : '',
    });
    setErr(null);
  };

  const addParticipant = async () => {
    if (!addEmps.length) return;
    let ok = 0, firstErr = null;
    for (const empId of addEmps) {
      try {
        await api.post(`/api/trainings/${sel.id}/participants`, { employee_id: Number(empId) });
        ok++;
      } catch (e2) { if (!firstErr) firstErr = e2.message; }
    }
    if (ok) toast(`${ok} participant(s) added — they appear in this training's attendance grid.`);
    if (firstErr) setErr(firstErr);
    setAddEmps([]);
    openDetail(sel.id);
    load();
  };
  const nominate = async () => {
    try {
      const r = await api.post(`/api/trainings/${sel.id}/nominate`, { employee_ids: addEmps.map(Number), slot: nomSlot });
      toast(`${r.added} nominated${r.already ? ` · ${r.already} already on the training` : ''}${r.not_reportees ? ` · ${r.not_reportees} skipped (not your reportees)` : ''}.`);
      setAddEmps([]); setNomSlot('');
      openDetail(sel.id); load();
    } catch (e2) { setErr(e2.message); }
  };

  const removeParticipant = async () => {
    try {
      await api.del(`/api/trainings/${sel.id}/participants/${removing.empId}?reason=` + encodeURIComponent(removing.reason));
      toast('Participant removed — reason recorded in the audit trail.');
      setRemoving(null);
      openDetail(sel.id);
      load();
    } catch (e2) { setErr(e2.message); }
  };

  const F = (label, key, extra) => (
    <div><label>{label}</label>
      <input {...extra} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
    </div>
  );

  return (
    <>
      <div className="page-head">
        <h2>Trainings</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {isAdmin && <button className="btn" onClick={() => setImporting(true)}>⬆ Import (Excel)</button>}
          {isAdmin && <button className="btn" onClick={doExport}>⬇ Export</button>}
          {isAdmin && <button className="btn gold" onClick={() => { setForm({ ...EMPTY }); setErr(null); }}>Plan training</button>}
        </div>
      </div>
      {importing && (
        <ImportDialog title="Import trainings — map your columns" fields={IMPORT_FIELDS}
          onImport={doImport} onClose={(summary) => { setImporting(false); if (summary) toast(summary); }} />
      )}
      {qr && <QrModal {...qr} onClose={() => setQr(null)} />}
      <div className="toolbar">
        <input placeholder="Search title / code / batch" value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()} style={{ minWidth: 220 }} />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(TRN_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="btn" onClick={load}>Search</button>
      </div>

      {form && (
        <form className="card" onSubmit={save}>
          <h3 style={{ fontSize: 15, marginBottom: 12 }}>{form.id ? 'Edit training' : 'Plan a training'}</h3>
          <div className="form-grid">
            {F('Training title *', 'title', { required: true })}
            {F('Batch (optional)', 'batch', { placeholder: 'e.g. Batch 2' })}
            <div><label>Category</label>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {categories.map((x) => <option key={x}>{x}</option>)}
              </select></div>
            <div><label>Departments (optional)</label>
              <MSel label="Departments" empty="All departments" allowAll
                options={departments.map((x) => ({ v: x, t: x }))}
                sel={form.department} onChange={(v) => setForm({ ...form, department: v })} />
            </div>
            <div><label>Divisions (optional)</label>
              <MSel label="Divisions" empty="All divisions" allowAll
                options={divisions.map((x) => ({ v: x, t: x }))}
                sel={form.division} onChange={(v) => setForm({ ...form, division: v })} />
            </div>
            <div><label>Mode</label>
              <select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
                {TRN_MODES.map((x) => <option key={x}>{x}</option>)}
              </select></div>
            <div><label>Trainer type</label>
              <select value={form.trainer_type} onChange={(e) => setForm({ ...form, trainer_type: e.target.value })}>
                <option value="internal">Internal</option>
                <option value="external">External agency</option>
              </select></div>
            {form.trainer_type === 'external' && F('External agency name *', 'agency', { required: true })}
            {F(form.trainer_type === 'external' ? 'Trainer name (optional)' : 'Trainer name *', 'trainer_name',
              form.trainer_type === 'external' ? {} : { required: true })}
            <div><label>No. of days of training</label>
              <input type="number" min="1" max="60" value={form.numDays} onChange={(e) => setNumDays(e.target.value)} /></div>
            <div><label>{form.numDays > 1 ? 'From date' : 'Training date'}</label>
              <input type="date" value={form.from} onChange={(e) => setFrom(e.target.value)} /></div>
            {form.numDays > 1 && (
              <div><label>To date (auto: from + {form.numDays - 1})</label>
                <input type="date" value={form.to} onChange={(e) => setTo(e.target.value)} /></div>
            )}
            <div><label>Hours per day</label>
              <input type="number" min="1" max="12" step="0.5" value={form.hours_per_day}
                onChange={(e) => setForm({ ...form, hours_per_day: e.target.value })} /></div>
            <div><label>Total hours (auto)</label>
              <input value={totalHours} readOnly style={{ background: 'var(--panel2)' }} /></div>
            <div><label>Maximum seats</label>
              <input type="number" min="1" value={form.seats} onChange={(e) => setForm({ ...form, seats: e.target.value })} /></div>
            <div><label>Status</label>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {Object.entries(TRN_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div>
            <div><label>Mandatory?</label>
              <select value={form.mandatory ? 'yes' : 'no'} onChange={(e) => setForm({ ...form, mandatory: e.target.value === 'yes' })}>
                <option value="no">Optional</option>
                <option value="yes">Mandatory</option>
              </select></div>
            {F('Re-training validity (months, optional)', 'validity_months', { type: 'number', min: 1, placeholder: 'e.g. 12 — drives re-training due reports' })}
            <div><label>Training agenda (optional)</label>
              {form.agenda_file
                ? <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, paddingTop: 6 }}>
                    <span>📄 {form.agenda_name || 'Attached'}</span>
                    <button type="button" className="btn link" onClick={() => setForm({ ...form, agenda_file: null, agenda_name: '' })}>✕</button>
                  </div>
                : <input type="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.xlsx" onChange={(e) => e.target.files.length && uploadAgenda(e.target.files)} />}
            </div>
            {form.id && F('Reason for this correction', 'reason', { placeholder: 'Goes to the audit trail (optional)' })}
            {me.role === 'super_admin' && (
              <div style={{ gridColumn: '1/-1', border: '1px dashed var(--line)', borderRadius: 10, padding: '10px 12px' }}>
                <b style={{ fontSize: 13 }}>Who can nominate? <span className="muted mini">(super admin only — admins always assign directly)</span></b>
                <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', margin: '8px 0' }}>
                  {[['nom_self', 'Employees can nominate themselves (via the nomination QR/link)'],
                    ['nom_manager', 'Managers can nominate their team members'],
                    ['nom_leader', 'Leaders can nominate their team members']].map(([k, label]) => (
                    <label key={k} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
                      <input type="checkbox" checked={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.checked })} />
                      {label}
                    </label>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  <label className="muted mini">Nomination deadline
                    <input type="date" style={{ marginLeft: 6 }} value={form.nom_deadline}
                      onChange={(e) => setForm({ ...form, nom_deadline: e.target.value })} /></label>
                  <label className="muted mini">Completion deadline
                    <input type="date" style={{ marginLeft: 6 }} value={form.completion_deadline}
                      onChange={(e) => setForm({ ...form, completion_deadline: e.target.value })} /></label>
                </div>
                <p className="muted mini" style={{ margin: '6px 0 0' }}>
                  Self-nomination respects the Departments/Divisions above — employees outside them cannot nominate themselves.
                </p>
              </div>
            )}
          </div>
          {form.numDays > 1 && form.from && form.to &&
            <p className="muted mini" style={{ marginTop: 8 }}>Blocked automatically: {fmtDate(form.from)} → {fmtDate(form.to)} · {form.numDays} consecutive days.</p>}
          {err && <p className="err">{err}</p>}
          <div className="form-actions">
            <button className="btn gold" type="submit">Save</button>
            <button className="btn" type="button" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </form>
      )}

      {!rows ? <p className="muted">{err || 'Loading…'}</p> : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead><tr>
              <th>Code</th><th>Title</th><th>Category</th><th>Mode</th><th>Trainer</th><th>Dates</th>
              <th style={{ textAlign: 'right' }}>Hours</th><th style={{ textAlign: 'right' }}>Participants</th><th>Status</th>
            </tr></thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="rowlink" onClick={() => openDetail(t.id)}>
                  <td className="muted">{t.code}</td>
                  <td>{t.title}
                    {t.batch && <span className="pill soft mini" style={{ marginLeft: 6 }}>{t.batch}</span>}
                    {t.mandatory && <span className="pill warn mini" style={{ marginLeft: 6 }}>Mandatory</span>}
                  </td>
                  <td>{t.category}</td>
                  <td>{t.mode}</td>
                  <td>{t.trainer_type === 'external' ? (t.agency || t.trainer_name) : t.trainer_name}</td>
                  <td className="muted">{fmtRange(t.days)}</td>
                  <td style={{ textAlign: 'right' }}>{(t.days?.length || 0) * Number(t.hours_per_day)}</td>
                  <td style={{ textAlign: 'right' }}
                    title={t.marked_count > 0
                      ? `${t.attended_count} attended (present/half-day) of ${t.participant_count} enrolled · ${t.seats} seats`
                      : `${t.participant_count} enrolled of ${t.seats} seats — attendance not marked yet`}>
                    {t.marked_count > 0
                      ? <>{t.attended_count}/{t.participant_count}</>
                      : <span className="muted">{t.participant_count}/{t.seats}</span>}
                  </td>
                  <td><span className={'pill ' + statusPill(t.status)}>{TRN_STATUSES[t.status]}</span></td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={9} className="muted">No trainings yet — plan the first one.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {sel && (
        <div className="modal-backdrop" onClick={() => setSel(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{sel.code} · {sel.title}{sel.batch ? ` — ${sel.batch}` : ''}</h3>
            <dl className="kv">
              <dt>Category / Mode</dt><dd>{[sel.category, sel.mode].filter(Boolean).join(' · ') || '—'}</dd>
              {sel.department && <><dt>Departments</dt><dd>{sel.department}</dd></>}
              {sel.division && <><dt>Divisions</dt><dd>{sel.division}</dd></>}
              <dt>Trainer</dt><dd>{sel.trainer_type === 'external'
                ? `${sel.agency || '—'}${sel.trainer_name ? ' — ' + sel.trainer_name : ''} (external)`
                : `${sel.trainer_name || '—'} (internal)`}</dd>
              <dt>Dates</dt><dd>{fmtRange(sel.days)}</dd>
              <dt>Hours</dt><dd>{(sel.days?.length || 0) * Number(sel.hours_per_day)} h · {sel.hours_per_day} h/day</dd>
              <dt>Seats</dt><dd>{sel.participants.length}/{sel.seats} filled</dd>
              <dt>Mandatory</dt><dd>{sel.mandatory ? `Yes${sel.validity_months ? ` · re-training every ${sel.validity_months} months` : ''}` : 'No'}</dd>
              <dt>Status</dt><dd><span className={'pill ' + statusPill(sel.status)}>{TRN_STATUSES[sel.status]}</span></dd>
              {(sel.nom_self || sel.nom_manager || sel.nom_leader) && <>
                <dt>Nominations</dt><dd>
                  {[sel.nom_self && 'Self', sel.nom_manager && 'Managers', sel.nom_leader && 'Leaders'].filter(Boolean).join(' · ')}
                  {sel.nom_deadline && <span className="muted"> · until {fmtDate(sel.nom_deadline)}</span>}
                </dd>
              </>}
              {sel.completion_deadline && <><dt>Complete by</dt><dd>{fmtDate(sel.completion_deadline)}</dd></>}
              {sel.agenda_file && <><dt>Agenda</dt><dd><a href={'/api/files/' + sel.agenda_file} target="_blank" rel="noreferrer">📄 View / download agenda</a></dd></>}
            </dl>

            <h3 style={{ fontSize: 14, margin: '16px 0 8px' }}>Participants ({sel.participants.length})</h3>
            {sel.participants.map((p) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px dashed var(--line)', fontSize: 13 }}>
                <span className="muted">{p.zoho_emp_id || '—'}</span>
                <span style={{ flex: 1 }}>{p.name} · {entLabel(p.entity)}
                  <span className="pill soft mini" style={{ marginLeft: 6 }}
                    title={p.nominated_by ? `By ${p.nominated_by}` : ''}>
                    {{ self: 'Self', manager: 'Manager', leader: 'Leader', admin: 'Admin' }[p.nom_source || 'admin']}
                  </span>
                  {p.nom_slot && <span className="pill warn mini" style={{ marginLeft: 4 }}>Slot: {p.nom_slot}</span>}
                </span>
                {isAdmin && (removing?.empId === p.id ? null :
                  <button className="btn link" onClick={() => setRemoving({ empId: p.id, name: p.name, reason: '' })}>Remove…</button>)}
              </div>
            ))}
            {!sel.participants.length && <p className="muted mini">No participants yet — add them below.</p>}
            {isAdmin && removing && (
              <div className="form-actions" style={{ flexWrap: 'wrap' }}>
                <input autoFocus placeholder={`Reason for removing ${removing.name} (required — audit trail)`} value={removing.reason}
                  onChange={(e) => setRemoving({ ...removing, reason: e.target.value })} style={{ flex: 1, minWidth: 220 }} />
                <button className="btn gold" disabled={!removing.reason.trim()} onClick={removeParticipant}>Confirm remove</button>
                <button className="btn" onClick={() => setRemoving(null)}>Cancel</button>
              </div>
            )}
            {isAdmin && !removing && (() => {
              const mgrOf = (e) => (e.manager || '').replace(/^Mentor:\s*/i, '').trim();
              const depts = [...new Set(emps.map((e) => e.department).filter(Boolean))].sort();
              const divs = [...new Set(emps.map((e) => e.division).filter(Boolean))].sort();
              const mgrs = [...new Set(emps.map(mgrOf).filter(Boolean))].sort();
              const match = (e) =>
                (!pDept.length || pDept.includes(e.department)) &&
                (!pDiv.length || pDiv.includes(e.division)) &&
                (!pMgr.length || pMgr.includes(mgrOf(e)));
              const matching = emps.filter(match);
              const options = matching
                .filter((e) => !sel.participants.some((p) => p.id === e.id))
                .map((e) => ({ v: e.id, t: `${e.name} — ${e.division || e.department || entLabel(e.entity)}` }));
              const alreadyIn = matching.length - options.length;
              return (
                <div className="form-actions" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
                  <MSel label="Departments" options={depts.map((d) => ({ v: d, t: d }))}
                    sel={pDept} onChange={(v) => { setPDept(v); setAddEmps([]); }} />
                  <MSel label="Divisions" options={divs.map((d) => ({ v: d, t: d }))}
                    sel={pDiv} onChange={(v) => { setPDiv(v); setAddEmps([]); }} />
                  <MSel label="Managers" options={mgrs.map((m) => ({ v: m, t: m }))}
                    sel={pMgr} onChange={(v) => { setPMgr(v); setAddEmps([]); }} />
                  <MSel label="Add participants" empty="none picked" allowAll
                    options={options} sel={addEmps} onChange={setAddEmps} />
                  <button className="btn gold" disabled={!addEmps.length} onClick={addParticipant}>
                    Add{addEmps.length > 1 ? ` ${addEmps.length}` : ''}
                  </button>
                  <span className="muted mini">
                    {options.length} available{alreadyIn > 0 ? ` · ${alreadyIn} matching already on this training` : ''} ·
                    {' '}{sel.participants.length} added · seats are a guide, not a limit
                  </span>
                </div>
              );
            })()}
            {!isAdmin && ((me.role === 'manager' && sel.nom_manager) || (me.role === 'leader' && sel.nom_leader)) && (() => {
              const mine = emps.filter((e) =>
                (e.manager || '').replace(/^Mentor:\s*/i, '').trim().toLowerCase() === (me.name || '').trim().toLowerCase() &&
                !sel.participants.some((p) => p.id === e.id));
              return (
                <div className="form-actions" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
                  <MSel label="Nominate team member(s)" empty="none picked" allowAll
                    options={mine.map((e) => ({ v: e.id, t: `${e.name} — ${e.division || e.department || entLabel(e.entity)}` }))}
                    sel={addEmps} onChange={setAddEmps} />
                  <select value={nomSlot} onChange={(e) => setNomSlot(e.target.value)} title="Preferred slot">
                    <option value="">Any slot / day</option>
                    {(sel.days || []).map((d) => <option key={d} value={fmtDate(d)}>{fmtDate(d)}</option>)}
                  </select>
                  <button className="btn gold" disabled={!addEmps.length} onClick={nominate}>
                    Nominate{addEmps.length > 1 ? ` ${addEmps.length}` : ''}
                  </button>
                  <span className="muted mini">
                    Your reportees only{sel.nom_deadline ? ` · until ${fmtDate(sel.nom_deadline)}` : ''}
                  </span>
                </div>
              );
            })()}
            {err && <p className="err">{err}</p>}
            <div className="form-actions" style={{ flexWrap: 'wrap' }}>
              {isAdmin && <button className="btn gold" onClick={() => edit(sel)}>Edit</button>}
              {isAdmin && sel.public_token && (
                <button className="btn" onClick={() => setQr({
                  title: 'Attendance QR — ' + sel.title,
                  url: `${location.origin}/p/att/${sel.public_token}`,
                  desc: 'Display this at the venue. A participant scans it on their phone, picks their name, and is marked Present for the day — tagged to ' + sel.code + ' automatically.',
                })}>▦ Attendance QR</button>
              )}
              {isAdmin && sel.public_token && sel.nom_self && (
                <button className="btn" onClick={() => setQr({
                  title: 'Nomination QR — ' + sel.title,
                  url: `${location.origin}/p/nom/${sel.public_token}`,
                  desc: 'Share this QR or link — employees sign in with Zoho and nominate themselves. Only eligible departments/divisions, until the nomination deadline.',
                })}>▦ Nomination QR</button>
              )}
              {isAdmin && sel.public_token && (
                <button className="btn" onClick={() => setQr({
                  title: 'Feedback QR — ' + sel.title,
                  url: `${location.origin}/p/fb/${sel.public_token}`,
                  desc: 'Scan or share the link — responses tag to this training\'s feedback form automatically.',
                })}>▦ Feedback QR</button>
              )}
              {isAdmin && (
                <button className="btn" style={{ color: 'var(--crit)' }} onClick={() => deleteTrn(sel)}>Delete…</button>
              )}
              <button className="btn" onClick={() => setSel(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
