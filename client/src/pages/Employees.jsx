import React, { useEffect, useState } from 'react';
import { api, ENTITIES } from '../api.js';
import { useAuth, useToast } from '../App.jsx';

const EMPTY = {
  zoho_emp_id: '', name: '', email: '', entity: 'AMD',
  division: '', department: '', designation: '', location: '', date_joined: '',
};

export default function Employees() {
  const { user: me } = useAuth();
  const toast = useToast();
  const isAdmin = me.role === 'admin' || me.role === 'super_admin';
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [entity, setEntity] = useState('');
  const [form, setForm] = useState(null); // {id?} present = edit
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
        await api.patch(`/api/employees/${form.id}`, body);
        toast(`${form.name} updated.`);
      } else {
        await api.post('/api/employees', body);
        toast(`${form.name} added.`);
      }
      setForm(null);
      load();
    } catch (e2) { setErr(e2.message); }
  };

  const edit = (r) => setForm({
    id: r.id, zoho_emp_id: r.zoho_emp_id || '', name: r.name, email: r.email || '',
    entity: r.entity, division: r.division || '', department: r.department || '',
    designation: r.designation || '', location: r.location || '',
    date_joined: r.date_joined ? r.date_joined.slice(0, 10) : '',
  });

  return (
    <>
      <div className="page-head">
        <h2>Employees</h2>
        {isAdmin && <button className="btn gold" onClick={() => { setForm(EMPTY); setErr(null); }}>Add employee</button>}
      </div>
      <div className="toolbar">
        <input placeholder="Search name / e-mail / Zoho ID" value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()} style={{ minWidth: 240 }} />
        <select value={entity} onChange={(e) => setEntity(e.target.value)}>
          <option value="">All entities</option>
          {ENTITIES.map((x) => <option key={x}>{x}</option>)}
        </select>
        <button className="btn" onClick={load}>Search</button>
      </div>
      {form && (
        <form className="card" onSubmit={save}>
          <h3 style={{ fontSize: 15, marginBottom: 12 }}>{form.id ? 'Edit employee' : 'Add employee'}</h3>
          <div className="form-grid">
            <div><label>Name *</label><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><label>Entity *</label>
              <select value={form.entity} onChange={(e) => setForm({ ...form, entity: e.target.value })}>
                {ENTITIES.map((x) => <option key={x}>{x}</option>)}
              </select></div>
            <div><label>Zoho employee ID</label><input value={form.zoho_emp_id} onChange={(e) => setForm({ ...form, zoho_emp_id: e.target.value })} /></div>
            <div><label>E-mail</label><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div><label>Division</label><input value={form.division} onChange={(e) => setForm({ ...form, division: e.target.value })} /></div>
            <div><label>Department</label><input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} /></div>
            <div><label>Designation</label><input value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} /></div>
            <div><label>Location</label><input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></div>
            <div><label>Date joined</label><input type="date" value={form.date_joined} onChange={(e) => setForm({ ...form, date_joined: e.target.value })} /></div>
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
              <th>Name</th><th>Zoho ID</th><th>Entity</th><th>Division</th><th>Designation</th><th>Location</th><th>Status</th>{isAdmin && <th></th>}
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}<div className="muted" style={{ fontSize: 11 }}>{r.email}</div></td>
                  <td className="muted">{r.zoho_emp_id}</td>
                  <td>{r.entity}</td>
                  <td>{r.division}</td>
                  <td>{r.designation}</td>
                  <td>{r.location}</td>
                  <td><span className={'pill ' + (r.active ? 'good' : 'crit')}>{r.active ? 'Active' : 'Inactive'}</span></td>
                  {isAdmin && <td><button className="btn link" onClick={() => edit(r)}>Edit</button></td>}
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={8} className="muted">No employees yet — add the first one, or bulk import arrives with the next build.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
