import { searchChunks, type MatchChunkResult } from '@/lib/db/repositories/bookChunkRepository';
import { GeminiEmbeddingService } from '@/services/gemini';
import {
  RAG_MAX_CONTEXT_CONTENT_CHARS,
  retrieveRecipeContext,
  toCitation,
} from '@/services/ragEngine';
import type { Citation, RecipeBookChunk, RecipeSearchInput, RestrictionProfile } from '@/services/types';

export interface ServerRagContextInput {
  apiKey: string;
  tenantId: string;
  ingredients: string[];
  recipeName?: string;
  mealType?: string;
  day?: string;
  restrictions: RestrictionProfile;
}

export interface ServerRagContext {
  context: string;
  citations: Citation[];
  ragContextUsed: boolean;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function readMetadata(row: MatchChunkResult): { bookTitle?: string; pageNumber?: number } {
  if (!row.metadata || typeof row.metadata !== 'object' || Array.isArray(row.metadata)) {
    return {};
  }

  const metadata = row.metadata as Record<string, unknown>;
  return {
    bookTitle: isNonEmptyString(metadata.book_title) ? metadata.book_title : undefined,
    pageNumber:
      typeof metadata.page_number === 'number' &&
      Number.isFinite(metadata.page_number) &&
      metadata.page_number >= 1
        ? metadata.page_number
        : undefined,
  };
}

function adaptMatchChunk(row: MatchChunkResult, tenantId: string): RecipeBookChunk | null {
  if (!isNonEmptyString(row.id) || !isNonEmptyString(row.content)) {
    return null;
  }

  const { bookTitle, pageNumber } = readMetadata(row);

  if (
    row.source_type === 'global_pdf' &&
    row.tenant_id === null &&
    isNonEmptyString(row.global_book_id)
  ) {
    return {
      id: row.id,
      book_id: row.global_book_id,
      content: row.content,
      sourceType: 'global_pdf',
      metadata: {
        source_type: 'global_pdf',
        global_book_id: row.global_book_id,
        tenant_id: null,
        ...(bookTitle ? { book_title: bookTitle } : {}),
        ...(pageNumber ? { page_number: pageNumber } : {}),
      },
      similarity: row.similarity,
    };
  }

  if (
    row.source_type === 'tenant_pdf' &&
    row.tenant_id === tenantId &&
    isNonEmptyString(row.tenant_book_id)
  ) {
    return {
      id: row.id,
      book_id: row.tenant_book_id,
      content: row.content,
      sourceType: 'tenant_pdf',
      metadata: {
        source_type: 'tenant_pdf',
        tenant_id: tenantId,
        tenant_book_id: row.tenant_book_id,
        ...(bookTitle ? { book_title: bookTitle } : {}),
        ...(pageNumber ? { page_number: pageNumber } : {}),
      },
      similarity: row.similarity,
    };
  }

  return null;
}

function formatCookbookContext(chunks: RecipeBookChunk[]): {
  context: string;
  includedChunks: RecipeBookChunk[];
} {
  let remainingChars = RAG_MAX_CONTEXT_CONTENT_CHARS;
  let context = '';
  const includedChunks: RecipeBookChunk[] = [];

  for (const [index, chunk] of chunks.entries()) {
    const title = chunk.metadata.book_title;
    const pageNumber = chunk.metadata.page_number;
    const source = [title ? `Libro: ${title}` : '', pageNumber ? `Página: ${pageNumber}` : '']
      .filter(Boolean)
      .join(' · ');
    const prefix = `${context ? '\n\n' : ''}--- CONTEXTO DE RECETARIO CONFIABLE ${index + 1}${source ? ` (${source})` : ''} ---\n`;

    if (prefix.length >= remainingChars) {
      continue;
    }

    const content = chunk.content.slice(0, remainingChars - prefix.length);
    if (!content) {
      break;
    }

    context += `${prefix}${content}`;
    remainingChars -= prefix.length + content.length;
    includedChunks.push(chunk);
  }

  return { context, includedChunks };
}

export async function retrieveServerRagContext(input: ServerRagContextInput): Promise<ServerRagContext> {
  const searchInput: RecipeSearchInput = {
    ingredients: input.ingredients,
    recipeName: input.recipeName,
    mealType: input.mealType,
    day: input.day,
    restrictionProfile: input.restrictions,
  };
  const embedder = new GeminiEmbeddingService(input.apiKey);
  const retrievedContext = await retrieveRecipeContext(
    searchInput,
    {
      embedder,
      dbAdapter: {
        async searchChunks(embedding, options) {
          const rows = await searchChunks({
            embedding,
            tenantId: input.tenantId,
            matchThreshold: options?.matchThreshold,
            matchCount: options?.matchCount,
          });
          return rows
            .map((row) => adaptMatchChunk(row, input.tenantId))
            .filter((chunk): chunk is RecipeBookChunk => chunk !== null);
        },
      },
    }
  );

  const formattedContext = formatCookbookContext(retrievedContext.chunks);

  return {
    context: formattedContext.context,
    citations: formattedContext.includedChunks.map(toCitation),
    ragContextUsed: formattedContext.includedChunks.length > 0,
  };
}
