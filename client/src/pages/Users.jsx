import React, { useEffect, useState } from 'react';
import { api, ENTITIES, ROLES, entLabel } from '../api.js';
import { useAuth, useToast } from '../App.jsx';

const EMPTY = { email: '', name: '', role: 'manager', entity: 'AMD' };

export default function Users() {
  const { user: me } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(null); // null = closed, EMPTY-shaped = add form
  const [editU, setEditU] = useState(null); // user being edited (super admin only)
  const [emps, setEmps] = useState([]);
  const [err, setErr] = useState(null);

  const load = () => api.get('/api/users').then(setRows).catch((e) => setErr(e.message));
  useEffect(() => { load(); api.get('/api/employees?active=true').then(setEmps).catch(() => {}); }, []);

  const pickEmployee = (id) => {
    const e = emps.find((x) => x.id === Number(id));
    if (e) setForm({ ...form, email: e.email || '', name: e.name, entity: e.entity, _emp: id });
    else setForm({ ...form, _emp: id });
  };

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

  const saveEdit = async (e) => {
    e.preventDefault();
    setErr(null);
    try {
      await api.patch('/api/users/' + editU.id, {
        name: editU.name.trim(), role: editU.role, entity: editU.entity,
        reason: editU.reason?.trim() || undefined,
      });
      toast(`${editU.name} updated — change recorded in the audit trail.`);
      setEditU(null); load();
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
        <div style={{ display: 'flex', gap: 8 }}>
          {me.role === 'super_admin' && (
            <button className="btn" onClick={async () => {
              if (!window.confirm('Add every active employee (with an e-mail) as a Learner user? Existing users are untouched — you can promote managers/leaders afterwards.')) return;
              try {
                const r = await api.post('/api/users/bulk-learners', {});
                toast(`${r.created} learner account(s) created${r.no_email ? ` · ${r.no_email} active employee(s) skipped (no e-mail on record)` : ''}.`);
                load();
              } catch (e2) { toast(e2.message); }
            }}>＋ All employees as learners</button>
          )}
          <button className="btn gold" onClick={() => setForm(EMPTY)}>Add user</button>
        </div>
      </div>
      {form && (
        <form className="card" onSubmit={save}>
          <div className="form-grid">
            <div style={{ gridColumn: '1/-1' }}><label>Pick from employees (auto-fills the details)</label>
              <select value={form._emp || ''} onChange={(e) => pickEmployee(e.target.value)}>
                <option value="">— type the details manually below —</option>
                {emps.filter((e) => e.email).map((e) => (
                  <option key={e.id} value={e.id}>{e.name} — {e.email} ({entLabel(e.entity)})</option>
                ))}
              </select></div>
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
                {ENTITIES.map((x) => <option key={x} value={x}>{entLabel(x)}</option>)}
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
                <td>{entLabel(u.entity)}</td>
                <td><span className={'pill ' + (u.active ? 'good' : 'crit')}>{u.active ? 'Active' : 'Disabled'}</span></td>
                <td className="muted">{u.last_login_at ? new Date(u.last_login_at).toLocaleDateString() : 'Never'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {me.role === 'super_admin' && (
                    <button className="btn link" onClick={() => { setErr(null); setEditU({ id: u.id, name: u.name, email: u.email, role: u.role, entity: u.entity, reason: '' }); }}>Edit</button>
                  )}
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

      {editU && (
        <div className="modal-backdrop" onClick={() => setEditU(null)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={saveEdit}>
            <h3>Edit user — {editU.email}</h3>
            <div className="form-grid">
              <div><label>Name</label>
                <input required value={editU.name} onChange={(e) => setEditU({ ...editU, name: e.target.value })} /></div>
              <div><label>Role</label>
                <select value={editU.role} disabled={editU.id === me.id}
                  onChange={(e) => setEditU({ ...editU, role: e.target.value })}>
                  {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                {editU.id === me.id && <div className="muted mini">You cannot change your own role.</div>}
              </div>
              <div><label>Entity</label>
                <select value={editU.entity} onChange={(e) => setEditU({ ...editU, entity: e.target.value })}>
                  {ENTITIES.map((x) => <option key={x} value={x}>{entLabel(x)}</option>)}
                </select></div>
              <div style={{ gridColumn: '1/-1' }}><label>Reason for the change (goes to the audit trail)</label>
                <input value={editU.reason} placeholder="e.g. promoted to leader"
                  onChange={(e) => setEditU({ ...editU, reason: e.target.value })} /></div>
            </div>
            <p className="muted mini" style={{ marginTop: 8 }}>
              The Zoho e-mail is the person's sign-in identity and cannot be edited — disable this user
              and add a new one if their e-mail changes. Role changes apply on their next page load.
            </p>
            {err && <p className="err">{err}</p>}
            <div className="form-actions">
              <button className="btn gold" type="submit">Save changes</button>
              <button className="btn" type="button" onClick={() => setEditU(null)}>Cancel</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
