import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const requireTenantMock = vi.fn();
const requireUserMock = vi.fn();
const listShoppingListItemsMock = vi.fn();
const createShoppingListItemMock = vi.fn();

vi.mock('@/lib/auth/server', () => ({
  requireTenant: requireTenantMock,
  requireUser: requireUserMock,
}));
vi.mock('@/lib/db/repositories/shoppingListRepository', () => ({
  listShoppingListItems: listShoppingListItemsMock,
  createShoppingListItem: createShoppingListItemMock,
}));

const { GET, POST } = await import('./route');

type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];

const item = {
  id: 'shopping-1',
  tenant_id: 'tenant-1',
  user_id: 'user-1',
  source: 'manual',
  premium_recipe_id: null,
  ingredient_name: 'Arroz',
  quantity: '1 kg',
  status: 'pending' as const,
  created_at: '2026-03-16T00:00:00.000Z',
  updated_at: '2026-03-16T00:00:00.000Z',
};

function request(path: string, init?: NextRequestInit): NextRequest {
  return new NextRequest(`https://app.example.test${path}`, init);
}

describe('/api/shopping-list', () => {
  beforeEach(() => {
    requireTenantMock.mockReset();
    requireUserMock.mockReset();
    listShoppingListItemsMock.mockReset();
    createShoppingListItemMock.mockReset();

    requireTenantMock.mockResolvedValue({ tenantId: 'tenant-1' });
    requireUserMock.mockResolvedValue({ id: 'user-1' });
    listShoppingListItemsMock.mockResolvedValue([item]);
    createShoppingListItemMock.mockResolvedValue(item);
  });

  it('lists public items only in the authenticated tenant and user scope', async () => {
    const response = await GET(request('/api/shopping-list?tenantId=other-tenant&userId=other-user'));

    expect(response.status).toBe(200);
    expect(listShoppingListItemsMock).toHaveBeenCalledWith('tenant-1', 'user-1', {});
    expect(await response.json()).toEqual({
      items: [
        {
          id: item.id,
          source: item.source,
          ingredient_name: item.ingredient_name,
          quantity: item.quantity,
          status: item.status,
          created_at: item.created_at,
          updated_at: item.updated_at,
        },
      ],
    });
  });

  it('applies a valid status filter', async () => {
    const response = await GET(request('/api/shopping-list?status=purchased'));

    expect(response.status).toBe(200);
    expect(listShoppingListItemsMock).toHaveBeenCalledWith('tenant-1', 'user-1', {
      status: 'purchased',
    });
  });

  it('rejects an invalid status filter before querying', async () => {
    const response = await GET(request('/api/shopping-list?status=archived'));

    expect(response.status).toBe(400);
    expect(listShoppingListItemsMock).not.toHaveBeenCalled();
  });

  it('creates an item from bounded input and ignores browser-controlled scope and premium fields', async () => {
    const response = await POST(
      request('/api/shopping-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ingredientName: '  Arroz  ',
          quantity: ' 1 kg ',
          source: 'manual',
          tenantId: 'other-tenant',
          userId: 'other-user',
          premium_recipe_id: '00000000-0000-4000-8000-000000000000',
        }),
      })
    );

    expect(response.status).toBe(201);
    expect(createShoppingListItemMock).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      userId: 'user-1',
      ingredientName: 'Arroz',
      quantity: '1 kg',
      source: 'manual',
    });
  });

  it.each([
    [{ ingredientName: '' }],
    [{ ingredientName: 'x'.repeat(201) }],
    [{ ingredientName: 'Arroz', quantity: 'x'.repeat(101) }],
    [{ ingredientName: 'Arroz', source: 'x'.repeat(51) }],
  ])('rejects empty or over-bounded creation fields', async (body) => {
    const response = await POST(
      request('/api/shopping-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    );

    expect(response.status).toBe(400);
    expect(createShoppingListItemMock).not.toHaveBeenCalled();
  });

  it('returns 401 without calling the repository when authentication fails', async () => {
    requireTenantMock.mockRejectedValueOnce(new Error('Unauthorized'));

    const response = await GET(request('/api/shopping-list'));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
    expect(listShoppingListItemsMock).not.toHaveBeenCalled();
  });

  it('returns a controlled 500 when listing fails', async () => {
    listShoppingListItemsMock.mockRejectedValueOnce(new Error('database unavailable'));

    const response = await GET(request('/api/shopping-list'));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Unable to retrieve shopping list' });
  });
});
