import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { getCookingSession } from '@/lib/db/repositories/cookingSessionRepository';
import {
  listReconciliationInventory,
  findReconciliationReceipt,
  reconcileRealConsumption,
  type RealConsumptionOutcome,
} from '@/lib/db/repositories/realConsumptionRepository';
import { validateRequest } from '@/lib/validation';
import { ReconciliationSchema } from '@/lib/inventory/reconciliation-request';
import { serverLogger } from '@/lib/serverLogger';

async function authenticated(request: NextRequest) {
  try {
    const user = await requireUser(request);
    return user.tenant ? user : null;
  } catch {
    return null;
  }
}

function publicInventoryItem(item: {
  id: string;
  ingredient_name: string;
  normalized_name: string | null;
  quantity: string | null;
  unit: string | null;
  expiration_date: string | null;
}) {
  return {
    id: item.id,
    ingredientName: item.ingredient_name,
    normalizedName: item.normalized_name,
    quantity: item.quantity,
    unit: item.unit,
    expirationDate: item.expiration_date,
  };
}

function resultError(status: string) {
  switch (status) {
    case 'not_found':
      return NextResponse.json({ error: 'Sesión no encontrada.' }, { status: 404 });
    case 'session_not_completed':
      return NextResponse.json(
        { error: 'La sesión debe estar finalizada antes de reconciliar el consumo.' },
        { status: 409 }
      );
    case 'legacy_already_claimed':
      return NextResponse.json(
        {
          error: 'El slot ya fue registrado por el consumo planificado.',
          code: 'MEAL_SLOT_CLAIMED',
        },
        { status: 409 }
      );
    case 'inventory_expired':
      return NextResponse.json({ error: 'El lote seleccionado está vencido.' }, { status: 409 });
    case 'inventory_insufficient':
      return NextResponse.json({ error: 'La cantidad del lote no alcanza.' }, { status: 409 });
    case 'inventory_not_found':
      return NextResponse.json(
        { error: 'El lote seleccionado no está disponible.' },
        { status: 409 }
      );
    case 'unrepresentable_inventory_quantity':
      return NextResponse.json(
        { error: 'La cantidad no se puede registrar exactamente en la unidad del lote.' },
        { status: 409 }
      );
    case 'incompatible_units':
      return NextResponse.json({ error: 'La unidad del lote no es comparable.' }, { status: 409 });
    case 'invalid_items':
      return NextResponse.json(
        { error: 'Los ingredientes no cumplen el contrato de reconciliación.' },
        { status: 400 }
      );
    case 'source_conflict':
      return NextResponse.json(
        { error: 'La receta o el menú de origen cambió.', code: 'COOKING_SESSION_SOURCE_CONFLICT' },
        { status: 409 }
      );
    case 'conflict':
      return NextResponse.json(
        {
          error: 'La sesión o el slot ya cambiaron; recargá e intentá de nuevo.',
          code: 'REAL_CONSUMPTION_CONFLICT',
        },
        { status: 409 }
      );
    default:
      return NextResponse.json({ error: 'No se pudo reconciliar el consumo.' }, { status: 500 });
  }
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await authenticated(request);
  if (!user?.tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Identificador inválido.' }, { status: 400 });
  }
  try {
    const session = await getCookingSession(id, user.tenant.tenantId, user.id);
    if (!session) return NextResponse.json({ error: 'Sesión no encontrada.' }, { status: 404 });
    // A confirmed receipt is authoritative even if the browser lost its
    // request body or the current inventory is no longer available.
    const receipt = await findReconciliationReceipt(id, user.tenant.tenantId, user.id);
    // Retain the existing inventory field for clients that still use it.
    const inventory = await listReconciliationInventory(user.tenant.tenantId, user.id).catch(
      (error) => {
        if (receipt) return [];
        throw error;
      }
    );
    return NextResponse.json(
      { inventory: inventory.map(publicInventoryItem), receipt },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch {
    return NextResponse.json({ error: 'No se pudo recuperar el inventario.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  const user = await authenticated(request);
  if (!user?.tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Identificador inválido.' }, { status: 400 });
  }
  const validation = await validateRequest(request, ReconciliationSchema);
  if (!validation.success) {
    return NextResponse.json(validation.error.body, { status: validation.error.status });
  }
  try {
    const result = await reconcileRealConsumption({
      ...validation.data,
      sessionId: id,
      tenantId: user.tenant.tenantId,
      userId: user.id,
      items: validation.data.items.map((item) => ({
        ...item,
        outcome: item.outcome as RealConsumptionOutcome,
      })),
    });
    if (result.status === 'applied' || result.status === 'already_applied') {
      return NextResponse.json(
        {
          status: result.status,
          operationId: result.operationId,
          items: result.items,
          movementCount: result.movementIds.length,
        },
        { status: result.status === 'applied' ? 201 : 200 }
      );
    }
    return resultError(result.status);
  } catch {
    serverLogger.warn('real_consumption.reconciliation_failed', { requestId });
    return NextResponse.json({ error: 'No se pudo reconciliar el consumo.' }, { status: 500 });
  }
}
