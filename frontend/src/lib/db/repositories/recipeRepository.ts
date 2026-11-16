import {
  mapSingleRow,
  transaction,
  scopedTransaction,
  type AuthenticatedDbScope,
  type DbOperationOptions,
} from '@/lib/db';
import type { PoolClient } from 'pg';
import type {
  ManualRecipeIngredient,
  RecipeAiHistoryRow,
  UserRecipeDetailDto,
  UserRecipeListDto,
  UserRecipeRow,
  UserRecipeVersionRow,
} from '@/lib/db/types';

export type TodayRecipeHistoryRow = Pick<
  RecipeAiHistoryRow,
  'source' | 'recipe_title' | 'recipe_payload' | 'created_at'
>;

const MAX_TODAY_HISTORY_LIMIT = 20;

export async function listTodayRecipeHistoryByUserAndTenant(
  userId: string,
  tenantId: string,
  asOf: string,
  limit: number,
  timeZone: string = 'UTC'
): Promise<TodayRecipeHistoryRow[]> {
  const boundedLimit = Number.isFinite(limit)
    ? Math.min(MAX_TODAY_HISTORY_LIMIT, Math.max(1, Math.floor(limit)))
    : MAX_TODAY_HISTORY_LIMIT;
  const result = await scopedTransaction({ tenantId, userId }, (client) =>
    client.query<TodayRecipeHistoryRow>(
      `select source, recipe_title, recipe_payload, created_at
     from public.recipe_ai_history
     where user_id = $1 and tenant_id = $2 and created_at >= (($3::date - 1)::timestamp at time zone 'UTC')
       and (created_at at time zone $5)::date = $3::date
     order by created_at desc, id desc
     limit $4`,
      [userId, tenantId, asOf, boundedLimit, timeZone]
    )
  );
  return result.rows;
}

export interface CreateRecipeHistoryInput {
  tenantId: string;
  userId: string;
  source: string;
  recipeTitle: string | null;
  recipePayload: unknown;
  restrictionsSnapshot?: unknown;
  inventorySnapshot?: unknown;
}

export async function listRecipeHistoryByTenant(
  tenantId: string,
  options: { onlySaved?: boolean; userId?: string },
  scope: AuthenticatedDbScope
): Promise<RecipeAiHistoryRow[]> {
  if (!scope || scope.tenantId !== tenantId) throw new Error('Recipe history scope mismatch');
  const conditions = ['tenant_id = $1'];
  const params: unknown[] = [tenantId];

  if (options.onlySaved) {
    params.push(true);
    conditions.push(`is_saved = $${params.length}`);
  }
  if (options.userId) {
    params.push(options.userId);
    conditions.push(`user_id = $${params.length}`);
  }

  const result = await scopedTransaction(scope, (client) =>
    client.query<RecipeAiHistoryRow>(
      `select * from public.recipe_ai_history
     where ${conditions.join(' and ')}
     order by created_at desc`,
      params
    )
  );
  return result.rows;
}

export async function findRecipeHistoryById(
  id: string,
  tenantId: string,
  scope: AuthenticatedDbScope
): Promise<RecipeAiHistoryRow | null> {
  if (!scope || scope.tenantId !== tenantId) throw new Error('Recipe history scope mismatch');
  const result = await scopedTransaction(scope, (client) =>
    client.query<RecipeAiHistoryRow>(
      'select * from public.recipe_ai_history where id = $1 and tenant_id = $2',
      [id, tenantId]
    )
  );
  return mapSingleRow(result);
}

export async function createRecipeHistory(
  input: CreateRecipeHistoryInput
): Promise<RecipeAiHistoryRow> {
  const result = await scopedTransaction(
    { tenantId: input.tenantId, userId: input.userId },
    (client) =>
      client.query<RecipeAiHistoryRow>(
        `insert into public.recipe_ai_history
     (tenant_id, user_id, source, recipe_title, recipe_payload, restrictions_snapshot, inventory_snapshot)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning *`,
        [
          input.tenantId,
          input.userId,
          input.source,
          input.recipeTitle,
          JSON.stringify(input.recipePayload),
          JSON.stringify(input.restrictionsSnapshot ?? {}),
          JSON.stringify(input.inventorySnapshot ?? {}),
        ]
      )
  );

  const recipe = mapSingleRow(result);
  if (!recipe) throw new Error('Failed to create recipe history');
  return recipe;
}

