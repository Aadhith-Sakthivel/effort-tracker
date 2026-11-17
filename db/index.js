// Database layer. One interface, two backends:
//   - Databricks Apps + Lakebase: PGHOST etc. are injected by the app's database resource;
//     the password is a short-lived OAuth token minted from the app's service principal.
//   - Local: embedded Postgres (PGlite) persisted to ./.data, so no install is needed.
const fs = require('fs');
const path = require('path');

let backend = null;

async function lakebasePassword() {
  if (process.env.PGPASSWORD) return process.env.PGPASSWORD;
  const host = (process.env.DATABRICKS_HOST || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const id = process.env.DATABRICKS_CLIENT_ID;
  const secret = process.env.DATABRICKS_CLIENT_SECRET;
  if (!host || !id || !secret) throw new Error('Set PGPASSWORD, or DATABRICKS_HOST/CLIENT_ID/CLIENT_SECRET for OAuth');

  const now = Date.now();
  if (lakebasePassword.cache && lakebasePassword.cache.expires > now + 60_000) return lakebasePassword.cache.token;

  const res = await fetch(`https://${host}/oidc/v1/token`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=all-apis',
  });
  if (!res.ok) throw new Error(`OAuth token request failed: ${res.status}`);
  const body = await res.json();
  lakebasePassword.cache = { token: body.access_token, expires: now + body.expires_in * 1000 };
  return body.access_token;
}

async function connect() {
  if (process.env.PGHOST) {
    const { Pool } = require('pg');
    const pool = new Pool({
      password: lakebasePassword, // pg calls this per new connection, so tokens refresh themselves
      ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
      max: 5,
    });
    backend = {
      name: `postgres (${process.env.PGHOST})`,
      query: (sql, params) => pool.query(sql, params).then((r) => r.rows),
      exec: (sql) => pool.query(sql),
      tx: async (fn) => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const out = await fn((sql, params) => client.query(sql, params).then((r) => r.rows));
          await client.query('COMMIT');
          return out;
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        } finally {
          client.release();
        }
      },
    };
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const db = new PGlite(process.env.DATA_DIR || path.join(__dirname, '..', '.data'));
    await db.waitReady;
    backend = {
      name: `embedded postgres (PGlite, ${process.env.DATA_DIR ? 'test data' : './.data'})`,
      query: (sql, params) => db.query(sql, params).then((r) => r.rows),
      exec: (sql) => db.exec(sql),
      tx: (fn) => db.transaction((t) => fn((sql, params) => t.query(sql, params).then((r) => r.rows))),
    };
  }

  await migrate();
  return backend;
}

// Versioned migrations: db/migrations/NNN_name.sql, each applied once inside a transaction.
async function migrate() {
  await backend.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const applied = new Set((await backend.query('SELECT version FROM schema_migrations')).map((r) => r.version));
  const dir = path.join(__dirname, 'migrations');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    const version = file.replace(/\.sql$/, '');
    if (applied.has(version)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    await backend.tx(async (q) => {
      for (const stmt of splitSql(sql)) await q(stmt);
      await q('INSERT INTO schema_migrations(version) VALUES ($1)', [version]);
    });
    console.log(`Applied migration ${version}`);
  }
}

// Split a migration file into statements (no dollar-quoted bodies are used in migrations).
function splitSql(sql) {
  return sql
    .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
    .split(';').map((s) => s.trim()).filter(Boolean);
}

module.exports = {
  connect,
  query: (sql, params) => backend.query(sql, params),
  tx: (fn) => backend.tx(fn),
  get name() { return backend && backend.name; },
};
