import { mapSingleRow, query, transaction } from '@/lib/db';
import type { ShoppingItemStatus, ShoppingListItemRow } from '@/lib/db/types';
import { normalizeInventoryName } from '@/lib/inventory/normalize-inventory';

export interface CreateShoppingListItemInput {
  tenantId: string;
  userId: string;
  ingredientName: string;
  quantity?: string | null;
  source: string;
}

export interface ShoppingListFilter {
  status?: ShoppingItemStatus;
}

export interface MealPlanShoppingItemInput {
  ingredientName: string;
  quantity: string | null;
}

export interface AddMealPlanShoppingItemsInput {
  tenantId: string;
  userId: string;
  source: string;
  items: MealPlanShoppingItemInput[];
}

export interface AddMealPlanShoppingItemsResult {
  added: ShoppingListItemRow[];
  alreadyPresent: ShoppingListItemRow[];
}

export async function listShoppingListItems(
  tenantId: string,
  userId: string,
  filter: ShoppingListFilter = {}
): Promise<ShoppingListItemRow[]> {
  const values: unknown[] = [tenantId, userId];
  const statusClause = filter.status ? ` and status = $${values.push(filter.status)}` : '';

  const result = await query<ShoppingListItemRow>(
    `select * from public.shopping_list_items
     where tenant_id = $1 and user_id = $2${statusClause}
     order by created_at desc, id desc`,
    values
  );
  return result.rows;
}

export async function createShoppingListItem(
  input: CreateShoppingListItemInput
): Promise<ShoppingListItemRow> {
  const result = await query<ShoppingListItemRow>(
    `insert into public.shopping_list_items
     (tenant_id, user_id, source, ingredient_name, quantity)
     values ($1, $2, $3, $4, $5)
     returning *`,
    [input.tenantId, input.userId, input.source, input.ingredientName, input.quantity ?? null]
  );

  const item = mapSingleRow(result);
  if (!item) throw new Error('Failed to create shopping list item');
  return item;
}

export async function addMealPlanShoppingItems(
  input: AddMealPlanShoppingItemsInput
): Promise<AddMealPlanShoppingItemsResult> {
  return transaction(async (client) => {
    const lockKey = `${input.tenantId}:${input.userId}:${input.source}`;
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [lockKey]);
    const existingResult = await client.query<ShoppingListItemRow>(
      `select * from public.shopping_list_items
       where tenant_id = $1 and user_id = $2 and source = $3`,
      [input.tenantId, input.userId, input.source]
    );
    const byIdentity = new Map(
      existingResult.rows.map((row) => [normalizeInventoryName(row.ingredient_name), row])
    );
    const added: ShoppingListItemRow[] = [];
    const alreadyPresent: ShoppingListItemRow[] = [];
    const seen = new Set<string>();

    for (const item of input.items) {
      const identity = normalizeInventoryName(item.ingredientName);
      if (seen.has(identity)) continue;
      seen.add(identity);
      const existing = byIdentity.get(identity);
      if (existing) {
        alreadyPresent.push(existing);
        continue;
      }
      const result = await client.query<ShoppingListItemRow>(
        `insert into public.shopping_list_items
         (tenant_id, user_id, source, ingredient_name, quantity)
         values ($1, $2, $3, $4, $5)
         returning *`,
        [input.tenantId, input.userId, input.source, item.ingredientName, item.quantity]
      );
      const inserted = result.rows[0];
      if (!inserted) throw new Error('Failed to create meal-plan shopping item');
      added.push(inserted);
      byIdentity.set(identity, inserted);
    }

    return { added, alreadyPresent };
  });
}

export async function updateShoppingListItemStatus(
  id: string,
  tenantId: string,
  userId: string,
  status: ShoppingItemStatus
): Promise<ShoppingListItemRow | null> {
  const result = await query<ShoppingListItemRow>(
    `update public.shopping_list_items
     set status = $1, updated_at = now()
     where id = $2 and tenant_id = $3 and user_id = $4
     returning *`,
    [status, id, tenantId, userId]
  );
  return mapSingleRow(result);
}

export async function deleteShoppingListItem(
  id: string,
  tenantId: string,
  userId: string
): Promise<ShoppingListItemRow | null> {
  const result = await query<ShoppingListItemRow>(
    `delete from public.shopping_list_items
     where id = $1 and tenant_id = $2 and user_id = $3
     returning *`,
    [id, tenantId, userId]
  );
  return mapSingleRow(result);
}
