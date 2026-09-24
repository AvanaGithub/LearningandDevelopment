const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { query } = require('../db');
const { requireRole } = require('../auth');

// Uploaded attachments (training agendas, expense invoices).
// Disk: server/uploads/<random>.<ext>; metadata in the files table.
// Upload is admin-only; download needs any signed-in session.
const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '').slice(0, 10).replace(/[^.\w]/g, '');
    cb(null, crypto.randomBytes(12).toString('hex') + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024, files: 10 },
});

router.post('/', requireRole('admin'), upload.array('files', 10), async (req, res, next) => {
  try {
    const out = [];
    for (const f of req.files || []) {
      await query('INSERT INTO files (id, orig_name, mime, size, uploaded_by) VALUES ($1,$2,$3,$4,$5)',
        [f.filename, f.originalname, f.mimetype, f.size, req.user.id]);
      out.push({ id: f.filename, name: f.originalname });
    }
    res.status(201).json(out);
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = String(req.params.id);
    if (!/^[\w.-]+$/.test(id)) return res.status(400).json({ error: 'Bad file id' });
    const { rows } = await query('SELECT * FROM files WHERE id=$1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.setHeader('Content-Disposition', `inline; filename="${rows[0].orig_name.replace(/"/g, '')}"`);
    if (rows[0].mime) res.type(rows[0].mime);
    res.sendFile(path.join(UPLOAD_DIR, id));
  } catch (e) { next(e); }
});

module.exports = router;
