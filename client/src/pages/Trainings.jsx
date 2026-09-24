import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, TRN_CATEGORIES, TRN_MODES, TRN_STATUSES, fmtRange, fmtDate, statusPill } from '../api.js';
import { useAuth, useToast } from '../App.jsx';
import { toXlsx } from '../xlsx.js';
import ImportDialog from '../components/ImportDialog.jsx';
import QrModal from '../components/QrModal.jsx';

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

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (isoDate, n) => {
  const d = new Date(isoDate + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return iso(d);
};
const spanDays = (from, to) =>
  Math.round((new Date(to + 'T00:00:00') - new Date(from + 'T00:00:00')) / 86400000) + 1;

const EMPTY = {
  title: '', batch: '', category: 'Product', mode: 'Classroom',
  trainer_type: 'internal', trainer_name: '', agency: '',
  numDays: 1, from: '', to: '', hours_per_day: 8, seats: 20,
  mandatory: false, status: 'planned', reason: '',
};

export default function Trainings() {
  const { user: me } = useAuth();
  const toast = useToast();
  const isAdmin = me.role === 'admin' || me.role === 'super_admin';
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [form, setForm] = useState(null);
  const [sel, setSel] = useState(null);       // training detail (with participants)
  const [emps, setEmps] = useState([]);
  const [addEmp, setAddEmp] = useState('');
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
          return isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
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
    setErr(null); setRemoving(null); setAddEmp('');
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
      mode: t.mode || 'Classroom', trainer_type: t.trainer_type, trainer_name: t.trainer_name || '',
      agency: t.agency || '', numDays: days.length || 1,
      from: days[0] ? days[0].slice(0, 10) : '', to: days.length ? days[days.length - 1].slice(0, 10) : '',
      hours_per_day: Number(t.hours_per_day), seats: t.seats, mandatory: t.mandatory,
      status: t.status, reason: '',
    });
    setErr(null);
  };

  const addParticipant = async () => {
    if (!addEmp) return;
    try {
      await api.post(`/api/trainings/${sel.id}/participants`, { employee_id: Number(addEmp) });
      toast('Participant added — they appear in this training\'s attendance grid.');
      setAddEmp('');
      openDetail(sel.id);
      load();
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
                {TRN_CATEGORIES.map((x) => <option key={x}>{x}</option>)}
              </select></div>
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
            {form.id && F('Reason for this correction', 'reason', { placeholder: 'Goes to the audit trail (optional)' })}
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
                  <td style={{ textAlign: 'right' }}>{t.participant_count}/{t.seats}</td>
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
              <dt>Trainer</dt><dd>{sel.trainer_type === 'external'
                ? `${sel.agency || '—'}${sel.trainer_name ? ' — ' + sel.trainer_name : ''} (external)`
                : `${sel.trainer_name || '—'} (internal)`}</dd>
              <dt>Dates</dt><dd>{fmtRange(sel.days)}</dd>
              <dt>Hours</dt><dd>{(sel.days?.length || 0) * Number(sel.hours_per_day)} h · {sel.hours_per_day} h/day</dd>
              <dt>Seats</dt><dd>{sel.participants.length}/{sel.seats} filled</dd>
              <dt>Mandatory</dt><dd>{sel.mandatory ? 'Yes' : 'No'}</dd>
              <dt>Status</dt><dd><span className={'pill ' + statusPill(sel.status)}>{TRN_STATUSES[sel.status]}</span></dd>
            </dl>

            <h3 style={{ fontSize: 14, margin: '16px 0 8px' }}>Participants ({sel.participants.length})</h3>
            {sel.participants.map((p) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px dashed var(--line)', fontSize: 13 }}>
                <span className="muted">{p.zoho_emp_id || '—'}</span>
                <span style={{ flex: 1 }}>{p.name} · {p.entity}</span>
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
            {isAdmin && !removing && (
              <div className="form-actions" style={{ flexWrap: 'wrap' }}>
                <select value={addEmp} onChange={(e) => setAddEmp(e.target.value)} style={{ flex: 1, minWidth: 200 }}>
                  <option value="">Add participant…</option>
                  {emps.filter((e) => !sel.participants.some((p) => p.id === e.id))
                    .map((e) => <option key={e.id} value={e.id}>{e.name} — {e.division || e.department || e.entity}</option>)}
                </select>
                <button className="btn gold" disabled={!addEmp} onClick={addParticipant}>Add</button>
              </div>
            )}
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
              {isAdmin && sel.public_token && (
                <button className="btn" onClick={() => setQr({
                  title: 'Feedback QR — ' + sel.title,
                  url: `${location.origin}/p/fb/${sel.public_token}`,
                  desc: 'Scan or share the link — responses tag to this training\'s feedback form automatically.',
                })}>▦ Feedback QR</button>
              )}
              <button className="btn" onClick={() => setSel(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
