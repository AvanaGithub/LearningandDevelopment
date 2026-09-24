// Creates the first super admin (SEED_ADMIN_EMAIL / SEED_ADMIN_NAME) when the
// users table is empty. Safe to re-run: does nothing once any user exists.
const { query, migrate, pool } = require('./db');
const config = require('./config');

(async () => {
  await migrate();
  const { rows } = await query('SELECT count(*)::int AS n FROM users');
  if (rows[0].n > 0) {
    console.log('[seed] users table not empty — nothing to do');
  } else if (!config.seedAdmin.email) {
    console.log('[seed] SEED_ADMIN_EMAIL not set — nothing to do');
  } else {
    await query(
      `INSERT INTO users (email, name, role, entity) VALUES ($1,$2,'super_admin','ASS')`,
      [config.seedAdmin.email, config.seedAdmin.name]);
    console.log(`[seed] created super admin ${config.seedAdmin.email}`);
  }
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
