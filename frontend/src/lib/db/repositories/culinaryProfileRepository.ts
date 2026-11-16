import { query, mapSingleRow, scopedTransaction, type DbOperationOptions } from '@/lib/db';
import type { DbTransactionClient } from '@/lib/db/transaction-client';
import { readHardRestrictionList } from '@/lib/profile/culinary-profile-contract';
import {
  CulinaryDimensionRow,
  CulinaryTermRow,
  UserCulinaryProfileRow,
  UserCulinaryProfileTermRow,
  HouseholdMember,
  PreferenceType,
} from '@/lib/db/types';

export async function listCulinaryDimensions(): Promise<CulinaryDimensionRow[]> {
  const result = await query<CulinaryDimensionRow>(
    'select * from public.culinary_dimensions order by sort_order, label'
  );
  return result.rows;
}

export async function listCulinaryTerms(
  dimensionId?: string,
  activeOnly = true
): Promise<CulinaryTermRow[]> {
  const conditions = activeOnly ? ['is_active = true'] : [];
  const params: unknown[] = [];

  if (dimensionId) {
    params.push(dimensionId);
    conditions.push(`dimension_id = $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? `where ${conditions.join(' and ')}` : '';
  const result = await query<CulinaryTermRow>(
    `select * from public.culinary_terms ${whereClause} order by label`,
    params
  );
  return result.rows;
}

export async function findCulinaryProfileByUserId(
  userId: string,
  tenantId: string
): Promise<UserCulinaryProfileRow | null> {
  const result = await scopedTransaction({ tenantId, userId }, (client) =>
    client.query<UserCulinaryProfileRow>(
      'select * from public.user_culinary_profiles where user_id = $1 and tenant_id = $2',
      [userId, tenantId]
    )
  );
  return mapSingleRow(result);
}

/** Loads a profile only when both authenticated ownership dimensions match. */
export async function findCulinaryProfileByUserAndTenant(
  userId: string,
  tenantId: string,
  statementTimeoutMs?: number,
  options: DbOperationOptions = {}
): Promise<UserCulinaryProfileRow | null> {
  const sql = 'select * from public.user_culinary_profiles where user_id = $1 and tenant_id = $2';
  const params = [userId, tenantId];
  const result = await scopedProfileQuery<UserCulinaryProfileRow>(
    userId,
    tenantId,
    sql,
    params,
    statementTimeoutMs,
    options
  );
  return mapSingleRow(result);
}

/** The caller must derive both identifiers from the same authenticated server identity. */
async function scopedProfileQuery<T extends import('pg').QueryResultRow>(
  userId: string,
  tenantId: string,
  sql: string,
  params: unknown[],
  statementTimeoutMs?: number,
  options: DbOperationOptions = {}
) {
  if (
    statementTimeoutMs !== undefined &&
    (!Number.isSafeInteger(statementTimeoutMs) || statementTimeoutMs <= 0)
  ) {
    throw new Error('Statement timeout must be a positive safe integer.');
  }
  return scopedTransaction(
    { tenantId, userId },
    async (client) => {
      if (statementTimeoutMs !== undefined) {
        await client.query("select set_config('statement_timeout', $1, true)", [
          `${statementTimeoutMs}ms`,
        ]);
        await client.query("select set_config('lock_timeout', $1, true)", [
          `${statementTimeoutMs}ms`,
        ]);
      }
      return client.query<T>(sql, params);
    },
    options
  );
}

export interface UserCulinaryProfileTermWithLabel extends UserCulinaryProfileTermRow {
  term_label: string;
}

export interface CulinaryProfileQueryClient {
  queryProfile(queryText: string, values?: unknown[]): Promise<{ rows: UserCulinaryProfileRow[] }>;
  queryTerms(
    queryText: string,
    values?: unknown[]
  ): Promise<{ rows: UserCulinaryProfileTermWithLabel[] }>;
  execute(queryText: string, values?: unknown[]): Promise<void>;
}

function queryClient(client: DbTransactionClient | CulinaryProfileQueryClient): CulinaryProfileQueryClient {
  if ('queryProfile' in client) return client;
  return {
    queryProfile: (queryText, values) => client.query<UserCulinaryProfileRow>(queryText, values),
    queryTerms: (queryText, values) =>
      client.query<UserCulinaryProfileTermWithLabel>(queryText, values),
    execute: async (queryText, values) => {
      await client.query(queryText, values);
    },
  };
}

export class ProfileTenantMismatchError extends Error {
  constructor() {
    super('Culinary profile belongs to a different tenant');
    this.name = 'ProfileTenantMismatchError';
  }
}

function isProfileRowSecurityViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error) || !('message' in error)) {
    return false;
  }
  return (
    error.code === '42501' &&
    typeof error.message === 'string' &&
    error.message.includes('row-level security policy')
  );
}

export async function lockCulinaryProfileUpdateInTransaction(
  client: DbTransactionClient | CulinaryProfileQueryClient,
  userId: string,
  tenantId: string
): Promise<void> {
  const typedClient = queryClient(client);
  const lockKey = `culinary-profile:${tenantId.toLowerCase()}:${userId.toLowerCase()}`;
  await typedClient.execute('select pg_advisory_xact_lock(hashtextextended($1, 0))', [lockKey]);
}

export async function findCulinaryProfileByUserIdInTransaction(
  client: DbTransactionClient | CulinaryProfileQueryClient,
  userId: string,
  tenantId: string
): Promise<UserCulinaryProfileRow | null> {
  const result = await queryClient(client).queryProfile(
    'select * from public.user_culinary_profiles where user_id = $1 and tenant_id = $2',
    [userId, tenantId]
  );
  return result.rows[0] ?? null;
}

export async function findCulinaryProfileTermsByUserIdInTransaction(
  client: DbTransactionClient | CulinaryProfileQueryClient,
  userId: string,
  tenantId: string
): Promise<UserCulinaryProfileTermWithLabel[]> {
  const result = await queryClient(client).queryTerms(
    `select profile_terms.*, terms.label as term_label
     from public.user_culinary_profile_terms as profile_terms
     join public.user_culinary_profiles as profiles
       on profiles.user_id = profile_terms.user_id
      and profiles.user_id = $1
      and profiles.tenant_id = $2
     join public.culinary_terms as terms on terms.id = profile_terms.term_id
     where profile_terms.user_id = $1
     order by profile_terms.created_at desc, profile_terms.term_id`,
    [userId, tenantId]
  );
  return result.rows;
}

/** Call under the existing culinary profile advisory lock. */
export async function readHardRestrictionContextInTransaction(
  client: DbTransactionClient | CulinaryProfileQueryClient,
  userId: string,
  tenantId: string
): Promise<{ allergies: string[]; avoid: string[] } | null> {
  const profile = await findCulinaryProfileByUserIdInTransaction(client, userId, tenantId);
  const terms = await findCulinaryProfileTermsByUserIdInTransaction(client, userId, tenantId);
  if ((profile && (profile.user_id !== userId || profile.tenant_id !== tenantId)) ||
      (!profile && terms.length > 0) || terms.some((term) => term.user_id !== userId ||
        !['identity', 'prefer', 'avoid', 'goal'].includes(term.preference_type))) return null;
  const allergies = readHardRestrictionList(profile ? profile.allergies : []);
  const avoid = readHardRestrictionList(terms.filter((term) => term.preference_type === 'avoid').map((term) => term.term_label));
  return allergies && avoid ? { allergies, avoid } : null;
}

export async function findCulinaryProfileTermsByUserId(
  userId: string,
  tenantId: string,
  statementTimeoutMs?: number,
  options: DbOperationOptions = {}
): Promise<UserCulinaryProfileTermWithLabel[]> {
  const sql = `select profile_terms.*, terms.label as term_label
     from public.user_culinary_profile_terms as profile_terms
     join public.user_culinary_profiles as profiles
       on profiles.user_id = profile_terms.user_id
      and profiles.user_id = $1
      and profiles.tenant_id = $2
     join public.culinary_terms as terms on terms.id = profile_terms.term_id
     where profile_terms.user_id = $1
     order by profile_terms.created_at desc, profile_terms.term_id`;
  const params = [userId, tenantId];
  const result = await scopedProfileQuery<UserCulinaryProfileTermWithLabel>(
    userId,
    tenantId,
    sql,
    params,
    statementTimeoutMs,
    options
  );
  return result.rows;
}

export const MAX_WASTE_PREVENTION_PROFILE_TERMS = 100;

export async function listWastePreventionCulinaryProfileTermsByUserId(
  userId: string,
  tenantId: string,
  limit = MAX_WASTE_PREVENTION_PROFILE_TERMS
): Promise<UserCulinaryProfileTermWithLabel[]> {
  const boundedLimit = Number.isFinite(limit)
    ? Math.min(MAX_WASTE_PREVENTION_PROFILE_TERMS, Math.max(1, Math.floor(limit)))
    : MAX_WASTE_PREVENTION_PROFILE_TERMS;
  const result = await scopedTransaction({ tenantId, userId }, (client) =>
    client.query<UserCulinaryProfileTermWithLabel>(
      `select profile_terms.*, terms.label as term_label
     from public.user_culinary_profile_terms as profile_terms
     join public.user_culinary_profiles as profiles
       on profiles.user_id = profile_terms.user_id
      and profiles.user_id = $1
      and profiles.tenant_id = $2
     join public.culinary_terms as terms on terms.id = profile_terms.term_id
     where profile_terms.user_id = $1
     order by profile_terms.created_at desc, profile_terms.term_id
     limit $3`,
      [userId, tenantId, Math.min(MAX_WASTE_PREVENTION_PROFILE_TERMS + 1, boundedLimit + 1)]
    )
  );
  return result.rows;
}

export interface UpsertProfileInput {
  userId: string;
  tenantId: string;
  level?: string | null;
}

export async function upsertCulinaryProfile(
  input: UpsertProfileInput
): Promise<UserCulinaryProfileRow> {
  const result = await scopedTransaction(
    { tenantId: input.tenantId, userId: input.userId },
    async (client) => {
      await lockCulinaryProfileUpdateInTransaction(client, input.userId, input.tenantId);
      try {
        return await client.query<UserCulinaryProfileRow>(
          `insert into public.user_culinary_profiles (user_id, tenant_id, level)
     values ($1, $2, $3)
     on conflict (user_id) do update set
       level = excluded.level,
       updated_at = now()
     where user_culinary_profiles.tenant_id = excluded.tenant_id
     returning *`,
          [input.userId, input.tenantId, input.level ?? null]
        );
      } catch (error) {
        if (isProfileRowSecurityViolation(error)) throw new ProfileTenantMismatchError();
        throw error;
      }
    }
  );

  const profile = mapSingleRow(result);
  if (!profile) throw new ProfileTenantMismatchError();
  return profile;
}

export async function setCulinaryProfileTerms(
  userId: string,
  tenantId: string,
  terms: Array<{ termId: string; preferenceType: PreferenceType; weight?: number }>
): Promise<void> {
  await scopedTransaction({ tenantId, userId }, async (client) => {
    const typedClient = queryClient(client);
    await lockCulinaryProfileUpdateInTransaction(typedClient, userId, tenantId);
    const profile = await typedClient.queryProfile(
      `select user_id, tenant_id
       from public.user_culinary_profiles
       where user_id = $1 and tenant_id = $2
       for update`,
      [userId, tenantId]
    );
    if (profile.rows.length !== 1) throw new ProfileTenantMismatchError();

    await typedClient.execute(
      `delete from public.user_culinary_profile_terms as profile_terms
       using public.user_culinary_profiles as profiles
       where profile_terms.user_id = $1 and profiles.user_id = $1 and profiles.tenant_id = $2`,
      [userId, tenantId]
    );

    for (const term of terms) {
      await typedClient.execute(
        `insert into public.user_culinary_profile_terms
         (user_id, term_id, preference_type, weight)
         values ($1, $2, $3, $4)`,
        [userId, term.termId, term.preferenceType, term.weight ?? 1]
      );
    }
  });
}

export interface SaveCulinaryProfileInput extends UpsertProfileInput {
  availableTimeMinutes?: number | null;
  dislikedIngredients?: string[];
  allergies?: string[];
  householdMembers?: HouseholdMember[];
  terms?: Array<{ termId: string; preferenceType: PreferenceType; weight?: number }>;
}

export async function saveCulinaryProfile(
  input: SaveCulinaryProfileInput
): Promise<UserCulinaryProfileRow> {
  return scopedTransaction({ tenantId: input.tenantId, userId: input.userId }, (client) =>
    saveCulinaryProfileInTransaction(queryClient(client), input)
  );
}

export async function saveCulinaryProfileInTransaction(
  client: DbTransactionClient | CulinaryProfileQueryClient,
  input: SaveCulinaryProfileInput
): Promise<UserCulinaryProfileRow> {
  const typedClient = queryClient(client);
  await lockCulinaryProfileUpdateInTransaction(typedClient, input.userId, input.tenantId);
  let result: { rows: UserCulinaryProfileRow[] };
  try {
    result = await typedClient.queryProfile(
      `insert into public.user_culinary_profiles
         (user_id, tenant_id, level, available_time_minutes, disliked_ingredients, allergies, household_members)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb)
       on conflict (user_id) do update set
         level = case when $8 then excluded.level else user_culinary_profiles.level end,
         available_time_minutes = case when $9 then excluded.available_time_minutes else user_culinary_profiles.available_time_minutes end,
         disliked_ingredients = case when $10 then excluded.disliked_ingredients else user_culinary_profiles.disliked_ingredients end,
         allergies = case when $11 then excluded.allergies else user_culinary_profiles.allergies end,
         household_members = case when $12 then excluded.household_members else user_culinary_profiles.household_members end,
         updated_at = now()
       where user_culinary_profiles.tenant_id = excluded.tenant_id
       returning *`,
      [
        input.userId,
        input.tenantId,
        input.level ?? null,
        input.availableTimeMinutes ?? null,
        input.dislikedIngredients ?? [],
        input.allergies ?? [],
        JSON.stringify(input.householdMembers ?? []),
        input.level !== undefined,
        input.availableTimeMinutes !== undefined,
        input.dislikedIngredients !== undefined,
        input.allergies !== undefined,
        input.householdMembers !== undefined,
      ]
    );
  } catch (error) {
    if (isProfileRowSecurityViolation(error)) throw new ProfileTenantMismatchError();
    throw error;
  }

  const profile = result.rows[0];
  if (!profile) throw new ProfileTenantMismatchError();

  if (input.terms !== undefined) {
    await typedClient.execute(
      `delete from public.user_culinary_profile_terms as profile_terms
       using public.user_culinary_profiles as profiles
       where profile_terms.user_id = $1 and profiles.user_id = $1 and profiles.tenant_id = $2`,
      [input.userId, input.tenantId]
    );

    for (const term of input.terms) {
      await typedClient.execute(
        `insert into public.user_culinary_profile_terms
         (user_id, term_id, preference_type, weight)
         values ($1, $2, $3, $4)`,
        [input.userId, term.termId, term.preferenceType, term.weight ?? 1]
      );
    }
  }

  return profile;
}
