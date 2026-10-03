import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fmtDate, fmtRange } from '../api.js';

// Self-nomination page — the employee is identified by their own Zoho
// sign-in; the super admin controls whether it is open and who is eligible.
export default function PublicNominate() {
  const { token } = useParams();
  const [t, setT] = useState(null);
  const [slot, setSlot] = useState('');
  const [done, setDone] = useState(null);
  const [err, setErr] = useState(null);
  const denied = new URLSearchParams(location.search).get('denied');

  useEffect(() => {
    fetch('/api/public/training/' + token)
      .then((r) => r.json().then((d) => (r.ok ? d : Promise.reject(new Error(d.error)))))
      .then(setT)
      .catch((e) => setErr(e.message));
  }, [token]);

  const loginUrl = '/auth/zoho?ret=' + encodeURIComponent('/p/nom/' + token);

  const nominate = async () => {
    setErr(null);
    try {
      const r = await fetch('/api/public/nom/' + token, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin', body: JSON.stringify({ slot }),
      });
      const d = await r.json();
      if (!r.ok) {
        if (d.need_login) { location.href = loginUrl; return; }
        throw new Error(d.error || 'Could not nominate');
      }
      setDone(d);
    } catch (e) { setErr(e.message); }
  };

  return (
    <div className="login-wrap">
      <div className="login-card" style={{ textAlign: 'left', maxWidth: 460 }}>
        <h1 style={{ fontSize: 18, textAlign: 'center' }}>Avana Learning Hub</h1>
        {!t && !err && <p className="muted" style={{ textAlign: 'center' }}>Loading…</p>}
        {err && !t && <p className="login-err">{err}</p>}
        {t && done && (
          <div style={{ textAlign: 'center', padding: '14px 0' }}>
            <div style={{ fontSize: 52, color: 'var(--good)' }}>✓</div>
            <h2 style={{ fontSize: 17, margin: '8px 0 2px' }}>You are nominated!</h2>
            <p className="muted mini">{done.name} · {t.title}{slot ? ` · preferred slot ${slot}` : ''} — L&amp;D sees your nomination immediately.</p>
          </div>
        )}
        {t && !done && (
          <>
            <p className="login-sub" style={{ textAlign: 'center' }}>
              Nomination · <b>{t.title}{t.batch ? ' — ' + t.batch : ''}</b>
            </p>
            <p className="muted mini" style={{ textAlign: 'center' }}>
              {fmtRange(t.days)}{t.nominate.scope ? ` · for: ${t.nominate.scope}` : ''}
              {t.nominate.deadline ? ` · nominate by ${fmtDate(t.nominate.deadline)}` : ''}
            </p>
            {denied && (
              <p className="login-err">
                Zoho verified <b>{denied}</b>, but no employee record matches that e-mail — contact L&amp;D.
              </p>
            )}
            {!t.nominate.open ? (
              <p className="login-err">Self-nomination is not open for this training{t.nominate.deadline ? ' (the deadline has passed)' : ''} — contact L&amp;D.</p>
            ) : !t.me ? (
              t.sso
                ? <a className="btn-primary" style={{ textAlign: 'center', textDecoration: 'none' }} href={loginUrl}>Sign in with Zoho to nominate yourself</a>
                : <p className="login-err">Zoho sign-in is not configured on this server.</p>
            ) : t.me.assigned ? (
              <p style={{ fontSize: 13 }}><b>{t.me.name}</b> — you are already on this training ✓</p>
            ) : t.nominate.eligible === false ? (
              <p className="login-err">This training targets {t.nominate.scope} — your profile is outside it. Contact L&amp;D if you believe you should attend.</p>
            ) : (
              <>
                <p style={{ fontSize: 13 }}>Nominating as <b>{t.me.name}</b> ✓ (verified by Zoho)</p>
                {(t.days || []).length > 1 && (
                  <div style={{ margin: '8px 0' }}>
                    <label className="muted mini">Preferred slot / day (optional)</label>
                    <select style={{ width: '100%', marginTop: 4 }} value={slot} onChange={(e) => setSlot(e.target.value)}>
                      <option value="">Any day</option>
                      {t.days.map((d) => <option key={d} value={fmtDate(d)}>{fmtDate(d)}</option>)}
                    </select>
                  </div>
                )}
                {err && <p className="login-err">{err}</p>}
                <button className="btn-primary" onClick={nominate}>Nominate myself</button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
