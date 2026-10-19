import React, { useEffect, useState } from 'react';
import { api, fmtDate } from '../api.js';
import { useSettings, useToast } from '../App.jsx';

const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
export const APR_STATUS = {
  pending: ['Pending approval', 'warn'], approved: ['Approved', 'good'],
  rejected: ['Rejected', 'crit'], clarify: ['Clarification requested', 'warn'],
  superseded: ['Superseded', 'soft'],
};

// "Send request for budget approval" on a training: pick Vivek/Sundar,
// enter the amount + note, send — then track every request and decision.
export default function BudgetApproval({ t, onClose }) {
  const { settings } = useSettings();
  const toast = useToast();
  const approvers = settings?.budget_approvers || [];
  const [hist, setHist] = useState(null);
  const [approver, setApprover] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const load = () => api.get('/api/budget/training/' + t.id).then(setHist).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [t.id]);

  const current = (hist || []).find((h) => h.status !== 'superseded');
  const canSend = !current || ['rejected', 'clarify', 'pending'].includes(current.status);

  const send = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.post(`/api/budget/training/${t.id}/request`, {
        approver_email: approver, amount: Number(amount), note,
      });
      if (r.mail_ok) toast(`Request sent to ${r.approver_name || r.approver_email} — they can decide from the e-mail link.`);
      else setErr(`The request is saved, but the e-mail could not be sent: ${r.mail_error}. Check Settings → E-mail notifications, then send again.`);
      setAmount(''); setNote('');
      load();
    } catch (e2) { setErr(e2.message); }
    setBusy(false);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 620 }}>
        <h3>Budget approval — {t.title}{t.batch ? ' — ' + t.batch : ''}</h3>
        {current && (
          <p style={{ margin: '4px 0 10px' }}>
            Current status:{' '}
            <span className={'pill ' + APR_STATUS[current.status][1]}>{APR_STATUS[current.status][0]}</span>{' '}
            <b>{inr(current.amount)}</b> · {current.approver_name || current.approver_email}
            {current.decided_at && <span className="muted mini"> · {new Date(current.decided_at).toLocaleString('en-IN')}</span>}
            {current.decision_comment && <><br /><span className="muted mini">“{current.decision_comment}”</span></>}
          </p>
        )}
        {canSend && (
          <div className="card" style={{ padding: 12, marginBottom: 12 }}>
            <div className="form-grid">
              <div><label>Approver *</label>
                <select value={approver} onChange={(e) => setApprover(e.target.value)}>
                  <option value="">— choose —</option>
                  {approvers.map((a) => <option key={a.email} value={a.email}>{a.name} ({a.email})</option>)}
                </select></div>
              <div><label>Budget amount (₹) *</label>
                <input type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 150000" /></div>
            </div>
            <div style={{ marginTop: 8 }}><label>Note to the approver (optional)</label>
              <input style={{ width: '100%' }} value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. External trainer + venue for 2 days, 25 participants" /></div>
            <p className="muted mini" style={{ margin: '8px 0 0' }}>
              The approver gets the full training details and budget by e-mail with a secure link to
              approve, reject or ask for clarification — no sign-in needed. You'll get the decision
              summary by mail, ready to share with Accounts.
              {current?.status === 'pending' && <b> Sending again replaces the pending request.</b>}
            </p>
            {err && <p className="err">{err}</p>}
            <div className="form-actions">
              <button className="btn gold" disabled={busy || !approver || !(Number(amount) > 0)} onClick={send}>
                {busy ? 'Sending…' : 'Send request for budget approval'}</button>
            </div>
          </div>
        )}
        {hist && hist.length > 0 && (
          <>
            <h4 style={{ fontSize: 13, margin: '6px 0' }}>History</h4>
            {hist.map((h) => (
              <div key={h.id} style={{ fontSize: 13, padding: '6px 0', borderBottom: '1px dashed var(--line)' }}>
                <span className={'pill mini ' + APR_STATUS[h.status][1]}>{APR_STATUS[h.status][0]}</span>{' '}
                <b>{inr(h.amount)}</b> → {h.approver_name || h.approver_email}
                <span className="muted mini"> · requested {fmtDate(h.created_at)} by {h.requester_name || '—'}
                  {h.decided_at ? ` · decided ${new Date(h.decided_at).toLocaleString('en-IN')}` : ''}</span>
                {h.note && <div className="muted mini">Note: {h.note}</div>}
                {h.decision_comment && <div className="muted mini">Comments: “{h.decision_comment}”</div>}
              </div>
            ))}
          </>
        )}
        {hist && !hist.length && !err && <p className="muted mini">No budget request sent for this training yet.</p>}
        <div className="form-actions"><button className="btn" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}
