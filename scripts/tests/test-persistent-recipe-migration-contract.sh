#!/bin/sh
set -eu

ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
node - "$ROOT" <<'NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const root = process.argv[2];
const fail = (message) => {
  console.error(`persistent recipe migration contract failure: ${message}`);
  process.exit(1);
};
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const migrationDir = path.join(root, 'db/migrations');
const filename = '016_persistent_user_recipes.sql';
const migrationPath = path.join(migrationDir, filename);
if (!fs.existsSync(migrationPath)) fail('migration 016 SQL file is missing');

let manifest;
try {
  manifest = JSON.parse(read('db/migrations/manifest.json'));
} catch {
  fail('migration manifest is unreadable');
}
const entry = manifest.migrations.find((migration) => migration.id === '016');
if (!entry || entry.filename !== filename) fail('manifest migration 016 filename is not canonical');
if (entry.lane !== 'migration' || entry.transactional !== 'required' ||
    entry.legacyChecksumBackfillAllowed !== false) {
  fail('migration 016 must use the required transactional forward-only lane');
}
const bytes = fs.readFileSync(migrationPath);
if (entry.byteLength !== bytes.length ||
    entry.sha256 !== crypto.createHash('sha256').update(bytes).digest('hex')) {
  fail('migration 016 manifest byte length or SHA-256 does not match');
}
const sql = bytes.toString('utf8');
const additions = entry.catalogAdditions;
if (!Array.isArray(additions)) fail('migration 016 catalog additions are missing');
const additionKeys = new Set();
for (const addition of additions) {
  if (!addition || !['table', 'index', 'constraint', 'function', 'trigger'].includes(addition.kind) ||
      !['internal', 'public'].includes(addition.schema) || typeof addition.identity !== 'string') {
    fail('migration 016 has an invalid catalog addition');
  }
  const key = `${addition.kind}|${addition.schema}|${addition.identity}`;
  if (additionKeys.has(key)) fail('migration 016 catalog addition identities are not unique');
  additionKeys.add(key);
}

const expected = [];
for (const match of sql.matchAll(/CREATE\s+TABLE\s+(public\.[a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\);/gi)) {
  const table = match[1].split('.')[1];
  expected.push(['table', 'public', `public.${table}`]);
  for (const constraint of match[2].matchAll(/\bCONSTRAINT\s+([a-z_][a-z0-9_]*)\s+([\s\S]*?)(?=,\s*CONSTRAINT\s+[a-z_]|$)/gi)) {
    expected.push(['constraint', 'public', `${table}.${constraint[1]}`]);
    if (/^(?:PRIMARY\s+KEY|UNIQUE)\b/i.test(constraint[2].trim())) {
      expected.push(['index', 'public', `${table}.${constraint[1]}`]);
    }
  }
}
for (const match of sql.matchAll(/CREATE\s+INDEX\s+([a-z_][a-z0-9_]*)\s+ON\s+public\.([a-z_][a-z0-9_]*)/gi)) {
  expected.push(['index', 'public', `${match[2]}.${match[1]}`]);
}
for (const match of sql.matchAll(/CREATE\s+FUNCTION\s+(public\.[a-z_][a-z0-9_]*)\s*\(/gi)) {
  expected.push(['function', 'public', match[1]]);
}
for (const match of sql.matchAll(/CREATE\s+TRIGGER\s+([a-z_][a-z0-9_]*)\s+[\s\S]*?\sON\s+public\.([a-z_][a-z0-9_]*)/gi)) {
  expected.push(['trigger', 'public', `${match[2]}.${match[1]}`]);
}
const actualKeys = additions.map(({ kind, schema, identity }) => `${kind}|${schema}|${identity}`).sort();
const expectedKeys = expected.map(([kind, schema, identity]) => `${kind}|${schema}|${identity}`).sort();
if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
  fail('catalog additions must exactly cover migration 016 objects');
}

const sqlFiles = fs.readdirSync(migrationDir).filter((name) => name.endsWith('.sql')).sort();
const manifestFiles = manifest.migrations.map((migration) => migration.filename).sort();
if (JSON.stringify(sqlFiles) !== JSON.stringify(manifestFiles)) {
  fail('manifest and SQL migration files are not an exact bijection');
}
for (let index = 0; index < manifest.migrations.length; index += 1) {
  const migration = manifest.migrations[index];
  const expectedId = String(index + 1).padStart(3, '0');
  if (migration.id !== expectedId || !migration.filename.startsWith(`${expectedId}_`)) {
    fail('manifest migration IDs are not continuous');
  }
}

const createdTables = [...sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi)]
  .map((match) => match[1].toLowerCase());
