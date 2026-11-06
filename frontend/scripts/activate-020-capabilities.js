/* eslint-disable @typescript-eslint/no-require-imports */
// Explicit one-off administrative activation. This is intentionally not used by the migration runner.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const { attestActivatedCapabilities } = require('./activated-capabilities-attestation');
const { assertPreparedCapabilitiesManifest } = require('./prepared-capabilities-contract');

const REPOSITORY_ROOT = path.resolve(__dirname, '../..');
const LOCK_NAMESPACE_PREFIX = 'cocinacore:database-change:v1:';
const TRUSTED_BASE_COMMIT = '2069fc1f5a1ffc8407bd99cd91f9fadfbd04c6c4';
const ACTIVATION_LOCK_TIMEOUT_MS = 60_000;
const EXPECTED_MIGRATION_COUNT = 20;
const MIGRATION_FILENAME = /^(\d{3})_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/;
const SHA256 = /^[0-9a-f]{64}$/;

const ACTIVATION_GRANTS = [
  {
    owner: 'cocinacore_signup_bootstrap',
    sql: 'GRANT EXECUTE ON FUNCTION public.signup_new_account(text,text,text,timestamptz,text) TO cocinacore_auth',
  },
  {
    owner: 'cocinacore_identity_probe',
    sql: 'GRANT SELECT ON public.runtime_identity_probe TO cocinacore_runtime_rls',
  },
  {
    owner: 'cocinacore_metrics_view_owner',
    sql: 'GRANT SELECT ON public.owner_global_metrics TO cocinacore_owner_metrics',
  },
  {
    owner: 'cocinacore_global_writer_view_owner',
    sql: 'GRANT INSERT ON public.owner_write_global_books TO cocinacore_global_writer',
  },
  {
    owner: 'cocinacore_global_writer_view_owner',
    sql: 'GRANT INSERT ON public.owner_write_global_pdfs TO cocinacore_global_writer',
  },
  {
    owner: 'cocinacore_global_writer_view_owner',
    sql: 'GRANT INSERT ON public.owner_write_global_chunks TO cocinacore_global_writer',
  },
  {
    owner: 'cocinacore_global_writer_view_owner',
    sql: 'GRANT SELECT (id) ON public.owner_write_global_books TO cocinacore_global_writer',
  },
];

function activationError(code) {
  const error = new Error(code);
  error.activationCode = code;
  return error;
}

function loadTrustedMigration020({ repositoryRoot = REPOSITORY_ROOT } = {}) {
  const migrationDirectory = path.join(repositoryRoot, 'db/migrations');
  const manifestPath = path.join(migrationDirectory, 'manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    throw activationError('ACTIVATION_MANIFEST_UNREADABLE');
  }

  try {
    assertPreparedCapabilitiesManifest(manifest.preparedCapabilities);
  } catch {
    throw activationError('ACTIVATION_PREPARED_CONTRACT_MISMATCH');
  }

  if (
    manifest.manifestVersion !== 1 ||
    manifest.migrationLaneVersion !== 1 ||
    manifest.trustedBaseCommit !== TRUSTED_BASE_COMMIT ||
    manifest.lockContract?.version !== 1 ||
    manifest.lockContract?.namespacePrefix !== LOCK_NAMESPACE_PREFIX ||
    manifest.lockContract?.scope !== 'session' ||
    manifest.lockContract?.derivation !==
      'pg_catalog.hashtextextended(namespacePrefix || current_database(), 0)' ||
    !Array.isArray(manifest.migrations)
  ) {
    throw activationError('ACTIVATION_MANIFEST_INVALID');
  }
  if (manifest.migrations.length < EXPECTED_MIGRATION_COUNT) {
    throw activationError('ACTIVATION_MANIFEST_020_UNAVAILABLE');
  }

  const filenames = new Set();
  const ids = new Set();
  let trusted020 = null;
  for (const [index, migration] of manifest.migrations.entries()) {
    const expectedId = String(index + 1).padStart(3, '0');
    const match = MIGRATION_FILENAME.exec(migration.filename || '');
    if (
      migration.id !== expectedId ||
      !match ||
      match[1] !== migration.id ||
      filenames.has(migration.filename) ||
      ids.has(migration.id) ||
      !SHA256.test(migration.sha256 || '') ||
      !Number.isSafeInteger(migration.byteLength) ||
      migration.transactional !== 'required' ||
      migration.lane !== 'migration'
    ) {
      throw activationError('ACTIVATION_MANIFEST_INVALID');
    }
    filenames.add(migration.filename);
    ids.add(migration.id);
    if (index < EXPECTED_MIGRATION_COUNT) {
      const migrationPath = path.resolve(migrationDirectory, migration.filename);
      if (!migrationPath.startsWith(`${migrationDirectory}${path.sep}`)) {
        throw activationError('ACTIVATION_MANIFEST_INVALID');
      }
      let bytes;
      try {
        bytes = fs.readFileSync(migrationPath);
      } catch {
        throw activationError(
          migration.id === '020'
            ? 'ACTIVATION_MANIFEST_020_FILE_MISSING'
            : 'ACTIVATION_MANIFEST_MIGRATION_FILE_MISSING'
        );
      }
      if (
        bytes.length !== migration.byteLength ||
        crypto.createHash('sha256').update(bytes).digest('hex') !== migration.sha256
      ) {
        throw activationError(
          migration.id === '020'
            ? 'ACTIVATION_MANIFEST_020_CHECKSUM_MISMATCH'
            : 'ACTIVATION_MANIFEST_CHECKSUM_MISMATCH'
        );
      }
    }

    if (migration.id === '020') trusted020 = migration;
  }

  if (!trusted020) throw activationError('ACTIVATION_MANIFEST_020_UNAVAILABLE');
  if (manifest.migrations[19]?.id !== '020') {
    throw activationError('ACTIVATION_MANIFEST_020_ORDER_MISMATCH');
  }

  const expectedLedger = manifest.migrations.slice(0, EXPECTED_MIGRATION_COUNT);
  if (expectedLedger.length !== EXPECTED_MIGRATION_COUNT) {
    throw activationError('ACTIVATION_MANIFEST_020_UNAVAILABLE');
  }
  return { migrationDirectory, migration020: trusted020, expectedLedger };
}

