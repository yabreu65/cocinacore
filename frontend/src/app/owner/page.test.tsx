import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  owner: vi.fn(),
  metrics: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock('@/lib/auth/server', () => ({ getCurrentUser: mocks.user }));
vi.mock('@/lib/db/repositories/platformOwnerRepository', () => ({ isPlatformOwner: mocks.owner }));
vi.mock('@/lib/owner/metrics', () => ({ getOwnerMetrics: mocks.metrics }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
const { default: Page } = await import('./page');

describe('owner metrics authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({
      id: 'owner-1',
      tenant: { tenantId: 'tenant-1' },
    });
    mocks.owner.mockResolvedValue(true);
    mocks.metrics.mockResolvedValue({
      tenants: 1,
      users: 2,
      books: 3,
      pdfs: 4,
      chunks: 5,
      reports: 6,
      owners: 7,
    });
    mocks.redirect.mockImplementation((path: string) => {
      throw new Error(`redirect ${path}`);
    });
  });
  it('loads metrics only after verifying the authenticated owner', async () => {
    await Page();
    expect(mocks.owner).toHaveBeenCalledWith({
      id: 'owner-1',
      tenant: { tenantId: 'tenant-1' },
    });
    expect(mocks.metrics).toHaveBeenCalledOnce();
    expect(mocks.owner.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.metrics.mock.invocationCallOrder[0]
    );
  });
  it('denies non-owners before accessing metrics', async () => {
    mocks.owner.mockResolvedValue(false);
    await expect(Page()).rejects.toThrow('redirect /app');
    expect(mocks.metrics).not.toHaveBeenCalled();
  });
  it('denies anonymous users before owner or metrics lookup', async () => {
    mocks.user.mockResolvedValue(null);
    await expect(Page()).rejects.toThrow('redirect /login');
    expect(mocks.owner).not.toHaveBeenCalled();
    expect(mocks.metrics).not.toHaveBeenCalled();
  });
});
