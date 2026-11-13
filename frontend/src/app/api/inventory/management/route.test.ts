import { beforeEach, describe, expect, it, vi } from 'vitest';
const requireUserMock = vi.fn();
const manageMock = vi.fn();
vi.mock('@/lib/auth/server', () => ({ requireUser: requireUserMock }));
vi.mock('@/lib/db/repositories/inventoryManagementRepository', () => ({
  manageInventoryItem: manageMock,
}));
const { PATCH } = await import('./route');
const scope = { tenantId: 'tenant-1', userId: 'actor-1' };
const payload = {
  id: '01234567-89ab-4cde-8fab-0123456789ab',
  revision: '123:1794520000.123456',
  action: 'stock',
  command: { kind: 'count', quantity: '300', reason: 'Conteo' },
};
const request = (body: unknown) =>
  new Request('http://localhost/api/inventory/management', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  requireUserMock.mockResolvedValue({ id: scope.userId, tenant: { tenantId: scope.tenantId } });
  manageMock.mockResolvedValue({ status: 'updated', item: { id: payload.id } });
});
describe('inventory management API', () => {
  it('passes only session scope and validated command', async () => {
    expect((await PATCH(request(payload))).status).toBe(200);
    expect(manageMock).toHaveBeenCalledExactlyOnceWith(scope, payload);
  });
  it.each([
    { ...payload, tenantId: 'other' },
    { ...payload, revision: '' },
    { ...payload, id: 'bad' },
    { ...payload, command: { ...payload.command, quantity: '-1' } },
    { ...payload, command: { ...payload.command, reason: '' } },
    { ...payload, command: { kind: 'convert', unit: '500 gramos' } },
    { ...payload, action: 'metadata', changes: { quantity: '3' }, command: undefined },
    {
      ...payload,
      action: 'metadata',
      changes: { expirationDate: '2026-02-30' },
      command: undefined,
    },
  ])('rejects invalid or identity-bearing command %j', async (body) => {
    expect((await PATCH(request(body))).status).toBe(400);
    expect(manageMock).not.toHaveBeenCalled();
  });
  it.each([
    ['not_found', 404],
    ['conflict', 409],
    ['invalid', 400],
  ])('maps %s to HTTP %s', async (status, code) => {
    manageMock.mockResolvedValue({ status, error: 'Invalid' });
    expect((await PATCH(request(payload))).status).toBe(code);
  });
  it('denies missing session or tenant', async () => {
    requireUserMock.mockRejectedValueOnce(new Error('Unauthorized'));
    expect((await PATCH(request(payload))).status).toBe(401);
    requireUserMock.mockResolvedValueOnce({ id: scope.userId, tenant: null });
    expect((await PATCH(request(payload))).status).toBe(403);
    expect(manageMock).not.toHaveBeenCalled();
  });
});
