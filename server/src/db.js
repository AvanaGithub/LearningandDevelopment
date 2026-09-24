const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool({ connectionString: config.databaseUrl });

const query = (text, params) => pool.query(text, params);

/*
 * Minimal forward-only migration runner: every server/src/migrations/NNN_*.sql
 * runs once, in filename order, recorded in schema_migrations.
 */
async function migrate() {
  await query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter(f => /^\d+_.+\.sql$/.test(f)).sort();
  const { rows } = await query('SELECT filename FROM schema_migrations');
  const done = new Set(rows.map(r => r.filename));
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [f]);
      await client.query('COMMIT');
      console.log(`[migrate] applied ${f}`);
    } catch (e) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${f} failed: ${e.message}`);
    } finally {
      client.release();
    }
  }
}

module.exports = { pool, query, migrate };

if (require.main === module && process.argv[2] === 'migrate') {
  migrate().then(() => { console.log('[migrate] up to date'); process.exit(0); })
    .catch(e => { console.error(e); process.exit(1); });
}
