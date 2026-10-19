import { Pool } from 'pg';
import { validateE2ETargets } from '../database-target';

const { databaseUrl } = validateE2ETargets(process.env);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let pool: Pool | null = null;

export interface RecipePersistentIdentity {
  userId: string;
  tenantId: string;
}

export interface RecipeHistoryRow {
  id: string;
  tenant_id: string;
  user_id: string;
  recipe_title: string | null;
  is_saved: boolean;
  recipe_payload: {
    structuredIngredients?: unknown[];
  };
}

interface ImportedRecipeRow {
  recipe_id: string;
  history_id: string | null;
}

function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: databaseUrl });
  return pool;
}

function requireUuid(value: string, label: string): string {
  if (!UUID_PATTERN.test(value)) throw new Error(`${label} must be a UUID.`);
  return value;
}

function validateIdentity(identity: RecipePersistentIdentity): RecipePersistentIdentity {
  return {
    userId: requireUuid(identity.userId, 'E2E user id'),
    tenantId: requireUuid(identity.tenantId, 'E2E tenant id'),
  };
}

export async function resolveRecipePersistentIdentity(profileResponse: {
  ok(): boolean;
  status(): number;
  json(): Promise<unknown>;
}): Promise<RecipePersistentIdentity> {
  if (!profileResponse.ok()) {
    throw new Error(`Unable to resolve authenticated E2E identity (${profileResponse.status()}).`);
  }
  const payload: unknown = await profileResponse.json();
  if (typeof payload !== 'object' || payload === null || !('user' in payload)) {
    throw new Error('Authenticated E2E response did not include a user identity.');
  }
  const user = payload.user;
  if (typeof user !== 'object' || user === null || !('id' in user) || !('tenant' in user)) {
    throw new Error('Authenticated E2E response did not include a user identity.');
  }
  const tenant = user.tenant;
  if (
    typeof user.id !== 'string' ||
    typeof tenant !== 'object' ||
    tenant === null ||
    !('tenantId' in tenant) ||
    typeof tenant.tenantId !== 'string'
  ) {
    throw new Error('Authenticated E2E user must have both a user id and tenant id.');
  }
  return validateIdentity({ userId: user.id, tenantId: tenant.tenantId });
}

export async function latestRecipeHistory(
  identity: RecipePersistentIdentity
): Promise<RecipeHistoryRow | null> {
  const { userId, tenantId } = validateIdentity(identity);
  const result = await db().query<RecipeHistoryRow>(
    `select id, tenant_id, user_id, recipe_title, is_saved, recipe_payload
     from public.recipe_ai_history
     where user_id = $1 and tenant_id = $2
     order by created_at desc, id desc limit 1`,
    [userId, tenantId]
  );
  const row = result.rows[0] ?? null;
  if (row) requireUuid(row.id, 'Recipe history id');
  return row;
}

export async function recipeImportLink(
  identity: RecipePersistentIdentity,
  historyId: string,
  title: string
): Promise<ImportedRecipeRow | null> {
  const { userId, tenantId } = validateIdentity(identity);
  const safeHistoryId = requireUuid(historyId, 'Recipe history id');
  const result = await db().query<ImportedRecipeRow>(
    `select recipe.id as recipe_id, version.source_recipe_history_id as history_id
     from public.user_recipes recipe
     join public.user_recipe_versions version
       on version.recipe_id = recipe.id
      and version.tenant_id = recipe.tenant_id
      and version.user_id = recipe.user_id
     where recipe.user_id = $1 and recipe.tenant_id = $2
       and version.user_id = $1 and version.tenant_id = $2
       and version.source_recipe_history_id = $3 and version.title = $4
     order by version.version_number desc limit 1`,
    [userId, tenantId, safeHistoryId, title]
  );
  const row = result.rows[0] ?? null;
  if (row) {
    requireUuid(row.recipe_id, 'Recipe id');
    if (row.history_id) requireUuid(row.history_id, 'Recipe history id');
  }
  return row;
}

export async function cleanupConnectedRecipeRun(
  identity: RecipePersistentIdentity,
  recipeIds: readonly string[],
  historyIds: readonly string[]
): Promise<void> {
  const { userId, tenantId } = validateIdentity(identity);
  const safeRecipeIds = recipeIds.map((id) => requireUuid(id, 'Recipe id'));
  const safeHistoryIds = historyIds.map((id) => requireUuid(id, 'Recipe history id'));
  if (safeRecipeIds.length > 0) {
    await db().query(
      `delete from public.user_recipes
       where id = any($1::uuid[]) and user_id = $2 and tenant_id = $3`,
      [safeRecipeIds, userId, tenantId]
    );
  }
  if (safeHistoryIds.length > 0) {
    await db().query(
      `delete from public.recipe_ai_history
       where id = any($1::uuid[]) and user_id = $2 and tenant_id = $3`,
      [safeHistoryIds, userId, tenantId]
    );
  }
}

export async function cleanupTemporaryRecipeUser(
  temporaryIdentity: RecipePersistentIdentity,
  protectedIdentity: RecipePersistentIdentity
): Promise<void> {
  const temporary = validateIdentity(temporaryIdentity);
  const protectedUser = validateIdentity(protectedIdentity);
  if (temporary.userId === protectedUser.userId || temporary.tenantId === protectedUser.tenantId) {
    throw new Error(
      'Refusing to clean up a temporary E2E identity that overlaps the protected identity.'
    );
  }

  const membership = await db().query<{ count: string; user_id: string | null }>(
    `select count(*)::text as count, min(user_id::text) as user_id
     from public.tenant_memberships where tenant_id = $1`,
    [temporary.tenantId]
  );
  if (membership.rows[0]?.count !== '1' || membership.rows[0]?.user_id !== temporary.userId) {
    throw new Error(
      'Refusing temporary E2E cleanup unless the tenant has exactly one matching membership.'
    );
  }

  await db().query('delete from public.tenant_memberships where tenant_id = $1 and user_id = $2', [
    temporary.tenantId,
    temporary.userId,
  ]);
  await db().query('delete from public.users where id = $1 and tenant_id = $2', [
    temporary.userId,
    temporary.tenantId,
  ]);
  await db().query('delete from public.tenants where id = $1', [temporary.tenantId]);
}

export async function closeRecipePersistentDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
