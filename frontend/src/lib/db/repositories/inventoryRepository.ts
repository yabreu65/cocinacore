import { lockInventorySourceTenant } from '@/lib/db/inventory-source-lock';
import { PoolClient } from 'pg';
import {
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

// PostgreSQL row version plus exact timestamp; never use millisecond-truncated JS Date.
export const INVENTORY_ROW_REVISION = "xmin::text || ':' || extract(epoch from updated_at)::text";

function requireInventoryScope(tenantId: string, scope: AuthenticatedDbScope): void {
  if (!scope) throw new Error('Operation requires authenticated inventory scope.');
  if (scope.tenantId !== tenantId) throw new Error('Inventory scope mismatch.');
}

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
  limit: number = MAX_WASTE_PREVENTION_INVENTORY_LIMIT,
  scope: AuthenticatedDbScope
): Promise<RecipeInventoryItemRow[]> {
  const boundedLimit = Number.isFinite(limit)
    ? Math.min(MAX_WASTE_PREVENTION_INVENTORY_LIMIT, Math.max(1, Math.floor(limit)))
    : MAX_WASTE_PREVENTION_INVENTORY_LIMIT;
  const sql = `select * from public.recipe_inventory_items
     where tenant_id = $1
     order by expiration_date asc nulls last, created_at asc, id asc
     limit $2`;
  const params = [tenantId, Math.min(MAX_WASTE_PREVENTION_INVENTORY_LIMIT + 1, boundedLimit + 1)];
  requireInventoryScope(tenantId, scope);
  const result = await scopedTransaction(scope, (client) =>
    client.query<RecipeInventoryItemRow>(sql, params)
  );
  return result.rows;
}

export async function listTodayInventoryContextByTenant(
  tenantId: string,
  asOf: string,
  limit: number,
  scope: AuthenticatedDbScope,
  timeZone: string = 'UTC'
): Promise<TodayInventoryContextRow[]> {
  const boundedLimit = Number.isFinite(limit)
    ? Math.min(MAX_TODAY_INVENTORY_LIMIT, Math.max(1, Math.floor(limit)))
    : MAX_TODAY_INVENTORY_LIMIT;
  const sql = `select tenant_id, ingredient_name, quantity, unit, expiration_date
     from public.recipe_inventory_items
     where tenant_id = $1 and (expiration_date is null or
       (case when (expiration_date at time zone 'UTC')::time = time '00:00:00'
         then (expiration_date at time zone 'UTC')::date
         else (expiration_date at time zone $4)::date end) >= $2::date)
     order by expiration_date asc nulls last, ingredient_name asc, id asc
     limit $3`;
  const params = [tenantId, asOf, boundedLimit, timeZone];
  requireInventoryScope(tenantId, scope);
  const result = await scopedTransaction(scope, (client) =>
    client.query<TodayInventoryContextRow>(sql, params)
  );
  return result.rows;
}

export async function listInventoryItemsByTenant(
  tenantId: string,
  limit: number | undefined,
  statementTimeoutMs: number | undefined,
  options: DbOperationOptions = {},
  scope: AuthenticatedDbScope
): Promise<RecipeInventoryItemRow[]> {
  const boundedLimit =
    typeof limit === 'number' && Number.isInteger(limit) && limit > 0 ? Math.min(limit, 501) : null;
  const sql = `select * from public.recipe_inventory_items
     where tenant_id = $1
     order by created_at desc${boundedLimit === null ? '' : ' limit $2'}`;
  const params = boundedLimit === null ? [tenantId] : [tenantId, boundedLimit];
  requireInventoryScope(tenantId, scope);
  const result = await scopedTransaction(
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
  );
  return result.rows;
}

/** HTTP CRUD reads remain tenant-shared; the actor is used only for RLS context. */
export async function listInventoryItemsScoped(
  scope: AuthenticatedDbScope
): Promise<RecipeInventoryItemRow[]> {
  return scopedTransaction(scope, async (client) => {
    const result = await client.query<RecipeInventoryItemRow>(
      `select *, ${INVENTORY_ROW_REVISION} as revision from public.recipe_inventory_items where tenant_id = $1 order by created_at desc`,
      [scope.tenantId]
    );
    return result.rows;
  });
}

