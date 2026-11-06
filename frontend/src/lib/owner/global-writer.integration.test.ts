import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { createGlobalUpload, type GlobalUpload } from './global-writer';
import { searchChunks } from '@/lib/db/repositories/bookChunkRepository';

const enabled = process.env.COCINACORE_SIGNUP_REAL_SCHEMA_TEST === '1';
let admin: Pool;
let writer: Pool;
let runtime: Pool;
let auth: Pool;
let metrics: Pool;
let publicProbe: Pool;
let userId: string;
let tenantId: string;
let priorWriterEnabled: string | undefined;
const embedding = [1, ...Array<number>(1535).fill(0)];
const vector = JSON.stringify(embedding);
function payload(title: string): GlobalUpload {
  return {
    book: {
      title,
      author: null,
      description: null,
      cuisineRegion: 'test',
      cuisineCountry: null,
      cuisineStyle: null,
      tags: [],
    },
    pdf: {
      storagePath: 'fixture.pdf',
      fileSizeBytes: 1,
      pageCount: 1,
      checksumSha256: 'fixture',
      uploadedBy: userId,
    },
    chunks: [{ content: title, metadata: {}, embedding }],
  };
}
describe.skipIf(!enabled)('global writer on disposable PostgreSQL', () => {
  beforeAll(async () => {
    priorWriterEnabled = process.env.COCINACORE_OWNER_GLOBAL_WRITER_ENABLED;
    const urls = [
      { key: 'SIGNUP_TEST_ADMIN_URL', username: 'postgres' },
      { key: 'OWNER_GLOBAL_WRITER_DATABASE_URL', username: 'cocinacore_global_writer' },
      { key: 'DATABASE_URL', username: 'cocinacore_runtime_rls' },
      { key: 'AUTH_DATABASE_URL', username: 'cocinacore_auth' },
      { key: 'OWNER_METRICS_DATABASE_URL', username: 'cocinacore_owner_metrics' },
      {
        key: 'OWNER_GLOBAL_WRITER_PUBLIC_PROBE_DATABASE_URL',
        username: 'cocinacore_global_public_probe',
      },
    ].map(({ key, username }) => {
      const url = new URL(process.env[key] ?? '');
      if (
        url.hostname !== '127.0.0.1' ||
        url.pathname !== '/signup_real_disposable' ||
        url.username !== username
      )
        throw new Error('Restricted loopback PostgreSQL disposable required');
      return url;
    });
    if (urls.some((url) => url.host !== urls[0]?.host))
      throw new Error('All SQL identities must use one disposable PostgreSQL instance');
    admin = new Pool({ connectionString: urls[0]!.toString(), max: 2 });
    writer = new Pool({ connectionString: urls[1]!.toString(), max: 2 });
    runtime = new Pool({ connectionString: urls[2]!.toString(), max: 1 });
    auth = new Pool({ connectionString: urls[3]!.toString(), max: 1 });
    metrics = new Pool({ connectionString: urls[4]!.toString(), max: 1 });
    publicProbe = new Pool({ connectionString: urls[5]!.toString(), max: 1 });
    const marker = await admin.query<{ marker: string }>(
      "select shobj_description(oid, 'pg_database') marker from pg_database where datname = current_database()"
    );
    if (marker.rows[0].marker !== 'cocinacore-signup-real-disposable')
      throw new Error('Disposable marker missing');
    tenantId = randomUUID();
    userId = randomUUID();
    await admin.query("insert into tenants (id, name) values ($1, 'Writer fixture')", [tenantId]);
    await admin.query(
      "insert into users (id, tenant_id, email, password_hash) values ($1, $2, $3, 'fixture')",
      [userId, tenantId, `${userId}@example.test`]
    );
    await admin.query(
      "insert into tenant_memberships (tenant_id,user_id,role) values ($1,$2,'owner')",
      [tenantId, userId]
    );
    process.env.COCINACORE_OWNER_GLOBAL_WRITER_ENABLED = 'true';
  });
  afterAll(async () => {
    if (priorWriterEnabled === undefined) delete process.env.COCINACORE_OWNER_GLOBAL_WRITER_ENABLED;
    else process.env.COCINACORE_OWNER_GLOBAL_WRITER_ENABLED = priorWriterEnabled;
    await Promise.all([
      admin?.end(),
      writer?.end(),
      runtime?.end(),
      auth?.end(),
      metrics?.end(),
      publicProbe?.end(),
    ]);
  });
  it('writes a complete global upload under FORCE RLS and exposes it to authorized RAG and metrics', async () => {
    const id = await createGlobalUpload(payload('writer-test'));
    expect((await admin.query('select id from global_books where id=$1', [id])).rows).toHaveLength(
      1
    );
    expect(
      (
        await admin.query<{ n: number }>(
          'select count(*)::int n from global_pdf_library where global_book_id=$1',
          [id]
        )
      ).rows[0].n
    ).toBe(1);
    expect(
      (
        await admin.query<{ n: number }>(
          'select count(*)::int n from book_chunks where global_book_id=$1',
          [id]
        )
      ).rows[0].n
    ).toBe(1);
    expect(
      (
        await searchChunks({
          tenantId,
          userId,
          embedding,
          statementTimeoutMs: 5000,
          matchCount: 100,
        })
      ).some((row) => row.global_book_id === id)
    ).toBe(true);
    const actualMetrics = await metrics.query<{
      tenants: string;
      users: string;
      books: string;
      pdfs: string;
      chunks: string;
      reports: string;
      owners: string;
    }>('select tenants,users,books,pdfs,chunks,reports,owners from public.owner_global_metrics');
    const referenceMetrics = await admin.query<{
      tenants: string;
      users: string;
      books: string;
      pdfs: string;
      chunks: string;
      reports: string;
      owners: string;
    }>(`select (select count(*)::text from public.tenants) tenants,
              (select count(*)::text from public.users) users,
              (select count(*)::text from public.global_books) books,
              (select count(*)::text from public.global_pdf_library) pdfs,
              (select count(*)::text from public.book_chunks where global_book_id is not null) chunks,
              (select count(*)::text from public.premium_review_reports) reports,
              (select count(*)::text from public.platform_owners) owners`);
    expect(actualMetrics.rows).toEqual(referenceMetrics.rows);
  });
  it('restricts the LOGIN to view INSERT and rejects direct, private, and inconsistent SQL', async () => {
    const identity = await writer.query<{ current_user: string }>('select current_user');
    expect(identity.rows[0].current_user).toBe('cocinacore_global_writer');
    expect(await writer.query('select id from public.owner_write_global_books')).toBeDefined();
    const role =
      await admin.query(`select rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolcanlogin,
      (select count(*)::int from pg_auth_members where member = r.oid or roleid = r.oid) memberships,
      (select count(*)::int from pg_class c where c.relkind in ('r','p') and c.relowner = r.oid) owned_tables
      from pg_roles r where rolname = 'cocinacore_global_writer'`);
    expect(role.rows[0]).toEqual({
      rolsuper: false,
      rolbypassrls: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolcanlogin: true,
      memberships: 0,
      owned_tables: 0,
    });
    const ownerRole = await admin.query(`select rolsuper, rolbypassrls, rolcreatedb,
      rolcreaterole, rolcanlogin,
      (select count(*)::int from pg_auth_members where member = r.oid or roleid = r.oid) memberships,
      (select count(*)::int from pg_class c where c.relkind in ('r','p') and c.relowner = r.oid) owned_tables
      from pg_roles r where rolname = 'cocinacore_global_writer_view_owner'`);
    expect(ownerRole.rows[0]).toEqual({
      rolsuper: false,
      rolbypassrls: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolcanlogin: false,
      memberships: 0,
      owned_tables: 0,
    });
    for (const sql of [
      'select password_hash from users',
      'select * from sessions',
      'select * from password_reset_tokens',
      'select * from global_books',
      'select * from global_pdf_library',
      'select * from book_chunks',
      'select title from owner_write_global_books',
      'select global_book_id from owner_write_global_pdfs',
      'select content from owner_write_global_chunks',
      "insert into global_books (title) values ('bypass')",
      "insert into global_pdf_library(global_book_id,storage_path,uploaded_by) values (gen_random_uuid(),'bypass.pdf',gen_random_uuid())",
      "insert into book_chunks (source_type, content) values ('ai_generated', 'x')",
      "update global_books set title = 'changed'",
      "update global_pdf_library set storage_path = 'changed'",
      'delete from global_books',
      'delete from global_pdf_library',
      'delete from book_chunks',
      "update owner_write_global_books set title='changed'",
      'delete from owner_write_global_pdfs',
      'delete from owner_write_global_chunks',
      "insert into tenant_pdf_library (tenant_id, storage_path) values (gen_random_uuid(),'x')",
      "insert into recipe_inventory_items (tenant_id,user_id,ingredient_name) values (gen_random_uuid(),gen_random_uuid(),'x')",
      'set role cocinacore_global_writer_view_owner',
    ])
      await expect(writer.query(sql)).rejects.toMatchObject({ code: '42501' });
    await expect(
      writer.query(
        `insert into book_chunks
           (global_book_id, source_type, content, metadata, embedding)
         values (gen_random_uuid(), 'global_pdf', 'bypass', '{}'::jsonb, $1::vector(1536))`,
        [vector]
      )
    ).rejects.toMatchObject({ code: '42501' });
    for (const target of [
      'owner_write_global_books',
      'owner_write_global_pdfs',
      'owner_write_global_chunks',
    ]) {
      await expect(publicProbe.query(`select * from public.${target}`)).rejects.toMatchObject({
        code: '42501',
      });
      await expect(
        publicProbe.query(`insert into public.${target} default values`)
      ).rejects.toMatchObject({
        code: '42501',
      });
      await expect(
        runtime.query(`insert into public.${target} default values`)
      ).rejects.toMatchObject({
        code: '42501',
      });
      await expect(auth.query(`insert into public.${target} default values`)).rejects.toMatchObject(
        {
          code: '42501',
        }
      );
    }
    const ownerUrl = new URL(process.env.OWNER_GLOBAL_WRITER_DATABASE_URL ?? '');
    ownerUrl.username = 'cocinacore_global_writer_view_owner';
    ownerUrl.password = 'view_owner_must_not_login';
    await admin.query(
      "alter role cocinacore_global_writer_view_owner password 'view_owner_must_not_login'"
    );
    const ownerLoginProbe = new Pool({
      connectionString: ownerUrl.toString(),
      max: 1,
      connectionTimeoutMillis: 2000,
    });
    try {
      await expect(ownerLoginProbe.query('select 1')).rejects.toMatchObject({ code: '28000' });
    } finally {
      await ownerLoginProbe.end();
    }
    const bookId = (
      await admin.query<{ id: string }>(
        "insert into global_books (title) values ('boundary') returning id"
      )
    ).rows[0].id;
    await expect(
      writer.query(
        "insert into owner_write_global_pdfs (global_book_id, storage_path, uploaded_by) values ($1, 'invalid-uploader.pdf', null)",
        [bookId]
      )
    ).rejects.toBeDefined();
    await expect(
      writer.query(
        "insert into owner_write_global_pdfs (global_book_id, storage_path, uploaded_by) values ($1, 'orphan.pdf', $2)",
        [randomUUID(), userId]
      )
    ).rejects.toBeDefined();
    await expect(
      writer.query(
        "insert into owner_write_global_books (title, cuisine_region) values ('', 'test')"
      )
    ).rejects.toBeDefined();
    const tenantBook = (
      await admin.query<{ id: string }>(
        "insert into tenant_books (tenant_id, title) values ($1, 'private') returning id",
        [tenantId]
      )
    ).rows[0].id;
    const beforeInvalidWrites = await admin.query<{
      books: string;
      pdfs: string;
      chunks: string;
    }>(`select
      (select count(*)::text from public.global_books) books,
      (select count(*)::text from public.global_pdf_library) pdfs,
      (select count(*)::text from public.book_chunks where global_book_id is not null) chunks`);
    const insert =
      "insert into owner_write_global_chunks (tenant_id, tenant_book_id, global_book_id, source_type, content, metadata, embedding) values ($1,$2,$3,$4,'x','{}',$5::vector)";
    for (const values of [
      [tenantId, tenantBook, null, 'tenant_pdf', vector],
      [null, null, null, 'ai_generated', vector],
      [null, null, bookId, 'ai_generated', vector],
      [tenantId, null, bookId, 'global_pdf', vector],
      [null, tenantBook, bookId, 'global_pdf', vector],
    ])
      await expect(writer.query(insert, values)).rejects.toBeDefined();
    await expect(
      writer.query(insert, [tenantId, null, bookId, 'global_pdf', vector])
    ).rejects.toBeDefined();
    await expect(
      writer.query(insert, [null, null, randomUUID(), 'global_pdf', vector])
    ).rejects.toBeDefined();
    const afterInvalidWrites = await admin.query<{
      books: string;
      pdfs: string;
      chunks: string;
    }>(`select
      (select count(*)::text from public.global_books) books,
      (select count(*)::text from public.global_pdf_library) pdfs,
      (select count(*)::text from public.book_chunks where global_book_id is not null) chunks`);
    expect(afterInvalidWrites.rows).toEqual(beforeInvalidWrites.rows);
  });
  it('rolls back book and PDF when a chunk fails', async () => {
    const value = payload(`rollback-${randomUUID()}`);
    value.pdf.storagePath = value.book.title;
    value.chunks[0].embedding = [1];
    await expect(createGlobalUpload(value)).rejects.toBeDefined();
    expect(
      (
        await admin.query<{ n: number }>(
          'select count(*)::int n from global_books where title=$1',
          [value.book.title]
        )
      ).rows[0].n
    ).toBe(0);
    expect(
      (
        await admin.query<{ n: number }>(
          'select count(*)::int n from global_pdf_library where storage_path=$1',
          [value.book.title]
        )
      ).rows[0].n
    ).toBe(0);
    expect(
      (
        await admin.query<{ n: number }>(
          'select count(*)::int n from book_chunks where content=$1',
          [value.chunks[0]?.content]
        )
      ).rows[0].n
    ).toBe(0);
  });
  it('rolls back the book when PDF insertion fails and does not expose SQL credentials', async () => {
    const value = payload(`pdf-rollback-${randomUUID()}`);
    value.pdf.storagePath = `d4b-pdf-fail-${randomUUID()}`;
    await admin.query(`alter table public.global_pdf_library add constraint d4b_test_pdf_failure
      check (storage_path not like 'd4b-pdf-fail-%') not valid`);
    try {
      const failure = await createGlobalUpload(value).then(
        () => null,
        (error: unknown) => error
      );
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe('Global upload database is unavailable.');
      expect((failure as Error).message).not.toContain('signup_writer_disposable_only');
      expect(
        (await admin.query('select id from global_books where title=$1', [value.book.title])).rows
      ).toHaveLength(0);
    } finally {
      await admin.query(
        'alter table public.global_pdf_library drop constraint d4b_test_pdf_failure'
      );
    }
  });
  it('rolls back all three inserts when COMMIT fails', async () => {
    const value = payload(`commit-rollback-${randomUUID()}`);
    value.pdf.storagePath = `d4b-commit-fail-${randomUUID()}`;
    await admin.query(`create function public.d4b_reject_deferred_commit() returns trigger
      language plpgsql as $$ begin
        if new.storage_path like 'd4b-commit-fail-%' then raise exception 'disposable deferred failure'; end if;
        return new;
      end $$`);
    await admin.query(`create constraint trigger d4b_deferred_commit_failure
      after insert on public.global_pdf_library deferrable initially deferred
      for each row execute function public.d4b_reject_deferred_commit()`);
    try {
      await expect(createGlobalUpload(value)).rejects.toThrow(
        'Global upload database is unavailable.'
      );
      expect(
        (await admin.query('select id from global_books where title=$1', [value.book.title])).rows
      ).toHaveLength(0);
      expect(
        (
          await admin.query('select id from global_pdf_library where storage_path=$1', [
            value.pdf.storagePath,
          ])
        ).rows
      ).toHaveLength(0);
      expect(
        (
          await admin.query('select id from book_chunks where content=$1', [
            value.chunks[0]?.content,
          ])
        ).rows
      ).toHaveLength(0);
    } finally {
      await admin.query('drop trigger d4b_deferred_commit_failure on public.global_pdf_library');
      await admin.query('drop function public.d4b_reject_deferred_commit()');
    }
  });
});