async function acquireActivationLock(client, timeoutMs = ACTIVATION_LOCK_TIMEOUT_MS) {
  const keyResult = await client.query(
    'SELECT pg_catalog.hashtextextended($1 || current_database(), 0)::text AS key',
    [LOCK_NAMESPACE_PREFIX]
  );
  const deadline = Date.now() + timeoutMs;
  do {
    const result = await client.query(
      'SELECT pg_catalog.pg_try_advisory_xact_lock($1::bigint) AS acquired',
      [keyResult.rows[0].key]
    );
    if (result.rows[0]?.acquired === true) return;
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  } while (Date.now() < deadline);
  throw activationError('ACTIVATION_LOCK_TIMEOUT');
}

async function assertAdministrativeSession(client) {
  const result = await client.query(`
    SELECT current_setting('server_version_num')::integer / 10000 AS server_major,
           session_user::text AS session_user,
           current_user::text AS current_user,
           r.rolsuper AS is_superuser
      FROM pg_catalog.pg_roles r
     WHERE r.rolname = session_user
  `);
  const identity = result.rows[0];
  if (
    !identity ||
    Number(identity.server_major) !== 16 ||
    identity.session_user !== identity.current_user ||
    identity.is_superuser !== true
  ) {
    throw activationError('ACTIVATION_ADMIN_IDENTITY_REQUIRED');
  }
}

async function assertTrustedLedger(client, expectedLedger) {
  let result;
  try {
    result = await client.query(`
      SELECT filename, checksum,
             count(*) OVER (PARTITION BY applied_at) AS timestamp_count
        FROM public.schema_migrations
       ORDER BY applied_at, filename
    `);
  } catch {
    throw activationError('ACTIVATION_LEDGER_MISMATCH');
  }
  if (
    result.rows.length !== expectedLedger.length ||
    result.rows.some(
      (row, index) =>
        row.filename !== expectedLedger[index].filename ||
        row.checksum !== expectedLedger[index].sha256 ||
        Number(row.timestamp_count) !== 1
    )
  ) {
    throw activationError('ACTIVATION_LEDGER_MISMATCH');
  }
}

async function assertNoPartialActivation(client) {
  const result = await client.query(`
    SELECT
      pg_catalog.has_function_privilege('cocinacore_auth',
        'public.signup_new_account(text,text,text,timestamptz,text)', 'EXECUTE') AS signup,
      pg_catalog.has_table_privilege('cocinacore_runtime_rls',
        'public.runtime_identity_probe', 'SELECT') AS identity_probe,
      pg_catalog.has_table_privilege('cocinacore_owner_metrics',
        'public.owner_global_metrics', 'SELECT') AS metrics,
      pg_catalog.has_table_privilege('cocinacore_global_writer',
        'public.owner_write_global_books', 'INSERT') AS books_insert,
      pg_catalog.has_table_privilege('cocinacore_global_writer',
        'public.owner_write_global_pdfs', 'INSERT') AS pdfs_insert,
      pg_catalog.has_table_privilege('cocinacore_global_writer',
        'public.owner_write_global_chunks', 'INSERT') AS chunks_insert,
      pg_catalog.has_column_privilege('cocinacore_global_writer',
        'public.owner_write_global_books', 'id', 'SELECT') AS books_id_select
  `);
  if (!result.rows[0] || Object.values(result.rows[0]).some(Boolean)) {
    throw activationError('ACTIVATION_PARTIAL_GRANTS');
  }
}

