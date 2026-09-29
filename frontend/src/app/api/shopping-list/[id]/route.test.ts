import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const requireTenantMock = vi.fn();
const requireUserMock = vi.fn();
const updateShoppingListItemStatusMock = vi.fn();
const deleteShoppingListItemMock = vi.fn();

vi.mock('@/lib/auth/server', () => ({
  requireTenant: requireTenantMock,
  requireUser: requireUserMock,
}));
vi.mock('@/lib/db/repositories/shoppingListRepository', () => ({
  updateShoppingListItemStatus: updateShoppingListItemStatusMock,
  deleteShoppingListItem: deleteShoppingListItemMock,
}));

const { DELETE, PATCH } = await import('./route');

type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];

const itemId = '0d5f1ef0-a9f7-4cd3-97e8-5fd7bf0613db';
const item = {
  id: itemId,
  tenant_id: 'tenant-1',
  user_id: 'user-1',
  source: 'manual',
  premium_recipe_id: null,
  ingredient_name: 'Arroz',
  quantity: '1 kg',
  status: 'purchased' as const,
  created_at: '2026-03-16T00:00:00.000Z',
  updated_at: '2026-03-16T01:00:00.000Z',
};

function request(init?: NextRequestInit): NextRequest {
  return new NextRequest(`https://app.example.test/api/shopping-list/${itemId}`, init);
}

function context(id = itemId): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

describe('/api/shopping-list/[id]', () => {
  beforeEach(() => {
    requireTenantMock.mockReset();
    requireUserMock.mockReset();
    updateShoppingListItemStatusMock.mockReset();
    deleteShoppingListItemMock.mockReset();

    requireTenantMock.mockResolvedValue({ tenantId: 'tenant-1' });
    requireUserMock.mockResolvedValue({ id: 'user-1' });
    updateShoppingListItemStatusMock.mockResolvedValue(item);
    deleteShoppingListItemMock.mockResolvedValue(item);
  });

  it.each(['pending', 'purchased'] as const)('updates a valid %s status in authenticated scope', async (status) => {
    const response = await PATCH(
      request({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, tenantId: 'other-tenant', userId: 'other-user' }),
      }),
      context()
    );

    expect(response.status).toBe(200);
    expect(updateShoppingListItemStatusMock).toHaveBeenCalledWith(
      itemId,
      'tenant-1',
      'user-1',
      status
    );
    expect(await response.json()).toEqual({
      item: {
        id: item.id,
        source: item.source,
        ingredient_name: item.ingredient_name,
        quantity: item.quantity,
        status: item.status,
        created_at: item.created_at,
        updated_at: item.updated_at,
      },
    });
  });

  it('rejects invalid ids and status changes outside the pending/purchased contract', async () => {
    const invalidId = await PATCH(
      request({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'purchased' }),
      }),
      context('not-a-uuid')
    );
    const invalidStatus = await PATCH(
      request({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'archived' }),
      }),
      context()
    );

    expect(invalidId.status).toBe(400);
    expect(invalidStatus.status).toBe(400);
    expect(updateShoppingListItemStatusMock).not.toHaveBeenCalled();
  });

  it('returns a generic 404 when an item is inaccessible to the authenticated scope', async () => {
    updateShoppingListItemStatusMock.mockResolvedValueOnce(null);

    const response = await PATCH(
      request({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'purchased' }),
      }),
      context()
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Shopping list item not found' });
  });

  it('deletes only in authenticated scope and returns a clean success response', async () => {
    const response = await DELETE(request({ method: 'DELETE' }), context());

    expect(response.status).toBe(200);
    expect(deleteShoppingListItemMock).toHaveBeenCalledWith(itemId, 'tenant-1', 'user-1');
    expect(await response.json()).toEqual({ ok: true });
  });

  it('returns a generic 404 when deletion cannot access an item', async () => {
    deleteShoppingListItemMock.mockResolvedValueOnce(null);

    const response = await DELETE(request({ method: 'DELETE' }), context());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Shopping list item not found' });
  });

  it('returns 401 without mutating when authentication fails', async () => {
    requireUserMock.mockRejectedValueOnce(new Error('Unauthorized'));

    const response = await DELETE(request({ method: 'DELETE' }), context());

    expect(response.status).toBe(401);
    expect(deleteShoppingListItemMock).not.toHaveBeenCalled();
  });
});
