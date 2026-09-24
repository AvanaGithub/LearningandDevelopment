import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

// QR feedback page — the respondent is identified by their own Zoho sign-in.
export default function PublicFeedback() {
  const { token } = useParams();
  const [t, setT] = useState(null);
  const [scores, setScores] = useState({});
  const [comment, setComment] = useState('');
  const [done, setDone] = useState(null);
  const [err, setErr] = useState(null);
  const denied = new URLSearchParams(location.search).get('denied');

  useEffect(() => {
    fetch('/api/public/training/' + token)
      .then((r) => r.json().then((d) => (r.ok ? d : Promise.reject(new Error(d.error)))))
      .then(setT)
      .catch((e) => setErr(e.message));
  }, [token]);

  const loginUrl = '/auth/zoho?ret=' + encodeURIComponent('/p/fb/' + token);

  const submit = async () => {
    setErr(null);
    try {
      const r = await fetch('/api/public/fb/' + token, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin', body: JSON.stringify({ scores, comment }),
      });
      const d = await r.json();
      if (!r.ok) {
        if (d.need_login) { location.href = loginUrl; return; }
        throw new Error(d.error || 'Could not submit');
      }
      setDone(d);
    } catch (e) { setErr(e.message); }
  };

  const complete = t && t.questions.every((q, i) => scores[i] >= 1);

  return (
    <div className="login-wrap">
      <div className="login-card" style={{ textAlign: 'left', maxWidth: 460 }}>
        <h1 style={{ fontSize: 18, textAlign: 'center' }}>Avana Learning Hub</h1>
        {!t && !err && <p className="muted" style={{ textAlign: 'center' }}>Loading…</p>}
        {err && !t && <p className="login-err">{err}</p>}
        {t && done && (
          <div style={{ textAlign: 'center', padding: '14px 0' }}>
            <div style={{ fontSize: 52, color: 'var(--good)' }}>✓</div>
            <h2 style={{ fontSize: 17, margin: '8px 0 2px' }}>Feedback submitted!</h2>
            <p className="muted mini">{done.name} · {new Date(done.at).toLocaleString('en-IN')} · tagged to {t.title}.</p>
          </div>
        )}
        {t && !done && (
          <>
            <p className="login-sub" style={{ textAlign: 'center' }}>
              Feedback · <b>{t.title}{t.batch ? ' — ' + t.batch : ''}</b>
            </p>
            {denied && (
              <p className="login-err">
                Zoho verified <b>{denied}</b>, but no employee record matches that e-mail — contact L&amp;D.
              </p>
            )}
            {!t.me ? (
              t.sso
                ? <a className="btn-primary" style={{ textAlign: 'center', textDecoration: 'none' }} href={loginUrl}>Sign in with Zoho to give feedback</a>
                : <p className="login-err">Zoho sign-in is not configured on this server.</p>
            ) : (
              <>
                <p style={{ fontSize: 13 }}>Responding as <b>{t.me.name}</b> ✓ (verified by Zoho)</p>
                {t.questions.map((q, i) => (
                  <div key={i} style={{ padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
                    <div style={{ fontSize: 13, marginBottom: 6 }}>{q}</div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {[1, 2, 3, 4, 5].map((v) => (
                        <button key={v} type="button" className="btn" style={scores[i] === v
                          ? { background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' } : {}}
                          onClick={() => setScores({ ...scores, [i]: v })}>{v}</button>
                      ))}
                    </div>
                  </div>
                ))}
                <input style={{ width: '100%', margin: '10px 0' }} placeholder="What should be improved? (optional)"
                  value={comment} onChange={(e) => setComment(e.target.value)} />
                {err && <p className="login-err">{err}</p>}
                <button className="btn-primary" disabled={!complete} onClick={submit}>Submit feedback</button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
