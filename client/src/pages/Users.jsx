import React, { useEffect, useState } from 'react';
import { api, ENTITIES, ROLES } from '../api.js';
import { useAuth, useToast } from '../App.jsx';

const EMPTY = { email: '', name: '', role: 'manager', entity: 'AMD' };

export default function Users() {
  const { user: me } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(null); // null = closed, EMPTY-shaped = add form
  const [err, setErr] = useState(null);

  const load = () => api.get('/api/users').then(setRows).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const save = async (e) => {
    e.preventDefault();
    setErr(null);
    try {
      await api.post('/api/users', form);
      toast(`${form.name} added — they can now sign in with Zoho (${form.email}).`);
      setForm(null);
      load();
    } catch (e2) { setErr(e2.message); }
  };

  const setActive = async (u, active) => {
    const reason = active ? undefined
      : (window.prompt(`Reason for disabling ${u.name}? (recorded in the audit trail)`) || undefined);
    if (!active && reason === undefined) return; // cancelled
    try {
      await api.patch(`/api/users/${u.id}`, { active, reason });
      toast(active ? `${u.name} re-enabled.` : `${u.name} disabled — their sessions are revoked immediately.`);
      load();
    } catch (e2) { toast(e2.message); }
  };

  if (!rows) return <p className="muted">{err || 'Loading…'}</p>;

  return (
    <>
      <div className="page-head">
        <h2>Users &amp; Access</h2>
        <button className="btn gold" onClick={() => setForm(EMPTY)}>Add user</button>
      </div>
      {form && (
        <form className="card" onSubmit={save}>
          <div className="form-grid">
            <div><label>Zoho e-mail ID</label>
              <input required type="email" value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="name@avanasurgical.com" /></div>
            <div><label>Name</label>
              <input required value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><label>Role</label>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {Object.entries(ROLES).map(([k, v]) =>
                  (k !== 'super_admin' || me.role === 'super_admin') && <option key={k} value={k}>{v}</option>)}
              </select></div>
            <div><label>Entity</label>
              <select value={form.entity} onChange={(e) => setForm({ ...form, entity: e.target.value })}>
                {ENTITIES.map((x) => <option key={x}>{x}</option>)}
              </select></div>
          </div>
          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
            The e-mail must be the address they use to sign in to Zoho (Zoho People for AMD/ATS, Zoho One for ASS).
          </p>
          {err && <p className="err">{err}</p>}
          <div className="form-actions">
            <button className="btn gold" type="submit">Save</button>
            <button className="btn" type="button" onClick={() => { setForm(null); setErr(null); }}>Cancel</button>
          </div>
        </form>
      )}
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr>
            <th>Name</th><th>Zoho e-mail</th><th>Role</th><th>Entity</th><th>Status</th><th>Last login</th><th></th>
          </tr></thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td>{u.name}{u.id === me.id && <span className="muted"> (you)</span>}</td>
                <td>{u.email}</td>
                <td>{ROLES[u.role]}</td>
                <td>{u.entity}</td>
                <td><span className={'pill ' + (u.active ? 'good' : 'crit')}>{u.active ? 'Active' : 'Disabled'}</span></td>
                <td className="muted">{u.last_login_at ? new Date(u.last_login_at).toLocaleDateString() : 'Never'}</td>
                <td>
                  {u.id !== me.id && (u.role !== 'super_admin' || me.role === 'super_admin') && (
                    u.active
                      ? <button className="btn link" onClick={() => setActive(u, false)}>Disable</button>
                      : <button className="btn link" onClick={() => setActive(u, true)}>Enable</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        Users are deactivated, never deleted (ISO 13485). Disabling revokes live sessions immediately;
        every change is recorded in the audit trail.
      </p>
    </>
  );
}
