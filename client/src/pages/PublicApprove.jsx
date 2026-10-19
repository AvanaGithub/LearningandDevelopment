import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fmtDate } from '../api.js';

const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
const STATUS = {
  approved: ['Approved', '#1a7f37'], rejected: ['Rejected', '#c62828'],
  clarify: ['Clarification requested', '#b58a00'],
  superseded: ['Superseded by a newer request', '#8a7a5c'],
};

// Budget approval page reached from the e-mail's secure link — the token
// is the credential, so the approver needs no sign-in.
export default function PublicApprove() {
  const { token } = useParams();
  const [a, setA] = useState(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    fetch('/api/public/approval/' + token)
      .then((r) => r.json().then((d) => (r.ok ? d : Promise.reject(new Error(d.error)))))
      .then(setA)
      .catch((e) => setErr(e.message));
  }, [token]);

  const decide = async (action, label) => {
    if (action === 'approved' && !confirm(`Approve ${inr(a.amount)} for "${a.title}"?`)) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch('/api/public/approval/' + token, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, comment }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not record the decision');
      setDone({ action, label });
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  const dates = a && (a.first_day
    ? (a.first_day === a.last_day ? fmtDate(a.first_day) : `${fmtDate(a.first_day)} → ${fmtDate(a.last_day)}`)
    : 'dates to be announced');

  const Row = ({ k, children }) => (
    <tr><td style={{ padding: '3px 14px 3px 0', color: 'var(--muted, #8a7a5c)', verticalAlign: 'top', whiteSpace: 'nowrap' }}>{k}</td><td>{children}</td></tr>
  );

  return (
    <div className="login-wrap">
      <div className="login-card" style={{ textAlign: 'left', maxWidth: 480 }}>
        <h1 style={{ fontSize: 18, textAlign: 'center' }}>Avana Learning Hub</h1>
        <p className="login-sub" style={{ textAlign: 'center' }}>{a?.is_od ? 'OD event budget approval' : 'Training budget approval'}</p>
        {!a && !err && <p className="muted" style={{ textAlign: 'center' }}>Loading…</p>}
        {err && !a && <p className="login-err">{err}</p>}
        {a && done && (
          <div style={{ textAlign: 'center', padding: '14px 0' }}>
            <div style={{ fontSize: 52, color: done.action === 'approved' ? 'var(--good, #1a7f37)' : '#b58a00' }}>✓</div>
            <h2 style={{ fontSize: 17, margin: '8px 0 2px' }}>{done.label} — recorded</h2>
            <p className="muted mini">{a.requester_name || 'The requester'} has been notified by e-mail. You can close this page.</p>
          </div>
        )}
        {a && !done && (
          <>
            <table style={{ fontSize: 14, margin: '6px 0 10px' }}>
              <tbody>
                <Row k={a.is_od ? 'OD event' : 'Training'}><b>{a.title}{a.batch ? ' — ' + a.batch : ''}</b>{!a.is_od && <span className="muted mini"> ({a.code})</span>}</Row>
                <Row k="Dates">{dates}</Row>
                {a.location && <Row k="Location">{a.location}</Row>}
                {a.mode && <Row k="Mode">{a.mode}</Row>}
                {a.trainer_name && <Row k="Trainer">{a.trainer_name}{a.agency ? ' · ' + a.agency : ''}</Row>}
                <Row k={a.is_od ? 'Employees' : 'Participants'}>{a.participants}</Row>
                <Row k="Requested budget"><b style={{ fontSize: 17 }}>{inr(a.amount)}</b></Row>
                {a.note && <Row k="Note">{a.note}</Row>}
                <Row k="Requested by">{a.requester_name || '—'} · {new Date(a.created_at).toLocaleDateString('en-IN')}</Row>
              </tbody>
            </table>
            {a.status !== 'pending' ? (
              <p style={{ fontWeight: 600, color: (STATUS[a.status] || [])[1] }}>
                {(STATUS[a.status] || [a.status])[0]}
                {a.decided_at ? ` · ${new Date(a.decided_at).toLocaleString('en-IN')}` : ''}
                {a.decision_comment ? <><br /><span style={{ fontWeight: 400 }}>“{a.decision_comment}”</span></> : null}
              </p>
            ) : (
              <>
                <label style={{ fontSize: 13 }}>Comments (required to reject / ask for clarification)</label>
                <textarea rows={3} style={{ width: '100%', fontFamily: 'inherit', fontSize: 13, marginTop: 4 }}
                  value={comment} onChange={(e) => setComment(e.target.value)}
                  placeholder="e.g. Approved within Q3 budget / please split venue vs trainer cost…" />
                {err && <p className="login-err">{err}</p>}
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <button className="btn-primary" disabled={busy} style={{ background: '#1a7f37' }}
                    onClick={() => decide('approved', 'Approved')}>✓ Approve</button>
                  <button className="btn" disabled={busy}
                    onClick={() => decide('clarify', 'Clarification requested')}>Request clarification</button>
                  <button className="btn" disabled={busy} style={{ color: '#c62828' }}
                    onClick={() => decide('rejected', 'Rejected')}>✕ Reject</button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
