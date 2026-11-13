#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { assertPreparedCapabilitiesManifest } = require('./prepared-capabilities-contract');
const { attestPreparedCapabilities } = require('./prepared-capabilities-attestation');
const { attestActivatedCapabilities } = require('./activated-capabilities-attestation');
const {
  MIGRATION_FILE,
  assertM5ExpectedPending,
  validateEstablishedLedger,
  validateChecksummedLedger,
} = require('./migration-ledger-contract');

if (process.env.COCINACORE_SKIP_DOTENV !== '1') {
  try {
    require('dotenv').config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });
  } catch {
    // dotenv is a devDependency; deployment environments inject variables explicitly.
  }
}

const MANIFEST_VERSION = 1;
const MIGRATION_LANE_VERSION = 1;
const MIGRATION_ROLE = 'migration_admin';
const SCHEMA_OWNER = 'cocinacore_schema_owner';
const LOCK_NAMESPACE_PREFIX = 'cocinacore:database-change:v1:';
const HISTORICAL_BASELINE_COUNT = 10;
const INVENTORY_MIGRATION = '021_inventory_price_reference.sql';
const MIGRATION_NAME = /^(\d{3})_[a-z0-9]+(?:_[a-z0-9]+)*(\.bootstrap)?\.sql$/;
const LANES = new Set(['migration', 'bootstrap']);
const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT_SHA = /^[0-9a-f]{40}$/;

function parseActivationGate(value = process.env.COCINACORE_SEPARATED_DB_LANES_ENABLED) {
  if (value === undefined || value === '') return false;
  const normalized = value.trim().toLowerCase();
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  throw new Error('COCINACORE_SEPARATED_DB_LANES_ENABLED must be an explicit true or false value.');
}

function getOptions() {
  const values = new Map();
  const flags = new Set();
  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (['--lane', '--stop-after', '--verify-boundary'].includes(arg)) {
      if (values.has(arg) || !process.argv[i + 1] || process.argv[i + 1].startsWith('--'))
        throw new Error(`Invalid or duplicate argument: ${arg}.`);
      values.set(arg, process.argv[++i]);
    } else if (['--dry-run', '--verify-complete'].includes(arg)) {
      if (flags.has(arg)) throw new Error(`Duplicate argument: ${arg}.`);
      flags.add(arg);
    } else throw new Error(`Unknown argument: ${arg}.`);
  }
  const lane = values.has('--lane') ? values.get('--lane') : 'migration';
  if (!LANES.has(lane)) throw new Error('--lane must be exactly migration or bootstrap.');
  const stopAfter = values.get('--stop-after');
  const verifyBoundary = values.get('--verify-boundary');
  if ((stopAfter && !['019', '020'].includes(stopAfter)) || (verifyBoundary && verifyBoundary !== '019'))
    throw new Error('Supported stop boundaries are 019 and 020; verification boundary is 019.');
  if ((stopAfter || verifyBoundary) && (lane !== 'migration' || flags.size || (stopAfter && verifyBoundary)))
    throw new Error('Boundary options cannot be combined with another mode or bootstrap lane.');
  return { lane, dryRun: flags.has('--dry-run'), verifyComplete: flags.has('--verify-complete'), stopAfter, verifyBoundary };
}

