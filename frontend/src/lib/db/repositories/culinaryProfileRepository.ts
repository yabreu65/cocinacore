import { query, mapSingleRow, transaction } from '@/lib/db';
import type { PoolClient } from 'pg';
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
  userId: string
): Promise<UserCulinaryProfileRow | null> {
  const result = await query<UserCulinaryProfileRow>(
    'select * from public.user_culinary_profiles where user_id = $1',
    [userId]
  );
  return mapSingleRow(result);
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

function queryClient(
  client: PoolClient | CulinaryProfileQueryClient
): CulinaryProfileQueryClient {
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

export async function lockCulinaryProfileUpdateInTransaction(
  client: PoolClient | CulinaryProfileQueryClient,
  userId: string
): Promise<void> {
  const typedClient = queryClient(client);
  const lockKey = `culinary-profile:${userId}`;
  await typedClient.execute('select pg_advisory_xact_lock(hashtextextended($1, 0))', [lockKey]);
}

export async function findCulinaryProfileByUserIdInTransaction(
  client: PoolClient | CulinaryProfileQueryClient,
  userId: string
): Promise<UserCulinaryProfileRow | null> {
  const result = await queryClient(client).queryProfile(
    'select * from public.user_culinary_profiles where user_id = $1',
    [userId]
  );
  return result.rows[0] ?? null;
}

export async function findCulinaryProfileTermsByUserIdInTransaction(
  client: PoolClient | CulinaryProfileQueryClient,
  userId: string
): Promise<UserCulinaryProfileTermWithLabel[]> {
  const result = await queryClient(client).queryTerms(
    `select profile_terms.*, terms.label as term_label
     from public.user_culinary_profile_terms as profile_terms
     join public.culinary_terms as terms on terms.id = profile_terms.term_id
     where profile_terms.user_id = $1
     order by profile_terms.created_at desc, profile_terms.term_id`,
    [userId]
  );
  return result.rows;
}

export async function findCulinaryProfileTermsByUserId(
  userId: string
): Promise<UserCulinaryProfileTermWithLabel[]> {
  const result = await query<UserCulinaryProfileTermWithLabel>(
    `select profile_terms.*, terms.label as term_label
     from public.user_culinary_profile_terms as profile_terms
     join public.culinary_terms as terms on terms.id = profile_terms.term_id
     where profile_terms.user_id = $1
     order by profile_terms.created_at desc, profile_terms.term_id`,
    [userId]
  );
  return result.rows;
}

export const MAX_WASTE_PREVENTION_PROFILE_TERMS = 100;

export async function listWastePreventionCulinaryProfileTermsByUserId(
  userId: string,
  limit = MAX_WASTE_PREVENTION_PROFILE_TERMS
): Promise<UserCulinaryProfileTermWithLabel[]> {
  const boundedLimit = Number.isFinite(limit)
    ? Math.min(MAX_WASTE_PREVENTION_PROFILE_TERMS, Math.max(1, Math.floor(limit)))
    : MAX_WASTE_PREVENTION_PROFILE_TERMS;
  const result = await query<UserCulinaryProfileTermWithLabel>(
    `select profile_terms.*, terms.label as term_label
     from public.user_culinary_profile_terms as profile_terms
     join public.culinary_terms as terms on terms.id = profile_terms.term_id
     where profile_terms.user_id = $1
     order by profile_terms.created_at desc, profile_terms.term_id
     limit $2`,
    [userId, Math.min(MAX_WASTE_PREVENTION_PROFILE_TERMS + 1, boundedLimit + 1)]
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
  const result = await query<UserCulinaryProfileRow>(
    `insert into public.user_culinary_profiles (user_id, tenant_id, level)
     values ($1, $2, $3)
     on conflict (user_id) do update set
       level = excluded.level,
       updated_at = now()
     where user_culinary_profiles.tenant_id = excluded.tenant_id
     returning *`,
    [input.userId, input.tenantId, input.level ?? null]
  );

  const profile = mapSingleRow(result);
  if (!profile) throw new ProfileTenantMismatchError();
  return profile;
}

export async function setCulinaryProfileTerms(
  userId: string,
  terms: Array<{ termId: string; preferenceType: PreferenceType; weight?: number }>
): Promise<void> {
  await transaction(async (client) => {
    await client.query('delete from public.user_culinary_profile_terms where user_id = $1', [
      userId,
    ]);

    for (const term of terms) {
      await client.query(
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
  return transaction((client) => saveCulinaryProfileInTransaction(queryClient(client), input));
}

export async function saveCulinaryProfileInTransaction(
  client: PoolClient | CulinaryProfileQueryClient,
  input: SaveCulinaryProfileInput
): Promise<UserCulinaryProfileRow> {
  const typedClient = queryClient(client);
  const result = await typedClient.queryProfile(
    `insert into public.user_culinary_profiles
         (user_id, tenant_id, level, available_time_minutes, disliked_ingredients, allergies, household_members)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb)
       on conflict (user_id) do update set
         tenant_id = excluded.tenant_id,
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

  const profile = result.rows[0];
  if (!profile) throw new ProfileTenantMismatchError();

  if (input.terms !== undefined) {
    await typedClient.execute('delete from public.user_culinary_profile_terms where user_id = $1', [
      input.userId,
    ]);

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
