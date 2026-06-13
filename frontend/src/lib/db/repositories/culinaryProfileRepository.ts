import { query, mapSingleRow, transaction } from '@/lib/db';
import {
  CulinaryDimensionRow,
  CulinaryTermRow,
  UserCulinaryProfileRow,
  UserCulinaryProfileTermRow,
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

export async function findCulinaryProfileTermsByUserId(
  userId: string
): Promise<UserCulinaryProfileTermRow[]> {
  const result = await query<UserCulinaryProfileTermRow>(
    `select * from public.user_culinary_profile_terms where user_id = $1 order by created_at desc`,
    [userId]
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
     returning *`,
    [input.userId, input.tenantId, input.level ?? null]
  );

  const profile = mapSingleRow(result);
  if (!profile) throw new Error('Failed to upsert culinary profile');
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
