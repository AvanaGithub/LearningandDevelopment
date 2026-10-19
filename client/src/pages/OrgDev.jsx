import React, { useEffect, useMemo, useState } from 'react';
import { api, fmtDate, inr } from '../api.js';
import { useAuth, useToast, useSettings } from '../App.jsx';
import { toXlsx } from '../xlsx.js';

const APR = {
  pending: ['Pending approval', 'warn'], approved: ['Approved', 'good'],
  rejected: ['Rejected', 'crit'], clarify: ['Clarification requested', 'warn'],
};

// Organization Development: confidential event & expense tracker for
// authorised OD users, Vivek and Sundar. Budget requests go through the
// same approval flow as trainings.
export default function OrgDev() {
  const { user: me } = useAuth();
  const { settings } = useSettings();
  const toast = useToast();
  const approvers = settings?.budget_approvers || [];
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(null);
  const [reqFor, setReqFor] = useState(null);   // {ev, approver, amount, note, hist}
  const [err, setErr] = useState(null);

  const load = () => api.get('/api/od').then(setRows).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const blank = { name: '', location: '', event_date: '', end_date: '', employee_count: '',
    est_budget: '', actual: '', notes: '', payments: [], reason: '' };

  const save = async (e) => {
    e.preventDefault();
    try {
      if (form.id) await api.patch('/api/od/' + form.id, form);
      else await api.post('/api/od', form);
      toast(form.id ? 'Event updated.' : 'Event added.');
      setForm(null); load();
    } catch (e2) { setErr(e2.message); }
  };

  const remove = async (ev) => {
    const reason = prompt(`Remove "${ev.name}" from the list? It is deactivated (kept for audit), not deleted.\nReason:`);
    if (!reason?.trim()) return;
    try {
      await api.patch('/api/od/' + ev.id, { active: false, reason: reason.trim() });
      toast('Event removed — kept in the audit trail.');
      load();
    } catch (e2) { setErr(e2.message); }
  };

  const openReq = async (ev) => {
    try {
      const hist = await api.get('/api/budget/od/' + ev.id);
      setReqFor({ ev, approver: '', amount: ev.est_budget || '', note: '', hist });
    } catch (e2) { setErr(e2.message); }
  };

  const sendReq = async () => {
    try {
      const r = await api.post(`/api/budget/od/${reqFor.ev.id}/request`, {
        approver_email: reqFor.approver, amount: Number(reqFor.amount), note: reqFor.note,
      });
      if (r.mail_ok) toast(`Request sent to ${r.approver_name || r.approver_email}.`);
      else setErr(`Saved, but the e-mail failed: ${r.mail_error}`);
      setReqFor(null); load();
    } catch (e2) { setErr(e2.message); }
  };

  // Location-wise rollup for the report card + exports.
  const byLoc = useMemo(() => {
    if (!rows) return [];
    const g = {};
    rows.forEach((r) => {
      const k = (r.location || 'Unspecified').trim() || 'Unspecified';
      const o = (g[k] = g[k] || { location: k, events: 0, employees: 0, est: 0, approved: 0, actual: 0, paid: 0 });
      o.events++; o.employees += Number(r.employee_count) || 0;
      o.est += Number(r.est_budget) || 0; o.approved += Number(r.approved_budget) || 0;
      o.actual += Number(r.actual) || 0; o.paid += Number(r.paid) || 0;
    });
    return Object.values(g).sort((a, b) => b.actual - a.actual);
  }, [rows]);

  const exportEvents = () => toXlsx('OD-events.xlsx',
    ['Event', 'Location', 'From', 'To', 'Employees', 'Estimated budget', 'Approved budget',
      'Actual expenditure', 'Paid', 'Pending payment', 'Cost per employee', 'Approval status', 'Notes'],
    rows.map((r) => [r.name, r.location || '', r.event_date ? String(r.event_date).slice(0, 10) : '',
      r.end_date ? String(r.end_date).slice(0, 10) : '', r.employee_count,
      Number(r.est_budget), r.approved_budget === null ? '' : Number(r.approved_budget),
      Number(r.actual), r.paid, Math.max(0, Number(r.actual) - r.paid),
      r.cost_per_emp ?? '', r.apr_status ? (APR[r.apr_status] || [r.apr_status])[0] : '', r.notes || '']),
    'OD events');

  const exportLoc = () => toXlsx('OD-by-location.xlsx',
    ['Location', 'Events', 'Employees', 'Estimated budget', 'Approved budget', 'Actual expenditure', 'Paid', 'Cost per employee'],
    byLoc.map((l) => [l.location, l.events, l.employees, l.est, l.approved, l.actual, l.paid,
      l.employees > 0 ? Math.round(l.actual / l.employees) : '']),
    'By location');

  const paidOf = (p) => (p || []).reduce((a, x) => a + (Number(x.amt) || 0), 0);

  return (
    <div>
      <div className="page-head">
        <h2>Organization Development</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {rows?.length > 0 && <button className="btn" onClick={exportEvents}>⬇ Events</button>}
          {rows?.length > 0 && <button className="btn" onClick={exportLoc}>⬇ By location</button>}
          <button className="btn gold" onClick={() => setForm({ ...blank })}>+ New event</button>
        </div>
      </div>
      <p className="muted mini">
        Confidential — visible only to authorised OD users, the budget approvers and the super admin.
        Track each event's budget and spend; send the budget request to {approvers.map((a) => a.name).join(' / ') || 'the approvers'} from here.
      </p>
      {err && <p className="err" onClick={() => setErr(null)}>{err}</p>}
      {!rows ? <p className="muted">Loading…</p> : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table style={{ minWidth: 980 }}>
            <thead><tr><th>Event</th><th>Location</th><th>Dates</th>
              <th style={{ textAlign: 'right' }}>Employees</th>
              <th style={{ textAlign: 'right' }}>Estimated</th>
              <th style={{ textAlign: 'right' }}>Approved</th>
              <th style={{ textAlign: 'right' }}>Actual</th>
              <th style={{ textAlign: 'right' }}>Paid</th>
              <th style={{ textAlign: 'right' }}>Cost/employee</th>
              <th>Approval</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><b>{r.name}</b>{r.notes && <div className="muted mini">{r.notes}</div>}</td>
                  <td>{r.location || '—'}</td>
                  <td className="muted mini">{r.event_date ? fmtDate(r.event_date) : '—'}{r.end_date && r.end_date !== r.event_date ? ' → ' + fmtDate(r.end_date) : ''}</td>
                  <td style={{ textAlign: 'right' }}>{r.employee_count || '—'}</td>
                  <td style={{ textAlign: 'right' }}>{inr(r.est_budget)}</td>
                  <td style={{ textAlign: 'right' }}>{r.approved_budget === null ? <span className="muted mini">—</span> : inr(r.approved_budget)}</td>
                  <td style={{ textAlign: 'right' }}>{inr(r.actual)}</td>
                  <td style={{ textAlign: 'right' }} title={`Pending: ${inr(Math.max(0, Number(r.actual) - r.paid))}`}>{inr(r.paid)}</td>
                  <td style={{ textAlign: 'right' }}>{r.cost_per_emp === null ? <span className="muted mini">—</span> : inr(r.cost_per_emp)}</td>
                  <td>
                    {r.apr_status
                      ? <span className={'pill mini ' + (APR[r.apr_status] || ['', 'soft'])[1]}
                          title={r.apr_comment ? `${r.apr_approver || ''}: ${r.apr_comment}` : r.apr_approver || ''}>
                          {(APR[r.apr_status] || [r.apr_status])[0]}{r.apr_amount ? ' · ' + inr(r.apr_amount) : ''}</span>
                      : <span className="muted mini">not requested</span>}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn link" onClick={() => openReq(r)}>₹ request</button>{' '}
                    <button className="btn link" onClick={() => setForm({
                      ...r, event_date: r.event_date ? String(r.event_date).slice(0, 10) : '',
                      end_date: r.end_date ? String(r.end_date).slice(0, 10) : '',
                      approved_budget: r.approved_budget ?? '', payments: r.payments || [], reason: '',
                    })}>edit</button>{' '}
                    <button className="btn link" onClick={() => remove(r)}>✕</button>
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={11} className="muted">No OD events yet — add the first one.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {byLoc.length > 1 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 14, margin: '0 0 6px' }}>📍 Location-wise summary</h3>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr><th>Location</th><th style={{ textAlign: 'right' }}>Events</th>
                <th style={{ textAlign: 'right' }}>Employees</th><th style={{ textAlign: 'right' }}>Estimated</th>
                <th style={{ textAlign: 'right' }}>Approved</th><th style={{ textAlign: 'right' }}>Actual</th>
                <th style={{ textAlign: 'right' }}>Paid</th><th style={{ textAlign: 'right' }}>Cost/employee</th></tr></thead>
              <tbody>
                {byLoc.map((l) => (
                  <tr key={l.location}>
                    <td>{l.location}</td>
                    <td style={{ textAlign: 'right' }}>{l.events}</td>
                    <td style={{ textAlign: 'right' }}>{l.employees}</td>
                    <td style={{ textAlign: 'right' }}>{inr(l.est)}</td>
                    <td style={{ textAlign: 'right' }}>{inr(l.approved)}</td>
                    <td style={{ textAlign: 'right' }}>{inr(l.actual)}</td>
                    <td style={{ textAlign: 'right' }}>{inr(l.paid)}</td>
                    <td style={{ textAlign: 'right' }}>{l.employees > 0 ? inr(Math.round(l.actual / l.employees)) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {form && (
        <div className="modal-backdrop" onClick={() => setForm(null)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={save} style={{ maxWidth: 640 }}>
            <h3>{form.id ? 'Edit OD event' : 'New OD event'}</h3>
            <div className="form-grid">
              <div><label>Event name *</label>
                <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Annual offsite 2026" /></div>
              <div><label>Location</label>
                <input value={form.location || ''} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="e.g. Mahabalipuram" /></div>
              <div><label>From date</label>
                <input type="date" value={form.event_date || ''} onChange={(e) => setForm({ ...form, event_date: e.target.value })} /></div>
              <div><label>To date</label>
                <input type="date" value={form.end_date || ''} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></div>
              <div><label>Employee count</label>
                <input type="number" min="0" value={form.employee_count} onChange={(e) => setForm({ ...form, employee_count: e.target.value })} /></div>
              <div><label>Estimated budget (₹)</label>
                <input type="number" min="0" value={form.est_budget} onChange={(e) => setForm({ ...form, est_budget: e.target.value })} /></div>
              <div><label>Approved budget (₹) <span className="muted mini">(auto-fills on approval)</span></label>
                <input type="number" min="0" value={form.approved_budget ?? ''} onChange={(e) => setForm({ ...form, approved_budget: e.target.value })} /></div>
              <div><label>Actual expenditure (₹)</label>
                <input type="number" min="0" value={form.actual} onChange={(e) => setForm({ ...form, actual: e.target.value })} /></div>
              <div style={{ gridColumn: '1/-1' }}><label>Notes</label>
                <input value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            </div>
            <div style={{ marginTop: 10 }}>
              <b style={{ fontSize: 13 }}>Payments</b>
              <span className="muted mini"> — paid {inr(paidOf(form.payments))} · pending {inr(Math.max(0, (Number(form.actual) || 0) - paidOf(form.payments)))}</span>
              {(form.payments || []).map((p, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
                  <input type="date" value={p.date || ''} onChange={(e) => {
                    const payments = [...form.payments]; payments[i] = { ...p, date: e.target.value };
                    setForm({ ...form, payments });
                  }} />
                  <input type="number" min="0" placeholder="Amount ₹" style={{ width: 120 }} value={p.amt}
                    onChange={(e) => {
                      const payments = [...form.payments]; payments[i] = { ...p, amt: e.target.value };
                      setForm({ ...form, payments });
                    }} />
                  <input placeholder="note (advance / vendor…)" style={{ flex: 1 }} value={p.note || ''}
                    onChange={(e) => {
                      const payments = [...form.payments]; payments[i] = { ...p, note: e.target.value };
                      setForm({ ...form, payments });
                    }} />
                  <button className="btn link" type="button" onClick={() =>
                    setForm({ ...form, payments: form.payments.filter((_, j) => j !== i) })}>✕</button>
                </div>
              ))}
              <button className="btn" type="button" style={{ marginTop: 6 }}
                onClick={() => setForm({ ...form, payments: [...(form.payments || []), { date: '', amt: '', note: '' }] })}>+ Add payment</button>
            </div>
            {form.id && <div style={{ marginTop: 8 }}><label className="muted mini">Reason for this correction (audit trail, optional)</label>
              <input style={{ width: '100%' }} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></div>}
            {err && <p className="err">{err}</p>}
            <div className="form-actions">
              <button className="btn gold" type="submit">Save</button>
              <button className="btn" type="button" onClick={() => setForm(null)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {reqFor && (
        <div className="modal-backdrop" onClick={() => setReqFor(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <h3>Budget approval — {reqFor.ev.name}</h3>
            <div className="form-grid">
              <div><label>Approver *</label>
                <select value={reqFor.approver} onChange={(e) => setReqFor({ ...reqFor, approver: e.target.value })}>
                  <option value="">— choose —</option>
                  {approvers.map((a) => <option key={a.email} value={a.email}>{a.name} ({a.email})</option>)}
                </select></div>
              <div><label>Amount (₹) *</label>
                <input type="number" min="1" value={reqFor.amount} onChange={(e) => setReqFor({ ...reqFor, amount: e.target.value })} /></div>
            </div>
            <div style={{ marginTop: 8 }}><label>Note (optional)</label>
              <input style={{ width: '100%' }} value={reqFor.note} onChange={(e) => setReqFor({ ...reqFor, note: e.target.value })} /></div>
            <p className="muted mini" style={{ margin: '8px 0 0' }}>
              The approver gets the event details by e-mail with a secure approve/reject/clarify link.
              An approval records itself as this event's Approved budget.
            </p>
            {(reqFor.hist || []).length > 0 && (
              <div style={{ marginTop: 10 }}>
                <b style={{ fontSize: 13 }}>History</b>
                {reqFor.hist.map((h) => (
                  <div key={h.id} className="muted mini" style={{ padding: '3px 0' }}>
                    {(APR[h.status] || [h.status])[0]} · {inr(h.amount)} → {h.approver_name || h.approver_email}
                    {h.decision_comment ? ` · “${h.decision_comment}”` : ''} · {fmtDate(h.created_at)}
                  </div>
                ))}
              </div>
            )}
            {err && <p className="err">{err}</p>}
            <div className="form-actions">
              <button className="btn gold" disabled={!reqFor.approver || !(Number(reqFor.amount) > 0)} onClick={sendReq}>
                Send request for budget approval</button>
              <button className="btn" onClick={() => setReqFor(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
