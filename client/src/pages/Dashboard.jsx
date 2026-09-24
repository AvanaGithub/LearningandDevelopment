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
        <div className="tile">
          <div className="lbl">Trainings</div>
          <div className="val">{data.trainings?.total ?? 0}</div>
          <div className="sub">
            {data.trainings?.byStatus?.completed || 0} completed ·{' '}
            {(data.trainings?.byStatus?.planned || 0) + (data.trainings?.byStatus?.confirmed || 0) + (data.trainings?.byStatus?.in_progress || 0)} upcoming / running
          </div>
        </div>
      </div>
      <div className="card">
        <h3 style={{ fontSize: 15, marginBottom: 8 }}>Upcoming trainings</h3>
        {data.trainings?.upcoming?.length ? (
          <table>
            <tbody>
              {data.trainings.upcoming.map((t) => (
                <tr key={t.code}>
                  <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                    {new Date(t.first_day).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                  </td>
                  <td>{t.title}{t.batch ? ' — ' + t.batch : ''}</td>
                  <td><span className={'pill mini ' + (t.trainer_type === 'external' ? 'crit' : 'soft')}>{t.mode || (t.trainer_type === 'external' ? 'External' : 'Internal')}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            Nothing scheduled from today onwards — plan trainings under the Trainings tab and they appear here and on the Training Calendar.
          </p>
        )}
      </div>
    </>
  );
}
