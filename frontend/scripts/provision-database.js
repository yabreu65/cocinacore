#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

try {
  require('dotenv').config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });
} catch {
  // dotenv is a devDependency; deployment environments inject variables explicitly.
}

const MIGRATION_ROLE = 'migration_admin';
const SCHEMA_OWNER = 'cocinacore_schema_owner';
const LOCK_NAMESPACE_PREFIX = 'cocinacore:database-change:v1:';
const MANIFEST_VERSION = 1;
const TRUSTED_BASE = '2069fc1f5a1ffc8407bd99cd91f9fadfbd04c6c4';
const HISTORICAL_BASELINE_COUNT = 10;
const MIGRATION_NAME = /^(\d{3})_[a-z0-9]+(?:_[a-z0-9]+)*(\.bootstrap)?\.sql$/;
const SHA256 = /^[0-9a-f]{64}$/;

function parseActivationGate(value = process.env.COCINACORE_SEPARATED_DB_LANES_ENABLED) {
  if (value === undefined || value === '') return false;
  const normalized = value.trim().toLowerCase();
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  throw new Error('COCINACORE_SEPARATED_DB_LANES_ENABLED must be an explicit true or false value.');
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} environment variable is required.`);
  return value;
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

function loadTrustedManifest() {
  const directory = resolveMigrationsDir();
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  } catch (error) {
    throw new Error(`Trusted migration manifest is unreadable: ${error.message}`);
  }
  if (
    !manifest ||
    manifest.manifestVersion !== MANIFEST_VERSION ||
    manifest.trustedBaseCommit !== TRUSTED_BASE ||
    manifest.migrationLaneVersion !== 1
  ) {
    throw new Error('Trusted migration manifest metadata is invalid.');
  }
  if (
    manifest.lockContract?.version !== 1 ||
    manifest.lockContract?.namespacePrefix !== LOCK_NAMESPACE_PREFIX ||
    manifest.lockContract?.scope !== 'session' ||
    manifest.lockContract?.derivation !==
      'pg_catalog.hashtextextended(namespacePrefix || current_database(), 0)'
  ) {
    throw new Error('Trusted migration lock contract is invalid.');
  }
  if (
    !Array.isArray(manifest.migrations) ||
    !Array.isArray(manifest.baselineObjects?.transferable)
  ) {
    throw new Error('Trusted migration manifest structure is invalid.');
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
  if (
    manifest.baselineObjects.transferable.length !== 38 ||
    manifest.baselineObjects.expectedCounts?.transferable !== 38
  ) {
    throw new Error('Trusted ownership allowlist must contain exactly 38 targets.');
  }

  const names = new Set();
  const ids = new Set();
  const catalogAdditions = new Set();
  let previous = 0;
  for (const entry of manifest.migrations) {
    const match = entry.filename?.match(MIGRATION_NAME);
    if (!match || entry.id !== match[1] || Number(entry.id) !== previous + 1) {
      throw new Error(`Trusted manifest migration ordering is invalid at ${entry.filename}.`);
    }
    previous = Number(entry.id);
    if (names.has(entry.filename) || ids.has(entry.id)) {
      throw new Error(`Trusted manifest contains a duplicate migration: ${entry.filename}.`);
    }
    names.add(entry.filename);
    ids.add(entry.id);
    const expectedLane = match[2] ? 'bootstrap' : 'migration';
    if (
      entry.lane !== expectedLane ||
      entry.transactional !== 'required' ||
      !SHA256.test(entry.sha256 || '') ||
      !Number.isSafeInteger(entry.byteLength) ||
      entry.byteLength < 1 ||
      typeof entry.legacyChecksumBackfillAllowed !== 'boolean'
    ) {
      throw new Error(`Trusted manifest migration metadata is invalid: ${entry.filename}.`);
    }
    const historical = previous <= HISTORICAL_BASELINE_COUNT;
    if (entry.legacyChecksumBackfillAllowed !== historical) {
      throw new Error(`Trusted historical migration metadata is invalid: ${entry.filename}.`);
    }
    if (historical && entry.catalogAdditions !== undefined) {
      throw new Error(`Historical migration cannot declare catalog additions: ${entry.filename}.`);
    }
    if (entry.catalogAdditions !== undefined) {
      if (!Array.isArray(entry.catalogAdditions)) {
        throw new Error(`Trusted catalog additions are invalid: ${entry.filename}.`);
      }
      for (const addition of entry.catalogAdditions) {
        if (
          !addition ||
          typeof addition !== 'object' ||
          Array.isArray(addition) ||
          Object.keys(addition).sort().join(',') !== 'identity,kind,schema' ||
          addition.kind !== 'constraint' ||
          !['internal', 'public'].includes(addition.schema) ||
          !/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(addition.identity)
        ) {
          throw new Error(`Trusted catalog addition is unsupported: ${entry.filename}.`);
        }
        const key = `${addition.kind}|${addition.schema}|${addition.identity}`;
        if (catalogAdditions.has(key)) throw new Error(`Duplicate trusted catalog addition: ${key}`);
        catalogAdditions.add(key);
      }
    }
    const bytes = fs.readFileSync(path.join(directory, entry.filename));
    const checksum = crypto.createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== entry.byteLength || checksum !== entry.sha256) {
      throw new Error(`MIGRATION_CHECKSUM_MISMATCH: trusted file ${entry.filename}`);
    }
  }
  if (manifest.migrations.length < HISTORICAL_BASELINE_COUNT) {
    throw new Error('Trusted historical migration baseline is incomplete.');
  }
  const sqlNames = fs.readdirSync(directory).filter((name) => name.endsWith('.sql'));
  if (
    sqlNames.length !== names.size ||
    sqlNames.some((name) => !names.has(name)) ||
    [...names].some((name) => !sqlNames.includes(name))
  ) {
    throw new Error('Migration manifest and SQL files are not an exact bijection.');
  }

  const objectKeys = new Set();
  const objectKindCounts = { schema: 0, table: 0, function: 0 };
  for (const object of manifest.baselineObjects.transferable) {
    if (
      !['schema', 'table', 'function'].includes(object.kind) ||
      !object.schema ||
      !object.name ||
      !object.expectedLegacyOwner ||
      object.targetOwner !== SCHEMA_OWNER
    ) {
      throw new Error('Trusted ownership target is malformed.');
    }
    const key = `${object.kind}|${object.schema}|${object.name}|${object.arguments || ''}`;
    if (objectKeys.has(key)) throw new Error(`Duplicate trusted ownership target: ${key}`);
    objectKeys.add(key);
    objectKindCounts[object.kind] += 1;
    const expectedLegacyOwner =
      object.kind === 'schema' && object.schema === 'public' ? 'pg_database_owner' : 'cocinacore';
    if (object.expectedLegacyOwner !== expectedLegacyOwner) {
      throw new Error(`Trusted legacy owner policy is invalid: ${key}`);
    }
  }
  if (
    objectKindCounts.schema !== 2 ||
    objectKindCounts.table !== 29 ||
    objectKindCounts.function !== 7 ||
    manifest.baselineObjects.dependent?.indexes?.length !== 94 ||
    manifest.baselineObjects.dependent?.constraints?.length !== 112 ||
    manifest.baselineObjects.dependent?.types?.length !== 61
  ) {
    throw new Error('Trusted catalog inventory counts are invalid.');
  }
  if (
    manifest.roles?.migrationAdmin?.name !== MIGRATION_ROLE ||
    manifest.roles?.schemaOwner?.name !== SCHEMA_OWNER ||
    manifest.publicSchemaAcl?.publicUsage !== true ||
    manifest.publicSchemaAcl?.publicCreate !== false
  ) {
    throw new Error('Trusted role or schema ACL contract is invalid.');
  }
  const migrationRole = manifest.roles.migrationAdmin;
  const schemaRole = manifest.roles.schemaOwner;
  for (const [role, login] of [
    [migrationRole, true],
    [schemaRole, false],
  ]) {
    if (
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
      throw new Error(`Trusted role declaration is invalid: ${role.name}.`);
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
  const extensionContracts = new Map(
    (manifest.extensions || []).map((extension) => [extension.name, extension])
  );
  const expectedExtensions = {
    vector: {
      bootstrapManaged: true,
      preinstalled: false,
      expectedSchema: 'public',
      versionPolicy: 'compatible-capabilities',
      ownerPolicy: 'administrative-superuser',
      installMigration: '001_extensions_and_core.sql',
    },
    pgcrypto: {
      bootstrapManaged: false,
      preinstalled: false,
      expectedSchema: 'public',
      versionPolicy: 'presence-only',
      ownerPolicy: 'schema-owner-or-administrative-superuser',
      installMigration: '001_extensions_and_core.sql',
    },
    plpgsql: {
      bootstrapManaged: false,
      preinstalled: true,
      expectedSchema: 'pg_catalog',
      versionPolicy: 'presence-only',
      ownerPolicy: 'administrative-superuser',
      installMigration: null,
    },
  };
  const expectedMemberCounts = { vector: 234, pgcrypto: 36, plpgsql: 4 };
  if (manifest.extensions.length !== 3 || extensionContracts.size !== 3) {
    throw new Error('Trusted extension declaration is invalid.');
  }
  for (const [name, expected] of Object.entries(expectedExtensions)) {
    const declared = extensionContracts.get(name);
    if (
      !declared ||
      declared.required !== true ||
      declared.extensionManaged !== true ||
      declared.expectedMemberCount !== expectedMemberCounts[name] ||
      !SHA256.test(declared.expectedMemberIdentitySha256 || '') ||
      !Array.isArray(declared.capabilities)
    ) {
      throw new Error(`Trusted extension declaration is invalid: ${name}.`);
    }
    for (const [field, value] of Object.entries(expected)) {
      if (declared[field] !== value) {
        throw new Error(`Trusted extension declaration is invalid: ${name}.${field}.`);
      }
    }
  }
  const vectorCapabilities = extensionContracts.get('vector').capabilities;
  const requiredVectorCapabilities = [
    'type:public.vector',
    'operator:public.<=>(public.vector,public.vector)',
    'accessMethod:hnsw',
    'operatorClass:public.vector_cosine_ops',
  ];
  if (
    vectorCapabilities.length !== requiredVectorCapabilities.length ||
    requiredVectorCapabilities.some((capability) => !vectorCapabilities.includes(capability))
  ) {
    throw new Error('Trusted vector capability declaration is invalid.');
  }
  return manifest;
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
      `ROLE_STATE_MISMATCH: reserved role ${role?.rolname || 'missing'} has unexpected attributes.`
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
      'MIGRATION_IDENTITY_MISMATCH: BOOTSTRAP_DATABASE_URL must authenticate directly as a PostgreSQL superuser.'
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

async function inspectReservedRoles(client) {
  const roles = await client.query(
    `select rolname, rolcanlogin, rolinherit, rolsuper, rolcreatedb, rolcreaterole,
            rolreplication, rolbypassrls, rolconnlimit, rolvaliduntil, rolconfig
       from pg_catalog.pg_roles
      where rolname = any($1::text[])
      order by rolname`,
    [[MIGRATION_ROLE, SCHEMA_OWNER]]
  );
  if (roles.rowCount === 0) return 'absent';
  if (roles.rowCount !== 2) {
    throw new Error('ROLE_STATE_MISMATCH: reserved database roles are only partially provisioned.');
  }
  const byName = new Map(roles.rows.map((role) => [role.rolname, role]));
  assertRole(byName.get(MIGRATION_ROLE), true);
  assertRole(byName.get(SCHEMA_OWNER), false);

  const memberships = await client.query(
    `select parent.rolname as granted_role, member.rolname as member_role,
            m.admin_option, m.inherit_option, m.set_option
       from pg_catalog.pg_auth_members m
       join pg_catalog.pg_roles parent on parent.oid = m.roleid
       join pg_catalog.pg_roles member on member.oid = m.member
      where parent.rolname = any($1::text[]) or member.rolname = any($1::text[])
      order by granted_role, member_role`,
    [[MIGRATION_ROLE, SCHEMA_OWNER]]
  );
  if (
    memberships.rowCount !== 1 ||
    memberships.rows[0].granted_role !== SCHEMA_OWNER ||
    memberships.rows[0].member_role !== MIGRATION_ROLE ||
    memberships.rows[0].admin_option ||
    memberships.rows[0].inherit_option ||
    !memberships.rows[0].set_option
  ) {
    throw new Error('ROLE_STATE_MISMATCH: reserved database roles have unexpected memberships.');
  }
  return 'established';
}

async function directDatabasePrivileges(client, role) {
  const result = await client.query(
    `select a.privilege_type
       from pg_catalog.pg_database d
       cross join lateral pg_catalog.aclexplode(coalesce(d.datacl, pg_catalog.acldefault('d', d.datdba))) a
      where d.datname = current_database()
        and a.grantee = (select oid from pg_catalog.pg_roles where rolname = $1)
      order by a.privilege_type`,
    [role]
  );
  return result.rows.map((row) => row.privilege_type);
}

async function assertReservedRoleAclState(client) {
  const migrationDatabaseAcl = await directDatabasePrivileges(client, MIGRATION_ROLE);
  const ownerDatabaseAcl = await directDatabasePrivileges(client, SCHEMA_OWNER);
  if (migrationDatabaseAcl.join(',') !== 'CONNECT') {
    throw new Error('ROLE_STATE_MISMATCH: migration_admin database ACL is not exactly CONNECT.');
  }
  if (ownerDatabaseAcl.join(',') !== 'CREATE') {
    throw new Error('ROLE_STATE_MISMATCH: schema owner database ACL is not exactly CREATE.');
  }

  const unexpectedAcl = await client.query(
    `with reserved as (
       select oid from pg_catalog.pg_roles where rolname = any($1::text[])
     ), grants as (
       select a.grantee
         from pg_catalog.pg_namespace n
         cross join lateral pg_catalog.aclexplode(coalesce(n.nspacl, pg_catalog.acldefault('n', n.nspowner))) a
        where n.nspname in ('public', 'internal')
       union all
       select a.grantee
         from pg_catalog.pg_class c
         join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         cross join lateral pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault((case when c.relkind = 'S' then 'S' else 'r' end)::"char", c.relowner))) a
        where n.nspname in ('public', 'internal') and c.relkind in ('r','p','S','v','m','f')
       union all
       select a.grantee
         from pg_catalog.pg_proc p
         join pg_catalog.pg_namespace n on n.oid = p.pronamespace
         cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
        where n.nspname in ('public', 'internal')
     )
     select count(*)::integer as count
       from grants where grantee = (select oid from pg_catalog.pg_roles where rolname = $2)`,
    [[MIGRATION_ROLE, SCHEMA_OWNER], MIGRATION_ROLE]
  );
  if (unexpectedAcl.rows[0].count !== 0) {
    throw new Error('ROLE_STATE_MISMATCH: migration_admin has unexpected direct privileges.');
  }

  const unexpectedSchemaOwnerAcl = await client.query(
    `with grants as (
       select n.nspowner as owner, a.grantee
         from pg_catalog.pg_namespace n
         cross join lateral pg_catalog.aclexplode(n.nspacl) a
        where n.nspname in ('public', 'internal')
       union all
       select c.relowner, a.grantee
         from pg_catalog.pg_class c
         join pg_catalog.pg_namespace n on n.oid=c.relnamespace
         cross join lateral pg_catalog.aclexplode(c.relacl) a
        where n.nspname in ('public', 'internal') and c.relkind in ('r','p','S','v','m','f')
       union all
       select p.proowner, a.grantee
         from pg_catalog.pg_proc p
         join pg_catalog.pg_namespace n on n.oid=p.pronamespace
         cross join lateral pg_catalog.aclexplode(p.proacl) a
        where n.nspname in ('public', 'internal')
     )
     select count(*)::integer as count from grants
      where grantee=(select oid from pg_catalog.pg_roles where rolname=$1)
        and owner<>grantee`,
    [SCHEMA_OWNER]
  );
  if (unexpectedSchemaOwnerAcl.rows[0].count !== 0) {
    throw new Error('ROLE_STATE_MISMATCH: schema owner has unexpected direct privileges.');
  }

  const defaults = await client.query(
    `select count(*)::integer as count
       from pg_catalog.pg_default_acl d
       cross join lateral pg_catalog.aclexplode(d.defaclacl) a
      where d.defaclrole in (select oid from pg_catalog.pg_roles where rolname = any($1::text[]))
         or a.grantee in (select oid from pg_catalog.pg_roles where rolname = any($1::text[]))`,
    [[MIGRATION_ROLE, SCHEMA_OWNER]]
  );
  if (defaults.rows[0].count !== 0) {
    throw new Error('ROLE_STATE_MISMATCH: reserved roles have unexpected default privileges.');
  }

  const databaseSettings = await client.query(
    `select count(*)::integer as count
       from pg_catalog.pg_db_role_setting s
      where s.setrole in (
        select oid from pg_catalog.pg_roles where rolname=any($1::text[])
      )`,
    [[MIGRATION_ROLE, SCHEMA_OWNER]]
  );
  if (databaseSettings.rows[0].count !== 0) {
    throw new Error('ROLE_STATE_MISMATCH: reserved roles have unexpected database settings.');
  }

  const clusterDatabaseAuthority = await client.query(
    `with reserved as (
       select oid from pg_catalog.pg_roles where rolname=any($1::text[])
     ), database_grants as (
       select d.datname, d.datdba as owner, a.grantee, a.privilege_type
         from pg_catalog.pg_database d
         cross join lateral pg_catalog.aclexplode(
           coalesce(d.datacl, pg_catalog.acldefault('d', d.datdba))
         ) a
     )
     select count(*)::integer as count
       from database_grants g
      where (g.owner in (select oid from reserved)
         or g.grantee in (select oid from reserved))
        and not (
          g.datname=current_database()
          and g.owner not in (select oid from reserved)
          and (
            (g.grantee=(select oid from pg_catalog.pg_roles where rolname=$2)
             and g.privilege_type='CONNECT')
            or
            (g.grantee=(select oid from pg_catalog.pg_roles where rolname=$3)
             and g.privilege_type='CREATE')
          )
        )`,
    [[MIGRATION_ROLE, SCHEMA_OWNER], MIGRATION_ROLE, SCHEMA_OWNER]
  );
  if (clusterDatabaseAuthority.rows[0].count !== 0) {
    throw new Error('ROLE_STATE_MISMATCH: reserved roles have unexpected database authority.');
  }

  const tablespaceAuthority = await client.query(
    `select count(*)::integer as count
       from pg_catalog.pg_tablespace t
       left join lateral pg_catalog.aclexplode(t.spcacl) a on true
      where t.spcowner in (
              select oid from pg_catalog.pg_roles where rolname=any($1::text[])
            )
         or a.grantee in (
              select oid from pg_catalog.pg_roles where rolname=any($1::text[])
            )`,
    [[MIGRATION_ROLE, SCHEMA_OWNER]]
  );
  if (tablespaceAuthority.rows[0].count !== 0) {
    throw new Error('ROLE_STATE_MISMATCH: reserved roles have unexpected tablespace authority.');
  }

  const publicAcl = await client.query(`
    select pg_catalog.has_schema_privilege('public', 'public', 'USAGE') as public_usage,
           pg_catalog.has_schema_privilege('public', 'public', 'CREATE') as public_create
  `);
  if (!publicAcl.rows[0].public_usage || publicAcl.rows[0].public_create) {
    throw new Error('ROLE_STATE_MISMATCH: public schema ACL does not match the trusted contract.');
  }
}

function compareExact(actual, expected, label) {
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  if (
    actualSorted.length !== expectedSorted.length ||
    actualSorted.some((value, index) => value !== expectedSorted[index])
  ) {
    const expectedSet = new Set(expectedSorted);
    const actualSet = new Set(actualSorted);
    const unexpected = actualSorted.find((value) => !expectedSet.has(value));
    const missing = expectedSorted.find((value) => !actualSet.has(value));
    throw new Error(
      `BASELINE_MISMATCH: ${label} mismatch${unexpected ? `; unexpected ${unexpected}` : ''}${missing ? `; missing ${missing}` : ''}.`
    );
  }
}

async function extensionCatalog(client, name) {
  const result = await client.query(
    `select e.extname as name, e.extversion as version, n.nspname as schema,
            r.rolname as owner, r.rolsuper as owner_superuser,
            exists (
              select 1 from pg_catalog.pg_available_extension_versions a
               where a.name=e.extname and a.version=e.extversion
            ) as advertised
       from pg_catalog.pg_extension e
       join pg_catalog.pg_namespace n on n.oid=e.extnamespace
       join pg_catalog.pg_roles r on r.oid=e.extowner
      where e.extname=$1`,
    [name]
  );
  return result.rows[0];
}

async function extensionAvailable(client, name) {
  const result = await client.query(
    `select exists (
       select 1 from pg_catalog.pg_available_extension_versions where name=$1
     ) as available`,
    [name]
  );
  return result.rows[0].available;
}

async function assertVectorCapabilities(client) {
  const result = await client.query(`
    select pg_catalog.to_regtype('public.vector') is not null as vector_type,
           pg_catalog.to_regoperator('public.<=>(public.vector,public.vector)') is not null as cosine_operator,
           exists (select 1 from pg_catalog.pg_am where amname='hnsw') as hnsw,
           exists (
             select 1 from pg_catalog.pg_opclass o
             join pg_catalog.pg_namespace n on n.oid=o.opcnamespace
             where n.nspname='public' and o.opcname='vector_cosine_ops'
           ) as cosine_opclass
  `);
  const capabilities = result.rows[0];
  if (
    !capabilities.vector_type ||
    !capabilities.cosine_operator ||
    !capabilities.hnsw ||
    !capabilities.cosine_opclass
  ) {
    throw new Error('VECTOR_STATE_MISMATCH: required vector capabilities are absent.');
  }
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

async function assertExtensionState(client, manifest, name, { allowAbsent = false } = {}) {
  const contract = manifest.extensions.find((extension) => extension.name === name);
  const errorId = name === 'vector' ? 'VECTOR_STATE_MISMATCH' : 'BASELINE_MISMATCH';
  const state = await extensionCatalog(client, name);
  if (!state) {
    if (allowAbsent) return false;
    throw new Error(`${errorId}: required extension ${name} is not installed.`);
  }
  if (state.schema !== contract.expectedSchema || !state.version || !state.advertised) {
    throw new Error(`${errorId}: extension ${name} has an invalid catalog state.`);
  }
  if (
    contract.ownerPolicy === 'administrative-superuser' &&
    (!state.owner_superuser || [MIGRATION_ROLE, SCHEMA_OWNER].includes(state.owner))
  ) {
    throw new Error(`${errorId}: extension ${name} owner is not an allowed administrator.`);
  }
  if (
    contract.ownerPolicy === 'schema-owner-or-administrative-superuser' &&
    state.owner !== SCHEMA_OWNER &&
    !state.owner_superuser
  ) {
    throw new Error(`${errorId}: extension ${name} owner is outside policy.`);
  }
  if (name === 'vector') await assertVectorCapabilities(client);
  await assertExtensionMembers(client, contract);
  return true;
}

async function provisionOrAttestExtensions(client, manifest, { established }) {
  if (!(await extensionAvailable(client, 'vector'))) {
    throw new Error(
      'VECTOR_NOT_AVAILABLE: vector must be supplied by the approved PostgreSQL server image.'
    );
  }
  if (!(await extensionAvailable(client, 'pgcrypto'))) {
    throw new Error('BASELINE_MISMATCH: pgcrypto is unavailable on the PostgreSQL server.');
  }
  if (!(await extensionAvailable(client, 'plpgsql'))) {
    throw new Error('BASELINE_MISMATCH: plpgsql is unavailable on the PostgreSQL server.');
  }

  const hasVector = await assertExtensionState(client, manifest, 'vector', {
    allowAbsent: !established,
  });
  if (!hasVector) {
    await client.query('create extension vector with schema public');
    await assertExtensionState(client, manifest, 'vector');
  }
  await assertExtensionState(client, manifest, 'plpgsql');
  await assertExtensionState(client, manifest, 'pgcrypto', { allowAbsent: !established });
}

async function preflightExtensions(client, manifest, { established }) {
  if (!(await extensionAvailable(client, 'vector'))) {
    throw new Error(
      'VECTOR_NOT_AVAILABLE: vector must be supplied by the approved PostgreSQL server image.'
    );
  }
  if (!(await extensionAvailable(client, 'pgcrypto'))) {
    throw new Error('BASELINE_MISMATCH: pgcrypto is unavailable on the PostgreSQL server.');
  }
  if (!(await extensionAvailable(client, 'plpgsql'))) {
    throw new Error('BASELINE_MISMATCH: plpgsql is unavailable on the PostgreSQL server.');
  }
  await assertExtensionState(client, manifest, 'vector', { allowAbsent: !established });
  await assertExtensionState(client, manifest, 'pgcrypto', { allowAbsent: !established });
  await assertExtensionState(client, manifest, 'plpgsql');
}

async function getCatalog(client) {
  const schemas = await client.query(`
    select n.nspname as identity, pg_catalog.pg_get_userbyid(n.nspowner) as owner
      from pg_catalog.pg_namespace n
     where n.nspname in ('public', 'internal')
     order by n.nspname
  `);
  const tables = await client.query(`
    select n.nspname || '.' || c.relname as identity, pg_catalog.pg_get_userbyid(c.relowner) as owner
      from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('public', 'internal') and c.relkind in ('r','p')
       and not exists (select 1 from pg_catalog.pg_depend d where d.classid='pg_catalog.pg_class'::pg_catalog.regclass and d.objid=c.oid and d.deptype='e')
     order by identity
  `);
  const otherRelations = await client.query(`
    select n.nspname || '.' || c.relname as identity
      from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('public', 'internal') and c.relkind in ('S','v','m','f')
       and not exists (select 1 from pg_catalog.pg_depend d where d.classid='pg_catalog.pg_class'::pg_catalog.regclass and d.objid=c.oid and d.deptype='e')
     order by identity
  `);
  const functions = await client.query(`
    select n.nspname || '.' || p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' as identity,
           pg_catalog.pg_get_userbyid(p.proowner) as owner, p.prosecdef as security_definer
      from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'internal')
       and not exists (select 1 from pg_catalog.pg_depend d where d.classid='pg_catalog.pg_proc'::pg_catalog.regclass and d.objid=p.oid and d.deptype='e')
     order by identity
  `);
  const indexes = await client.query(`
    select n.nspname || '.' || t.relname || '.' || i.relname as identity
      from pg_catalog.pg_index x
      join pg_catalog.pg_class i on i.oid=x.indexrelid
      join pg_catalog.pg_class t on t.oid=x.indrelid
      join pg_catalog.pg_namespace n on n.oid=t.relnamespace
     where n.nspname in ('public','internal')
     order by identity
  `);
  const constraints = await client.query(`
    select n.nspname || '.' || c.relname || '.' || x.conname as identity
      from pg_catalog.pg_constraint x
      join pg_catalog.pg_class c on c.oid=x.conrelid
      join pg_catalog.pg_namespace n on n.oid=c.relnamespace
     where n.nspname in ('public','internal')
     order by identity
  `);
  const types = await client.query(`
    select n.nspname || '.' || t.typname as identity
      from pg_catalog.pg_type t join pg_catalog.pg_namespace n on n.oid=t.typnamespace
     where n.nspname in ('public','internal')
       and not exists (select 1 from pg_catalog.pg_depend d where d.classid='pg_catalog.pg_type'::pg_catalog.regclass and d.objid=t.oid and d.deptype='e')
     order by identity
  `);
  const triggers = await client.query(`
    select n.nspname || '.' || c.relname || '.' || t.tgname as identity
      from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid
      join pg_catalog.pg_namespace n on n.oid=c.relnamespace
     where n.nspname in ('public','internal') and not t.tgisinternal
     order by identity
  `);
  const extensions = await client.query(`
    select e.extname || '@' || n.nspname as identity
      from pg_catalog.pg_extension e join pg_catalog.pg_namespace n on n.oid=e.extnamespace
     order by identity
  `);
  return {
    schemas,
    tables,
    otherRelations,
    functions,
    indexes,
    constraints,
    types,
    triggers,
    extensions,
  };
}

function expectedCatalog(manifest, appliedMigrations) {
  const transferable = manifest.baselineObjects.transferable;
  const expected = {
    schemas: transferable.filter((o) => o.kind === 'schema').map((o) => o.schema),
    tables: transferable.filter((o) => o.kind === 'table').map((o) => `${o.schema}.${o.name}`),
    functions: transferable
      .filter((o) => o.kind === 'function')
      .map((o) => `${o.schema}.${o.name}(${o.arguments})`),
    indexes: manifest.baselineObjects.dependent.indexes.map((o) => `${o.schema}.${o.identity}`),
    constraints: manifest.baselineObjects.dependent.constraints.map(
      (o) => `${o.schema}.${o.identity}`
    ),
    types: manifest.baselineObjects.dependent.types.map((o) => `${o.schema}.${o.name}`),
    extensions: manifest.extensions.map((o) => `${o.name}@${o.expectedSchema}`),
  };
  for (const migration of manifest.migrations) {
    if (!appliedMigrations.has(migration.filename)) continue;
    for (const addition of migration.catalogAdditions || []) {
      if (addition.kind === 'constraint') {
        expected.constraints.push(`${addition.schema}.${addition.identity}`);
      }
    }
  }
  return expected;
}

async function ledgerExists(client) {
  const result = await client.query(
    "select pg_catalog.to_regclass('public.schema_migrations') is not null as exists"
  );
  return result.rows[0].exists;
}

async function ledgerColumns(client) {
  return client.query(`
    select a.attname, pg_catalog.format_type(a.atttypid,a.atttypmod) as data_type, a.attnotnull,
           pg_catalog.pg_get_expr(d.adbin,d.adrelid) as default_expression
      from pg_catalog.pg_attribute a
      left join pg_catalog.pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
     where a.attrelid='public.schema_migrations'::pg_catalog.regclass
       and a.attnum>0 and not a.attisdropped order by a.attnum
  `);
}

async function attestLedger(client, manifest, established) {
  const columns = await ledgerColumns(client);
  const names = columns.rows.map((row) => row.attname).sort();
  compareExact(
    names,
    established ? ['applied_at', 'checksum', 'filename'] : ['applied_at', 'filename'],
    'Legacy ledger columns'
  );
  const filename = columns.rows.find((column) => column.attname === 'filename');
  const appliedAt = columns.rows.find((column) => column.attname === 'applied_at');
  const checksum = columns.rows.find((column) => column.attname === 'checksum');
  if (
    filename?.data_type !== 'text' ||
    !filename.attnotnull ||
    appliedAt?.data_type !== 'timestamp with time zone' ||
    !appliedAt.attnotnull ||
    appliedAt.default_expression !== 'now()' ||
    (established && (checksum?.data_type !== 'text' || !checksum.attnotnull))
  ) {
    throw new Error('BASELINE_MISMATCH: migration ledger column contract is invalid.');
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
      'BASELINE_MISMATCH: migration ledger security/primary-key contract is invalid.'
    );
  }
  const rows = await client.query(
    established
      ? 'select filename, checksum from public.schema_migrations order by filename'
      : 'select filename, null::text as checksum from public.schema_migrations order by filename'
  );
  const expected = established
    ? manifest.migrations.slice(0, rows.rowCount)
    : manifest.migrations.filter((entry) => entry.legacyChecksumBackfillAllowed);
  compareExact(
    rows.rows.map((row) => row.filename),
    expected.map((entry) => entry.filename),
    established ? 'Established ledger migration prefix' : 'Legacy ledger migration set'
  );
  if (established) {
    const expectedByName = new Map(expected.map((entry) => [entry.filename, entry.sha256]));
    for (const row of rows.rows) {
      if (row.checksum !== expectedByName.get(row.filename)) {
        throw new Error(`MIGRATION_CHECKSUM_MISMATCH: ${row.filename}`);
      }
    }
  }
  return new Set(rows.rows.map((row) => row.filename));
}

async function attestBaselineCatalog(client, manifest, ownerState, appliedMigrations) {
  const catalog = await getCatalog(client);
  const expected = expectedCatalog(manifest, appliedMigrations);
  compareExact(
    catalog.schemas.rows.map((row) => row.identity),
    expected.schemas,
    'Managed schema set'
  );
  compareExact(
    catalog.tables.rows.map((row) => row.identity),
    expected.tables,
    'Managed table set'
  );
  compareExact(
    catalog.otherRelations.rows.map((row) => row.identity),
    [],
    'Managed standalone relation set'
  );
  compareExact(
    catalog.functions.rows.map((row) => row.identity),
    expected.functions,
    'Managed function set'
  );
  compareExact(
    catalog.indexes.rows.map((row) => row.identity),
    expected.indexes,
    'Managed index set'
  );
  compareExact(
    catalog.constraints.rows.map((row) => row.identity),
    expected.constraints,
    'Managed constraint set'
  );
  compareExact(
    catalog.types.rows.map((row) => row.identity),
    expected.types,
    'Managed type set'
  );
  compareExact(
    catalog.triggers.rows.map((row) => row.identity),
    [],
    'Managed trigger set'
  );
  compareExact(
    catalog.extensions.rows.map((row) => row.identity),
    expected.extensions,
    'Extension set'
  );
  if (catalog.functions.rows.some((row) => row.security_definer)) {
    throw new Error('Managed function security mode differs from the trusted baseline.');
  }

  const byKey = new Map(
    manifest.baselineObjects.transferable.map((object) => [
      object.kind === 'function'
        ? `${object.kind}|${object.schema}.${object.name}(${object.arguments})`
        : object.kind === 'schema'
          ? `${object.kind}|${object.schema}`
          : `${object.kind}|${object.schema}.${object.name}`,
      object,
    ])
  );
  for (const [kind, rows] of [
    ['schema', catalog.schemas.rows],
    ['table', catalog.tables.rows],
    ['function', catalog.functions.rows],
  ]) {
    for (const row of rows) {
      const object = byKey.get(`${kind}|${row.identity}`);
      const expectedOwner =
        ownerState === 'legacy' ? object.expectedLegacyOwner : object.targetOwner;
      if (row.owner !== expectedOwner) {
        throw new Error(`BASELINE_MISMATCH: unexpected owner for ${kind} ${row.identity}.`);
      }
    }
  }
}

async function attestFreshCatalog(client, manifest, ownerState) {
  const catalog = await getCatalog(client);
  compareExact(
    catalog.schemas.rows.map((row) => row.identity),
    ['public'],
    'Fresh managed schema set'
  );
  compareExact(
    catalog.tables.rows.map((row) => row.identity),
    [],
    'Fresh table set'
  );
  compareExact(
    catalog.otherRelations.rows.map((row) => row.identity),
    [],
    'Fresh standalone relation set'
  );
  compareExact(
    catalog.functions.rows.map((row) => row.identity),
    [],
    'Fresh function set'
  );
  compareExact(
    catalog.indexes.rows.map((row) => row.identity),
    [],
    'Fresh index set'
  );
  compareExact(
    catalog.constraints.rows.map((row) => row.identity),
    [],
    'Fresh constraint set'
  );
  const allowedVectorArrayTypes = new Set([
    'public._halfvec',
    'public._sparsevec',
    'public._vector',
  ]);
  if (catalog.types.rows.some((row) => !allowedVectorArrayTypes.has(row.identity))) {
    throw new Error('BASELINE_MISMATCH: fresh database contains an unexpected ordinary type.');
  }
  compareExact(
    catalog.triggers.rows.map((row) => row.identity),
    [],
    'Fresh trigger set'
  );
  const allowedExtensionNames = new Set(manifest.extensions.map((extension) => extension.name));
  if (
    catalog.extensions.rows.some(
      (row) => !allowedExtensionNames.has(row.identity.slice(0, row.identity.indexOf('@')))
    )
  ) {
    throw new Error('BASELINE_MISMATCH: fresh database contains an unexpected extension.');
  }
  const publicOwner = catalog.schemas.rows[0]?.owner;
  const expectedOwner = ownerState === 'legacy' ? 'pg_database_owner' : SCHEMA_OWNER;
  if (publicOwner !== expectedOwner)
    throw new Error('BASELINE_MISMATCH: unexpected owner for schema public.');
}

async function assertReservedRoleOwnership(client, manifest) {
  const ordinary = await client.query(
    `select owner, kind, identity from (
       select pg_catalog.pg_get_userbyid(n.nspowner)::text as owner, 'schema'::text as kind, n.nspname::text as identity
         from pg_catalog.pg_namespace n where n.nspname in ('public','internal')
       union all
       select pg_catalog.pg_get_userbyid(c.relowner), 'table', n.nspname || '.' || c.relname
         from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
        where n.nspname in ('public','internal') and c.relkind in ('r','p')
          and not exists (select 1 from pg_catalog.pg_depend d where d.classid='pg_catalog.pg_class'::pg_catalog.regclass and d.objid=c.oid and d.deptype='e')
       union all
       select pg_catalog.pg_get_userbyid(p.proowner), 'function', n.nspname || '.' || p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')'
         from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
        where n.nspname in ('public','internal')
          and not exists (select 1 from pg_catalog.pg_depend d where d.classid='pg_catalog.pg_proc'::pg_catalog.regclass and d.objid=p.oid and d.deptype='e')
       union all
       select pg_catalog.pg_get_userbyid(n.nspowner), 'schema', n.nspname
         from pg_catalog.pg_namespace n
        where n.nspname not in ('public','internal')
          and n.nspname not like 'pg\_%' escape '\\'
          and n.nspname<>'information_schema'
       union all
       select pg_catalog.pg_get_userbyid(c.relowner), 'relation', n.nspname || '.' || c.relname
         from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
        where n.nspname not in ('public','internal')
          and n.nspname not like 'pg\_%' escape '\\'
          and n.nspname<>'information_schema'
          and not exists (
            select 1 from pg_catalog.pg_depend d
             where d.classid='pg_catalog.pg_class'::pg_catalog.regclass
               and d.objid=c.oid and d.deptype='e'
          )
       union all
       select pg_catalog.pg_get_userbyid(p.proowner), 'function', n.nspname || '.' || p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')'
         from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
        where n.nspname not in ('public','internal')
          and n.nspname not like 'pg\_%' escape '\\'
          and n.nspname<>'information_schema'
          and not exists (
            select 1 from pg_catalog.pg_depend d
             where d.classid='pg_catalog.pg_proc'::pg_catalog.regclass
               and d.objid=p.oid and d.deptype='e'
          )
       union all
       select pg_catalog.pg_get_userbyid(t.typowner), 'type', n.nspname || '.' || t.typname
         from pg_catalog.pg_type t join pg_catalog.pg_namespace n on n.oid=t.typnamespace
        where n.nspname not in ('public','internal')
          and n.nspname not like 'pg\_%' escape '\\'
          and n.nspname<>'information_schema'
          and not exists (
            select 1 from pg_catalog.pg_depend d
             where d.classid='pg_catalog.pg_type'::pg_catalog.regclass
               and d.objid=t.oid and d.deptype in ('e','i')
          )
       union all
       select pg_catalog.pg_get_userbyid(c.conowner), 'conversion', n.nspname || '.' || c.conname
         from pg_catalog.pg_conversion c join pg_catalog.pg_namespace n on n.oid=c.connamespace
        where n.nspname not in ('public','internal')
          and n.nspname not like 'pg\_%' escape '\\'
          and n.nspname<>'information_schema'
       union all
       select pg_catalog.pg_get_userbyid(o.oprowner), 'operator', n.nspname || '.' || o.oprname
         from pg_catalog.pg_operator o join pg_catalog.pg_namespace n on n.oid=o.oprnamespace
        where n.nspname not in ('public','internal')
          and n.nspname not like 'pg\_%' escape '\\'
          and n.nspname<>'information_schema'
       union all
       select pg_catalog.pg_get_userbyid(o.opcowner), 'operator class', n.nspname || '.' || o.opcname
         from pg_catalog.pg_opclass o join pg_catalog.pg_namespace n on n.oid=o.opcnamespace
        where n.nspname not in ('public','internal')
          and n.nspname not like 'pg\_%' escape '\\'
          and n.nspname<>'information_schema'
       union all
       select pg_catalog.pg_get_userbyid(o.opfowner), 'operator family', n.nspname || '.' || o.opfname
         from pg_catalog.pg_opfamily o join pg_catalog.pg_namespace n on n.oid=o.opfnamespace
        where n.nspname not in ('public','internal')
          and n.nspname not like 'pg\_%' escape '\\'
          and n.nspname<>'information_schema'
       union all
       select pg_catalog.pg_get_userbyid(t.dictowner), 'text search dictionary', n.nspname || '.' || t.dictname
         from pg_catalog.pg_ts_dict t join pg_catalog.pg_namespace n on n.oid=t.dictnamespace
        where n.nspname not in ('public','internal')
          and n.nspname not like 'pg\_%' escape '\\'
          and n.nspname<>'information_schema'
       union all
       select pg_catalog.pg_get_userbyid(t.cfgowner), 'text search configuration', n.nspname || '.' || t.cfgname
         from pg_catalog.pg_ts_config t join pg_catalog.pg_namespace n on n.oid=t.cfgnamespace
        where n.nspname not in ('public','internal')
          and n.nspname not like 'pg\_%' escape '\\'
          and n.nspname<>'information_schema'
       union all
       select pg_catalog.pg_get_userbyid(f.fdwowner), 'foreign data wrapper', f.fdwname
         from pg_catalog.pg_foreign_data_wrapper f
       union all
       select pg_catalog.pg_get_userbyid(f.srvowner), 'foreign server', f.srvname
         from pg_catalog.pg_foreign_server f
     ) objects where owner = any($1::text[]) order by kind, identity`,
    [[MIGRATION_ROLE, SCHEMA_OWNER]]
  );
  if (ordinary.rows.some((row) => row.owner === MIGRATION_ROLE)) {
    throw new Error('ROLE_STATE_MISMATCH: migration_admin owns an ordinary database object.');
  }
  const allowed = new Set(
    manifest.baselineObjects.transferable.map((object) =>
      object.kind === 'function'
        ? `${object.kind}|${object.schema}.${object.name}(${object.arguments})`
        : object.kind === 'schema'
          ? `${object.kind}|${object.schema}`
          : `${object.kind}|${object.schema}.${object.name}`
    )
  );
  for (const row of ordinary.rows.filter((entry) => entry.owner === SCHEMA_OWNER)) {
    if (!allowed.has(`${row.kind}|${row.identity}`)) {
      throw new Error(
        `ROLE_STATE_MISMATCH: schema owner owns unexpected object ${row.kind} ${row.identity}.`
      );
    }
  }

  const unexpectedExternalAcl = await client.query(
    `with grants as (
       select a.grantee
         from pg_catalog.pg_namespace n
         cross join lateral pg_catalog.aclexplode(n.nspacl) a
        where n.nspname not in ('public','internal')
          and n.nspname not like 'pg\_%' escape '\\'
          and n.nspname<>'information_schema'
       union all
       select a.grantee
         from pg_catalog.pg_class c
         join pg_catalog.pg_namespace n on n.oid=c.relnamespace
         cross join lateral pg_catalog.aclexplode(c.relacl) a
        where n.nspname not in ('public','internal')
          and n.nspname not like 'pg\_%' escape '\\'
          and n.nspname<>'information_schema'
       union all
       select a.grantee
         from pg_catalog.pg_proc p
         join pg_catalog.pg_namespace n on n.oid=p.pronamespace
         cross join lateral pg_catalog.aclexplode(p.proacl) a
        where n.nspname not in ('public','internal')
          and n.nspname not like 'pg\_%' escape '\\'
          and n.nspname<>'information_schema'
       union all
       select a.grantee
         from pg_catalog.pg_type t
         join pg_catalog.pg_namespace n on n.oid=t.typnamespace
         cross join lateral pg_catalog.aclexplode(t.typacl) a
        where n.nspname not in ('public','internal')
          and n.nspname not like 'pg\_%' escape '\\'
          and n.nspname<>'information_schema'
       union all
       select a.grantee
         from pg_catalog.pg_language l
         cross join lateral pg_catalog.aclexplode(l.lanacl) a
       union all
       select a.grantee
         from pg_catalog.pg_foreign_data_wrapper f
         cross join lateral pg_catalog.aclexplode(f.fdwacl) a
       union all
       select a.grantee
         from pg_catalog.pg_foreign_server f
         cross join lateral pg_catalog.aclexplode(f.srvacl) a
     )
     select count(*)::integer as count from grants
      where grantee in (
        select oid from pg_catalog.pg_roles where rolname=any($1::text[])
      )`,
    [[MIGRATION_ROLE, SCHEMA_OWNER]]
  );
  if (unexpectedExternalAcl.rows[0].count !== 0) {
    throw new Error('ROLE_STATE_MISMATCH: reserved roles have unexpected external-schema ACLs.');
  }
  const databaseOwners = await client.query(
    `select datname from pg_catalog.pg_database where pg_catalog.pg_get_userbyid(datdba)=any($1::text[])`,
    [[MIGRATION_ROLE, SCHEMA_OWNER]]
  );
  if (databaseOwners.rowCount !== 0)
    throw new Error('ROLE_STATE_MISMATCH: a reserved role unexpectedly owns a database.');
}

async function createReservedRoles(client, migrationPassword) {
  await client.query(`
    create role ${SCHEMA_OWNER}
      nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls
      connection limit -1
  `);
  await client.query(`
    create role ${MIGRATION_ROLE}
      login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls
      connection limit -1
  `);
  await client.query(
    `grant ${SCHEMA_OWNER} to ${MIGRATION_ROLE} with admin false, inherit false, set true`
  );
  const passwordStatement = await client.query(
    `select pg_catalog.format('alter role ${MIGRATION_ROLE} password %L', $1::text) as statement`,
    [migrationPassword]
  );
  await client.query(passwordStatement.rows[0].statement);
}

async function applyDatabaseAcl(client) {
  const statements = await client.query(`
    select pg_catalog.format('grant connect on database %I to ${MIGRATION_ROLE}', current_database()) as migration_connect,
           pg_catalog.format('grant create on database %I to ${SCHEMA_OWNER}', current_database()) as owner_create
  `);
  await client.query(statements.rows[0].migration_connect);
  await client.query(statements.rows[0].owner_create);
}

async function transferObject(client, object) {
  if (object.kind === 'schema') {
    await client.query(`alter schema ${quoteIdentifier(object.schema)} owner to ${SCHEMA_OWNER}`);
  } else if (object.kind === 'table') {
    await client.query(
      `alter table ${quoteIdentifier(object.schema)}.${quoteIdentifier(object.name)} owner to ${SCHEMA_OWNER}`
    );
  } else if (object.kind === 'function') {
    const statement = await client.query(
      `select pg_catalog.format(
                'alter function %I.%I(%s) owner to ${SCHEMA_OWNER}',
                n.nspname, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid)
              ) as sql
         from pg_catalog.pg_proc p
         join pg_catalog.pg_namespace n on n.oid=p.pronamespace
        where n.nspname=$1 and p.proname=$2
          and pg_catalog.pg_get_function_identity_arguments(p.oid)=$3`,
      [object.schema, object.name, object.arguments]
    );
    if (statement.rowCount !== 1) {
      throw new Error(
        `BASELINE_MISMATCH: trusted function identity ${object.schema}.${object.name}.`
      );
    }
    await client.query(statement.rows[0].sql);
  } else {
    throw new Error(`Unsupported trusted ownership kind: ${object.kind}`);
  }
}

function quoteIdentifier(identifier) {
  return `"${String(identifier).replaceAll('"', '""')}"`;
}

