import { type Page } from '@playwright/test';
import Redis from 'ioredis';
import { Pool } from 'pg';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://cocinacore_user:cocinacore_password@localhost:5433/cocinacore_local_db';
const REDIS_URL = process.env.E2E_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6379/15';
const VECTOR_1536 = `[${Array.from({ length: 1536 }, () => '1').join(',')}]`;

let pool: Pool | null = null;

export interface AuthenticatedE2EIdentity {
  userId: string;
  tenantId: string;
}

interface ProfileSnapshot {
  tenantId: string;
  level: string | null;
}

interface ProfileTermSnapshot {
  termId: string;
  preferenceType: 'identity' | 'prefer' | 'avoid' | 'goal';
  weight: string;
}

export interface ConnectedRecipeSeed {
  identity: AuthenticatedE2EIdentity;
  runId: string;
  globalBookTitle: string;
  tenantBookTitle: string;
  tenantBBookTitle: string;
  tenantBSecretMarker: string;
  inventoryIds: string[];
  globalBookId?: string;
  tenantBookId?: string;
  tenantBId?: string;
  culinaryDimensionId: string;
  originalProfile: ProfileSnapshot | null;
  originalProfileTerms: ProfileTermSnapshot[];
  originalHistoryIds: string[];
  originalMealPlanIds: string[];
}

export interface E2EMealPlanRow {
  id: string;
  tenant_id: string;
  user_id: string;
  people_count: number;
  period: string;
  mode: string;
  base_cuisine: string;
  fusion_cuisines: string[];
  fusion_intensity: string;
  restrictions: string[];
  inventory_snapshot: { inventoryLines?: string[] };
  calendar_payload: { period?: string; dayCount?: number; days?: unknown[] };
  ai_content: string | null;
}

export interface E2ERecipeHistoryRow {
  id: string;
  tenant_id: string;
  user_id: string;
  recipe_title: string | null;
  recipe_payload: {
    mode?: string;
    ragContextUsed?: boolean;
    sources?: Array<{ title?: string }>;
    structuredIngredients?: Array<{ quantity: string; unit: string; name: string }>;
  };
}

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: DATABASE_URL });
  }
  return pool;
}

function sanitizeRunId(runId: string): string {
  return runId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80);
}

export async function resolveAuthenticatedE2EIdentity(
  page: Page,
  provided?: Partial<AuthenticatedE2EIdentity>
): Promise<AuthenticatedE2EIdentity> {
  if (provided?.userId && provided.tenantId) {
    return { userId: provided.userId, tenantId: provided.tenantId };
  }

  const response = await page.request.get('/api/profile');
  if (!response.ok()) {
    throw new Error(`Unable to resolve authenticated E2E identity (${response.status()}).`);
  }

  const payload = (await response.json()) as {
    user?: { id?: string; tenant?: { tenantId?: string } | null };
  };
  const userId = provided?.userId ?? payload.user?.id;
  const tenantId = provided?.tenantId ?? payload.user?.tenant?.tenantId;

  if (!userId || !tenantId) {
    throw new Error('Authenticated E2E user must have both a user id and tenant id.');
  }

  return { userId, tenantId };
}

export async function clearRecipeCache(): Promise<void> {
  const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 1 });
  try {
    let cursor = '0';
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', 'recipe:*', 'COUNT', '100');
      cursor = nextCursor;
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } while (cursor !== '0');
  } finally {
    await redis.quit();
  }
}

