const express = require('express');
const { query } = require('../db');
const { requireRole, audit } = require('../auth');
const wf = require('../workflow');

// Per-participant workflow progress for a training, plus a manual "run the
// workflow now" for admins (normally it runs on completion and hourly).
const router = express.Router();

router.get('/:tid/progress', requireRole('leader'), async (req, res, next) => {
  try {
    const tid = Number(req.params.tid);
    const { rows: tr } = await query(
      `SELECT id, title, batch, code, status, req_assessment, req_feedback, req_certificate,
              cert_auto, cert_template_id, feedback_open FROM trainings WHERE id=$1`, [tid]);
    if (!tr.length) return res.status(404).json({ error: 'Not found' });
    const t = tr[0];
    const parts = await wf.stateRows(tid);
    res.json({
      training: t,
      participants: parts.map((p) => {
        const steps = [];
        steps.push({ step: 'attended', state: p.attended ? 'done' : 'pending', detail: p.att_pct === null ? 'not marked' : p.att_pct + '%' });
        if (t.req_assessment) steps.push({ step: 'assessment', state: p.assess_done ? 'done' : 'pending', notified: p.notices.includes('assessment') });
        if (t.req_feedback) steps.push({ step: 'feedback', state: p.fb_done ? 'done' : 'pending', notified: p.notices.includes('feedback') });
        if (t.req_certificate) steps.push({ step: 'certificate', state: p.cert_id ? 'done' : 'pending', detail: p.cert_no || null, file_id: p.cert_file_id || null });
        const pending = steps.find((s) => s.state === 'pending');
        return {
          id: p.id, name: p.name, zoho_emp_id: p.zoho_emp_id, att_pct: p.att_pct,
          steps, next_step: pending ? pending.step : null,
          complete: !pending,
        };
      }),
    });
  } catch (e) { next(e); }
});

// Run this training's workflow pass right now (sends any due notifications
// and auto-issues due certificates).
router.post('/:tid/run', requireRole('admin'), async (req, res, next) => {
  try {
    const tid = Number(req.params.tid);
    const { rows } = await query(`SELECT status FROM trainings WHERE id=$1`, [tid]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    if (rows[0].status !== 'completed') {
      return res.status(400).json({ error: 'The workflow runs once the training status is Completed.' });
    }
    await wf.kick(tid);
    await audit(req.user.id, 'workflow.run', 'training', tid, null);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
