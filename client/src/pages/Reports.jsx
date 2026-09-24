import React, { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { api, fmtRange, inr, TRN_STATUSES } from '../api.js';
import { useAuth } from '../App.jsx';

const toXlsx = (name, header, rows, sheet = 'Data') => {
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  ws['!cols'] = header.map((h, i) => ({
    wch: Math.min(40, Math.max(String(h).length, ...rows.map((r) => String(r[i] ?? '').length), 8) + 2),
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheet);
  XLSX.writeFile(wb, name);
};

export default function Reports() {
  const { user: me } = useAuth();
  const isAdmin = me.role === 'admin' || me.role === 'super_admin';
  const [open, setOpen] = useState(null);   // {title, header, rows, note}
  const [emps, setEmps] = useState([]);
  const [empSel, setEmpSel] = useState('');
  const [err, setErr] = useState(null);

  useEffect(() => { api.get('/api/employees?active=true').then((r) => { setEmps(r); if (r[0]) setEmpSel(r[0].id); }).catch(() => {}); }, []);

  const show = (title, header, rows, note) => setOpen({ title, header, rows, note });

  const manhours = async () => {
    try {
      const r = await api.get('/api/reports/manhours');
      show('Training man-hours per employee',
        ['Employee', 'Entity', 'Division', 'Department', 'Hours'],
        r.map((x) => [x.name, x.entity, x.division || '', x.department || '', Number(x.hours)]),
        'Hours = training hours per day × attendance (P = full day, H = half). Target: 16 h per employee per year.');
    } catch (e) { setErr(e.message); }
  };

  const compliance = async () => {
    try {
      const r = await api.get('/api/reports/compliance');
      if (!r.trainings.length) return show('Mandatory training compliance', ['Info'], [['No mandatory trainings planned yet.']]);
      show('Mandatory training compliance',
        ['Employee', 'Entity', ...r.trainings.map((t) => t.title + (t.batch ? ' — ' + t.batch : ''))],
        r.employees.map((e) => [e.name, e.entity, ...e.status.map((s) => s === 'done' ? 'Done' : s === 'booked' ? 'Booked' : 'Due')]),
        '"Due" = active employee not enrolled on the mandatory training.');
    } catch (e) { setErr(e.message); }
  };

  const passport = async () => {
    try {
      const r = await api.get('/api/reports/passport/' + empSel);
      const emp = emps.find((e) => e.id === Number(empSel));
      show(`Training passport — ${emp?.name || ''}`,
        ['Code', 'Training', 'Dates', 'Status', 'Attendance %', 'Hours'],
        r.map((x) => [x.code, x.title + (x.batch ? ' — ' + x.batch : ''),
          x.first_day ? `${x.first_day.slice(0, 10)} → ${x.last_day.slice(0, 10)}` : '—',
          TRN_STATUSES[x.status], x.att_pct === null ? '—' : x.att_pct + '%', x.hours]),
        r.length ? `Total hours: ${r.reduce((a, x) => a + Number(x.hours), 0).toFixed(1)}` : 'No trainings on record for this employee yet.');
    } catch (e) { setErr(e.message); }
  };

  const expenseSummary = async () => {
    try {
      const r = await api.get('/api/expenses');
      show('Expense summary',
        ['Training', 'Category', 'Entities', 'Budget ₹', 'Actual ₹', 'Paid ₹', 'Pending ₹', 'Variance ₹', 'Approval'],
        r.map((x) => {
          const paid = (x.payments || []).reduce((a, p) => a + Number(p.amt), 0);
          return [x.training_label, x.category || '', (x.entity_split || []).map((s) => `${s.ent} ${s.n}`).join(' | '),
            inr(x.budget), inr(x.actual), inr(paid), inr(Number(x.actual) - paid), inr(Number(x.budget) - Number(x.actual)), x.approval];
        }),
        'Cost data is visible to admins only.');
    } catch (e) { setErr(e.message); }
  };

  const CARDS = [
    { name: 'Individual employee training hours (passport)', desc: 'Pick an employee — every training with attendance-weighted hours and the total.', run: passport, picker: true },
    { name: 'Training man-hours per employee', desc: 'Hours per person across all trainings, from real attendance.', run: manhours },
    { name: 'Mandatory training compliance', desc: 'Done / booked / due per active employee for every mandatory training.', run: compliance },
    ...(isAdmin ? [{ name: 'Expense summary', desc: 'Budget, actual, paid, pending, variance and entity split per record.', run: expenseSummary }] : []),
  ];
  const COMING = ['Feedback summary — training & trainer', 'Planned vs actual calendar adherence',
    'New joiner induction status', 'Overdue & expiring re-trainings', 'Audit-ready evidence pack'];

  return (
    <>
      <div className="page-head"><h2>Reports</h2></div>
      {err && <p className="err">{err}</p>}
      <div className="tiles" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))' }}>
        {CARDS.map((c) => (
          <div key={c.name} className="tile">
            <div style={{ fontWeight: 600, fontSize: 13.5 }}>{c.name} <span className="pill soft mini">live</span></div>
            <div className="sub" style={{ minHeight: 34 }}>{c.desc}</div>
            {c.picker && (
              <select style={{ width: '100%', margin: '8px 0' }} value={empSel} onChange={(e) => setEmpSel(e.target.value)}>
                {emps.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            )}
            <button className="btn gold" style={{ marginTop: 6 }} onClick={c.run}>Open</button>
          </div>
        ))}
        {COMING.map((n) => (
          <div key={n} className="tile" style={{ opacity: .6 }}>
            <div style={{ fontWeight: 600, fontSize: 13.5 }}>{n}</div>
            <div className="sub">Arrives with the coming builds.</div>
          </div>
        ))}
      </div>

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 860 }}>
            <h3>{open.title}</h3>
            <div style={{ overflowX: 'auto', marginTop: 10 }}>
              <table>
                <thead><tr>{open.header.map((h) => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>
                  {open.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}
                  {!open.rows.length && <tr><td colSpan={open.header.length} className="muted">No data yet.</td></tr>}
                </tbody>
              </table>
            </div>
            {open.note && <p className="muted mini" style={{ marginTop: 8 }}>{open.note}</p>}
            <div className="form-actions">
              <button className="btn gold" onClick={() => toXlsx(open.title.replace(/[^\w]+/g, '-') + '.xlsx', open.header, open.rows)}>⬇ Excel</button>
              <button className="btn" onClick={() => setOpen(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