async function membershipSnapshot(client) {
  const result = await client.query(`
    SELECT roleid::text, member::text, admin_option, inherit_option, set_option
      FROM pg_catalog.pg_auth_members
     ORDER BY roleid, member
  `);
  return JSON.stringify(result.rows);
}

async function currentTransactionId(client) {
  const result = await client.query('SELECT pg_catalog.pg_current_xact_id()::text AS id');
  return result.rows[0]?.id;
}

async function attestCatalog(client) {
  try {
    return await attestActivatedCapabilities(client);
  } catch {
    throw activationError('ACTIVATION_CATALOG_MISMATCH');
  }
}

async function grantAsOwner(client, owner, sql) {
  // Role names and SQL are static constants above, never user or client input.
  await client.query(`SET LOCAL ROLE ${owner}`);
  const assumed = await client.query('SELECT current_user::text AS role_name');
  if (assumed.rows[0]?.role_name !== owner) {
    throw activationError('ACTIVATION_OWNER_ROLE_MISMATCH');
  }
  await client.query(sql);
  await client.query('RESET ROLE');
}

async function activateWithClient(client, { afterGrantForTest } = {}) {
  const { expectedLedger } = loadTrustedMigration020();
  let transactionOpen = false;
  try {
    await client.query('BEGIN');
    transactionOpen = true;
    await acquireActivationLock(client);
    await assertAdministrativeSession(client);
    await assertTrustedLedger(client, expectedLedger);
    const transactionId = await currentTransactionId(client);

    const state = await attestCatalog(client);
    if (state === 'active') {
      if ((await currentTransactionId(client)) !== transactionId) {
        throw activationError('ACTIVATION_TRANSACTION_BOUNDARY_MISMATCH');
      }
      await client.query('COMMIT');
      transactionOpen = false;
      return { state: 'active', changed: false, transactionId };
    }

    await assertNoPartialActivation(client);
    const membershipsBefore = await membershipSnapshot(client);
    for (const [index, grant] of ACTIVATION_GRANTS.entries()) {
      await grantAsOwner(client, grant.owner, grant.sql);
      if (afterGrantForTest) await afterGrantForTest(index, client);
    }

    const activationState = await attestCatalog(client);
    if (activationState !== 'active') {
      throw activationError('ACTIVATION_FINAL_ATTESTATION_INCOMPLETE');
    }
    if ((await membershipSnapshot(client)) !== membershipsBefore) {
      throw activationError('ACTIVATION_ROLE_MEMBERSHIP_CHANGED');
    }
    if ((await currentTransactionId(client)) !== transactionId) {
      throw activationError('ACTIVATION_TRANSACTION_BOUNDARY_MISMATCH');
    }

    await client.query('COMMIT');
    transactionOpen = false;
    return { state: 'active', changed: true, transactionId };
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // The connection may already be broken; never replace the original safe code.
      }
    }
    if (error?.activationCode) throw error;
    const wrapped = activationError(
      error?.code ? `ACTIVATION_DATABASE_ERROR_${error.code}` : 'ACTIVATION_FAILED'
    );
    if (error?.code) wrapped.databaseCode = error.code;
    throw wrapped;
  }
}

async function main() {
  if (process.argv.length !== 2) throw activationError('ACTIVATION_ARGUMENTS_NOT_SUPPORTED');
  const connectionString = process.env.COCINACORE_ACTIVATION_DATABASE_URL;
  if (!connectionString) throw activationError('ACTIVATION_DATABASE_URL_REQUIRED');

  // The fixed repository manifest is read before opening the explicitly supplied admin connection.
  loadTrustedMigration020();
  const client = new Client({
    connectionString,
    application_name: 'cocinacore-020-capability-activation',
  });
  let connected = false;
  try {
    await client.connect();
    connected = true;
    const result = await activateWithClient(client);
    console.log(
      result.changed ? 'ACTIVATION COMPLETE.' : 'ACTIVATION ALREADY COMPLETE; NO CHANGES.'
    );
  } finally {
    if (connected) await client.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    const code = error?.activationCode || 'ACTIVATION_FAILED';
    console.error(`020_CAPABILITY_ACTIVATION_REJECTED: ${code}`);
    process.exitCode = 1;
  });
}

module.exports = {
  ACTIVATION_GRANTS,
  activateWithClient,
  loadTrustedMigration020,
};
