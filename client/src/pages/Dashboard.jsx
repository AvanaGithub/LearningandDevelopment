import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ENTITIES, ENTITY_NAMES, DIVISIONS, DEPARTMENTS, fmtDay, inr } from '../api.js';
import { useAuth } from '../App.jsx';
import MSel from '../components/MSel.jsx';

export default function Dashboard() {
  const nav = useNavigate();
  const { user: me } = useAuth();
  const isAdmin = me.role === 'admin' || me.role === 'super_admin';
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [showF, setShowF] = useState(false);
  const [f, setF] = useState({ ent: [], emp: [], trn: [], div: [], dept: [], mgr: [], from: '', to: '' });

  useEffect(() => { api.get('/api/dashboard/full').then(setData).catch((e) => setErr(e.message)); }, []);

  const calc = useMemo(() => {
    if (!data) return null;
    const mgrOf = (e) => (e.manager || '').replace(/^Mentor: /, '');
    const emps = data.employees.filter((e) =>
      (!f.ent.length || f.ent.includes(e.entity)) &&
      (!f.emp.length || f.emp.includes(e.id)) &&
      (!f.div.length || f.div.includes(e.division)) &&
      (!f.dept.length || f.dept.includes(e.department)) &&
      (!f.mgr.length || f.mgr.includes(mgrOf(e))));
    const empIds = new Set(emps.map((e) => e.id));
    const trns = data.trainings.filter((t) => {
      if (f.trn.length && !f.trn.includes(t.id)) return false;
      if (f.from || f.to) {
        const d0 = (t.days || [])[0]?.slice(0, 10);
        if (!d0) return false;
        if (f.from && d0 < f.from) return false;
        if (f.to && d0 > f.to) return false;
      }
      return true;
    });
    const trnIds = new Set(trns.map((t) => t.id));
    const partOf = (t) => t.participant_ids || [];

    const trained = emps.filter((e) => trns.some((t) => partOf(t).includes(e.id)));
    const mand = trns.filter((t) => t.mandatory && !['postponed', 'cancelled'].includes(t.status));
    const gaps = mand.reduce((s, t) => s + emps.filter((e) => !partOf(t).includes(e.id)).length, 0);
    const compPct = mand.length && emps.length
      ? Math.round(mand.reduce((s, t) => s + Math.min(1, partOf(t).filter((id) => empIds.has(id)).length / emps.length), 0) / mand.length * 100)
      : 0;

    const attMap = {};
    data.attendance.forEach((a) => { attMap[a.training_id + ':' + a.employee_id] = a.units; });
    const hoursOf = (e) => trns.reduce((s, t) => {
      if (!partOf(t).includes(e.id)) return s;
      const units = attMap[t.id + ':' + e.id];
      const factor = units !== undefined ? units : (t.status === 'completed' ? (t.days || []).length : 0);
      return s + factor * Number(t.hours_per_day);
    }, 0);
    const avgHours = emps.length ? emps.reduce((s, e) => s + hoursOf(e), 0) / emps.length : 0;

    let spend = null, pendingExp = 0;
    if (data.expenses) {
      const scoped = (f.trn.length || f.from || f.to)
        ? data.expenses.filter((x) => x.training_id && trnIds.has(x.training_id))
        : data.expenses;
      spend = scoped.reduce((s, x) => {
        if (!f.ent.length) return s + Number(x.actual);
        const split = x.entity_split || [];
        const tot = split.reduce((a, y) => a + y.n, 0) || 1;
        return s + split.filter((y) => f.ent.includes(y.ent)).reduce((a, y) => a + Number(x.actual) * y.n / tot, 0);
      }, 0);
      pendingExp = scoped.filter((x) => x.approval === 'pending').length;
    }

    const today = new Date().toISOString().slice(0, 10);
    const upcoming = trns
      .filter((t) => ['planned', 'confirmed', 'in_progress'].includes(t.status) &&
        (t.days || []).some((d) => d.slice(0, 10) >= today))
      .sort((a, b) => (a.days[0] < b.days[0] ? -1 : 1)).slice(0, 5);
    const fbPending = trns.reduce((s, t) => s + Math.max(0, partOf(t).length - t.response_count), 0);
    const done = trns.filter((t) => t.status === 'completed').length;
    const running = trns.filter((t) => ['planned', 'confirmed', 'in_progress'].includes(t.status)).length;

    return { emps, trns, trained, gaps, compPct, avgHours, spend, pendingExp, upcoming, fbPending, done, running };
  }, [data, f]);

  if (err) return <p className="err">{err}</p>;
  if (!data || !calc) return <p className="muted">Loading…</p>;

  const nFilters = ['ent', 'emp', 'trn', 'div', 'dept', 'mgr'].filter((k) => f[k].length).length + (f.from ? 1 : 0) + (f.to ? 1 : 0);
  const mgrs = [...new Set(data.employees.map((e) => (e.manager || '').replace(/^Mentor: /, '')).filter(Boolean))].sort();

  return (
    <>
      <div className="page-head">
        <h2>Dashboard</h2>
        <button className="btn" onClick={() => setShowF(!showF)}>
          {showF ? '▲' : '▼'} Filters{nFilters ? ` · ${nFilters} active` : ''}
        </button>
      </div>
      {showF && (
        <div className="card">
          <div className="toolbar" style={{ marginBottom: 0 }}>
            <MSel label="Entities" options={ENTITIES.map((e) => ({ v: e, t: ENTITY_NAMES[e] }))} sel={f.ent} onChange={(v) => setF({ ...f, ent: v })} />
            <MSel label="Employees" options={data.employees.map((e) => ({ v: e.id, t: e.name }))} sel={f.emp} onChange={(v) => setF({ ...f, emp: v })} />
            <MSel label="Trainings" options={data.trainings.map((t) => ({ v: t.id, t: t.title + (t.batch ? ' — ' + t.batch : '') }))} sel={f.trn} onChange={(v) => setF({ ...f, trn: v })} />
            <MSel label="Divisions" options={[...new Set([...DIVISIONS, ...data.employees.map((e) => e.division).filter(Boolean)])].map((v) => ({ v, t: v }))} sel={f.div} onChange={(v) => setF({ ...f, div: v })} />
            <MSel label="Departments" options={[...new Set([...DEPARTMENTS, ...data.employees.map((e) => e.department).filter(Boolean)])].map((v) => ({ v, t: v }))} sel={f.dept} onChange={(v) => setF({ ...f, dept: v })} />
            <MSel label="Teams" options={mgrs.map((v) => ({ v, t: v }))} sel={f.mgr} onChange={(v) => setF({ ...f, mgr: v })} />
            <label className="muted mini">From <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
            <label className="muted mini">To <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
            <button className="btn" onClick={() => setF({ ent: [], emp: [], trn: [], div: [], dept: [], mgr: [], from: '', to: '' })}>✕ Clear all</button>
          </div>
          <p className="muted mini" style={{ margin: '8px 0 0' }}>Tick any combination — every tile below recomputes for the selection.</p>
        </div>
      )}

      <div className="tiles">
        <div className="tile">
          <div className="lbl">Training coverage</div>
          <div className="val">{calc.emps.length ? Math.round(calc.trained.length / calc.emps.length * 100) : 0}%</div>
          <div className="sub">{calc.trained.length} of {calc.emps.length} employee(s) on ≥1 training in scope</div>
        </div>
        <div className="tile">
          <div className="lbl">Mandatory compliance</div>
          <div className="val">{calc.compPct}%</div>
          <div className="sub">{calc.gaps} enrolment(s) still missing</div>
        </div>
        <div className="tile">
          <div className="lbl">Avg hours / employee</div>
          <div className="val">{calc.avgHours.toFixed(1)}</div>
          <div className="sub">attendance-weighted · target 16 h/yr</div>
        </div>
        {isAdmin && calc.spend !== null && (
          <div className="tile">
            <div className="lbl">Actual spend</div>
            <div className="val">₹{inr(calc.spend)}</div>
            <div className="sub">{calc.pendingExp} cost sheet(s) awaiting approval</div>
          </div>
        )}
        <div className="tile">
          <div className="lbl">Trainings</div>
          <div className="val">{calc.trns.length}</div>
          <div className="sub">{calc.done} completed · {calc.running} upcoming / running</div>
        </div>
        <div className="tile">
          <div className="lbl">Feedback pending</div>
          <div className="val">{calc.fbPending}</div>
          <div className="sub">responses still expected</div>
        </div>
      </div>

      <div className="card">
        <h3 style={{ fontSize: 15, marginBottom: 8 }}>Upcoming trainings</h3>
        {calc.upcoming.length ? (
          <table><tbody>
            {calc.upcoming.map((t) => (
              <tr key={t.id} className="rowlink" onClick={() => nav('/trainings?open=' + t.id)}>
                <td className="muted" style={{ whiteSpace: 'nowrap' }}>{fmtDay(t.days[0])}</td>
                <td>{t.title}{t.batch ? ' — ' + t.batch : ''}</td>
                <td><span className={'pill mini ' + (t.trainer_type === 'external' ? 'crit' : 'soft')}>{t.mode || t.trainer_type}</span></td>
              </tr>
            ))}
          </tbody></table>
        ) : <p className="muted" style={{ margin: 0 }}>Nothing scheduled in scope — plan trainings under the Trainings tab.</p>}
      </div>
    </>
  );
}
