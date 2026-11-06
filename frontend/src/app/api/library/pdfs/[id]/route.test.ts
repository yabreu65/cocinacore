import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({
  role: vi.fn(),
  find: vi.fn(),
  remove: vi.fn(),
  count: vi.fn(),
  removeBook: vi.fn(),
  deleteFile: vi.fn(),
}));
vi.mock('@/lib/auth/server', () => ({ requireRole: mocks.role }));
vi.mock('@/lib/db/repositories/pdfRepository', () => ({
  findTenantPdfById: mocks.find,
  deleteTenantPdfById: mocks.remove,
  countTenantPdfsByBookId: mocks.count,
  deleteTenantBookById: mocks.removeBook,
}));
vi.mock('@/lib/storage', () => ({ getStorageAdapter: () => ({ deleteFile: mocks.deleteFile }) }));
const { DELETE } = await import('./route');
const request = new Request('https://example.test') as unknown as NextRequest;
const context = { params: Promise.resolve({ id: 'pdf-1' }) };

describe('private PDF deletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.role.mockResolvedValue({
      id: 'user-1',
      tenant: { tenantId: 'tenant-1', role: 'member' },
    });
    mocks.find.mockResolvedValue({
      id: 'pdf-1',
      uploaded_by: 'user-1',
      tenant_book_id: 'book-1',
      storage_path: 'private-key',
    });
    mocks.count.mockResolvedValue(0);
    mocks.deleteFile.mockResolvedValue(undefined);
  });
  it.each(['member', 'owner', 'admin'])(
    'permits authorized %s and scopes all reads and writes',
    async (role) => {
      mocks.role.mockResolvedValue({ id: 'user-1', tenant: { tenantId: 'tenant-1', role } });
      if (role !== 'member')
        mocks.find.mockResolvedValue({
          uploaded_by: 'other',
          tenant_book_id: 'book-1',
          storage_path: 'private-key',
        });
      expect((await DELETE(request, context)).status).toBe(200);
      const scope = { tenantId: 'tenant-1', userId: 'user-1' };
      expect(mocks.find).toHaveBeenCalledWith('tenant-1', 'pdf-1', scope);
      expect(mocks.remove).toHaveBeenCalledWith('tenant-1', 'pdf-1', scope);
      expect(mocks.count).toHaveBeenCalledWith('tenant-1', 'book-1', scope);
      expect(mocks.removeBook).toHaveBeenCalledWith('tenant-1', 'book-1', scope);
      expect(mocks.deleteFile).toHaveBeenCalledWith('private-key');
    }
  );
  it('rejects a member deleting another user’s PDF', async () => {
    mocks.find.mockResolvedValue({ uploaded_by: 'other' });
    expect((await DELETE(request, context)).status).toBe(403);
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.deleteFile).not.toHaveBeenCalled();
  });
  it('returns not found for an unavailable or foreign-tenant PDF', async () => {
    mocks.find.mockResolvedValue(null);
    expect((await DELETE(request, context)).status).toBe(404);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('preserves a shared book when other PDFs remain', async () => {
    mocks.count.mockResolvedValue(1);
    expect((await DELETE(request, context)).status).toBe(200);
    expect(mocks.removeBook).not.toHaveBeenCalled();
  });
});
