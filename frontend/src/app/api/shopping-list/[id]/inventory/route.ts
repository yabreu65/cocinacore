import { type NextRequest, NextResponse } from 'next/server';
import { requireTenant, requireUser } from '@/lib/auth/server';
import {
  ShoppingListTransferError,
  transferPurchasedShoppingListItem,
} from '@/lib/db/repositories/shoppingListRepository';
import type { ShoppingListItemRow, RecipeInventoryItemRow } from '@/lib/db/types';
import { ShoppingListIdSchema } from '@/lib/validation';

interface RouteContext {
  params: Promise<{ id: string }>;
}

type PublicShoppingListItem = Pick<
  ShoppingListItemRow,
  | 'id'
  | 'source'
  | 'ingredient_name'
  | 'quantity'
  | 'status'
  | 'transfer_inventory_item_id'
  | 'transferred_at'
  | 'created_at'
  | 'updated_at'
>;

type PublicInventoryItem = Pick<
  RecipeInventoryItemRow,
  'id' | 'ingredient_name' | 'quantity' | 'unit' | 'category' | 'normalized_name'
>;

function toPublicShoppingListItem(row: ShoppingListItemRow): PublicShoppingListItem {
  return {
    id: row.id,
    source: row.source,
    ingredient_name: row.ingredient_name,
    quantity: row.quantity,
    status: row.status,
    transfer_inventory_item_id: row.transfer_inventory_item_id,
    transferred_at: row.transferred_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toPublicInventoryItem(row: RecipeInventoryItemRow): PublicInventoryItem {
  return {
    id: row.id,
    ingredient_name: row.ingredient_name,
    quantity: row.quantity,
    unit: row.unit,
    category: row.category,
    normalized_name: row.normalized_name,
  };
}

function unauthorizedResponse(error: unknown): NextResponse | null {
  return error instanceof Error && error.message === 'Unauthorized'
    ? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    : null;
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const [tenant, user, { id }] = await Promise.all([
      requireTenant(request, 'Unauthorized'),
      requireUser(request, 'Unauthorized'),
      context.params,
    ]);

    if (!ShoppingListIdSchema.safeParse(id).success) {
      return NextResponse.json({ error: 'Invalid shopping list item id' }, { status: 400 });
    }

    const result = await transferPurchasedShoppingListItem(id, tenant.tenantId, user.id);
    if (!result)
      return NextResponse.json({ error: 'Shopping list item not found' }, { status: 404 });

    return NextResponse.json({
      item: toPublicShoppingListItem(result.item),
      inventoryItem: toPublicInventoryItem(result.inventoryItem),
    });
  } catch (error) {
    if (error instanceof ShoppingListTransferError) {
      const status =
        error.code === 'not_purchased' ? 409 : error.code === 'invalid_quantity' ? 400 : 409;
      const message =
        error.code === 'not_purchased'
          ? 'Shopping list item must be purchased before transfer'
          : error.code === 'invalid_quantity'
            ? 'Shopping list item must have a structured quantity and unit'
            : 'Transferred inventory item is no longer available';
      return NextResponse.json({ error: message }, { status });
    }
    return (
      unauthorizedResponse(error) ??
      NextResponse.json({ error: 'Unable to transfer shopping list item' }, { status: 500 })
    );
  }
}
