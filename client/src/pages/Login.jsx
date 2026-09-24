import React, { useState } from 'react';
import { useAuth } from '../App.jsx';

export default function Login() {
  const { ssoConfigured, devLogin, refresh } = useAuth();
  const params = new URLSearchParams(window.location.search);
  const denied = params.get('denied');
  const error = params.get('error');
  const [devMail, setDevMail] = useState('');
  const [devErr, setDevErr] = useState(null);

  const devSignIn = async (e) => {
    e.preventDefault();
    setDevErr(null);
    const r = await fetch('/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ email: devMail }),
    });
    if (r.ok) refresh();
    else setDevErr((await r.json()).error || 'Sign-in failed');
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>Learning Hub</h1>
        <p className="login-sub">Learning &amp; Development · Avana Group</p>
        {ssoConfigured ? (
          <a className="btn-primary" style={{ textDecoration: 'none' }} href="/auth/zoho">Sign in with Zoho</a>
        ) : (
          <p className="err">Zoho SSO is not configured on this server yet.</p>
        )}
        <p className="login-hint">
          You will be redirected to Zoho and sign in with your usual Zoho account
          (AMD &amp; ATS via Zoho People, ASS via Zoho One). Access follows the
          Users &amp; Access list.
        </p>
        {denied && (
          <div className="login-err">
            Zoho verified <strong>{denied}</strong>, but this e-mail is not in
            Users &amp; Access (or is disabled). Ask an administrator to add it.
          </div>
        )}
        {error && (
          <div className="login-err">Zoho sign-in did not complete ({error}) — please try again.</div>
        )}
        {devLogin && (
          <form onSubmit={devSignIn} style={{ marginTop: 18, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
            <p className="login-hint" style={{ marginTop: 0 }}>Development sign-in (no password)</p>
            <input value={devMail} onChange={(e) => setDevMail(e.target.value)}
              placeholder="name@avanasurgical.com" style={{ width: '100%', marginBottom: 8 }} />
            <button className="btn" type="submit">Dev sign in</button>
            {devErr && <p className="err">{devErr}</p>}
          </form>
        )}
      </div>
    </div>
  );
}
