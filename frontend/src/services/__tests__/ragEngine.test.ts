import { describe, expect, it, vi } from 'vitest';

import { PdfUploadLimitError, RagEngine, TrialSoftBlockError } from '../ragEngine';
import {
  EmbeddingService,
  PdfChunkerService,
  RecipeGenerationService,
  SemanticSearchService,
  TrialState,
} from '../types';

interface EngineHarness {
  engine: RagEngine;
  searchChunks: SemanticSearchService['searchChunks'];
  getSearchCalls: () => Array<{ embedding: number[]; matchCount?: number }>;
  getEmbeddingQueries: () => string[];
  saveChunks: SemanticSearchService['saveChunks'];
  getSaveCallCount: () => number;
  chunkPdfText: ReturnType<typeof vi.fn>;
}

function createEngineHarness(existingPdfCount = 0): EngineHarness {
  const chunkPdfText = vi.fn<PdfChunkerService['chunkPdfText']>((text, metadata) => [
    {
      book_id: metadata.book_id,
      content: text,
      metadata: { book_title: metadata.book_title },
    },
  ]);

  const chunker: PdfChunkerService = { chunkPdfText };

  const embeddingQueries: string[] = [];
  const embedder: EmbeddingService = {
    async generateEmbedding(text: string) {
      embeddingQueries.push(text);
      return [0.1, 0.2, 0.3];
    },
    async generateEmbeddings(texts: string[]) {
      return texts.map(() => [0.1, 0.2, 0.3]);
    },
  };

  const generator: RecipeGenerationService = {
    async generateRecipe() {
      return 'Recipe output';
    },
  };

  const searchCalls: Array<{ embedding: number[]; matchCount?: number }> = [];
  let saveCallCount = 0;

  const searchChunks: SemanticSearchService['searchChunks'] = async (embedding, options) => {
    searchCalls.push({ embedding, matchCount: options?.matchCount });
    return [];
  };

  const saveChunks: SemanticSearchService['saveChunks'] = async () => {
    saveCallCount += 1;
  };

  const dbAdapter: SemanticSearchService = {
    searchChunks,
    saveChunks,
    async getTenantPdfCount() {
      return existingPdfCount;
    },
  };

  return {
    engine: new RagEngine({ chunker, embedder, generator, dbAdapter }),
    searchChunks,
    getSearchCalls: () => searchCalls,
    saveChunks,
    getSaveCallCount: () => saveCallCount,
    chunkPdfText,
    getEmbeddingQueries: () => embeddingQueries,
  };
}

function createExpiredTrialState(): TrialState {
  return {
    startedAt: '2026-04-01T00:00:00.000Z',
    endsAt: '2026-05-01T00:00:00.000Z',
    softBlockedAt: '2026-05-02T00:00:00.000Z',
    isExpired: true,
    canGenerate: false,
    canUploadPdf: false,
  };
}

