import { JsonValue, PdfSourceType, RecipeBookChunkMetadata } from './types';

export type ExternalApiSuccess<T> = {
  data: T;
  error?: never;
};

export type ExternalApiError = Error | { message: string };

export type ExternalApiFailure = {
  data?: never;
  error: ExternalApiError;
};

export type ExternalApiResult<T> = ExternalApiSuccess<T> | ExternalApiFailure;

export type GeminiEmbeddingDto = {
  values: number[];
};

export type GeminiEmbedContentResponseDto = {
  embedding: GeminiEmbeddingDto;
};

export type GeminiBatchEmbedContentsResponseDto = {
  embeddings: GeminiEmbeddingDto[];
};

export type GeminiGenerateContentResponseDto = {
  candidates: Array<{
    content: {
      parts: GeminiGenerateContentPartDto[];
    };
  }>;
};

export type GeminiGenerateContentPartDto = {
  text?: string;
  [key: string]: unknown;
};

const MAX_GEMINI_TEXT_PARTS = 128;
const MAX_GEMINI_TEXT_CHARS = 100_000;

export type MatchChunksRpcArgsDto = {
  query_embedding: number[];
  match_threshold: number;
  match_count: number;
  filter_tenant_id: string | null;
};

export type MatchChunkRpcRowDto = {
  id?: string;
  tenant_id?: string | null;
  global_book_id?: string | null;
  tenant_book_id?: string | null;
  content: string;
  metadata?: JsonValue;
  source_type?: PdfSourceType;
  similarity?: number;
};

export type BookChunkInsertRowDto = {
  tenant_id: string | null;
  global_book_id: string | null;
  tenant_book_id: string | null;
  content: string;
  metadata: RecipeBookChunkMetadata;
  source_type: PdfSourceType;
  embedding?: number[];
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'number');
}

export function isGeminiEmbeddingDto(value: unknown): value is GeminiEmbeddingDto {
  return isRecord(value) && isNumberArray(value.values);
}

export function isGeminiEmbedContentResponseDto(
  value: unknown
): value is GeminiEmbedContentResponseDto {
  return isRecord(value) && isGeminiEmbeddingDto(value.embedding);
}

export function isGeminiBatchEmbedContentsResponseDto(
  value: unknown
): value is GeminiBatchEmbedContentsResponseDto {
  return (
    isRecord(value) &&
    Array.isArray(value.embeddings) &&
    value.embeddings.every(isGeminiEmbeddingDto)
  );
}

export function isGeminiGenerateContentResponseDto(
  value: unknown
): value is GeminiGenerateContentResponseDto {
  if (!isRecord(value) || !Array.isArray(value.candidates) || value.candidates.length === 0) {
    return false;
  }

  const candidates = value.candidates as unknown[];
  const candidate: unknown = candidates[0];
  return (() => {
    if (
      !isRecord(candidate) ||
      !isRecord(candidate.content) ||
      !Array.isArray(candidate.content.parts) ||
      candidate.content.parts.length === 0 ||
      candidate.content.parts.length > MAX_GEMINI_TEXT_PARTS
    ) {
      return false;
    }

    return candidate.content.parts.every(
      (part) => isRecord(part) && (!('text' in part) || typeof part.text === 'string')
    );
  })();
}

/**
 * Extract the first Gemini candidate's valid text parts in provider order.
 * Non-text parts (for example thought metadata) are ignored; a malformed text
 * field rejects the complete response instead of coercing untrusted data.
 */
export function extractGeminiTextResponse(value: unknown): string | null {
  if (!isGeminiGenerateContentResponseDto(value)) return null;

  const parts = value.candidates[0]?.content.parts ?? [];
  let totalCharacters = 0;
  const textParts: string[] = [];
  for (const part of parts) {
    if (!('text' in part)) continue;
    const text = part.text;
    if (typeof text !== 'string') return null;
    totalCharacters += text.length;
    if (totalCharacters > MAX_GEMINI_TEXT_CHARS) return null;
    if (text.length > 0) textParts.push(text);
  }

  const result = textParts.join('').trim();
  return result.length > 0 ? result : null;
}
