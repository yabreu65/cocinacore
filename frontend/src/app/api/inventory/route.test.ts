import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireTenantMock = vi.fn();
const requireUserMock = vi.fn();
const listInventoryItemsByTenantMock = vi.fn();
const createInventoryItemMock = vi.fn();
const updateInventoryItemMock = vi.fn();
const manageInventoryItemMock = vi.fn();
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

vi.mock('@/lib/db/repositories/inventoryManagementRepository', () => ({ manageInventoryItem: manageInventoryItemMock }));

const { GET, POST, PATCH, DELETE } = await import('./route');

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

  it('returns the created inventory revision unchanged for subsequent audited edits', async () => {
    const item = {
      id: '01234567-89ab-4cde-8fab-0123456789ab',
      revision: '123:1794520000.123456',
      quantity: '2',
      unit: 'kg',
    };
    createInventoryItemMock.mockResolvedValue(item);
    const response = await POST(
      new NextRequest('http://localhost/api/inventory', {
        method: 'POST',
        body: JSON.stringify({ ingredientName: 'Harina', quantity: '2', unit: 'kg' }),
      })
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ item });
  });

  it('normalizes creation and rejects legacy stock edits', async () => {
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
      expect(response.status).toBe(id ? 409 : 201);
    }
    expect(createInventoryItemMock).toHaveBeenCalledWith(expect.objectContaining(expected));
    expect(updateInventoryItemMock).not.toHaveBeenCalled();
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
  it('rejects legacy POST edit even with client identity fields', async () => {
    const req = new NextRequest('http://localhost/api/inventory', {
      method: 'POST',
      body: JSON.stringify({
        id: 'item-1',
        ingredientName: 'Rice',
        tenantId: 'other',
        userId: 'attacker',
      }),
    });
    expect((await POST(req)).status).toBe(409);
    expect(updateInventoryItemMock).not.toHaveBeenCalled();
    expect(createInventoryItemMock).not.toHaveBeenCalled();
  });
  it('DELETE uses server actor and tenant', async () => {
    deleteInventoryItemMock.mockResolvedValue('deleted');
    const req = new NextRequest(
      'http://localhost/api/inventory?id=01234567-89ab-4cde-8fab-0123456789ab&tenantId=other&userId=attacker',
      { method: 'DELETE' }
    );
    expect((await DELETE(req)).status).toBe(200);
    expect(deleteInventoryItemMock).toHaveBeenCalledWith(
      '01234567-89ab-4cde-8fab-0123456789ab',
      'tenant-1',
      {
        tenantId: 'tenant-1',
        userId: 'user-1',
      }
    );
  });
  it.each([
    ['has_history', 409],
    ['history_unavailable', 503],
    ['not_found', 404],
  ] as const)('DELETE maps repository outcome %s to %s', async (outcome, status) => {
    deleteInventoryItemMock.mockResolvedValue(outcome);
    const response = await DELETE(
      new NextRequest('http://localhost/api/inventory?id=01234567-89ab-4cde-8fab-0123456789ab', {
        method: 'DELETE',
      })
    );
    expect(response.status).toBe(status);
  });

  it.each([
    '',
    '?id=',
    '?id=abc',
    '?id=01234567-89ab-4cde-8fab-0123456789ag',
    '?id=01234567-89ab-4cde-8fab-0123456789ab%0A',
    '?id=01234567-89ab-4cde-8fab-0123456789ab&id=01234567-89ab-4cde-8fab-0123456789ab',
    '?id=0123456789ab4cde8fab0123456789ab',
  ])(
    'DELETE rejects malformed or ambiguous identifiers %s without repository access',
    async (query) => {
      const response = await DELETE(
        new NextRequest('http://localhost/api/inventory' + query, { method: 'DELETE' })
      );
      expect(response.status).toBe(400);
      expect(deleteInventoryItemMock).not.toHaveBeenCalled();
    }
  );
  it('DELETE rejects missing tenant without repository access', async () => {
    requireUserMock.mockResolvedValueOnce({ id: 'user-1', tenant: null });
    const response = await DELETE(
      new NextRequest('http://localhost/api/inventory?id=01234567-89ab-4cde-8fab-0123456789ab', {
        method: 'DELETE',
      })
    );
    expect(response.status).toBe(403);
    expect(deleteInventoryItemMock).not.toHaveBeenCalled();
  });
  it('denies session without tenant before reading data', async () => {
    requireUserMock.mockResolvedValueOnce({ id: 'user-1', tenant: null });
    await expect(GET()).rejects.toThrow('Tenant context required');
    expect(listInventoryItemsByTenantMock).not.toHaveBeenCalled();
  });
});