function resolveMigrationsDir() {
  if (process.env.MIGRATIONS_DIR) return path.resolve(process.env.MIGRATIONS_DIR);
  const candidates = [
    path.resolve(__dirname, '../../db/migrations'),
    path.resolve(__dirname, '../db/migrations'),
    path.resolve(process.cwd(), 'db/migrations'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function tokenizeTopLevelStatements(sql) {
  const statements = [];
  let tokens = [];
  let index = 0;
  let blockDepth = 0;

  const finish = () => {
    if (tokens.length > 0) statements.push(tokens);
    tokens = [];
  };

  while (index < sql.length) {
    const current = sql[index];
    const next = sql[index + 1];

    if (current === '-' && next === '-') {
      index += 2;
      while (index < sql.length && sql[index] !== '\n' && sql[index] !== '\r') index += 1;
      continue;
    }
    if (current === '/' && next === '*') {
      blockDepth = 1;
      index += 2;
      while (index < sql.length && blockDepth > 0) {
        if (sql[index] === '/' && sql[index + 1] === '*') {
          blockDepth += 1;
          index += 2;
        } else if (sql[index] === '*' && sql[index + 1] === '/') {
          blockDepth -= 1;
          index += 2;
        } else {
          index += 1;
        }
      }
      if (blockDepth !== 0) throw new Error('Unterminated SQL block comment.');
      continue;
    }
    if (current === "'") {
      const escapeString =
        index > 0 &&
        /[Ee]/.test(sql[index - 1]) &&
        (index < 2 || !/[A-Za-z0-9_$]/.test(sql[index - 2]));
      index += 1;
      let closed = false;
      while (index < sql.length) {
        if (sql[index] === "'" && sql[index + 1] === "'") {
          index += 2;
        } else if (sql[index] === "'") {
          index += 1;
          closed = true;
          break;
        } else if (escapeString && sql[index] === '\\') {
          index += Math.min(2, sql.length - index);
        } else {
          index += 1;
        }
      }
      if (!closed) throw new Error('Unterminated SQL string.');
      continue;
    }
    if (current === '"') {
      index += 1;
      let closed = false;
      while (index < sql.length) {
        if (sql[index] === '"' && sql[index + 1] === '"') {
          index += 2;
        } else if (sql[index] === '"') {
          index += 1;
          closed = true;
          break;
        } else {
          index += 1;
        }
      }
      if (!closed) throw new Error('Unterminated quoted SQL identifier.');
      continue;
    }
    if (current === '$') {
      const match = sql.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if (match) {
        const delimiter = match[0];
        const end = sql.indexOf(delimiter, index + delimiter.length);
        if (end === -1) throw new Error('Unterminated dollar-quoted SQL body.');
        index = end + delimiter.length;
        continue;
      }
    }
    if (current === ';') {
      finish();
      index += 1;
      continue;
    }
    if (/[A-Za-z_]/.test(current)) {
      let end = index + 1;
      while (end < sql.length && /[A-Za-z0-9_$]/.test(sql[end])) end += 1;
      tokens.push(sql.slice(index, end).toUpperCase());
      index = end;
      continue;
    }
    index += 1;
  }
  finish();
  return statements;
}

function assertTransactionPolicy(filename, lane, sql) {
  const statements = tokenizeTopLevelStatements(sql);
  const starts = (tokens, ...prefix) => prefix.every((token, index) => tokens[index] === token);

  for (const tokens of statements) {
    const transactionControl =
      starts(tokens, 'BEGIN') ||
      starts(tokens, 'START', 'TRANSACTION') ||
      starts(tokens, 'COMMIT') ||
      starts(tokens, 'END') ||
      starts(tokens, 'ROLLBACK') ||
      starts(tokens, 'ABORT') ||
      starts(tokens, 'SAVEPOINT') ||
      starts(tokens, 'RELEASE') ||
      starts(tokens, 'PREPARE', 'TRANSACTION') ||
      starts(tokens, 'SET', 'TRANSACTION') ||
      starts(tokens, 'SET', 'SESSION', 'CHARACTERISTICS', 'AS', 'TRANSACTION');
    if (transactionControl) {
      throw new Error(`Migration ${filename} contains prohibited top-level transaction control.`);
    }

    const unsupported =
      starts(tokens, 'VACUUM') ||
      starts(tokens, 'ALTER', 'SYSTEM') ||
      starts(tokens, 'CREATE', 'DATABASE') ||
      starts(tokens, 'DROP', 'DATABASE') ||
      starts(tokens, 'CREATE', 'TABLESPACE') ||
      starts(tokens, 'DROP', 'TABLESPACE') ||
      starts(tokens, 'CREATE', 'SUBSCRIPTION') ||
      starts(tokens, 'ALTER', 'SUBSCRIPTION') ||
      starts(tokens, 'DROP', 'SUBSCRIPTION') ||
      starts(tokens, 'ALTER', 'EXTENSION') ||
      starts(tokens, 'DROP', 'EXTENSION') ||
      (tokens.includes('CONCURRENTLY') &&
        ['CREATE', 'DROP', 'REINDEX', 'REFRESH'].includes(tokens[0]));
    if (unsupported) {
      throw new Error(`Migration ${filename} contains an unsupported nontransactional operation.`);
    }

    if (lane === 'bootstrap') {
      const allowed =
        starts(tokens, 'CREATE', 'ROLE') ||
        starts(tokens, 'ALTER', 'ROLE') ||
        starts(tokens, 'GRANT') ||
        starts(tokens, 'REVOKE') ||
        starts(tokens, 'COMMENT', 'ON', 'ROLE');
      if (!allowed) {
        throw new Error(
          `Bootstrap migration ${filename} contains an operation outside the role-only contract.`
        );
      }
    }
  }
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function assertCatalogAdditions(entry, historical, seen) {
  if (historical && entry.catalogAdditions !== undefined) {
    throw new Error(`Historical migration ${entry.filename} cannot declare catalog additions.`);
  }
  if (entry.catalogAdditions === undefined) return;
  if (!Array.isArray(entry.catalogAdditions)) {
    throw new Error(`Migration ${entry.filename} has invalid catalog additions.`);
  }
  for (const addition of entry.catalogAdditions) {
    assertPlainObject(addition, `Catalog addition for ${entry.filename}`);
    if (
      Object.keys(addition).sort().join(',') !== 'identity,kind,schema' ||
      (!['constraint', 'function', 'trigger'].includes(addition.kind) &&
        !['table', 'index'].includes(addition.kind)) ||
      !['internal', 'public'].includes(addition.schema) ||
      !/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(addition.identity)
    ) {
      throw new Error(`Migration ${entry.filename} has an unsupported catalog addition.`);
    }
    const key = `${addition.kind}|${addition.schema}|${addition.identity}`;
    if (seen.has(key)) throw new Error(`Duplicate catalog addition: ${key}`);
    seen.add(key);
  }
}

function loadManifestAndMigrations() {
  const directory = resolveMigrationsDir();
  const manifestPath = path.join(directory, 'manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`Trusted migration manifest is unreadable: ${error.message}`);
  }
  assertPlainObject(manifest, 'Migration manifest');
  assertPreparedCapabilitiesManifest(manifest.preparedCapabilities);
  if (manifest.manifestVersion !== MANIFEST_VERSION) {
    throw new Error(`Unsupported migration manifest version: ${manifest.manifestVersion}`);
  }
  if (manifest.migrationLaneVersion !== MIGRATION_LANE_VERSION) {
    throw new Error('Unsupported migration lane version.');
  }
  const legacyLineages = manifest.legacyLineages;
  if (
    !Array.isArray(legacyLineages) ||
    legacyLineages.length !== 1 ||
    !legacyLineages[0] ||
    Object.keys(legacyLineages[0]).sort().join(',') !== 'anchor,filenames,ledgerMode' ||
    legacyLineages[0].anchor !== '010_password_reset_tokens.sql' ||
    legacyLineages[0].ledgerMode !== 'legacy-two-column' ||
    !Array.isArray(legacyLineages[0].filenames) ||
    legacyLineages[0].filenames.join(',') !==
      '011_mfa.sql,012_tenant_rls_stage.sql,013_platform_operator_stage.sql'
  ) {
    throw new Error('Trusted legacy migration lineage declaration is invalid.');
  }
  if (!COMMIT_SHA.test(manifest.trustedBaseCommit || '')) {
    throw new Error('Manifest trustedBaseCommit is invalid.');
  }
  if (
    manifest.lockContract?.version !== 1 ||
    manifest.lockContract?.namespacePrefix !== LOCK_NAMESPACE_PREFIX ||
    manifest.lockContract?.scope !== 'session' ||
    manifest.lockContract?.derivation !==
      'pg_catalog.hashtextextended(namespacePrefix || current_database(), 0)'
  ) {
    throw new Error('Manifest lock contract is invalid.');
  }
  if (!Array.isArray(manifest.migrations) || manifest.migrations.length === 0) {
    throw new Error('Manifest migrations must be a non-empty array.');
  }
  if (
    manifest.managedSchemas?.join(',') !== 'internal,public' ||
    manifest.bootstrapPolicy?.durableOrdinaryObjectsAllowed !== 0 ||
    manifest.bootstrapPolicy?.reservedRoles?.join(',') !==
      'cocinacore_schema_owner,migration_admin' ||
    manifest.bootstrapPolicy?.autoRunOnDeploy !== false
  ) {
    throw new Error('Trusted managed-schema/bootstrap declaration is invalid.');
  }
  if (!Array.isArray(manifest.baselineObjects?.transferable)) {
    throw new Error('Manifest ownership allowlist is missing.');
  }
  if (
    manifest.baselineObjects.transferable.length !== 38 ||
    manifest.baselineObjects.expectedCounts?.transferable !== 38
  ) {
    throw new Error('Manifest ownership allowlist must contain exactly 38 targets.');
  }
  const extensionContracts = new Map(
    (manifest.extensions || []).map((extension) => [extension.name, extension])
  );
  const expectedExtensions = {
    vector: [
      true,
      false,
      'public',
      'compatible-capabilities',
      'administrative-superuser',
      '001_extensions_and_core.sql',
    ],
    pgcrypto: [
      false,
      false,
      'public',
      'presence-only',
      'schema-owner-or-administrative-superuser',
      '001_extensions_and_core.sql',
    ],
    plpgsql: [false, true, 'pg_catalog', 'presence-only', 'administrative-superuser', null],
  };
  const expectedMemberCounts = { vector: 234, pgcrypto: 36, plpgsql: 4 };
  if (manifest.extensions.length !== 3 || extensionContracts.size !== 3) {
    throw new Error('Trusted extension declaration is invalid.');
  }
  for (const [name, expected] of Object.entries(expectedExtensions)) {
    const contract = extensionContracts.get(name);
    if (
      !contract ||
      contract.required !== true ||
      contract.extensionManaged !== true ||
      contract.expectedMemberCount !== expectedMemberCounts[name] ||
      !SHA256.test(contract.expectedMemberIdentitySha256 || '') ||
      !Array.isArray(contract.capabilities) ||
      contract.bootstrapManaged !== expected[0] ||
      contract.preinstalled !== expected[1] ||
      contract.expectedSchema !== expected[2] ||
      contract.versionPolicy !== expected[3] ||
      contract.ownerPolicy !== expected[4] ||
      contract.installMigration !== expected[5]
    ) {
      throw new Error(`Trusted extension declaration is invalid: ${name}.`);
    }
  }
  const requiredVectorCapabilities = [
    'type:public.vector',
    'operator:public.<=>(public.vector,public.vector)',
    'accessMethod:hnsw',
    'operatorClass:public.vector_cosine_ops',
  ];
  if (
    extensionContracts.get('vector').capabilities.length !== requiredVectorCapabilities.length ||
    requiredVectorCapabilities.some(
      (capability) => !extensionContracts.get('vector').capabilities.includes(capability)
    )
  ) {
    throw new Error('Trusted vector capability declaration is invalid.');
  }

  const ownershipKeys = new Set();
  const ownershipKindCounts = { schema: 0, table: 0, function: 0 };
  for (const object of manifest.baselineObjects.transferable) {
    if (!['schema', 'table', 'function'].includes(object.kind)) {
      throw new Error(`Malformed ownership object kind: ${object.kind}`);
    }
    if (
      !object.schema ||
      !object.name ||
      !object.expectedLegacyOwner ||
      object.targetOwner !== SCHEMA_OWNER
    ) {
      throw new Error('Malformed ownership target.');
    }
    const key = [object.kind, object.schema, object.name, object.arguments || ''].join('|');
    if (ownershipKeys.has(key)) throw new Error(`Duplicate ownership target: ${key}`);
    ownershipKeys.add(key);
    ownershipKindCounts[object.kind] += 1;
    const expectedLegacyOwner =
      object.kind === 'schema' && object.schema === 'public' ? 'pg_database_owner' : 'cocinacore';
    if (object.expectedLegacyOwner !== expectedLegacyOwner) {
      throw new Error(`Invalid legacy owner policy for ${key}.`);
    }
  }
  if (
    ownershipKindCounts.schema !== 2 ||
    ownershipKindCounts.table !== 29 ||
    ownershipKindCounts.function !== 7 ||
    manifest.baselineObjects.dependent?.indexes?.length !== 94 ||
    manifest.baselineObjects.dependent?.constraints?.length !== 112 ||
    manifest.baselineObjects.dependent?.types?.length !== 61
  ) {
    throw new Error('Trusted catalog inventory counts are invalid.');
  }

  const migrationRole = manifest.roles?.migrationAdmin;
  const schemaRole = manifest.roles?.schemaOwner;
  for (const [role, name, login] of [
    [migrationRole, MIGRATION_ROLE, true],
    [schemaRole, SCHEMA_OWNER, false],
  ]) {
    if (
      !role ||
      role.name !== name ||
      role.login !== login ||
      role.inherit !== false ||
      role.superuser !== false ||
      role.createDb !== false ||
      role.createRole !== false ||
      role.bypassRls !== false ||
      role.replication !== false ||
      role.connectionLimit !== -1 ||
      role.validUntil !== null ||
      !Array.isArray(role.roleSettings) ||
      role.roleSettings.length !== 0
    ) {
      throw new Error(`Trusted role declaration is invalid: ${name}.`);
    }
  }
  if (
    migrationRole.memberOf?.length !== 1 ||
    migrationRole.memberOf[0].role !== SCHEMA_OWNER ||
    migrationRole.memberOf[0].adminOption !== false ||
    migrationRole.memberOf[0].inheritOption !== false ||
    migrationRole.memberOf[0].setOption !== true ||
    migrationRole.databasePrivileges?.join(',') !== 'CONNECT' ||
    migrationRole.allowedOwnedObjects?.length !== 0 ||
    schemaRole.memberOf?.length !== 0 ||
    schemaRole.databasePrivileges?.join(',') !== 'CREATE' ||
    schemaRole.allowedOwnedObjects !== 'baselineObjects.transferable'
  ) {
    throw new Error('Trusted role membership/privilege declaration is invalid.');
  }

  const sqlNames = fs
    .readdirSync(directory)
    .filter((name) => name.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right, 'en'));
  const ids = new Set();
  const filenames = new Set();
  const migrations = [];
  const catalogAdditions = new Set();
  let previous = 0;
  for (const entry of manifest.migrations) {
    assertPlainObject(entry, 'Migration entry');
    const match = entry.filename?.match(MIGRATION_NAME);
    if (!match || entry.id !== match[1]) {
      throw new Error(`Manifest migration id/filename mismatch: ${entry.filename}`);
    }
    const numericId = Number(entry.id);
    if (numericId !== previous + 1) {
      throw new Error(`Manifest migrations are not a continuous ordered sequence at ${entry.id}.`);
    }
    previous = numericId;
    if (ids.has(entry.id)) throw new Error(`Duplicate migration id: ${entry.id}`);
    if (filenames.has(entry.filename))
      throw new Error(`Duplicate migration filename: ${entry.filename}`);
    ids.add(entry.id);
    filenames.add(entry.filename);
    const expectedLane = match[2] ? 'bootstrap' : 'migration';
    if (entry.lane !== expectedLane || !LANES.has(entry.lane)) {
      throw new Error(`Invalid migration lane for ${entry.filename}.`);
    }
    if (
      !SHA256.test(entry.sha256 || '') ||
      !Number.isSafeInteger(entry.byteLength) ||
      entry.byteLength < 1
    ) {
      throw new Error(`Invalid hash metadata for ${entry.filename}.`);
    }
    if (entry.transactional !== 'required') {
      throw new Error(`Migration ${entry.filename} is not declared transactional-only.`);
    }
    if (typeof entry.legacyChecksumBackfillAllowed !== 'boolean') {
      throw new Error(`Migration ${entry.filename} has invalid legacy backfill metadata.`);
    }
    const historical = migrations.length < HISTORICAL_BASELINE_COUNT;
    if (entry.legacyChecksumBackfillAllowed !== historical) {
      throw new Error(`Migration ${entry.filename} has invalid historical trust metadata.`);
    }
    assertCatalogAdditions(entry, historical, catalogAdditions);
    const bytes = fs.readFileSync(path.join(directory, entry.filename));
    const checksum = crypto.createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== entry.byteLength || checksum !== entry.sha256) {
      throw new Error(`MIGRATION_CHECKSUM_MISMATCH: trusted file ${entry.filename}`);
    }
    const sql = bytes.toString('utf8');
    assertTransactionPolicy(entry.filename, entry.lane, sql);
    migrations.push({ ...entry, prefix: numericId, checksum, sql });
  }

  if (migrations.length < HISTORICAL_BASELINE_COUNT) {
    throw new Error('Trusted historical migration baseline is incomplete.');
  }

  if (
    sqlNames.length !== filenames.size ||
    sqlNames.some((name) => !filenames.has(name)) ||
    [...filenames].some((name) => !sqlNames.includes(name))
  ) {
    throw new Error('Migration manifest and SQL files are not an exact bijection.');
  }
  return { directory, manifest, migrations, legacyLineage: legacyLineages[0] };
}

function getDatabaseUrl(lane, separated) {
  if (!separated) {
    if (lane !== 'migration') throw new Error('Bootstrap lane requires separated DB lanes.');
    if (!process.env.DATABASE_URL)
      throw new Error('DATABASE_URL environment variable is required.');
    return process.env.DATABASE_URL;
  }
  const variable = lane === 'bootstrap' ? 'BOOTSTRAP_DATABASE_URL' : 'MIGRATION_DATABASE_URL';
  if (!process.env[variable]) throw new Error(`${variable} environment variable is required.`);
  return process.env[variable];
}

function assertRole(role, expectedLogin) {
  if (
    !role ||
    role.rolcanlogin !== expectedLogin ||
    role.rolinherit ||
    role.rolsuper ||
    role.rolcreatedb ||
    role.rolcreaterole ||
    role.rolreplication ||
    role.rolbypassrls ||
    role.rolconnlimit !== -1 ||
    role.rolvaliduntil !== null ||
    role.rolconfig !== null
  ) {
    throw new Error(
      `ROLE_STATE_MISMATCH: database role ${role?.rolname || 'missing'} does not match the migration contract.`
    );
  }
}

async function assertBootstrapIdentity(client) {
  const result = await client.query(`
    select session_user, current_user, r.rolsuper
      from pg_catalog.pg_roles r
     where r.rolname = session_user
  `);
  const identity = result.rows[0];
  if (!identity || identity.session_user !== identity.current_user || !identity.rolsuper) {
    throw new Error(
      'MIGRATION_IDENTITY_MISMATCH: bootstrap lane must authenticate directly as a PostgreSQL superuser.'
    );
  }
}

async function assertMigrationRoleDatabaseAuthority(client) {
  const result = await client.query(
    `with reserved as (
       select oid from pg_catalog.pg_roles where rolname=any($1::text[])
     ), authority as (
       select n.nspowner as owner, null::oid as grantee
         from pg_catalog.pg_namespace n
        where n.nspname !~ '^pg_'
          and n.nspname<>'information_schema'
       union all
       select null, a.grantee
         from pg_catalog.pg_namespace n
         cross join lateral pg_catalog.aclexplode(n.nspacl) a
        where n.nspname !~ '^pg_'
          and n.nspname<>'information_schema'
       union all
       select c.relowner, a.grantee
         from pg_catalog.pg_class c
         join pg_catalog.pg_namespace n on n.oid=c.relnamespace
         left join lateral pg_catalog.aclexplode(c.relacl) a on true
        where n.nspname !~ '^pg_'
          and n.nspname<>'information_schema'
          and not exists (
            select 1 from pg_catalog.pg_depend d
             where d.classid='pg_catalog.pg_class'::pg_catalog.regclass
               and d.objid=c.oid and d.deptype='e'
          )
       union all
       select p.proowner, a.grantee
         from pg_catalog.pg_proc p
         join pg_catalog.pg_namespace n on n.oid=p.pronamespace
         left join lateral pg_catalog.aclexplode(p.proacl) a on true
        where n.nspname !~ '^pg_'
          and n.nspname<>'information_schema'
          and not exists (
            select 1 from pg_catalog.pg_depend d
             where d.classid='pg_catalog.pg_proc'::pg_catalog.regclass
               and d.objid=p.oid and d.deptype='e'
          )
       union all
       select t.typowner, a.grantee
         from pg_catalog.pg_type t
         join pg_catalog.pg_namespace n on n.oid=t.typnamespace
         left join lateral pg_catalog.aclexplode(t.typacl) a on true
        where n.nspname !~ '^pg_'
          and n.nspname<>'information_schema'
          and not exists (
            select 1 from pg_catalog.pg_depend d
             where d.classid='pg_catalog.pg_type'::pg_catalog.regclass
               and d.objid=t.oid and d.deptype in ('e','i')
          )
       union all
       select c.conowner, null
         from pg_catalog.pg_conversion c
         join pg_catalog.pg_namespace n on n.oid=c.connamespace
        where n.nspname !~ '^pg_'
          and n.nspname<>'information_schema'
       union all
       select o.oprowner, null
         from pg_catalog.pg_operator o
         join pg_catalog.pg_namespace n on n.oid=o.oprnamespace
        where n.nspname !~ '^pg_'
          and n.nspname<>'information_schema'
       union all
       select o.opcowner, null
         from pg_catalog.pg_opclass o
         join pg_catalog.pg_namespace n on n.oid=o.opcnamespace
        where n.nspname !~ '^pg_'
          and n.nspname<>'information_schema'
       union all
       select o.opfowner, null
         from pg_catalog.pg_opfamily o
         join pg_catalog.pg_namespace n on n.oid=o.opfnamespace
        where n.nspname !~ '^pg_'
          and n.nspname<>'information_schema'
       union all
       select t.dictowner, null
         from pg_catalog.pg_ts_dict t
         join pg_catalog.pg_namespace n on n.oid=t.dictnamespace
        where n.nspname !~ '^pg_'
          and n.nspname<>'information_schema'
       union all
       select t.cfgowner, null
         from pg_catalog.pg_ts_config t
         join pg_catalog.pg_namespace n on n.oid=t.cfgnamespace
        where n.nspname !~ '^pg_'
          and n.nspname<>'information_schema'
       union all
       select f.fdwowner, a.grantee
         from pg_catalog.pg_foreign_data_wrapper f
         left join lateral pg_catalog.aclexplode(f.fdwacl) a on true
       union all
       select f.srvowner, a.grantee
         from pg_catalog.pg_foreign_server f
         left join lateral pg_catalog.aclexplode(f.srvacl) a on true
       union all
       select null, a.grantee
         from pg_catalog.pg_language l
         cross join lateral pg_catalog.aclexplode(l.lanacl) a
     )
     select count(*)::integer as count from authority
      where owner=(select oid from pg_catalog.pg_roles where rolname=$2)
         or grantee=(select oid from pg_catalog.pg_roles where rolname=$2)`,
    [[MIGRATION_ROLE, SCHEMA_OWNER], MIGRATION_ROLE]
  );
  if (result.rows[0].count !== 0) {
    throw new Error('ROLE_STATE_MISMATCH: migration_admin has unexpected database authority.');
  }
}

async function assertSchemaOwnerDatabaseAuthority(client, manifest, applied) {
  const actual = await client.query(
    `select kind, identity from (
       select 'schema'::text as kind, n.nspname::text as identity
         from pg_catalog.pg_namespace n
        where n.nspowner=(select oid from pg_catalog.pg_roles where rolname=$1)
       union all
       select 'table', n.nspname || '.' || c.relname
         from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
        where c.relowner=(select oid from pg_catalog.pg_roles where rolname=$1)
          and c.relkind in ('r','p','S','v','m','f')
          and not exists (
            select 1 from pg_catalog.pg_depend d
             where d.classid='pg_catalog.pg_class'::pg_catalog.regclass
               and d.objid=c.oid and d.deptype='e'
          )
       union all
       select 'function', n.nspname || '.' || p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')'
         from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
        where p.proowner=(select oid from pg_catalog.pg_roles where rolname=$1)
          and not exists (
            select 1 from pg_catalog.pg_depend d
             where d.classid='pg_catalog.pg_proc'::pg_catalog.regclass
               and d.objid=p.oid and d.deptype='e'
          )
       union all
       select 'type', n.nspname || '.' || t.typname
         from pg_catalog.pg_type t join pg_catalog.pg_namespace n on n.oid=t.typnamespace
        where t.typowner=(select oid from pg_catalog.pg_roles where rolname=$1)
          and not exists (
            select 1 from pg_catalog.pg_depend d
             where d.classid='pg_catalog.pg_type'::pg_catalog.regclass
               and d.objid=t.oid and d.deptype in ('e','i')
          )
       union all
       select 'conversion', n.nspname || '.' || c.conname
         from pg_catalog.pg_conversion c join pg_catalog.pg_namespace n on n.oid=c.connamespace
        where c.conowner=(select oid from pg_catalog.pg_roles where rolname=$1)
       union all
       select 'operator', n.nspname || '.' || o.oprname
         from pg_catalog.pg_operator o join pg_catalog.pg_namespace n on n.oid=o.oprnamespace
        where o.oprowner=(select oid from pg_catalog.pg_roles where rolname=$1)
       union all
       select 'operator class', n.nspname || '.' || o.opcname
         from pg_catalog.pg_opclass o join pg_catalog.pg_namespace n on n.oid=o.opcnamespace
        where o.opcowner=(select oid from pg_catalog.pg_roles where rolname=$1)
       union all
       select 'operator family', n.nspname || '.' || o.opfname
         from pg_catalog.pg_opfamily o join pg_catalog.pg_namespace n on n.oid=o.opfnamespace
        where o.opfowner=(select oid from pg_catalog.pg_roles where rolname=$1)
       union all
       select 'text search dictionary', n.nspname || '.' || t.dictname
         from pg_catalog.pg_ts_dict t join pg_catalog.pg_namespace n on n.oid=t.dictnamespace
        where t.dictowner=(select oid from pg_catalog.pg_roles where rolname=$1)
       union all
       select 'text search configuration', n.nspname || '.' || t.cfgname
         from pg_catalog.pg_ts_config t join pg_catalog.pg_namespace n on n.oid=t.cfgnamespace
        where t.cfgowner=(select oid from pg_catalog.pg_roles where rolname=$1)
       union all
       select 'foreign data wrapper', f.fdwname
         from pg_catalog.pg_foreign_data_wrapper f
        where f.fdwowner=(select oid from pg_catalog.pg_roles where rolname=$1)
       union all
       select 'foreign server', f.srvname
         from pg_catalog.pg_foreign_server f
        where f.srvowner=(select oid from pg_catalog.pg_roles where rolname=$1)
     ) objects order by kind, identity`,
    [SCHEMA_OWNER]
  );
  const hasLedger = applied !== null;
  const allowedObjects = hasLedger
    ? manifest.baselineObjects.transferable
    : manifest.baselineObjects.transferable.filter(
        (object) => object.kind === 'schema' && object.schema === 'public'
      );
  const allowed = new Set(
    allowedObjects.map(
      (object) =>
        `${object.kind},${
          object.kind === 'schema'
            ? object.schema
            : object.kind === 'function'
              ? `${object.schema}.${object.name}(${object.arguments})`
              : `${object.schema}.${object.name}`
        }`
    )
  );
  if (hasLedger) {
    const declarations = new Set();
    for (const migration of manifest.migrations) {
      if (!applied.has(migration.filename)) continue;
      for (const addition of migration.catalogAdditions || []) {
        if (addition.kind === 'table') {
          const [schema, name] = addition.identity.split('.');
          if (schema !== addition.schema) {
            throw new Error(
              `ROLE_STATE_MISMATCH: invalid applied table declaration ${addition.identity}.`
            );
          }
          const identity = `table,${schema}.${name}`;
          if (allowed.has(identity)) {
            throw new Error(
              `ROLE_STATE_MISMATCH: applied table ${addition.identity} duplicates a baseline owner target.`
            );
          }
          allowed.add(identity);
          continue;
        }
        if (addition.kind !== 'function') continue;
        const [schema, name] = addition.identity.split('.');
        const declaration = `${schema}.${name}`;
        if (schema !== addition.schema || declarations.has(declaration)) {
          throw new Error(
            `ROLE_STATE_MISMATCH: duplicate or invalid applied function declaration ${declaration}.`
          );
        }
        declarations.add(declaration);
        const functions = await client.query(
          `select n.nspname::text as schema, p.proname::text as name,
                  pg_catalog.pg_get_function_identity_arguments(p.oid) as arguments,
                  pg_catalog.pg_get_userbyid(p.proowner) as owner
             from pg_catalog.pg_proc p
             join pg_catalog.pg_namespace n on n.oid=p.pronamespace
            where p.prokind='f' and n.nspname=$1 and p.proname=$2`,
          [schema, name]
        );
        if (functions.rows.length !== 1 || functions.rows[0].owner !== SCHEMA_OWNER) {
          throw new Error(
            `ROLE_STATE_MISMATCH: applied function ${declaration} is missing, ambiguous, or has an unexpected owner.`
          );
        }
        const identity = `function,${schema}.${name}(${functions.rows[0].arguments})`;
        if (allowed.has(identity)) {
          throw new Error(
            `ROLE_STATE_MISMATCH: applied function ${declaration} duplicates a baseline owner target.`
          );
        }
        allowed.add(identity);
      }
    }
  }
  const actualSet = new Set(actual.rows.map((row) => `${row.kind},${row.identity}`));
  if (
    actualSet.size !== allowed.size ||
    [...actualSet].some((identity) => !allowed.has(identity)) ||
    [...allowed].some((identity) => !actualSet.has(identity))
  ) {
    throw new Error('ROLE_STATE_MISMATCH: schema-owner object ownership differs from manifest.');
  }
  const unexpectedAcl = await client.query(
    `with grants as (
       select n.nspowner as owner, a.grantee
         from pg_catalog.pg_namespace n
         cross join lateral pg_catalog.aclexplode(n.nspacl) a
       union all
       select c.relowner, a.grantee
         from pg_catalog.pg_class c
         cross join lateral pg_catalog.aclexplode(c.relacl) a
       union all
       select p.proowner, a.grantee
         from pg_catalog.pg_proc p
         cross join lateral pg_catalog.aclexplode(p.proacl) a
       union all
       select t.typowner, a.grantee
         from pg_catalog.pg_type t
         cross join lateral pg_catalog.aclexplode(t.typacl) a
       union all
       select null::oid, a.grantee
         from pg_catalog.pg_language l
         cross join lateral pg_catalog.aclexplode(l.lanacl) a
       union all
       select f.fdwowner, a.grantee
         from pg_catalog.pg_foreign_data_wrapper f
         cross join lateral pg_catalog.aclexplode(f.fdwacl) a
       union all
       select f.srvowner, a.grantee
         from pg_catalog.pg_foreign_server f
         cross join lateral pg_catalog.aclexplode(f.srvacl) a
     )
     select count(*)::integer as count from grants
      where grantee=(select oid from pg_catalog.pg_roles where rolname=$1)
        and owner is distinct from grantee`,
    [SCHEMA_OWNER]
  );
  if (unexpectedAcl.rows[0].count !== 0) {
    throw new Error('ROLE_STATE_MISMATCH: schema owner has unexpected direct database ACLs.');
  }
}

async function assertAndAssumeMigrationIdentity(client, manifest, migrations, separated) {
  const identity = await client.query(`
    select session_user, current_user, r.rolname, r.rolcanlogin, r.rolinherit, r.rolsuper,
           r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls,
           r.rolconnlimit, r.rolvaliduntil, r.rolconfig
      from pg_catalog.pg_roles r
     where r.rolname = session_user
  `);
  const role = identity.rows[0];
  if (!role || role.session_user !== MIGRATION_ROLE || role.current_user !== MIGRATION_ROLE) {
    throw new Error(
      'MIGRATION_IDENTITY_MISMATCH: connection must authenticate directly as migration_admin.'
    );
  }
  assertRole(role, true);

  const authority = await client.query(
    `select
       (select count(*)::integer
          from pg_catalog.pg_db_role_setting s
         where s.setrole in (
           select oid from pg_catalog.pg_roles where rolname=any($1::text[])
         )) as database_settings,
       (select count(*)::integer
          from pg_catalog.pg_tablespace t
          left join lateral pg_catalog.aclexplode(t.spcacl) a on true
         where t.spcowner in (
                 select oid from pg_catalog.pg_roles where rolname=any($1::text[])
               )
            or a.grantee in (
                 select oid from pg_catalog.pg_roles where rolname=any($1::text[])
               )) as tablespace_authority,
       (select count(*)::integer
          from pg_catalog.pg_database d
          cross join lateral pg_catalog.aclexplode(
            coalesce(d.datacl, pg_catalog.acldefault('d', d.datdba))
          ) a
         where (d.datdba in (
                  select oid from pg_catalog.pg_roles where rolname=any($1::text[])
                )
            or a.grantee in (
                  select oid from pg_catalog.pg_roles where rolname=any($1::text[])
                ))
           and not (
             d.datname=current_database()
             and d.datdba not in (
                   select oid from pg_catalog.pg_roles where rolname=any($1::text[])
                 )
             and (
               (a.grantee=(select oid from pg_catalog.pg_roles where rolname=$2)
                and a.privilege_type='CONNECT')
               or
               (a.grantee=(select oid from pg_catalog.pg_roles where rolname=$3)
                and a.privilege_type='CREATE')
             )
           )) as database_authority`,
    [[MIGRATION_ROLE, SCHEMA_OWNER], MIGRATION_ROLE, SCHEMA_OWNER]
  );
  if (Object.values(authority.rows[0]).some((count) => count !== 0)) {
    throw new Error('ROLE_STATE_MISMATCH: reserved roles have unexpected cluster authority.');
  }
  await assertMigrationRoleDatabaseAuthority(client);

  const memberships = await client.query(
    `select parent.rolname as granted_role, member.rolname as member_role,
            m.admin_option, m.inherit_option, m.set_option
       from pg_catalog.pg_auth_members m
       join pg_catalog.pg_roles parent on parent.oid = m.roleid
       join pg_catalog.pg_roles member on member.oid = m.member
      where parent.rolname in ($1, $2) or member.rolname in ($1, $2)
      order by granted_role, member_role`,
    [MIGRATION_ROLE, SCHEMA_OWNER]
  );
  if (
    memberships.rowCount !== 1 ||
    memberships.rows[0].granted_role !== SCHEMA_OWNER ||
    memberships.rows[0].member_role !== MIGRATION_ROLE ||
    memberships.rows[0].admin_option ||
    memberships.rows[0].inherit_option ||
    !memberships.rows[0].set_option
  ) {
    throw new Error('ROLE_STATE_MISMATCH: migration role membership does not match the contract.');
  }

  await client.query(`set role ${SCHEMA_OWNER}`);
  const assumed = await client.query(`
    select session_user, current_user, r.rolname, r.rolcanlogin, r.rolinherit, r.rolsuper,
           r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls,
           r.rolconnlimit, r.rolvaliduntil, r.rolconfig
      from pg_catalog.pg_roles r
     where r.rolname = current_user
  `);
  if (
    assumed.rows[0]?.session_user !== MIGRATION_ROLE ||
    assumed.rows[0]?.current_user !== SCHEMA_OWNER
  ) {
    throw new Error('Failed to assume cocinacore_schema_owner.');
  }
  assertRole(assumed.rows[0], false);

  const hasLedger = await migrationLedgerExists(client);
  let applied = null;
  if (hasLedger) {
    const ledgerMode = await assertLedgerShape(client, separated);
    applied = await getAppliedMigrations(
      client,
      migrations,
      ledgerMode,
      manifest.legacyLineages[0]
    );
    assertGlobalOrder(migrations, applied);
  }

  if (applied && migrations.some((migration) => migration.prefix > 20 && migration.filename !== INVENTORY_MIGRATION && applied.has(migration.filename))) {
    throw new Error('UNSUPPORTED_CAPABILITY_MIGRATION: no reviewed catalog attestation.');
  }

  await assertSchemaOwnerDatabaseAuthority(client, manifest, applied);
  if (applied?.has('019_real_consumption_reconciliation.sql')) {
    const post020Applied = migrations.some((migration) => migration.prefix >= 20 && applied.has(migration.filename));
    if (post020Applied) {
      const activationState = await attestActivatedCapabilities(client, applied.has(INVENTORY_MIGRATION) ? '021' : '020');
      if (activationState === 'pending') console.log('ACTIVATION PENDING: post-020 grants are incomplete.');
    } else await attestPreparedCapabilities(client);
  }
}

function parseBoundedTimeout(name) {
  const value = process.env[name];
  if (value === undefined) return undefined;
  if (!/^[0-9]+$/.test(value)) {
    throw new Error(`${name} must be an integer between 1 and 300000.`);
  }
  const timeout = Number(value);
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 300000) {
    throw new Error(`${name} must be an integer between 1 and 300000.`);
  }
  return timeout;
}

function parseExpectedPending(migrations) {
  const value = process.env.MIGRATION_EXPECTED_PENDING;
  if (value === undefined) return undefined;
  const filenames = value === '' ? [] : value.split(',');
  const canonical = migrations.map((migration) => migration.filename);
  let previousIndex = -1;
  for (const filename of filenames) {
    const index = canonical.indexOf(filename);
    if (index === -1 || index <= previousIndex) {
      throw new Error(
        'MIGRATION_EXPECTED_PENDING must be an exact, ordered set of canonical migration filenames.'
      );
    }
    previousIndex = index;
  }
  return new Set(filenames);
}

function assertExpectedPending(migrations, applied, expected, separated = false) {
  if (expected === undefined) return;
  if (
    separated &&
    (expected.has('018_cooking_sessions.sql') ||
      expected.has('019_real_consumption_reconciliation.sql'))
  ) {
    assertM5ExpectedPending(migrations, applied, expected);
  }
  const actual = migrations
    .filter((migration) => !applied.has(migration.filename))
    .map((migration) => migration.filename);
  const expectedFilenames = migrations
    .filter((migration) => expected.has(migration.filename))
    .map((migration) => migration.filename);
  const exactM5Pair = expectedFilenames.join(',') ===
    '018_cooking_sessions.sql,019_real_consumption_reconciliation.sql';
  if (exactM5Pair) {
    const pending020 = migrations.find((migration) => migration.id === '020' && migration.filename === '020_tenant_rls_hardening.sql');
    if (pending020 && !applied.has(pending020.filename)) expectedFilenames.push(pending020.filename);
  }
  if (
    actual.length !== expectedFilenames.length ||
    actual.some((filename, index) => filename !== expectedFilenames[index])
  ) {
    throw new Error(
      `MIGRATION_EXPECTED_PENDING_MISMATCH: expected [${expectedFilenames.join(',')}], found [${actual.join(',')}].`
    );
  }
}

function lockTimeout() {
  const timeout = Number(process.env.MIGRATION_LOCK_TIMEOUT_MS || '30000');
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 300000) {
    throw new Error('MIGRATION_LOCK_TIMEOUT_MS must be an integer between 1 and 300000.');
  }
  return timeout;
}

