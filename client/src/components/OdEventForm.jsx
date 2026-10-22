import React, { useEffect, useState } from 'react';
import { api, apiUpload, fmtDate } from '../api.js';
import { useSettings, useToast } from '../App.jsx';
import { summarize, n, rs, has } from '../odcalc.js';

// One OD event, complete: details, budget summary, locations, expense lines
// (each against a location or Company-wide, with optional allocation),
// payments, supporting documents and the budget-approval request.

const DOC_KINDS = ['Bill', 'Invoice', 'Quotation', 'Receipt', 'Other'];
const APR = {
  pending: ['Pending approval', 'warn'], approved: ['Approved', 'good'],
  rejected: ['Rejected', 'crit'], clarify: ['Clarification requested', 'warn'], superseded: ['Superseded', 'soft'],
};
const v = (x) => (x === null || x === undefined ? '' : x);
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

const toForm = (ev) => ({
  id: ev.id,
  name: v(ev.name), category: v(ev.category),
  event_date: ev.event_date ? String(ev.event_date).slice(0, 10) : '',
  end_date: ev.end_date ? String(ev.end_date).slice(0, 10) : '',
  expense_type: ev.expense_type || 'location',
  employee_count: v(ev.employee_count), participants: v(ev.participants),
  est_budget: v(ev.est_budget), requested_budget: v(ev.requested_budget), approved_budget: v(ev.approved_budget),
  notes: v(ev.notes), files: ev.files || [],
  locations: (ev.locations || []).map((l) => ({
    location: v(l.location), headcount: v(l.headcount), est_budget: v(l.est_budget),
    approved_budget: v(l.approved_budget), category: v(l.category), remarks: v(l.remarks),
  })),
  items: (ev.items || []).map((i) => ({
    category: v(i.category), description: v(i.description), quantity: v(i.quantity),
    est_amount: v(i.est_amount), approved_amount: v(i.approved_amount), actual_amount: v(i.actual_amount),
    location: v(i.location), allocations: i.allocations || [], remarks: v(i.remarks), files: i.files || [],
  })),
  payments: (ev.payments || []).map((p) => ({
    date: v(p.date), amt: v(p.amt), location: v(p.location), reference: v(p.reference), note: v(p.note),
  })),
  reason: '',
});

const Money = ({ value, onChange, width = 100, placeholder = '₹' }) => (
  <input type="number" min="0" step="0.01" style={{ width }} value={value} placeholder={placeholder}
    onChange={(e) => onChange(e.target.value)} />
);
const Card = ({ label, value, tone, sub }) => (
  <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '8px 12px', minWidth: 120, flex: '1 1 120px',
    background: tone === 'crit' ? 'var(--crit-soft)' : tone === 'good' ? 'var(--good-soft)' : 'var(--panel, #fff)' }}>
    <div className="muted mini" style={{ textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
    <div style={{ fontSize: 17, fontWeight: 700, color: tone === 'crit' ? 'var(--crit)' : tone === 'good' ? 'var(--good)' : 'inherit' }}>{value}</div>
    {sub && <div className="muted mini">{sub}</div>}
  </div>
);
const Section = ({ title, hint, children, open = true }) => (
  <details open={open} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '8px 12px', marginTop: 12 }}>
    <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 14 }}>{title}</summary>
    {hint && <p className="muted mini" style={{ margin: '6px 0' }}>{hint}</p>}
    <div style={{ marginTop: 8 }}>{children}</div>
  </details>
);

