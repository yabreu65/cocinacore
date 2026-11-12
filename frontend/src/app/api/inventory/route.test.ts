import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireTenantMock = vi.fn();
const requireUserMock = vi.fn();
const listInventoryItemsByTenantMock = vi.fn();
const createInventoryItemMock = vi.fn();
const updateInventoryItemMock = vi.fn();
const deleteInventoryItemMock = vi.fn();

vi.mock('@/lib/auth/server', () => ({
  requireTenant: requireTenantMock,
  requireUser: requireUserMock,
}));
vi.mock('@/lib/db/repositories/inventoryRepository', () => ({
  listInventoryItemsScoped: listInventoryItemsByTenantMock,
  createInventoryItem: createInventoryItemMock,
  updateInventoryItem: updateInventoryItemMock,
  deleteInventoryItem: deleteInventoryItemMock,
}));

const { GET, POST, DELETE } = await import('./route');

describe('GET /api/inventory', () => {
  beforeEach(() => {
    requireUserMock
      .mockReset()
      .mockResolvedValue({ id: 'user-1', tenant: { tenantId: 'tenant-1' } });
    listInventoryItemsByTenantMock.mockReset().mockResolvedValue([]);
  });

  it('returns unauthorized without calling the repository when authentication fails', async () => {
    requireUserMock.mockRejectedValueOnce(new Error('Unauthorized'));

    const response = await GET();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
    expect(listInventoryItemsByTenantMock).not.toHaveBeenCalled();
  });

  it('does not convert unrelated tenant-authentication errors to unauthorized', async () => {
    const error = new Error('tenant service unavailable');
    requireUserMock.mockRejectedValueOnce(error);

    await expect(GET()).rejects.toBe(error);
    expect(listInventoryItemsByTenantMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/inventory', () => {
  beforeEach(() => {
    requireUserMock
      .mockReset()
      .mockResolvedValue({ id: 'user-1', tenant: { tenantId: 'tenant-1' } });
    requireUserMock
      .mockReset()
      .mockResolvedValue({ id: 'user-1', tenant: { tenantId: 'tenant-1' } });
    createInventoryItemMock.mockReset();
    updateInventoryItemMock.mockReset();
  });

  it.each([
    { quantity: '1', unit: '500 gramos' },
    { quantity: '-1', unit: 'kg' },
    { quantity: '500 g', unit: 'g' },
    { quantity: '500' },
    { quantity: '0.00001', unit: 'g' },
    { lowStockThreshold: '1' },
    { lowStockThreshold: '-1', unit: 'g' },
    { estimatedUnitPrice: '-1' },
    { quantity: '1', unit: 'constructor' },
    { category: 'categoría inventada' },
    { expirationDate: '2026-02-30' },
    { expirationDate: 'not-a-date' },
    { expirationDate: '2026-13-01' },
    { expirationDate: '2026-11-12T00:00:00.000Z' },
  ])('rejects invalid inventory fields for create and update %j', async (fields) => {
    for (const id of [undefined, 'item-1']) {
      const response = await POST(
        new NextRequest('http://localhost/api/inventory', {
          method: 'POST',
          body: JSON.stringify({ id, ingredientName: 'Harina', ...fields }),
        })
      );
      expect(response.status).toBe(400);
    }
    expect(createInventoryItemMock).not.toHaveBeenCalled();
    expect(updateInventoryItemMock).not.toHaveBeenCalled();
  });

  it('normalizes quantities and units for create and update', async () => {
    createInventoryItemMock.mockResolvedValue({ id: 'new' });
    updateInventoryItemMock.mockResolvedValue({ id: 'item-1' });
    const payload = {
      ingredientName: 'Harina',
      quantity: '0,5',
      unit: 'kilogramos',
      lowStockThreshold: '0,25',
      expirationDate: '2028-02-29',
    };
    const expected = {
      quantity: '0.5',
      unit: 'kg',
      lowStockThreshold: 0.25,
      expirationDate: '2028-02-29',
    };
    for (const id of [undefined, 'item-1']) {
      const response = await POST(
        new NextRequest('http://localhost/api/inventory', {
          method: 'POST',
          body: JSON.stringify({ id, ...payload }),
        })
      );
      expect(response.status).toBe(id ? 200 : 201);
    }
    expect(createInventoryItemMock).toHaveBeenCalledWith(expect.objectContaining(expected));
    expect(updateInventoryItemMock).toHaveBeenCalledWith(
      'item-1',
      'tenant-1',
      expect.objectContaining(expected),
      {
        tenantId: 'tenant-1',
        userId: 'user-1',
      }
    );
  });

  it('rejects a non-string ingredient name without persisting', async () => {
    const request = new NextRequest('http://localhost/api/inventory', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ingredientName: 42 }),
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(createInventoryItemMock).not.toHaveBeenCalled();
    expect(updateInventoryItemMock).not.toHaveBeenCalled();
  });

  it.each([
    { field: 'estimatedUnitPrice', value: 'not-a-number' },
    { field: 'lowStockThreshold', value: 'Infinity' },
  ])('rejects non-finite $field on create without persisting', async ({ field, value }) => {
    const request = new NextRequest('http://localhost/api/inventory', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ingredientName: 'Rice', [field]: value }),
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(createInventoryItemMock).not.toHaveBeenCalled();
    expect(updateInventoryItemMock).not.toHaveBeenCalled();
  });

  it.each([
    { field: 'estimatedUnitPrice', value: 'not-a-number' },
    { field: 'lowStockThreshold', value: 'Infinity' },
  ])('rejects non-finite $field on update without persisting', async ({ field, value }) => {
    const request = new NextRequest('http://localhost/api/inventory', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'item-1', ingredientName: 'Rice', [field]: value }),
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(createInventoryItemMock).not.toHaveBeenCalled();
    expect(updateInventoryItemMock).not.toHaveBeenCalled();
  });
});

