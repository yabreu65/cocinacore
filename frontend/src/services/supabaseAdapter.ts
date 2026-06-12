import {
  BookChunkInsertRowDto,
  ExternalApiError,
  ExternalApiResult,
  MatchChunkRpcRowDto,
  MatchChunksRpcArgsDto,
} from './apiDtos';
import {
  JsonValue,
  PdfSourceType,
  RecipeBookChunk,
  RecipeBookChunkMetadata,
  SemanticSearchService,
  TenantContext,
} from './types';
import { serverLogger } from '@/lib/serverLogger';

type SupabaseResult<T> = Promise<ExternalApiResult<T | null>>;

export type SupabaseBookChunksTable = {
  insert(rows: BookChunkInsertRowDto[]): Promise<{ error: ExternalApiError | null }>;
};

type SupabaseTenantPdfLibrarySelectBuilder = {
  eq(
    column: 'tenant_id',
    value: string
  ): {
    select(
      columns: '*',
      options: { count: 'exact'; head: true }
    ): Promise<{ count: number | null; error: ExternalApiError | null }>;
  };
};

export type SupabaseClientLike = {
  rpc(
    functionName: 'match_chunks',
    args: MatchChunksRpcArgsDto
  ): SupabaseResult<MatchChunkRpcRowDto[]>;
  from(tableName: 'book_chunks'): SupabaseBookChunksTable;
  from(tableName: 'tenant_pdf_library'): SupabaseTenantPdfLibrarySelectBuilder;
};

function isJsonObject(value: JsonValue | undefined): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toRecipeMetadata(row: MatchChunkRpcRowDto): RecipeBookChunkMetadata {
  return {
    ...(isJsonObject(row.metadata) ? row.metadata : {}),
    tenant_id: row.tenant_id ?? null,
    global_book_id: row.global_book_id ?? null,
    tenant_book_id: row.tenant_book_id ?? null,
    source_type: row.source_type,
  };
}

function inferSourceType(
  chunk: RecipeBookChunk,
  tenantContext: TenantContext | null
): PdfSourceType {
  if (chunk.sourceType) {
    return chunk.sourceType;
  }

  if (chunk.metadata.source_type) {
    return chunk.metadata.source_type;
  }

  if (chunk.metadata.global_book_id || (!tenantContext && chunk.book_id)) {
    return 'global_pdf';
  }

  if (chunk.metadata.tenant_book_id || (tenantContext && chunk.book_id)) {
    return 'tenant_pdf';
  }

  return 'ai_generated';
}

export class SupabaseAdapter implements SemanticSearchService {
  private supabase: SupabaseClientLike;
  private tenantContext: TenantContext | null;

  /**
   * Inject the Supabase client instance and the tenant ID for isolation.
   * By passing the client, all RLS rules are naturally preserved because the
   * client holds the user's authenticating JWT session headers automatically.
   */
  constructor(supabaseClient: SupabaseClientLike, tenantContext: TenantContext | null = null) {
    if (!supabaseClient) {
      throw new Error('SupabaseAdapter: A valid Supabase client instance is required.');
    }
    this.supabase = supabaseClient;
    this.tenantContext = tenantContext;
  }

  /**
   * Executes a semantic vector search by calling the Supabase `match_chunks` RPC function.
   * Preserves security as Supabase RLS will filter rows based on the user's active session.
   */
  public async searchChunks(
    embedding: number[],
    options: {
      matchThreshold?: number;
      matchCount?: number;
      bookIds?: string[];
    } = {}
  ): Promise<RecipeBookChunk[]> {
    const threshold = options.matchThreshold ?? 0.35;
    const count = options.matchCount ?? 5;

    try {
      // Call Supabase RPC. Supabase client carries the user session token automatically, protecting RLS.
      const { data, error } = await this.supabase.rpc('match_chunks', {
        query_embedding: embedding,
        match_threshold: threshold,
        match_count: count,
        filter_tenant_id: this.tenantContext?.tenantId ?? null,
      });

      if (error) {
        throw error;
      }

      if (!data) {
        return [];
      }

      const filteredRows = this.tenantContext
        ? data.filter(
            (row) => row.tenant_id === null || row.tenant_id === this.tenantContext?.tenantId
          )
        : data;

      // Map Supabase results to RecipeBookChunk shape
      return filteredRows.map((row) => ({
        id: row.id,
        book_id: row.global_book_id ?? row.tenant_book_id ?? '',
        content: row.content,
        metadata: toRecipeMetadata(row),
        sourceType: row.source_type,
        similarity: row.similarity,
      }));
    } catch (error) {
      serverLogger.error('supabase_adapter.search_failed', { error: String(error) });
      throw error;
    }
  }

  public async getTenantPdfCount(): Promise<number> {
    if (!this.tenantContext) {
      return 0;
    }

    const { count, error } = await this.supabase
      .from('tenant_pdf_library')
      .eq('tenant_id', this.tenantContext.tenantId)
      .select('*', { count: 'exact', head: true });

    if (error) {
      throw error;
    }

    return count ?? 0;
  }

  /**
   * Saves chunks with their vector embeddings to the Supabase database.
   * Relies on standard client RLS policies for inserts.
   */
  public async saveChunks(chunks: RecipeBookChunk[]): Promise<void> {
    if (!chunks || chunks.length === 0) {
      return;
    }

    try {
      // Map data structure for database table `book_chunks`
      const dbRows = chunks.map(
        (chunk): BookChunkInsertRowDto => ({
          tenant_id: this.tenantContext?.tenantId ?? null,
          global_book_id:
            chunk.metadata.global_book_id ?? (!this.tenantContext ? chunk.book_id : null),
          tenant_book_id:
            chunk.metadata.tenant_book_id ?? (this.tenantContext ? chunk.book_id : null),
          content: chunk.content,
          metadata: chunk.metadata,
          source_type: inferSourceType(chunk, this.tenantContext),
          embedding: chunk.embedding,
        })
      );

      // Perform a bulk insert.
      const { error } = await this.supabase.from('book_chunks').insert(dbRows);

      if (error) {
        throw error;
      }
    } catch (error) {
      serverLogger.error('supabase_adapter.save_chunks_failed', { error: String(error) });
      throw error;
    }
  }
}
