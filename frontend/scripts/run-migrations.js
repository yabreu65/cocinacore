#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

try {
  require('dotenv').config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });
} catch {
  // dotenv is a devDependency; deployment environments inject variables explicitly.
}

const MANIFEST_VERSION = 1;
const MIGRATION_LANE_VERSION = 1;
const MIGRATION_ROLE = 'migration_admin';
const SCHEMA_OWNER = 'cocinacore_schema_owner';
const LOCK_NAMESPACE_PREFIX = 'cocinacore:database-change:v1:';
const HISTORICAL_BASELINE_COUNT = 10;
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
  const laneIndex = process.argv.indexOf('--lane');
  const lane = laneIndex === -1 ? 'migration' : process.argv[laneIndex + 1];
  if (!LANES.has(lane)) {
    throw new Error('--lane must be exactly migration or bootstrap.');
  }
  return {
    lane,
    dryRun: process.argv.includes('--dry-run'),
    verifyComplete: process.argv.includes('--verify-complete'),
  };
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
      addition.kind !== 'constraint' ||
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
  if (manifest.manifestVersion !== MANIFEST_VERSION) {
    throw new Error(`Unsupported migration manifest version: ${manifest.manifestVersion}`);
  }
  if (manifest.migrationLaneVersion !== MIGRATION_LANE_VERSION) {
    throw new Error('Unsupported migration lane version.');
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
  return { directory, manifest, migrations };
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
        where n.nspname not like 'pg\_%' escape '\\'
          and n.nspname<>'information_schema'
       union all
       select null, a.grantee
         from pg_catalog.pg_namespace n
         cross join lateral pg_catalog.aclexplode(n.nspacl) a
        where n.nspname not like 'pg\_%' escape '\\'
          and n.nspname<>'information_schema'
       union all
       select c.relowner, a.grantee
         from pg_catalog.pg_class c
         join pg_catalog.pg_namespace n on n.oid=c.relnamespace
         left join lateral pg_catalog.aclexplode(c.relacl) a on true
        where n.nspname not like 'pg\_%' escape '\\'
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
        where n.nspname not like 'pg\_%' escape '\\'
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
        where n.nspname not like 'pg\_%' escape '\\'
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
        where n.nspname not like 'pg\_%' escape '\\'
          and n.nspname<>'information_schema'
       union all
       select o.oprowner, null
         from pg_catalog.pg_operator o
         join pg_catalog.pg_namespace n on n.oid=o.oprnamespace
        where n.nspname not like 'pg\_%' escape '\\'
          and n.nspname<>'information_schema'
       union all
       select o.opcowner, null
         from pg_catalog.pg_opclass o
         join pg_catalog.pg_namespace n on n.oid=o.opcnamespace
        where n.nspname not like 'pg\_%' escape '\\'
          and n.nspname<>'information_schema'
       union all
       select o.opfowner, null
         from pg_catalog.pg_opfamily o
         join pg_catalog.pg_namespace n on n.oid=o.opfnamespace
        where n.nspname not like 'pg\_%' escape '\\'
          and n.nspname<>'information_schema'
       union all
       select t.dictowner, null
         from pg_catalog.pg_ts_dict t
         join pg_catalog.pg_namespace n on n.oid=t.dictnamespace
        where n.nspname not like 'pg\_%' escape '\\'
          and n.nspname<>'information_schema'
       union all
       select t.cfgowner, null
         from pg_catalog.pg_ts_config t
         join pg_catalog.pg_namespace n on n.oid=t.cfgnamespace
        where n.nspname not like 'pg\_%' escape '\\'
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

async function assertSchemaOwnerDatabaseAuthority(client, manifest) {
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
  const hasLedger = await migrationLedgerExists(client);
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

async function assertAndAssumeMigrationIdentity(client, manifest) {
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
  await assertSchemaOwnerDatabaseAuthority(client, manifest);

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

async function assertLedgerShape(client, checksummed) {
  const columns = await client.query(`
    select a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type,
           a.attnotnull, pg_catalog.pg_get_expr(d.adbin, d.adrelid) as default_expression
      from pg_catalog.pg_attribute a
      left join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where a.attrelid = 'public.schema_migrations'::pg_catalog.regclass
       and a.attnum > 0 and not a.attisdropped
     order by a.attnum
  `);
  const expected = checksummed
    ? ['filename', 'applied_at', 'checksum']
    : ['filename', 'applied_at'];
  if (
    columns.rowCount !== expected.length ||
    columns.rows.some((row) => !expected.includes(row.attname))
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
    (checksummed && (checksum?.data_type !== 'text' || !checksum.attnotnull))
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
  await assertLedgerShape(client, true);
  const ownership = await client.query(`
    select pg_catalog.pg_get_userbyid(c.relowner) as owner
      from pg_catalog.pg_class c
     where c.oid = 'public.schema_migrations'::pg_catalog.regclass
  `);
  if (ownership.rows[0]?.owner !== SCHEMA_OWNER) {
    throw new Error('schema_migrations has an unexpected owner.');
  }
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
}

async function getAppliedMigrations(client, migrations, separated) {
  const columns = separated ? 'filename, checksum' : 'filename';
  const result = await client.query(
    `select ${columns} from public.schema_migrations order by filename`
  );
  const expected = new Map(migrations.map((migration) => [migration.filename, migration]));
  for (const row of result.rows) {
    const migration = expected.get(row.filename);
    if (!migration) throw new Error(`BASELINE_MISMATCH: unknown applied migration ${row.filename}`);
    if (separated && row.checksum !== migration.sha256) {
      throw new Error(`MIGRATION_CHECKSUM_MISMATCH: ${row.filename}`);
    }
  }
  return new Set(result.rows.map((row) => row.filename));
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

async function runMigration(client, migration, separated) {
  await client.query('begin');
  try {
    await client.query(migration.sql);
    if (separated) {
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

async function main() {
  const options = getOptions();
  const { manifest, migrations } = loadManifestAndMigrations();
  const separated = parseActivationGate();

  if (options.dryRun) {
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
  });
  const client = await pool.connect();
  let lockKey;
  try {
    if (separated) {
      if (options.lane === 'bootstrap') await assertBootstrapIdentity(client);
      else await assertAndAssumeMigrationIdentity(client, manifest);
    }
    lockKey = await acquireDatabaseChangeLock(client);

    const hadLedger = await migrationLedgerExists(client);
    if (separated) {
      await assertRunnerExtensionState(client, manifest, { pgcryptoRequired: hadLedger });
    }

    if (separated && !hadLedger && options.lane === 'bootstrap') {
      const first = migrations[0];
      console.log(`BOUNDARY ${first.filename} requires --lane ${first.lane}`);
      return;
    }

    if (separated) await ensureSeparatedLedger(client);
    else await ensureLegacyLedger(client);
    const applied = await getAppliedMigrations(client, migrations, separated);
    assertGlobalOrder(migrations, applied);

    if (options.verifyComplete) {
      const pending = firstPendingMigration(migrations, applied);
      if (pending)
        throw new Error(`Pending migration: ${pending.filename} (${pending.lane} lane).`);
      if (separated) await assertRunnerExtensionState(client, manifest, { pgcryptoRequired: true });
      console.log('Migration ledger is complete.');
      return;
    }

    for (const migration of migrations) {
      if (applied.has(migration.filename)) {
        console.log(`SKIP ${migration.filename}`);
        continue;
      }
      if (migration.lane !== options.lane) {
        console.log(`BOUNDARY ${migration.filename} requires --lane ${migration.lane}`);
        return;
      }
      console.log(`APPLY ${migration.filename}`);
      await runMigration(client, migration, separated);
      console.log(`DONE ${migration.filename}`);
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
