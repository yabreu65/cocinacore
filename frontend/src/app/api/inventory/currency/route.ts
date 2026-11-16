import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/server';
import {
  readInventoryCurrencySettings,
  updateInventoryCurrencySettings,
} from '@/lib/db/repositories/inventoryCurrencyRepository';
import { isInventoryCurrency } from '@/lib/inventory/inventory-price';

async function getScope() {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized')
      return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const;
    throw error;
  }
  if (!user.tenant)
    return {
      response: NextResponse.json({ error: 'Tenant context required' }, { status: 403 }),
    } as const;
  return { scope: { tenantId: user.tenant.tenantId, userId: user.id } } as const;
}

export async function GET() {
  const auth = await getScope();
  if (auth.response) return auth.response;
  const settings = await readInventoryCurrencySettings(auth.scope);
  if (!settings)
    return NextResponse.json({ error: 'No tienes acceso a esta organización.' }, { status: 403 });
  return NextResponse.json(settings, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function PUT(request: Request) {
  const auth = await getScope();
  if (auth.response) return auth.response;
  const body: unknown = await request.json().catch(() => null);
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    !('currency' in body) ||
    !isInventoryCurrency(body.currency)
  ) {
    return NextResponse.json({ error: 'Selecciona una moneda válida.' }, { status: 400 });
  }
  const settings = await updateInventoryCurrencySettings(auth.scope, body.currency);
  if (!settings)
    return NextResponse.json(
      { error: 'Solo propietarios o administradores pueden cambiar la moneda.' },
      { status: 403 }
    );
  return NextResponse.json(settings, { headers: { 'Cache-Control': 'private, no-store' } });
}
