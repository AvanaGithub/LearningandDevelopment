const express = require('express');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const config = require('./config');
const { migrate } = require('./db');
const { requireAuth } = require('./auth');

const app = express();
app.disable('x-powered-by');
app.use(cookieParser());

app.get('/healthz', (req, res) => res.send('ok'));

// Auth (login/logout/me) — the only API surface reachable without a session.
app.use('/auth', require('./routes/auth'));

// Everything else under /api requires a valid session of an active user.
app.use('/api', requireAuth);
app.use('/api/users', require('./routes/users'));
app.use('/api/employees', require('./routes/employees'));
app.use('/api/trainings', require('./routes/trainings'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/feedback', require('./routes/feedback'));
app.use('/api/expenses', require('./routes/expenses'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/dashboard', require('./routes/dashboard'));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  res.status(500).json({ error: 'Server error' });
});

// Production: serve the built React client. In dev, Vite serves the client
// itself and proxies /auth + /api here.
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

migrate().then(() => {
  app.listen(config.port, () => {
    console.log(`Learning Hub API on :${config.port} — Zoho SSO ${config.zoho.configured ? 'configured' : 'NOT configured'}`);
  });
}).catch(e => {
  console.error('[startup] migration failed:', e.message);
  process.exit(1);
});
