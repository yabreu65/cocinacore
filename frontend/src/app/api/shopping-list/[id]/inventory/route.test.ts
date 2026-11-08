import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const requireTenantMock = vi.fn();
const requireUserMock = vi.fn();
const transferPurchasedShoppingListItemMock = vi.fn();

vi.mock('@/lib/auth/server', () => ({
  requireTenant: requireTenantMock,
  requireUser: requireUserMock,
}));
vi.mock('@/lib/db/repositories/shoppingListRepository', () => ({
  ShoppingListTransferError: class extends Error {},
  transferPurchasedShoppingListItem: transferPurchasedShoppingListItemMock,
}));

const { POST } = await import('./route');
const id = '0d5f1ef0-a9f7-4cd3-97e8-5fd7bf0613db';
const item = {
  id,
  source: 'manual',
  ingredient_name: 'Arroz',
  quantity: '1 kg',
  status: 'purchased',
  transfer_inventory_item_id: 'inventory-1',
  transferred_at: '2026-03-16T00:00:00.000Z',
  created_at: '2026-03-16T00:00:00.000Z',
  updated_at: '2026-03-16T00:00:00.000Z',
};
const inventoryItem = { id: 'inventory-1', ingredient_name: 'Arroz', quantity: '1', unit: 'kg' };

function request(): NextRequest {
  return new NextRequest(`https://app.example.test/api/shopping-list/${id}/inventory`, {
    method: 'POST',
  });
}

function context(itemId = id): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id: itemId }) };
}

describe('POST /api/shopping-list/[id]/inventory', () => {
  beforeEach(() => {
    requireTenantMock.mockReset().mockResolvedValue({ tenantId: 'tenant-1' });
    requireUserMock
      .mockReset()
      .mockResolvedValue({ id: 'user-1', tenant: { tenantId: 'tenant-1' } });
    transferPurchasedShoppingListItemMock.mockReset().mockResolvedValue({ item, inventoryItem });
  });

  it('transfers only for authenticated ownership and returns the durable transfer state', async () => {
    const response = await POST(request(), context());

    expect(response.status).toBe(200);
    expect(requireUserMock).toHaveBeenCalledOnce();
    expect(requireTenantMock).not.toHaveBeenCalled();
    expect(transferPurchasedShoppingListItemMock).toHaveBeenCalledWith(id, 'tenant-1', 'user-1');
    expect(await response.json()).toEqual({
      item: {
        id: item.id,
        source: item.source,
        ingredient_name: item.ingredient_name,
        quantity: item.quantity,
        status: item.status,
        transfer_inventory_item_id: item.transfer_inventory_item_id,
        transferred_at: item.transferred_at,
        created_at: item.created_at,
        updated_at: item.updated_at,
      },
      inventoryItem: {
        id: inventoryItem.id,
        ingredient_name: inventoryItem.ingredient_name,
        quantity: inventoryItem.quantity,
        unit: inventoryItem.unit,
      },
    });
  });

  it('rejects a user without tenant before accessing rows', async () => {
    requireUserMock.mockResolvedValueOnce({ id: 'user-1', tenant: null });
    const response = await POST(request(), context());
    expect(response.status).toBe(401);
    expect(transferPurchasedShoppingListItemMock).not.toHaveBeenCalled();
  });

  it('rejects malformed ids without calling the repository', async () => {
    const response = await POST(request(), context('not-a-uuid'));

    expect(response.status).toBe(400);
    expect(transferPurchasedShoppingListItemMock).not.toHaveBeenCalled();
  });

  it('returns not found for a row outside authenticated ownership', async () => {
    transferPurchasedShoppingListItemMock.mockResolvedValueOnce(null);

    const response = await POST(request(), context());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Shopping list item not found' });
  });

  it('returns unauthorized without accessing rows when authentication fails', async () => {
    requireUserMock.mockRejectedValueOnce(new Error('Unauthorized'));

    const response = await POST(request(), context());

    expect(response.status).toBe(401);
    expect(transferPurchasedShoppingListItemMock).not.toHaveBeenCalled();
  });
});
