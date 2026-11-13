import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/server';
import { manageInventoryItem } from '@/lib/db/repositories/inventoryManagementRepository';
import { inventoryManagementSchema } from '@/lib/inventory/inventory-management';

export async function PATCH(request: Request) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    throw error;
  }
  if (!user.tenant) return NextResponse.json({ error: 'Tenant context required' }, { status: 403 });
  const parsed = inventoryManagementSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: 'Solicitud de inventario inválida.' }, { status: 400 });
  const result = await manageInventoryItem(
    { tenantId: user.tenant.tenantId, userId: user.id },
    parsed.data
  );
  switch (result.status) {
    case 'not_found':
      return NextResponse.json({ error: 'Ingrediente no encontrado.' }, { status: 404 });
    case 'conflict':
      return NextResponse.json(
        { error: 'Las existencias cambiaron. Recarga el inventario y revisa el ajuste.' },
        { status: 409 }
      );
    case 'invalid':
      return NextResponse.json({ error: result.error }, { status: 400 });
    case 'updated':
      return NextResponse.json({ item: result.item });
  }
}
