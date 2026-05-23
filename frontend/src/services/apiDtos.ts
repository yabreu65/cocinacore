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
      parts: Array<{
        text: string;
      }>;
    };
  }>;
};

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

export function isGeminiEmbedContentResponseDto(value: unknown): value is GeminiEmbedContentResponseDto {
  return isRecord(value) && isGeminiEmbeddingDto(value.embedding);
}

export function isGeminiBatchEmbedContentsResponseDto(value: unknown): value is GeminiBatchEmbedContentsResponseDto {
  return isRecord(value) && Array.isArray(value.embeddings) && value.embeddings.every(isGeminiEmbeddingDto);
}

export function isGeminiGenerateContentResponseDto(value: unknown): value is GeminiGenerateContentResponseDto {
  if (!isRecord(value) || !Array.isArray(value.candidates)) {
    return false;
  }

  return value.candidates.every((candidate) => {
    if (!isRecord(candidate) || !isRecord(candidate.content) || !Array.isArray(candidate.content.parts)) {
      return false;
    }

    return candidate.content.parts.every((part) => isRecord(part) && typeof part.text === 'string');
  });
}