async function acquireDatabaseChangeLock(client) {
  const keyResult = await client.query(
    `select pg_catalog.hashtextextended($1 || current_database(), 0)::text as key`,
    [LOCK_NAMESPACE_PREFIX]
  );
  const key = keyResult.rows[0].key;
  const deadline = Date.now() + lockTimeout();
  do {
    const attempt = await client.query(
      'select pg_catalog.pg_try_advisory_lock($1::bigint) as acquired',
      [key]
    );
    if (attempt.rows[0].acquired) return key;
    await new Promise((resolve) => setTimeout(resolve, 25));
  } while (Date.now() < deadline);
  throw new Error('LOCK_TIMEOUT: database-change lock acquisition failed.');
}

async function releaseDatabaseChangeLock(client, key) {
  const result = await client.query(
    'select pg_catalog.pg_advisory_unlock($1::bigint) as released',
    [key]
  );
  if (!result.rows[0].released) throw new Error('Database-change lock release failure.');
}

async function assertExtensionMembers(client, contract) {
  const result = await client.query(
    `select d.classid::pg_catalog.regclass::text as catalog,
            d.objsubid,
            pg_catalog.pg_identify_object(d.classid,d.objid,d.objsubid)::text as identity,
            owner.rolname as owner,
            owner.rolsuper as owner_superuser,
            member.owner_oid is null as ownerless
       from pg_catalog.pg_extension e
       join pg_catalog.pg_depend d
         on d.refclassid='pg_catalog.pg_extension'::pg_catalog.regclass
        and d.refobjid=e.oid
        and d.deptype='e'
       cross join lateral (
         select case d.classid
                  when 'pg_catalog.pg_class'::pg_catalog.regclass
                    then (select c.relowner from pg_catalog.pg_class c where c.oid=d.objid)
                  when 'pg_catalog.pg_proc'::pg_catalog.regclass
                    then (select p.proowner from pg_catalog.pg_proc p where p.oid=d.objid)
                  when 'pg_catalog.pg_type'::pg_catalog.regclass
                    then (select t.typowner from pg_catalog.pg_type t where t.oid=d.objid)
                  when 'pg_catalog.pg_namespace'::pg_catalog.regclass
                    then (select n.nspowner from pg_catalog.pg_namespace n where n.oid=d.objid)
                  when 'pg_catalog.pg_conversion'::pg_catalog.regclass
                    then (select c.conowner from pg_catalog.pg_conversion c where c.oid=d.objid)
                  when 'pg_catalog.pg_operator'::pg_catalog.regclass
                    then (select o.oprowner from pg_catalog.pg_operator o where o.oid=d.objid)
                  when 'pg_catalog.pg_opclass'::pg_catalog.regclass
                    then (select o.opcowner from pg_catalog.pg_opclass o where o.oid=d.objid)
                  when 'pg_catalog.pg_opfamily'::pg_catalog.regclass
                    then (select o.opfowner from pg_catalog.pg_opfamily o where o.oid=d.objid)
                  when 'pg_catalog.pg_ts_dict'::pg_catalog.regclass
                    then (select t.dictowner from pg_catalog.pg_ts_dict t where t.oid=d.objid)
                  when 'pg_catalog.pg_ts_config'::pg_catalog.regclass
                    then (select t.cfgowner from pg_catalog.pg_ts_config t where t.oid=d.objid)
                  when 'pg_catalog.pg_foreign_data_wrapper'::pg_catalog.regclass
                    then (select f.fdwowner from pg_catalog.pg_foreign_data_wrapper f where f.oid=d.objid)
                  when 'pg_catalog.pg_foreign_server'::pg_catalog.regclass
                    then (select f.srvowner from pg_catalog.pg_foreign_server f where f.oid=d.objid)
                  else null
                end as owner_oid
       ) member
       left join pg_catalog.pg_roles owner on owner.oid=member.owner_oid
      where e.extname=$1
      order by catalog, identity, d.objsubid`,
    [contract.name]
  );
  const errorId = contract.name === 'vector' ? 'VECTOR_STATE_MISMATCH' : 'BASELINE_MISMATCH';
  const identity = result.rows
    .map((row) => `${row.catalog}|${row.objsubid}|${row.identity}`)
    .join('\n');
  const identityHash = crypto.createHash('sha256').update(`${identity}\n`).digest('hex');
  const ownerDrift = result.rows.some(
    (row) => !row.ownerless && !row.owner_superuser && row.owner !== SCHEMA_OWNER
  );
  if (
    result.rowCount !== contract.expectedMemberCount ||
    identityHash !== contract.expectedMemberIdentitySha256 ||
    ownerDrift
  ) {
    throw new Error(`${errorId}: extension ${contract.name} membership is outside policy.`);
  }
}

