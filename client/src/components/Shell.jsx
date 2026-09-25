import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../App.jsx';
import { ROLES } from '../api.js';

const link = ({ isActive }) => (isActive ? 'active' : undefined);

export default function Shell() {
  const { user, refresh } = useAuth();
  const isAdmin = user.role === 'admin' || user.role === 'super_admin';
  const previewing = user.real_role === 'super_admin' && user.role !== 'super_admin';

  const logout = async () => {
    await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
    refresh();
  };

  const viewAs = async (role) => {
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
        {user.real_role === 'super_admin' && (
          <select value={previewing ? user.role : ''} onChange={(e) => viewAs(e.target.value)}
            title="Preview the app exactly as another role sees it — server permissions follow."
            style={{ marginRight: 10, fontSize: 12 }}>
            <option value="">👁 View as: Super admin</option>
            <option value="admin">👁 View as: Admin</option>
            <option value="manager">👁 View as: Manager</option>
          </select>
        )}
        <div className="who"><b>{user.name}</b> · {ROLES[user.role]} · {user.entity}</div>
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
        <div className="sect">Programmes</div>
        <NavLink to="/mavericks" className={link}>Mavericks</NavLink>
        <NavLink to="/joiners" className={link}>New Joiners</NavLink>
        {isAdmin && (<>
          <div className="sect">Administration</div>
          <NavLink to="/users" className={link}>Users &amp; Access</NavLink>
          <NavLink to="/settings" className={link}>Settings</NavLink>
        </>)}
        <div className="sect">Phase 2 · Planned</div>
        <div className="locked">Nominations</div>
        <div className="locked">Effectiveness</div>
        <div className="locked">Assessments</div>
        <div className="locked">Certificates</div>
      </nav>
      <main className="main"><Outlet /></main>
    </div>
  );
}
