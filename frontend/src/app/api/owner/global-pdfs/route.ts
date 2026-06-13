import { type NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/server';
import {
  createGlobalBook,
  createGlobalPdfRecord,
  insertBookChunks,
} from '@/lib/db/repositories/pdfRepository';
import { isPlatformOwner } from '@/lib/db/repositories/platformOwnerRepository';
import { localStorageAdapter } from '@/lib/storage/localStorageAdapter';

export const runtime = 'nodejs';

interface ChunkPayload {
  content: string;
  pageNumber: number;
  embedding: number[];
}

function sanitizeFileName(fileName: string): string {
  return fileName.toLowerCase().replace(/[^a-z0-9._-]/g, '-');
}

async function sha256Hex(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function parseStringList(value: FormDataEntryValue | null): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseChunks(value: FormDataEntryValue | null): ChunkPayload[] {
  if (typeof value !== 'string') return [];
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) return [];

  return parsed.flatMap((item): ChunkPayload[] => {
    if (typeof item !== 'object' || item === null) return [];
    const record = item as Record<string, unknown>;
    const content = typeof record.content === 'string' ? record.content : '';
    const pageNumber = typeof record.pageNumber === 'number' ? record.pageNumber : 1;
    const embedding = Array.isArray(record.embedding)
      ? record.embedding.filter((entry): entry is number => typeof entry === 'number')
      : [];

    if (!content.trim() || embedding.length === 0) return [];
    return [{ content, pageNumber, embedding }];
  });
}

export async function POST(request: NextRequest) {
  let storedFilePath: string | null = null;

  try {
    const user = await requireUser(request, 'Unauthorized');
    const owner = await isPlatformOwner(user.id);
    if (!owner) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get('file');
    const title = String(formData.get('title') ?? '').trim();
    const author = String(formData.get('author') ?? '').trim();
    const description = String(formData.get('description') ?? '').trim();
    const region = String(formData.get('region') ?? 'Iberoamericana').trim() || 'Iberoamericana';
    const country = String(formData.get('country') ?? '').trim();
    const style = String(formData.get('style') ?? '').trim();
    const pageCount = Number(formData.get('pageCount') ?? 1);
    const tags = parseStringList(formData.get('tags'));
    const chunks = parseChunks(formData.get('chunks'));

    if (!(file instanceof File) || file.type !== 'application/pdf') {
      return NextResponse.json({ error: 'A PDF file is required.' }, { status: 400 });
    }
    if (!title) {
      return NextResponse.json({ error: 'Title is required.' }, { status: 400 });
    }
    if (chunks.length === 0) {
      return NextResponse.json({ error: 'At least one embedded chunk is required.' }, { status: 400 });
    }

    const checksum = await sha256Hex(file);
    const safeName = sanitizeFileName(file.name);
    const storedFile = await localStorageAdapter.saveFile({
      namespace: 'global-pdfs',
      fileName: safeName,
      bytes: await file.arrayBuffer(),
    });
    storedFilePath = storedFile.storagePath;

    const bookRow = await createGlobalBook({
      title,
      author: author || null,
      description: description || null,
      cuisineRegion: region,
      cuisineCountry: country || null,
      cuisineStyle: style || null,
      tags,
    });

    await createGlobalPdfRecord({
      globalBookId: bookRow.id,
      storagePath: storedFile.storagePath,
      fileSizeBytes: file.size,
      pageCount: Number.isFinite(pageCount) ? Math.max(pageCount, 1) : 1,
      checksumSha256: checksum,
      uploadedBy: user.id,
    });

    await insertBookChunks(
      chunks.map((chunk) => ({
        tenantId: null,
        tenantBookId: null,
        globalBookId: bookRow.id,
        sourceType: 'global_pdf',
        content: chunk.content,
        metadata: {
          book_title: title,
          page_number: chunk.pageNumber,
          region,
          country: country || null,
          style: style || null,
          tags,
          storage_path: storedFile.storagePath,
        },
        embedding: chunk.embedding,
      }))
    );

    return NextResponse.json({ ok: true, bookId: bookRow.id, chunkCount: chunks.length });
  } catch (error) {
    if (storedFilePath) {
      await localStorageAdapter.deleteFile(storedFilePath).catch(() => undefined);
    }

    const message = error instanceof Error ? error.message : 'Could not upload global PDF.';
    const status = message === 'Unauthorized' ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
