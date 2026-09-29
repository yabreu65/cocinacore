import type { Citation } from '@/services/types';

type DocumentarySourceType = 'global_pdf' | 'tenant_pdf';

export interface VisibleRecipeSource {
  sourceType: DocumentarySourceType;
  sourceId: string;
  label: 'Recetario global' | 'Mi recetario';
  title?: string;
  pageNumber?: number;
  chunkId?: string;
}

function getNonBlankTitle(title: string | undefined): string | undefined {
  const normalizedTitle = title?.trim();
  return normalizedTitle ? normalizedTitle : undefined;
}

function getValidPageNumber(pageNumber: number | undefined): number | undefined {
  return typeof pageNumber === 'number' && Number.isFinite(pageNumber) && pageNumber >= 1
    ? pageNumber
    : undefined;
}

function toVisibleRecipeSource(citation: Citation): VisibleRecipeSource | null {
  if (citation.sourceType === 'ai_generated') {
    return null;
  }

  const sourceId =
    citation.sourceType === 'global_pdf' ? citation.globalBookId : citation.tenantBookId;
  const title = getNonBlankTitle(citation.title);
  const pageNumber = getValidPageNumber(citation.pageNumber);

  return {
    sourceType: citation.sourceType,
    sourceId,
    label: citation.sourceType === 'global_pdf' ? 'Recetario global' : 'Mi recetario',
    ...(title ? { title } : {}),
    ...(pageNumber ? { pageNumber } : {}),
    ...(citation.chunkId !== undefined ? { chunkId: citation.chunkId } : {}),
  };
}

export function getVisibleRecipeSources(
  mode: 'free' | 'rag',
  ragContextUsed: boolean,
  sources: Citation[],
): VisibleRecipeSource[] {
  if (mode !== 'rag' || !ragContextUsed) {
    return [];
  }

  const sourcesByKey = new Map<string, VisibleRecipeSource>();

  for (const citation of sources) {
    const visibleSource = toVisibleRecipeSource(citation);

    if (!visibleSource) {
      continue;
    }

    const key = JSON.stringify([
      visibleSource.sourceType,
      visibleSource.sourceId,
      visibleSource.pageNumber ?? null,
      visibleSource.chunkId ?? null,
    ]);
    const existingSource = sourcesByKey.get(key);

    if (!existingSource) {
      sourcesByKey.set(key, visibleSource);
    } else if (!existingSource.title && visibleSource.title) {
      sourcesByKey.set(key, { ...existingSource, title: visibleSource.title });
    }
  }

  return [...sourcesByKey.values()];
}
