import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fmtDate } from '../api.js';

// QR attendance page. The participant signs in with THEIR OWN Zoho account —
// nobody can mark attendance for someone else.
export default function PublicCheckin() {
  const { token } = useParams();
  const [t, setT] = useState(null);
  const [day, setDay] = useState('');
  const [done, setDone] = useState(null);   // {name, at}
  const [err, setErr] = useState(null);
  const denied = new URLSearchParams(location.search).get('denied');

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

  const loginUrl = '/auth/zoho?ret=' + encodeURIComponent('/p/att/' + token);

  const checkIn = async () => {
    setErr(null);
    try {
      const r = await fetch('/api/public/att/' + token, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin', body: JSON.stringify({ day }),
      });
      const d = await r.json();
      if (!r.ok) {
        if (d.need_login) { location.href = loginUrl; return; }
        throw new Error(d.error || 'Check-in failed');
      }
      setDone(d);
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
            <p className="muted" style={{ fontSize: 13 }}>
              {done.name} · {t.code} · {fmtDate(day)}<br />
              {new Date(done.at).toLocaleString('en-IN')}
            </p>
            <p className="muted mini">Marked Present and tagged to {t.title}.</p>
          </div>
        )}
        {t && !done && (
          <>
            <p className="login-sub" style={{ textAlign: 'center' }}>
              QR check-in · <b>{t.title}{t.batch ? ' — ' + t.batch : ''}</b>
            </p>
            {denied && (
              <p className="login-err">
                Zoho verified <b>{denied}</b>, but no employee record matches that e-mail.
                Ask L&amp;D to check your e-mail on the employee master.
              </p>
            )}
            {!t.me ? (
              <>
                <p className="muted" style={{ fontSize: 13 }}>
                  Sign in with your own Zoho account (Zoho People for AMD/ATS, Zoho One for ASS).
                  Your identity comes from Zoho — attendance can only be marked as yourself.
                </p>
                {t.sso
                  ? <a className="btn-primary" style={{ textAlign: 'center', textDecoration: 'none' }} href={loginUrl}>Sign in with Zoho to check in</a>
                  : <p className="login-err">Zoho sign-in is not configured on this server.</p>}
              </>
            ) : !t.me.assigned ? (
              <p className="login-err">
                You are signed in as <b>{t.me.name}</b>, but you are not assigned to this
                training — contact the organizer to be added.
              </p>
            ) : (
              <>
                <p style={{ fontSize: 13 }}>You are <b>{t.me.name}</b> ✓ (verified by Zoho)</p>
                <label className="muted mini">Session day</label>
                <select style={{ width: '100%', margin: '4px 0 16px' }} value={day} onChange={(e) => setDay(e.target.value)}>
                  {(t.days || []).map((d) => <option key={d} value={d.slice(0, 10)}>{fmtDate(d)}</option>)}
                </select>
                {err && <p className="login-err">{err}</p>}
                <button className="btn-primary" disabled={!day} onClick={checkIn}>✓ Check in</button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