describe('inventory price reference writes', () => {
  const id = '01234567-89ab-4cde-8fab-0123456789ab';
  const revision = '123:1794520000.123456';
  const reference = {
    amount: '4000',
    currency: 'COP',
    referenceQuantity: '1',
    referenceUnit: 'kg',
  };
  const scope = { tenantId: 'tenant-1', userId: 'user-1' };
  function request(method: string, body: unknown) {
    return new NextRequest('http://localhost/api/inventory', {
      method,
      body: JSON.stringify(body),
    });
  }
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({ id: scope.userId, tenant: { tenantId: scope.tenantId } });
    createInventoryItemMock.mockResolvedValue({ id });
    manageInventoryItemMock.mockResolvedValue({ status: 'updated', item: { id } });
  });
  it('writes the complete normalized price on creation, with session identity only', async () => {
    const response = await POST(
      request('POST', {
        ingredientName: 'Arroz',
        quantity: '500',
        unit: 'g',
        priceReference: { ...reference, amount: '4000,00', referenceUnit: 'kilogramos' },
        tenantId: 'other',
      })
    );
    expect(response.status).toBe(201);
    expect(createInventoryItemMock).toHaveBeenCalledWith(
      expect.objectContaining({ ...scope, priceReference: reference })
    );
  });
  it('blocks legacy full edits rather than silently overwriting stock or historical prices', async () => {
    for (const estimatedUnitPrice of [undefined, '']) {
      expect(
        (
          await POST(
            request('POST', {
              id,
              ingredientName: 'Arroz',
              quantity: '500',
              unit: 'g',
              estimatedUnitPrice,
            })
          )
        ).status
      ).toBe(409);
    }
    expect(manageInventoryItemMock).not.toHaveBeenCalled();
    expect(createInventoryItemMock).not.toHaveBeenCalled();
  });
  it.each([
    null,
    42,
    {},
    { ...reference, amount: 4000 },
    { ...reference, currency: '$' },
    { ...reference, referenceQuantity: '0' },
    { ...reference, referenceUnit: '500 g' },
    { ...reference, tenantId: 'other' },
  ])('rejects invalid reference %j before repository calls', async (priceReference) => {
    expect((await POST(request('POST', { ingredientName: 'Arroz', priceReference }))).status).toBe(
      400
    );
    expect((await PATCH(request('PATCH', { id, revision, priceReference }))).status).toBe(400);
    expect(createInventoryItemMock).not.toHaveBeenCalled();
    expect(manageInventoryItemMock).not.toHaveBeenCalled();
  });
  it('rejects new ambiguous legacy amounts', async () => {
    expect(
      (await POST(request('POST', { ingredientName: 'Arroz', estimatedUnitPrice: '4000' }))).status
    ).toBe(400);
    expect(createInventoryItemMock).not.toHaveBeenCalled();
  });
  it('updates only the complete price using server scope', async () => {
    expect((await PATCH(request('PATCH', { id, revision, priceReference: reference }))).status).toBe(200);
    expect(manageInventoryItemMock).toHaveBeenCalledWith(scope, { action: 'price', id, revision, priceReference: reference });
  });
  it('rejects extra identity/stock fields and invalid ids on price-only request', async () => {
    for (const body of [
      { id, revision, priceReference: reference, tenantId: 'other' },
      { id, revision, priceReference: reference, quantity: '0' },
      { id: 'invalid', revision, priceReference: reference },
      { id, revision: 'invalid', priceReference: reference },
      { id },
    ]) {
      expect((await PATCH(request('PATCH', body))).status).toBe(400);
    }
    expect(manageInventoryItemMock).not.toHaveBeenCalled();
  });
  it('returns not found for inaccessible or absent item', async () => {
    manageInventoryItemMock.mockResolvedValue({ status: 'not_found' });
    expect((await PATCH(request('PATCH', { id, revision, priceReference: reference }))).status).toBe(404);
  });
  it('tells an older client to refresh without changing the price', async () => {
    const response = await PATCH(request('PATCH', { id, priceReference: reference }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'INVENTORY_REVISION_REQUIRED' });
    expect(manageInventoryItemMock).not.toHaveBeenCalled();
  });
  it('rejects a stale price revision without an unversioned fallback', async () => {
    manageInventoryItemMock.mockResolvedValue({ status: 'conflict' });
    expect((await PATCH(request('PATCH', { id, revision, priceReference: reference }))).status).toBe(409);
    expect(updateInventoryItemMock).not.toHaveBeenCalled();
  });
  it('rejects missing session and tenant before price writes', async () => {
    requireUserMock.mockRejectedValueOnce(new Error('Unauthorized'));
    expect((await PATCH(request('PATCH', { id, revision, priceReference: reference }))).status).toBe(401);
    requireUserMock.mockResolvedValueOnce({ id: scope.userId, tenant: null });
    expect((await PATCH(request('PATCH', { id, revision, priceReference: reference }))).status).toBe(403);
    expect(manageInventoryItemMock).not.toHaveBeenCalled();
  });
});
