import { PoolClient } from 'pg';
import {
  authQuery,
  query,
  mapSingleRow,
  transaction,
  scopedTransaction,
  type AuthenticatedDbScope,
  type DbOperationOptions,
} from '@/lib/db';
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

/** User data returned to non-authentication consumers; excludes credential material. */
export type DataUserRow = Omit<UserRow, 'password_hash'>;
export type UserProfileUpdateRow = Pick<UserRow, 'id' | 'full_name' | 'onboarding_completed'>;

const DATA_USER_COLUMNS =
  'id, email, email_confirmed, full_name, tenant_id, role, terms_accepted_at, terms_version, onboarding_completed, created_at, updated_at';
const PROFILE_UPDATE_COLUMNS = 'id, full_name, onboarding_completed';
const EMAIL_PREDICATE = 'email = pg_catalog.lower(pg_catalog.btrim($1))';

export async function findUserByEmail(email: string): Promise<DataUserRow | null> {
  const result = await query<DataUserRow>(
    `select ${DATA_USER_COLUMNS} from public.users where ${EMAIL_PREDICATE}`,
    [email]
  );
  return mapSingleRow(result);
}

export async function findUserByEmailForAuth(email: string): Promise<UserRow | null> {
  const result = await authQuery<UserRow>(`select * from public.users where ${EMAIL_PREDICATE}`, [
    email,
  ]);
  return mapSingleRow(result);
}

export async function findUserById(
  id: string,
  options?: DbOperationOptions,
  client?: PoolClient
): Promise<DataUserRow | null> {
  const sql = `select ${DATA_USER_COLUMNS} from public.users where id = $1`;
  const result = client
    ? await client.query<DataUserRow>(sql, [id])
    : await query<DataUserRow>(sql, [id], options);
  return mapSingleRow(result);
}

export async function findUserByIdForAuth(
  id: string,
  options?: DbOperationOptions,
  client?: PoolClient
): Promise<UserRow | null> {
  const sql = 'select * from public.users where id = $1';
  const result = client
    ? await client.query<UserRow>(sql, [id])
    : await authQuery<UserRow>(sql, [id], options);
  return mapSingleRow(result);
}

export async function createUser(input: CreateUserInput, client?: PoolClient): Promise<UserRow> {
  const result = await (client ? client.query.bind(client) : authQuery)<UserRow>(
    `insert into public.users
     (email, password_hash, full_name, tenant_id, role, terms_accepted_at, terms_version, email_confirmed)
     values (pg_catalog.lower(pg_catalog.btrim($1)), $2, $3, $4, $5, $6, $7, true)
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

export async function updateUser(
  id: string,
  input: UpdateUserInput
): Promise<UserProfileUpdateRow | null> {
  return transaction((client) => updateUserInTransaction(client, id, input));
}

export interface UserUpdateQueryClient {
  queryUser(queryText: string, values?: unknown[]): Promise<{ rows: UserProfileUpdateRow[] }>;
}

function userUpdateQueryClient(client: PoolClient | UserUpdateQueryClient): UserUpdateQueryClient {
  if ('queryUser' in client) return client;
  return {
    queryUser: (queryText, values) => client.query<UserProfileUpdateRow>(queryText, values),
  };
}

export async function updateUserInTransaction(
  client: PoolClient | UserUpdateQueryClient,
  id: string,
  input: UpdateUserInput
): Promise<UserProfileUpdateRow | null> {
  const typedClient = userUpdateQueryClient(client);
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
    const result = await typedClient.queryUser(
      `select ${PROFILE_UPDATE_COLUMNS} from public.users where id = $1`,
      [id]
    );
    return result.rows[0] ?? null;
  }

  fields.push(`updated_at = now()`);
  values.push(id);

  const result = await typedClient.queryUser(
    `update public.users set ${fields.join(', ')} where id = $${paramIndex} returning ${PROFILE_UPDATE_COLUMNS}`,
    values
  );

  return result.rows[0] ?? null;
}

export async function updatePassword(id: string, passwordHash: string): Promise<void> {
  await authQuery('update public.users set password_hash = $1, updated_at = now() where id = $2', [
    passwordHash,
    id,
  ]);
}

export async function listUsersByTenant(
  tenantId: string,
  scope?: AuthenticatedDbScope,
  options: DbOperationOptions = {}
): Promise<DataUserRow[]> {
  if (scope && scope.tenantId !== tenantId) throw new Error('User scope mismatch.');
  const sql = `select ${DATA_USER_COLUMNS} from public.users where tenant_id = $1 order by created_at desc`;
  const result = scope
    ? await scopedTransaction(
        scope,
        (client) => client.query<DataUserRow>(sql, [tenantId]),
        options
      )
    : await query<DataUserRow>(sql, [tenantId], options);
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
