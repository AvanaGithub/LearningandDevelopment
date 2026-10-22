import React, { useEffect, useState } from 'react';
import { api, apiUpload, fmtDate } from '../api.js';
import { useSettings, useToast } from '../App.jsx';
import { summarize, n, rs, COMPANY_WIDE, isCompanyRow } from '../odcalc.js';

// One OD event: details, budget, the Expenses table (one row per location,
// or a Company-wide row, each with estimated / approved / actual),
// supporting documents and the budget-approval request.

const DOC_KINDS = ['Bill', 'Invoice', 'Quotation', 'Receipt', 'Other'];
const APR = {
  pending: ['Pending approval', 'warn'], approved: ['Approved', 'good'],
  rejected: ['Rejected', 'crit'], clarify: ['Clarification requested', 'warn'], superseded: ['Superseded', 'soft'],
};
const v = (x) => (x === null || x === undefined ? '' : x);
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

// Expense lines and payments are not edited here any more; they are left
// out of the form so saving keeps whatever is stored.
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
    approved_budget: v(l.approved_budget), actual: v(l.actual), category: v(l.category), remarks: v(l.remarks),
  })),
  reason: '',
});
const blankRow = (location = '') => ({ location, headcount: '', est_budget: '', approved_budget: '', actual: '', category: '', remarks: '' });

