import { PoolClient } from 'pg';
import { query, mapSingleRow } from '@/lib/db';
import { UserRow, TenantRole } from '@/lib/db/types';

interface CreateUserInput {
  email: string;
  passwordHash: string;
  fullName: string;
  tenantId: string;
  role: TenantRole;
  termsAcceptedAt: string;
  termsVersion: string;
}

interface UpdateUserInput {
  fullName?: string | null;
  onboardingCompleted?: boolean;
  termsAcceptedAt?: string;
  termsVersion?: string;
  tenantId?: string;
  role?: TenantRole;
  emailConfirmed?: boolean;
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const result = await query<UserRow>(
    'select * from public.users where email = lower($1)',
    [email]
  );
  return mapSingleRow(result);
}

export async function findUserById(id: string): Promise<UserRow | null> {
  const result = await query<UserRow>('select * from public.users where id = $1', [id]);
  return mapSingleRow(result);
}

export async function createUser(input: CreateUserInput): Promise<UserRow> {
  const result = await query<UserRow>(
    `insert into public.users
     (email, password_hash, full_name, tenant_id, role, terms_accepted_at, terms_version, email_confirmed)
     values (lower($1), $2, $3, $4, $5, $6, $7, true)
     returning *`,
    [
      input.email,
      input.passwordHash,
      input.fullName,
      input.tenantId,
      input.role,
      input.termsAcceptedAt,
      input.termsVersion,
    ]
  );

  const user = mapSingleRow(result);
  if (!user) {
    throw new Error('Failed to create user');
  }

  return user;
}

export async function updateUser(id: string, input: UpdateUserInput): Promise<UserRow | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (input.fullName !== undefined) {
    fields.push(`full_name = $${paramIndex++}`);
    values.push(input.fullName);
  }
  if (input.onboardingCompleted !== undefined) {
    fields.push(`onboarding_completed = $${paramIndex++}`);
    values.push(input.onboardingCompleted);
  }
  if (input.termsAcceptedAt !== undefined) {
    fields.push(`terms_accepted_at = $${paramIndex++}`);
    values.push(input.termsAcceptedAt);
  }
  if (input.termsVersion !== undefined) {
    fields.push(`terms_version = $${paramIndex++}`);
    values.push(input.termsVersion);
  }
  if (input.tenantId !== undefined) {
    fields.push(`tenant_id = $${paramIndex++}`);
    values.push(input.tenantId);
  }
  if (input.role !== undefined) {
    fields.push(`role = $${paramIndex++}`);
    values.push(input.role);
  }
  if (input.emailConfirmed !== undefined) {
    fields.push(`email_confirmed = $${paramIndex++}`);
    values.push(input.emailConfirmed);
  }

  if (fields.length === 0) {
    return findUserById(id);
  }

  fields.push(`updated_at = now()`);
  values.push(id);

  const result = await query<UserRow>(
    `update public.users set ${fields.join(', ')} where id = $${paramIndex} returning *`,
    values
  );

  return mapSingleRow(result);
}

export async function updatePassword(id: string, passwordHash: string): Promise<void> {
  await query('update public.users set password_hash = $1, updated_at = now() where id = $2', [
    passwordHash,
    id,
  ]);
}

export async function listUsersByTenant(tenantId: string): Promise<UserRow[]> {
  const result = await query<UserRow>(
    'select * from public.users where tenant_id = $1 order by created_at desc',
    [tenantId]
  );
  return result.rows;
}

export async function updateUserTenantAndRole(
  client: PoolClient,
  userId: string,
  tenantId: string,
  role: TenantRole
): Promise<void> {
  await client.query(
    'update public.users set tenant_id = $1, role = $2, updated_at = now() where id = $3',
    [tenantId, role, userId]
  );
}