describe('authenticated inventory scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({ id: 'user-1', tenant: { tenantId: 'tenant-1' } });
    listInventoryItemsByTenantMock.mockResolvedValue([]);
    createInventoryItemMock.mockResolvedValue({ id: 'new' });
    updateInventoryItemMock.mockResolvedValue({ id: 'item-1' });
  });
  it('returns 401 on unauthenticated writes without repository calls', async () => {
    requireUserMock.mockRejectedValue(new Error('Unauthorized'));
    const create = new NextRequest('http://localhost/api/inventory', {
      method: 'POST',
      body: JSON.stringify({ ingredientName: 'Harina' }),
    });
    const remove = new NextRequest('http://localhost/api/inventory?id=item-1', {
      method: 'DELETE',
    });
    expect((await POST(create)).status).toBe(401);
    expect((await DELETE(remove)).status).toBe(401);
    expect(createInventoryItemMock).not.toHaveBeenCalled();
    expect(updateInventoryItemMock).not.toHaveBeenCalled();
    expect(deleteInventoryItemMock).not.toHaveBeenCalled();
  });
  it('preserves non-authentication failures on writes', async () => {
    const error = new Error('database unavailable');
    requireUserMock.mockRejectedValue(error);
    await expect(
      POST(new NextRequest('http://localhost/api/inventory', { method: 'POST' }))
    ).rejects.toBe(error);
    await expect(
      DELETE(new NextRequest('http://localhost/api/inventory?id=item-1', { method: 'DELETE' }))
    ).rejects.toBe(error);
  });
  it('GET uses actor and tenant from the same user', async () => {
    expect((await GET()).status).toBe(200);
    expect(listInventoryItemsByTenantMock).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      userId: 'user-1',
    });
    expect(requireUserMock).toHaveBeenCalledTimes(1);
  });
  it('POST create ignores client identity fields', async () => {
    const req = new NextRequest('http://localhost/api/inventory', {
      method: 'POST',
      body: JSON.stringify({ ingredientName: 'Rice', userId: 'attacker', tenantId: 'other' }),
    });
    expect((await POST(req)).status).toBe(201);
    expect(createInventoryItemMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', userId: 'user-1' })
    );
    expect(requireUserMock).toHaveBeenCalledTimes(1);
  });
  it('POST update uses server actor and tenant', async () => {
    const req = new NextRequest('http://localhost/api/inventory', {
      method: 'POST',
      body: JSON.stringify({
        id: 'item-1',
        ingredientName: 'Rice',
        tenantId: 'other',
        userId: 'attacker',
      }),
    });
    expect((await POST(req)).status).toBe(200);
    expect(updateInventoryItemMock).toHaveBeenCalledWith('item-1', 'tenant-1', expect.any(Object), {
      tenantId: 'tenant-1',
      userId: 'user-1',
    });
  });
  it('DELETE uses server actor and tenant', async () => {
    const req = new NextRequest(
      'http://localhost/api/inventory?id=item-1&tenantId=other&userId=attacker',
      { method: 'DELETE' }
    );
    expect((await DELETE(req)).status).toBe(200);
    expect(deleteInventoryItemMock).toHaveBeenCalledWith('item-1', 'tenant-1', {
      tenantId: 'tenant-1',
      userId: 'user-1',
    });
  });
  it('denies session without tenant before reading data', async () => {
    requireUserMock.mockResolvedValueOnce({ id: 'user-1', tenant: null });
    await expect(GET()).rejects.toThrow('Tenant context required');
    expect(listInventoryItemsByTenantMock).not.toHaveBeenCalled();
  });
});