async function assertRunnerExtensionState(client, manifest, { pgcryptoRequired }) {
  const result = await client.query(
    `
    select e.extname as name, e.extversion as version, n.nspname as schema,
           r.rolname as owner, r.rolsuper as owner_superuser,
           exists (
             select 1 from pg_catalog.pg_available_extension_versions a
              where a.name=e.extname and a.version=e.extversion
           ) as advertised
      from pg_catalog.pg_extension e
      join pg_catalog.pg_namespace n on n.oid=e.extnamespace
      join pg_catalog.pg_roles r on r.oid=e.extowner
     where e.extname=any($1::text[])
     order by e.extname
  `,
    [['pgcrypto', 'plpgsql', 'vector']]
  );
  const states = new Map(result.rows.map((row) => [row.name, row]));
  const required = pgcryptoRequired ? ['pgcrypto', 'plpgsql', 'vector'] : ['plpgsql', 'vector'];
  for (const name of required) {
    if (!states.has(name)) {
      const errorId = name === 'vector' ? 'VECTOR_STATE_MISMATCH' : 'BASELINE_MISMATCH';
      throw new Error(`${errorId}: required extension ${name} is absent.`);
    }
  }
  for (const [name, state] of states) {
    const contract = manifest.extensions.find((extension) => extension.name === name);
    const errorId = name === 'vector' ? 'VECTOR_STATE_MISMATCH' : 'BASELINE_MISMATCH';
    if (state.schema !== contract.expectedSchema || !state.version || !state.advertised) {
      throw new Error(`${errorId}: extension ${name} has an invalid catalog state.`);
    }
    if (
      contract.ownerPolicy === 'administrative-superuser' &&
      (!state.owner_superuser || [MIGRATION_ROLE, SCHEMA_OWNER].includes(state.owner))
    ) {
      throw new Error(`${errorId}: extension ${name} owner is outside policy.`);
    }
    if (
      contract.ownerPolicy === 'schema-owner-or-administrative-superuser' &&
      state.owner !== SCHEMA_OWNER &&
      !state.owner_superuser
    ) {
      throw new Error(`${errorId}: extension ${name} owner is outside policy.`);
    }
    await assertExtensionMembers(client, { ...contract, name });
  }
  const capabilities = await client.query(`
    select pg_catalog.to_regtype('public.vector') is not null as vector_type,
           pg_catalog.to_regoperator('public.<=>(public.vector,public.vector)') is not null as cosine_operator,
           exists (select 1 from pg_catalog.pg_am where amname='hnsw') as hnsw,
           exists (
             select 1 from pg_catalog.pg_opclass o
             join pg_catalog.pg_namespace n on n.oid=o.opcnamespace
             where n.nspname='public' and o.opcname='vector_cosine_ops'
           ) as cosine_opclass
  `);
  if (Object.values(capabilities.rows[0]).some((value) => value !== true)) {
    throw new Error('VECTOR_STATE_MISMATCH: required vector capabilities are absent.');
  }
}

