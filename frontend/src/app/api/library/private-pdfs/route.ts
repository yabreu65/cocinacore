import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/server';
import { scopedTransaction } from '@/lib/db';
import { checkRateLimit } from '@/lib/rate-limit';
import { serverLogger } from '@/lib/serverLogger';
import { privatePdfStorageConfigured } from '@/lib/private-pdf/config';
import {
  PRIVATE_PDF_MAX_BYTES,
  validatePrivatePdfFile,
  validatePrivatePdfIndex,
} from '@/lib/private-pdf/validation';
import { deleteTenantPdf, saveTenantPdf } from '@/lib/storage/tenantPdfStorage';

export const runtime = 'nodejs';
const MAX_REQUEST_BYTES = 64 * 1024 * 1024;
class Conflict extends Error {}

async function boundedFormData(request: NextRequest): Promise<FormData> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Missing body');
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new Error('Body too large');
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    body.set(part, offset);
    offset += part.length;
  }
  return new Response(body, {
    headers: { 'Content-Type': request.headers.get('content-type') || '' },
  }).formData();
}

export async function POST(request: NextRequest) {
  let user;
  try {
    user = await requireUser(request, 'Unauthorized');
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!user.tenant) return NextResponse.json({ error: 'Tenant context required' }, { status: 403 });
  const { tenantId, tenantType } = user.tenant;
  if (!privatePdfStorageConfigured())
    return NextResponse.json({ error: 'Private PDF storage unavailable' }, { status: 503 });
  const limit = await checkRateLimit('private-pdf-upload', tenantId, user.id, {
    requireSharedStore: true,
  });
  if (!limit.success)
    return NextResponse.json(
      { error: 'Upload unavailable' },
      { status: limit.storage === 'unavailable' ? 503 : 429 }
    );

  let form: FormData;
  try {
    form = await boundedFormData(request);
  } catch {
    return NextResponse.json({ error: 'Invalid upload' }, { status: 400 });
  }
  const file = form.get('file');
  const title = form.get('title');
  const author = form.get('author');
  const pages = form.get('pageCount');
  const rawChunks = form.get('chunks');
  let chunks: unknown;
  try {
    chunks = typeof rawChunks === 'string' ? JSON.parse(rawChunks) : null;
  } catch {
    return NextResponse.json({ error: 'Invalid upload' }, { status: 400 });
  }
  const pageCount = typeof pages === 'string' && /^\d+$/.test(pages) ? Number(pages) : NaN;
  if (
    !(file instanceof File) ||
    file.size > PRIVATE_PDF_MAX_BYTES ||
    typeof title !== 'string' ||
    !title.trim() ||
    title.length > 160 ||
    (author !== null && (typeof author !== 'string' || author.length > 160)) ||
    !validatePrivatePdfIndex(pageCount, chunks)
  ) {
    return NextResponse.json({ error: 'Invalid upload' }, { status: 400 });
  }
  const bytes = await file.arrayBuffer();
  if (!validatePrivatePdfFile(file.type, new Uint8Array(bytes)))
    return NextResponse.json({ error: 'Invalid upload' }, { status: 400 });
  const checksum = createHash('sha256').update(new Uint8Array(bytes)).digest('hex');
  let storagePath: string | undefined;
  try {
    ({ storagePath } = await saveTenantPdf({ tenantId, fileName: file.name, bytes }));
    const result = await scopedTransaction({ tenantId, userId: user.id }, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [tenantId]);
      const count = await client.query<{ count: string }>(
        'SELECT count(*) AS count FROM public.tenant_pdf_library WHERE tenant_id = $1',
        [tenantId]
      );
      if (Number(count.rows[0].count) >= (tenantType === 'professional' ? 15 : 5))
        throw new Conflict();
      const duplicate = await client.query(
        'SELECT 1 FROM public.tenant_pdf_library WHERE tenant_id = $1 AND checksum_sha256 = $2 LIMIT 1',
        [tenantId, checksum]
      );
      if (duplicate.rows.length) throw new Conflict();
      const book = await client.query<{ id: string }>(
        'INSERT INTO public.tenant_books (tenant_id, title, author) VALUES ($1, $2, $3) RETURNING id',
        [tenantId, title.trim(), typeof author === 'string' ? author.trim() || null : null]
      );
      const bookId = book.rows[0].id;
      const pdf = await client.query<{ id: string }>(
        `INSERT INTO public.tenant_pdf_library (tenant_id, tenant_book_id, storage_path, file_size_bytes, page_count, checksum_sha256, uploaded_by, processing_status, processed_chunks_count)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'ready', $8) RETURNING id`,
        [
          tenantId,
          bookId,
          storagePath,
          bytes.byteLength,
          pageCount,
          checksum,
          user.id,
          chunks.length,
        ]
      );
      for (let start = 0; start < chunks.length; start += 100) {
        const batch = chunks.slice(start, start + 100);
        const values: unknown[] = [];
        const rows = batch.map((chunk, index) => {
          const n = index * 5;
          values.push(
            tenantId,
            bookId,
            chunk.content,
            JSON.stringify({ book_title: title.trim(), page_number: chunk.pageNumber }),
            `[${chunk.embedding.join(',')}]`
          );
          return `($${n + 1}, $${n + 2}, 'tenant_pdf', $${n + 3}, $${n + 4}::jsonb, $${n + 5}::vector(1536))`;
        });
        await client.query(
          `INSERT INTO public.book_chunks (tenant_id, tenant_book_id, source_type, content, metadata, embedding) VALUES ${rows.join(',')}`,
          values
        );
      }
      return { id: pdf.rows[0].id, bookId };
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (storagePath) {
      try {
        await deleteTenantPdf({ tenantId, storagePath });
      } catch {
        // The upload failed, but the private object might remain orphaned.
        // Record a fixed diagnostic event for operator reconciliation.
        serverLogger.warn('private_pdf_upload.cleanup_failed', { reason: 'storage_delete_failed' });
      }
    }
    return NextResponse.json(
      {
        error: error instanceof Conflict ? 'PDF already exists or quota reached' : 'Upload failed',
      },
      { status: error instanceof Conflict ? 409 : 500 }
    );
  }
}
