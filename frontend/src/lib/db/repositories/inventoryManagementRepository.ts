import { lockInventorySourceTenant } from '@/lib/db/inventory-source-lock';
import { scopedTransaction, type AuthenticatedDbScope } from '@/lib/db';
import type { RecipeInventoryItemRow } from '@/lib/db/types';
import { INVENTORY_ROW_REVISION } from './inventoryRepository';
import { planInventoryStockChange } from '@/lib/inventory/inventory-adjustment';
import { normalizeInventoryUnit, parseInventoryDecimal } from '@/lib/inventory/inventory-input';
import { normalizeInventoryName } from '@/lib/inventory/normalize-inventory';
import {
  inventoryManagementSchema,
  type InventoryManagementRequest,
} from '@/lib/inventory/inventory-management';

type Result =
  | { status: 'updated'; item: RecipeInventoryItemRow }
  | { status: 'not_found' | 'conflict' }
  | { status: 'invalid'; error: string };

export async function manageInventoryItem(
  scope: AuthenticatedDbScope,
  input: InventoryManagementRequest
): Promise<Result> {
  const parsed = inventoryManagementSchema.safeParse(input);
  if (!parsed.success) return { status: 'invalid', error: 'Solicitud de inventario inválida.' };
  const request = parsed.data;
  return scopedTransaction(scope, async (client) => {
    await lockInventorySourceTenant(client, scope.tenantId);
    const locked = await client.query<RecipeInventoryItemRow>(
      `select *, ${INVENTORY_ROW_REVISION} as revision from public.recipe_inventory_items where id=$1 and tenant_id=$2 for update`,
      [request.id, scope.tenantId]
    );
    const row = locked.rows[0];
    if (!row) return { status: 'not_found' };
    if (row.revision !== request.revision) return { status: 'conflict' };
    if (request.action === 'price') {
      const price = request.priceReference;
      const updated = await client.query<RecipeInventoryItemRow>(
        `update public.recipe_inventory_items set estimated_unit_price=$1,price_currency=$2,price_reference_quantity=$3,price_reference_unit=$4,updated_at=now() where id=$5 and tenant_id=$6 returning *, ${INVENTORY_ROW_REVISION} as revision`,
        [price.amount, price.currency, price.referenceQuantity, price.referenceUnit, request.id, scope.tenantId]
      );
      const item = updated.rows[0];
      if (!item) throw new Error('Locked inventory price update failed');
      return { status: 'updated', item };
    }
    if (request.action === 'stock') {
      const plan = planInventoryStockChange(
        { quantity: row.quantity, unit: row.unit, lowStockThreshold: row.low_stock_threshold },
        request.command
      );
      if (!plan.ok) return { status: 'invalid', error: plan.error };
      const updated = await client.query<RecipeInventoryItemRow>(
        `update public.recipe_inventory_items set quantity=$1,unit=$2,low_stock_threshold=$3,updated_at=now() where id=$4 and tenant_id=$5 returning *, ${INVENTORY_ROW_REVISION} as revision`,
        [plan.quantity, plan.unit, plan.lowStockThreshold, request.id, scope.tenantId]
      );
      const item = updated.rows[0];
      if (!item) throw new Error('Locked inventory update failed');
      if (plan.movement) {
        const movement = plan.movement;
        await client.query(
          `insert into public.inventory_movements (tenant_id,user_id,inventory_item_id,movement_type,quantity,unit,normalized_name,source,notes) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            scope.tenantId,
            scope.userId,
            row.id,
            movement.type,
            movement.quantity,
            movement.unit,
            row.normalized_name || normalizeInventoryName(row.ingredient_name),
            movement.source,
            movement.notes,
          ]
        );
      }
      return { status: 'updated', item };
    }
    const changes = request.changes;
    if (
      changes.lowStockThreshold !== undefined &&
      changes.lowStockThreshold !== null &&
      !normalizeInventoryUnit(row.unit)
    )
      return { status: 'invalid', error: 'Confirma la unidad antes de fijar el stock mínimo.' };
    const fields: string[] = [];
    const values: unknown[] = [];
    function set(column: string, value: unknown) {
      values.push(value);
      fields.push(`${column}=$${values.length}`);
    }
    if (changes.ingredientName !== undefined) {
      set('ingredient_name', changes.ingredientName);
      set('normalized_name', normalizeInventoryName(changes.ingredientName));
    }
    if (changes.category !== undefined) set('category', changes.category);
    if (changes.expirationDate !== undefined) set('expiration_date', changes.expirationDate);
    if (changes.purchaseLocation !== undefined)
      set('purchase_location', changes.purchaseLocation || null);
    if (changes.notes !== undefined) set('notes', changes.notes || null);
    if (changes.lowStockThreshold !== undefined)
      set('low_stock_threshold', parseInventoryDecimal(changes.lowStockThreshold));
    values.push(request.id, scope.tenantId);
    const result = await client.query<RecipeInventoryItemRow>(
      `update public.recipe_inventory_items set ${fields.join(',')},updated_at=now() where id=$${values.length - 1} and tenant_id=$${values.length} returning *, ${INVENTORY_ROW_REVISION} as revision`,
      values
    );
    const item = result.rows[0];
    if (!item) throw new Error('Locked inventory metadata update failed');
    return { status: 'updated', item };
  });
}