export async function seedConnectedRecipeData({
  identity,
  runId,
  includeRagChunks = true,
}: {
  identity: AuthenticatedE2EIdentity;
  runId: string;
  includeRagChunks?: boolean;
}): Promise<ConnectedRecipeSeed> {
  const db = getPool();
  const safeRunId = sanitizeRunId(runId);
  const globalBookTitle = `E2E Global Tomato Rice ${safeRunId}`;
  const tenantBookTitle = `E2E Tenant Chicken ${safeRunId}`;
  const tenantBBookTitle = `E2E Tenant B Secret ${safeRunId}`;
  const tenantBSecretMarker = `TENANT_B_SECRET_RECIPE_MARKER_${safeRunId}`;

  const [profileResult, profileTermsResult, historyResult, mealPlanResult] = await Promise.all([
    db.query<ProfileSnapshot>(
      'select tenant_id as "tenantId", level from public.user_culinary_profiles where user_id = $1',
      [identity.userId]
    ),
    db.query<ProfileTermSnapshot>(
      `select term_id as "termId", preference_type as "preferenceType", weight::text as weight
       from public.user_culinary_profile_terms where user_id = $1`,
      [identity.userId]
    ),
    db.query<{ id: string }>(
      'select id from public.recipe_ai_history where user_id = $1 and tenant_id = $2',
      [identity.userId, identity.tenantId]
    ),
    db.query<{ id: string }>(
      'select id from public.user_meal_plans where user_id = $1 and tenant_id = $2',
      [identity.userId, identity.tenantId]
    ),
  ]);

  const dimension = await db.query<{ id: string }>(
    `insert into public.culinary_dimensions (key, label, sort_order)
     values ($1, $2, 9999) returning id`,
    [`e2e-connected-${safeRunId}`, `E2E Connected ${safeRunId}`]
  );
  const culinaryDimensionId = dimension.rows[0]?.id;
  if (!culinaryDimensionId) throw new Error('Failed to create E2E culinary dimension.');

  await db.query('delete from public.user_culinary_profile_terms where user_id = $1', [
    identity.userId,
  ]);
  await db.query(
    `insert into public.user_culinary_profiles (user_id, tenant_id, level)
     values ($1, $2, 'Intermedio')
     on conflict (user_id) do update set tenant_id = excluded.tenant_id, level = excluded.level, updated_at = now()`,
    [identity.userId, identity.tenantId]
  );

  const termRows = await db.query<{ id: string; label: string }>(
    `insert into public.culinary_terms (dimension_id, label)
     values ($1, 'family'), ($1, 'peanut')
     returning id, label`,
    [culinaryDimensionId]
  );
  const familyTermId = termRows.rows.find((term) => term.label === 'family')?.id;
  const peanutTermId = termRows.rows.find((term) => term.label === 'peanut')?.id;
  if (!familyTermId || !peanutTermId) throw new Error('Failed to create E2E culinary terms.');

  await db.query(
    `insert into public.user_culinary_profile_terms (user_id, term_id, preference_type, weight)
     values ($1, $2, 'prefer', 1), ($1, $3, 'avoid', 1)`,
    [identity.userId, familyTermId, peanutTermId]
  );

  const inventoryResult = await db.query<{ id: string }>(
    `insert into public.recipe_inventory_items
       (tenant_id, user_id, ingredient_name, quantity, unit, category, normalized_name)
     values
       ($1, $2, 'tomato', '2', 'units', 'vegetables', 'tomato'),
       ($1, $2, 'rice', '1', 'cup', 'pantry', 'rice'),
       ($1, $2, 'chicken', '200', 'g', 'protein', 'chicken')
     returning id`,
    [identity.tenantId, identity.userId]
  );

  const seed: ConnectedRecipeSeed = {
    identity,
    runId: safeRunId,
    globalBookTitle,
    tenantBookTitle,
    tenantBBookTitle,
    tenantBSecretMarker,
    inventoryIds: inventoryResult.rows.map((row) => row.id),
    culinaryDimensionId,
    originalProfile: profileResult.rows[0] ?? null,
    originalProfileTerms: profileTermsResult.rows,
    originalHistoryIds: historyResult.rows.map((row) => row.id),
    originalMealPlanIds: mealPlanResult.rows.map((row) => row.id),
  };

  if (!includeRagChunks) return seed;

  const globalBook = await db.query<{ id: string }>(
    `insert into public.global_books (title, author, description, cuisine_region, tags)
     values ($1, 'E2E Chef', 'Deterministic RAG fixture', 'E2E', ARRAY['e2e']) returning id`,
    [globalBookTitle]
  );
  const tenantBook = await db.query<{ id: string }>(
    `insert into public.tenant_books (tenant_id, title, author, description)
     values ($1, $2, 'E2E Chef', 'Deterministic tenant RAG fixture') returning id`,
    [identity.tenantId, tenantBookTitle]
  );
  const tenantB = await db.query<{ id: string }>(
    `insert into public.tenants (tenant_type, name) values ('home', $1) returning id`,
    [`E2E Tenant B ${safeRunId}`]
  );
  const tenantBId = tenantB.rows[0]?.id;
  const globalBookId = globalBook.rows[0]?.id;
  const tenantBookId = tenantBook.rows[0]?.id;
  if (!tenantBId || !globalBookId || !tenantBookId)
    throw new Error('Failed to create E2E RAG books.');

  const tenantBBook = await db.query<{ id: string }>(
    `insert into public.tenant_books (tenant_id, title, author, description)
     values ($1, $2, 'E2E Chef', 'Must never be retrieved') returning id`,
    [tenantBId, tenantBBookTitle]
  );
  const tenantBBookId = tenantBBook.rows[0]?.id;
  if (!tenantBBookId) throw new Error('Failed to create E2E tenant B book.');

  await db.query(
    `insert into public.book_chunks
       (tenant_id, global_book_id, tenant_book_id, source_type, content, metadata, embedding)
     values
       (null, $1, null, 'global_pdf', $2, $3::jsonb, $4::vector(1536)),
       ($5, null, $6, 'tenant_pdf', $7, $8::jsonb, $4::vector(1536)),
       ($9, null, $10, 'tenant_pdf', $11, $12::jsonb, $4::vector(1536))`,
    [
      globalBookId,
      'Global tomato and rice technique for chicken: simmer rice and roast tomato with chicken.',
      JSON.stringify({ book_title: globalBookTitle, page_number: 7 }),
      VECTOR_1536,
      identity.tenantId,
      tenantBookId,
      'Tenant chicken technique: cook chicken gently with tomato and rice.',
      JSON.stringify({ book_title: tenantBookTitle, page_number: 11 }),
      tenantBId,
      tenantBBookId,
      `Forbidden tenant B content: ${tenantBSecretMarker}`,
      JSON.stringify({ book_title: tenantBBookTitle, page_number: 99 }),
    ]
  );

  seed.globalBookId = globalBookId;
  seed.tenantBookId = tenantBookId;
  seed.tenantBId = tenantBId;
  return seed;
}

