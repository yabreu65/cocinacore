import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireTenantMock = vi.fn();
const requireUserMock = vi.fn();
const listInventoryItemsByTenantMock = vi.fn();
const createInventoryItemMock = vi.fn();
const updateInventoryItemMock = vi.fn();

vi.mock('@/lib/auth/server', () => ({
  requireTenant: requireTenantMock,
  requireUser: requireUserMock,
}));
vi.mock('@/lib/db/repositories/inventoryRepository', () => ({
  listInventoryItemsByTenant: listInventoryItemsByTenantMock,
  createInventoryItem: createInventoryItemMock,
  updateInventoryItem: updateInventoryItemMock,
  deleteInventoryItem: vi.fn(),
}));

const { GET, POST } = await import('./route');

describe('GET /api/inventory', () => {
  beforeEach(() => {
    requireTenantMock.mockReset().mockResolvedValue({ tenantId: 'tenant-1' });
    listInventoryItemsByTenantMock.mockReset().mockResolvedValue([]);
  });

  it('returns unauthorized without calling the repository when authentication fails', async () => {
    requireTenantMock.mockRejectedValueOnce(new Error('Unauthorized'));

    const response = await GET();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
    expect(listInventoryItemsByTenantMock).not.toHaveBeenCalled();
  });

  it('does not convert unrelated tenant-authentication errors to unauthorized', async () => {
    const error = new Error('tenant service unavailable');
    requireTenantMock.mockRejectedValueOnce(error);

    await expect(GET()).rejects.toBe(error);
    expect(listInventoryItemsByTenantMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/inventory', () => {
  beforeEach(() => {
    requireTenantMock.mockReset().mockResolvedValue({ tenantId: 'tenant-1' });
    requireUserMock.mockReset().mockResolvedValue({ id: 'user-1' });
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
