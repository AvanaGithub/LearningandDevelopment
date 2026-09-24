const express = require('express');
const crypto = require('crypto');
const { query } = require('../db');
const config = require('../config');
const zoho = require('../zoho');
const { createSession, destroySession, setSessionCookie, requireAuth, audit } = require('../auth');

const router = express.Router();
const pendingStates = new Map(); // state -> expiry (OAuth CSRF protection)

setInterval(() => {
  const now = Date.now();
  for (const [s, exp] of pendingStates) if (exp < now) pendingStates.delete(s);
}, 60000).unref();

// Step 1: send the user to Zoho.
router.get('/zoho', (req, res) => {
  if (!config.zoho.configured) return res.status(503).send('Zoho SSO is not configured on this server.');
  const state = crypto.randomBytes(16).toString('base64url');
  pendingStates.set(state, Date.now() + 10 * 60000);
  res.redirect(zoho.buildAuthUrl(state));
});

// Step 2: Zoho redirects back. Identity comes from Zoho; ACCESS is decided
// here, server-side, against the users table.
router.get('/zoho/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;
    if (error) return res.redirect('/login?error=' + encodeURIComponent(String(error)));
    if (!code || !state || !pendingStates.has(state)) return res.redirect('/login?error=state_mismatch');
    pendingStates.delete(state);

    const tokens = await zoho.exchangeCode(String(code));
    const who = await zoho.fetchIdentity(tokens);

    const { rows } = await query('SELECT * FROM users WHERE email=$1', [who.email]);
    if (!rows.length || !rows[0].active) {
      // Not provisioned (or deactivated): no session. Show who Zoho verified
      // so an admin knows exactly which address to add.
      return res.redirect('/login?denied=' + encodeURIComponent(who.email));
    }
    const user = rows[0];
    await query(
      `UPDATE users SET last_login_at=now(), updated_at=now(),
         zoho_user_id=COALESCE(zoho_user_id,$2) WHERE id=$1`,
      [user.id, who.zohoUserId]);

    const { token, expires } = await createSession(user.id);
    setSessionCookie(res, token, expires);
    res.redirect('/');
  } catch (e) {
    console.error('[auth] zoho callback failed:', e.message);
    res.redirect('/login?error=server');
  }
});

// Dev-only login without a password (DEV_LOGIN=true, never in production).
router.post('/dev-login', express.json(), async (req, res) => {
  if (!config.devLogin || config.isProd) return res.status(404).json({ error: 'Disabled' });
  const email = String(req.body.email || '').toLowerCase();
  const { rows } = await query('SELECT * FROM users WHERE email=$1 AND active=TRUE', [email]);
  if (!rows.length) return res.status(401).json({ error: 'Unknown user' });
  const { token, expires } = await createSession(rows[0].id);
  setSessionCookie(res, token, expires);
  res.json({ ok: true });
});

router.post('/logout', requireAuth, async (req, res) => {
  await destroySession(req.sessionToken);
  res.clearCookie('session');
  await audit(req.user.id, 'auth.logout', 'user', req.user.id);
  res.json({ ok: true });
});

// Who am I? Also tells the login screen whether SSO is configured.
router.get('/me', async (req, res) => {
  const token = req.cookies.session;
  const base = { ssoConfigured: config.zoho.configured, devLogin: config.devLogin && !config.isProd };
  if (!token) return res.json({ ...base, user: null });
  const crypto2 = require('crypto');
  const hash = crypto2.createHash('sha256').update(token).digest('hex');
  const { rows } = await query(
    `SELECT u.id, u.email, u.name, u.role, u.entity FROM sessions s
     JOIN users u ON u.id=s.user_id
     WHERE s.token_hash=$1 AND s.expires_at > now() AND u.active=TRUE`, [hash]);
  res.json({ ...base, user: rows[0] || null });
});

module.exports = router;
