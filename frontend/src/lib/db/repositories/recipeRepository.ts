import { query, mapSingleRow } from '@/lib/db';
import { RecipeAiHistoryRow } from '@/lib/db/types';

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
  options: { onlySaved?: boolean; userId?: string } = {}
): Promise<RecipeAiHistoryRow[]> {
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

  const result = await query<RecipeAiHistoryRow>(
    `select * from public.recipe_ai_history
     where ${conditions.join(' and ')}
     order by created_at desc`,
    params
  );
  return result.rows;
}

export async function findRecipeHistoryById(
  id: string,
  tenantId: string
): Promise<RecipeAiHistoryRow | null> {
  const result = await query<RecipeAiHistoryRow>(
    'select * from public.recipe_ai_history where id = $1 and tenant_id = $2',
    [id, tenantId]
  );
  return mapSingleRow(result);
}

export async function createRecipeHistory(
  input: CreateRecipeHistoryInput
): Promise<RecipeAiHistoryRow> {
  const result = await query<RecipeAiHistoryRow>(
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
  );

  const recipe = mapSingleRow(result);
  if (!recipe) throw new Error('Failed to create recipe history');
  return recipe;
}

export async function deleteRecipeHistory(id: string, tenantId: string): Promise<void> {
  await query('delete from public.recipe_ai_history where id = $1 and tenant_id = $2', [
    id,
    tenantId,
  ]);
}

export async function updateRecipeFeedback(
  id: string,
  tenantId: string,
  feedback: 'accepted' | 'discarded'
): Promise<RecipeAiHistoryRow | null> {
  const result = await query<RecipeAiHistoryRow>(
    `update public.recipe_ai_history
     set user_feedback = $1, user_feedback_at = now()
     where id = $2 and tenant_id = $3
     returning *`,
    [feedback, id, tenantId]
  );
  return mapSingleRow(result);
}

export async function toggleRecipeSaved(
  id: string,
  tenantId: string,
  isSaved: boolean
): Promise<RecipeAiHistoryRow | null> {
  const result = await query<RecipeAiHistoryRow>(
    `update public.recipe_ai_history
     set is_saved = $1
     where id = $2 and tenant_id = $3
     returning *`,
    [isSaved, id, tenantId]
  );
  return mapSingleRow(result);
}