async function migrationLedgerExists(client) {
  const result = await client.query(
    "select pg_catalog.to_regclass('public.schema_migrations') is not null as exists"
  );
  return result.rows[0].exists;
}

async function assertLedgerShape(client, separated) {
  const columns = await client.query(`
    select a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type,
           a.attnotnull, pg_catalog.pg_get_expr(d.adbin, d.adrelid) as default_expression
      from pg_catalog.pg_attribute a
      left join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where a.attrelid = 'public.schema_migrations'::pg_catalog.regclass
       and a.attnum > 0 and not a.attisdropped
     order by a.attnum
  `);
  const columnNames = columns.rows.map((row) => row.attname);
  const ledgerMode = !separated
    ? 'legacy-two-column'
    : columnNames.length === 4 && columnNames.includes('checksum_source')
      ? 'provenance'
      : 'checksummed';
  const expected = {
    'legacy-two-column': ['filename', 'applied_at'],
    checksummed: ['filename', 'applied_at', 'checksum'],
    provenance: ['filename', 'applied_at', 'checksum', 'checksum_source'],
  }[ledgerMode];
  if (
    columnNames.length !== expected.length ||
    columnNames.some((name, index) => name !== expected[index])
  ) {
    throw new Error('schema_migrations has an unexpected shape.');
  }
  const filename = columns.rows.find((row) => row.attname === 'filename');
  const appliedAt = columns.rows.find((row) => row.attname === 'applied_at');
  const checksum = columns.rows.find((row) => row.attname === 'checksum');
  if (
    filename?.data_type !== 'text' ||
    !filename.attnotnull ||
    appliedAt?.data_type !== 'timestamp with time zone' ||
    !appliedAt.attnotnull ||
    appliedAt.default_expression !== 'now()' ||
    (ledgerMode === 'checksummed' && (checksum?.data_type !== 'text' || !checksum.attnotnull)) ||
    (ledgerMode === 'provenance' &&
      (checksum?.data_type !== 'text' ||
        checksum.attnotnull ||
        columns.rows.find((row) => row.attname === 'checksum_source')?.data_type !== 'text' ||
        !columns.rows.find((row) => row.attname === 'checksum_source')?.attnotnull))
  ) {
    throw new Error('schema_migrations has an unexpected shape.');
  }
  const invariants = await client.query(`
    select c.relrowsecurity,
           (select count(*)::integer from pg_catalog.pg_constraint x
             where x.conrelid=c.oid and x.contype='p'
               and pg_catalog.pg_get_constraintdef(x.oid)='PRIMARY KEY (filename)') as primary_keys,
           (select count(*)::integer from pg_catalog.aclexplode(c.relacl) a
             where a.grantee=0) as public_grants
      from pg_catalog.pg_class c
     where c.oid='public.schema_migrations'::pg_catalog.regclass
  `);
  if (
    !invariants.rows[0]?.relrowsecurity ||
    invariants.rows[0]?.primary_keys !== 1 ||
    invariants.rows[0]?.public_grants !== 0
  ) {
    throw new Error(
      'BASELINE_MISMATCH: schema_migrations security/primary-key contract is invalid.'
    );
  }
  if (ledgerMode === 'provenance') {
    const checksumConstraints = await client.query(`
      select x.conname, pg_catalog.pg_get_constraintdef(x.oid) as definition, x.convalidated
        from pg_catalog.pg_constraint x
       where x.conrelid = 'public.schema_migrations'::pg_catalog.regclass
         and x.contype = 'c'
    `);
    if (
      checksumConstraints.rowCount !== 1 ||
      checksumConstraints.rows[0]?.conname !== 'schema_migrations_checksum_source_check' ||
      !checksumConstraints.rows[0]?.convalidated ||
      checksumConstraints.rows[0]?.definition !==
        "CHECK ((((checksum_source = 'legacy_unverifiable'::text) AND (checksum IS NULL)) OR ((checksum_source = ANY (ARRAY['manifest_backfill'::text, 'migration_file'::text])) AND (checksum IS NOT NULL))))"
    ) {
      throw new Error(
        'BASELINE_MISMATCH: schema_migrations checksum provenance constraint is invalid.'
      );
    }
  }
  return ledgerMode;
}