export async function deleteRecipeHistory(
  id: string,
  tenantId: string,
  userId: string
): Promise<'deleted_or_missing' | 'linked'> {
  try {
    return await scopedTransaction({ tenantId, userId }, async (client) => {
      // Keep the history that supplies provenance to immutable recipe versions.
      // Scope the lookup as strictly as the deletion itself.
      const linked = await client.query(
        `select 1 from public.user_recipe_versions
         where source_recipe_history_id = $1 and tenant_id = $2 and user_id = $3
         limit 1`,
        [id, tenantId, userId]
      );
      if (linked.rows.length > 0) return 'linked';
      await client.query(
        'delete from public.recipe_ai_history where id = $1 and tenant_id = $2 and user_id = $3',
        [id, tenantId, userId]
      );
      return 'deleted_or_missing';
    });
  } catch (error) {
    // A concurrent import can link the history after the lookup. PostgreSQL's
    // immutable-version trigger rejects the FK's ON DELETE SET NULL update,
    // rolling back the deletion. Translate only that precise database error.
    if (getPgCode(error) === 'P0001' && error instanceof Error &&
        error.message === 'USER_RECIPE_VERSION_IMMUTABLE') return 'linked';
    throw error;
  }
}

export async function updateRecipeFeedback(
  id: string,
  tenantId: string,
  userId: string,
  feedback: 'accepted' | 'discarded'
): Promise<RecipeAiHistoryRow | null> {
  const result = await scopedTransaction({ tenantId, userId }, (client) =>
    client.query<RecipeAiHistoryRow>(
      `update public.recipe_ai_history
     set user_feedback = $1, user_feedback_at = now()
     where id = $2 and tenant_id = $3 and user_id = $4
     returning *`,
      [feedback, id, tenantId, userId]
    )
  );
  return mapSingleRow(result);
}

export async function toggleRecipeSaved(
  id: string,
  tenantId: string,
  userId: string,
  isSaved: boolean
): Promise<RecipeAiHistoryRow | null> {
  const result = await scopedTransaction({ tenantId, userId }, (client) =>
    client.query<RecipeAiHistoryRow>(
      `update public.recipe_ai_history
     set is_saved = $1
     where id = $2 and tenant_id = $3 and user_id = $4
     returning *`,
      [isSaved, id, tenantId, userId]
    )
  );
  return mapSingleRow(result);
}

export interface PersistentRecipeContent {
  title: string;
  instructions: string;
  servings?: number | null;
  ingredients: ManualRecipeIngredient[];
  category?: string | null;
  tags?: string[];
  sourceRecipeHistoryId?: string | null;
}

export interface PersistentRecipeScope {
  tenantId: string;
  userId: string;
}

export interface PersistentRecipeListOptions {
  search?: string;
  archived?: 'active' | 'archived' | 'all';
  limit?: number;
  offset?: number;
  includeSentinel?: boolean;
}

export interface DuplicateRecipeCandidate {
  recipeId: string;
  title: string;
  versionNumber: number;
}

type PersistentRecipeListQueryRow = UserRecipeRow & {
  current_version_id: string;
  current_version_number: number;
  current_version_title: string;
  current_version_instructions: string;
  current_version_servings: number | null;
  current_version_ingredients: ManualRecipeIngredient[];
  current_version_source_recipe_history_id: string | null;
  current_version_created_at: string;
};

export class RecipeRepositoryError extends Error {
  constructor(readonly code: 'conflict' | 'operation_failed') {
    super(
      code === 'conflict'
        ? 'Recipe changed concurrently. Please retry.'
        : 'Recipe operation failed.'
    );
    this.name = 'RecipeRepositoryError';
  }
}

function getPgCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

async function safely<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const code = getPgCode(error);
    if (code === '23505' || code === '40001' || code === '40P01') {
      throw new RecipeRepositoryError('conflict');
    }
    if (error instanceof RecipeRepositoryError) throw error;
    throw new RecipeRepositoryError('operation_failed');
  }
}

