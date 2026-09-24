import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../App.jsx';
import { ROLES } from '../api.js';

const link = ({ isActive }) => (isActive ? 'active' : undefined);

export default function Shell() {
  const { user, refresh } = useAuth();
  const isAdmin = user.role === 'admin' || user.role === 'super_admin';

  const logout = async () => {
    await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
    refresh();
  };

  return (
    <div className="shell">
      <div className="topbar">
        <div className="brand">Learning Hub<small>LEARNING &amp; DEVELOPMENT · AVANA GROUP</small></div>
        <div className="spacer" />
        <div className="who"><b>{user.name}</b> · {ROLES[user.role]} · {user.entity}</div>
        <button className="btn-ghost" onClick={logout}>Sign out</button>
      </div>
      <nav className="sidebar">
        <NavLink to="/" end className={link}>Dashboard</NavLink>
        <div className="sect">Phase 1</div>
        <NavLink to="/employees" className={link}>Employees</NavLink>
        <NavLink to="/trainings" className={link}>Trainings</NavLink>
        <NavLink to="/attendance" className={link}>Attendance</NavLink>
        <NavLink to="/feedback" className={link}>Feedback</NavLink>
        <NavLink to="/expenses" className={link}>Expenses</NavLink>
        <NavLink to="/reports" className={link}>Reports</NavLink>
        {isAdmin && (<>
          <div className="sect">Administration</div>
          <NavLink to="/users" className={link}>Users &amp; Access</NavLink>
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
