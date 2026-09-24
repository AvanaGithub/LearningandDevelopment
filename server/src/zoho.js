const config = require('./config');

// Zoho Accounts OAuth 2.0 (authorization code). Account-level: works for
// Zoho One (ASS) and Zoho People-only (AMD/ATS) users alike.

function buildAuthUrl(state) {
  const p = new URLSearchParams({
    response_type: 'code',
    client_id: config.zoho.clientId,
    scope: 'openid email profile',
    redirect_uri: config.zoho.redirectUri,
    access_type: 'online',
    state,
  });
  return `${config.zoho.accountsBase}/oauth/v2/auth?${p.toString()}`;
}

async function exchangeCode(code) {
  const res = await fetch(`${config.zoho.accountsBase}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.zoho.clientId,
      client_secret: config.zoho.clientSecret,
      redirect_uri: config.zoho.redirectUri,
      code,
    }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(`Zoho token exchange failed: ${data.error || res.status}`);
  return data;
}

// E-mail from the ID token (delivered directly to us by Zoho over TLS in the
// token exchange, so local decoding is fine), falling back to userinfo.
async function fetchIdentity(tokens) {
  if (tokens.id_token) {
    try {
      const payload = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString('utf8'));
      if (payload.email) {
        return {
          email: payload.email.toLowerCase(),
          zohoUserId: payload.sub ? String(payload.sub) : null,
          name: payload.name || null,
        };
      }
    } catch (e) { /* fall through to userinfo */ }
  }
  const res = await fetch(`${config.zoho.accountsBase}/oauth/user/info`, {
    headers: { Authorization: `Zoho-oauthtoken ${tokens.access_token}` },
  });
  if (!res.ok) throw new Error(`Zoho userinfo failed: ${res.status}`);
  const data = await res.json();
  const email = (data.Email || data.email || '').toLowerCase();
  if (!email) throw new Error('Zoho returned no e-mail');
  return {
    email,
    zohoUserId: data.ZUID ? String(data.ZUID) : null,
    name: data.Display_Name || data.First_Name || null,
  };
}

module.exports = { buildAuthUrl, exchangeCode, fetchIdentity };
