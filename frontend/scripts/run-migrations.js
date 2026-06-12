#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Runs PostgreSQL migrations from ../../db/migrations/ in filename order.
 *
 * Usage:
 *   node scripts/run-migrations.js
 *   node scripts/run-migrations.js --dry-run
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const MIGRATIONS_DIR = path.resolve(__dirname, '../../db/migrations');

function getDatabaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL environment variable is required.');
  }
  return url;
}

async function ensureMigrationsTable(client) {
  await client.query(`
    create table if not exists public.schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    );
  `);
}

async function getAppliedMigrations(client) {
  const result = await client.query('select filename from public.schema_migrations order by filename');
  return new Set(result.rows.map((row) => row.filename));
}

async function runMigration(client, filename, sql) {
  await client.query('begin');
  try {
    await client.query(sql);
    await client.query('insert into public.schema_migrations (filename) values ($1)', [filename]);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('No migrations found.');
    return;
  }

  const pool = new Pool({ connectionString: getDatabaseUrl() });
  const client = await pool.connect();

  try {
    await ensureMigrationsTable(client);
    const applied = await getAppliedMigrations(client);

    for (const filename of files) {
      if (applied.has(filename)) {
        console.log(`⏭  ${filename} (already applied)`);
        continue;
      }

      const filePath = path.join(MIGRATIONS_DIR, filename);
      const sql = fs.readFileSync(filePath, 'utf-8');

      if (dryRun) {
        console.log(`🔍 ${filename} would run (${sql.length} chars)`);
        continue;
      }

      console.log(`▶️  ${filename}`);
      await runMigration(client, filename, sql);
      console.log(`✅ ${filename}`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Migration failed:', error.message);
  process.exit(1);
});