export default function OdEventForm({ event, cats, knownLocs, onClose, onSaved }) {
  const toast = useToast();
  const { settings } = useSettings();
  const approvers = settings?.budget_approvers || [];
  const [f, setF] = useState(() => toForm(event || {}));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [openAlloc, setOpenAlloc] = useState(null);   // index of the line whose allocation is open
  const [hist, setHist] = useState([]);
  const [req, setReq] = useState({ approver: '', amount: '', note: '' });

  const up = (patch) => { setDirty(true); setF((x) => ({ ...x, ...patch })); };
  const upList = (key, i, patch) => { setDirty(true); setF((x) => ({ ...x, [key]: x[key].map((r, j) => (j === i ? { ...r, ...patch } : r)) })); };
  const addTo = (key, row) => { setDirty(true); setF((x) => ({ ...x, [key]: [...x[key], row] })); };
  const dropFrom = (key, i) => { setDirty(true); setF((x) => ({ ...x, [key]: x[key].filter((_, j) => j !== i) })); };

  const s = summarize(f);
  const locNames = f.locations.map((l) => l.location).filter((x) => x.trim());
  const hcOf = (name) => knownLocs.find((k) => same(k.location, name))?.n;

  useEffect(() => {
    if (!f.id) return;
    api.get('/api/budget/od/' + f.id).then(setHist).catch(() => {});
  }, [f.id]);

  // Renaming a location carries every line, allocation and payment with it.
  const renameLoc = (i, name) => {
    const old = f.locations[i].location;
    setDirty(true);
    setF((x) => ({
      ...x,
      locations: x.locations.map((l, j) => (j === i ? { ...l, location: name } : l)),
      items: x.items.map((it) => ({
        ...it,
        location: it.location && same(it.location, old) ? name : it.location,
        allocations: (it.allocations || []).map((a) => (same(a.location, old) ? { ...a, location: name } : a)),
      })),
      payments: x.payments.map((p) => (p.location && same(p.location, old) ? { ...p, location: name } : p)),
    }));
  };
  const removeLoc = (i) => {
    const name = f.locations[i].location;
    const lines = f.items.filter((it) => it.location && same(it.location, name)).length;
    if (lines && !confirm(`${lines} expense line(s) are tagged to ${name}. Remove the location and make those lines Company-wide?`)) return;
    setDirty(true);
    setF((x) => ({
      ...x,
      locations: x.locations.filter((_, j) => j !== i),
      items: x.items.map((it) => ({
        ...it,
        location: it.location && same(it.location, name) ? '' : it.location,
        allocations: (it.allocations || []).filter((a) => !same(a.location, name)),
      })),
      payments: x.payments.map((p) => (p.location && same(p.location, name) ? { ...p, location: '' } : p)),
    }));
  };
  const fillHeadcounts = () => {
    let filled = 0;
    const locations = f.locations.map((l) => {
      const hc = hcOf(l.location);
      if (hc !== undefined) { filled++; return { ...l, headcount: hc }; }
      return l;
    });
    up({ locations });
    toast(filled ? `Headcount filled for ${filled} location(s) from the employee records.` : 'No matching location names in the employee records.');
  };

  // Company-wide line allocation helpers.
  const lineBase = (it) => n(it.actual_amount) || n(it.approved_amount) || n(it.est_amount);
  const setAlloc = (i, loc, amount) => {
    const it = f.items[i];
    const rest = (it.allocations || []).filter((a) => !same(a.location, loc));
    upList('items', i, { allocations: amount === '' ? rest : [...rest, { location: loc, amount }] });
  };
  const splitAlloc = (i, mode) => {
    const base = lineBase(f.items[i]);
    const locs = f.locations.filter((l) => l.location.trim());
    if (!base || !locs.length) return;
    const weights = locs.map((l) => (mode === 'headcount' ? n(l.headcount) : 1));
    const total = weights.reduce((a, b) => a + b, 0);
    if (!total) { splitAlloc(i, 'even'); return; }
    let left = base;
    const allocations = locs.map((l, k) => {
      const amt = k === locs.length - 1 ? Math.round(left * 100) / 100 : Math.round((base * weights[k] / total) * 100) / 100;
      left -= amt;
      return { location: l.location, amount: amt };
    }).filter((a) => a.amount > 0);
    upList('items', i, { allocations });
  };

  const upload = async (fileList, onDone) => {
    try { onDone(await apiUpload(fileList, '/api/od/upload')); } catch (e) { setErr(e.message); }
  };

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const body = { ...f };
      if (f.id) await api.put('/api/od/' + f.id, body);
      else await api.post('/api/od', body);
      setDirty(false);
      toast(f.id ? 'Event saved — the previous figures are kept in the audit trail.' : 'Event created.');
      onSaved();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  const close = () => {
    if (dirty && !confirm('You have unsaved changes on this event. Close without saving?')) return;
    onClose();
  };

  const sendRequest = async () => {
    if (dirty) { setErr('Save the event first, then send the budget request.'); return; }
    try {
      const r = await api.post(`/api/budget/od/${f.id}/request`, {
        approver_email: req.approver, amount: Number(req.amount), note: req.note,
      });
      if (r.mail_ok) toast(`Budget request sent to ${r.approver_name || r.approver_email}.`);
      else setErr(`Request saved, but the e-mail failed: ${r.mail_error}`);
      setF((x) => ({ ...x, requested_budget: req.amount }));
      setReq({ approver: '', amount: '', note: '' });
      api.get('/api/budget/od/' + f.id).then(setHist).catch(() => {});
    } catch (e) { setErr(e.message); }
  };

  const th = { textAlign: 'left', fontSize: 11, whiteSpace: 'nowrap' };
  const thR = { ...th, textAlign: 'right' };
  const tdR = { textAlign: 'right', whiteSpace: 'nowrap' };
  const locSelect = (value, onChange, blankLabel = 'Company-wide') => (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ maxWidth: 140 }}>
      <option value="">{blankLabel}</option>
      {locNames.map((l) => <option key={l} value={l}>{l}</option>)}
    </select>
  );

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 1180, width: '96vw' }}>
        <h3 style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {f.id ? f.name || 'OD event' : 'New OD event'}
          {f.category && <span className="pill soft mini">{f.category}</span>}
          <span className="pill neutral mini">{f.expense_type === 'company' ? 'Company-wide' : 'Location-wise'}</span>
          {dirty && <span className="pill warn mini">unsaved</span>}
        </h3>

        {/* Budget summary — always visible */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
          <Card label="Estimated" value={rs(s.estimated)} />
          <Card label="Requested" value={s.requested !== null ? rs(s.requested) : '—'} />
          <Card label="Approved" value={s.approved !== null ? rs(s.approved) : '—'} />
          <Card label="Spent" value={rs(s.spent)} sub={s.companySpent ? `${rs(s.companySpent)} company-wide` : null} />
          <Card label="Remaining" value={s.remaining !== null ? rs(s.remaining) : '—'} tone={s.remaining !== null && s.remaining < 0 ? 'crit' : null}
            sub={s.basis !== null ? `of ${s.basisLabel} budget` : 'no budget yet'} />
          <Card label="Variance" tone={s.variance > 0 ? 'crit' : s.variance < 0 ? 'good' : null}
            value={s.variance === null ? '—' : (s.variance > 0 ? '+' : s.variance < 0 ? '−' : '') + rs(Math.abs(s.variance))}
            sub={s.variance === null ? '' : s.variance > 0 ? `over ${s.basisLabel}` : s.variance < 0 ? `under ${s.basisLabel}` : 'on budget'} />
          <Card label="Paid" value={rs(s.paid)} />
          <Card label="Pending payment" value={rs(s.pending)} tone={s.overpaid ? 'crit' : null}
            sub={s.overpaid ? `paid ${rs(s.overpaid)} more than recorded spend — add the expense lines` : null} />
        </div>

        {/* 1. Event details */}
        <Section title="1 · Event details">
          <div className="form-grid">
            <div style={{ gridColumn: '1/-1' }}><label>Event / activity name *</label>
              <input value={f.name} onChange={(e) => up({ name: e.target.value })} placeholder="e.g. Diwali Celebration 2026" /></div>
            <div><label>Event category</label>
              <select value={f.category} onChange={(e) => up({ category: e.target.value })}>
                <option value="">— choose —</option>
                {[...new Set([...cats.event, ...(f.category ? [f.category] : [])])].map((c) => <option key={c}>{c}</option>)}
              </select></div>
            <div><label>Expense type</label>
              <select value={f.expense_type} onChange={(e) => up({ expense_type: e.target.value })}>
                <option value="location">Location-wise</option>
                <option value="company">Company-wide</option>
              </select></div>
            <div><label>From date</label><input type="date" value={f.event_date} onChange={(e) => up({ event_date: e.target.value })} /></div>
            <div><label>To date</label><input type="date" value={f.end_date} onChange={(e) => up({ end_date: e.target.value })} /></div>
            <div><label>Total employee headcount
              {s.locTotals.headcount > 0 && n(f.employee_count) !== s.locTotals.headcount && (
                <button type="button" className="btn link" style={{ fontSize: 11, marginLeft: 6 }}
                  onClick={() => up({ employee_count: s.locTotals.headcount })}>= locations ({s.locTotals.headcount})</button>
              )}</label>
              <input type="number" min="0" value={f.employee_count} onChange={(e) => up({ employee_count: e.target.value })} /></div>
            <div><label>Employees participating (if applicable)</label>
              <input type="number" min="0" value={f.participants} onChange={(e) => up({ participants: e.target.value })} /></div>
            <div style={{ gridColumn: '1/-1' }}><label>Notes</label>
              <textarea rows={2} style={{ width: '100%', fontFamily: 'inherit', fontSize: 13 }} value={f.notes} onChange={(e) => up({ notes: e.target.value })} /></div>
          </div>
        </Section>

        {/* 2. Budget */}
        <Section title="2 · Budget"
          hint="Spent is always the total of the expense lines below. Remaining and variance compare it with the approved budget (or the estimate until one is approved). Requested and approved fill in automatically from the budget-approval request.">
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label className="muted mini">Estimated budget<br /><Money width={140} value={f.est_budget} onChange={(x) => up({ est_budget: x })} /></label>
            <label className="muted mini">Requested budget<br /><Money width={140} value={f.requested_budget} onChange={(x) => up({ requested_budget: x })} /></label>
            <label className="muted mini">Approved budget<br /><Money width={140} value={f.approved_budget} onChange={(x) => up({ approved_budget: x })} /></label>
            {(s.locTotals.est > 0 || s.lines.est > 0) && (
              <span className="muted mini">
                Built up from the details: locations {rs(s.locTotals.est)} est. / {rs(s.locTotals.approved)} appr. ·
                expense lines {rs(s.lines.est)} est. / {rs(s.lines.approved)} appr.
              </span>
            )}
          </div>
        </Section>

        {/* 3. Locations */}
        <Section title={`3 · Locations (${f.locations.length})`}
          hint={f.expense_type === 'company'
            ? 'Optional for a company-wide event — add locations if you want to allocate company-wide purchases across offices.'
            : 'Add every location this event covers. Spent per location = its own expense lines + any company-wide amount allocated to it.'}>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr>
                <th style={th}>Location</th><th style={thR}>Headcount</th><th style={thR}>Estimated</th><th style={thR}>Approved</th>
                <th style={th}>Main expense category</th><th style={th}>Remarks</th>
                <th style={thR}>Spent here</th><th style={thR}>+ Allocated</th><th style={thR}>Total</th><th />
              </tr></thead>
              <tbody>
                {f.locations.map((l, i) => {
                  const b = s.byLoc[i] || {};
                  const hc = hcOf(l.location);
                  return (
                    <tr key={i}>
                      <td><input list="od-known-locs" value={l.location} style={{ width: 130 }} placeholder="e.g. Chennai"
                        onChange={(e) => renameLoc(i, e.target.value)} /></td>
                      <td style={tdR}>
                        <input type="number" min="0" style={{ width: 70 }} value={l.headcount} onChange={(e) => upList('locations', i, { headcount: e.target.value })} />
                        {hc !== undefined && n(l.headcount) !== hc && (
                          <button type="button" className="btn link" title={`${hc} active employees at ${l.location} in the employee records`}
                            style={{ fontSize: 11 }} onClick={() => upList('locations', i, { headcount: hc })}>↻{hc}</button>
                        )}
                      </td>
                      <td style={tdR}><Money width={95} value={l.est_budget} onChange={(x) => upList('locations', i, { est_budget: x })} /></td>
                      <td style={tdR}><Money width={95} value={l.approved_budget} onChange={(x) => upList('locations', i, { approved_budget: x })} /></td>
                      <td><select value={l.category} onChange={(e) => upList('locations', i, { category: e.target.value })} style={{ maxWidth: 170 }}>
                        <option value="">—</option>
                        {[...new Set([...cats.expense, ...(l.category ? [l.category] : [])])].map((c) => <option key={c}>{c}</option>)}
                      </select></td>
                      <td><input value={l.remarks} style={{ width: 140 }} onChange={(e) => upList('locations', i, { remarks: e.target.value })} /></td>
                      <td style={tdR}>{rs(b.direct)}</td>
                      <td style={tdR} className="muted">{b.allocated ? rs(b.allocated) : '—'}</td>
                      <td style={{ ...tdR, fontWeight: 700 }}>{rs(b.total)}</td>
                      <td><button type="button" className="btn link" onClick={() => removeLoc(i)}>✕</button></td>
                    </tr>
                  );
                })}
                {f.locations.length > 0 && (
                  <tr style={{ fontWeight: 700, borderTop: '2px solid var(--line)' }}>
                    <td>Total</td>
                    <td style={tdR}>{s.locTotals.headcount || '—'}</td>
                    <td style={tdR}>{rs(s.locTotals.est)}</td>
                    <td style={tdR}>{rs(s.locTotals.approved)}</td>
                    <td colSpan={2} className="muted mini" style={{ fontWeight: 400 }}>
                      {s.unallocated > 0 ? `+ ${rs(s.unallocated)} company-wide not allocated to a location` : ''}
                    </td>
                    <td style={tdR}>{rs(s.locTotals.direct)}</td>
                    <td style={tdR}>{rs(s.locTotals.allocated)}</td>
                    <td style={tdR}>{rs(s.locTotals.total)}</td><td />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <datalist id="od-known-locs">{knownLocs.map((k) => <option key={k.location} value={k.location}>{k.n} employees</option>)}</datalist>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn" onClick={() => addTo('locations', { location: '', headcount: '', est_budget: '', approved_budget: '', category: '', remarks: '' })}>+ Add location</button>
            {f.locations.length > 0 && <button type="button" className="btn" onClick={fillHeadcounts}>Fill headcounts from employee records</button>}
          </div>
        </Section>

        {/* 4. Expense lines */}
        <Section title={`4 · Expense lines (${f.items.length})`}
          hint="Every amount spent goes here, once. Tag each line to a location, or leave it Company-wide (e.g. gifts bought centrally). A company-wide line can be allocated across locations — that only changes the location-wise view, never the totals.">
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr>
                <th style={th}>Category</th><th style={th}>Description</th><th style={thR}>Qty</th>
                <th style={thR}>Estimated</th><th style={thR}>Approved</th><th style={thR}>Actual</th>
                <th style={th}>Location</th><th style={th}>Remarks</th><th style={th}>Docs</th><th />
              </tr></thead>
              <tbody>
                {f.items.map((it, i) => {
                  const company = !it.location;
                  const allocSum = (it.allocations || []).reduce((a, x) => a + n(x.amount), 0);
                  return (
                    <React.Fragment key={i}>
                      <tr>
                        <td><select value={it.category} onChange={(e) => upList('items', i, { category: e.target.value })} style={{ maxWidth: 160 }}>
                          <option value="">—</option>
                          {[...new Set([...cats.expense, ...(it.category ? [it.category] : [])])].map((c) => <option key={c}>{c}</option>)}
                        </select></td>
                        <td><input value={it.description} style={{ width: 170 }} onChange={(e) => upList('items', i, { description: e.target.value })} /></td>
                        <td style={tdR}><input type="number" min="0" style={{ width: 56 }} value={it.quantity} onChange={(e) => upList('items', i, { quantity: e.target.value })} /></td>
                        <td style={tdR}><Money width={90} value={it.est_amount} onChange={(x) => upList('items', i, { est_amount: x })} /></td>
                        <td style={tdR}><Money width={90} value={it.approved_amount} onChange={(x) => upList('items', i, { approved_amount: x })} /></td>
                        <td style={tdR}><Money width={90} value={it.actual_amount} onChange={(x) => upList('items', i, { actual_amount: x })} /></td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {locSelect(it.location, (x) => upList('items', i, { location: x, allocations: x ? [] : it.allocations }))}
                          {company && locNames.length > 0 && (
                            <button type="button" className="btn link" style={{ fontSize: 11 }}
                              title="Split this company-wide amount across locations (reporting only)"
                              onClick={() => setOpenAlloc(openAlloc === i ? null : i)}>
                              {allocSum ? `split ${rs(allocSum)}` : 'allocate…'}
                            </button>
                          )}
                        </td>
                        <td><input value={it.remarks} style={{ width: 120 }} onChange={(e) => upList('items', i, { remarks: e.target.value })} /></td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {(it.files || []).map((d, k) => (
                            <span key={d.id} style={{ marginRight: 4 }}>
                              <a href={'/api/files/' + d.id} target="_blank" rel="noreferrer" title={d.name}>📄</a>
                              <button type="button" className="btn link" style={{ fontSize: 10, padding: 0 }}
                                onClick={() => upList('items', i, { files: it.files.filter((_, j) => j !== k) })}>✕</button>
                            </span>
                          ))}
                          <label className="btn link" style={{ cursor: 'pointer', fontSize: 11 }} title="Attach a bill, invoice or quotation">
                            📎<input type="file" multiple style={{ display: 'none' }}
                              onChange={(e) => e.target.files.length && upload(e.target.files, (fs) => upList('items', i, { files: [...(it.files || []), ...fs] }))} />
                          </label>
                        </td>
                        <td><button type="button" className="btn link" onClick={() => { dropFrom('items', i); setOpenAlloc(null); }}>✕</button></td>
                      </tr>
                      {openAlloc === i && company && (
                        <tr><td colSpan={10} style={{ background: 'var(--panel2)', padding: 10 }}>
                          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                            <b className="mini">Allocate {rs(lineBase(it))} across locations:</b>
                            {locNames.map((loc) => (
                              <label key={loc} className="muted mini" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                                {loc}
                                <Money width={90} value={(it.allocations || []).find((a) => same(a.location, loc))?.amount ?? ''}
                                  onChange={(x) => setAlloc(i, loc, x)} />
                              </label>
                            ))}
                          </div>
                          <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <button type="button" className="btn" onClick={() => splitAlloc(i, 'headcount')}>Split by headcount</button>
                            <button type="button" className="btn" onClick={() => splitAlloc(i, 'even')}>Split evenly</button>
                            <button type="button" className="btn" onClick={() => upList('items', i, { allocations: [] })}>Clear</button>
                            <span className="mini" style={{ color: allocSum > lineBase(it) + 0.005 ? 'var(--crit)' : 'inherit' }}>
                              Allocated {rs(allocSum)} of {rs(lineBase(it))}
                              {allocSum > lineBase(it) + 0.005 ? ' — more than the line amount' : allocSum < lineBase(it) - 0.005 ? ` · ${rs(lineBase(it) - allocSum)} stays company-wide` : ' ✓'}
                            </span>
                          </div>
                        </td></tr>
                      )}
                    </React.Fragment>
                  );
                })}
                {f.items.length > 0 && (
                  <tr style={{ fontWeight: 700, borderTop: '2px solid var(--line)' }}>
                    <td colSpan={3}>Total ({f.items.length} line{f.items.length === 1 ? '' : 's'})</td>
                    <td style={tdR}>{rs(s.lines.est)}</td><td style={tdR}>{rs(s.lines.approved)}</td><td style={tdR}>{rs(s.lines.actual)}</td>
                    <td colSpan={4} className="muted mini" style={{ fontWeight: 400 }}>
                      {rs(s.locationSpent)} at locations · {rs(s.companySpent)} company-wide
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <button type="button" className="btn" style={{ marginTop: 8 }}
            onClick={() => addTo('items', { category: '', description: '', quantity: '', est_amount: '', approved_amount: '', actual_amount: '',
              location: f.expense_type === 'location' && locNames.length === 1 ? locNames[0] : '', allocations: [], remarks: '', files: [] })}>+ Add expense line</button>
        </Section>

        {/* 5. Payments */}
        <Section title={`5 · Payments (${f.payments.length}) — paid ${rs(s.paid)} · pending ${rs(s.pending)}`}>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr><th style={th}>Date</th><th style={thR}>Amount</th><th style={th}>Location</th><th style={th}>Payment reference</th><th style={th}>Note</th><th /></tr></thead>
              <tbody>
                {f.payments.map((p, i) => (
                  <tr key={i}>
                    <td><input type="date" value={p.date} onChange={(e) => upList('payments', i, { date: e.target.value })} /></td>
                    <td style={tdR}><Money width={110} value={p.amt} onChange={(x) => upList('payments', i, { amt: x })} /></td>
                    <td>{locSelect(p.location, (x) => upList('payments', i, { location: x }))}</td>
                    <td><input value={p.reference} style={{ width: 160 }} placeholder="UTR / cheque / invoice no." onChange={(e) => upList('payments', i, { reference: e.target.value })} /></td>
                    <td><input value={p.note} style={{ width: 180 }} onChange={(e) => upList('payments', i, { note: e.target.value })} /></td>
                    <td><button type="button" className="btn link" onClick={() => dropFrom('payments', i)}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" className="btn" style={{ marginTop: 8 }}
            onClick={() => addTo('payments', { date: '', amt: '', location: '', reference: '', note: '' })}>+ Add payment</button>
        </Section>

        {/* 6. Documents */}
        <Section title={`6 · Supporting documents (${f.files.length})`} hint="Bills, invoices, quotations and other papers for the whole event. Documents for a single expense line can also be attached on that line (📎).">
          {f.files.map((d, i) => (
            <div key={d.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0', fontSize: 13 }}>
              <select value={d.kind || 'Other'} onChange={(e) => up({ files: f.files.map((x, j) => (j === i ? { ...x, kind: e.target.value } : x)) })}>
                {DOC_KINDS.map((k) => <option key={k}>{k}</option>)}
              </select>
              <a href={'/api/files/' + d.id} target="_blank" rel="noreferrer">📄 {d.name}</a>
              <button type="button" className="btn link" onClick={() => up({ files: f.files.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
          <label className="btn" style={{ cursor: 'pointer', marginTop: 6 }}>
            ⬆ Upload documents
            <input type="file" multiple style={{ display: 'none' }}
              onChange={(e) => e.target.files.length && upload(e.target.files, (fs) => up({ files: [...f.files, ...fs.map((x) => ({ ...x, kind: 'Other' }))] }))} />
          </label>
        </Section>

        {/* Budget approval */}
        {f.id && (
          <Section title="Budget approval" open={!hist.length}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label className="muted mini">Approver<br />
                <select value={req.approver} onChange={(e) => setReq({ ...req, approver: e.target.value })}>
                  <option value="">— choose —</option>
                  {approvers.map((a) => <option key={a.email} value={a.email}>{a.name} ({a.email})</option>)}
                </select></label>
              <label className="muted mini">Amount<br /><Money width={130} value={req.amount} onChange={(x) => setReq({ ...req, amount: x })} /></label>
              <label className="muted mini" style={{ flex: 1, minWidth: 200 }}>Note<br />
                <input style={{ width: '100%' }} value={req.note} onChange={(e) => setReq({ ...req, note: e.target.value })} /></label>
              <button type="button" className="btn gold" disabled={!req.approver || !(Number(req.amount) > 0)} onClick={sendRequest}>Send request for budget approval</button>
            </div>
            {!req.amount && s.estimated > 0 && (
              <button type="button" className="btn link mini" onClick={() => setReq({ ...req, amount: s.estimated })}>use the estimated {rs(s.estimated)}</button>
            )}
            {hist.map((h) => (
              <div key={h.id} className="muted mini" style={{ padding: '3px 0' }}>
                <span className={'pill mini ' + (APR[h.status] || ['', 'soft'])[1]}>{(APR[h.status] || [h.status])[0]}</span>{' '}
                {rs(h.amount)} → {h.approver_name || h.approver_email} · {fmtDate(h.created_at)}
                {h.decision_comment ? ` · “${h.decision_comment}”` : ''}
              </div>
            ))}
          </Section>
        )}

        {err && <p className="err" style={{ marginTop: 10 }}>{err}</p>}
        <div className="form-actions" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          {f.id && dirty && <input style={{ flex: 1, minWidth: 220 }} placeholder="Reason for the change (optional — audit trail)"
            value={f.reason} onChange={(e) => setF((x) => ({ ...x, reason: e.target.value }))} />}
          <button className="btn gold" disabled={busy || !f.name.trim()} onClick={save}>{busy ? 'Saving…' : f.id ? 'Save event' : 'Create event'}</button>
          <button className="btn" onClick={close}>Close</button>
        </div>
      </div>
    </div>
  );
}
