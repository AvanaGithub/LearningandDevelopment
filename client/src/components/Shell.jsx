import React, { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../App.jsx';
import { api, ROLES, entLabel } from '../api.js';

const link = ({ isActive }) => (isActive ? 'active' : undefined);

export default function Shell() {
  const { user, refresh } = useAuth();
  const isAdmin = user.role === 'admin' || user.role === 'super_admin';
  const isLeader = user.role === 'leader';
  const previewing = user.real_role === 'super_admin' && user.role !== 'super_admin';

  // Managers/leaders get the New Joiners tab only while a reportee of
  // theirs is still in the training phase (the server filters to them).
  const [hasJoiners, setHasJoiners] = useState(isAdmin);
  useEffect(() => {
    if (isAdmin) { setHasJoiners(true); return; }
    setHasJoiners(false);
    api.get('/api/joiners?days=365')
      .then((d) => setHasJoiners(d.employees.length > 0))
      .catch(() => setHasJoiners(false));
  }, [user.role]);

  const logout = async () => {
    await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
    refresh();
  };

  // Learners (employees) have no portal login by design — their whole
  // experience is the Zoho-verified link/QR pages. "View as: Learner"
  // therefore opens a preview panel with direct links to those pages.
  const [learner, setLearner] = useState(null); // null | 'loading' | trainings[]

  const viewAs = async (role) => {
    if (role === 'learner') {
      setLearner('loading');
      api.get('/api/trainings').then((rows) => setLearner(rows.filter((t) => t.public_token && t.status !== 'cancelled')))
        .catch(() => setLearner([]));
      return;
    }
    await fetch('/auth/view-as', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: role || null }),
    });
    refresh();
  };

  return (
    <div className="shell">
      <div className="topbar">
        <div className="brand">Learning Hub<small>LEARNING &amp; DEVELOPMENT · AVANA GROUP</small></div>
        <div className="spacer" />
        {user.real_role === 'super_admin' && !previewing && (
          <select value="" onChange={(e) => viewAs(e.target.value)}
            title="Preview the app exactly as another role sees it — server permissions follow."
            style={{ marginRight: 10, fontSize: 12 }}>
            <option value="">👁 View as: Super admin</option>
            <option value="admin">👁 View as: Admin</option>
            <option value="leader">👁 View as: Leader</option>
            <option value="manager">👁 View as: Manager</option>
            <option value="learner">👁 View as: Learner (employee)</option>
          </select>
        )}
        <div className="who"><b>{user.name}</b> · {ROLES[user.role]} · {entLabel(user.entity)}</div>
        <button className="btn-ghost" onClick={logout}>Sign out</button>
      </div>
      {previewing && (
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 40,
          background: 'var(--gold, #c8930a)', color: '#fff', padding: '8px 16px',
          fontSize: 13, display: 'flex', alignItems: 'center', gap: 12,
          boxShadow: '0 -4px 12px rgba(0,0,0,.15)' }}>
          <span>👁 Previewing as <b>{ROLES[user.role]}</b> — your super admin rights are suspended until you exit
            (the server enforces this view too).</span>
          <button className="btn" style={{ marginLeft: 'auto', padding: '2px 10px' }}
            onClick={() => viewAs(null)}>Exit preview</button>
        </div>
      )}
      <nav className="sidebar">
        <NavLink to="/" end className={link}>Dashboard</NavLink>
        <NavLink to="/calendar" className={link}>Training Calendar</NavLink>
        <div className="sect">Phase 1</div>
        <NavLink to="/employees" className={link}>Employees</NavLink>
        <NavLink to="/trainings" className={link}>Trainings</NavLink>
        <NavLink to="/attendance" className={link}>Attendance</NavLink>
        <NavLink to="/feedback" className={link}>Feedback</NavLink>
        {isAdmin && <NavLink to="/expenses" className={link}>Expenses</NavLink>}
        <NavLink to="/reports" className={link}>Reports</NavLink>
        {(isAdmin || isLeader || hasJoiners) && <div className="sect">Programmes</div>}
        {(isAdmin || isLeader) && <NavLink to="/mavericks" className={link}>Mavericks</NavLink>}
        {hasJoiners && <NavLink to="/joiners" className={link}>New Joiners</NavLink>}
        {isAdmin && (<>
          <div className="sect">Administration</div>
          <NavLink to="/users" className={link}>Users &amp; Access</NavLink>
          <NavLink to="/settings" className={link}>Settings</NavLink>
        </>)}
        {isAdmin && (<>
          <div className="sect">Phase 2 · Planned</div>
          <div className="locked">Nominations</div>
          <div className="locked">Effectiveness</div>
          <div className="locked">Assessments</div>
          <div className="locked">Certificates</div>
        </>)}
      </nav>
      <main className="main"><Outlet /></main>

      {learner !== null && (
        <div className="modal-backdrop" onClick={() => setLearner(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
            <h3>Learner (employee) experience</h3>
            <p className="muted" style={{ fontSize: 13 }}>
              Learners never sign in to this portal — that is the security model. Each training has
              Zoho-verified pages where the employee proves who they are with their own Zoho account:
              <b> self-nomination</b>, <b>attendance check-in</b> and <b>feedback</b>. Open any page below
              to see and test exactly what an employee gets (you will be asked to sign in with Zoho,
              just like they are).
            </p>
            {learner === 'loading' ? <p className="muted">Loading trainings…</p> : (
              <div style={{ maxHeight: 340, overflowY: 'auto' }}>
                {learner.map((t) => (
                  <div key={t.id} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', padding: '7px 0', borderBottom: '1px dashed var(--line)', fontSize: 13 }}>
                    <span style={{ flex: 1, minWidth: 180 }}>{t.title}{t.batch ? ' — ' + t.batch : ''}</span>
                    {t.nom_self
                      ? <a className="btn" style={{ textDecoration: 'none' }} href={`/p/nom/${t.public_token}`} target="_blank" rel="noreferrer">Nominate</a>
                      : <span className="pill neutral mini" title="Self-nomination is not enabled on this training">no self-nom</span>}
                    <a className="btn" style={{ textDecoration: 'none' }} href={`/p/att/${t.public_token}`} target="_blank" rel="noreferrer">Check-in</a>
                    <a className="btn" style={{ textDecoration: 'none' }} href={`/p/fb/${t.public_token}`} target="_blank" rel="noreferrer">Feedback</a>
                  </div>
                ))}
                {!learner.length && <p className="muted">No trainings with learner pages yet.</p>}
              </div>
            )}
            <div className="form-actions">
              <button className="btn" onClick={() => setLearner(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
