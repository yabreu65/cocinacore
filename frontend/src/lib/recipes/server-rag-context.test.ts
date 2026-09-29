import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateEmbeddingMock = vi.fn();
const searchChunksMock = vi.fn();

vi.mock('@/services/gemini', () => ({
  GeminiEmbeddingService: class {
    generateEmbedding = generateEmbeddingMock;
    generateEmbeddings = vi.fn();
  },
}));

vi.mock('@/lib/db/repositories/bookChunkRepository', () => ({
  searchChunks: searchChunksMock,
}));

const { retrieveServerRagContext } = await import('./server-rag-context');

function matchRow(overrides: Record<string, unknown>) {
  return {
    id: 'chunk-1',
    content: 'Chunk content',
    similarity: 0.8,
    metadata: {},
    tenant_id: null,
    global_book_id: null,
    tenant_book_id: null,
    source_type: 'unknown',
    ...overrides,
  };
}

describe('retrieveServerRagContext', () => {
  beforeEach(() => {
    generateEmbeddingMock.mockReset();
    searchChunksMock.mockReset();
    generateEmbeddingMock.mockResolvedValue([0.1, 0.2, 0.3]);
  });

  it('uses the authenticated tenant for the shared retrieval and returns only authorized cookbook sources', async () => {
    searchChunksMock.mockResolvedValue([
      matchRow({
        id: 'global-chunk',
        content: 'G'.repeat(4_100),
        source_type: 'global_pdf',
        global_book_id: 'global-book-1',
        metadata: { book_title: 'Global Cookbook', page_number: 12 },
      }),
      matchRow({
        id: 'tenant-chunk',
        content: 'T'.repeat(9_000),
        source_type: 'tenant_pdf',
        tenant_id: 'tenant-1',
        tenant_book_id: 'tenant-book-1',
        metadata: { book_title: 'Private Cookbook', page_number: 4 },
      }),
      matchRow({
        id: 'other-tenant-chunk',
        content: 'Must not appear',
        source_type: 'tenant_pdf',
        tenant_id: 'tenant-2',
        tenant_book_id: 'tenant-book-2',
      }),
      matchRow({
        id: 'ai-chunk',
        content: 'Must not appear',
        source_type: 'ai_generated',
        tenant_id: 'tenant-1',
        tenant_book_id: 'tenant-book-1',
      }),
    ]);

    const result = await retrieveServerRagContext({
      apiKey: 'test-api-key',
      tenantId: 'tenant-1',
      ingredients: ['tomate'],
      recipeName: 'Sopa de tomate',
      mealType: 'Cena',
      day: 'Lunes',
      restrictions: { allergies: ['maní'], dietaryRules: ['sin gluten'] },
    });

    expect(generateEmbeddingMock).toHaveBeenCalledWith(
      expect.stringContaining('Requested recipe: Sopa de tomate.')
    );
    expect(searchChunksMock).toHaveBeenCalledWith({
      embedding: [0.1, 0.2, 0.3],
      tenantId: 'tenant-1',
      matchThreshold: 0.35,
      matchCount: 6,
    });
    expect(result.ragContextUsed).toBe(true);
    expect(result.context).toContain('Libro: Global Cookbook · Página: 12');
    expect(result.context).toContain('Libro: Private Cookbook · Página: 4');
    expect(result.context).toContain('G'.repeat(4_000));
    expect(result.context).toContain('T'.repeat(4_000));
    expect(result.context).not.toContain('Must not appear');
    expect(result.citations).toEqual([
      {
        sourceType: 'global_pdf',
        globalBookId: 'global-book-1',
        title: 'Global Cookbook',
        pageNumber: 12,
        chunkId: 'global-chunk',
      },
      {
        sourceType: 'tenant_pdf',
        tenantBookId: 'tenant-book-1',
        tenantId: 'tenant-1',
        title: 'Private Cookbook',
        pageNumber: 4,
        chunkId: 'tenant-chunk',
      },
    ]);
  });

  it('bounds formatted context including headers while retaining citations for included chunks', async () => {
    searchChunksMock.mockResolvedValue(
      ['A', 'B', 'C'].map((content, index) =>
        matchRow({
          id: `global-chunk-${index + 1}`,
          content: content.repeat(4_000),
          source_type: 'global_pdf',
          global_book_id: `global-book-${index + 1}`,
          metadata: { book_title: `Cookbook ${index + 1}`, page_number: index + 1 },
        })
      )
    );

    const result = await retrieveServerRagContext({
      apiKey: 'test-api-key',
      tenantId: 'tenant-1',
      ingredients: ['tomate'],
      restrictions: { allergies: [], dietaryRules: [] },
    });

    expect(result.context.length).toBeLessThanOrEqual(12_000);
    expect(result.context).toContain('Libro: Cookbook 1 · Página: 1');
    expect(result.context).toContain('Libro: Cookbook 3 · Página: 3');
    expect(result.citations).toEqual([
      {
        sourceType: 'global_pdf',
        globalBookId: 'global-book-1',
        title: 'Cookbook 1',
        pageNumber: 1,
        chunkId: 'global-chunk-1',
      },
      {
        sourceType: 'global_pdf',
        globalBookId: 'global-book-2',
        title: 'Cookbook 2',
        pageNumber: 2,
        chunkId: 'global-chunk-2',
      },
      {
        sourceType: 'global_pdf',
        globalBookId: 'global-book-3',
        title: 'Cookbook 3',
        pageNumber: 3,
        chunkId: 'global-chunk-3',
      },
    ]);
  });
});
