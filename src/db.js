const fs = require('fs');
const path = require('path');
const { Pool, types } = require('pg');
const config = require('./config');

// date как строка YYYY-MM-DD, numeric и bigint как number
types.setTypeParser(1082, (v) => v);
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));

function createPool({ connectionString = config.databaseUrl, schema = null, max = config.dbPoolMax } = {}) {
  const pool = new Pool({
    connectionString,
    max,
    ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
    options: schema ? `-c search_path=${schema}` : undefined,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000
  });
  pool.on('error', (err) => console.error('[billpay] ошибка соединения с БД:', err.message));
  return pool;
}

async function tx(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await fn(client);
    await client.query('COMMIT');
    return res;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function waitForDb(pool, { attempts = 30, delayMs = 1000 } = {}) {
  for (let i = 1; ; i++) {
    try { await pool.query('SELECT 1'); return; } catch (e) {
      if (i >= attempts) throw e;
      console.log(`[billpay] жду базу данных (${i}/${attempts}): ${e.message}`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

// lock, чтобы два экземпляра не накатывали одну миграцию сразу
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
async function migrate(pool, { log = true } = {}) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(727364)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    const done = new Set((await client.query('SELECT version FROM schema_migrations')).rows.map((r) => r.version));
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
    const applied = [];
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [f]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`миграция ${f} не применена: ${e.message}`);
      }
      applied.push(f);
      if (log) console.log(`[billpay] миграция применена: ${f}`);
    }
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock(727364)').catch(() => {});
    client.release();
  }
}

module.exports = { createPool, tx, waitForDb, migrate };
