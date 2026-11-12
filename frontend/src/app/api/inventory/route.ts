import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/server';
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

interface InventoryItemBody {
  id?: string;
  ingredientName?: string;
  quantity?: string;
  unit?: string;
  category?: string;
  expirationDate?: string;
  estimatedUnitPrice?: string;
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
  const scope = { tenantId: tenant.tenantId, userId: authUser.id };

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
  const selectedCategory = category?.trim();
  if (selectedCategory && !INVENTORY_CATEGORIES.some((option) => option === selectedCategory)) {
    return NextResponse.json({ error: 'Selecciona una categoría válida.' }, { status: 400 });
  }

  if (id) {
    const updated = await updateInventoryItem(
      id,
      tenant.tenantId,
      {
        ingredientName: name,
        quantity: validated.quantity,
        unit: validated.unit,
        category: selectedCategory || detectInventoryCategory(name),
        expirationDate: expirationDate || null,
        estimatedUnitPrice: validated.estimatedUnitPrice,
        purchaseLocation: purchaseLocation?.trim() || null,
        lowStockThreshold: validated.lowStockThreshold,
        normalizedName: normalizeInventoryName(name),
        notes: notes?.trim() || null,
      },
      scope
    );
    return NextResponse.json({ item: updated });
  }

  const item = await createInventoryItem({
    tenantId: tenant.tenantId,
    userId: authUser.id,
    ingredientName: name,
    quantity: validated.quantity,
    unit: validated.unit,
    category: selectedCategory || detectInventoryCategory(name),
    expirationDate: expirationDate || null,
    estimatedUnitPrice: validated.estimatedUnitPrice,
    purchaseLocation: purchaseLocation?.trim() || null,
    lowStockThreshold: validated.lowStockThreshold,
    normalizedName: normalizeInventoryName(name),
    notes: notes?.trim() || null,
  });

  return NextResponse.json({ item }, { status: 201 });
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
  if (!user.tenant) throw new Error('Tenant context required');
  const tenant = user.tenant;
  const id = request.nextUrl.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'ID is required' }, { status: 400 });
  }

  await deleteInventoryItem(id, tenant.tenantId, { tenantId: tenant.tenantId, userId: user.id });
  return NextResponse.json({ ok: true });
}
