#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * One-use, operator-only bootstrap for the first CocinaCore platform administrator.
 *
 * This creates a normal application-auth user with a member tenant membership,
 * then activates platform access through the narrowly granted database function.
 * It never creates or changes tenant-owner privileges and never accepts secrets
 * through argv, dotenv files, or a connection URL.
 *
 * Required non-secret environment:
 *   COCINACORE_FIRST_ADMIN_DATABASE_URL=postgresql://cocinacore_first_admin_provisioner@127.0.0.1:5432/<db>
 *   COCINACORE_FIRST_ADMIN_EXPECTED_DATABASE=<exact database name>
 *   COCINACORE_FIRST_ADMIN_EXPECTED_EMAIL=<exact administrator email>
 *
 * Run interactively with: npm run db:bootstrap:first-platform-admin
 */

const readline = require('node:readline/promises');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { attestActivatedCapabilities } = require('./activated-capabilities-attestation');

const PROVISIONER_ROLE = 'cocinacore_first_admin_provisioner';
const FUNCTION_OWNER_ROLE = 'cocinacore_first_admin_function_owner';
const FUNCTION_SIGNATURE = 'public.provision_first_platform_administrator(text,text,text,text)';
const BCRYPT_COST = 12;

function fail(message) {
  throw new Error(message);
}

function getTargetConfig(environment = process.env) {
  const rawUrl = environment.COCINACORE_FIRST_ADMIN_DATABASE_URL;
  const expectedDatabase = environment.COCINACORE_FIRST_ADMIN_EXPECTED_DATABASE?.trim();
  const expectedEmail = environment.COCINACORE_FIRST_ADMIN_EXPECTED_EMAIL?.trim();
  if (!rawUrl || !expectedDatabase || !expectedEmail) {
    fail('Set the three required non-secret COCINACORE_FIRST_ADMIN_* variables.');
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    fail('The first-admin database URL is invalid.');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const port = Number(url.port || 5432);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const username = decodeURIComponent(url.username);
  const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1']);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !loopbackHosts.has(host) ||
    username !== PROVISIONER_ROLE ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== '' ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !database ||
    database !== expectedDatabase ||
    ['postgres', 'template0', 'template1'].includes(database)
  ) {
    fail('Refusing an invalid, credential-bearing, or unexpected database target.');
  }

  const normalizedEmail = expectedEmail.toLowerCase();
  if (
    expectedEmail !== expectedEmail.trim() ||
    normalizedEmail.length > 254 ||
    !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail)
  ) {
    fail('The expected administrator email is invalid.');
  }

  return {
    host,
    port,
    database,
    username,
    expectedEmail: normalizedEmail,
  };
}

function requireInteractiveTerminal() {
  if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== 'function') {
    fail('Run this installer from an interactive terminal; secrets are never read from stdin pipes.');
  }
  if (process.argv.length > 2) {
    fail('This installer accepts no command-line arguments.');
  }
}

function askLine(question) {
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  return prompt.question(question).finally(() => prompt.close());
}

function askSecret(question, { input = process.stdin, output = process.stdout } = {}) {
  return new Promise((resolve, reject) => {
    const previousRawMode = input.isRaw;
    let value = '';
    let settled = false;

    const cleanup = () => {
      input.removeListener('data', onData);
      input.setRawMode(previousRawMode ?? false);
      input.pause();
      output.write('\n');
    };
    const finish = (error, secret) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(secret);
    };
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === '\u0003' || character === '\u0004') {
          finish(new Error('Secret entry cancelled.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          finish(null, value);
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = Array.from(value).slice(0, -1).join('');
          continue;
        }
        if (character >= ' ') value += character;
      }
    };

    output.write(question);
    input.setEncoding('utf8');
    input.setRawMode(true);
    input.resume();
    input.on('data', onData);
  });
}

