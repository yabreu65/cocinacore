import { PoolClient } from 'pg';
import {
  query,
  queryWithStatementTimeout,
  mapSingleRow,
  scopedTransaction,
  type AuthenticatedDbScope,
  type DbOperationOptions,
} from '@/lib/db';
import { RecipeInventoryItemRow } from '@/lib/db/types';
import {
  validatePriceReference,
  type InventoryPriceReference,
} from '@/lib/inventory/inventory-price';

export interface CreateInventoryItemInput {
  tenantId: string;
  userId: string;
  ingredientName: string;
  quantity?: string | null;
  unit?: string | null;
  category?: string | null;
  expirationDate?: string | null;
  priceReference?: InventoryPriceReference;
  purchaseLocation?: string | null;
  lowStockThreshold?: number | null;
  normalizedName?: string | null;
  notes?: string | null;
}

export interface TodayInventoryContextRow {
  tenant_id: string;
  ingredient_name: string;
  quantity: string | null;
  unit: string | null;
  expiration_date: string | null;
}

const MAX_TODAY_INVENTORY_LIMIT = 50;
export const MAX_WASTE_PREVENTION_INVENTORY_LIMIT = 100;

export async function listWastePreventionInventoryByTenant(
  tenantId: string,
  limit = MAX_WASTE_PREVENTION_INVENTORY_LIMIT,
  scope?: AuthenticatedDbScope
): Promise<RecipeInventoryItemRow[]> {
  const boundedLimit = Number.isFinite(limit)
    ? Math.min(MAX_WASTE_PREVENTION_INVENTORY_LIMIT, Math.max(1, Math.floor(limit)))
    : MAX_WASTE_PREVENTION_INVENTORY_LIMIT;
  const sql = `select * from public.recipe_inventory_items
     where tenant_id = $1
     order by expiration_date asc nulls last, created_at asc, id asc
     limit $2`;
  const params = [tenantId, Math.min(MAX_WASTE_PREVENTION_INVENTORY_LIMIT + 1, boundedLimit + 1)];
  if (scope && scope.tenantId !== tenantId) throw new Error('Inventory scope mismatch.');
  const result = scope
    ? await scopedTransaction(scope, (client) => client.query<RecipeInventoryItemRow>(sql, params))
    : await query<RecipeInventoryItemRow>(sql, params);
  return result.rows;
}

export async function listTodayInventoryContextByTenant(
  tenantId: string,
  asOf: string,
  limit: number,
  scope?: AuthenticatedDbScope
): Promise<TodayInventoryContextRow[]> {
  const boundedLimit = Number.isFinite(limit)
    ? Math.min(MAX_TODAY_INVENTORY_LIMIT, Math.max(1, Math.floor(limit)))
    : MAX_TODAY_INVENTORY_LIMIT;
  const sql = `select tenant_id, ingredient_name, quantity, unit, expiration_date
     from public.recipe_inventory_items
     where tenant_id = $1 and (expiration_date is null or expiration_date >= $2)
     order by expiration_date asc nulls last
     limit $3`;
  const params = [tenantId, asOf, boundedLimit];
  if (scope && scope.tenantId !== tenantId) throw new Error('Inventory scope mismatch.');
  const result = scope
    ? await scopedTransaction(scope, (client) =>
        client.query<TodayInventoryContextRow>(sql, params)
      )
    : await query<TodayInventoryContextRow>(sql, params);
  return result.rows;
}

export async function listInventoryItemsByTenant(
  tenantId: string,
  limit?: number,
  statementTimeoutMs?: number,
  options: DbOperationOptions = {},
  scope?: AuthenticatedDbScope
): Promise<RecipeInventoryItemRow[]> {
  const boundedLimit =
    typeof limit === 'number' && Number.isInteger(limit) && limit > 0 ? Math.min(limit, 501) : null;
  const sql = `select * from public.recipe_inventory_items
     where tenant_id = $1
     order by created_at desc${boundedLimit === null ? '' : ' limit $2'}`;
  const params = boundedLimit === null ? [tenantId] : [tenantId, boundedLimit];
  if (scope && scope.tenantId !== tenantId) throw new Error('Inventory scope mismatch.');
  const result = scope
    ? await scopedTransaction(
        scope,
        async (client) => {
          if (statementTimeoutMs !== undefined) {
            if (!Number.isSafeInteger(statementTimeoutMs) || statementTimeoutMs <= 0)
              throw new Error('Statement timeout must be a positive safe integer.');
            await client.query("select set_config('statement_timeout', $1, true)", [
              `${statementTimeoutMs}ms`,
            ]);
            await client.query("select set_config('lock_timeout', $1, true)", [
              `${statementTimeoutMs}ms`,
            ]);
          }
          return client.query<RecipeInventoryItemRow>(sql, params);
        },
        options
      )
    : statementTimeoutMs === undefined
      ? await query<RecipeInventoryItemRow>(sql, params, options)
      : await queryWithStatementTimeout<RecipeInventoryItemRow>(
          sql,
          params,
          statementTimeoutMs,
          options
        );
  return result.rows;
}

/** HTTP CRUD reads remain tenant-shared; the actor is used only for RLS context. */
export async function listInventoryItemsScoped(
  scope: AuthenticatedDbScope
): Promise<RecipeInventoryItemRow[]> {
  return scopedTransaction(scope, async (client) => {
    const result = await client.query<RecipeInventoryItemRow>(
      `select * from public.recipe_inventory_items where tenant_id = $1 order by created_at desc`,
      [scope.tenantId]
    );
    return result.rows;
  });
}

