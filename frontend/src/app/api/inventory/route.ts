import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/server';
import { parseInventoryPriceWrite } from '@/lib/inventory/inventory-price';
import {
  INVENTORY_CATEGORIES,
  isValidInventoryExpirationDate,
  validateInventoryFields,
} from '@/lib/inventory/inventory-input';
import {
  listInventoryItemsScoped,
  createInventoryItem,
  updateInventoryItem,
  deleteInventoryItem,
} from '@/lib/db/repositories/inventoryRepository';
import {
  detectInventoryCategory,
  normalizeInventoryName,
} from '@/lib/inventory/normalize-inventory';

const INVENTORY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface InventoryItemBody {
  id?: string;
  ingredientName?: string;
  quantity?: string;
  unit?: string;
  category?: string;
  expirationDate?: string;
  estimatedUnitPrice?: string;
  priceReference?: unknown;
  purchaseLocation?: string;
  lowStockThreshold?: string;
  notes?: string;
}

function isInventoryItemBody(body: unknown): body is InventoryItemBody {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;

  const candidate = body as Record<string, unknown>;
  const textFields = [
    'id',
    'ingredientName',
    'quantity',
    'unit',
    'category',
    'expirationDate',
    'estimatedUnitPrice',
    'purchaseLocation',
    'lowStockThreshold',
    'notes',
  ] as const;

  return textFields.every(
    (field) => candidate[field] === undefined || typeof candidate[field] === 'string'
  );
}

export async function GET() {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    throw error;
  }
  if (!user.tenant) throw new Error('Tenant context required');
  const items = await listInventoryItemsScoped({ tenantId: user.tenant.tenantId, userId: user.id });
  return NextResponse.json({ items });
}

export async function POST(request: NextRequest) {
  let authUser: Awaited<ReturnType<typeof requireUser>>;
  try {
    authUser = await requireUser();
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    throw error;
  }
  if (!authUser.tenant) throw new Error('Tenant context required');
  const tenant = authUser.tenant;

  const body: unknown = await request.json().catch(() => null);
  if (!isInventoryItemBody(body)) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const {
    id,
    ingredientName,
    quantity,
    unit,
    category,
    expirationDate,
    estimatedUnitPrice,
    purchaseLocation,
    lowStockThreshold,
    notes,
  } = body;

  const name = ingredientName?.trim();
  const validated = validateInventoryFields({
    quantity,
    unit,
    estimatedUnitPrice,
    lowStockThreshold,
  });
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });

  if (!name) {
    return NextResponse.json({ error: 'Ingredient name is required' }, { status: 400 });
  }
  if (!isValidInventoryExpirationDate(expirationDate)) {
    return NextResponse.json(
      { error: 'Introduce una fecha de vencimiento válida.' },
      { status: 400 }
    );
  }
  // Reject ambiguous legacy writes rather than silently assigning a currency or clearing a price.
  if (estimatedUnitPrice?.trim())
    return NextResponse.json(
      { error: 'Usa una referencia de precio con moneda y unidad.' },
      { status: 400 }
    );
  const price = parseInventoryPriceWrite(body.priceReference);
  if (!price.ok) return NextResponse.json({ error: price.error }, { status: 400 });
  const selectedCategory = category?.trim();
  if (selectedCategory && !INVENTORY_CATEGORIES.some((option) => option === selectedCategory)) {
    return NextResponse.json({ error: 'Selecciona una categoría válida.' }, { status: 400 });
  }

  if (id !== undefined) {
    return NextResponse.json(
      { error: 'Usa la edición de inventario con revisión de existencias.' },
      { status: 409 }
    );
  }

  const item = await createInventoryItem({
    tenantId: tenant.tenantId,
    userId: authUser.id,
    ingredientName: name,
    quantity: validated.quantity,
    unit: validated.unit,
    category: selectedCategory || detectInventoryCategory(name),
    expirationDate: expirationDate || null,
    ...(price.price ? { priceReference: price.price } : {}),
    purchaseLocation: purchaseLocation?.trim() || null,
    lowStockThreshold: validated.lowStockThreshold,
    normalizedName: normalizeInventoryName(name),
    notes: notes?.trim() || null,
  });

  return NextResponse.json({ item }, { status: 201 });
}

// Price-only confirmation/update: never overwrite quantities, stock, or other fields.
export async function PATCH(request: NextRequest) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    throw error;
  }
  if (!user.tenant) return NextResponse.json({ error: 'Tenant context required' }, { status: 403 });
  const body: unknown = await request.json().catch(() => null);
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).length !== 2 ||
    !('id' in body) ||
    typeof body.id !== 'string' ||
    body.id.length !== 36 ||
    !INVENTORY_ID.test(body.id) ||
    !('priceReference' in body)
  ) {
    return NextResponse.json({ error: 'Solicitud de precio inválida.' }, { status: 400 });
  }
  const price = parseInventoryPriceWrite(body.priceReference);
  if (!price.ok || !price.price)
    return NextResponse.json(
      { error: price.ok ? 'Introduce una referencia de precio completa.' : price.error },
      { status: 400 }
    );
  const scope = { tenantId: user.tenant.tenantId, userId: user.id };
  const item = await updateInventoryItem(
    body.id,
    scope.tenantId,
    { priceReference: price.price },
    scope
  );
  if (!item) return NextResponse.json({ error: 'Ingrediente no encontrado.' }, { status: 404 });
  return NextResponse.json({ item });
}

export async function DELETE(request: NextRequest) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    throw error;
  }
  if (!user.tenant) return NextResponse.json({ error: 'Tenant context required' }, { status: 403 });
  const tenant = user.tenant;
  const ids = request.nextUrl.searchParams.getAll('id');
  const id = ids[0];
  if (ids.length !== 1 || !id || id.length !== 36 || !INVENTORY_ID.test(id)) {
    return NextResponse.json({ error: 'ID de inventario inválido.' }, { status: 400 });
  }

  const result = await deleteInventoryItem(id, tenant.tenantId, {
    tenantId: tenant.tenantId,
    userId: user.id,
  });
  if (result === 'has_history')
    return NextResponse.json(
      { error: 'No se puede eliminar un ingrediente con historial de movimientos.' },
      { status: 409 }
    );
  if (result === 'not_found')
    return NextResponse.json({ error: 'Ingrediente no encontrado.' }, { status: 404 });
  if (result !== 'deleted') throw new Error('Unexpected inventory deletion result');
  return NextResponse.json({ ok: true });
}
