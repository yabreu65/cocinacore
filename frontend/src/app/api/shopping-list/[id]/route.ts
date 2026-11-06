import { type NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/server';
import {
  deleteShoppingListItem,
  updateShoppingListItemStatus,
} from '@/lib/db/repositories/shoppingListRepository';
import type { ShoppingListItemRow } from '@/lib/db/types';
import {
  ShoppingListIdSchema,
  ShoppingListStatusUpdateSchema,
  validateRequest,
} from '@/lib/validation';

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

function unauthorizedResponse(error: unknown): NextResponse | null {
  return error instanceof Error && error.message === 'Unauthorized'
    ? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    : null;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const [user, { id }] = await Promise.all([
      requireUser(request, 'Unauthorized'),
      context.params,
    ]);
    if (!user.tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    if (!ShoppingListIdSchema.safeParse(id).success) {
      return NextResponse.json({ error: 'Invalid shopping list item id' }, { status: 400 });
    }

    const validation = await validateRequest(request, ShoppingListStatusUpdateSchema);
    if (!validation.success) {
      return NextResponse.json(validation.error.body, { status: validation.error.status });
    }

    const item = await updateShoppingListItemStatus(
      id,
      user.tenant.tenantId,
      user.id,
      validation.data.status
    );
    if (!item) {
      return NextResponse.json({ error: 'Shopping list item not found' }, { status: 404 });
    }

    return NextResponse.json({ item: toPublicShoppingListItem(item) });
  } catch (error) {
    return (
      unauthorizedResponse(error) ??
      NextResponse.json({ error: 'Unable to update shopping list item' }, { status: 500 })
    );
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const [user, { id }] = await Promise.all([
      requireUser(request, 'Unauthorized'),
      context.params,
    ]);
    if (!user.tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    if (!ShoppingListIdSchema.safeParse(id).success) {
      return NextResponse.json({ error: 'Invalid shopping list item id' }, { status: 400 });
    }

    const item = await deleteShoppingListItem(id, user.tenant.tenantId, user.id);
    if (!item) {
      return NextResponse.json({ error: 'Shopping list item not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return (
      unauthorizedResponse(error) ??
      NextResponse.json({ error: 'Unable to delete shopping list item' }, { status: 500 })
    );
  }
}