async function ensureSeparatedLedger(client) {
  if (!(await migrationLedgerExists(client))) {
    await client.query('begin');
    try {
      const internal = await client.query(
        "select pg_catalog.to_regnamespace('internal') is not null as exists"
      );
      if (!internal.rows[0].exists) {
        await client.query(`create schema internal authorization ${SCHEMA_OWNER}`);
      }
      await client.query(`
        create table public.schema_migrations (
          filename text primary key,
          applied_at timestamptz not null default now(),
          checksum text not null
        )
      `);
      await client.query('alter table public.schema_migrations enable row level security');
      await client.query('revoke all on public.schema_migrations from public');
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  }
  const ledgerMode = await assertLedgerShape(client, true);
  const ownership = await client.query(`
    select pg_catalog.pg_get_userbyid(c.relowner) as owner
      from pg_catalog.pg_class c
     where c.oid = 'public.schema_migrations'::pg_catalog.regclass
  `);
  if (ownership.rows[0]?.owner !== SCHEMA_OWNER) {
    throw new Error('schema_migrations has an unexpected owner.');
  }
  return ledgerMode;
}

async function ensureLegacyLedger(client) {
  await client.query('create schema if not exists internal');
  await client.query(`
    create table if not exists public.schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    )
  `);
  await client.query(`
    alter table public.schema_migrations enable row level security;
    revoke all on public.schema_migrations from public
  `);
  return assertLedgerShape(client, false);
}

async function getAppliedMigrations(client, migrations, ledgerMode, legacyLineage) {
  const columns = {
    'legacy-two-column': 'filename, applied_at',
    checksummed: 'filename, applied_at, checksum',
    provenance: 'filename, applied_at, checksum, checksum_source',
  }[ledgerMode];
  const result = await client.query(
    `select ${columns}, count(*) over (partition by applied_at) as timestamp_count from public.schema_migrations order by applied_at, filename`
  );
  if (ledgerMode === 'provenance') {
    return validateEstablishedLedger(result.rows, migrations);
  }
  const separated = ledgerMode === 'checksummed';
  const expected = new Map(migrations.map((migration) => [migration.filename, migration]));
  const legacyNames = new Set(legacyLineage.filenames);
  const seen = new Set();
  const positions = new Map();
  for (const [index, row] of result.rows.entries()) {
    if (seen.has(row.filename))
      throw new Error(`BASELINE_MISMATCH: duplicate applied migration ${row.filename}`);
    seen.add(row.filename);
    positions.set(row.filename, index);
    if (legacyNames.has(row.filename)) {
      if (separated)
        throw new Error(
          'BASELINE_MISMATCH: legacy migration lineage is incompatible with separated ledger mode.'
        );
      continue;
    }
    const migration = expected.get(row.filename);
    if (!migration) throw new Error(`BASELINE_MISMATCH: unknown applied migration ${row.filename}`);
    if (separated && row.checksum !== migration.sha256) {
      throw new Error(`MIGRATION_CHECKSUM_MISMATCH: ${row.filename}`);
    }
  }
  const legacyRows = result.rows.filter((row) => legacyNames.has(row.filename));
  if (legacyRows.length > 0) {
    if (
      legacyRows.length !== legacyLineage.filenames.length ||
      legacyRows.some((row, index) => row.filename !== legacyLineage.filenames[index])
    ) {
      throw new Error(
        'BASELINE_MISMATCH: legacy migration lineage must be the complete ordered suffix.'
      );
    }
    const anchorPosition = positions.get(legacyLineage.anchor);
    const firstLegacyPosition = positions.get(legacyRows[0].filename);
    if (
      anchorPosition === undefined ||
      !migrations.slice(0, HISTORICAL_BASELINE_COUNT).every((migration) => {
        const appliedPosition = positions.get(migration.filename);
        return appliedPosition !== undefined && appliedPosition < firstLegacyPosition;
      })
    ) {
      throw new Error(
        'BASELINE_MISMATCH: canonical historical baseline must precede legacy migration lineage.'
      );
    }
    if (
      anchorPosition >= firstLegacyPosition ||
      legacyRows.some((row) => row.applied_at == null || row.timestamp_count > 1)
    ) {
      throw new Error(
        'BASELINE_MISMATCH: legacy migration lineage does not follow its canonical anchor.'
      );
    }
    for (let index = 1; index < legacyRows.length; index += 1) {
      if (
        positions.get(legacyRows[index - 1].filename) >=
          positions.get(legacyRows[index].filename) ||
        legacyRows[index - 1].applied_at == null ||
        legacyRows[index].applied_at == null ||
        legacyRows[index].timestamp_count > 1
      ) {
        throw new Error('BASELINE_MISMATCH: legacy migration timestamps must strictly increase.');
      }
    }
    const appliedCanonical = new Set(
      result.rows.filter((row) => expected.has(row.filename)).map((row) => row.filename)
    );
    const expectedSequence = [
      ...migrations.slice(0, HISTORICAL_BASELINE_COUNT).map((migration) => migration.filename),
      ...legacyLineage.filenames,
      ...migrations
        .slice(HISTORICAL_BASELINE_COUNT)
        .filter((migration) => appliedCanonical.has(migration.filename))
        .map((migration) => migration.filename),
    ];
    if (
      result.rows.length !== expectedSequence.length ||
      result.rows.some((row, index) => row.filename !== expectedSequence[index])
    ) {
      throw new Error(
        'BASELINE_MISMATCH: applied migration history does not match the canonical and legacy sequence.'
      );
    }
  }
  return new Set(
    result.rows.filter((row) => !legacyNames.has(row.filename)).map((row) => row.filename)
  );
}

function assertGlobalOrder(migrations, applied) {
  let pending;
  for (const migration of migrations) {
    if (!applied.has(migration.filename)) pending ||= migration;
    else if (pending) {
      throw new Error(
        `Migration ledger is out of order: ${migration.filename} is applied before ${pending.filename}.`
      );
    }
  }
}

async function runMigration(client, migration, ledgerMode, { post020Applied = false } = {}) {
  await client.query('begin');
  try {
    if (migration.prefix >= 20) {
      if (!parseActivationGate()) throw new Error('PREPARED_CAPABILITIES_RESTRICTED_LANE_REQUIRED');
      if (migration.id === '020' && !post020Applied) {
        await attestPreparedCapabilities(client, { required: true });
      } else if (migration.filename === INVENTORY_MIGRATION && post020Applied) {
        if (await attestActivatedCapabilities(client, '020') !== 'active') {
          throw new Error('ACTIVATION_PENDING: 021 requires active 020 capabilities.');
        }
      } else {
        throw new Error('UNSUPPORTED_CAPABILITY_MIGRATION: no reviewed catalog transition.');
      }
    }
    await client.query(migration.sql);
    if (migration.prefix >= 20) {
      const activationState = await attestActivatedCapabilities(client, migration.filename === INVENTORY_MIGRATION ? '021' : '020');
      if (activationState === 'pending') console.log('ACTIVATION PENDING: post-020 grants are incomplete.');
    }
    if (ledgerMode === 'provenance') {
      await client.query(
        'insert into public.schema_migrations (filename, checksum, checksum_source) values ($1, $2, $3)',
        [migration.filename, migration.sha256, MIGRATION_FILE]
      );
    } else if (ledgerMode === 'checksummed') {
      await client.query(
        'insert into public.schema_migrations (filename, checksum) values ($1, $2)',
        [migration.filename, migration.sha256]
      );
    } else {
      await client.query('insert into public.schema_migrations (filename) values ($1)', [
        migration.filename,
      ]);
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

function firstPendingMigration(migrations, applied) {
  return migrations.find((migration) => !applied.has(migration.filename));
}

function assertNoMigrationAfterBoundary(migrations, applied, boundary = '019') {
  if (migrations.some((migration) => migration.prefix > Number(boundary) && applied.has(migration.filename)))
    throw new Error(`BOUNDARY_PASSED: a migration after ${boundary} is already applied.`);
}

async function assertBoundaryLedger(client, migrations, complete = true, boundary = '019') {
  const expected = migrations.filter((migration) => migration.prefix <= Number(boundary));
  if (expected.length !== Number(boundary) || expected.at(-1)?.id !== boundary) {
    throw new Error(`BOUNDARY_INVALID: canonical migrations 001–${boundary} are required.`);
  }
  const ledgerMode = await assertLedgerShape(client, true);
  const sourceColumn = ledgerMode === 'provenance' ? ', checksum_source' : '';
  const result = await client.query(
    `select filename, applied_at, checksum${sourceColumn},
            count(*) over (partition by applied_at) as timestamp_count
       from public.schema_migrations order by applied_at, filename`
  );
  // Reuse the canonical checksum/provenance validator; historical 011–017 may
  // legitimately have no checksum after a separately attested legacy adoption.
  if (ledgerMode === 'provenance') {
    validateEstablishedLedger(result.rows, migrations);
  } else {
    validateChecksummedLedger(result.rows, migrations);
  }
  if (
    result.rows.length > expected.length ||
    (complete && result.rows.length !== expected.length) ||
    result.rows.some((row, index) =>
      row.filename !== expected[index]?.filename ||
      (Number(row.timestamp_count) > 1 &&
        (ledgerMode !== 'provenance' || row.checksum_source === 'migration_file'))
    )
  ) {
    throw new Error(`BOUNDARY_INVALID: ledger exceeds ${boundary} or differs from the trusted ordered prefix.`);
  }
}

async function main() {
  const options = getOptions();
  const { manifest, migrations, legacyLineage } = loadManifestAndMigrations();
  const separated = parseActivationGate();
  const boundary = options.stopAfter || options.verifyBoundary;
  if (boundary && !migrations.some((entry) => entry.id === boundary))
    throw new Error(`BOUNDARY_INVALID: migration ${boundary} is missing from the trusted manifest.`);
  if (options.verifyBoundary && !separated)
    throw new Error('BOUNDARY_UNVERIFIABLE: legacy migration ledger does not store checksums.');
  const expectedPending = parseExpectedPending(migrations);
  const pgLockTimeout = parseBoundedTimeout('MIGRATION_PG_LOCK_TIMEOUT_MS');
  const statementTimeout = parseBoundedTimeout('MIGRATION_PG_STATEMENT_TIMEOUT_MS');

  if (options.dryRun && expectedPending === undefined) {
    for (const migration of migrations) {
      console.log(`${migration.filename} ${migration.lane} ${migration.sha256}`);
    }
    return;
  }

  const pool = new Pool({
    connectionString: getDatabaseUrl(options.lane, separated),
    max: 1,
    application_name: separated
      ? 'cocinacore-separated-migration-runner'
      : 'cocinacore-legacy-migration-runner',
    ...(pgLockTimeout === undefined ? {} : { lock_timeout: pgLockTimeout }),
    ...(statementTimeout === undefined ? {} : { statement_timeout: statementTimeout }),
  });
  const client = await pool.connect();
  let lockKey;
  try {
    if (separated && !options.verifyComplete && !options.verifyBoundary) {
      if (options.lane === 'bootstrap') await assertBootstrapIdentity(client);
      else await assertAndAssumeMigrationIdentity(client, manifest, migrations, separated);
    }
    if (options.dryRun) {
      await client.query('begin read only');
      try {
        const hasMigrationLedger = await migrationLedgerExists(client);
        if (!hasMigrationLedger) throw new Error('Migration ledger is missing.');
        const ledgerMode = await assertLedgerShape(client, separated);
        const applied = await getAppliedMigrations(client, migrations, ledgerMode, legacyLineage);
        assertGlobalOrder(migrations, applied);
        assertExpectedPending(migrations, applied, expectedPending, separated);
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
      for (const migration of migrations) {
        console.log(`${migration.filename} ${migration.lane} ${migration.sha256}`);
      }
      return;
    }

    if (!options.verifyComplete) {
      lockKey = await acquireDatabaseChangeLock(client);
    }

    let hadLedger;
    if (options.verifyComplete || options.verifyBoundary) {
      await client.query('begin read only');
      try {
        if (separated)
          await assertAndAssumeMigrationIdentity(client, manifest, migrations, separated);
        hadLedger = await migrationLedgerExists(client);
        if (!hadLedger) throw new Error('Migration ledger is missing.');
        const ledgerMode = await assertLedgerShape(client, separated);
        const applied = await getAppliedMigrations(client, migrations, ledgerMode, legacyLineage);
        assertGlobalOrder(migrations, applied);
        assertExpectedPending(migrations, applied, expectedPending, separated);
        if (options.verifyComplete) {
          const post020Applied = migrations.some((entry) => entry.prefix >= 20 && applied.has(entry.filename));
          if (post020Applied && await attestActivatedCapabilities(client, applied.has(INVENTORY_MIGRATION) ? '021' : '020') !== 'active')
            throw new Error('ACTIVATION_PENDING: post-020 LOGIN grants are incomplete.');
          const pending = firstPendingMigration(migrations, applied);
          if (pending) throw new Error(`Pending migration: ${pending.filename} (${pending.lane} lane).`);
        } else {
          assertNoMigrationAfterBoundary(migrations, applied);
          await assertBoundaryLedger(client, migrations);
        }
        await client.query('commit');
        if (options.verifyComplete) console.log('Migration ledger is complete.');
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
      if (separated) await assertRunnerExtensionState(client, manifest, { pgcryptoRequired: true });
      if (options.verifyBoundary) console.log('BOUNDARY 019 verified; later migrations are not verified.');
      return;
    }

    hadLedger = await migrationLedgerExists(client);
    if (options.stopAfter && hadLedger) {
      const ledgerMode = await assertLedgerShape(client, separated);
      const boundaryApplied = await getAppliedMigrations(client, migrations, ledgerMode, legacyLineage);
      assertGlobalOrder(migrations, boundaryApplied);
      assertNoMigrationAfterBoundary(migrations, boundaryApplied, options.stopAfter);
      if (separated) await assertBoundaryLedger(client, migrations, false, options.stopAfter);
    }
    if (expectedPending !== undefined) {
      if (hadLedger) {
        const ledgerMode = await assertLedgerShape(client, separated);
        const baselineApplied = await getAppliedMigrations(
          client,
          migrations,
          ledgerMode,
          legacyLineage
        );
        assertGlobalOrder(migrations, baselineApplied);
        assertExpectedPending(migrations, baselineApplied, expectedPending, separated);
      } else {
        throw new Error('MIGRATION_EXPECTED_PENDING requires an existing ledger.');
      }
    }
    if (separated) {
      await assertRunnerExtensionState(client, manifest, { pgcryptoRequired: hadLedger });
    }

    if (separated && !hadLedger && options.lane === 'bootstrap') {
      const first = migrations[0];
      console.log(`BOUNDARY ${first.filename} requires --lane ${first.lane}`);
      return;
    }

    const ledgerMode = separated
      ? await ensureSeparatedLedger(client)
      : await ensureLegacyLedger(client);
    const applied = await getAppliedMigrations(client, migrations, ledgerMode, legacyLineage);
    assertGlobalOrder(migrations, applied);
    assertExpectedPending(migrations, applied, expectedPending, separated);

    for (const migration of migrations) {
      if (applied.has(migration.filename)) {
        console.log(`SKIP ${migration.filename}`);
        if (options.stopAfter && migration.id === options.stopAfter) {
          if (separated) await assertBoundaryLedger(client, migrations, true, options.stopAfter);
          console.log(`BOUNDARY ${options.stopAfter} reached; later migrations remain unverified.`);
          return;
        }
        continue;
      }
      if (migration.lane !== options.lane) {
        console.log(`BOUNDARY ${migration.filename} requires --lane ${migration.lane}`);
        return;
      }
      console.log(`APPLY ${migration.filename}`);
      const post020Applied = migrations.some((entry) => entry.prefix >= 20 && applied.has(entry.filename));
      await runMigration(client, migration, ledgerMode, { post020Applied });
      applied.add(migration.filename);
      console.log(`DONE ${migration.filename}`);
      if (options.stopAfter && migration.id === options.stopAfter) {
        if (separated) await assertBoundaryLedger(client, migrations, true, options.stopAfter);
        console.log(`BOUNDARY ${options.stopAfter} reached; later migrations remain unverified.`);
        return;
      }
    }
    if (separated) await assertRunnerExtensionState(client, manifest, { pgcryptoRequired: true });
  } finally {
    try {
      if (lockKey !== undefined) await releaseDatabaseChangeLock(client, lockKey);
    } finally {
      client.release();
      await pool.end();
    }
  }
}

main().catch((error) => {
  const message = String(error.message || error).replace(
    /postgres(?:ql)?:\/\/[^\s]+/gi,
    'postgresql://[redacted]'
  );
  console.error('Migration failed:', message);
  process.exit(1);
});
