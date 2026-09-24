const express = require('express');
const { query } = require('../db');

const router = express.Router();

// Foundation dashboard: headcounts now; training/compliance tiles arrive with
// the trainings module.
router.get('/', async (req, res, next) => {
  try {
    const [emp, users] = await Promise.all([
      query(`SELECT entity, count(*)::int AS n FROM employees WHERE active GROUP BY entity`),
      query(`SELECT count(*)::int AS n FROM users WHERE active`),
    ]);
    const byEntity = { AMD: 0, ASS: 0, ATS: 0 };
    emp.rows.forEach(r => { byEntity[r.entity] = r.n; });
    res.json({
      employees: { total: Object.values(byEntity).reduce((a, b) => a + b, 0), byEntity },
      activeUsers: users.rows[0].n,
    });
  } catch (e) { next(e); }
});

module.exports = router;
