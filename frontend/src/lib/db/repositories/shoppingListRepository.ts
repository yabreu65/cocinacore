import type { DbTransactionClient } from '@/lib/db/transaction-client';
import { lockInventorySourceTenant } from '@/lib/db/inventory-source-lock';
import { mapSingleRow, query, scopedTransaction, type AuthenticatedDbScope } from '@/lib/db';
import type {
  ShoppingItemStatus,
  ShoppingListItemRow,
  RecipeInventoryItemRow,
} from '@/lib/db/types';
import { createInventoryItemInTransaction } from '@/lib/db/repositories/inventoryRepository';
import {
  detectInventoryCategory,
  normalizeInventoryName,
} from '@/lib/inventory/normalize-inventory';
import { parseExplicitQuantity } from '@/lib/inventory/quantity-normalization';

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

export class ShoppingListTransferError extends Error {
  constructor(readonly code: 'not_purchased' | 'invalid_quantity' | 'inventory_missing') {
    super(code);
    this.name = 'ShoppingListTransferError';
  }
}

export interface ShoppingListTransferResult {
  item: ShoppingListItemRow;
  inventoryItem: RecipeInventoryItemRow;
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
  dedupeScope?: 'source' | 'user';
}

export interface AddMealPlanShoppingItemsResult {
  added: ShoppingListItemRow[];
  alreadyPresent: ShoppingListItemRow[];
}

export async function listShoppingListItems(
  tenantId: string,
  userId: string,
  filter: ShoppingListFilter = {},
  limit?: number,
  scope?: AuthenticatedDbScope
): Promise<ShoppingListItemRow[]> {
  const values: unknown[] = [tenantId, userId];
  const statusClause = filter.status ? ` and status = $${values.push(filter.status)}` : '';
  const boundedLimit =
    typeof limit === 'number' && Number.isInteger(limit) && limit > 0 ? Math.min(limit, 501) : null;
  const limitClause = boundedLimit === null ? '' : ` limit $${values.push(boundedLimit)}`;

  const sql = `select * from public.shopping_list_items
     where tenant_id = $1 and user_id = $2${statusClause}
     order by created_at desc, id desc${limitClause}`;
  if (scope && (scope.tenantId !== tenantId || scope.userId !== userId))
    throw new Error('Shopping scope mismatch');
  const result = scope
    ? await scopedTransaction(scope, (client) => client.query<ShoppingListItemRow>(sql, values))
    : await query<ShoppingListItemRow>(sql, values);
  return result.rows;
}

export async function createShoppingListItem(
  input: CreateShoppingListItemInput
): Promise<ShoppingListItemRow> {
  const result = await scopedTransaction(
    { tenantId: input.tenantId, userId: input.userId },
    async (client) => {
      await lockInventorySourceTenant(client, input.tenantId);
      return client.query<ShoppingListItemRow>(
        `insert into public.shopping_list_items
     (tenant_id, user_id, source, ingredient_name, quantity)
     values ($1, $2, $3, $4, $5)
     returning *`,
        [input.tenantId, input.userId, input.source, input.ingredientName, input.quantity ?? null]
      );
    }
  );

  const item = mapSingleRow(result);
  if (!item) throw new Error('Failed to create shopping list item');
  return item;
}

export async function addMealPlanShoppingItems(
  input: AddMealPlanShoppingItemsInput
): Promise<AddMealPlanShoppingItemsResult> {
  return scopedTransaction({ tenantId: input.tenantId, userId: input.userId }, (client) =>
    addMealPlanShoppingItemsInTransaction(client, input)
  );
}

/** Caller supplies an authenticated transaction. Reacquiring the same tenant
 * advisory lock is safe; it remains held until that transaction ends. */
export async function addMealPlanShoppingItemsInTransaction(
  client: DbTransactionClient,
  input: AddMealPlanShoppingItemsInput
): Promise<AddMealPlanShoppingItemsResult> {
  await lockInventorySourceTenant(client, input.tenantId);
  const dedupeScope = input.dedupeScope ?? 'source';
  const lockKey = `${input.tenantId}:${input.userId}:${dedupeScope === 'user' ? 'shopping-list' : input.source}`;
  await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [lockKey]);
  const existingScope =
    dedupeScope === 'user'
      ? 'tenant_id = $1 and user_id = $2'
      : 'tenant_id = $1 and user_id = $2 and source = $3';
  const existingResult = await client.query<ShoppingListItemRow>(
    `select * from public.shopping_list_items
       where ${existingScope}`,
    dedupeScope === 'user'
      ? [input.tenantId, input.userId]
      : [input.tenantId, input.userId, input.source]
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
}

