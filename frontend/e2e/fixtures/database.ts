import { type Page } from '@playwright/test';
import Redis from 'ioredis';
import { Pool, type PoolClient } from 'pg';
import { validateE2ETargets } from '../database-target';
import {
  buildE2ECachePattern,
  requireE2EIsolationConfiguration,
  requireE2EExecutionId,
} from './isolation';

const { databaseUrl: DATABASE_URL, redisUrl: REDIS_URL } = validateE2ETargets(process.env);
const VECTOR_1536 = `[${Array.from({ length: 1536 }, () => '1').join(',')}]`;

let pool: Pool | null = null;
let isolationLeaseClient: PoolClient | null = null;

export interface AuthenticatedE2EIdentity {
  userId: string;
  tenantId: string;
}

interface ProfileSnapshot {
  tenantId: string;
  level: string | null;
  availableTimeMinutes: number | null;
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
  is_saved: boolean;
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

export async function assertE2EDisposableIsolation(database: Pick<Pool, 'query'>): Promise<void> {
  requireE2EIsolationConfiguration(process.env);
  const targets = validateE2ETargets(process.env);
  if (targets.databaseTarget.database !== 'cocinacore_local_db') {
    throw new Error('Refusing E2E isolation outside the approved disposable database.');
  }

  const databaseIdentity = await database.query<{ databaseName: string }>(
    'select current_database() as "databaseName"'
  );
  const identity = databaseIdentity.rows[0];
  if (identity?.databaseName !== 'cocinacore_local_db') {
    throw new Error('E2E database identity does not match the approved disposable target.');
  }

  if (!isolationLeaseClient) {
    const leaseClient = await getPool().connect();
    const lease = await leaseClient.query<{ acquired: boolean }>(
      `select pg_try_advisory_lock(hashtextextended($1, 0)) as acquired`,
      ['cocinacore:e2e:exclusive-disposable-lane']
    );
    if (!lease.rows[0]?.acquired) {
      leaseClient.release();
      throw new Error('Another E2E execution already owns the disposable database lane.');
    }
    isolationLeaseClient = leaseClient;
    process.once('exit', () => {
      isolationLeaseClient?.release();
      isolationLeaseClient = null;
    });
  }

  // Migration 019 is append-only by design. The lease plus workers=1 proves
  // that this disposable database is owned by one execution; audit rows are
  // retained until the disposable database itself is destroyed.
  requireE2EExecutionId(process.env);
}

export async function hasAppendOnlyE2EReferences(
  database: Pick<Pool, 'query'>,
  tenantId: string,
  userId: string,
  planIds: readonly string[]
): Promise<boolean> {
  if (planIds.length === 0) return false;
  const result = await database.query<{ referenced: boolean }>(
    `select exists (
       select 1 from public.meal_consumption_claims
        where tenant_id = $1 and user_id = $2 and meal_plan_id = any($3::uuid[])
     ) or exists (
       select 1 from public.real_consumption_operations
        where tenant_id = $1 and user_id = $2 and meal_plan_id = any($3::uuid[])
     ) as referenced`,
    [tenantId, userId, planIds]
  );
  return result.rows[0]?.referenced === true;
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
  requireE2EIsolationConfiguration(process.env);
  const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 1 });
  try {
    const pattern = buildE2ECachePattern(process.env);
    let cursor = '0';
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', '100');
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
  availableTimeMinutes,
}: {
  identity: AuthenticatedE2EIdentity;
  runId: string;
  includeRagChunks?: boolean;
  availableTimeMinutes?: number;
}): Promise<ConnectedRecipeSeed> {
  const db = getPool();
  const safeRunId = sanitizeRunId(runId);
  const globalBookTitle = `E2E Global Tomato Rice ${safeRunId}`;
  const tenantBookTitle = `E2E Tenant Chicken ${safeRunId}`;
  const tenantBBookTitle = `E2E Tenant B Secret ${safeRunId}`;
  const tenantBSecretMarker = `TENANT_B_SECRET_RECIPE_MARKER_${safeRunId}`;

  const [profileResult, profileTermsResult, historyResult, mealPlanResult] = await Promise.all([
    db.query<ProfileSnapshot>(
      `select tenant_id as "tenantId", level,
              available_time_minutes as "availableTimeMinutes"
       from public.user_culinary_profiles where user_id = $1`,
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
    `insert into public.user_culinary_profiles (user_id, tenant_id, level, available_time_minutes)
     values ($1, $2, 'Intermedio', $3)
     on conflict (user_id) do update set tenant_id = excluded.tenant_id, level = excluded.level, updated_at = now()`,
    [identity.userId, identity.tenantId, profileResult.rows[0]?.availableTimeMinutes ?? null]
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

  if (!includeRagChunks) {
    if (availableTimeMinutes !== undefined) {
      await db.query(
        'update public.user_culinary_profiles set available_time_minutes = $2 where user_id = $1',
        [identity.userId, availableTimeMinutes]
      );
    }
    return seed;
  }

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
  if (availableTimeMinutes !== undefined) {
    await db.query(
      'update public.user_culinary_profiles set available_time_minutes = $2 where user_id = $1',
      [identity.userId, availableTimeMinutes]
    );
  }
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
      `insert into public.user_culinary_profiles
         (user_id, tenant_id, level, available_time_minutes)
       values ($1, $2, $3, $4)
       on conflict (user_id) do update set tenant_id = excluded.tenant_id, level = excluded.level,
         available_time_minutes = excluded.available_time_minutes, updated_at = now()`,
      [
        seed.identity.userId,
        seed.originalProfile.tenantId,
        seed.originalProfile.level,
        seed.originalProfile.availableTimeMinutes,
      ]
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
    `select id, tenant_id, user_id, recipe_title, is_saved, recipe_payload
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
  isolationLeaseClient?.release();
  isolationLeaseClient = null;
  if (pool) {
    await pool.end();
    pool = null;
  }
}