async function setRecipeRlsContext(
  client: PoolClient,
  scope: PersistentRecipeScope
): Promise<void> {
  await client.query(
    "select set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)",
    [scope.tenantId, scope.userId]
  );
}

async function insertRecipeVersion(
  client: PoolClient,
  scope: PersistentRecipeScope,
  recipeId: string,
  versionNumber: number,
  content: PersistentRecipeContent
): Promise<UserRecipeVersionRow> {
  const result = await client.query<UserRecipeVersionRow>(
    `insert into public.user_recipe_versions
     (recipe_id, tenant_id, user_id, version_number, title, instructions, servings, ingredients, source_recipe_history_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
     returning *`,
    [
      recipeId,
      scope.tenantId,
      scope.userId,
      versionNumber,
      content.title,
      content.instructions,
      content.servings ?? null,
      JSON.stringify(content.ingredients),
      content.sourceRecipeHistoryId ?? null,
    ]
  );
  const version = result.rows[0];
  if (!version) throw new RecipeRepositoryError('operation_failed');
  return version;
}

export async function createPersistentRecipe(
  scope: PersistentRecipeScope,
  content: PersistentRecipeContent
): Promise<UserRecipeDetailDto> {
  return safely(() =>
    transaction(async (client) => {
      await setRecipeRlsContext(client, scope);
      const inserted = await client.query<UserRecipeRow>(
        `insert into public.user_recipes (tenant_id, user_id, category, tags)
       values ($1, $2, $3, $4) returning *`,
        [scope.tenantId, scope.userId, content.category ?? null, content.tags ?? []]
      );
      const recipe = inserted.rows[0];
      if (!recipe) throw new RecipeRepositoryError('operation_failed');
      const version = await insertRecipeVersion(client, scope, recipe.id, 1, content);
      return { ...recipe, current_version: version };
    })
  );
}

export async function listPersistentRecipes(
  scope: PersistentRecipeScope,
  options: PersistentRecipeListOptions = {}
): Promise<UserRecipeListDto[]> {
  return safely(() =>
    transaction(async (client) => {
      await setRecipeRlsContext(client, scope);
      const conditions = ['recipe.tenant_id = $1', 'recipe.user_id = $2'];
      const values: unknown[] = [scope.tenantId, scope.userId];
      if ((options.archived ?? 'active') === 'active')
        conditions.push('recipe.archived_at is null');
      if (options.archived === 'archived') conditions.push('recipe.archived_at is not null');
      if (options.search?.trim()) {
        values.push(`%${options.search.trim()}%`);
        conditions.push(`current_version.title ilike $${values.length}`);
      }
      const requestedLimit = Math.max(1, Math.floor(options.limit ?? 50));
      const maxLimit = options.includeSentinel ? 101 : 100;
      const limit = Math.min(maxLimit, requestedLimit + (options.includeSentinel ? 1 : 0));
      values.push(limit);
      const limitParam = values.length;
      values.push(Math.max(0, Math.floor(options.offset ?? 0)));
      const offsetParam = values.length;
      const result = await client.query<PersistentRecipeListQueryRow>(
        `select recipe.id, recipe.tenant_id, recipe.user_id, recipe.category, recipe.tags,
              recipe.archived_at, recipe.created_at, recipe.updated_at,
              current_version.id as current_version_id,
              current_version.version_number as current_version_number,
              current_version.title as current_version_title,
              current_version.instructions as current_version_instructions,
              current_version.servings as current_version_servings,
              current_version.ingredients as current_version_ingredients,
              current_version.source_recipe_history_id as current_version_source_recipe_history_id,
              current_version.created_at as current_version_created_at
       from public.user_recipes recipe
       join lateral (
         select version.* from public.user_recipe_versions version
         where version.recipe_id = recipe.id and version.tenant_id = $1 and version.user_id = $2
         order by version.version_number desc limit 1
       ) current_version on true
       where ${conditions.join(' and ')}
       order by recipe.updated_at desc, recipe.id
       limit $${limitParam} offset $${offsetParam}`,
        values
      );
      return result.rows.map(
        (row) =>
          ({
            id: row.id,
            tenant_id: row.tenant_id,
            user_id: row.user_id,
            category: row.category,
            tags: row.tags,
            archived_at: row.archived_at,
            created_at: row.created_at,
            updated_at: row.updated_at,
            current_version: {
              id: row.current_version_id,
              version_number: row.current_version_number,
              title: row.current_version_title,
              instructions: row.current_version_instructions,
              servings: row.current_version_servings,
              ingredients: row.current_version_ingredients,
              source_recipe_history_id: row.current_version_source_recipe_history_id,
              created_at: row.current_version_created_at,
            },
          }) as UserRecipeListDto
      );
    })
  );
}

