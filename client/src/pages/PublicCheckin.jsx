import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fmtDay, fmtDate } from '../api.js';

// Phone page opened by scanning a training's attendance QR. No sign-in:
// the unguessable link identifies the training; the participant confirms
// who they are and is marked Present for the chosen day.
export default function PublicCheckin() {
  const { token } = useParams();
  const [t, setT] = useState(null);
  const [emp, setEmp] = useState('');
  const [day, setDay] = useState('');
  const [done, setDone] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    fetch('/api/public/training/' + token)
      .then((r) => r.json().then((d) => (r.ok ? d : Promise.reject(new Error(d.error)))))
      .then((d) => {
        setT(d);
        const today = new Date().toISOString().slice(0, 10);
        const days = (d.days || []).map((x) => x.slice(0, 10));
        setDay(days.includes(today) ? today : days[0] || '');
      })
      .catch((e) => setErr(e.message));
  }, [token]);

  const checkIn = async () => {
    setErr(null);
    try {
      const r = await fetch('/api/public/att/' + token, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: Number(emp), day }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Check-in failed');
      setDone((t.participants.find((p) => p.id === Number(emp)) || {}).name);
    } catch (e) { setErr(e.message); }
  };

  return (
    <div className="login-wrap">
      <div className="login-card" style={{ textAlign: 'left' }}>
        <h1 style={{ fontSize: 18, textAlign: 'center' }}>Avana Learning Hub</h1>
        {!t && !err && <p className="muted" style={{ textAlign: 'center' }}>Loading…</p>}
        {err && !t && <p className="login-err">{err}</p>}
        {t && done && (
          <div style={{ textAlign: 'center', padding: '14px 0' }}>
            <div style={{ fontSize: 52, color: 'var(--good)' }}>✓</div>
            <h2 style={{ fontSize: 17, margin: '8px 0 2px' }}>Checked in!</h2>
            <p className="muted" style={{ fontSize: 13 }}>{done} · {t.code} · {fmtDate(day)}</p>
            <p className="muted mini">Your attendance is marked Present and tagged to {t.title}.</p>
          </div>
        )}
        {t && !done && (
          <>
            <p className="login-sub" style={{ textAlign: 'center' }}>
              QR check-in · <b>{t.title}{t.batch ? ' — ' + t.batch : ''}</b>
            </p>
            <label className="muted mini">Session day</label>
            <select style={{ width: '100%', margin: '4px 0 12px' }} value={day} onChange={(e) => setDay(e.target.value)}>
              {(t.days || []).map((d) => <option key={d} value={d.slice(0, 10)}>{fmtDate(d)}</option>)}
            </select>
            <label className="muted mini">I am</label>
            <select style={{ width: '100%', margin: '4px 0 16px' }} value={emp} onChange={(e) => setEmp(e.target.value)}>
              <option value="">— select your name —</option>
              {(t.participants || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {!t.participants?.length && <p className="login-err">No participants are assigned to this training yet.</p>}
            {err && <p className="login-err">{err}</p>}
            <button className="btn-primary" disabled={!emp || !day} onClick={checkIn}>✓ Check in</button>
            <p className="login-hint">Only employees assigned to {t.code} can check in. The organizer sees your mark instantly.</p>
          </>
        )}
      </div>
    </div>
  );
}