async function collectOperatorInput(target) {
  console.log(`Target: ${target.username}@${target.host}:${target.port}/${target.database}`);
  const databaseConfirmation = await askLine('Type the exact database name to continue: ');
  if (databaseConfirmation !== target.database) fail('Database confirmation did not match.');

  const email = (await askLine('Administrator email: ')).trim().toLowerCase();
  if (email !== target.expectedEmail) fail('Administrator email did not match the explicitly configured target.');
  const name = (await askLine('Administrator full name: ')).trim();
  if (name.length < 3 || name.length > 120) fail('The administrator name must contain 3–120 characters.');
  const approvalReference = (await askLine('Non-secret owner approval reference: ')).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,127}$/.test(approvalReference)) {
    fail('The approval reference must be 3–128 letters, numbers, dots, underscores, colons, slashes, or hyphens.');
  }

  const databasePassword = await askSecret('Dedicated provisioner database password (input hidden): ');
  if (!databasePassword) fail('The provisioner database password is required.');
  const password = await askSecret('New administrator password (input hidden): ');
  const passwordConfirmation = await askSecret('Repeat administrator password (input hidden): ');
  if (password !== passwordConfirmation) fail('Administrator password confirmation did not match.');
  if (Array.from(password).length < 12 || Buffer.byteLength(password, 'utf8') > 72) {
    fail('Use an administrator password of at least 12 characters and at most 72 UTF-8 bytes.');
  }

  return { approvalReference, databasePassword, email, name, password };
}

async function verifyDatabaseContract(client, target) {
  const result = await client.query(
    `SELECT current_database() AS database_name,
            session_user AS session_role,
            current_user AS active_role,
            r.rolcanlogin, r.rolsuper, r.rolbypassrls, r.rolcreatedb,
            r.rolcreaterole, r.rolinherit, r.rolreplication, r.rolconfig,
            pg_catalog.shobj_description(r.oid, 'pg_authid') AS role_comment,
            EXISTS (
              SELECT 1 FROM pg_catalog.pg_auth_members m
               WHERE m.member = r.oid OR m.roleid = r.oid
            ) AS has_role_membership,
            pg_catalog.has_function_privilege(current_user, $1, 'EXECUTE') AS can_execute,
            EXISTS (
              SELECT 1 FROM pg_catalog.pg_proc p
              CROSS JOIN LATERAL pg_catalog.aclexplode(
                COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
              ) acl
              WHERE p.oid = pg_catalog.to_regprocedure($1)
                AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
            ) AS public_can_execute,
            pg_catalog.has_function_privilege('cocinacore_auth', $1, 'EXECUTE') AS auth_can_execute,
            pg_catalog.has_function_privilege('cocinacore_runtime_rls', $1, 'EXECUTE') AS runtime_can_execute,
            pg_catalog.has_table_privilege(current_user, 'public.users', 'INSERT') AS direct_users_insert,
            pg_catalog.has_table_privilege(current_user, 'public.platform_owners', 'INSERT') AS direct_owners_insert,
            pg_catalog.has_table_privilege(current_user, 'public.first_platform_admin_bootstrap_claim', 'SELECT') AS direct_claim_select,
            pg_catalog.has_table_privilege(current_user, 'public.first_platform_admin_bootstrap_claim', 'INSERT') AS direct_claim_insert,
            pg_catalog.to_regprocedure($1) IS NOT NULL AS function_exists,
            (SELECT count(*)::integer FROM pg_catalog.pg_class c
              WHERE c.oid = ANY(ARRAY[
                'public.users'::pg_catalog.regclass,
                'public.tenants'::pg_catalog.regclass,
                'public.tenant_memberships'::pg_catalog.regclass,
                'public.platform_owners'::pg_catalog.regclass,
                'public.first_platform_admin_bootstrap_claim'::pg_catalog.regclass
              ]) AND c.relrowsecurity AND c.relforcerowsecurity) AS forced_rls_tables,
            EXISTS (SELECT 1 FROM pg_catalog.pg_roles f
                     WHERE f.rolname = $2 AND NOT f.rolcanlogin AND NOT f.rolsuper
                       AND NOT f.rolbypassrls AND NOT f.rolcreatedb AND NOT f.rolcreaterole
                       AND NOT f.rolreplication AND NOT f.rolinherit) AS function_owner_is_restricted
       FROM pg_catalog.pg_roles r
      WHERE r.rolname = current_user`,
    [FUNCTION_SIGNATURE, FUNCTION_OWNER_ROLE]
  );
  const row = result.rows[0];
  if (
    !row ||
    row.database_name !== target.database ||
    row.active_role !== PROVISIONER_ROLE ||
    row.session_role !== PROVISIONER_ROLE ||
    !row.rolcanlogin ||
    row.rolsuper ||
    row.rolbypassrls ||
    row.rolcreatedb ||
    row.rolcreaterole ||
    row.rolinherit ||
    row.rolreplication ||
    !Array.isArray(row.rolconfig) ||
    row.rolconfig.length !== 2 ||
    !row.rolconfig.includes('search_path=pg_catalog, public') ||
    !row.rolconfig.includes('row_security=on') ||
    row.role_comment !== 'CocinaCore first platform-admin provisioner v1' ||
    row.has_role_membership ||
    !row.can_execute ||
    row.public_can_execute ||
    row.auth_can_execute ||
    row.runtime_can_execute ||
    row.direct_users_insert ||
    row.direct_owners_insert ||
    row.direct_claim_select ||
    row.direct_claim_insert ||
    !row.function_exists ||
    row.forced_rls_tables !== 5 ||
    !row.function_owner_is_restricted
  ) {
    fail('Database role, function, grant, or FORCE RLS contract mismatch; no account was created.');
  }
}