describe('RagEngine trial gating', () => {
  it('returns citations derived from retrieved chunk source metadata', async () => {
    const chunker: PdfChunkerService = {
      chunkPdfText: vi.fn(() => []),
    };
    const embedder: EmbeddingService = {
      async generateEmbedding() {
        return [0.1, 0.2, 0.3];
      },
      async generateEmbeddings() {
        return [];
      },
    };
    const generator: RecipeGenerationService = {
      async generateRecipe() {
        return 'Recipe output';
      },
    };
    const dbAdapter: SemanticSearchService = {
      async searchChunks() {
        return [
          {
            id: 'chunk-1',
            book_id: 'global-book-1',
            content: 'Sauce base',
            sourceType: 'global_pdf',
            metadata: {
              global_book_id: 'global-book-1',
              book_title: 'Global Sauces',
              page_number: 9,
            },
          },
        ];
      },
      async saveChunks() {
        return;
      },
    };

    const engine = new RagEngine({ chunker, embedder, generator, dbAdapter });
    const result = await engine.generateRecipeFromFridge({ ingredients: ['tomato'] });

    expect(result.citations).toEqual([
      {
        sourceType: 'global_pdf',
        globalBookId: 'global-book-1',
        title: 'Global Sauces',
        pageNumber: 9,
        chunkId: 'chunk-1',
      },
    ]);
  });

  it('keeps read/search access allowed when trial is expired', async () => {
    const { engine, searchChunks, getSearchCalls } = createEngineHarness();
    const expiredTrial = createExpiredTrialState();

    await expect(
      engine.generateRecipeFromFridge({ ingredients: ['tomato'] }, {
        trialState: expiredTrial,
      })
    ).rejects.toThrow(TrialSoftBlockError);

    await expect(searchChunks([0.9, 0.1, 0.4], { matchCount: 2 })).resolves.toEqual([]);
    expect(getSearchCalls()).toEqual([{ embedding: [0.9, 0.1, 0.4], matchCount: 2 }]);
  });

  it('blocks upload/generate actions when trial is expired', async () => {
    const { engine, getSaveCallCount, chunkPdfText } = createEngineHarness();
    const expiredTrial = createExpiredTrialState();

    await expect(
      engine.ingestCookbookText('Chunk text', { book_id: 'book-1' }, { trialState: expiredTrial })
    ).rejects.toThrow('Trial expired: cannot upload PDFs.');

    await expect(
      engine.generateRecipeFromFridge({ ingredients: ['garlic'] }, { trialState: expiredTrial })
    ).rejects.toThrow('Trial expired: cannot generate recipes.');

    expect(chunkPdfText).not.toHaveBeenCalled();
    expect(getSaveCallCount()).toBe(0);
  });

  it('blocks Home tenant uploads at the 5 PDF limit before storing chunks', async () => {
    const { engine, getSaveCallCount, chunkPdfText } = createEngineHarness(5);

    await expect(
      engine.ingestCookbookText(
        'Chunk text',
        { book_id: 'book-1' },
        { tenantContext: { tenantId: 'tenant-home', role: 'member', tenantType: 'home' } }
      )
    ).rejects.toThrow(PdfUploadLimitError);

    expect(chunkPdfText).not.toHaveBeenCalled();
    expect(getSaveCallCount()).toBe(0);
  });

  it('allows Professional tenant upload under the 15 PDF limit', async () => {
    const { engine, getSaveCallCount } = createEngineHarness(14);

    await expect(
      engine.ingestCookbookText(
        'Chunk text',
        { book_id: 'book-1' },
        { tenantContext: { tenantId: 'tenant-pro', role: 'member', tenantType: 'professional' } }
      )
    ).resolves.toBe(1);

    expect(getSaveCallCount()).toBe(1);
  });

  it('uses profile allergy defaults when no override is provided', async () => {
    const { engine, getEmbeddingQueries } = createEngineHarness();

    await expect(
      engine.generateRecipeFromFridge({
        ingredients: ['tomate'],
        restrictionProfile: { allergies: ['maní'], dietaryRules: ['sin gluten'] },
      })
    ).resolves.toMatchObject({ recipe: 'Recipe output' });

    expect(getEmbeddingQueries()[0]).toContain('Avoid allergens: maní.');
    expect(getEmbeddingQueries()[0]).toContain('Respect dietary rules: sin gluten.');
  });

  it('uses override allergies when provided for a search', async () => {
    const { engine, getEmbeddingQueries } = createEngineHarness();

    await expect(
      engine.generateRecipeFromFridge({
        ingredients: ['tomate'],
        restrictionProfile: { allergies: ['maní'], dietaryRules: ['sin gluten'] },
        overrideRestrictions: { allergies: ['mariscos'] },
      })
    ).resolves.toMatchObject({ recipe: 'Recipe output' });

    expect(getEmbeddingQueries()[0]).toContain('Avoid allergens: mariscos.');
    expect(getEmbeddingQueries()[0]).not.toContain('Avoid allergens: maní.');
  });

  it('supports recipe search when inventory is empty', async () => {
    const { engine, getEmbeddingQueries } = createEngineHarness();

    await expect(
      engine.generateRecipeFromFridge({
        ingredients: [],
        restrictionProfile: { allergies: [], dietaryRules: [] },
      })
    ).resolves.toMatchObject({ recipe: 'Recipe output' });

    expect(getEmbeddingQueries()[0]).toContain(
      'No inventory ingredients were provided. Return versatile recipes using common pantry assumptions.'
    );
  });
});