const Money = ({ value, onChange, width = 100 }) => (
  <input type="number" min="0" step="0.01" style={{ width }} value={value} placeholder="₹"
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
  const [hist, setHist] = useState([]);
  const [req, setReq] = useState({ approver: '', amount: '', note: '' });

  const up = (patch) => { setDirty(true); setF((x) => ({ ...x, ...patch })); };
  const upRow = (i, patch) => { setDirty(true); setF((x) => ({ ...x, locations: x.locations.map((r, j) => (j === i ? { ...r, ...patch } : r)) })); };
  const addRow = (row) => { setDirty(true); setF((x) => ({ ...x, locations: [...x.locations, row] })); };
  const dropRow = (i) => { setDirty(true); setF((x) => ({ ...x, locations: x.locations.filter((_, j) => j !== i) })); };

  // Older expense lines (if any) still count towards Spent.
  const s = summarize({ ...f, items: event?.items || [], payments: [] });
  const hcOf = (name) => knownLocs.find((k) => same(k.location, name))?.n;
  const hasCompanyRow = f.locations.some(isCompanyRow);
  const oldLines = (event?.items || []).length;

  useEffect(() => {
    if (!f.id) return;
    api.get('/api/budget/od/' + f.id).then(setHist).catch(() => {});
  }, [f.id]);

  const fillHeadcounts = () => {
    let filled = 0;
    const locations = f.locations.map((l) => {
      const hc = isCompanyRow(l) ? undefined : hcOf(l.location);
      if (hc !== undefined) { filled++; return { ...l, headcount: hc }; }
      return l;
    });
    up({ locations });
    toast(filled ? `Headcount filled for ${filled} location(s) from the employee records.` : 'No matching location names in the employee records.');
  };

  const upload = async (fileList, onDone) => {
    try { onDone(await apiUpload(fileList, '/api/od/upload')); } catch (e) { setErr(e.message); }
  };

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      if (f.id) await api.put('/api/od/' + f.id, f);
      else await api.post('/api/od', f);
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

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 1100, width: '96vw' }}>
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
        </div>

        <Section title="Event details">
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
                  onClick={() => up({ employee_count: s.locTotals.headcount })}>= expenses table ({s.locTotals.headcount})</button>
              )}</label>
              <input type="number" min="0" value={f.employee_count} onChange={(e) => up({ employee_count: e.target.value })} /></div>
            <div><label>Employees participating (if applicable)</label>
              <input type="number" min="0" value={f.participants} onChange={(e) => up({ participants: e.target.value })} /></div>
            <div style={{ gridColumn: '1/-1' }}><label>Notes</label>
              <textarea rows={2} style={{ width: '100%', fontFamily: 'inherit', fontSize: 13 }} value={f.notes} onChange={(e) => up({ notes: e.target.value })} /></div>
          </div>
        </Section>

        <Section title="Budget"
          hint="Spent is the total of the Actual column in the Expenses table below. Remaining and variance compare it with the approved budget (or the estimate until one is approved). Requested and approved fill in automatically from the budget-approval request.">
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label className="muted mini">Estimated budget<br /><Money width={140} value={f.est_budget} onChange={(x) => up({ est_budget: x })} /></label>
            <label className="muted mini">Requested budget<br /><Money width={140} value={f.requested_budget} onChange={(x) => up({ requested_budget: x })} /></label>
            <label className="muted mini">Approved budget<br /><Money width={140} value={f.approved_budget} onChange={(x) => up({ approved_budget: x })} /></label>
            {(s.locTotals.est > 0 || s.locTotals.approved > 0) && (
              <span className="muted mini">From the Expenses table: {rs(s.locTotals.est)} estimated · {rs(s.locTotals.approved)} approved</span>
            )}
          </div>
        </Section>

        <Section title="Expenses"
          hint={f.expense_type === 'company'
            ? 'Use a Company-wide row for purchases made centrally (e.g. gifts bought for all offices). Add location rows too if you want the spend shown per office.'
            : 'One row per location this event covers. Enter what was actually spent in the Actual column; use a Company-wide row for anything bought centrally.'}>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr>
                <th style={th}>Location</th><th style={thR}>Headcount</th><th style={thR}>Estimated</th><th style={thR}>Approved</th>
                <th style={thR}>Actual</th><th style={th}>Expense category</th><th style={th}>Remarks</th><th />
              </tr></thead>
              <tbody>
                {f.locations.map((l, i) => {
                  const company = isCompanyRow(l);
                  const hc = company ? undefined : hcOf(l.location);
                  const over = n(l.actual) > 0 && (n(l.approved_budget) || n(l.est_budget)) > 0 && n(l.actual) > (n(l.approved_budget) || n(l.est_budget));
                  return (
                    <tr key={i}>
                      <td><input list="od-known-locs" value={l.location} style={{ width: 140, fontWeight: company ? 700 : 400 }}
                        placeholder="e.g. Chennai" onChange={(e) => upRow(i, { location: e.target.value })} /></td>
                      <td style={tdR}>
                        {company ? <span className="muted mini">—</span> : <>
                          <input type="number" min="0" style={{ width: 70 }} value={l.headcount} onChange={(e) => upRow(i, { headcount: e.target.value })} />
                          {hc !== undefined && n(l.headcount) !== hc && (
                            <button type="button" className="btn link" title={`${hc} active employees at ${l.location} in the employee records`}
                              style={{ fontSize: 11 }} onClick={() => upRow(i, { headcount: hc })}>↻{hc}</button>
                          )}
                        </>}
                      </td>
                      <td style={tdR}><Money width={100} value={l.est_budget} onChange={(x) => upRow(i, { est_budget: x })} /></td>
                      <td style={tdR}><Money width={100} value={l.approved_budget} onChange={(x) => upRow(i, { approved_budget: x })} /></td>
                      <td style={tdR}>
                        <Money width={110} value={l.actual} onChange={(x) => upRow(i, { actual: x })} />
                        {over && <div className="mini" style={{ color: 'var(--crit)' }}>over budget</div>}
                      </td>
                      <td><select value={l.category} onChange={(e) => upRow(i, { category: e.target.value })} style={{ maxWidth: 180 }}>
                        <option value="">—</option>
                        {[...new Set([...cats.expense, ...(l.category ? [l.category] : [])])].map((c) => <option key={c}>{c}</option>)}
                      </select></td>
                      <td><input value={l.remarks} style={{ width: 160 }} onChange={(e) => upRow(i, { remarks: e.target.value })} /></td>
                      <td><button type="button" className="btn link" onClick={() => dropRow(i)}>✕</button></td>
                    </tr>
                  );
                })}
                {f.locations.length > 0 && (
                  <tr style={{ fontWeight: 700, borderTop: '2px solid var(--line)' }}>
                    <td>Total</td>
                    <td style={tdR}>{s.locTotals.headcount || '—'}</td>
                    <td style={tdR}>{rs(s.locTotals.est)}</td>
                    <td style={tdR}>{rs(s.locTotals.approved)}</td>
                    <td style={tdR}>{rs(s.locTotals.actual)}</td>
                    <td colSpan={3} className="muted mini" style={{ fontWeight: 400 }}>
                      {oldLines ? `+ ${rs(s.spent - s.locTotals.actual)} from ${oldLines} earlier expense line(s)` : ''}
                    </td>
                  </tr>
                )}
                {!f.locations.length && <tr><td colSpan={8} className="muted">No expenses yet — add a location or a company-wide row.</td></tr>}
              </tbody>
            </table>
          </div>
          <datalist id="od-known-locs">
            <option value={COMPANY_WIDE}>purchased centrally</option>
            {knownLocs.map((k) => <option key={k.location} value={k.location}>{k.n} employees</option>)}
          </datalist>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn" onClick={() => addRow(blankRow())}>+ Add location</button>
            {!hasCompanyRow && <button type="button" className="btn" onClick={() => addRow(blankRow(COMPANY_WIDE))}>+ Company-wide expense</button>}
            {f.locations.some((l) => !isCompanyRow(l)) && <button type="button" className="btn" onClick={fillHeadcounts}>Fill headcounts from employee records</button>}
          </div>
        </Section>

        <Section title="Supporting documents" hint="Bills, invoices, quotations and other papers for this event.">
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
