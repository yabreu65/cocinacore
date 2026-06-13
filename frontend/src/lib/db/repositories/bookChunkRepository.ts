import { query } from '@/lib/db';
import { BookChunkRow } from '@/lib/db/types';

export interface SearchChunksInput {
  embedding: number[];
  tenantId?: string | null;
  matchThreshold?: number;
  matchCount?: number;
}

export interface MatchChunkResult {
  id: string;
  content: string;
  similarity: number;
  metadata: unknown;
  tenant_id: string | null;
  global_book_id: string | null;
  tenant_book_id: string | null;
  source_type: string;
}

export async function searchChunks(input: SearchChunksInput): Promise<MatchChunkResult[]> {
  const threshold = input.matchThreshold ?? 0.35;
  const count = input.matchCount ?? 5;

  const result = await query<MatchChunkResult>(
    'select * from public.match_chunks($1::vector(1536), $2, $3, $4)',
    [JSON.stringify(input.embedding), threshold, count, input.tenantId ?? null]
  );

  return result.rows;
}

export interface CreateBookChunkInput {
  tenantId?: string | null;
  globalBookId?: string | null;
  tenantBookId?: string | null;
  sourceType: 'global_pdf' | 'tenant_pdf' | 'ai_generated';
  content: string;
  metadata?: unknown;
  embedding: number[];
}

export async function createBookChunk(input: CreateBookChunkInput): Promise<BookChunkRow> {
  const result = await query<BookChunkRow>(
    `insert into public.book_chunks
     (tenant_id, global_book_id, tenant_book_id, source_type, content, metadata, embedding)
     values ($1, $2, $3, $4, $5, $6, $7::vector(1536))
     returning *`,
    [
      input.tenantId ?? null,
      input.globalBookId ?? null,
      input.tenantBookId ?? null,
      input.sourceType,
      input.content,
      JSON.stringify(input.metadata ?? {}),
      JSON.stringify(input.embedding),
    ]
  );

  const chunk = result.rows[0] ?? null;
  if (!chunk) throw new Error('Failed to create book chunk');
  return chunk;
}

export async function createBookChunks(inputs: CreateBookChunkInput[]): Promise<BookChunkRow[]> {
  const chunks: BookChunkRow[] = [];
  for (const input of inputs) {
    chunks.push(await createBookChunk(input));
  }
  return chunks;
}
