import React, { useEffect, useState } from 'react';
import { api, ENTITY_NAMES } from '../api.js';

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    api.get('/api/dashboard').then(setData).catch((e) => setErr(e.message));
  }, []);

  if (err) return <p className="err">{err}</p>;
  if (!data) return <p className="muted">Loading…</p>;

  return (
    <>
      <div className="page-head"><h2>Dashboard</h2></div>
      <div className="tiles">
        <div className="tile">
          <div className="lbl">Employees</div>
          <div className="val">{data.employees.total}</div>
          <div className="sub">active across the Avana Group</div>
        </div>
        {Object.entries(data.employees.byEntity).map(([k, n]) => (
          <div className="tile" key={k}>
            <div className="lbl">{k}</div>
            <div className="val">{n}</div>
            <div className="sub">{ENTITY_NAMES[k]}</div>
          </div>
        ))}
        <div className="tile">
          <div className="lbl">Portal users</div>
          <div className="val">{data.activeUsers}</div>
          <div className="sub">with active access</div>
        </div>
      </div>
      <div className="card">
        <h3 style={{ fontSize: 15, marginBottom: 8 }}>Being rebuilt as a full application</h3>
        <p className="muted" style={{ margin: 0 }}>
          Training coverage, compliance, hours and budget tiles return as each
          module (Trainings, Attendance, Feedback, Expenses, Reports) moves from
          the prototype onto this platform with real, shared data.
        </p>
      </div>
    </>
  );
}
