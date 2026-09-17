/*
 * Avana Learning Hub — web server with Zoho SSO (OAuth 2.0 authorization code).
 *
 * Zoho authenticates the person (works for Zoho People and Zoho One accounts
 * alike); the app's own Users & Access list decides whether they may enter and
 * with which role. This server never sees passwords and never stores tokens —
 * it keeps only the verified e-mail in a signed, HttpOnly session cookie.
 *
 * Required environment variables (set in the hosting dashboard, never in git):
 *   ZOHO_CLIENT_ID      from api-console.zoho.in
 *   ZOHO_CLIENT_SECRET  from api-console.zoho.in  (keep secret)
 *   SESSION_SECRET      any long random string (cookie signing key)
 *   BASE_URL            https://academy.avanasurgical.com
 * Optional:
 *   ZOHO_ACCOUNTS       default https://accounts.zoho.in  (India data centre)
 *   PORT                default 8080
 */
const express = require('express');
const crypto = require('crypto');
const path = require('path');

const {
  ZOHO_CLIENT_ID,
  ZOHO_CLIENT_SECRET,
  SESSION_SECRET,
  BASE_URL = 'http://localhost:8080',
  ZOHO_ACCOUNTS = 'https://accounts.zoho.in',
  PORT = 8080,
} = process.env;

const SSO_READY = Boolean(ZOHO_CLIENT_ID && ZOHO_CLIENT_SECRET && SESSION_SECRET);
const SECURE = BASE_URL.startsWith('https');
const SESSION_HOURS = 12;

const app = express();
app.disable('x-powered-by');

/* ---------- tiny signed-cookie helpers (no extra dependencies) ---------- */
const sign = v => v + '.' + crypto.createHmac('sha256', SESSION_SECRET || 'dev').update(v).digest('base64url');
const unsign = s => {
  if (!s) return null;
  const i = s.lastIndexOf('.');
  if (i < 0) return null;
  const v = s.slice(0, i);
  try {
    return crypto.timingSafeEqual(Buffer.from(sign(v)), Buffer.from(s)) ? v : null;
  } catch (e) { return null; }
};
const cookies = req => {
  const o = {};
  (req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return o;
};
const setCookie = (res, name, val, { maxAge, httpOnly } = {}) => {
  let c = `${name}=${encodeURIComponent(val)}; Path=/; SameSite=Lax`;
  if (maxAge !== undefined) c += `; Max-Age=${maxAge}`;
  if (httpOnly) c += '; HttpOnly';
  if (SECURE) c += '; Secure';
  res.append('Set-Cookie', c);
};

const sessionEmail = req => {
  const raw = unsign(cookies(req).lh_sess);
  if (!raw) return null;
  const [email, exp] = raw.split('|');
  if (!email || !exp || Date.now() > Number(exp)) return null;
  return email;
};

/* ---------- auth routes ---------- */
app.get('/auth/zoho', (req, res) => {
  if (!SSO_READY) return res.status(503).send('Zoho SSO is not configured on this server yet.');
  const state = crypto.randomBytes(16).toString('base64url');
  setCookie(res, 'lh_state', sign(state), { maxAge: 600, httpOnly: true });
  const u = new URL(ZOHO_ACCOUNTS + '/oauth/v2/auth');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', ZOHO_CLIENT_ID);
  u.searchParams.set('scope', 'openid email profile');
  u.searchParams.set('redirect_uri', BASE_URL + '/auth/zoho/callback');
  u.searchParams.set('access_type', 'online');
  u.searchParams.set('state', state);
  res.redirect(u.toString());
});

app.get('/auth/zoho/callback', async (req, res) => {
  try {
    if (!SSO_READY) return res.status(503).send('Zoho SSO is not configured on this server yet.');
    const { code, state, error } = req.query;
    if (error) return res.redirect('/?sso_error=' + encodeURIComponent(String(error)));
    const expected = unsign(cookies(req).lh_state);
    setCookie(res, 'lh_state', '', { maxAge: 0, httpOnly: true });
    if (!code || !state || !expected || state !== expected) {
      return res.redirect('/?sso_error=state_mismatch');
    }
    const tokenRes = await fetch(ZOHO_ACCOUNTS + '/oauth/v2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: ZOHO_CLIENT_ID,
        client_secret: ZOHO_CLIENT_SECRET,
        redirect_uri: BASE_URL + '/auth/zoho/callback',
        code: String(code),
      }),
    });
    const tok = await tokenRes.json();
    if (!tokenRes.ok || tok.error) {
      console.error('zoho token error:', tok);
      return res.redirect('/?sso_error=token_exchange');
    }
    /* Preferred: e-mail claim from the ID token (delivered to us directly by
       Zoho over TLS in this same exchange, so decoding without a JWKS
       round-trip is acceptable here). Fallback: the userinfo endpoint. */
    let email = null;
    if (tok.id_token) {
      try {
        const payload = JSON.parse(Buffer.from(tok.id_token.split('.')[1], 'base64url').toString('utf8'));
        email = payload.email || null;
      } catch (e) { /* fall through */ }
    }
    if (!email && tok.access_token) {
      const uiRes = await fetch(ZOHO_ACCOUNTS + '/oauth/user/info', {
        headers: { Authorization: 'Zoho-oauthtoken ' + tok.access_token },
      });
      if (uiRes.ok) {
        const ui = await uiRes.json();
        email = ui.Email || ui.email || null;
      }
    }
    if (!email) return res.redirect('/?sso_error=no_email');
    const exp = Date.now() + SESSION_HOURS * 3600 * 1000;
    setCookie(res, 'lh_sess', sign(email.toLowerCase() + '|' + exp), {
      maxAge: SESSION_HOURS * 3600,
      httpOnly: true,
    });
    res.redirect('/');
  } catch (e) {
    console.error('zoho callback failed:', e);
    res.redirect('/?sso_error=server');
  }
});

app.get('/auth/logout', (req, res) => {
  setCookie(res, 'lh_sess', '', { maxAge: 0, httpOnly: true });
  res.redirect('/');
});

/* The front-end asks this on load. 200 + {sso:true} switches the sign-in
   screen to real Zoho SSO; on static hosting the request 404s and the
   simulated sign-in stays. */
app.get('/api/me', (req, res) => {
  res.json({ sso: true, configured: SSO_READY, email: sessionEmail(req) });
});

app.get('/healthz', (req, res) => res.send('ok'));

/* ---------- static app ---------- */
app.use(express.static(path.join(__dirname), { index: 'index.html', extensions: ['html'] }));

app.listen(PORT, () => {
  console.log(`Avana Learning Hub on :${PORT} — SSO ${SSO_READY ? 'configured' : 'NOT configured (set ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / SESSION_SECRET)'}`);
});
