const express = require('express');
const crypto = require('crypto');
const { query } = require('../db');
const config = require('../config');
const zoho = require('../zoho');
const { createSession, destroySession, setSessionCookie, requireAuth, audit } = require('../auth');

const router = express.Router();
const pendingStates = new Map(); // state -> {exp, ret} (CSRF + participant return path)

setInterval(() => {
  const now = Date.now();
  for (const [s, v] of pendingStates) if (v.exp < now) pendingStates.delete(s);
}, 60000).unref();

const sha256 = (t) => crypto.createHash('sha256').update(t).digest('hex');
// Only QR participant pages are valid return targets for the participant flow.
const validRet = (r) => (typeof r === 'string' && /^\/p\/(att|fb)\/[\w-]{6,64}$/.test(r) ? r : null);

// Step 1: send the user to Zoho. With ?ret=/p/att/<token> this is the
// PARTICIPANT flow: Zoho proves who is scanning; no portal session is made.
router.get('/zoho', (req, res) => {
  if (!config.zoho.configured) return res.status(503).send('Zoho SSO is not configured on this server.');
  const state = crypto.randomBytes(16).toString('base64url');
  pendingStates.set(state, { exp: Date.now() + 10 * 60000, ret: validRet(req.query.ret) });
  res.redirect(zoho.buildAuthUrl(state));
});

// Step 2: Zoho redirects back. Identity comes from Zoho; ACCESS is decided
// here, server-side, against the users table.
router.get('/zoho/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;
    if (error) return res.redirect('/login?error=' + encodeURIComponent(String(error)));
    const st = pendingStates.get(state);
    if (!code || !state || !st) return res.redirect('/login?error=state_mismatch');
    pendingStates.delete(state);

    const tokens = await zoho.exchangeCode(String(code));
    const who = await zoho.fetchIdentity(tokens);

    if (st.ret) {
      // Participant flow: match the verified e-mail to an EMPLOYEE and set a
      // participant cookie, then bounce back to the QR page.
      const { rows: emp } = await query(
        'SELECT id, name FROM employees WHERE email=$1 AND active=TRUE', [who.email]);
      if (!emp.length) return res.redirect(st.ret + '?denied=' + encodeURIComponent(who.email));
      const ptoken = crypto.randomBytes(32).toString('base64url');
      const exp = new Date(Date.now() + 12 * 3600 * 1000);
      await query('INSERT INTO participant_sessions (token_hash, employee_id, expires_at) VALUES ($1,$2,$3)',
        [sha256(ptoken), emp[0].id, exp]);
      res.cookie('psession', ptoken, {
        httpOnly: true, sameSite: 'lax',
        secure: config.baseUrl.startsWith('https'), expires: exp, path: '/',
      });
      await audit(null, 'participant.login', 'employee', emp[0].id, { email: who.email });
      return res.redirect(st.ret);
    }

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

// "View as" preview: a real super admin lowers this session's effective
// role to manager/admin for testing; null returns to super admin. It can
// never raise privileges, and every switch is audited.
router.post('/view-as', requireAuth, express.json(), async (req, res) => {
  if (req.user.real_role !== 'super_admin') {
    return res.status(403).json({ error: 'Only a super admin can preview another role' });
  }
  const role = req.body?.role ?? null;
  if (role !== null && !['manager', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'role must be manager, admin or null' });
  }
  await query('UPDATE sessions SET act_role=$2 WHERE token_hash=$1', [sha256(req.sessionToken), role]);
  await audit(req.user.id, 'auth.view_as', 'user', req.user.id, { role: role || 'super_admin (exit preview)' });
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
    `SELECT u.id, u.email, u.name, u.role, u.entity, s.act_role FROM sessions s
     JOIN users u ON u.id=s.user_id
     WHERE s.token_hash=$1 AND s.expires_at > now() AND u.active=TRUE`, [hash]);
  let user = rows[0] || null;
  if (user) {
    user = { ...user, real_role: user.role };
    if (user.act_role && user.role === 'super_admin' && ['manager', 'admin'].includes(user.act_role)) {
      user.role = user.act_role;
    }
    delete user.act_role;
  }
  res.json({ ...base, user });
});

module.exports = router;
