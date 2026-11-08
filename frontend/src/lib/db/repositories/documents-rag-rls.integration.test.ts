import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { getPool } from '@/lib/db';
import { searchChunks } from './bookChunkRepository';

const enabled = process.env.COCINACORE_DOCUMENTS_RAG_RLS_TEST === '1';
const tenantA = '99100000-0000-4000-8000-000000000001';
const tenantB = '99100000-0000-4000-8000-000000000002';
const userA1 = '99100000-0000-4000-8000-000000000003';
const userA2 = '99100000-0000-4000-8000-000000000004';
const userB1 = '99100000-0000-4000-8000-000000000005';
const tenantBookA = '99200000-0000-4000-8000-000000000001';
const tenantBookB = '99200000-0000-4000-8000-000000000002';
const globalBook = '99200000-0000-4000-8000-000000000003';
const pdfA = '99200000-0000-4000-8000-000000000010';
const pdfB = '99200000-0000-4000-8000-000000000011';
const inconsistentPdf = '99200000-0000-4000-8000-000000000012';
const pdfForDelete = '99200000-0000-4000-8000-000000000014';
const chunkA = '99200000-0000-4000-8000-000000000030';
const chunkB = '99200000-0000-4000-8000-000000000031';
const globalChunk = '99200000-0000-4000-8000-000000000032';
const spoofedGlobalChunk = '99200000-0000-4000-8000-000000000033';
const crossParentChunk = '99200000-0000-4000-8000-000000000034';
const aiGeneratedChunk = '99200000-0000-4000-8000-000000000035';
const orphanPrivateChunk = '99200000-0000-4000-8000-000000000036';
const orphanGlobalChunk = '99200000-0000-4000-8000-000000000037';
type Scope = { tenantId: string; userId: string };
const a1: Scope = { tenantId: tenantA, userId: userA1 };
const a2: Scope = { tenantId: tenantA, userId: userA2 };
const b1: Scope = { tenantId: tenantB, userId: userB1 };

let admin: Pool;
let runtime: Pool;
let globalWriter: Pool;
let userWithoutMembership: string;
let deleteBookId: string;
let rankedChunkA: string;
let rankedChunkB: string;
let rankedGlobalChunk: string;

function unitVector(first: number): number[] {
  return [first, Math.sqrt(1 - first * first), ...Array<number>(1534).fill(0)];
}

function disposableUrl(value: string | undefined, username: string): URL {
  const url = new URL(value ?? '');
  if (
    url.hostname !== '127.0.0.1' ||
    url.pathname !== '/signup_real_disposable' ||
    url.username !== username
  )
    throw new Error('Restricted loopback PostgreSQL disposable required');
  return url;
}

