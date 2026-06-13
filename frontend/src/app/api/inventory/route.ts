import { NextRequest, NextResponse } from 'next/server';
import { requireTenant } from '@/lib/auth/server';
import {
  listInventoryItemsByTenant,
  createInventoryItem,
  updateInventoryItem,
  deleteInventoryItem,
} from '@/lib/db/repositories/inventoryRepository';
import { detectInventoryCategory, normalizeInventoryName } from '@/lib/inventory/normalize-inventory';

export async function GET() {
  const tenant = await requireTenant();
  const items = await listInventoryItemsByTenant(tenant.tenantId);
  return NextResponse.json({ items });
}

export async function POST(request: NextRequest) {
  const tenant = await requireTenant();
  const { requireUser } = await import('@/lib/auth/server');
  const authUser = await requireUser();

  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
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
  } = body as {
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
  };

  const name = ingredientName?.trim();
  if (!name) {
    return NextResponse.json({ error: 'Ingredient name is required' }, { status: 400 });
  }

  const parsedEstimatedUnitPrice = estimatedUnitPrice?.trim()
    ? Number(estimatedUnitPrice)
    : null;
  const parsedLowStockThreshold = lowStockThreshold?.trim() ? Number(lowStockThreshold) : null;

  if (id) {
    const updated = await updateInventoryItem(id, tenant.tenantId, {
      ingredientName: name,
      quantity: quantity?.trim() || null,
      unit: unit?.trim() || null,
      category: category?.trim() || detectInventoryCategory(name),
      expirationDate: expirationDate || null,
      estimatedUnitPrice: parsedEstimatedUnitPrice,
      purchaseLocation: purchaseLocation?.trim() || null,
      lowStockThreshold: parsedLowStockThreshold,
      normalizedName: normalizeInventoryName(name),
      notes: notes?.trim() || null,
    });
    return NextResponse.json({ item: updated });
  }

  const item = await createInventoryItem({
    tenantId: tenant.tenantId,
    userId: authUser.id,
    ingredientName: name,
    quantity: quantity?.trim() || null,
    unit: unit?.trim() || null,
    category: category?.trim() || detectInventoryCategory(name),
    expirationDate: expirationDate || null,
    estimatedUnitPrice: parsedEstimatedUnitPrice,
    purchaseLocation: purchaseLocation?.trim() || null,
    lowStockThreshold: parsedLowStockThreshold,
    normalizedName: normalizeInventoryName(name),
    notes: notes?.trim() || null,
  });

  return NextResponse.json({ item }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const tenant = await requireTenant();
  const id = request.nextUrl.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'ID is required' }, { status: 400 });
  }

  await deleteInventoryItem(id, tenant.tenantId);
  return NextResponse.json({ ok: true });
}
