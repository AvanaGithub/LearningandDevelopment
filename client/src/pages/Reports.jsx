import React, { useEffect, useRef, useState } from 'react';
import { api, fmtDate, fmtRange, inr, entLabel, TRN_STATUSES } from '../api.js';
import { useAuth, useToast } from '../App.jsx';
import { toXlsx, toWorkbook } from '../xlsx.js';
import MSel from '../components/MSel.jsx';

// Compliance status progression: Assigned -> Nominated -> Attended ->
// Completed. A nomination alone never counts as complete.
const CSTAT = {
  completed: ['🔵 Completed', 'good'],
  attended: ['🟢 Attended', 'good'],
  not_attended: ['🔴 Not Attended', 'crit'],
  pending: ['🟡 Pending', 'warn'],
};
const SRC = { self: 'Self', manager: 'Manager', leader: 'Leader', admin: 'Admin' };

// Searchable multi-select: type to filter, tick one or many, Open runs the
// report for the whole selection. Scales past 100 entries.
function Picker({ label, options, onPick }) {
  const [txt, setTxt] = useState('');
  const [openDD, setOpenDD] = useState(false);
  const [sel, setSel] = useState([]);           // array of option values
  const boxRef = useRef(null);
  useEffect(() => {
    const close = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpenDD(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  const t = txt.trim().toLowerCase();
  const filtered = (t ? options.filter((o) => o.t.toLowerCase().includes(t)) : options).slice(0, 40);
  const toggle = (v) => setSel((s) => (s.includes(v) ? s.filter((x) => x !== v) : [...s, v]));
  const chosen = options.filter((o) => sel.includes(o.v));
  const run = () => {
    const picks = chosen.length ? chosen : (filtered.length === 1 ? [filtered[0]] : []);
    if (picks.length) { onPick(picks); setOpenDD(false); }
  };
  return (
    <div ref={boxRef} style={{ margin: '8px 0', position: 'relative' }}>
      {chosen.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
          {chosen.map((o) => (
            <span key={o.v} className="pill soft mini" style={{ cursor: 'pointer' }} onClick={() => toggle(o.v)}
              title="Click to remove">{o.t} ✕</span>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <input placeholder={label} value={txt} style={{ flex: 1 }}
          onFocus={() => setOpenDD(true)}
          onChange={(e) => { setTxt(e.target.value); setOpenDD(true); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (filtered.length === 1) toggle(filtered[0].v); else run(); } }} />
        <button className="btn gold" disabled={!chosen.length && filtered.length !== 1} onClick={run}>
          Open{chosen.length > 1 ? ` (${chosen.length})` : ''}
        </button>
      </div>
      {openDD && (
        <div style={{ position: 'absolute', zIndex: 30, top: '100%', left: 0, right: 0, marginTop: 4,
          background: 'var(--card, #fff)', border: '1px solid var(--line)', borderRadius: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,.12)', maxHeight: 240, overflowY: 'auto', textAlign: 'left' }}>
          {filtered.map((o) => (
            <label key={o.v} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '7px 10px',
              cursor: 'pointer', fontSize: 13, borderBottom: '1px dashed var(--line)' }}>
              <input type="checkbox" checked={sel.includes(o.v)} onChange={() => toggle(o.v)} />
              <span>{o.t}</span>
            </label>
          ))}
          {!filtered.length && <div className="muted mini" style={{ padding: '8px 10px' }}>No match for “{txt}”.</div>}
          {options.length > 40 && filtered.length === 40 && (
            <div className="muted mini" style={{ padding: '6px 10px' }}>Showing the first 40 — keep typing to narrow down.</div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Reports() {
  const { user: me } = useAuth();
  const isAdmin = me.role === 'admin' || me.role === 'super_admin';
  const canExpense = isAdmin || me.role === 'leader';
  const toast = useToast();
  const [open, setOpen] = useState(null);   // {title, header, rows, note}
  const [emps, setEmps] = useState([]);
  const [trns, setTrns] = useState([]);
  const [comp, setComp] = useState(null);       // compliance dataset {trainings, rows}
  const [compView, setCompView] = useState(null); // summary | leader | pending | followup
  const [cf, setCf] = useState({ leader: [], mgr: [], dept: [], ent: [], loc: [], trn: [], status: [] });
  const [err, setErr] = useState(null);

  useEffect(() => {
    api.get('/api/employees?active=true').then(setEmps).catch(() => {});
    api.get('/api/trainings').then(setTrns).catch(() => {});
  }, []);

  const show = (title, header, rows, note) => setOpen({ title, header, rows, note });
  const guard = (fn) => (...a) => fn(...a).catch((e) => setErr(e.message));

  /* ---------- live reports ---------- */

  const passport = guard(async (picks) => {
    const results = await Promise.all(picks.map((emp) =>
      api.get('/api/reports/passport/' + emp.v).then((r) => ({ emp, r }))));
    const multi = picks.length > 1;
    const rows = results.flatMap(({ emp, r }) =>
      r.map((x) => [...(multi ? [emp.t] : []), x.code, x.title + (x.batch ? ' — ' + x.batch : ''),
        x.first_day ? `${x.first_day.slice(0, 10)} → ${x.last_day.slice(0, 10)}` : '—',
        TRN_STATUSES[x.status], x.att_pct === null ? '—' : x.att_pct + '%', x.hours]));
    const totals = results
      .map(({ emp, r }) => `${emp.t}: ${r.reduce((a, x) => a + Number(x.hours), 0).toFixed(1)} h`)
      .join(' · ');
    show(multi ? `Training passport — ${picks.length} employees` : `Training passport — ${picks[0].t}`,
      [...(multi ? ['Employee'] : []), 'Code', 'Training', 'Dates', 'Status', 'Attendance %', 'Hours'],
      rows,
      rows.length ? `Total training hours — ${totals}` : 'No trainings on record yet.');
  });

  const byTraining = guard(async (picks) => {
    if (picks.length === 1) {
      // Single training: full day-wise grid.
      const t = picks[0];
      const [detail, marks] = await Promise.all([
        api.get('/api/trainings/' + t.v), api.get('/api/attendance/' + t.v)]);
      const days = (detail.days || []).map((d) => d.slice(0, 10));
      const m = {};
      marks.forEach((r) => { m[r.employee_id + '|' + r.day.slice(0, 10)] = r.mark; });
      return show(`Training report — ${detail.code} ${detail.title}`,
        ['Participant', 'Zoho ID', 'Entity', ...days.map((d) => fmtDate(d)), 'Attendance %', 'Hours'],
        detail.participants.map((p) => {
          const ms = days.map((d) => m[p.id + '|' + d] || '–');
          const units = ms.reduce((s, x) => s + (x === 'P' ? 1 : x === 'H' ? 0.5 : 0), 0);
          const pct = days.length && ms.some((x) => x !== '–') ? Math.round(units / days.length * 100) + '%' : '—';
          return [p.name, p.zoho_emp_id || '', entLabel(p.entity), ...ms, pct, (units * Number(detail.hours_per_day)).toFixed(1)];
        }),
        `${TRN_STATUSES[detail.status]} · ${fmtRange(detail.days)} · trainer ${detail.trainer_type === 'external' ? detail.agency : detail.trainer_name}`);
    }
    // Several trainings: one combined summary (dates differ per training).
    const results = await Promise.all(picks.map((t) =>
      Promise.all([api.get('/api/trainings/' + t.v), api.get('/api/attendance/' + t.v)])));
    const rows = results.flatMap(([detail, marks]) => {
      const days = (detail.days || []).map((d) => d.slice(0, 10));
      const m = {};
      marks.forEach((r) => { m[r.employee_id + '|' + r.day.slice(0, 10)] = r.mark; });
      return detail.participants.map((p) => {
        const ms = days.map((d) => m[p.id + '|' + d] || '–');
        const units = ms.reduce((s, x) => s + (x === 'P' ? 1 : x === 'H' ? 0.5 : 0), 0);
        const pct = days.length && ms.some((x) => x !== '–') ? Math.round(units / days.length * 100) + '%' : '—';
        return [detail.code + ' ' + detail.title + (detail.batch ? ' — ' + detail.batch : ''),
          p.name, p.zoho_emp_id || '', entLabel(p.entity), `${units}/${days.length}`, pct,
          (units * Number(detail.hours_per_day)).toFixed(1)];
      });
    });
    show(`Training report — ${picks.length} trainings`,
      ['Training', 'Participant', 'Zoho ID', 'Entity', 'Days attended', 'Attendance %', 'Hours'],
      rows,
      'Combined summary — open a single training for its day-wise grid.');
  });

  const manhours = guard(async () => {
    const r = await api.get('/api/reports/manhours');
    show('Training man-hours per employee', ['Employee', 'Entity', 'Division', 'Department', 'Hours'],
      r.map((x) => [x.name, entLabel(x.entity), x.division || '', x.department || '', Number(x.hours)]),
      'Hours = hours per day × attendance (P = full, H = half). Target: 16 h per employee per year.');
  });

  const compliance = guard(async () => {
    const r = await api.get('/api/reports/compliance');
    if (!r.trainings.length) return show('Mandatory training compliance', ['Info'], [['No mandatory trainings planned yet.']]);
    show('Mandatory training compliance',
      ['Employee', 'Entity', ...r.trainings.map((t) => t.title + (t.batch ? ' — ' + t.batch : ''))],
      r.employees.map((e) => [e.name, entLabel(e.entity),
        ...e.status.map((s) => s === 'done' ? 'Done' : s === 'booked' ? 'Booked' : s === 'na' ? '—' : 'Due')]),
      'Batches with the same title count as one training (any batch covers the employee). "Due" = in-scope employee not enrolled; "—" = outside the training\'s department/division targeting.');
  });

  const feedbackSummary = guard(async () => {
    const r = await api.get('/api/reports/feedback-summary');
    const trainerAgg = {};
    r.forEach((x) => {
      const tr = x.trainer_type === 'external' ? (x.agency || x.trainer_name || '—') : (x.trainer_name || '—');
      trainerAgg[tr] = trainerAgg[tr] || { n: 0, sum: 0 };
      if (x.avg_score !== null) { trainerAgg[tr].n += x.responses; trainerAgg[tr].sum += Number(x.avg_score) * x.responses; }
    });
    show('Feedback summary — training & trainer',
      ['Training', 'Trainer', 'Responses', 'Participants', 'Avg score (1–5)', 'Trainer overall'],
      r.map((x) => {
        const tr = x.trainer_type === 'external' ? (x.agency || x.trainer_name || '—') : (x.trainer_name || '—');
        const a = trainerAgg[tr];
        return [x.code + ' ' + x.title + (x.batch ? ' — ' + x.batch : ''), tr,
          x.responses, x.participant_count, x.avg_score ?? '—',
          a.n ? (a.sum / a.n).toFixed(2) : '—'];
      }),
      'Trainer overall = response-weighted average across every training the trainer delivered.');
  });

  const adherence = guard(async () => {
    const rows = trns.filter((t) => (t.days || []).length);
    const byMonth = {};
    rows.forEach((t) => {
      const k = t.days[0].slice(0, 7);
      byMonth[k] = byMonth[k] || { planned: 0, completed: 0, postponed: 0, cancelled: 0, running: 0 };
      byMonth[k].planned++;
      if (t.status === 'completed') byMonth[k].completed++;
      else if (t.status === 'postponed') byMonth[k].postponed++;
      else if (t.status === 'cancelled') byMonth[k].cancelled++;
      else byMonth[k].running++;
    });
    show('Planned vs actual — calendar adherence',
      ['Month', 'Planned', 'Completed', 'Still running', 'Postponed', 'Cancelled', 'Adherence'],
      Object.keys(byMonth).sort().map((k) => {
        const m = byMonth[k];
        const decided = m.completed + m.postponed + m.cancelled;
        return [new Date(k + '-01').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }),
          m.planned, m.completed, m.running, m.postponed, m.cancelled,
          decided ? Math.round(m.completed / decided * 100) + '%' : '—'];
      }),
      'Adherence = completed ÷ (completed + postponed + cancelled) per calendar month of the first training day.');
  });

  const joiners = guard(async () => {
    const r = await api.get('/api/joiners?days=365');
    show('New joiner induction status',
      ['Joiner', 'Entity', 'Division', 'DOJ', 'Days in', 'Induction training', 'Attended', 'Status'],
      r.employees.map((e) => {
        const ind = e.induction[0];
        const done = e.induction.some((i) => i.status === 'completed' || (i.day_count > 0 && i.attended >= i.day_count));
        return [e.name, entLabel(e.entity), e.division || '', fmtDate(e.date_joined),
          Math.floor((Date.now() - new Date(e.date_joined)) / 86400000),
          ind ? ind.title + (ind.batch ? ' — ' + ind.batch : '') : 'Not enrolled',
          ind ? `${ind.attended}/${ind.day_count} days` : '—',
          done ? 'Completed' : ind ? 'In progress' : 'NOT ENROLLED'];
      }),
      'Everyone who joined in the last 12 months, against trainings in the Induction category.');
  });

  const overdue = guard(async () => {
    const rows = [];
    const today = new Date();
    trns.filter((t) => t.validity_months && t.status === 'completed' && (t.days || []).length).forEach((t) => {
      const last = new Date(t.days[t.days.length - 1]);
      const due = new Date(last);
      due.setMonth(due.getMonth() + Number(t.validity_months));
      const daysLeft = Math.floor((due - today) / 86400000);
      if (daysLeft <= 60) {
        rows.push([t.code, t.title + (t.batch ? ' — ' + t.batch : ''), fmtDate(last), t.validity_months + ' months',
          fmtDate(due), daysLeft < 0 ? `OVERDUE by ${-daysLeft} days` : `due in ${daysLeft} days`, t.participant_count + ' participants']);
      }
    });
    show('Overdue & expiring re-trainings',
      ['Code', 'Training', 'Last held', 'Validity', 'Re-training due', 'Status', 'Affected'],
      rows,
      rows.length ? 'Everything overdue or falling due within 60 days, from each completed training\'s validity period.'
        : 'Nothing is overdue or due within 60 days. Set "Re-training validity (months)" on trainings to drive this report.');
  });

  const openComp = guard(async (view) => {
    let d = comp;
    if (!d) { d = await api.get('/api/reports/compliance-detail'); setComp(d); }
    setCompView(view);
  });

  const expenseReport = guard(async () => {
    const r = await api.get('/api/expenses');
    show('Expense report',
      ['Training', 'Dates', 'Category', 'Type', 'Vendor', 'Budget (₹)', 'Actual (₹)', 'Paid (₹)', 'Pending (₹)', 'Variance (₹)', 'Approval', 'Payment status'],
      r.map((x) => {
        const paid = (x.payments || []).reduce((a, p) => a + Number(p.amt), 0);
        const status = x.payment_status || (paid >= Number(x.actual) ? 'paid' : paid > 0 ? 'partial' : 'unpaid');
        return [x.training_label, x.dates || '', x.category || '', x.training_type || '', x.vendor || '',
          Number(x.budget), Number(x.actual), paid, Number(x.actual) - paid, Number(x.budget) - Number(x.actual),
          x.approval, status];
      }),
      `Pending = actual − paid · Variance = budget − actual. Total actual: ₹${inr(r.reduce((a, x) => a + Number(x.actual), 0))}.`);
  });

  const evidencePack = guard(async () => {
    const d = await api.get('/api/reports/evidence');
    toWorkbook(`Audit-Evidence-Pack-${new Date().toISOString().slice(0, 10)}.xlsx`, [
      { sheet: 'Trainings', header: ['Code', 'Title', 'Batch', 'Category', 'Mode', 'Trainer type', 'Trainer', 'Agency', 'Hours per day', 'Seats', 'Mandatory', 'Status', 'Validity months', 'Days'],
        rows: d.trainings.map((t) => [t.code, t.title, t.batch || '', t.category || '', t.mode || '', t.trainer_type, t.trainer_name || '', t.agency || '', Number(t.hours_per_day), t.seats, t.mandatory ? 'Yes' : 'No', t.status, t.validity_months || '', t.days || '']) },
      { sheet: 'Participants', header: ['Training', 'Title', 'Employee', 'Zoho ID', 'Entity', 'Division', 'Department'],
        rows: d.participants.map((p) => [p.code, p.title, p.name, p.zoho_emp_id || '', entLabel(p.entity), p.division || '', p.department || '']) },
      { sheet: 'Attendance', header: ['Training', 'Employee', 'Day', 'Mark', 'Marked at', 'Marked by'],
        rows: d.attendance.map((a) => [a.code, a.name, a.day.slice(0, 10), a.mark, new Date(a.updated_at).toLocaleString('en-IN'), a.marked_by]) },
      { sheet: 'Feedback', header: ['Training', 'Respondent', 'Scores', 'Comment', 'Submitted at'],
        rows: d.feedback.map((f) => [f.code, f.respondent, Object.values(f.scores).join(', '), f.comment || '', new Date(f.created_at).toLocaleString('en-IN')]) },
      { sheet: 'Expenses', header: ['Training', 'Dates', 'Category', 'Type', 'Vendor', 'Budget', 'Actual', 'Approval', 'Remark'],
        rows: d.expenses.map((x) => [x.training_label, x.dates || '', x.category || '', x.training_type || '', x.vendor || '', Number(x.budget), Number(x.actual), x.approval, x.remark || '']) },
      { sheet: 'Audit trail', header: ['When', 'Who', 'Action', 'Record type', 'Record id', 'Reason'],
        rows: d.audit.map((a) => [new Date(a.created_at).toLocaleString('en-IN'), a.who, a.action, a.record_type, a.record_id || '', a.reason || '']) },
    ]);
  });

  const CARDS = [
    { name: 'Individual employee training hours (passport)', desc: 'Type to search, tick one or several employees — full history with attendance-weighted hours.', picker: { options: emps.map((e) => ({ v: e.id, t: e.name })), onPick: passport } },
    { name: 'Report by training', desc: 'Tick one training for its day-wise grid, or several for a combined summary.', picker: { options: trns.map((t) => ({ v: t.id, t: `${t.code} ${t.title}${t.batch ? ' — ' + t.batch : ''}` })), onPick: byTraining } },
    { name: 'Training man-hours per employee', desc: 'Hours per person across all trainings, from real attendance.', run: manhours },
    { name: 'Mandatory training compliance', desc: 'Done / booked / due per active employee.', run: compliance },
    { name: 'Feedback summary — training & trainer', desc: 'Average scores per training and per trainer, response-weighted.', run: feedbackSummary },
    { name: 'Planned vs actual — calendar adherence', desc: 'Per month: planned, completed, postponed, cancelled, adherence %.', run: adherence },
    { name: 'New joiner induction status', desc: 'Last 12 months of joiners against Induction trainings.', run: joiners },
    { name: 'Overdue & expiring re-trainings', desc: 'Validity-driven due list, 60-day horizon.', run: overdue },
    ...(isAdmin ? [
      { name: 'Compliance training report', desc: 'Every mandatory training: summary counts plus the employee-level status table.', run: () => openComp('summary') },
      { name: 'Leader-wise compliance', desc: 'Filter by leader, manager, department, entity, location, training and status — with totals.', run: () => openComp('leader') },
      { name: 'View pending employees', desc: 'Everyone assigned a mandatory training who has not completed it, exportable.', run: () => openComp('pending') },
      { name: 'Leader follow-up report', desc: 'Pending employees grouped by leader and manager, with an e-mail-ready summary per leader.', run: () => openComp('followup') },
    ] : []),
    ...(canExpense ? [{ name: 'Expense report', desc: 'Budget, actual, paid, pending and variance per training, with approval and payment status.', run: expenseReport }] : []),
    ...(isAdmin ? [{ name: 'Audit-ready evidence pack', desc: 'One Excel workbook: trainings, participants, attendance with timestamps, feedback, expenses and the audit trail.', run: evidencePack, download: true }] : []),
  ];

  return (
    <>
      <div className="page-head"><h2>Reports</h2></div>
      {err && <p className="err">{err}</p>}
      <div className="tiles" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))' }}>
        {CARDS.map((c) => (
          <div key={c.name} className="tile">
            <div style={{ fontWeight: 600, fontSize: 13.5 }}>{c.name} <span className="pill soft mini">live</span></div>
            <div className="sub" style={{ minHeight: 34 }}>{c.desc}</div>
            {c.picker
              ? <Picker label="Type to search…" options={c.picker.options} onPick={c.picker.onPick} />
              : <button className="btn gold" style={{ marginTop: 8 }} onClick={c.run}>{c.download ? '⬇ Download pack' : 'Open'}</button>}
          </div>
        ))}
      </div>

      {compView && comp && (() => {
        const uniq = (k) => [...new Set(comp.rows.map((r) => r[k]).filter(Boolean))].sort();
        const trnLabel = (t) => `${t.code} ${t.title}${t.batch ? ' — ' + t.batch : ''}`;
        const rowsFor = (view) => {
          if (view === 'leader') {
            return comp.rows.filter((r) =>
              (!cf.leader.length || cf.leader.includes(r.leader)) &&
              (!cf.mgr.length || cf.mgr.includes(r.manager)) &&
              (!cf.dept.length || cf.dept.includes(r.department)) &&
              (!cf.ent.length || cf.ent.includes(r.entity)) &&
              (!cf.loc.length || cf.loc.includes(r.location)) &&
              (!cf.trn.length || cf.trn.includes(r.training_id)) &&
              (!cf.status.length || cf.status.includes(r.status)));
          }
          if (view === 'pending' || view === 'followup') return comp.rows.filter((r) => r.status !== 'completed');
          return comp.rows;
        };
        const rows = rowsFor(compView);
        const attendedN = rows.filter((r) => r.status === 'attended' || r.status === 'completed').length;
        const statusCell = (s) => <span className={'pill mini ' + CSTAT[s][1]}>{CSTAT[s][0]}</span>;
        const exportPending = () => toXlsx('Pending-Compliance-Employees.xlsx',
          ['Employee Name', 'Employee ID', 'Department', 'Manager', 'Leader', 'Training', 'Training Date', 'Assigned Date', 'Selected Slot', 'Attendance Status', 'Completion Status'],
          rows.map((r) => [r.name, r.zoho_emp_id || '', r.department || '', r.manager || '', r.leader || '',
            trnLabel(r), r.training_date ? fmtDate(r.training_date) : '', r.assigned_at ? fmtDate(r.assigned_at) : '',
            r.slot || '', CSTAT[r.status][0].replace(/^\S+\s/, ''), r.status === 'completed' ? 'Completed' : 'Not completed']));
        const byLeader = {};
        rows.forEach((r) => { const k = r.leader || '(no leader on record)'; (byLeader[k] = byLeader[k] || []).push(r); });
        const emailFor = (leader, list) => {
          const lines = list.map((r) => `- ${r.name} (${r.manager || 'no manager on record'}) — ${trnLabel(r)} — ${CSTAT[r.status][0].replace(/^\S+\s/, '')}`);
          return `Subject: Follow-up needed — pending mandatory trainings\n\nDear ${leader},\n\nThe following team members have not yet completed their mandatory training:\n\n${lines.join('\n')}\n\nPlease ensure they attend before the completion deadline.\n\nRegards,\nL&D — Avana Learning Hub`;
        };
        return (
          <div className="modal-backdrop" onClick={() => setCompView(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 1040 }}>
              <h3>{{ summary: 'Compliance training report', leader: 'Leader-wise compliance',
                pending: 'Pending employees — mandatory trainings', followup: 'Leader follow-up report' }[compView]}</h3>
              <p className="muted mini">Status progression: Assigned → Nominated → Attended → Completed — a nomination alone never counts as complete.</p>

              {compView === 'summary' && (
                <>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ minWidth: 860 }}>
                      <thead><tr><th>Training</th><th>Date</th><th style={{ textAlign: 'right' }}>Assigned</th>
                        <th style={{ textAlign: 'right' }}>Nominated</th><th style={{ textAlign: 'right' }}>Attended</th>
                        <th style={{ textAlign: 'right' }}>Completed</th><th style={{ textAlign: 'right' }}>Not attended</th>
                        <th style={{ textAlign: 'right' }}>Pending</th><th style={{ textAlign: 'right' }}>Attendance %</th></tr></thead>
                      <tbody>
                        {comp.trainings.map((t) => {
                          const rs = comp.rows.filter((r) => r.training_id === t.id);
                          const n = (s) => rs.filter((r) => r.status === s).length;
                          const att = n('attended') + n('completed');
                          return (
                            <tr key={t.id}>
                              <td>{trnLabel(t)}</td>
                              <td className="muted">{rs[0]?.training_date ? fmtDate(rs[0].training_date) : '—'}</td>
                              <td style={{ textAlign: 'right' }}>{rs.length}</td>
                              <td style={{ textAlign: 'right' }}>{rs.filter((r) => r.source !== 'admin').length}</td>
                              <td style={{ textAlign: 'right' }}>{att}</td>
                              <td style={{ textAlign: 'right' }}>{n('completed')}</td>
                              <td style={{ textAlign: 'right' }}>{n('not_attended')}</td>
                              <td style={{ textAlign: 'right' }}>{n('pending')}</td>
                              <td style={{ textAlign: 'right' }}>{rs.length ? Math.round(att / rs.length * 100) + '%' : '—'}</td>
                            </tr>
                          );
                        })}
                        {!comp.trainings.length && <tr><td colSpan={9} className="muted">No mandatory trainings yet — tick "Mandatory" on a training.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                  <h3 style={{ fontSize: 14, margin: '14px 0 6px' }}>Employee level</h3>
                </>
              )}

              {compView === 'leader' && (
                <div className="toolbar" style={{ flexWrap: 'wrap' }}>
                  <MSel label="Leader" options={uniq('leader').map((v) => ({ v, t: v }))} sel={cf.leader} onChange={(v) => setCf({ ...cf, leader: v })} />
                  <MSel label="Manager" options={uniq('manager').map((v) => ({ v, t: v }))} sel={cf.mgr} onChange={(v) => setCf({ ...cf, mgr: v })} />
                  <MSel label="Department" options={uniq('department').map((v) => ({ v, t: v }))} sel={cf.dept} onChange={(v) => setCf({ ...cf, dept: v })} />
                  <MSel label="Entity" options={uniq('entity').map((v) => ({ v, t: entLabel(v) }))} sel={cf.ent} onChange={(v) => setCf({ ...cf, ent: v })} />
                  <MSel label="Location" options={uniq('location').map((v) => ({ v, t: v }))} sel={cf.loc} onChange={(v) => setCf({ ...cf, loc: v })} />
                  <MSel label="Training" options={comp.trainings.map((t) => ({ v: t.id, t: trnLabel(t) }))} sel={cf.trn} onChange={(v) => setCf({ ...cf, trn: v })} />
                  <MSel label="Status" options={Object.keys(CSTAT).map((s) => ({ v: s, t: CSTAT[s][0] }))} sel={cf.status} onChange={(v) => setCf({ ...cf, status: v })} />
                </div>
              )}

              {compView === 'followup' ? (
                <div style={{ maxHeight: 420, overflowY: 'auto' }}>
                  {Object.keys(byLeader).sort().map((leader) => (
                    <div key={leader} className="card" style={{ marginBottom: 10 }}>
                      <div className="toolbar" style={{ marginBottom: 6 }}>
                        <b>Leader: {leader}</b>
                        <span className="muted mini">{byLeader[leader].length} pending</span>
                        <span style={{ flex: 1 }} />
                        <button className="btn" onClick={() => {
                          navigator.clipboard.writeText(emailFor(leader, byLeader[leader]))
                            .then(() => toast('E-mail summary copied — paste it into Outlook.'));
                        }}>✉ Copy e-mail summary</button>
                      </div>
                      {byLeader[leader].map((r, i) => (
                        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, padding: '3px 0', borderBottom: '1px dashed var(--line)' }}>
                          <span style={{ flex: 1 }}>{r.name} <span className="muted mini">· {r.manager || '—'} · {trnLabel(r)}</span></span>
                          {statusCell(r.status)}
                        </div>
                      ))}
                    </div>
                  ))}
                  {!rows.length && <p className="muted">Nobody is pending — all mandatory trainings are completed. 🎉</p>}
                </div>
              ) : (
                <div style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto' }}>
                  <table style={{ minWidth: 980 }}>
                    <thead><tr><th>Employee</th><th>Employee ID</th><th>Department</th><th>Manager</th><th>Leader</th>
                      <th>Training</th><th>Slot</th><th>Nominated by</th><th>Attendance</th><th>Completion</th></tr></thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i}>
                          <td>{r.name}</td><td className="muted">{r.zoho_emp_id || '—'}</td>
                          <td>{r.department || '—'}</td><td>{r.manager || '—'}</td><td>{r.leader || '—'}</td>
                          <td>{trnLabel(r)}</td><td>{r.slot || '—'}</td>
                          <td>{SRC[r.source]}{r.nominated_by && r.source !== 'self' ? ` (${r.nominated_by})` : ''}</td>
                          <td>{statusCell(r.status === 'completed' ? 'attended' : r.status)}</td>
                          <td>{r.status === 'completed' ? statusCell('completed') : <span className="muted">—</span>}</td>
                        </tr>
                      ))}
                      {!rows.length && <tr><td colSpan={10} className="muted">Nothing in scope.</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}

              <p style={{ fontSize: 13, marginTop: 10 }}>
                <b>Total assigned: {rows.length}</b> · Attended: {attendedN} · Not attended: {rows.filter((r) => r.status === 'not_attended').length} ·
                Pending: {rows.filter((r) => r.status === 'pending').length} ·
                Completion: {rows.length ? Math.round(rows.filter((r) => r.status === 'completed').length / rows.length * 100) : 0}% ·
                Attendance: {rows.length ? Math.round(attendedN / rows.length * 100) : 0}%
              </p>
              <div className="form-actions">
                {compView === 'followup' ? (
                  <button className="btn gold" onClick={() => toXlsx('Leader-Followup-Report.xlsx',
                    ['Leader', 'Manager', 'Employee', 'Employee ID', 'Training', 'Training Date', 'Status'],
                    Object.keys(byLeader).sort().flatMap((leader) => byLeader[leader].map((r) =>
                      [leader, r.manager || '', r.name, r.zoho_emp_id || '', trnLabel(r),
                       r.training_date ? fmtDate(r.training_date) : '', CSTAT[r.status][0].replace(/^\S+\s/, '')])))}>⬇ Excel</button>
                ) : (
                  <button className="btn gold" onClick={exportPending}>⬇ Excel</button>
                )}
                <button className="btn" onClick={() => setCompView(null)}>Close</button>
              </div>
            </div>
          </div>
        );
      })()}

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 900 }}>
            <h3>{open.title}</h3>
            <div style={{ overflowX: 'auto', marginTop: 10 }}>
              <table>
                <thead><tr>{open.header.map((h) => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>
                  {open.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}
                  {!open.rows.length && <tr><td colSpan={open.header.length} className="muted">No data in scope yet.</td></tr>}
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
