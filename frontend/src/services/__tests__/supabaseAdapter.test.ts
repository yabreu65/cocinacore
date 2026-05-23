import { describe, expect, it } from 'vitest';

import { MatchChunkRpcRowDto, MatchChunksRpcArgsDto } from '../apiDtos';
import { SupabaseAdapter, SupabaseClientLike } from '../supabaseAdapter';

function createSupabaseClient(rows: MatchChunkRpcRowDto[]): {
  client: SupabaseClientLike;
  calls: MatchChunksRpcArgsDto[];
} {
  const calls: MatchChunksRpcArgsDto[] = [];

  const from: SupabaseClientLike['from'] = ((tableName: 'book_chunks' | 'tenant_pdf_library') => {
    if (tableName === 'book_chunks') {
      return {
        async insert() {
          return { error: null };
        },
      };
    }

    return {
      eq() {
        return {
          async select() {
            return { count: 0, error: null };
          },
        };
      },
    };
  }) as SupabaseClientLike['from'];

  return {
    calls,
    client: {
      async rpc(functionName, args) {
        expect(functionName).toBe('match_chunks');
        calls.push(args);
        return { data: rows };
      },
      from,
    },
  };
}

describe('SupabaseAdapter', () => {
  it('passes typed RPC args including the tenant filter and maps rows to recipe chunks', async () => {
    const { client, calls } = createSupabaseClient([
      {
        id: 'chunk-1',
        tenant_id: 'tenant-a',
        tenant_book_id: 'book-a',
        global_book_id: null,
        content: 'Use the pan sauce technique.',
        metadata: { book_title: 'Tenant Cookbook', page_number: 12 },
        source_type: 'tenant_pdf',
        similarity: 0.91,
      },
    ]);
    const adapter = new SupabaseAdapter(client, {
      tenantId: 'tenant-a',
      role: 'member',
      tenantType: 'home',
    });

    const chunks = await adapter.searchChunks([0.1, 0.2, 0.3], {
      matchThreshold: 0.5,
      matchCount: 3,
    });

    expect(calls).toEqual([
      {
        query_embedding: [0.1, 0.2, 0.3],
        match_threshold: 0.5,
        match_count: 3,
        filter_tenant_id: 'tenant-a',
      },
    ]);
    expect(chunks).toEqual([
      {
        id: 'chunk-1',
        book_id: 'book-a',
        content: 'Use the pan sauce technique.',
        metadata: {
          book_title: 'Tenant Cookbook',
          page_number: 12,
          tenant_id: 'tenant-a',
          global_book_id: null,
          tenant_book_id: 'book-a',
          source_type: 'tenant_pdf',
        },
        sourceType: 'tenant_pdf',
        similarity: 0.91,
      },
    ]);
  });

  it('maps global rows without a tenant filter while preserving RLS-compatible metadata', async () => {
    const { client, calls } = createSupabaseClient([
      {
        id: 'chunk-global',
        tenant_id: null,
        tenant_book_id: null,
        global_book_id: 'global-book',
        content: 'Classic stock ratio.',
        metadata: { chapter: 'Stocks' },
        source_type: 'global_pdf',
        similarity: 0.75,
      },
    ]);
    const adapter = new SupabaseAdapter(client);

    const chunks = await adapter.searchChunks([1, 0, 0]);

    expect(calls[0]).toEqual({
      query_embedding: [1, 0, 0],
      match_threshold: 0.35,
      match_count: 5,
      filter_tenant_id: null,
    });
    expect(chunks[0]?.book_id).toBe('global-book');
    expect(chunks[0]?.metadata).toEqual({
      chapter: 'Stocks',
      tenant_id: null,
      global_book_id: 'global-book',
      tenant_book_id: null,
      source_type: 'global_pdf',
    });
    expect(chunks[0]?.sourceType).toBe('global_pdf');
  });

  it('denies cross-tenant private chunks even if an unexpected row leaks from RPC', async () => {
    const { client } = createSupabaseClient([
      {
        id: 'tenant-a-chunk',
        tenant_id: 'tenant-a',
        tenant_book_id: 'book-a',
        global_book_id: null,
        content: 'Allowed private chunk',
        metadata: {},
        source_type: 'tenant_pdf',
        similarity: 0.95,
      },
      {
        id: 'tenant-b-chunk',
        tenant_id: 'tenant-b',
        tenant_book_id: 'book-b',
        global_book_id: null,
        content: 'Leaked private chunk',
        metadata: {},
        source_type: 'tenant_pdf',
        similarity: 0.93,
      },
    ]);

    const adapter = new SupabaseAdapter(client, {
      tenantId: 'tenant-a',
      role: 'member',
      tenantType: 'home',
    });

    const chunks = await adapter.searchChunks([0.2, 0.4, 0.6]);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.id).toBe('tenant-a-chunk');
  });
});