if (JSON.stringify(createdTables.sort()) !== JSON.stringify(['user_recipe_versions', 'user_recipes'])) {
  fail('migration 016 must create only the two persistent recipe tables');
}
const requiredPatterns = [
  [/CREATE\s+TABLE\s+public\.user_recipes\s*\([\s\S]*?tenant_id\s+uuid\s+NOT\s+NULL[\s\S]*?user_id\s+uuid\s+NOT\s+NULL/i, 'recipe tenant and user ownership columns'],
  [/CREATE\s+TABLE\s+public\.user_recipe_versions\s*\([\s\S]*?recipe_id\s+uuid\s+NOT\s+NULL[\s\S]*?tenant_id\s+uuid\s+NOT\s+NULL[\s\S]*?user_id\s+uuid\s+NOT\s+NULL/i, 'version tenant, user, and recipe ownership columns'],
  [/FOREIGN\s+KEY\s*\(tenant_id\s*,\s*user_id\)[\s\S]*?REFERENCES\s+public\.tenant_memberships\s*\(tenant_id\s*,\s*user_id\)/i, 'tenant membership foreign key'],
  [/FOREIGN\s+KEY\s*\(recipe_id\s*,\s*tenant_id\s*,\s*user_id\)[\s\S]*?REFERENCES\s+public\.user_recipes\s*\(id\s*,\s*tenant_id\s*,\s*user_id\)/i, 'composite recipe-owner foreign key'],
  [/CHECK\s*\(\s*version_number\s*>\s*0\s*\)/i, 'positive version check'],
  [/CHECK\s*\(\s*length\s*\(\s*btrim\(title\)\)\s*>\s*0\s*\)/i, 'non-empty title check'],
  [/CHECK\s*\(\s*servings\s+IS\s+NULL\s+OR\s+servings\s*>\s*0\s*\)/i, 'positive servings check'],
  [/CHECK\s*\(\s*jsonb_typeof\(ingredients\)\s*=\s*'array'\s*\)/i, 'JSONB array check'],
  [/source_recipe_history_id\s+uuid\s*,[\s\S]*?FOREIGN\s+KEY\s*\(source_recipe_history_id\)[\s\S]*?REFERENCES\s+public\.recipe_ai_history\(id\)\s+ON\s+DELETE\s+SET\s+NULL/i, 'nullable AI-history foreign key with SET NULL'],
  [/CREATE\s+FUNCTION\s+public\.enforce_user_recipe_version_invariants/i, 'immutable-version trigger function'],
  [/CREATE\s+TRIGGER\s+user_recipe_versions_invariants[\s\S]*?BEFORE\s+INSERT\s+OR\s+UPDATE\s+ON\s+public\.user_recipe_versions[\s\S]*?EXECUTE\s+FUNCTION\s+public\.enforce_user_recipe_version_invariants/i, 'immutable-version trigger'],
  [/ALTER\s+TABLE\s+public\.user_recipes\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY[\s\S]*?FORCE\s+ROW\s+LEVEL\s+SECURITY/i, 'recipe RLS enforcement'],
  [/CREATE\s+POLICY\s+user_recipes_tenant_user_isolation[\s\S]*?current_setting\('app\.tenant_id',\s*true\)[\s\S]*?current_setting\('app\.user_id',\s*true\)/i, 'recipe tenant/user RLS policy'],
  [/ALTER\s+TABLE\s+public\.user_recipe_versions\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY[\s\S]*?FORCE\s+ROW\s+LEVEL\s+SECURITY/i, 'version RLS enforcement'],
  [/CREATE\s+POLICY\s+user_recipe_versions_tenant_user_isolation[\s\S]*?current_setting\('app\.tenant_id',\s*true\)[\s\S]*?current_setting\('app\.user_id',\s*true\)/i, 'version tenant/user RLS policy'],
];
for (const [pattern, description] of requiredPatterns) {
  if (!pattern.test(sql)) fail(`required ${description} is missing`);
}
const topLevel = sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, '').replace(/\$[A-Za-z_0-9]*\$[\s\S]*?\$[A-Za-z_0-9]*\$/g, '');
if (/(?:^|;)\s*(?:DROP|TRUNCATE|INSERT|UPDATE|DELETE)\b/i.test(topLevel)) {
  fail('migration 016 contains a prohibited destructive or data-mutation statement');
}
const runner = read('frontend/scripts/run-migrations.js');
const provisioner = read('frontend/scripts/provision-database.js');
for (const [source, label] of [[runner, 'migration runner'], [provisioner, 'database provisioner']]) {
  if (!/!\['constraint',\s*'function',\s*'trigger'\]\.includes\(addition\.kind\)[\s\S]*?!\['table',\s*'index'\]\.includes\(addition\.kind\)/.test(source)) {
    fail(`${label} must accept table and index catalog additions`);
  }
}
if (!/addition\.kind\s*===\s*'table'[\s\S]*?expected\.tables\.push\(addition\.identity\)[\s\S]*?expected\.types\.push\(`\$\{schema\}\.\$\{tableName\}`\)[\s\S]*?expected\.types\.push\(`\$\{schema\}\._\$\{tableName\}`\)/.test(provisioner) ||
    !/addition\.kind\s*===\s*'index'[\s\S]*?expected\.indexes\.push\(qualifyRelationObjectIdentity\(addition\)\)/.test(provisioner) ||
    !/function qualifyRelationObjectIdentity\(addition\)[\s\S]*?identityParts\.length\s*!==\s*2[\s\S]*?return `\$\{addition\.schema\}\.\$\{addition\.identity\}`/.test(provisioner)) {
  fail('database provisioner must project table, row-type, and index additions into catalog expectations');
}
if (!/addition\.kind\s*===\s*'table'[\s\S]*?addition\.kind\s*!==\s*'function'/.test(runner)) {
  fail('migration runner must project table additions into ownership expectations');
}
if (!/addition\.kind === 'function' \|\| addition\.kind === 'table'[\s\S]*?appliedOwnerEntries/.test(provisioner)) {
  fail('database provisioner must apply owner policies to table additions');
}
if (!/appliedAdditions\.filter\(\(entry\) => entry\.kind === 'table'\)[\s\S]*?allowed\.add\(`table\|\$\{addition\.identity\}`\)/.test(provisioner)) {
  fail('database provisioner must admit applied table additions in reserved-object ownership checks');
}
console.log('persistent recipe migration 016 static contract passed');
NODE
