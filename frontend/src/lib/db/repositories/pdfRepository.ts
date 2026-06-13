import { query, mapSingleRow } from '@/lib/db';
import {
  BookChunkRow,
  GlobalBookRow,
  GlobalPdfLibraryRow,
  TenantBookRow,
  TenantPdfLibraryRow,
} from '@/lib/db/types';

interface CreateGlobalBookInput {
  title: string;
  author: string | null;
  description: string | null;
  cuisineRegion: string;
  cuisineCountry: string | null;
  cuisineStyle: string | null;
  tags: string[];
}

interface CreateGlobalPdfInput {
  globalBookId: string;
  storagePath: string;
  fileSizeBytes: number;
  pageCount: number;
  checksumSha256: string;
  uploadedBy: string;
}

interface BookChunkInsert {
  tenantId: string | null;
  tenantBookId: string | null;
  globalBookId: string | null;
  sourceType: BookChunkRow['source_type'];
  content: string;
  metadata: unknown;
  embedding: number[];
}

export async function findTenantPdfById(
  tenantId: string,
  pdfId: string
): Promise<TenantPdfLibraryRow | null> {
  const result = await query<TenantPdfLibraryRow>(
    'select * from public.tenant_pdf_library where id = $1 and tenant_id = $2 limit 1',
    [pdfId, tenantId]
  );

  return mapSingleRow(result);
}

export async function deleteTenantPdfById(tenantId: string, pdfId: string): Promise<void> {
  await query('delete from public.tenant_pdf_library where id = $1 and tenant_id = $2', [
    pdfId,
    tenantId,
  ]);
}

export async function countTenantPdfsByBookId(
  tenantId: string,
  tenantBookId: string
): Promise<number> {
  const result = await query<{ count: string }>(
    `select count(*)::text as count
     from public.tenant_pdf_library
     where tenant_id = $1 and tenant_book_id = $2`,
    [tenantId, tenantBookId]
  );

  return Number.parseInt(result.rows[0]?.count ?? '0', 10);
}

export async function deleteTenantBookById(tenantId: string, bookId: string): Promise<void> {
  await query('delete from public.tenant_books where id = $1 and tenant_id = $2', [bookId, tenantId]);
}

export async function createGlobalBook(input: CreateGlobalBookInput): Promise<GlobalBookRow> {
  const result = await query<GlobalBookRow>(
    `insert into public.global_books
      (title, author, description, cuisine_region, cuisine_country, cuisine_style, tags)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning *`,
    [
      input.title,
      input.author,
      input.description,
      input.cuisineRegion,
      input.cuisineCountry,
      input.cuisineStyle,
      input.tags,
    ]
  );

  const row = mapSingleRow(result);
  if (!row) {
    throw new Error('Failed to create global book');
  }

  return row;
}

export async function createGlobalPdfRecord(
  input: CreateGlobalPdfInput
): Promise<GlobalPdfLibraryRow> {
  const result = await query<GlobalPdfLibraryRow>(
    `insert into public.global_pdf_library
      (global_book_id, storage_path, file_size_bytes, page_count, checksum_sha256, uploaded_by)
     values ($1, $2, $3, $4, $5, $6)
     returning *`,
    [
      input.globalBookId,
      input.storagePath,
      input.fileSizeBytes,
      input.pageCount,
      input.checksumSha256,
      input.uploadedBy,
    ]
  );

  const row = mapSingleRow(result);
  if (!row) {
    throw new Error('Failed to create global PDF record');
  }

  return row;
}

export async function insertBookChunks(rows: BookChunkInsert[]): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  const values: unknown[] = [];
  const placeholders = rows.map((row, index) => {
    const base = index * 7;
    values.push(
      row.tenantId,
      row.tenantBookId,
      row.globalBookId,
      row.sourceType,
      row.content,
      row.metadata,
      row.embedding
    );
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}::vector(1536))`;
  });

  await query(
    `insert into public.book_chunks
      (tenant_id, tenant_book_id, global_book_id, source_type, content, metadata, embedding)
     values ${placeholders.join(', ')}`,
    values.map((value, index) =>
      index % 7 === 6 && Array.isArray(value) ? JSON.stringify(value) : value
    )
  );
}

export async function findTenantBookById(
  tenantId: string,
  bookId: string
): Promise<TenantBookRow | null> {
  const result = await query<TenantBookRow>(
    'select * from public.tenant_books where id = $1 and tenant_id = $2 limit 1',
    [bookId, tenantId]
  );

  return mapSingleRow(result);
}
