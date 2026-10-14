#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
if [ "${M2_CONTRACT_FOCUS:-}" = catalog ]; then
  node - "$ROOT" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const root = process.argv[2];
const provisioner = fs.readFileSync(path.join(root, 'frontend/scripts/provision-database.js'), 'utf8');
const fail = (message) => { console.error(`catalog contract RED: ${message}`); process.exit(1); };
if (!/\['constraint',\s*'function',\s*'trigger'\]\.includes\(addition\.kind\)/.test(provisioner)) fail('provisioner rejects declared function/trigger additions');
if (!/addition\.kind === 'function'[\s\S]*?expected\.functions/.test(provisioner)) fail('applied function additions are absent from exact catalog expectations');
if (!/addition\.kind === 'trigger'[\s\S]*?expected\.triggers/.test(provisioner)) fail('applied trigger additions are absent from exact catalog expectations');
if (!/const appliedFunctionNames = new Set\([\s\S]*?addition\.kind === 'function'/.test(provisioner)) fail('no separate applied-function owner allowlist exists');
NODE
  exit $?
fi
if [ "${M2_CONTRACT_FOCUS:-}" = fixture ]; then
  node - "$ROOT" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const root = process.argv[2];
const integration = fs.readFileSync(path.join(root, 'scripts/test-bootstrap-migrator-integration.sh'), 'utf8');
const fail = (message) => { console.error(`fixture sequence RED: ${message}`); process.exit(1); };
const fixtureBuilder = integration.match(/make_fixture\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
if (!fixtureBuilder.includes("'id':'015'")) fail('synthetic fixture manifest still appends discontinued ID 013');
if (fixtureBuilder.includes("'id':'013'")) fail('synthetic fixture ID is not next after manifest 014');
NODE
  exit $?
fi
node - "$ROOT" <<'NODE'
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const root = process.argv[2];
const fail = (message) => {
  console.error(`culinary profile field constraints contract failure: ${message}`);
  process.exit(1);
};
const migrationPath = path.join(root, 'db/migrations/014_culinary_profile_field_constraints.sql');
if (!fs.existsSync(migrationPath)) fail('migration 014 SQL is absent; expected its declared constraints, functions, and trigger');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'db/migrations/manifest.json'), 'utf8'));
const migration = manifest.migrations.find((entry) => entry.id === '014');
if (!migration || migration.filename !== '014_culinary_profile_field_constraints.sql') {
  fail('manifest metadata for canonical migration 014 is absent');
}
if (manifest.migrations.indexOf(migration) !== 13 || migration.lane !== 'migration' ||
    migration.transactional !== 'required' || migration.legacyChecksumBackfillAllowed !== false) {
  fail('migration 014 must be the canonical fourteenth transactional forward-only entry');
}
const migrationBytes = fs.readFileSync(migrationPath);
if (migration.byteLength !== migrationBytes.length ||
    migration.sha256 !== crypto.createHash('sha256').update(migrationBytes).digest('hex')) {
  fail('migration 014 byteLength or SHA-256 does not match its exact SQL bytes');
}
const expected = [
  { kind: 'constraint', schema: 'public', identity: 'users.users_full_name_length_check' },
  { kind: 'constraint', schema: 'public', identity: 'user_culinary_profiles.user_culinary_profiles_level_check' },
  { kind: 'constraint', schema: 'public', identity: 'user_culinary_profiles.user_culinary_profiles_allergies_bounds_check' },
  { kind: 'constraint', schema: 'public', identity: 'user_culinary_profiles.user_culinary_profiles_disliked_ingredients_bounds_check' },
  { kind: 'constraint', schema: 'public', identity: 'user_culinary_profiles.user_culinary_profiles_household_members_shape_check' },
  { kind: 'function', schema: 'public', identity: 'public.is_valid_culinary_profile_text_list' },
  { kind: 'function', schema: 'public', identity: 'public.is_valid_culinary_household_members' },
  { kind: 'function', schema: 'public', identity: 'public.enforce_culinary_profile_term_group_limit' },
  { kind: 'trigger', schema: 'public', identity: 'user_culinary_profile_terms.user_culinary_profile_terms_group_limit_trigger' },
  { kind: 'function', schema: 'public', identity: 'public.prevent_culinary_profile_taxonomy_reclassification' },
  { kind: 'trigger', schema: 'public', identity: 'culinary_terms.culinary_terms_profile_dimension_immutable_trigger' },
  { kind: 'trigger', schema: 'public', identity: 'culinary_dimensions.culinary_dimensions_profile_key_immutable_trigger' },
];
if (!Array.isArray(migration.catalogAdditions)) fail('migration 014 catalogAdditions metadata is absent');
for (const addition of migration.catalogAdditions) {
  if (!addition || Object.getPrototypeOf(addition) !== Object.prototype ||
      Object.keys(addition).sort().join(',') !== 'identity,kind,schema' ||
      !['constraint', 'function', 'trigger'].includes(addition.kind) ||
      addition.schema !== 'public' ||
      typeof addition.identity !== 'string' ||
      !/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(addition.identity)) {
    fail('migration 014 metadata must use exact {kind,schema,identity} keys, allowed kinds, public schema, and schema-qualified lowercase identities');
  }
}
const key = (item) => `${item.kind}|${item.schema}|${item.identity}`;
const declared = migration.catalogAdditions.map(key);
if (new Set(declared).size !== declared.length) fail('migration 014 catalog additions contain duplicate identities');
if (JSON.stringify([...declared].sort()) !== JSON.stringify(expected.map(key).sort())) {
  fail('migration 014 catalog additions do not exactly match the twelve required identities');
}
const provisioner = fs.readFileSync(path.join(root, 'frontend/scripts/provision-database.js'), 'utf8');
if (!/\['constraint',\s*'function',\s*'trigger'\]\.includes\(addition\.kind\)/.test(provisioner) ||
    !/Object\.keys\(addition\)\.sort\(\)\.join\(','\) !== 'identity,kind,schema'/.test(provisioner) ||
    !/!\['internal', 'public'\]\.includes\(addition\.schema\)/.test(provisioner) ||
    !/SHA256\.test\(entry\.sha256 \|\| ''\)[\s\S]*?bytes\.length !== entry\.byteLength \|\| checksum !== entry\.sha256/.test(provisioner) ||
    !/catalogAdditions\.has\(key\)[\s\S]*?Duplicate trusted catalog addition/.test(provisioner) ||
    !/Number\(entry\.id\) !== previous \+ 1/.test(provisioner) ||
    !/transferable\.length !== 38/.test(provisioner)) {
  fail('provisioner must retain exact metadata, sequence, checksum, duplicate, and 38-target validation');
}
const runner = fs.readFileSync(path.join(root, 'frontend/scripts/run-migrations.js'), 'utf8');
if (!/!\s*\[['"]constraint['"],\s*['"]function['"],\s*['"]trigger['"]\]\.includes\(addition\.kind\)/.test(runner) ||
    !/Object\.keys\(addition\)\.sort\(\)\.join\(['"],['"]\)\s*!==\s*['"]identity,kind,schema['"]/.test(runner) ||
    !/!\[['"]internal['"],\s*['"]public['"]\]\.includes\(addition\.schema\)/.test(runner) ||
    !/!\/\^\[a-z_\]\[a-z0-9_\]\*\\\.\[a-z_\]\[a-z0-9_\]\*\$\/\.test\(addition\.identity\)/.test(runner) ||
    !/seen\.has\(key\)[\s\S]{0,100}Duplicate catalog addition/.test(runner)) {
  fail('migration runner lacks strict catalog metadata validation for exact keys, allowed kinds, schema and identity validation, and duplicate rejection');
}
const sql = migrationBytes.toString('utf8');
const declarations = [
  [/\bconstraint\s+users_full_name_length_check\b/i, expected[0].identity],
  [/\bconstraint\s+user_culinary_profiles_level_check\b/i, expected[1].identity],
  [/\bconstraint\s+user_culinary_profiles_allergies_bounds_check\b/i, expected[2].identity],
  [/\bconstraint\s+user_culinary_profiles_disliked_ingredients_bounds_check\b/i, expected[3].identity],
  [/\bconstraint\s+user_culinary_profiles_household_members_shape_check\b/i, expected[4].identity],
  [/\bcreate\s+(?:or\s+replace\s+)?function\s+public\.is_valid_culinary_profile_text_list\s*\(/i, expected[5].identity],
  [/\bcreate\s+(?:or\s+replace\s+)?function\s+public\.is_valid_culinary_household_members\s*\(/i, expected[6].identity],
  [/\bcreate\s+(?:or\s+replace\s+)?function\s+public\.enforce_culinary_profile_term_group_limit\s*\(/i, expected[7].identity],
  [/\bcreate\s+trigger\s+user_culinary_profile_terms_group_limit_trigger\s+before\b[\s\S]{0,300}\bon\s+public\.user_culinary_profile_terms\b/i, expected[8].identity],
  [/\bcreate\s+(?:or\s+replace\s+)?function\s+public\.prevent_culinary_profile_taxonomy_reclassification\s*\(/i, expected[9].identity],
  [/\bcreate\s+trigger\s+culinary_terms_profile_dimension_immutable_trigger\s+before\s+update\s+of\s+dimension_id\s+on\s+public\.culinary_terms\b[\s\S]{0,200}execute\s+function\s+public\.prevent_culinary_profile_taxonomy_reclassification\s*\(/i, expected[10].identity],
  [/\bcreate\s+trigger\s+culinary_dimensions_profile_key_immutable_trigger\s+before\s+update\s+of\s+key\s+on\s+public\.culinary_dimensions\b[\s\S]{0,200}execute\s+function\s+public\.prevent_culinary_profile_taxonomy_reclassification\s*\(/i, expected[11].identity],
];
for (const [pattern, identity] of declarations) {
  if (!pattern.test(sql)) fail(`migration 014 SQL does not declare metadata identity ${identity}`);
}
const sqlContracts = [
  [/char_length\(full_name\) <= 120/i, 'full name maximum length'],
  [/level is null or level in \('Principiante', 'Intermedio', 'Chef'\)/i, 'exact nullable level allowlist'],
  [/cardinality\(p_values\) <= max_items/i, 'bounded text-list cardinality'],
  [/item\.value is null\s+or\s+char_length\(btrim\(item\.value\)\) > 80/i, 'explicit null rejection and normalized text-list item length'],
  [/is_valid_culinary_profile_text_list\(allergies, 20\)/i, 'allergies maximum count'],
  [/is_valid_culinary_profile_text_list\(disliked_ingredients, 20\)/i, 'disliked-ingredients maximum count'],
  [/char_length\(btrim\(item\.value\)\) > 80/i, 'normalized text-list item length'],
  [/jsonb_array_length\(members\) <= 12/i, 'household member maximum count'],
  [/\(select count\(\*\) from jsonb_object_keys\(entry\.value\)\) <> 2/i, 'strict household object shape'],
  [/not \(entry\.value \? 'name'\)[\s\S]*not \(entry\.value \? 'ageGroup'\)/i, 'required household object keys'],
  [/char_length\(btrim\(entry\.value ->> 'name'\)\) not between 1 and 60/i, 'nonblank bounded household names'],
  [/entry\.value ->> 'ageGroup' not in \('adult', 'teen', 'child'\)/i, 'household age-group allowlist'],
  [/pg_advisory_xact_lock\(hashtextextended\('culinary-profile:' \|\| user_id::text, 0\)\)/i, 'exact user-only advisory lock key'],
  [/pg_advisory_xact_lock\(hashtextextended\('culinary-profile-taxonomy', 0\)\)/i, 'global taxonomy advisory lock key'],
  [/perform pg_advisory_xact_lock\(hashtextextended\('culinary-profile-taxonomy', 0\)\)\s*;\s*select dimensions\.key/i, 'selection acquires taxonomy lock before determining dimension/count'],
  [/security invoker/i, 'invoker-security trigger function'],
  [/before insert or update on public\.user_culinary_profile_terms/i, 'insert/update trigger coverage'],
  [/existing culinary profile term group violates limit/i, 'explicit legacy group-violation failure'],
  [/when 'cuisine' then 6[\s\S]*when 'dietary' then 12[\s\S]*when 'technique' then 8[\s\S]*when 'ingredient_type' then 8[\s\S]*when 'goal' then 6/i, 'all five dimension caps'],
  [/old\.user_id = new\.user_id[\s\S]*old_dimensions\.key = target_dimension[\s\S]*existing_count := existing_count - 1/i, 'UPDATE self-exclusion for same target user and dimension'],
  [/order by locked_user_id/i, 'deterministic multi-user lock ordering'],
];
for (const [pattern, requirement] of sqlContracts) {
  if (!pattern.test(sql)) fail(`migration 014 SQL does not satisfy ${requirement}`);
}
const taxonomyFunction = sql.match(/create or replace function public\.prevent_culinary_profile_taxonomy_reclassification\s*\([\s\S]*?\$\$;/i)?.[0];
const hasExplicitTaxonomyBranches = taxonomyFunction &&
  /if\s+tg_table_name\s*=\s*'culinary_terms'\s+then[\s\S]*?elsif\s+tg_table_name\s*=\s*'culinary_dimensions'\s+then/i.test(taxonomyFunction);
const hasCrossRowCompoundConditions = taxonomyFunction &&
  (/if\s+tg_table_name\s*=\s*'culinary_terms'\s+and\b[\s\S]*?(?:new|old)\.key/i.test(taxonomyFunction) ||
   /if\s+tg_table_name\s*=\s*'culinary_dimensions'\s+and\b[\s\S]*?(?:new|old)\.dimension_id/i.test(taxonomyFunction));
if (!taxonomyFunction || !hasExplicitTaxonomyBranches || hasCrossRowCompoundConditions) {
  fail('taxonomy guard must use explicit culinary_terms IF / culinary_dimensions ELSIF branches without cross-row compound conditions');
}
if (!taxonomyFunction ||
    !/perform pg_advisory_xact_lock\(hashtextextended\('culinary-profile-taxonomy', 0\)\)/i.test(taxonomyFunction) ||
    /culinary-profile:'\s*\|\|\s*user_id/i.test(taxonomyFunction) ||
    !/tg_table_name\s*=\s*'culinary_terms'[\s\S]*?new\.dimension_id is distinct from old\.dimension_id[\s\S]*?profile_terms\.term_id\s*=\s*old\.id[\s\S]*?raise exception/i.test(taxonomyFunction) ||
    !/tg_table_name\s*=\s*'culinary_dimensions'[\s\S]*?new\.key is distinct from old\.key[\s\S]*?terms\.dimension_id\s*=\s*old\.id[\s\S]*?raise exception/i.test(taxonomyFunction)) {
  fail('taxonomy guard must declare the global lock and reject changed selected term/dimension mappings without user locks');
}
if (sql.indexOf('Existing culinary profile term group violates limit') > sql.indexOf('create trigger user_culinary_profile_terms_group_limit_trigger')) {
  fail('legacy aggregate violations must be checked before installing the enforcement trigger');
}
const vm = require('node:vm');
const provisionerPath = path.join(root, 'frontend/scripts/provision-database.js');
const provisionerSource = fs.readFileSync(provisionerPath, 'utf8');
const executable = provisionerSource.replace(
  /\nmain\(\)\.catch\(\(error\) => \{[\s\S]*?\n\}\);\s*$/,
  '\nmodule.exports = { loadTrustedManifest };'
);
if (executable === provisionerSource) fail('could not isolate provisioner manifest loader for no-Docker validation tests');
const manifestPath = path.join(root, 'db/migrations/manifest.json');
const trustedManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
function loadWithManifest(mutator) {
  const manifestFixture = JSON.parse(JSON.stringify(trustedManifest));
  mutator(manifestFixture);
  const fixtureFs = {
    ...fs,
    readFileSync(file, ...args) {
      if (path.resolve(String(file)) === manifestPath) return JSON.stringify(manifestFixture);
      return fs.readFileSync(file, ...args);
    },
  };
  const module = { exports: {} };
  const localRequire = (name) => {
    if (name === 'fs') return fixtureFs;
    if (name === 'pg') return { Client: class Client {} };
    if (name === 'dotenv') return { config() {} };
    return require(name);
  };
  vm.runInNewContext(executable, {
    require: localRequire,
    module,
    exports: module.exports,
    __dirname: path.dirname(provisionerPath),
    process: { env: { MIGRATIONS_DIR: path.dirname(manifestPath) } },
    console,
  }, { filename: provisionerPath });
  return module.exports.loadTrustedManifest();
}
const invalidManifestFixtures = [
  ['unknown kind', (fixture) => { fixture.migrations[13].catalogAdditions[0].kind = 'operator'; }, /catalog addition is unsupported/],
  ['malformed identity', (fixture) => { fixture.migrations[13].catalogAdditions[0].identity = 'public.BadName'; }, /catalog addition is unsupported/],
  ['duplicate identity', (fixture) => { fixture.migrations[13].catalogAdditions.push({ ...fixture.migrations[13].catalogAdditions[0] }); }, /Duplicate trusted catalog addition/],
  ['discontinuous sequence', (fixture) => { fixture.migrations[13].id = '015'; }, /migration ordering is invalid/],
];
for (const [name, mutate, expectedError] of invalidManifestFixtures) {
  let observedError;
  try { loadWithManifest(mutate); } catch (error) { observedError = error; }
  if (!observedError || !expectedError.test(observedError.message)) {
    fail(`${name} negative fixture did not fail with ${expectedError}; observed ${observedError?.message || 'success'}`);
  }
}
loadWithManifest(() => {});
console.log('culinary profile field constraints migration 014 static contract passed');
NODE