export async function findInventoryItemById(
  id: string,
  tenantId: string,
  scope: AuthenticatedDbScope
): Promise<RecipeInventoryItemRow | null> {
  requireInventoryScope(tenantId, scope);
  return scopedTransaction(scope, async (client) => {
    const result = await client.query<RecipeInventoryItemRow>(
      `select *, ${INVENTORY_ROW_REVISION} as revision from public.recipe_inventory_items where id = $1 and tenant_id = $2`,
      [id, tenantId]
    );
    return result.rows[0] ?? null;
  });
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
  scope: AuthenticatedDbScope
): Promise<RecipeInventoryItemRow | null> {
  requireInventoryScope(tenantId, scope);
  if ('quantity' in input || 'unit' in input || 'lowStockThreshold' in input || 'priceReference' in input)
    throw new Error('Use the audited inventory management transaction.');
  const fields: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (input.ingredientName !== undefined) {
    fields.push(`ingredient_name = $${paramIndex++}`);
    values.push(input.ingredientName);
  }
  if (input.category !== undefined) {
    fields.push(`category = $${paramIndex++}`);
    values.push(input.category);
  }
  if (input.expirationDate !== undefined) {
    fields.push(`expiration_date = $${paramIndex++}`);
    values.push(input.expirationDate);
  }
  if (input.purchaseLocation !== undefined) {
    fields.push(`purchase_location = $${paramIndex++}`);
    values.push(input.purchaseLocation);
  }
  if (input.normalizedName !== undefined) {
    fields.push(`normalized_name = $${paramIndex++}`);
    values.push(input.normalizedName);
  }
  if (input.notes !== undefined) {
    fields.push(`notes = $${paramIndex++}`);
    values.push(input.notes);
  }

  if (fields.length === 0) return findInventoryItemById(id, tenantId, scope);

  fields.push(`updated_at = now()`);
  values.push(id, tenantId);

  const sql = `update public.recipe_inventory_items set ${fields.join(', ')} where id = $${paramIndex} and tenant_id = $${paramIndex + 1} returning *, ${INVENTORY_ROW_REVISION} as revision`;
  const write = async (client: PoolClient) => {
    await lockInventorySourceTenant(client, tenantId);
    return client.query<RecipeInventoryItemRow>(sql, values);
  };
  const result = await scopedTransaction(scope, write);
  return mapSingleRow(result);
}

export async function deleteInventoryItem(
  id: string,
  tenantId: string,
  scope: AuthenticatedDbScope
): Promise<'deleted' | 'not_found' | 'has_history' | 'history_unavailable'> {
  requireInventoryScope(tenantId, scope);
  try {
    return await scopedTransaction(
      scope,
      async (client) => {
        await lockInventorySourceTenant(client, tenantId);
        const locked = await client.query<{ id: string; history_protected: boolean }>(
          `select id, exists (
      select 1 from pg_catalog.pg_constraint c
      where c.conrelid = 'public.inventory_movements'::pg_catalog.regclass
        and c.confrelid = 'public.recipe_inventory_items'::pg_catalog.regclass
        and c.conname = 'inventory_movements_inventory_item_id_fkey'
        and c.contype = 'f' and c.convalidated and not c.condeferrable
        and c.confdeltype = 'a' and c.confupdtype = 'a'
        and c.conkey = array[(select attnum from pg_catalog.pg_attribute
          where attrelid = c.conrelid and attname = 'inventory_item_id' and not attisdropped)]
        and c.confkey = array[(select attnum from pg_catalog.pg_attribute
          where attrelid = c.confrelid and attname = 'id' and not attisdropped)]
        and (select count(*) from pg_catalog.pg_trigger t
          where t.tgconstraint = c.oid and t.tgisinternal and t.tgenabled in ('O','A')) = 4
        and not exists (select 1 from pg_catalog.pg_constraint other
          where other.conrelid = c.conrelid and other.confrelid = c.confrelid
            and other.contype = 'f' and other.oid <> c.oid and other.confdeltype = 'c')
    ) as history_protected
           from public.recipe_inventory_items where id = $1 and tenant_id = $2 for update`,
          [id, tenantId]
        );
        if (!locked.rows.length) return 'not_found';
        // Before migration 023, the FK cascades and can erase hidden audit rows.
        // Never permit deletion without the database-enforced non-cascading FK.
        if (locked.rows[0].history_protected !== true) return 'history_unavailable';
        const deleted = await client.query<{ id: string }>(
          'delete from public.recipe_inventory_items where id = $1 and tenant_id = $2 returning id',
          [id, tenantId]
        );
        return deleted.rows.length === 1 ? 'deleted' : 'not_found';
      },
      { isolationLevel: 'read committed' }
    );
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === '23503')
      return 'has_history';
    throw error;
  }
}

export async function createInventoryItemInTransaction(
  client: PoolClient,
  input: CreateInventoryItemInput
): Promise<RecipeInventoryItemRow> {
  await lockInventorySourceTenant(client, input.tenantId);
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
     returning *, ${INVENTORY_ROW_REVISION} as revision`,
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