export async function findInventoryItemById(
  id: string,
  tenantId: string
): Promise<RecipeInventoryItemRow | null> {
  const result = await query<RecipeInventoryItemRow>(
    'select * from public.recipe_inventory_items where id = $1 and tenant_id = $2',
    [id, tenantId]
  );
  return mapSingleRow(result);
}

export async function createInventoryItem(
  input: CreateInventoryItemInput
): Promise<RecipeInventoryItemRow> {
  return scopedTransaction({ tenantId: input.tenantId, userId: input.userId }, (client) =>
    createInventoryItemInTransaction(client, input)
  );
}

export async function updateInventoryItem(
  id: string,
  tenantId: string,
  input: Partial<Omit<CreateInventoryItemInput, 'tenantId' | 'userId'>>,
  scope?: AuthenticatedDbScope
): Promise<RecipeInventoryItemRow | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (input.ingredientName !== undefined) {
    fields.push(`ingredient_name = $${paramIndex++}`);
    values.push(input.ingredientName);
  }
  if (input.quantity !== undefined) {
    fields.push(`quantity = $${paramIndex++}`);
    values.push(input.quantity);
  }
  if (input.unit !== undefined) {
    fields.push(`unit = $${paramIndex++}`);
    values.push(input.unit);
  }
  if (input.category !== undefined) {
    fields.push(`category = $${paramIndex++}`);
    values.push(input.category);
  }
  if (input.expirationDate !== undefined) {
    fields.push(`expiration_date = $${paramIndex++}`);
    values.push(input.expirationDate);
  }
  if (input.priceReference !== undefined) {
    if (!scope) throw new Error('Price updates require authenticated inventory scope.');
    const validated = validatePriceReference(input.priceReference);
    if (!validated.ok) throw new Error(validated.error);
    const price = validated.price;
    for (const [column, value] of [
      ['estimated_unit_price', price.amount],
      ['price_currency', price.currency],
      ['price_reference_quantity', price.referenceQuantity],
      ['price_reference_unit', price.referenceUnit],
    ]) {
      fields.push(`${column} = $${paramIndex++}`);
      values.push(value);
    }
  }
  if (input.purchaseLocation !== undefined) {
    fields.push(`purchase_location = $${paramIndex++}`);
    values.push(input.purchaseLocation);
  }
  if (input.lowStockThreshold !== undefined) {
    fields.push(`low_stock_threshold = $${paramIndex++}`);
    values.push(input.lowStockThreshold);
  }
  if (input.normalizedName !== undefined) {
    fields.push(`normalized_name = $${paramIndex++}`);
    values.push(input.normalizedName);
  }
  if (input.notes !== undefined) {
    fields.push(`notes = $${paramIndex++}`);
    values.push(input.notes);
  }

  if (fields.length === 0) {
    if (!scope) return findInventoryItemById(id, tenantId);
    if (scope.tenantId !== tenantId) throw new Error('Inventory scope mismatch.');
    return scopedTransaction(scope, async (client) => {
      const result = await client.query<RecipeInventoryItemRow>(
        'select * from public.recipe_inventory_items where id = $1 and tenant_id = $2',
        [id, tenantId]
      );
      return result.rows[0] ?? null;
    });
  }

  fields.push(`updated_at = now()`);
  values.push(id, tenantId);

  const sql = `update public.recipe_inventory_items set ${fields.join(', ')} where id = $${paramIndex} and tenant_id = $${paramIndex + 1} returning *`;
  if (scope && scope.tenantId !== tenantId) throw new Error('Inventory scope mismatch.');
  const result = scope
    ? await scopedTransaction(scope, (client) => client.query<RecipeInventoryItemRow>(sql, values))
    : await query<RecipeInventoryItemRow>(sql, values);
  return mapSingleRow(result);
}

export async function deleteInventoryItem(
  id: string,
  tenantId: string,
  scope?: AuthenticatedDbScope
): Promise<void> {
  if (scope && scope.tenantId !== tenantId) throw new Error('Inventory scope mismatch.');
  if (scope) {
    await scopedTransaction(scope, (client) =>
      client.query('delete from public.recipe_inventory_items where id = $1 and tenant_id = $2', [
        id,
        tenantId,
      ])
    );
    return;
  }
  await query('delete from public.recipe_inventory_items where id = $1 and tenant_id = $2', [
    id,
    tenantId,
  ]);
}

export async function createInventoryItemInTransaction(
  client: PoolClient,
  input: CreateInventoryItemInput
): Promise<RecipeInventoryItemRow> {
  const price =
    input.priceReference === undefined ? undefined : validatePriceReference(input.priceReference);
  if (price && !price.ok) throw new Error(price.error);
  const reference = price?.price;
  // Existing purchase-transfer callers have no price. Preserve the historical
  // insert shape for that path; confirmed prices always write the full tuple.
  const result = await client.query<RecipeInventoryItemRow>(
    `insert into public.recipe_inventory_items
     (tenant_id, user_id, ingredient_name, quantity, unit, category, expiration_date,
      estimated_unit_price, purchase_location, low_stock_threshold, normalized_name, notes${reference ? ', price_currency, price_reference_quantity, price_reference_unit' : ''})
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12${reference ? ', $13, $14, $15' : ''})
     returning *`,
    [
      input.tenantId,
      input.userId,
      input.ingredientName,
      input.quantity ?? null,
      input.unit ?? null,
      input.category ?? null,
      input.expirationDate ?? null,
      reference?.amount ?? null,
      input.purchaseLocation ?? null,
      input.lowStockThreshold ?? null,
      input.normalizedName ?? null,
      input.notes ?? null,
      ...(reference
        ? [reference.currency, reference.referenceQuantity, reference.referenceUnit]
        : []),
    ]
  );

  const item = result.rows[0] ?? null;
  if (!item) throw new Error('Failed to create inventory item');
  return item;
}