async function backfillTrustedLegacyChecksums(client, manifest) {
  await client.query('alter table public.schema_migrations add column checksum text');
  for (const entry of manifest.migrations.filter(
    (migration) => migration.legacyChecksumBackfillAllowed
  )) {
    const result = await client.query(
      'update public.schema_migrations set checksum=$1 where filename=$2 and checksum is null',
      [entry.sha256, entry.filename]
    );
    if (result.rowCount !== 1)
      throw new Error(`Trusted checksum backfill failed for ${entry.filename}.`);
  }
  await client.query('alter table public.schema_migrations alter column checksum set not null');
}

async function main() {
  if (!parseActivationGate()) {
    console.log('Separated database lanes are disabled; provisioning was not run.');
    return;
  }

  const manifest = loadTrustedManifest();
  const connectionString = requiredEnvironment('BOOTSTRAP_DATABASE_URL');
  const migrationPassword = requiredEnvironment('MIGRATION_ADMIN_PASSWORD');
  if (migrationPassword.length < 24) {
    throw new Error('MIGRATION_ADMIN_PASSWORD must contain at least 24 characters.');
  }

  const client = new Client({
    connectionString,
    application_name: 'cocinacore-database-provisioner',
  });
  await client.connect();
  let lockKey;
  try {
    await assertBootstrapIdentity(client);
    lockKey = await acquireDatabaseChangeLock(client);

    const roleState = await inspectReservedRoles(client);
    const hasLedger = await ledgerExists(client);
    let appliedMigrations = new Set();
    await preflightExtensions(client, manifest, { established: hasLedger });
    if (hasLedger) {
      appliedMigrations = await attestLedger(client, manifest, roleState === 'established');
      await attestBaselineCatalog(
        client,
        manifest,
        roleState === 'absent' ? 'legacy' : 'target',
        appliedMigrations
      );
    } else {
      await attestFreshCatalog(client, manifest, roleState === 'absent' ? 'legacy' : 'target');
    }
    if (roleState === 'established') {
      await assertReservedRoleAclState(client);
      await assertReservedRoleOwnership(client, manifest);
    }

    await client.query('begin');
    try {
      if (roleState === 'absent') await createReservedRoles(client, migrationPassword);
      await applyDatabaseAcl(client);
      await provisionOrAttestExtensions(client, manifest, { established: hasLedger });

      if (roleState === 'absent') {
        if (hasLedger) {
          for (const object of manifest.baselineObjects.transferable)
            await transferObject(client, object);
          await backfillTrustedLegacyChecksums(client, manifest);
        } else {
          const publicSchema = manifest.baselineObjects.transferable.find(
            (object) => object.kind === 'schema' && object.schema === 'public'
          );
          await transferObject(client, publicSchema);
        }
        await client.query('revoke create on schema public from public');
        await client.query('grant usage on schema public to public');
        await client.query(`revoke all on schema public from ${MIGRATION_ROLE}`);
      }

      await inspectReservedRoles(client);
      await assertReservedRoleAclState(client);
      await assertReservedRoleOwnership(client, manifest);
      if (hasLedger) {
        appliedMigrations = await attestLedger(client, manifest, true);
        await attestBaselineCatalog(client, manifest, 'target', appliedMigrations);
      } else {
        await attestFreshCatalog(client, manifest, 'target');
      }
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  } finally {
    try {
      if (lockKey !== undefined) await releaseDatabaseChangeLock(client, lockKey);
    } finally {
      await client.end();
    }
  }

  console.log('Database migration roles and trusted ownership are provisioned.');
}

main().catch((error) => {
  const message = String(error.message || error).replace(
    /postgres(?:ql)?:\/\/[^\s]+/gi,
    'postgresql://[redacted]'
  );
  console.error('Database provisioning failed:', message);
  process.exit(1);
});