export async function findPersistentRecipeDetail(
  recipeId: string,
  scope: PersistentRecipeScope
): Promise<UserRecipeDetailDto | null> {
  return safely(() =>
    transaction(async (client) => {
      await setRecipeRlsContext(client, scope);
      const recipeResult = await client.query<UserRecipeRow>(
        `select * from public.user_recipes where id = $1 and tenant_id = $2 and user_id = $3`,
        [recipeId, scope.tenantId, scope.userId]
      );
      const recipe = recipeResult.rows[0];
      if (!recipe) return null;
      const versionResult = await client.query<UserRecipeVersionRow>(
        `select * from public.user_recipe_versions
       where recipe_id = $1 and tenant_id = $2 and user_id = $3
       order by version_number desc limit 1`,
        [recipeId, scope.tenantId, scope.userId]
      );
      const currentVersion = versionResult.rows[0];
      return currentVersion ? { ...recipe, current_version: currentVersion } : null;
    })
  );
}

export async function findPersistentRecipeVersion(
  recipeId: string,
  versionId: string,
  scope: PersistentRecipeScope,
  statementTimeoutMs?: number,
  options: DbOperationOptions = {}
): Promise<UserRecipeVersionRow | null> {
  return safely(() =>
    transaction(async (client) => {
      await setRecipeRlsContext(client, scope);
      if (statementTimeoutMs !== undefined) {
        await client.query("select set_config('statement_timeout', $1, true)", [
          `${statementTimeoutMs}ms`,
        ]);
        await client.query("select set_config('lock_timeout', $1, true)", [
          `${statementTimeoutMs}ms`,
        ]);
      }
      const result = await client.query<UserRecipeVersionRow>(
        `select version.* from public.user_recipe_versions version
       join public.user_recipes recipe on recipe.id = version.recipe_id
       where version.id = $1 and version.recipe_id = $2
         and version.tenant_id = $3 and version.user_id = $4
         and recipe.tenant_id = $3 and recipe.user_id = $4
         and recipe.archived_at is null`,
        [versionId, recipeId, scope.tenantId, scope.userId]
      );
      return result.rows[0] ?? null;
    }, options)
  );
}

async function appendVersionInTransaction(
  client: PoolClient,
  scope: PersistentRecipeScope,
  recipeId: string,
  content: PersistentRecipeContent
): Promise<UserRecipeVersionRow | null> {
  const parent = await client.query<UserRecipeRow>(
    `select * from public.user_recipes
     where id = $1 and tenant_id = $2 and user_id = $3
     for update`,
    [recipeId, scope.tenantId, scope.userId]
  );
  const recipe = parent.rows[0];
  if (!recipe) return null;
  const latest = await client.query<{ next_version: number }>(
    `select coalesce(max(version_number), 0) + 1 as next_version
     from public.user_recipe_versions
     where recipe_id = $1 and tenant_id = $2 and user_id = $3`,
    [recipeId, scope.tenantId, scope.userId]
  );
  const nextVersion = latest.rows[0]?.next_version;
  if (nextVersion === undefined) throw new RecipeRepositoryError('operation_failed');
  const version = await insertRecipeVersion(client, scope, recipeId, nextVersion, content);
  await client.query(
    `update public.user_recipes set category = $1, tags = $2, updated_at = now()
     where id = $3 and tenant_id = $4 and user_id = $5`,
    [
      content.category ?? recipe.category,
      content.tags ?? recipe.tags,
      recipeId,
      scope.tenantId,
      scope.userId,
    ]
  );
  return version;
}

