#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Bootstraps the first tenant and owner user.
 *
 * Usage:
 *   node scripts/bootstrap-owner.js owner@example.com "Owner Name" "SecurePassword123!"
 */

const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

try {
  require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });
} catch {
  // dotenv is a devDependency; in Docker/env-injected environments it is not needed.
}

function getDatabaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL environment variable is required.');
  }
  return url;
}

async function main() {
  const [email, fullName, password] = process.argv.slice(2);

  if (!email || !fullName || !password) {
    console.error('Usage: node scripts/bootstrap-owner.js <email> "<full name>" <password>');
    process.exit(1);
  }

  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: getDatabaseUrl() });
  const client = await pool.connect();

  try {
    await client.query('begin');

    const existingPlatformOwners = await client.query(
      'select count(*)::int as count from public.platform_owners'
    );
    if ((existingPlatformOwners.rows[0]?.count ?? 0) > 0) {
      throw new Error(
        'Platform owner already exists. Use the application-managed flow for additional access changes.'
      );
    }

    const tenantResult = await client.query(
      `insert into public.tenants (name, tenant_type, trial_started_at, trial_ends_at)
       values ($1, 'home', now(), now() + interval '14 days')
       returning id`,
      [`Tenant of ${email}`]
    );
    const tenantId = tenantResult.rows[0].id;

    const passwordHash = await bcrypt.hash(password, 12);

    const userResult = await client.query(
      `insert into public.users
       (email, password_hash, email_confirmed, full_name, tenant_id, role, terms_accepted_at, terms_version, onboarding_completed)
       values ($1, $2, true, $3, $4, 'owner', now(), 'v1', true)
       returning id`,
      [email.toLowerCase().trim(), passwordHash, fullName.trim(), tenantId]
    );
    const userId = userResult.rows[0].id;

    await client.query(
      `insert into public.tenant_memberships (tenant_id, user_id, role)
       values ($1, $2, 'owner')
       on conflict (tenant_id, user_id) do update set role = 'owner', updated_at = now()`,
      [tenantId, userId]
    );

    await client.query(
      `insert into public.platform_owners (user_id, requires_manual_review)
       values ($1, false)
       on conflict (user_id) do update set requires_manual_review = false`,
      [userId]
    );

    await client.query('commit');

    console.log('✅ Owner bootstrapped successfully');
    console.log(`   User ID: ${userId}`);
    console.log(`   Tenant ID: ${tenantId}`);
    console.log(`   Email: ${email.toLowerCase().trim()}`);
  } catch (error) {
    await client.query('rollback');
    console.error('Bootstrap failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Unexpected error:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
