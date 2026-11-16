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
    expect(mocks.clientQuery).toHaveBeenCalledTimes(1);
    for (const [sql, params] of mocks.clientQuery.mock.calls as [string, unknown[]][]) {
      expect(sql).toContain('tenant_id = $1');
      expect(params).toEqual(['authenticated-tenant']);
    }
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
    mocks.clientQuery.mockResolvedValue({
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
  it('does not query tenant documents without an authenticated tenant', async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 'authenticated-user', tenant: null });
    await LibraryPage();
    expect(mocks.scopedTransaction).not.toHaveBeenCalled();
    expect(mocks.clientQuery).not.toHaveBeenCalled();
  });
});
