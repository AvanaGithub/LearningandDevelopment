import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

// Assessment QR / share link: names the assessment, then forwards the
// participant to its Microsoft Form (sign-in there records who answered).
export default function PublicAssessment() {
  const { token } = useParams();
  const [a, setA] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    fetch('/api/public/assessment/' + token)
      .then((r) => r.json().then((d) => (r.ok ? d : Promise.reject(new Error(d.error)))))
      .then(setA)
      .catch((e) => setErr(e.message));
  }, [token]);

  useEffect(() => {
    if (a?.external_form_url) {
      const id = setTimeout(() => { location.href = a.external_form_url; }, 800);
      return () => clearTimeout(id);
    }
  }, [a]);

  return (
    <div className="login-wrap">
      <div className="login-card" style={{ textAlign: 'center', maxWidth: 440 }}>
        <h1 style={{ fontSize: 18 }}>Avana Learning Hub</h1>
        {!a && !err && <p className="muted">Loading…</p>}
        {err && <p className="login-err">{err}</p>}
        {a && (
          <>
            <p className="login-sub">
              Assessment · <b>{a.name}</b><br />
              <span className="muted">{a.title}{a.batch ? ' — ' + a.batch : ''}</span>
            </p>
            {a.external_form_url ? (
              <>
                <p style={{ fontSize: 13 }} className="muted">Taking you to the assessment…</p>
                <a className="btn-primary" style={{ textDecoration: 'none' }} href={a.external_form_url}>Open the assessment</a>
                <p className="muted mini" style={{ marginTop: 10 }}>
                  Sign in with your Avana Microsoft account when asked — that is how your score is matched to you.
                </p>
              </>
            ) : (
              <p className="login-err">This assessment isn't open yet — please check with the L&amp;D team.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
