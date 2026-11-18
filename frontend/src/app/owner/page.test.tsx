import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  owner: vi.fn(),
  metrics: vi.fn(),
  redirect: vi.fn(),
  pathname: vi.fn(),
}));
vi.mock('@/lib/auth/server', () => ({ getCurrentUser: mocks.user }));
vi.mock('@/lib/db/repositories/platformOwnerRepository', () => ({ isPlatformOwner: mocks.owner }));
vi.mock('@/lib/owner/metrics', () => ({ getOwnerMetrics: mocks.metrics }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect, usePathname: mocks.pathname }));
const { default: Page } = await import('./page');
const { default: OwnerShell } = await import('./OwnerShell');
const { default: OwnerSectionPlaceholder } = await import('./OwnerSectionPlaceholder');

describe('owner metrics authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({
      id: 'owner-1',
      tenant: { tenantId: 'tenant-1' },
    });
    mocks.owner.mockResolvedValue(true);
    mocks.pathname.mockReturnValue('/owner');
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

describe('owner dashboard presentation', () => {
  beforeEach(() => {
    mocks.pathname.mockReturnValue('/owner');
  });

  it('shows available tools and distinguishes the pending modules', async () => {
    mocks.user.mockResolvedValue({ id: 'owner-1' });
    mocks.owner.mockResolvedValue(true);
    mocks.metrics.mockResolvedValue({
      tenants: 1, users: 2, books: 3, pdfs: 4, chunks: 5, reports: 6, owners: 7,
    });
    const markup = renderToStaticMarkup(await Page());
    expect(markup).toContain('Panel de administración');
    expect(markup).toContain('Hogares registrados');
    expect(markup).toContain('Fragmentos indexados');
    for (const route of ['/owner/global-books', '/owner/global-pdfs', '/owner/global-pdfs/upload', '/owner/system-health']) {
      expect(markup).toContain(`href="${route}"`);
    }
    expect(markup).toContain('Módulos pendientes');
    expect(markup).not.toContain('href="/owner/indexing"');
    expect(markup).not.toContain('href="/owner/tenants"');
    expect(markup).not.toContain('href="/owner/premium-moderation"');
  });

  it('keeps the dashboard usable when the protected metrics read fails', async () => {
    mocks.user.mockResolvedValue({ id: 'owner-1' });
    mocks.owner.mockResolvedValue(true);
    mocks.metrics.mockRejectedValueOnce(new Error('internal diagnostic must not be rendered'));
    const markup = renderToStaticMarkup(await Page());
    expect(markup).toContain('Panel de administración');
    expect(markup).toContain('Métricas temporalmente no disponibles');
    expect(markup).toContain('Reintentar métricas');
    expect(markup).toContain('action="/owner"');
    expect(markup.match(/>—<\/p>/g)).toHaveLength(7);
    expect(markup).not.toContain('internal diagnostic');
    expect(markup).not.toContain('>0</p>');
    expect(markup).toContain('href="/owner/global-pdfs/upload"');
    expect(markup).toContain('href="/owner/system-health"');
  });

  it('renders a verified zero as zero, not as unavailable', async () => {
    mocks.user.mockResolvedValue({ id: 'owner-1' });
    mocks.owner.mockResolvedValue(true);
    mocks.metrics.mockResolvedValueOnce({
      tenants: 0, users: 2, books: 0, pdfs: 0, chunks: 0, reports: 0, owners: 1,
    });
    const markup = renderToStaticMarkup(await Page());
    expect(markup).not.toContain('Métricas temporalmente no disponibles');
    expect(markup.match(/>0<\/p>/g)).toHaveLength(5);
    expect(markup).not.toContain('>—</p>');
  });

  it('uses Spanish navigation, active page semantics and a return to the household', () => {
    mocks.pathname.mockReturnValue('/owner/global-pdfs/upload');
    const markup = renderToStaticMarkup(<OwnerShell><p>Contenido</p></OwnerShell>);
    expect(markup).toContain('aria-label="Administración"');
    expect(markup).toContain('aria-label="Administración móvil"');
    expect(markup).toContain('Volver a mi hogar');
    expect(markup).toContain('href="/app"');
    const uploadLinks = (markup.match(/<a\b[^>]*>/g) ?? []).filter(
      (tag) => tag.includes('href="/owner/global-pdfs/upload"')
    );
    expect(uploadLinks).toHaveLength(2);
    expect(uploadLinks.every((tag) => tag.includes('aria-current="page"'))).toBe(true);
    expect(markup).toContain('Pendiente');
    expect(markup).not.toContain('Owner Console');
    expect(markup).toContain('Contenido');
  });

  it('does not promise unavailable management features in placeholder screens', () => {
    const markup = renderToStaticMarkup(<OwnerSectionPlaceholder title="Indexación" description="Estado previsto" />);
    expect(markup).toContain('Módulo pendiente de implementación');
    expect(markup).toContain('todavía no ofrece funciones de gestión');
  });
});
