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
