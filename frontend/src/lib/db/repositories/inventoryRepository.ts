import { PoolClient } from 'pg';
import { query, mapSingleRow } from '@/lib/db';
import { RecipeInventoryItemRow } from '@/lib/db/types';

export interface CreateInventoryItemInput {
  tenantId: string;
  userId: string;
  ingredientName: string;
  quantity?: string | null;
  unit?: string | null;
  category?: string | null;
  expirationDate?: string | null;
  estimatedUnitPrice?: number | null;
  purchaseLocation?: string | null;
  lowStockThreshold?: number | null;
  normalizedName?: string | null;
  notes?: string | null;
}

export async function listInventoryItemsByTenant(
  tenantId: string
): Promise<RecipeInventoryItemRow[]> {
  const result = await query<RecipeInventoryItemRow>(
    'select * from public.recipe_inventory_items where tenant_id = $1 order by created_at desc',
    [tenantId]
  );
  return result.rows;
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
  const result = await query<RecipeInventoryItemRow>(
    `insert into public.recipe_inventory_items
     (tenant_id, user_id, ingredient_name, quantity, unit, category, expiration_date,
      estimated_unit_price, purchase_location, low_stock_threshold, normalized_name, notes)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     returning *`,
    [
      input.tenantId,
      input.userId,
      input.ingredientName,
      input.quantity ?? null,
      input.unit ?? null,
      input.category ?? null,
      input.expirationDate ?? null,
      input.estimatedUnitPrice ?? null,
      input.purchaseLocation ?? null,
      input.lowStockThreshold ?? null,
      input.normalizedName ?? null,
      input.notes ?? null,
    ]
  );

  const item = mapSingleRow(result);
  if (!item) throw new Error('Failed to create inventory item');
  return item;
}

export async function updateInventoryItem(
  id: string,
  tenantId: string,
  input: Partial<Omit<CreateInventoryItemInput, 'tenantId' | 'userId'>>
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
  if (input.estimatedUnitPrice !== undefined) {
    fields.push(`estimated_unit_price = $${paramIndex++}`);
    values.push(input.estimatedUnitPrice);
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

  if (fields.length === 0) return findInventoryItemById(id, tenantId);

  fields.push(`updated_at = now()`);
  values.push(id, tenantId);

  const result = await query<RecipeInventoryItemRow>(
    `update public.recipe_inventory_items set ${fields.join(', ')} where id = $${paramIndex} and tenant_id = $${paramIndex + 1} returning *`,
    values
  );
  return mapSingleRow(result);
}

export async function deleteInventoryItem(id: string, tenantId: string): Promise<void> {
  await query('delete from public.recipe_inventory_items where id = $1 and tenant_id = $2', [
    id,
    tenantId,
  ]);
}

export async function createInventoryItemInTransaction(
  client: PoolClient,
  input: CreateInventoryItemInput
): Promise<RecipeInventoryItemRow> {
  const result = await client.query<RecipeInventoryItemRow>(
    `insert into public.recipe_inventory_items
     (tenant_id, user_id, ingredient_name, quantity, unit, category, expiration_date,
      estimated_unit_price, purchase_location, low_stock_threshold, normalized_name, notes)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     returning *`,
    [
      input.tenantId,
      input.userId,
      input.ingredientName,
      input.quantity ?? null,
      input.unit ?? null,
      input.category ?? null,
      input.expirationDate ?? null,
      input.estimatedUnitPrice ?? null,
      input.purchaseLocation ?? null,
      input.lowStockThreshold ?? null,
      input.normalizedName ?? null,
      input.notes ?? null,
    ]
  );

  const item = result.rows[0] ?? null;
  if (!item) throw new Error('Failed to create inventory item');
  return item;
}
