import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatchChunkResult } from './bookChunkRepository';

const { queryMock, queryWithStatementTimeoutMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  queryWithStatementTimeoutMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  query: queryMock,
  queryWithStatementTimeout: queryWithStatementTimeoutMock,
}));

const { searchChunks } = await import('./bookChunkRepository');

describe('searchChunks', () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryWithStatementTimeoutMock.mockReset();
    queryMock.mockResolvedValue({ rows: [] });
    queryWithStatementTimeoutMock.mockResolvedValue({ rows: [] as MatchChunkResult[] });
  });

  it('runs tenant-scoped vector search with a bounded statement timeout', async () => {
    const searchInput = {
      embedding: [0.1, 0.2, 0.3],
      tenantId: 'tenant-1',
      matchThreshold: 0.35,
      matchCount: 6,
      statementTimeoutMs: 10_000,
    };
    const rows: MatchChunkResult[] = [{
      id: 'chunk-1',
      content: 'A matched chunk',
      similarity: 0.9,
      metadata: { page: 1 },
      tenant_id: 'tenant-1',
      global_book_id: null,
      tenant_book_id: 'book-1',
      source_type: 'tenant_pdf',
    }];
    queryWithStatementTimeoutMock.mockResolvedValue({ rows });

    await expect(searchChunks(searchInput)).resolves.toEqual(rows);

    expect(queryMock).not.toHaveBeenCalled();
    expect(queryWithStatementTimeoutMock).toHaveBeenCalledTimes(1);
    expect(queryWithStatementTimeoutMock).toHaveBeenCalledWith(
      'select * from public.match_chunks($1::vector(1536), $2, $3, $4)',
      ['[0.1,0.2,0.3]', 0.35, 6, 'tenant-1'],
      10_000,
    );
  });
});