export async function cleanupConnectedRecipeData(seed: ConnectedRecipeSeed): Promise<void> {
  const db = getPool();

  if (seed.tenantBId) {
    await db.query('delete from public.tenants where id = $1', [seed.tenantBId]);
  }
  if (seed.tenantBookId) {
    await db.query('delete from public.tenant_books where id = $1', [seed.tenantBookId]);
  }
  if (seed.globalBookId) {
    await db.query('delete from public.global_books where id = $1', [seed.globalBookId]);
  }

  if (seed.inventoryIds.length > 0) {
    await db.query('delete from public.recipe_inventory_items where id = any($1::uuid[])', [
      seed.inventoryIds,
    ]);
  }

  await db.query(
    `delete from public.recipe_ai_history
     where user_id = $1 and tenant_id = $2 and not (id = any($3::uuid[]))`,
    [seed.identity.userId, seed.identity.tenantId, seed.originalHistoryIds]
  );
  await db.query(
    `delete from public.user_meal_plans
     where user_id = $1 and tenant_id = $2 and not (id = any($3::uuid[]))`,
    [seed.identity.userId, seed.identity.tenantId, seed.originalMealPlanIds]
  );
  await db.query('delete from public.user_culinary_profile_terms where user_id = $1', [
    seed.identity.userId,
  ]);
  await db.query('delete from public.culinary_dimensions where id = $1', [
    seed.culinaryDimensionId,
  ]);

  if (seed.originalProfile) {
    await db.query(
      `insert into public.user_culinary_profiles (user_id, tenant_id, level)
       values ($1, $2, $3)
       on conflict (user_id) do update set tenant_id = excluded.tenant_id, level = excluded.level, updated_at = now()`,
      [seed.identity.userId, seed.originalProfile.tenantId, seed.originalProfile.level]
    );
  } else {
    await db.query('delete from public.user_culinary_profiles where user_id = $1', [
      seed.identity.userId,
    ]);
  }

  for (const term of seed.originalProfileTerms) {
    await db.query(
      `insert into public.user_culinary_profile_terms (user_id, term_id, preference_type, weight)
       values ($1, $2, $3, $4)`,
      [seed.identity.userId, term.termId, term.preferenceType, term.weight]
    );
  }
}

export async function latestRecipeHistory(
  identity: AuthenticatedE2EIdentity
): Promise<E2ERecipeHistoryRow | null> {
  const result = await getPool().query<E2ERecipeHistoryRow>(
    `select id, tenant_id, user_id, recipe_title, recipe_payload
     from public.recipe_ai_history
     where user_id = $1 and tenant_id = $2
     order by created_at desc limit 1`,
    [identity.userId, identity.tenantId]
  );
  return result.rows[0] ?? null;
}

export async function latestMealPlan(
  identity: AuthenticatedE2EIdentity
): Promise<E2EMealPlanRow | null> {
  const result = await getPool().query<E2EMealPlanRow>(
    `select id, tenant_id, user_id, people_count, period, mode, base_cuisine, fusion_cuisines,
            fusion_intensity, restrictions, inventory_snapshot, calendar_payload, ai_content
     from public.user_meal_plans
     where user_id = $1 and tenant_id = $2
     order by created_at desc, id desc limit 1`,
    [identity.userId, identity.tenantId]
  );
  return result.rows[0] ?? null;
}

export async function recipeHistoryCount(identity: AuthenticatedE2EIdentity): Promise<number> {
  const result = await getPool().query<{ count: string }>(
    'select count(*)::text as count from public.recipe_ai_history where user_id = $1 and tenant_id = $2',
    [identity.userId, identity.tenantId]
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function closeE2EDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