export async function transferPurchasedShoppingListItem(
  id: string,
  tenantId: string,
  userId: string
): Promise<ShoppingListTransferResult | null> {
  return scopedTransaction({ tenantId, userId }, async (client) => {
    await lockInventorySourceTenant(client, tenantId);
    const itemResult = await client.query<ShoppingListItemRow>(
      `select * from public.shopping_list_items
       where id = $1 and tenant_id = $2 and user_id = $3
       for update`,
      [id, tenantId, userId]
    );
    const item = itemResult.rows[0];
    if (!item) return null;

    if (item.transfer_inventory_item_id) {
      const inventoryResult = await client.query<RecipeInventoryItemRow>(
        `select * from public.recipe_inventory_items
         where id = $1 and tenant_id = $2 and user_id = $3`,
        [item.transfer_inventory_item_id, tenantId, userId]
      );
      const inventoryItem = inventoryResult.rows[0];
      if (!inventoryItem) throw new ShoppingListTransferError('inventory_missing');
      return { item, inventoryItem };
    }

    if (item.status !== 'purchased') throw new ShoppingListTransferError('not_purchased');
    const parsed = item.quantity === null ? null : parseExplicitQuantity(item.quantity);
    if (!parsed) throw new ShoppingListTransferError('invalid_quantity');

    const normalizedName = normalizeInventoryName(item.ingredient_name);
    const unit = parsed.unit;
    const quantity = String(parsed.value);
    if (!normalizedName) throw new ShoppingListTransferError('invalid_quantity');
    const inventoryItem = await createInventoryItemInTransaction(client, {
      tenantId,
      userId,
      ingredientName: item.ingredient_name,
      quantity,
      unit,
      category: detectInventoryCategory(item.ingredient_name),
      normalizedName,
    });

    await client.query(
      `insert into public.inventory_movements
       (tenant_id, user_id, inventory_item_id, movement_type, quantity, unit, normalized_name, source)
       values ($1, $2, $3, 'purchase', $4, $5, $6, 'shopping_list')`,
      [tenantId, userId, inventoryItem.id, quantity, unit, normalizedName]
    );
    const updatedResult = await client.query<ShoppingListItemRow>(
      `update public.shopping_list_items
       set transfer_inventory_item_id = $1, transferred_at = now(), updated_at = now()
       where id = $2 and tenant_id = $3 and user_id = $4
       returning *`,
      [inventoryItem.id, id, tenantId, userId]
    );
    const transferredItem = updatedResult.rows[0];
    if (!transferredItem) throw new Error('Failed to persist shopping transfer marker');
    return { item: transferredItem, inventoryItem };
  });
}

export async function updateShoppingListItemStatus(
  id: string,
  tenantId: string,
  userId: string,
  status: ShoppingItemStatus
): Promise<ShoppingListItemRow | null> {
  const result = await scopedTransaction({ tenantId, userId }, async (client) => {
    await lockInventorySourceTenant(client, tenantId);
    return client.query<ShoppingListItemRow>(
      `update public.shopping_list_items
     set status = $1, updated_at = now()
     where id = $2 and tenant_id = $3 and user_id = $4
     returning *`,
      [status, id, tenantId, userId]
    );
  });
  return mapSingleRow(result);
}

export async function deleteShoppingListItem(
  id: string,
  tenantId: string,
  userId: string
): Promise<ShoppingListItemRow | null> {
  const result = await scopedTransaction({ tenantId, userId }, async (client) => {
    await lockInventorySourceTenant(client, tenantId);
    return client.query<ShoppingListItemRow>(
      `delete from public.shopping_list_items
     where id = $1 and tenant_id = $2 and user_id = $3
     returning *`,
      [id, tenantId, userId]
    );
  });
  return mapSingleRow(result);
}
