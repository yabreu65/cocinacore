import { type NextRequest, NextResponse } from 'next/server';
import { requireTenant, requireUser } from '@/lib/auth/server';
import {
  createShoppingListItem,
  listShoppingListItems,
} from '@/lib/db/repositories/shoppingListRepository';
import type { ShoppingListItemRow } from '@/lib/db/types';
import { ShoppingListCreateSchema, validateRequest } from '@/lib/validation';

type PublicShoppingListItem = Pick<
  ShoppingListItemRow,
  | 'id'
  | 'source'
  | 'ingredient_name'
  | 'quantity'
  | 'status'
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
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function unauthorizedResponse(error: unknown): NextResponse | null {
  return error instanceof Error && error.message === 'Unauthorized'
    ? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    : null;
}

export async function GET(request: NextRequest) {
  try {
    const [tenant, user] = await Promise.all([
      requireTenant(request, 'Unauthorized'),
      requireUser(request, 'Unauthorized'),
    ]);
    const status = request.nextUrl.searchParams.get('status');

    if (status !== null && status !== 'pending' && status !== 'purchased') {
      return NextResponse.json({ error: 'Invalid status filter' }, { status: 400 });
    }

    const items = await listShoppingListItems(tenant.tenantId, user.id, {
      ...(status ? { status } : {}),
    });
    return NextResponse.json({ items: items.map(toPublicShoppingListItem) });
  } catch (error) {
    return (
      unauthorizedResponse(error) ??
      NextResponse.json({ error: 'Unable to retrieve shopping list' }, { status: 500 })
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const [tenant, user] = await Promise.all([
      requireTenant(request, 'Unauthorized'),
      requireUser(request, 'Unauthorized'),
    ]);
    const validation = await validateRequest(request, ShoppingListCreateSchema);

    if (!validation.success) {
      return NextResponse.json(validation.error.body, { status: validation.error.status });
    }

    const item = await createShoppingListItem({
      tenantId: tenant.tenantId,
      userId: user.id,
      ingredientName: validation.data.ingredientName,
      quantity: validation.data.quantity,
      source: validation.data.source,
    });

    return NextResponse.json({ item: toPublicShoppingListItem(item) }, { status: 201 });
  } catch (error) {
    return (
      unauthorizedResponse(error) ??
      NextResponse.json({ error: 'Unable to create shopping list item' }, { status: 500 })
    );
  }
}
