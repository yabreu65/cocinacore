#!/bin/sh
set -eu

ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
node - "$ROOT" <<'NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const root = process.argv[2];
const fail = (message) => {
  console.error(`persistent recipe archive contract failure: ${message}`);
  process.exit(1);
};
const migrationName = '017_persistent_recipe_archive.sql';
const migrationPath = path.join(root, 'db/migrations', migrationName);
if (!fs.existsSync(migrationPath)) fail('migration 017 SQL file is missing');
const bytes = fs.readFileSync(migrationPath);
const sql = bytes.toString('utf8');
let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(path.join(root, 'db/migrations/manifest.json'), 'utf8'));
} catch {
  fail('migration manifest is unreadable');
}
const entries = manifest.migrations.filter((migration) => migration.id === '017');
if (entries.length !== 1) fail('manifest must contain exactly one migration 017 entry');
const entry = entries[0];
if (entry.filename !== migrationName || entry.lane !== 'migration' ||
    entry.transactional !== 'required' || entry.legacyChecksumBackfillAllowed !== false) {
  fail('migration 017 must use the canonical required-transactional forward-only lane');
}
if (entry.byteLength !== bytes.length ||
    entry.sha256 !== crypto.createHash('sha256').update(bytes).digest('hex')) {
  fail('migration 017 manifest byte length or SHA-256 does not match');
}
if (!/ALTER\s+TABLE\s+public\.user_recipes\s+ADD\s+COLUMN\s+archived_at\s+timestamptz\s*;/i.test(sql)) {
  fail('migration 017 must add nullable archived_at timestamptz');
}
if (!/CREATE\s+INDEX\s+idx_user_recipes_tenant_user_archived_at\s+ON\s+public\.user_recipes\s*\(\s*tenant_id\s*,\s*user_id\s*,\s*archived_at\s*\)\s*;/i.test(sql)) {
  fail('migration 017 tenant/user/archive listing index is missing');
}
const executableSql = sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, '');
if (/(?:^|;)\s*(?:DROP|TRUNCATE|INSERT|UPDATE|DELETE)\b/i.test(executableSql)) {
  fail('migration 017 contains a destructive or data-mutation statement');
}
const expectedAdditions = [{
  kind: 'index',
  schema: 'public',
  identity: 'user_recipes.idx_user_recipes_tenant_user_archived_at',
}];
if (JSON.stringify(entry.catalogAdditions) !== JSON.stringify(expectedAdditions)) {
  fail('migration 017 catalog additions must contain only the new index');
}
const sqlFiles = fs.readdirSync(path.join(root, 'db/migrations')).filter((name) => name.endsWith('.sql')).sort();
const manifestFiles = manifest.migrations.map((migration) => migration.filename).sort();
if (JSON.stringify(sqlFiles) !== JSON.stringify(manifestFiles)) {
  fail('manifest and SQL migration files are not an exact bijection');
}
console.log('persistent recipe archive migration 017 static contract passed');
NODE