async function provision(target, operatorInput) {
  const pool = new Pool({
    host: target.host,
    port: target.port,
    database: target.database,
    user: target.username,
    password: operatorInput.databasePassword,
    connectionTimeoutMillis: 5000,
    max: 1,
    application_name: 'cocinacore-first-platform-admin-bootstrap',
  });
  let client;
  let transactionOpen = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    transactionOpen = true;
    await verifyDatabaseContract(client, target);
    if ((await attestActivatedCapabilities(client, '024')) !== 'active') {
      fail('The pinned 024 database attestation is not active; no account was created.');
    }
    const passwordHash = await bcrypt.hash(operatorInput.password, BCRYPT_COST);
    const created = await client.query(
      `SELECT user_id, email
         FROM public.provision_first_platform_administrator($1, $2, $3, $4)`,
      [operatorInput.email, passwordHash, operatorInput.name, operatorInput.approvalReference]
    );
    if (created.rowCount !== 1 || !created.rows[0]?.user_id || created.rows[0]?.email !== operatorInput.email) {
      fail('The database returned an invalid first-administrator result.');
    }
    await client.query('COMMIT');
    transactionOpen = false;
    console.log('First platform administrator provisioned.');
    console.log(`Database: ${target.database}`);
    console.log(`Operator: ${target.username}`);
    console.log(`User ID: ${created.rows[0].user_id}`);
    console.log(`Email: ${created.rows[0].email}`);
    console.log(`Approval reference: ${operatorInput.approvalReference}`);
    console.log('Sign in through the existing CocinaCore login; no session or password was logged.');
  } catch (error) {
    if (transactionOpen && client) await client.query('ROLLBACK').catch(() => undefined);
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    if (code === 'P0001') fail('A platform owner already exists; no account was created.');
    if (code === '23505') fail('The administrator account already exists; no account was created.');
    if (code === '22023') fail('The administrator input was rejected; no account was created.');
    if (error instanceof Error && error.message.startsWith('Database') ) throw error;
    fail(`Provisioning failed safely${code ? ` (database code ${String(code)})` : ''}; no secret was logged.`);
  } finally {
    client?.release();
    await pool.end();
  }
}

async function main() {
  requireInteractiveTerminal();
  const target = getTargetConfig();
  const operatorInput = await collectOperatorInput(target);
  try {
    await provision(target, operatorInput);
  } finally {
    operatorInput.databasePassword = '';
    operatorInput.password = '';
  }
}

module.exports = { askSecret, getTargetConfig, verifyDatabaseContract };

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'First-admin provisioning failed safely.');
    process.exitCode = 1;
  });
}
