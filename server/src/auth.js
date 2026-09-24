const crypto = require('crypto');
const { query } = require('./db');
const config = require('./config');

const SESSION_DAYS = 7;

// Only the SHA-256 of the session token is stored, so a DB leak exposes no
// usable sessions.
const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400 * 1000);
  await query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1,$2,$3)',
    [hash(token), userId, expires]);
  return { token, expires };
}

async function destroySession(token) {
  await query('DELETE FROM sessions WHERE token_hash=$1', [hash(token)]);
}

function setSessionCookie(res, token, expires) {
  res.cookie('session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.baseUrl.startsWith('https'),
    expires,
    path: '/',
  });
}

// THE access check. Every /api route (except auth) goes through here:
// valid unexpired session AND the user still active in Users & Access.
async function requireAuth(req, res, next) {
  try {
    const token = req.cookies.session;
    if (!token) return res.status(401).json({ error: 'Not signed in' });
    const { rows } = await query(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active = TRUE`,
      [hash(token)]);
    if (!rows.length) return res.status(401).json({ error: 'Session expired or access revoked' });
    req.user = rows[0];
    req.sessionToken = token;
    next();
  } catch (e) { next(e); }
}

const ROLE_RANK = { manager: 1, admin: 2, super_admin: 3 };

// requireRole('admin') = admin or super_admin.
const requireRole = (minRole) => (req, res, next) => {
  if (ROLE_RANK[req.user.role] >= ROLE_RANK[minRole]) return next();
  res.status(403).json({ error: 'Insufficient permissions' });
};

async function audit(userId, action, recordType, recordId, details, reason) {
  await query(
    'INSERT INTO audit_log (user_id, action, record_type, record_id, details, reason) VALUES ($1,$2,$3,$4,$5,$6)',
    [userId, action, recordType, recordId, details ? JSON.stringify(details) : null, reason || null]);
}

module.exports = { createSession, destroySession, setSessionCookie, requireAuth, requireRole, audit };
