import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  scopedTransaction: vi.fn(),
  clientQuery: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock('@/lib/db', () => ({ scopedTransaction: mocks.scopedTransaction }));

const { default: LibraryPage } = await import('./page');

describe('authenticated library page data access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({
      id: 'authenticated-user',
      tenant: { tenantId: 'authenticated-tenant', tenantType: 'home' },
    });
    mocks.clientQuery.mockResolvedValue({ rows: [] });
    mocks.scopedTransaction.mockImplementation(
      async (
        _scope: unknown,
        operation: (client: { query: typeof mocks.clientQuery }) => Promise<unknown>
      ) => operation({ query: mocks.clientQuery })
    );
  });

  it('loads books and PDFs on the same scoped client and authenticated tenant/user', async () => {
    await LibraryPage();
    expect(mocks.scopedTransaction).toHaveBeenCalledTimes(1);
    expect(mocks.scopedTransaction.mock.calls[0]?.[0]).toEqual({
      tenantId: 'authenticated-tenant',
      userId: 'authenticated-user',
    });
    expect(mocks.clientQuery).toHaveBeenCalledTimes(2);
    const [tenantSql, params] = mocks.clientQuery.mock.calls[0] as [string, unknown[]];
    expect(tenantSql).toContain('tenant_id = $1');
    expect(params).toEqual(['authenticated-tenant']);
  });

  it('loads the linked older book through the displayed PDF set and deduplicates it', async () => {
    const pdf = {
      id: 'pdf-1',
      tenant_book_id: 'old-book',
      storage_path: 'private/book.pdf',
      created_at: '2026-11-14T12:00:00.123456Z',
      processing_status: 'ready',
      page_count: 20,
      uploaded_by: 'authenticated-user',
      book_id: 'old-book',
      book_title: 'Older linked book',
      book_author: 'Author',
    };
    mocks.clientQuery.mockResolvedValueOnce({
      rows: [
        pdf,
        { ...pdf, id: 'pdf-2' },
        {
          ...pdf,
          id: 'pdf-3',
          tenant_book_id: 'foreign',
          book_id: null,
          book_title: null,
          book_author: null,
        },
      ],
    });
    const markup = renderToStaticMarkup(await LibraryPage());
    const sql = mocks.clientQuery.mock.calls[0][0] as string;
    expect(sql).toContain('with visible_pdfs as');
    expect(sql).toContain(
      'left join public.tenant_books b on b.id = p.tenant_book_id and b.tenant_id = $1'
    );
    expect(sql.match(/limit 50/g)).toHaveLength(1);
    expect(markup.match(/Older linked book/g)).toHaveLength(1);
    expect(markup).not.toContain('foreign');
  });
  it('renders only global PDF book metadata, without exposing storage paths', async () => {
    mocks.clientQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
      rows: [
        {
          id: 'global-1',
          title: 'Global cookbook',
          author: 'Chef',
          description: 'Recipes',
          cuisine_region: 'Andes',
          storage_path: 'global-pdfs/secret.pdf',
        },
      ],
    });
    const markup = renderToStaticMarkup(await LibraryPage());
    const sql = mocks.clientQuery.mock.calls[1][0] as string;
    expect(sql).toContain('from public.global_books');
    expect(sql).toContain('exists (select 1 from public.global_pdf_library');
    expect(sql).not.toContain('storage_path');
    expect(markup).toContain('Global cookbook');
    expect(markup).toContain('Chef');
    expect(markup).not.toContain('global-pdfs/secret.pdf');
  });

  it('links to private uploads and explains their scope', async () => {
    const markup = renderToStaticMarkup(await LibraryPage());
    expect(markup).toContain('href="/library/upload"');
    expect(markup).toContain('Subir libro PDF');
    expect(markup).toContain('fuentes privadas de tu hogar');
    expect(markup).toContain('límite 5 PDFs');
  });

  it('shows the professional plan quota', async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 'authenticated-user', tenant: { tenantId: 'authenticated-tenant', tenantType: 'professional' } });
    expect(renderToStaticMarkup(await LibraryPage())).toContain('límite 15 PDFs');
  });

  it('shows an empty global catalog', async () => {
    expect(renderToStaticMarkup(await LibraryPage())).toContain(
      'No hay libros globales disponibles.'
    );
  });
  it('does not query tenant documents without an authenticated tenant', async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 'authenticated-user', tenant: null });
    await LibraryPage();
    expect(mocks.scopedTransaction).not.toHaveBeenCalled();
    expect(mocks.clientQuery).not.toHaveBeenCalled();
  });
});
