import React, { useEffect, useState } from 'react';
import { api, ENTITIES, ROLES, entLabel } from '../api.js';
import { useAuth, useToast } from '../App.jsx';

export default function Users() {
  const { user: me } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [editU, setEditU] = useState(null); // user being edited (super admin only)
  const [showDisabled, setShowDisabled] = useState(false);
  const [q, setQ] = useState('');
  const [err, setErr] = useState(null);

  const load = () => api.get('/api/users').then(setRows).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

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
      </div>
      <div className="toolbar">
        <input placeholder="Search name / e-mail / role…" value={q} onChange={(e) => setQ(e.target.value)}
          style={{ minWidth: 260 }} />
        <label className="muted mini" style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
          <input type="checkbox" checked={showDisabled} onChange={(e) => setShowDisabled(e.target.checked)} />
          Show disabled accounts ({rows.filter((u) => !u.active).length})
        </label>
        <span className="muted mini">
          Accounts sync from the Employees tab automatically — new employees become Learners;
          deactivating an employee disables their login. Promote managers/leaders via Edit.
        </span>
      </div>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr>
            <th>Name</th><th>Zoho e-mail</th><th>Role</th><th>Entity</th><th>Status</th><th>Last login</th><th></th>
          </tr></thead>
          <tbody>
            {rows.filter((u) => (showDisabled || u.active) &&
              (!q.trim() || [u.name, u.email, ROLES[u.role]].join(' ').toLowerCase().includes(q.trim().toLowerCase()))).map((u) => (
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
