import React, { useEffect, useState } from 'react';
import { api, ENTITIES, ENTITY_NAMES, DIVISIONS, DEPARTMENTS, EMP_TYPES } from '../api.js';
import { useAuth, useToast } from '../App.jsx';

const EMPTY = {
  zoho_emp_id: '', name: '', email: '', entity: 'AMD',
  division: '', department: '', designation: '', manager: '',
  employment_type: 'Permanent', mobile: '', location: '', date_joined: '',
};

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

export default function Employees() {
  const { user: me } = useAuth();
  const toast = useToast();
  const isAdmin = me.role === 'admin' || me.role === 'super_admin';
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [entity, setEntity] = useState('');
  const [form, setForm] = useState(null);     // add/edit form state ({id} present = edit)
  const [sel, setSel] = useState(null);       // employee open in the detail modal
  const [deactReason, setDeactReason] = useState(null); // null = closed
  const [err, setErr] = useState(null);

  const load = () => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (entity) p.set('entity', entity);
    return api.get('/api/employees?' + p).then(setRows).catch((e) => setErr(e.message));
  };
  useEffect(() => { load(); }, [entity]);

  const save = async (e) => {
    e.preventDefault();
    setErr(null);
    const body = { ...form, date_joined: form.date_joined || null };
    try {
      if (form.id) {
        const upd = await api.patch(`/api/employees/${form.id}`, body);
        toast(`${upd.name} updated — logged to the audit trail.`);
        if (sel && sel.id === upd.id) setSel(upd);
      } else {
        await api.post('/api/employees', body);
        toast(`${form.name} added.`);
      }
      setForm(null);
      load();
    } catch (e2) { setErr(e2.message); }
  };

  const edit = (r) => {
    setSel(null);
    setErr(null);
    setForm({
      id: r.id, zoho_emp_id: r.zoho_emp_id || '', name: r.name, email: r.email || '',
      entity: r.entity, division: r.division || '', department: r.department || '',
      designation: r.designation || '', manager: r.manager || '',
      employment_type: r.employment_type || 'Permanent', mobile: r.mobile || '',
      location: r.location || '', date_joined: r.date_joined ? r.date_joined.slice(0, 10) : '',
      reason: '',
    });
  };

  const setActive = async (r, active, reason) => {
    try {
      const upd = await api.patch(`/api/employees/${r.id}`, { active, reason });
      toast(`${r.name} ${active ? 'reactivated' : 'deactivated'} — reason recorded in the audit trail.`);
      setDeactReason(null);
      setSel(upd);
      load();
    } catch (e2) { setErr(e2.message); }
  };

  const F = (label, key, extra) => (
    <div><label>{label}</label>
      <input {...extra} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
    </div>
  );
  const Sel = (label, key, options, withEmpty) => (
    <div><label>{label}</label>
      <select value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })}>
        {withEmpty && <option value="">—</option>}
        {options.map((x) => <option key={x}>{x}</option>)}
      </select>
    </div>
  );

  return (
    <>
      <div className="page-head">
        <h2>Employees</h2>
        {isAdmin && <button className="btn gold" onClick={() => { setForm({ ...EMPTY }); setErr(null); }}>Add employee</button>}
      </div>
      <div className="toolbar">
        <input placeholder="Search name / e-mail / Zoho ID" value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()} style={{ minWidth: 240 }} />
        <select value={entity} onChange={(e) => setEntity(e.target.value)}>
          <option value="">All entities</option>
          {ENTITIES.map((x) => <option key={x} value={x}>{ENTITY_NAMES[x]}</option>)}
        </select>
        <button className="btn" onClick={load}>Search</button>
      </div>

      {form && (
        <form className="card" onSubmit={save}>
          <h3 style={{ fontSize: 15, marginBottom: 12 }}>{form.id ? `Edit employee — ${form.zoho_emp_id || form.name}` : 'Add employee'}</h3>
          <div className="form-grid">
            {form.id
              ? <div><label>Zoho employee ID (locked)</label><input value={form.zoho_emp_id} readOnly style={{ background: 'var(--panel2)' }} /></div>
              : F('Zoho employee ID', 'zoho_emp_id', { placeholder: 'ZH-1234' })}
            {F('Full name *', 'name', { required: true })}
            <div><label>Entity *</label>
              <select value={form.entity} onChange={(e) => setForm({ ...form, entity: e.target.value })}>
                {ENTITIES.map((x) => <option key={x} value={x}>{ENTITY_NAMES[x]}</option>)}
              </select></div>
            {Sel('Division', 'division', DIVISIONS, true)}
            {Sel('Department', 'department', DEPARTMENTS, true)}
            {F('Designation', 'designation', { placeholder: 'e.g. Sales Executive' })}
            {F('Reporting manager', 'manager', { placeholder: 'Manager name' })}
            {Sel('Employment type', 'employment_type', EMP_TYPES, false)}
            {F('Official e-mail', 'email', { type: 'email', placeholder: 'name@avanasurgical.com' })}
            {F('Mobile', 'mobile', { placeholder: '+91 …' })}
            {F('Date of joining', 'date_joined', { type: 'date' })}
            {F('Location / territory', 'location', { placeholder: 'e.g. Chennai' })}
            {form.id && F('Reason for this correction', 'reason', { placeholder: 'Goes to the audit trail (optional)' })}
          </div>
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
              <th>Code</th><th>Name</th><th>Entity</th><th>Division</th><th>Department</th><th>Designation</th><th>Manager</th><th>Status</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="rowlink" onClick={() => { setSel(r); setDeactReason(null); setErr(null); }}>
                  <td className="muted">{r.zoho_emp_id || '—'}</td>
                  <td>{r.name}<div className="muted" style={{ fontSize: 11 }}>{r.email}</div></td>
                  <td>{r.entity}</td>
                  <td>{r.division}</td>
                  <td>{r.department}</td>
                  <td>{r.designation}</td>
                  <td>{r.manager}</td>
                  <td><span className={'pill ' + (r.active ? 'good' : 'crit')}>{r.active ? 'Active' : 'Inactive'}</span></td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={8} className="muted">No employees match — add one, or bulk Excel import arrives with a coming build.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {sel && (
        <div className="modal-backdrop" onClick={() => setSel(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{sel.name} · <span className="muted">{sel.zoho_emp_id || 'no Zoho ID'}</span></h3>
            <dl className="kv">
              <dt>Entity</dt><dd>{ENTITY_NAMES[sel.entity] || sel.entity}</dd>
              <dt>Division / Department</dt><dd>{[sel.division, sel.department].filter(Boolean).join(' · ') || '—'}</dd>
              <dt>Designation</dt><dd>{sel.designation || '—'}</dd>
              <dt>Reporting manager</dt><dd>{sel.manager || '—'}</dd>
              <dt>Employment type</dt><dd>{sel.employment_type || '—'}</dd>
              <dt>Official e-mail</dt><dd>{sel.email || '—'}</dd>
              <dt>Mobile</dt><dd>{sel.mobile || '—'}</dd>
              <dt>Date of joining</dt><dd>{fmtDate(sel.date_joined)}</dd>
              <dt>Location</dt><dd>{sel.location || '—'}</dd>
              <dt>Status</dt><dd><span className={'pill ' + (sel.active ? 'good' : 'crit')}>{sel.active ? 'Active' : 'Inactive'}</span></dd>
            </dl>
            <p className="muted" style={{ fontSize: 12, marginTop: 14 }}>
              Training history appears here once the Trainings module is live — history follows the person across entities.
            </p>
            {err && <p className="err">{err}</p>}
            {isAdmin && deactReason === null && (
              <div className="form-actions">
                <button className="btn gold" onClick={() => edit(sel)}>Edit</button>
                {sel.active
                  ? <button className="btn" onClick={() => setDeactReason('')}>Deactivate…</button>
                  : <button className="btn" onClick={() => setActive(sel, true, 'Reactivated')}>Reactivate</button>}
                <button className="btn" onClick={() => setSel(null)}>Close</button>
              </div>
            )}
            {isAdmin && deactReason !== null && (
              <div className="form-actions" style={{ flexWrap: 'wrap' }}>
                <input autoFocus placeholder="Reason for deactivation (required — audit trail)" value={deactReason}
                  onChange={(e) => setDeactReason(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
                <button className="btn gold" disabled={!deactReason.trim()}
                  onClick={() => setActive(sel, false, deactReason.trim())}>Confirm deactivate</button>
                <button className="btn" onClick={() => setDeactReason(null)}>Cancel</button>
              </div>
            )}
            {!isAdmin && <div className="form-actions"><button className="btn" onClick={() => setSel(null)}>Close</button></div>}
          </div>
        </div>
      )}
    </>
  );
}
