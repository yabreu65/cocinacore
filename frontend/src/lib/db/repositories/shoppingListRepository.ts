import { mapSingleRow, query } from '@/lib/db';
import type { ShoppingItemStatus, ShoppingListItemRow } from '@/lib/db/types';

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
