import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const requireUserMock = vi.fn();
const confirmMock = vi.fn();
vi.mock('@/lib/auth/server', () => ({ requireUser: requireUserMock }));
vi.mock('@/lib/db/repositories/shoppingListRepository', async () => {
  class ShoppingGroupPurchaseError extends Error {
    constructor(readonly code: string) {
      super(code);
      this.name = 'ShoppingGroupPurchaseError';
    }
  }
  return { confirmShoppingProductPurchase: confirmMock, ShoppingGroupPurchaseError };
});

const { POST } = await import('./route');
const { ShoppingGroupPurchaseError } = await import('@/lib/db/repositories/shoppingListRepository');
const rowId = '00000000-0000-4000-8000-000000000011';
const body = {
  groupKey: 'pending:huevos',
  actualQuantity: '30 unidad',
  rows: [{ id: rowId, ingredientName: 'Huevo', quantity: '26 unidad' }],
};
const savedRow = {
  id: rowId,
  tenant_id: 'tenant-1',
  user_id: 'user-1',
  source: 'manual',
  premium_recipe_id: null,
  ingredient_name: 'Huevo',
  quantity: '26 unidad',
  status: 'purchased',
  transfer_inventory_item_id: 'inventory-1',
  transferred_at: '2026-11-21T10:00:00Z',
  created_at: '2026-11-21T09:00:00Z',
  updated_at: '2026-11-21T10:00:00Z',
};
function request(payload: unknown): NextRequest {
  return new NextRequest('https://app.example.test/api/shopping-list/purchase-group', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

describe('POST /api/shopping-list/purchase-group', () => {
  beforeEach(() => {
    requireUserMock
      .mockReset()
      .mockResolvedValue({ id: 'user-1', tenant: { tenantId: 'tenant-1' } });
    confirmMock.mockReset().mockResolvedValue({
      items: [savedRow],
      inventoryItem: {
        id: 'inventory-1',
        ingredient_name: 'Huevos',
        quantity: '30',
        unit: 'unidad',
        created_at: 'private',
      },
    });
  });
  it('uses server authenticated scope and returns only public receipt fields', async () => {
    const res = await POST(request({ ...body, tenantId: 'other-tenant', userId: 'other-user' }));
    expect(res.status).toBe(400); // strict payload blocks scope injection
    expect(confirmMock).not.toHaveBeenCalled();

    const success = await POST(request(body));
    expect(success.status).toBe(200);
    expect(confirmMock).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      userId: 'user-1',
      ...body,
    });
    const result = (await success.json()) as { items: unknown[]; inventoryItem: unknown };
    expect(result.items).toEqual([
      {
        id: rowId,
        source: 'manual',
        ingredient_name: 'Huevo',
        quantity: '26 unidad',
        status: 'purchased',
        transfer_inventory_item_id: 'inventory-1',
        transferred_at: '2026-11-21T10:00:00Z',
        purchased_quantity: '30',
        purchased_unit: 'unidad',
        created_at: '2026-11-21T09:00:00Z',
        updated_at: '2026-11-21T10:00:00Z',
      },
    ]);
    expect(result.inventoryItem).toEqual({
      id: 'inventory-1',
      ingredient_name: 'Huevos',
      quantity: '30',
      unit: 'unidad',
    });
    expect(JSON.stringify(result)).not.toContain('tenant_id');
  });
  it.each([
    { ...body, actualQuantity: ' ' },
    { ...body, groupKey: '' },
    { ...body, rows: [] },
    { ...body, rows: [body.rows[0], ...Array.from({ length: 251 }, () => body.rows[0])] },
    { ...body, rows: [{ ...body.rows[0], id: 'invalid' }] },
    { ...body, extra: 'not allowed' },
  ])('rejects malformed request before any mutation', async (payload) => {
    expect((await POST(request(payload))).status).toBe(400);
    expect(confirmMock).not.toHaveBeenCalled();
  });
  it('refuses unauthenticated caller and missing tenant', async () => {
    requireUserMock.mockRejectedValueOnce(new Error('Unauthorized'));
    expect((await POST(request(body))).status).toBe(401);
    requireUserMock.mockResolvedValueOnce({ id: 'user-1', tenant: null });
    expect((await POST(request(body))).status).toBe(401);
    expect(confirmMock).not.toHaveBeenCalled();
  });
  it.each([
    ['stale', 409],
    ['invalid_quantity', 400],
    ['insufficient', 409],
    ['ambiguous', 400],
  ] as const)('maps transaction %s to actionable HTTP %s', async (code, status) => {
    confirmMock.mockRejectedValueOnce(new ShoppingGroupPurchaseError(code));
    const res = await POST(request(body));
    expect(res.status).toBe(status);
    expect(((await res.json()) as { error: string }).error).toBeTruthy();
  });
  it('keeps database errors as fail-closed without leaking internals', async () => {
    confirmMock.mockRejectedValueOnce(new Error('private database connection'));
    const res = await POST(request(body));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('private database connection');
  });
});
