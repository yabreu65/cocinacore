import { describe, expect, it } from 'vitest';
import type { Citation } from '@/services/types';
import { getVisibleRecipeSources } from './source-citations';

const globalCitation: Citation = {
  sourceType: 'global_pdf',
  globalBookId: 'global-book-1',
  title: 'Cocina regional',
  pageNumber: 12,
  chunkId: 'chunk-1',
};

const tenantCitation: Citation = {
  sourceType: 'tenant_pdf',
  tenantBookId: 'tenant-book-1',
  tenantId: 'tenant-1',
  title: 'Recetas de casa',
  pageNumber: 4,
  chunkId: 'chunk-2',
};

describe('getVisibleRecipeSources', () => {
  it('maps global and tenant citations with their human labels, titles, and pages', () => {
    expect(getVisibleRecipeSources('rag', true, [globalCitation, tenantCitation])).toEqual([
      {
        sourceType: 'global_pdf',
        sourceId: 'global-book-1',
        label: 'Recetario global',
        title: 'Cocina regional',
        pageNumber: 12,
        chunkId: 'chunk-1',
      },
      {
        sourceType: 'tenant_pdf',
        sourceId: 'tenant-book-1',
        label: 'Mi recetario',
        title: 'Recetas de casa',
        pageNumber: 4,
        chunkId: 'chunk-2',
      },
    ]);
  });

  it('omits blank titles and invalid pages while retaining the neutral source label', () => {
    const sources = getVisibleRecipeSources('rag', true, [
      { ...globalCitation, title: '   ', pageNumber: Number.NaN },
    ]);

    expect(sources).toEqual([
      {
        sourceType: 'global_pdf',
        sourceId: 'global-book-1',
        label: 'Recetario global',
        chunkId: 'chunk-1',
      },
    ]);
  });

  it('returns no sources outside RAG mode or when RAG context was not used', () => {
    expect(getVisibleRecipeSources('free', true, [globalCitation])).toEqual([]);
    expect(getVisibleRecipeSources('rag', false, [globalCitation])).toEqual([]);
  });

  it('excludes AI-generated citations from documentary cards', () => {
    const aiGenerated: Citation = {
      sourceType: 'ai_generated',
      title: 'Gemini recipe',
      pageNumber: 1,
      chunkId: 'ai-1',
    };

    expect(getVisibleRecipeSources('rag', true, [aiGenerated])).toEqual([]);
  });

  it('deduplicates identical documentary citations', () => {
    expect(getVisibleRecipeSources('rag', true, [globalCitation, { ...globalCitation }])).toHaveLength(
      1,
    );
  });

  it('retains citations from distinct pages and chunks', () => {
    const sources = getVisibleRecipeSources('rag', true, [
      globalCitation,
      { ...globalCitation, pageNumber: 13 },
      { ...globalCitation, chunkId: 'chunk-3' },
    ]);

    expect(sources).toHaveLength(3);
  });

  it('prefers a nonblank title when duplicate citations differ only by title', () => {
    const sources = getVisibleRecipeSources('rag', true, [
      { ...globalCitation, title: ' ' },
      globalCitation,
    ]);

    expect(sources[0]?.title).toBe('Cocina regional');
  });
});
