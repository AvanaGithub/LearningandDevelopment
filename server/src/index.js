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

// Auth (login/logout/me) — reachable without a session.
app.use('/auth', require('./routes/auth'));
// QR participant pages (self check-in, feedback) — token-guarded, no session.
app.use('/api/public', require('./routes/public'));

// Everything else under /api requires a valid session of an active user.
app.use('/api', requireAuth);
// Learners only ever reach their own portal (plus settings lists and
// files like agendas) — every staff API is closed to them here.
app.use('/api', (req, res, next) => {
  if (req.user.role !== 'learner') return next();
  const ok = req.path.startsWith('/learner') ||
    (req.method === 'GET' && (req.path.startsWith('/settings') || req.path.startsWith('/files/'))) ||
    // OD-authorised people keep their OD module and budget approvals even
    // when their portal role is learner (the OD routes re-check access).
    (req.user.od_access && (req.path.startsWith('/od') || req.path.startsWith('/budget')));
  if (!ok) return res.status(403).json({ error: 'Learner access is limited to your own trainings' });
  next();
});
app.use('/api/learner', require('./routes/learner'));
app.use('/api/users', require('./routes/users'));
app.use('/api/employees', require('./routes/employees'));
app.use('/api/trainings', require('./routes/trainings'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/feedback', require('./routes/feedback'));
app.use('/api/expenses', require('./routes/expenses'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/settings', require('./routes/settings').router);
app.use('/api/files', require('./routes/files'));
app.use('/api/mavericks', require('./routes/mavericks'));
app.use('/api/joiners', require('./routes/joiners'));
app.use('/api/assessments', require('./routes/assessments'));
app.use('/api/budget', require('./routes/budget'));
app.use('/api/certs', require('./routes/certs'));
app.use('/api/workflow', require('./routes/workflow'));
app.use('/api/od', require('./routes/od'));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  // Upload limits (multer) are the user's to fix — say what went wrong.
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'A file is larger than 15 MB — please upload a smaller or compressed copy.' });
  if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') return res.status(400).json({ error: 'Too many files in one upload — please attach fewer at a time.' });
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
  // Consolidated nomination digests go out once the deadline passes.
  const mailer = require('./mailer');
  setTimeout(() => mailer.runDigests().catch(() => {}), 30 * 1000);
  setInterval(() => mailer.runDigests().catch(() => {}), 60 * 60 * 1000);
  // Assessment scores sync hourly from each linked Microsoft Forms workbook.
  const formsync = require('./formsync');
  setTimeout(() => formsync.runFormsSync().catch(() => {}), 90 * 1000);
  setInterval(() => formsync.runFormsSync().catch(() => {}), 60 * 60 * 1000);
  // Post-training workflow: pending-step nudges + auto certificates.
  const workflow = require('./workflow');
  setTimeout(() => workflow.runWorkflow().catch(() => {}), 150 * 1000);
  setInterval(() => workflow.runWorkflow().catch(() => {}), 60 * 60 * 1000);
}).catch(e => {
  console.error('[startup] migration failed:', e.message);
  process.exit(1);
});
