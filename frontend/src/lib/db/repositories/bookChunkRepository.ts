import { query, scopedTransaction, type DbOperationOptions } from '@/lib/db';
import { BookChunkRow } from '@/lib/db/types';

export interface SearchChunksInput {
  embedding: number[];
  tenantId: string;
  userId: string;
  matchThreshold?: number;
  matchCount?: number;
  statementTimeoutMs: number;
  signal?: AbortSignal;
  deadlineAt?: number;
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

  if (!input.tenantId || !input.userId) throw new Error('Authenticated RAG scope required.');
  if (!Number.isSafeInteger(input.statementTimeoutMs) || input.statementTimeoutMs <= 0)
    throw new Error('Statement timeout must be a positive safe integer.');
  const sql = `select bc.id, bc.content, 1 - (bc.embedding <=> $1::vector(1536)) as similarity,
       bc.metadata, bc.tenant_id, bc.global_book_id, bc.tenant_book_id, bc.source_type
     from public.book_chunks bc
     where (
       (bc.source_type = 'global_pdf' and bc.tenant_id is null and bc.global_book_id is not null
        and bc.tenant_book_id is null and exists (select 1 from public.global_books gb where gb.id = bc.global_book_id))
       or (bc.source_type = 'tenant_pdf' and bc.tenant_id = $4::uuid and bc.global_book_id is null
        and bc.tenant_book_id is not null and exists (select 1 from public.tenant_books tb where tb.id = bc.tenant_book_id and tb.tenant_id = $4::uuid))
     ) and 1 - (bc.embedding <=> $1::vector(1536)) > $2
     order by bc.embedding <=> $1::vector(1536)
     limit $3`;
  const params = [JSON.stringify(input.embedding), threshold, count, input.tenantId];
  const options = {
    signal: input.signal,
    deadlineAt: input.deadlineAt,
  } satisfies DbOperationOptions;
  const result = await scopedTransaction(
    { tenantId: input.tenantId, userId: input.userId },
    async (client) => {
      await client.query("select set_config('statement_timeout', $1, true)", [
        `${input.statementTimeoutMs}ms`,
      ]);
      await client.query("select set_config('lock_timeout', $1, true)", [
        `${input.statementTimeoutMs}ms`,
      ]);
      return client.query<MatchChunkResult>(sql, params);
    },
    options
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
