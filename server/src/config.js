require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const required = (name) => {
  const v = process.env[name];
  if (!v) console.warn(`[config] ${name} is not set`);
  return v || '';
};

module.exports = {
  port: Number(process.env.PORT || 3200),
  isProd: process.env.NODE_ENV === 'production',
  baseUrl: process.env.BASE_URL || 'http://localhost:3200',
  databaseUrl: required('DATABASE_URL'),
  devLogin: process.env.DEV_LOGIN === 'true',
  zoho: {
    clientId: process.env.ZOHO_CLIENT_ID || '',
    clientSecret: process.env.ZOHO_CLIENT_SECRET || '',
    accountsBase: process.env.ZOHO_ACCOUNTS_BASE || 'https://accounts.zoho.in',
    redirectUri: (process.env.BASE_URL || 'http://localhost:3200') + '/auth/zoho/callback',
    configured: Boolean(process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET),
  },
  seedAdmin: {
    email: (process.env.SEED_ADMIN_EMAIL || '').toLowerCase(),
    name: process.env.SEED_ADMIN_NAME || 'Super Admin',
  },
};
