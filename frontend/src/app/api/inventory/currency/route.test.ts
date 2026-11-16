import { beforeEach, describe, expect, it, vi } from 'vitest';
const requireUserMock = vi.fn();
const readMock = vi.fn();
const updateMock = vi.fn();
vi.mock('@/lib/auth/server', () => ({ requireUser: requireUserMock }));
vi.mock('@/lib/db/repositories/inventoryCurrencyRepository', () => ({
  readInventoryCurrencySettings: readMock,
  updateInventoryCurrencySettings: updateMock,
}));
const { GET, PUT } = await import('./route');
const scope = { tenantId: 'tenant-1', userId: 'user-1' };
const request = (body: unknown) =>
  new Request('http://localhost/api/inventory/currency', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  requireUserMock.mockResolvedValue({
    id: scope.userId,
    tenant: { tenantId: scope.tenantId, role: 'owner' },
  });
  readMock.mockResolvedValue({ currency: null, canManageCurrency: false });
  updateMock.mockResolvedValue({ currency: 'COP', canManageCurrency: true });
});
describe('inventory currency API', () => {
  it('returns only scoped settings and prevents caching', async () => {
    const r = await GET();
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('private, no-store');
    expect(await r.json()).toEqual({ currency: null, canManageCurrency: false });
    expect(readMock).toHaveBeenCalledWith(scope);
  });
  it('uses server scope and persists only an explicit currency', async () => {
    expect((await PUT(request({ currency: 'COP' }))).status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(scope, 'COP');
  });
  it.each([
    null,
    {},
    { currency: '$' },
    { currency: 1 },
    { currency: 'cop' },
    { currency: 'COP', tenantId: 'other' },
    { currency: 'COP', role: 'owner' },
  ])('rejects bad payload %j', async (body) => {
    expect((await PUT(request(body))).status).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
  });
  it('honors actual membership denial even with owner session claim', async () => {
    updateMock.mockResolvedValue(null);
    expect((await PUT(request({ currency: 'COP' }))).status).toBe(403);
  });
  it('denies unauthenticated reads and writes', async () => {
    requireUserMock.mockRejectedValue(new Error('Unauthorized'));
    expect((await GET()).status).toBe(401);
    expect((await PUT(request({ currency: 'COP' }))).status).toBe(401);
    expect(readMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });
  it('denies missing tenant or membership', async () => {
    requireUserMock.mockResolvedValueOnce({ id: scope.userId, tenant: null });
    expect((await GET()).status).toBe(403);
    readMock.mockResolvedValue(null);
    expect((await GET()).status).toBe(403);
  });
});
