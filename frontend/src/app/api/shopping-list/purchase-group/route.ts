import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import {
  confirmShoppingProductPurchase,
  ShoppingGroupPurchaseError,
} from '@/lib/db/repositories/shoppingListRepository';

const bodySchema = z
  .object({
    groupKey: z.string().min(1).max(240),
    rows: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            ingredientName: z.string().min(1).max(200),
            quantity: z.string().max(128).nullable(),
          })
          .strict()
      )
      .min(1)
      .max(250),
    actualQuantity: z.string().min(3).max(64),
  })
  .strict();

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request, 'Unauthorized');
    if (!user.tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Datos de compra inválidos.' }, { status: 400 });
    }
    const result = await confirmShoppingProductPurchase({
      tenantId: user.tenant.tenantId,
      userId: user.id,
      ...parsed.data,
    });
    return NextResponse.json({
      items: result.items.map((item) => ({
        id: item.id,
        source: item.source,
        ingredient_name: item.ingredient_name,
        quantity: item.quantity,
        status: item.status,
        transfer_inventory_item_id: item.transfer_inventory_item_id,
        transferred_at: item.transferred_at,
        purchased_quantity: result.inventoryItem.quantity,
        purchased_unit: result.inventoryItem.unit,
        created_at: item.created_at,
        updated_at: item.updated_at,
      })),
      inventoryItem: {
        id: result.inventoryItem.id,
        ingredient_name: result.inventoryItem.ingredient_name,
        quantity: result.inventoryItem.quantity,
        unit: result.inventoryItem.unit,
      },
    });
  } catch (error) {
    if (error instanceof ShoppingGroupPurchaseError) {
      const messages = {
        stale: 'La lista cambió. Actualizá la página antes de confirmar la compra.',
        invalid_quantity: 'Ingresá una cantidad real con unidad compatible.',
        insufficient: 'La cantidad comprada no cubre lo necesario. Revisá el producto.',
        ambiguous: 'No se puede confirmar automáticamente esta compra. Revisá los ingredientes.',
      };
      return NextResponse.json(
        { error: messages[error.code] },
        { status: error.code === 'stale' || error.code === 'insufficient' ? 409 : 400 }
      );
    }
    if (error instanceof Error && error.message === 'Unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: 'No se pudo confirmar la compra.' }, { status: 500 });
  }
}
