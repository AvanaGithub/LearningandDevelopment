import React, { useEffect, useMemo, useState } from 'react';
import { api, fmtDate } from '../api.js';
import { useToast } from '../App.jsx';
import { toXlsx, toCsv, toWorkbook } from '../xlsx.js';
import OdEventForm from '../components/OdEventForm.jsx';
import { summarize, byCategory, byLocation, n, rs } from '../odcalc.js';

const APR = {
  pending: ['Pending approval', 'warn'], approved: ['Approved', 'good'],
  rejected: ['Rejected', 'crit'], clarify: ['Clarification requested', 'warn'],
};
const dateRange = (ev) => (ev.event_date
  ? fmtDate(ev.event_date) + (ev.end_date && String(ev.end_date).slice(0, 10) !== String(ev.event_date).slice(0, 10) ? ' → ' + fmtDate(ev.end_date) : '')
  : '—');
const iso = (d) => (d ? String(d).slice(0, 10) : '');
const signed = (v) => (v === null ? '' : v);

// Organization Development: confidential event & expense tracker for
// authorised OD users, Vivek and Sundar.
export default function OrgDev() {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [cats, setCats] = useState({ expense: [], event: [] });
  const [knownLocs, setKnownLocs] = useState([]);
  const [tab, setTab] = useState('events');
  const [open, setOpen] = useState(null);      // event in the editor (or {} for new)
  const [catEdit, setCatEdit] = useState(null);
  const [flt, setFlt] = useState({ from: '', to: '', category: '', type: '' });
  const [err, setErr] = useState(null);

  const load = () => Promise.all([api.get('/api/od'), api.get('/api/od/categories'), api.get('/api/od/headcount')])
    .then(([r, c, h]) => { setRows(r); setCats(c); setKnownLocs(h); })
    .catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const remove = async (ev) => {
    const reason = prompt(`Remove "${ev.name}" from the list? It is deactivated (kept for audit), not deleted.\nReason:`);
    if (!reason?.trim()) return;
    try {
      await api.patch('/api/od/' + ev.id, { active: false, reason: reason.trim() });
      toast('Event removed — kept in the audit trail.');
      load();
    } catch (e2) { setErr(e2.message); }
  };

  // Report filters apply to the reports tab (the events list shows all).
  const filtered = useMemo(() => (rows || []).filter((ev) =>
    (!flt.from || (iso(ev.end_date || ev.event_date) || '9999') >= flt.from) &&
    (!flt.to || (iso(ev.event_date) || '0000') <= flt.to) &&
    (!flt.category || ev.category === flt.category) &&
    (!flt.type || ev.expense_type === flt.type)), [rows, flt]);
  const sums = useMemo(() => (rows || []).map((ev) => ({ ev, s: summarize(ev) })), [rows]);
  const fsums = useMemo(() => filtered.map((ev) => ({ ev, s: summarize(ev) })), [filtered]);
  const tot = (list) => list.reduce((a, { s }) => ({
    est: a.est + s.estimated, approved: a.approved + (s.approved || 0), spent: a.spent + s.spent,
    company: a.company + s.companySpent, paid: a.paid + s.paid, pending: a.pending + s.pending,
  }), { est: 0, approved: 0, spent: 0, company: 0, paid: 0, pending: 0 });

  // ---- report tables (shared by screen + Excel/CSV) ----
  const eventHeader = ['Event', 'Category', 'Expense type', 'From', 'To', 'Locations', 'Total headcount', 'Participants',
    'Estimated', 'Requested', 'Approved', 'Spent', 'Company-wide spend', 'Remaining', 'Variance (spent − budget)',
    'Paid', 'Pending payment', 'Cost per person', 'Approval'];
  const eventRows = (list) => list.map(({ ev, s }) => [
    ev.name, ev.category || '', ev.expense_type === 'company' ? 'Company-wide' : 'Location-wise',
    iso(ev.event_date), iso(ev.end_date), (ev.locations || []).map((l) => l.location).join(', '),
    n(ev.employee_count), ev.participants ?? '', s.estimated, s.requested ?? '', s.approved ?? '', s.spent,
    s.companySpent, signed(s.remaining), signed(s.variance), s.paid, s.pending,
    s.perHead === null ? '' : Math.round(s.perHead), ev.apr_status ? (APR[ev.apr_status] || [ev.apr_status])[0] : '']);
  const locRep = byLocation(filtered);
  const locHeader = ['Location', 'Events', 'Headcount (sum)', 'Estimated', 'Approved', 'Spent at location', 'Company-wide allocated', 'Total spend', 'Paid'];
  const locRows = [
    ...locRep.rows.map((l) => [l.location, l.events, l.headcount, l.est, l.approved, l.direct, l.allocated, l.total, l.paid]),
    ...(locRep.unallocated ? [['Company-wide (not allocated)', '', '', '', '', '', '', locRep.unallocated, '']] : []),
  ];
  const catRep = byCategory(filtered);
  const catHeader = ['Category', 'Lines', 'Estimated', 'Approved', 'Actual', 'of which company-wide', 'Share of spend'];
  const totalSpent = tot(fsums).spent;
  const catRows = catRep.map((c) => [c.category, c.lines, c.est, c.approved, c.actual, c.company,
    totalSpent ? Math.round((c.actual / totalSpent) * 1000) / 10 + '%' : '']);
  const cwHeader = ['Event', 'Category', 'Description', 'Qty', 'Estimated', 'Approved', 'Actual', 'Allocated to locations', 'Remarks'];
  const cwRows = filtered.flatMap((ev) => (ev.items || []).filter((i) => !i.location).map((i) => [
    ev.name, i.category || '', i.description || '', i.quantity ?? '', n(i.est_amount), n(i.approved_amount), n(i.actual_amount),
    (i.allocations || []).map((a) => `${a.location} ${a.amount}`).join('; '), i.remarks || '']));
  const stamp = new Date().toISOString().slice(0, 10);
  const exportBtns = (base, header, data) => (
    <span style={{ display: 'inline-flex', gap: 6 }}>
      <button className="btn" onClick={() => toXlsx(`${base}-${stamp}.xlsx`, header, data, base.slice(0, 31))}>⬇ Excel</button>
      <button className="btn" onClick={() => toCsv(`${base}-${stamp}.csv`, header, data)}>⬇ CSV</button>
    </span>
  );
  const exportAll = () => {
    const lineRows = filtered.flatMap((ev) => (ev.items || []).map((i) => [
      ev.name, i.category || '', i.description || '', i.quantity ?? '', n(i.est_amount), n(i.approved_amount), n(i.actual_amount),
      i.location || 'Company-wide', (i.allocations || []).map((a) => `${a.location} ${a.amount}`).join('; '), i.remarks || '',
      (i.files || []).map((d) => d.name).join('; ')]));
    const payRows = filtered.flatMap((ev) => (ev.payments || []).map((p) => [ev.name, p.date || '', n(p.amt), p.location || 'Company-wide', p.reference || '', p.note || '']));
    toWorkbook(`OD-expenses-${stamp}.xlsx`, [
      { sheet: 'Events', header: eventHeader, rows: eventRows(fsums) },
      { sheet: 'Locations', header: locHeader, rows: locRows },
      { sheet: 'Categories', header: catHeader, rows: catRows },
      { sheet: 'Expense lines', header: ['Event', 'Category', 'Description', 'Qty', 'Estimated', 'Approved', 'Actual', 'Location', 'Allocations', 'Remarks', 'Documents'], rows: lineRows },
      { sheet: 'Payments', header: ['Event', 'Date', 'Amount', 'Location', 'Reference', 'Note'], rows: payRows },
      { sheet: 'Company-wide', header: cwHeader, rows: cwRows },
    ]);
  };

  const all = tot(sums);
  const ft = tot(fsums);
  const tdR = { textAlign: 'right', whiteSpace: 'nowrap' };
  const varCell = (v) => (v === null ? <span className="muted">—</span>
    : <span style={{ color: v > 0 ? 'var(--crit)' : v < 0 ? 'var(--good)' : 'inherit' }}>{v > 0 ? '+' : v < 0 ? '−' : ''}{rs(Math.abs(v))}</span>);
  const maxBar = Math.max(1, ...fsums.map(({ s }) => Math.max(s.basis || 0, s.spent)));

  return (
    <div>
      <div className="page-head">
        <h2>Organization Development</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className={'btn' + (tab === 'events' ? ' gold' : '')} onClick={() => setTab('events')}>Events</button>
          <button className={'btn' + (tab === 'reports' ? ' gold' : '')} onClick={() => setTab('reports')}>Reports</button>
          <button className="btn" onClick={() => setCatEdit({ expense: cats.expense.join('\n'), event: cats.event.join('\n') })}>Categories</button>
          <button className="btn gold" onClick={() => setOpen({})}>+ New event</button>
        </div>
      </div>
      <p className="muted mini">
        Confidential — visible only to authorised OD users, the budget approvers and the super admin.
        Spent is always the total of each event's expense lines; company-wide purchases can be allocated
        across locations without being counted twice.
      </p>
      {err && <p className="err" onClick={() => setErr(null)}>{err}</p>}

      {!rows ? <p className="muted">Loading…</p> : tab === 'events' ? (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table style={{ minWidth: 1100 }}>
            <thead><tr><th>Event</th><th>Dates</th><th>Locations</th><th style={tdR}>Headcount</th>
              <th style={tdR}>Approved</th><th style={tdR}>Spent</th><th style={tdR}>Remaining</th><th style={tdR}>Variance</th>
              <th style={tdR}>Paid / pending</th><th>Approval</th><th /></tr></thead>
            <tbody>
              {sums.map(({ ev, s }) => (
                <tr key={ev.id}>
                  <td>
                    <button className="btn link" style={{ fontWeight: 700, padding: 0, textAlign: 'left' }} onClick={() => setOpen(ev)}>{ev.name}</button>
                    <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
                      {ev.category && <span className="pill soft mini">{ev.category}</span>}
                      {ev.expense_type === 'company' && <span className="pill neutral mini">Company-wide</span>}
                    </div>
                  </td>
                  <td className="muted mini">{dateRange(ev)}</td>
                  <td className="mini">{(ev.locations || []).length
                    ? (ev.locations.length > 3 ? `${ev.locations.length} locations` : ev.locations.map((l) => l.location).join(', '))
                    : <span className="muted">{ev.expense_type === 'company' ? 'Company-wide' : '—'}</span>}</td>
                  <td style={tdR}>{ev.participants ? `${ev.participants} / ` : ''}{n(ev.employee_count) || '—'}</td>
                  <td style={tdR}>{s.approved !== null ? rs(s.approved) : <span className="muted" title="No approved budget yet — estimate shown">{rs(s.estimated)} est.</span>}</td>
                  <td style={tdR}>{rs(s.spent)}</td>
                  <td style={{ ...tdR, color: s.remaining !== null && s.remaining < 0 ? 'var(--crit)' : 'inherit' }}>{s.remaining !== null ? rs(s.remaining) : '—'}</td>
                  <td style={tdR}>{varCell(s.variance)}</td>
                  <td style={tdR}>{rs(s.paid)}<div className="muted mini">{s.overpaid ? <span style={{ color: 'var(--crit)' }}>paid {rs(s.overpaid)} over spend</span> : `${rs(s.pending)} pending`}</div></td>
                  <td>{ev.apr_status
                    ? <span className={'pill mini ' + (APR[ev.apr_status] || ['', 'soft'])[1]} title={ev.apr_comment ? `${ev.apr_approver || ''}: ${ev.apr_comment}` : ev.apr_approver || ''}>
                        {(APR[ev.apr_status] || [ev.apr_status])[0]}</span>
                    : <span className="muted mini">not requested</span>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn link" onClick={() => setOpen(ev)}>Open</button>{' '}
                    <button className="btn link" onClick={() => remove(ev)}>✕</button>
                  </td>
                </tr>
              ))}
              {sums.length > 0 && (
                <tr style={{ fontWeight: 700, borderTop: '2px solid var(--line)' }}>
                  <td colSpan={4}>All events ({sums.length})</td>
                  <td style={tdR}>{rs(all.approved)}</td><td style={tdR}>{rs(all.spent)}</td>
                  <td colSpan={2} className="muted mini" style={{ fontWeight: 400 }}>{rs(all.company)} company-wide</td>
                  <td style={tdR}>{rs(all.paid)}<div className="muted mini">{rs(all.pending)} pending</div></td><td colSpan={2} />
                </tr>
              )}
              {!sums.length && <tr><td colSpan={11} className="muted">No OD events yet — add the first one.</td></tr>}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="card" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label className="muted mini">From<br /><input type="date" value={flt.from} onChange={(e) => setFlt({ ...flt, from: e.target.value })} /></label>
            <label className="muted mini">To<br /><input type="date" value={flt.to} onChange={(e) => setFlt({ ...flt, to: e.target.value })} /></label>
            <label className="muted mini">Event category<br />
              <select value={flt.category} onChange={(e) => setFlt({ ...flt, category: e.target.value })}>
                <option value="">All</option>{cats.event.map((c) => <option key={c}>{c}</option>)}
              </select></label>
            <label className="muted mini">Expense type<br />
              <select value={flt.type} onChange={(e) => setFlt({ ...flt, type: e.target.value })}>
                <option value="">All</option><option value="location">Location-wise</option><option value="company">Company-wide</option>
              </select></label>
            <span style={{ flex: 1 }} />
            <button className="btn gold" onClick={exportAll}>⬇ Full workbook (all reports)</button>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '10px 0' }}>
            {[['Events', filtered.length, false], ['Estimated', ft.est], ['Approved', ft.approved], ['Spent', ft.spent],
              ['Company-wide spend', ft.company], ['Paid', ft.paid], ['Pending payment', ft.pending]].map(([k, val, money = true]) => (
              <div key={k} className="card" style={{ flex: '1 1 130px', margin: 0, padding: '10px 14px' }}>
                <div className="muted mini" style={{ textTransform: 'uppercase' }}>{k}</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{money ? rs(val) : val}</div>
              </div>
            ))}
          </div>

          <div className="card" style={{ overflowX: 'auto' }}>
            <div className="toolbar"><h3 style={{ fontSize: 14, margin: 0, flex: 1 }}>Event-wise expenses · budget vs actual</h3>{exportBtns('OD-events', eventHeader, eventRows(fsums))}</div>
            <table style={{ minWidth: 980 }}>
              <thead><tr><th>Event</th><th>Category</th><th style={tdR}>Estimated</th><th style={tdR}>Approved</th><th style={tdR}>Spent</th>
                <th style={tdR}>Variance</th><th style={{ width: 220 }}>Budget vs actual</th><th style={tdR}>Paid</th><th style={tdR}>Pending</th></tr></thead>
              <tbody>
                {fsums.map(({ ev, s }) => (
                  <tr key={ev.id} style={{ cursor: 'pointer' }} onClick={() => setOpen(ev)} title="Open the full breakdown">
                    <td><b>{ev.name}</b><div className="muted mini">{dateRange(ev)}</div></td>
                    <td className="mini">{ev.category || '—'}</td>
                    <td style={tdR}>{rs(s.estimated)}</td><td style={tdR}>{s.approved !== null ? rs(s.approved) : '—'}</td>
                    <td style={tdR}>{rs(s.spent)}</td><td style={tdR}>{varCell(s.variance)}</td>
                    <td>
                      <div title={`${s.basisLabel} ${rs(s.basis || 0)}`} style={{ height: 7, background: 'var(--line)', borderRadius: 4, width: `${((s.basis || 0) / maxBar) * 100}%`, minWidth: 2 }} />
                      <div title={`spent ${rs(s.spent)}`} style={{ height: 7, marginTop: 3, borderRadius: 4, minWidth: 2,
                        background: s.variance > 0 ? 'var(--crit)' : 'var(--good)', width: `${(s.spent / maxBar) * 100}%` }} />
                    </td>
                    <td style={tdR}>{rs(s.paid)}</td><td style={tdR}>{rs(s.pending)}</td>
                  </tr>
                ))}
                {!fsums.length && <tr><td colSpan={9} className="muted">No events match the filters.</td></tr>}
              </tbody>
            </table>
            <p className="muted mini">Grey bar = budget (approved, or the estimate until approved) · coloured bar = spent (red when over budget). Click an event for its complete breakdown.</p>
          </div>

          <div className="card" style={{ overflowX: 'auto' }}>
            <div className="toolbar"><h3 style={{ fontSize: 14, margin: 0, flex: 1 }}>Location-wise expenses</h3>{exportBtns('OD-locations', locHeader, locRows)}</div>
            <table>
              <thead><tr>{locHeader.map((h, i) => <th key={h} style={i ? tdR : {}}>{h}</th>)}</tr></thead>
              <tbody>
                {locRep.rows.map((l) => (
                  <tr key={l.location}><td><b>{l.location}</b></td><td style={tdR}>{l.events}</td><td style={tdR}>{l.headcount || '—'}</td>
                    <td style={tdR}>{rs(l.est)}</td><td style={tdR}>{rs(l.approved)}</td><td style={tdR}>{rs(l.direct)}</td>
                    <td style={tdR}>{l.allocated ? rs(l.allocated) : '—'}</td><td style={{ ...tdR, fontWeight: 700 }}>{rs(l.total)}</td><td style={tdR}>{rs(l.paid)}</td></tr>
                ))}
                {locRep.unallocated > 0 && (
                  <tr><td className="muted">Company-wide (not allocated)</td><td colSpan={6} /><td style={{ ...tdR, fontWeight: 700 }}>{rs(locRep.unallocated)}</td><td /></tr>
                )}
                <tr style={{ fontWeight: 700, borderTop: '2px solid var(--line)' }}>
                  <td>Total</td><td colSpan={6} className="muted mini" style={{ fontWeight: 400 }}>equals total spent — allocations are not counted twice</td>
                  <td style={tdR}>{rs(locRep.rows.reduce((a, l) => a + l.total, 0) + locRep.unallocated)}</td><td />
                </tr>
              </tbody>
            </table>
          </div>

          <div className="card" style={{ overflowX: 'auto' }}>
            <div className="toolbar"><h3 style={{ fontSize: 14, margin: 0, flex: 1 }}>Category-wise expenses</h3>{exportBtns('OD-categories', catHeader, catRows)}</div>
            <table>
              <thead><tr>{catHeader.map((h, i) => <th key={h} style={i ? tdR : {}}>{h}</th>)}</tr></thead>
              <tbody>
                {catRows.map((r) => (
                  <tr key={r[0]}><td><b>{r[0]}</b></td><td style={tdR}>{r[1]}</td><td style={tdR}>{rs(r[2])}</td><td style={tdR}>{rs(r[3])}</td>
                    <td style={{ ...tdR, fontWeight: 700 }}>{rs(r[4])}</td><td style={tdR}>{r[5] ? rs(r[5]) : '—'}</td><td style={tdR}>{r[6]}</td></tr>
                ))}
                {!catRows.length && <tr><td colSpan={7} className="muted">No expense lines yet.</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="card" style={{ overflowX: 'auto' }}>
            <div className="toolbar"><h3 style={{ fontSize: 14, margin: 0, flex: 1 }}>Company-wide expenditure — {rs(ft.company)}</h3>{exportBtns('OD-company-wide', cwHeader, cwRows)}</div>
            <table>
              <thead><tr>{cwHeader.map((h, i) => <th key={h} style={i >= 3 && i <= 6 ? tdR : {}}>{h}</th>)}</tr></thead>
              <tbody>
                {cwRows.map((r, i) => (
                  <tr key={i}><td>{r[0]}</td><td className="mini">{r[1]}</td><td>{r[2]}</td><td style={tdR}>{r[3]}</td>
                    <td style={tdR}>{rs(r[4])}</td><td style={tdR}>{rs(r[5])}</td><td style={{ ...tdR, fontWeight: 700 }}>{rs(r[6])}</td>
                    <td className="mini">{r[7] || <span className="muted">not allocated</span>}</td><td className="mini">{r[8]}</td></tr>
                ))}
                {!cwRows.length && <tr><td colSpan={9} className="muted">No company-wide expense lines.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {open && (
        <OdEventForm event={open.id ? open : null} cats={cats} knownLocs={knownLocs}
          onClose={() => setOpen(null)} onSaved={() => { setOpen(null); load(); }} />
      )}

      {catEdit && (
        <div className="modal-backdrop" onClick={() => setCatEdit(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
            <h3>OD categories</h3>
            <p className="muted mini">One per line. Renaming or removing a category doesn't change lines already saved with the old name.</p>
            <div className="form-grid">
              <div><label>Expense categories</label>
                <textarea rows={10} style={{ width: '100%', fontFamily: 'inherit', fontSize: 13 }} value={catEdit.expense}
                  onChange={(e) => setCatEdit({ ...catEdit, expense: e.target.value })} /></div>
              <div><label>Event categories</label>
                <textarea rows={10} style={{ width: '100%', fontFamily: 'inherit', fontSize: 13 }} value={catEdit.event}
                  onChange={(e) => setCatEdit({ ...catEdit, event: e.target.value })} /></div>
            </div>
            {err && <p className="err">{err}</p>}
            <div className="form-actions">
              <button className="btn gold" onClick={async () => {
                try {
                  const c = await api.put('/api/od/categories', {
                    expense: catEdit.expense.split('\n'), event: catEdit.event.split('\n'),
                  });
                  setCats(c); setCatEdit(null); toast('Categories saved.');
                } catch (e2) { setErr(e2.message); }
              }}>Save categories</button>
              <button className="btn" onClick={() => setCatEdit(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
