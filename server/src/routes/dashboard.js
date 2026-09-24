const express = require('express');
const { query } = require('../db');

const router = express.Router();

// Foundation dashboard: headcounts now; training/compliance tiles arrive with
// the trainings module.
router.get('/', async (req, res, next) => {
  try {
    const [emp, users, trn, up] = await Promise.all([
      query(`SELECT entity, count(*)::int AS n FROM employees WHERE active GROUP BY entity`),
      query(`SELECT count(*)::int AS n FROM users WHERE active`),
      query(`SELECT status, count(*)::int AS n FROM trainings GROUP BY status`),
      query(`SELECT t.code, t.title, t.batch, t.mode, t.trainer_type, min(d.day) AS first_day
             FROM trainings t JOIN training_days d ON d.training_id = t.id
             WHERE t.status IN ('planned','confirmed','in_progress') AND d.day >= current_date
             GROUP BY t.id ORDER BY min(d.day) LIMIT 5`),
    ]);
    const byEntity = { AMD: 0, ASS: 0, ATS: 0 };
    emp.rows.forEach(r => { byEntity[r.entity] = r.n; });
    const byStatus = {};
    trn.rows.forEach(r => { byStatus[r.status] = r.n; });
    res.json({
      employees: { total: Object.values(byEntity).reduce((a, b) => a + b, 0), byEntity },
      activeUsers: users.rows[0].n,
      trainings: {
        total: Object.values(byStatus).reduce((a, b) => a + b, 0),
        byStatus,
        upcoming: up.rows,
      },
    });
  } catch (e) { next(e); }
});

module.exports = router;