export async function appendPersistentRecipeVersion(
  recipeId: string,
  scope: PersistentRecipeScope,
  content: PersistentRecipeContent
): Promise<UserRecipeVersionRow | null> {
  return safely(() =>
    transaction(async (client) => {
      await setRecipeRlsContext(client, scope);
      return appendVersionInTransaction(client, scope, recipeId, content);
    })
  );
}

export async function listPersistentRecipeVersions(
  recipeId: string,
  scope: PersistentRecipeScope
): Promise<UserRecipeVersionRow[]> {
  return safely(() =>
    transaction(async (client) => {
      await setRecipeRlsContext(client, scope);
      const result = await client.query<UserRecipeVersionRow>(
        `select version.* from public.user_recipe_versions version
       join public.user_recipes recipe on recipe.id = version.recipe_id
       where recipe.id = $1 and recipe.tenant_id = $2 and recipe.user_id = $3
         and version.tenant_id = $2 and version.user_id = $3
       order by version.version_number desc`,
        [recipeId, scope.tenantId, scope.userId]
      );
      return result.rows;
    })
  );
}

export async function restorePersistentRecipeVersion(
  recipeId: string,
  versionId: string,
  scope: PersistentRecipeScope
): Promise<UserRecipeVersionRow | null> {
  return safely(() =>
    transaction(async (client) => {
      await setRecipeRlsContext(client, scope);
      const selected = await client.query<UserRecipeVersionRow>(
        `select version.* from public.user_recipe_versions version
       join public.user_recipes recipe on recipe.id = version.recipe_id
       where recipe.id = $1 and version.id = $2 and recipe.tenant_id = $3 and recipe.user_id = $4
         and version.tenant_id = $3 and version.user_id = $4`,
        [recipeId, versionId, scope.tenantId, scope.userId]
      );
      const version = selected.rows[0];
      if (!version) return null;
      return appendVersionInTransaction(client, scope, recipeId, {
        title: version.title,
        instructions: version.instructions,
        servings: version.servings,
        ingredients: version.ingredients,
        sourceRecipeHistoryId: version.source_recipe_history_id,
      });
    })
  );
}

export async function setPersistentRecipeArchived(
  recipeId: string,
  scope: PersistentRecipeScope,
  archived: boolean
): Promise<UserRecipeRow | null> {
  return safely(() =>
    transaction(async (client) => {
      await setRecipeRlsContext(client, scope);
      const result = await client.query<UserRecipeRow>(
        `update public.user_recipes set archived_at = $1, updated_at = now()
       where id = $2 and tenant_id = $3 and user_id = $4 returning *`,
        [archived ? new Date().toISOString() : null, recipeId, scope.tenantId, scope.userId]
      );
      return result.rows[0] ?? null;
    })
  );
}

export async function findDuplicatePersistentRecipeTitles(
  scope: PersistentRecipeScope,
  title: string,
  excludeRecipeId?: string
): Promise<DuplicateRecipeCandidate[]> {
  return safely(() =>
    transaction(async (client) => {
      await setRecipeRlsContext(client, scope);
      const values: unknown[] = [scope.tenantId, scope.userId, title];
      const excludeClause = excludeRecipeId
        ? `and recipe.id <> $${values.push(excludeRecipeId)}`
        : '';
      const result = await client.query<{
        recipe_id: string;
        title: string;
        version_number: number;
      }>(
        `select recipe.id as recipe_id, current_version.title, current_version.version_number
       from public.user_recipes recipe
       join lateral (
         select version.title, version.version_number
         from public.user_recipe_versions version
         where version.recipe_id = recipe.id and version.tenant_id = $1 and version.user_id = $2
         order by version.version_number desc limit 1
       ) current_version on true
       where recipe.tenant_id = $1 and recipe.user_id = $2 and recipe.archived_at is null
         and lower(regexp_replace(btrim(current_version.title), '[^[:alnum:]]+', ' ', 'g')) =
             lower(regexp_replace(btrim($3), '[^[:alnum:]]+', ' ', 'g'))
         ${excludeClause}
       order by recipe.updated_at desc limit 10`,
        values
      );
      return result.rows.map((row) => ({
        recipeId: row.recipe_id,
        title: row.title,
        versionNumber: row.version_number,
      }));
    })
  );
}