async function inContext<T>(
  scope: Scope | null,
  operation: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await runtime.connect();
  try {
    await client.query('begin');
    if (scope) {
      await client.query(
        "select set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)",
        [scope.tenantId, scope.userId]
      );
    }
    const result = await operation(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

describe.skipIf(!enabled)('020D3 document and RAG FORCE RLS on disposable PostgreSQL', () => {
  beforeAll(async () => {
    const adminUrl = disposableUrl(process.env.SIGNUP_TEST_ADMIN_URL, 'postgres');
    const runtimeUrl = disposableUrl(process.env.DATABASE_URL, 'cocinacore_runtime_rls');
    const writerUrl = disposableUrl(
      process.env.OWNER_GLOBAL_WRITER_DATABASE_URL,
      'cocinacore_global_writer'
    );
    if (adminUrl.host !== runtimeUrl.host || adminUrl.host !== writerUrl.host)
      throw new Error('All SQL identities must target the same disposable PostgreSQL instance');
    admin = new Pool({ connectionString: adminUrl.toString(), max: 2 });
    runtime = new Pool({ connectionString: runtimeUrl.toString(), max: 1 });
    globalWriter = new Pool({ connectionString: writerUrl.toString(), max: 1 });

    const marker = await admin.query<{ marker: string }>(
      "select shobj_description(oid,'pg_database') marker from pg_database where datname=current_database()"
    );
    expect(marker.rows[0]?.marker).toBe('cocinacore-signup-real-disposable');
    const flags = await runtime.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      "select relname, relrowsecurity, relforcerowsecurity from pg_class where oid = any(array['public.tenant_books'::regclass,'public.tenant_pdf_library'::regclass,'public.book_chunks'::regclass]) order by relname"
    );
    expect(flags.rows).toEqual([
      { relname: 'book_chunks', relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'tenant_books', relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'tenant_pdf_library', relrowsecurity: true, relforcerowsecurity: true },
    ]);
    const role = await runtime.query<{
      current_user: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>('select current_user, rolsuper, rolbypassrls from pg_roles where rolname = current_user');
    expect(role.rows[0]).toEqual({
      current_user: 'cocinacore_runtime_rls',
      rolsuper: false,
      rolbypassrls: false,
    });

    userWithoutMembership = randomUUID();
    await admin.query(
      'insert into public.users(id, tenant_id, email, password_hash, role) values ($1, $2, $3, $4, $5)',
      [userWithoutMembership, tenantA, userWithoutMembership + '@example.test', 'fixture', 'member']
    );
    rankedChunkA = randomUUID();
    rankedChunkB = randomUUID();
    rankedGlobalChunk = randomUUID();
    await admin.query(
      "insert into public.book_chunks(id,tenant_id,global_book_id,tenant_book_id,source_type,content,metadata,embedding) values ($1,$2,null,$3,'tenant_pdf','ranked private A','{\"scope\":\"A\"}',$4::vector(1536)),($5,$6,null,$7,'tenant_pdf','ranked private B','{\"scope\":\"B\"}',$8::vector(1536)),($9,null,$10,null,'global_pdf','ranked global','{\"scope\":\"global\"}',$11::vector(1536))",
      [
        rankedChunkA,
        tenantA,
        tenantBookA,
        JSON.stringify(unitVector(0.99)),
        rankedChunkB,
        tenantB,
        tenantBookB,
        JSON.stringify(unitVector(1)),
        rankedGlobalChunk,
        globalBook,
        JSON.stringify(unitVector(0.98)),
      ]
    );
    deleteBookId = randomUUID();
    await admin.query('insert into public.tenant_books(id, tenant_id, title) values ($1, $2, $3)', [
      deleteBookId,
      tenantA,
      'Disposable delete-only book',
    ]);
  });

  afterAll(async () => {
    await Promise.all([globalWriter?.end(), runtime?.end(), admin?.end(), getPool().end()]);
  });

  it('isolates unfiltered private books and PDF metadata while sharing within the tenant', async () => {
    for (const scope of [a1, a2]) {
      const result = await inContext(scope, async (client) => ({
        books: await client.query<{ id: string; description: string | null }>(
          'select id, description from public.tenant_books order by id'
        ),
        pdfs: await client.query<{ id: string; storage_path: string }>(
          'select id, storage_path from public.tenant_pdf_library order by id'
        ),
      }));
      expect(result.books.rows.map((row) => row.id)).toHaveLength(2);
      expect(result.books.rows.map((row) => row.id)).toEqual(
        expect.arrayContaining([tenantBookA, deleteBookId])
      );
      expect(result.books.rows.find((row) => row.id === tenantBookA)?.description).toBe(
        'Private A metadata'
      );
      expect(result.pdfs.rows.map((row) => row.id)).toEqual([pdfA, pdfForDelete]);
      expect(result.pdfs.rows.map((row) => row.storage_path)).not.toContain(
        'tenant-a/cross-tenant-parent.pdf'
      );
    }
    const booksB = await inContext(b1, (client) =>
      client.query<{ id: string }>('select id from public.tenant_books order by id')
    );
    const pdfsB = await inContext(b1, (client) =>
      client.query<{ id: string }>('select id from public.tenant_pdf_library order by id')
    );
    expect(booksB.rows.map((row) => row.id)).toEqual([tenantBookB]);
    expect(pdfsB.rows.map((row) => row.id)).toEqual([pdfB]);
  });

  it('shows valid tenant/global chunks but hides spoofed, AI, cross-parent and orphan rows', async () => {
    const result = await inContext(a1, (client) =>
      client.query<{
        id: string;
        content: string;
        metadata: { fixture?: string; scope?: string };
        tenant_id: string | null;
        tenant_book_id: string | null;
        global_book_id: string | null;
        source_type: string;
        embedding: string;
      }>(
        'select id,content,metadata,tenant_id,tenant_book_id,global_book_id,source_type,embedding from public.book_chunks order by id'
      )
    );
    const ids = result.rows.map((row) => row.id);
    expect(ids).toContain(chunkA);
    expect(ids).toContain(globalChunk);
    expect(ids).toContain(rankedChunkA);
    expect(ids).toContain(rankedGlobalChunk);
    for (const denied of [
      chunkB,
      spoofedGlobalChunk,
      crossParentChunk,
      aiGeneratedChunk,
      orphanPrivateChunk,
      orphanGlobalChunk,
      rankedChunkB,
    ])
      expect(ids).not.toContain(denied);
    expect(result.rows.find((row) => row.id === chunkA)).toMatchObject({
      tenant_id: tenantA,
      tenant_book_id: tenantBookA,
      global_book_id: null,
      source_type: 'tenant_pdf',
      metadata: { fixture: 'private-a' },
    });
    expect(result.rows.find((row) => row.id === globalChunk)).toMatchObject({
      tenant_id: null,
      tenant_book_id: null,
      global_book_id: globalBook,
      source_type: 'global_pdf',
      metadata: { fixture: 'global' },
    });
    const tenantBRows = await inContext(b1, (client) =>
      client.query<{ id: string }>('select id from public.book_chunks order by id')
    );
    expect(tenantBRows.rows.map((row) => row.id)).toContain(chunkB);
    expect(tenantBRows.rows.map((row) => row.id)).toContain(globalChunk);
    expect(tenantBRows.rows.map((row) => row.id)).not.toContain(chunkA);
  });

  it('enforces authorization before LIMIT in direct vector SQL and the scoped RAG repository', async () => {
    const embedding = unitVector(1);
    const raw = await inContext(a1, (client) =>
      client.query<{ id: string }>(
        'select id from public.book_chunks order by embedding <=> $1::vector(1536) limit 1',
        [JSON.stringify(embedding)]
      )
    );
    expect(raw.rows.map((row) => row.id)).toHaveLength(1);
    expect(raw.rows.map((row) => row.id)).not.toContain(rankedChunkB);
    const limited = await searchChunks({
      embedding,
      tenantId: tenantA,
      userId: userA1,
      matchThreshold: 0.5,
      matchCount: 1,
      statementTimeoutMs: 5000,
    });
    expect(limited.map((row) => row.id)).toHaveLength(1);
    expect(limited.map((row) => row.id)).not.toContain(rankedChunkB);
    const withGlobal = await searchChunks({
      embedding,
      tenantId: tenantA,
      userId: userA1,
      matchThreshold: 0.5,
      matchCount: 10,
      statementTimeoutMs: 5000,
    });
    expect(withGlobal.map((row) => row.id)).toContain(rankedGlobalChunk);
    expect(withGlobal.map((row) => row.id)).not.toContain(rankedChunkB);
    const searchB = await searchChunks({
      embedding,
      tenantId: tenantB,
      userId: userB1,
      matchThreshold: 0.5,
      matchCount: 10,
      statementTimeoutMs: 5000,
    });
    expect(searchB.map((row) => row.id)).toContain(rankedChunkB);
    expect(searchB.map((row) => row.id)).toContain(rankedGlobalChunk);
    expect(searchB.map((row) => row.id)).not.toContain(rankedChunkA);
  });

  it('fails closed without valid membership context and clears pooled GUCs after commit/rollback', async () => {
    const absent = await inContext(null, async (client) => ({
      books: await client.query('select * from public.tenant_books'),
      pdfs: await client.query('select * from public.tenant_pdf_library'),
      chunks: await client.query('select * from public.book_chunks'),
    }));
    expect(absent.books.rowCount).toBe(0);
    expect(absent.pdfs.rowCount).toBe(0);
    expect(absent.chunks.rowCount).toBe(0);
    await expect(
      inContext({ tenantId: 'not-a-uuid', userId: userA1 }, (client) =>
        client.query('select * from public.book_chunks')
      )
    ).rejects.toMatchObject({ code: '22P02' });
    await expect(
      inContext({ tenantId: tenantA, userId: 'not-a-uuid' }, (client) =>
        client.query('select * from public.tenant_books')
      )
    ).rejects.toMatchObject({ code: '22P02' });
    expect(
      (
        await inContext({ tenantId: tenantA, userId: userB1 }, (client) =>
          client.query('select * from public.book_chunks')
        )
      ).rowCount
    ).toBe(0);
    expect(
      (
        await inContext({ tenantId: tenantA, userId: userWithoutMembership }, (client) =>
          client.query('select * from public.tenant_books')
        )
      ).rowCount
    ).toBe(0);

    const client = await runtime.connect();
    try {
      await client.query('begin');
      await client.query(
        "select set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)",
        [tenantA, userA1]
      );
      expect((await client.query('select id from public.tenant_books')).rowCount).toBe(2);
      await client.query('commit');
      expect((await client.query('select id from public.tenant_books')).rowCount).toBe(0);
      await client.query('begin');
      await client.query(
        "select set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)",
        [tenantA, userA1]
      );
      expect((await client.query('select id from public.book_chunks')).rowCount).toBeGreaterThan(0);
      await client.query('rollback');
      expect((await client.query('select id from public.book_chunks')).rowCount).toBe(0);
    } finally {
      client.release();
    }
  });

  it('permits tenant-private chunk inserts and same-tenant deletes, while denying global/runtime writes', async () => {
    const privateChunkId = randomUUID();
    const insert =
      'insert into public.book_chunks(id,tenant_id,tenant_book_id,source_type,content,metadata,embedding) values ($1,$2,$3,$4,$5,$6,$7::vector(1536))';
    await inContext(a1, (client) =>
      client.query(insert, [
        privateChunkId,
        tenantA,
        tenantBookA,
        'tenant_pdf',
        'authorized private chunk',
        JSON.stringify({ fixture: 'runtime-private-insert' }),
        JSON.stringify(unitVector(0.75)),
      ])
    );
    expect(
      (
        await inContext(a2, (client) =>
          client.query('select id from public.book_chunks where id=$1', [privateChunkId])
        )
      ).rows.map((row: { id: string }) => row.id)
    ).toEqual([privateChunkId]);
    for (const values of [
      [randomUUID(), null, globalBook, 'global_pdf', 'runtime global chunk'],
      [randomUUID(), null, null, 'ai_generated', 'runtime ambiguous chunk'],
      [randomUUID(), tenantA, tenantBookB, 'tenant_pdf', 'runtime cross-parent chunk'],
    ] as const) {
      await expect(
        inContext(a1, (client) =>
          client.query(insert, [
            values[0],
            values[1],
            values[2],
            values[3],
            values[4],
            '{}',
            JSON.stringify(unitVector(0.75)),
          ])
        )
      ).rejects.toMatchObject({ code: '42501' });
    }
    await expect(
      inContext(a1, (client) =>
        client.query("insert into public.global_books(title) values ('runtime global bypass')")
      )
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      inContext(a1, (client) =>
        client.query(
          "insert into public.global_pdf_library(global_book_id,storage_path,uploaded_by) values ($1,'runtime/global.pdf',$2)",
          [globalBook, userA1]
        )
      )
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      inContext(a1, (client) =>
        client.query('insert into public.tenant_books(tenant_id,title) values ($1,$2)', [
          tenantA,
          'runtime private book',
        ])
      )
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      inContext(a1, (client) =>
        client.query(
          "insert into public.tenant_pdf_library(tenant_id,storage_path,uploaded_by) values ($1,'runtime/private.pdf',$2)",
          [tenantA, userA1]
        )
      )
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      inContext(a1, (client) =>
        client.query("update public.book_chunks set metadata='{}'::jsonb where id=$1", [
          privateChunkId,
        ])
      )
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      inContext(a1, (client) =>
        client.query('delete from public.book_chunks where id=$1', [privateChunkId])
      )
    ).rejects.toMatchObject({ code: '42501' });
    expect(
      (
        await inContext(a1, (client) =>
          client.query('delete from public.tenant_pdf_library where id=$1 returning id', [pdfB])
        )
      ).rowCount
    ).toBe(0);
    expect(
      (
        await inContext(a1, (client) =>
          client.query('delete from public.tenant_pdf_library where id=$1 returning id', [
            inconsistentPdf,
          ])
        )
      ).rowCount
    ).toBe(0);
    expect(
      (
        await inContext(a1, (client) =>
          client.query('delete from public.tenant_pdf_library where id=$1 returning id', [
            pdfForDelete,
          ])
        )
      ).rowCount
    ).toBe(1);
    expect(
      (
        await inContext(a1, (client) =>
          client.query('delete from public.tenant_books where id=$1 returning id', [tenantBookB])
        )
      ).rowCount
    ).toBe(0);
    expect(
      (
        await inContext(a1, (client) =>
          client.query('delete from public.tenant_books where id=$1 returning id', [deleteBookId])
        )
      ).rowCount
    ).toBe(1);
  });

  it('denies direct match_chunks/private reads and limits global writer to its approved view contract', async () => {
    const embedding = JSON.stringify(unitVector(1));
    await expect(
      runtime.query('select * from public.match_chunks($1::vector(1536), 0.5, 2, $2::uuid)', [
        embedding,
        tenantA,
      ])
    ).rejects.toMatchObject({ code: '42501' });
    const acl = await admin.query<{ runtime_execute: boolean; public_execute: boolean }>(
      "select has_function_privilege('cocinacore_runtime_rls','public.match_chunks(vector,double precision,integer,uuid)','EXECUTE') runtime_execute, exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl where p.oid='public.match_chunks(vector,double precision,integer,uuid)'::regprocedure and acl.grantee=0 and acl.privilege_type='EXECUTE') public_execute"
    );
    expect(acl.rows[0]).toEqual({ runtime_execute: false, public_execute: false });
    await expect(globalWriter.query('select * from public.tenant_books')).rejects.toMatchObject({
      code: '42501',
    });
    await expect(
      globalWriter.query('select * from public.tenant_pdf_library')
    ).rejects.toMatchObject({
      code: '42501',
    });
    await expect(globalWriter.query('select * from public.book_chunks')).rejects.toMatchObject({
      code: '42501',
    });
    await expect(
      globalWriter.query(
        "insert into public.owner_write_global_chunks(tenant_id,tenant_book_id,global_book_id,source_type,content,metadata,embedding) values ($1,$2,null,'tenant_pdf','private writer bypass','{}',$3::vector(1536))",
        [tenantA, tenantBookA, embedding]
      )
    ).rejects.toThrow();

    const title = 'd3-writer-rollback-' + randomUUID();
    const path = 'd3-writer-rollback/' + randomUUID() + '.pdf';
    if (process.env.COCINACORE_OWNER_GLOBAL_WRITER_RLS_TEST === '1') {
      const before = await admin.query<{ books: string; pdfs: string; chunks: string }>(`select
        (select count(*)::text from public.global_books) books,
        (select count(*)::text from public.global_pdf_library) pdfs,
        (select count(*)::text from public.book_chunks where global_book_id is not null) chunks`);
      const writer = await globalWriter.connect();
      try {
        await writer.query('begin');
        const book = await writer.query<{ id: string }>(
          "insert into public.owner_write_global_books(title,cuisine_region) values ($1,'fixture') returning id",
          [title]
        );
        const id = book.rows[0]?.id;
        if (!id) throw new Error('Expected disposable global book ID');
        await writer.query(
          'insert into public.owner_write_global_pdfs(global_book_id,storage_path,page_count,uploaded_by) values ($1,$2,1,$3)',
          [id, path, userA1]
        );
        await writer.query(
          `insert into public.owner_write_global_chunks
             (tenant_id,tenant_book_id,global_book_id,source_type,content,metadata,embedding)
           values (null,null,$1,'global_pdf','writer rollback fixture','{}',$2::vector(1536))`,
          [id, embedding]
        );
        await writer.query('rollback');
      } catch (error) {
        await writer.query('rollback');
        throw error;
      } finally {
        writer.release();
      }
      const after = await admin.query<{ books: string; pdfs: string; chunks: string }>(`select
        (select count(*)::text from public.global_books) books,
        (select count(*)::text from public.global_pdf_library) pdfs,
        (select count(*)::text from public.book_chunks where global_book_id is not null) chunks`);
      expect(after.rows).toEqual(before.rows);
      return;
    }
    if (process.env.COCINACORE_OWNER_METRICS_RLS_TEST === '1') {
      await expect(
        globalWriter.query(
          "insert into public.owner_write_global_books(title,cuisine_region) values ($1,'fixture') returning id",
          [title]
        )
      ).rejects.toMatchObject({ code: '42501' });
      const denied = await admin.query<{ books: string; pdfs: string }>(
        'select (select count(*)::text from public.global_books where title=$1) books, (select count(*)::text from public.global_pdf_library where storage_path=$2) pdfs',
        [title, path]
      );
      expect(denied.rows[0]).toEqual({ books: '0', pdfs: '0' });
      return;
    }
    const writer = await globalWriter.connect();
    try {
      await writer.query('begin');
      const book = await writer.query<{ id: string }>(
        "insert into public.owner_write_global_books(title,cuisine_region) values ($1,'fixture') returning id",
        [title]
      );
      const id = book.rows[0]?.id;
      if (!id) throw new Error('Expected disposable global book ID');
      await writer.query(
        'insert into public.owner_write_global_pdfs(global_book_id,storage_path,page_count,uploaded_by) values ($1,$2,1,$3)',
        [id, path, userA1]
      );
      await expect(
        writer.query(
          "insert into public.owner_write_global_chunks(tenant_id,tenant_book_id,global_book_id,source_type,content,metadata,embedding) values (null,null,$1,'global_pdf','should be denied','{}',$2::vector(1536))",
          [id, embedding]
        )
      ).rejects.toMatchObject({ code: '42501' });
      await writer.query('rollback');
    } catch (error) {
      await writer.query('rollback');
      throw error;
    } finally {
      writer.release();
    }
    const rows = await admin.query<{ books: string; pdfs: string }>(
      'select (select count(*)::text from public.global_books where title=$1) books, (select count(*)::text from public.global_pdf_library where storage_path=$2) pdfs',
      [title, path]
    );
    expect(rows.rows[0]).toEqual({ books: '0', pdfs: '0' });
  });
});
