import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';
import type { Database } from '@/lib/database.types';

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
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 500 });
  }

  const response = NextResponse.json({ ok: true });
  const supabase = createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: isOwner, error: ownerError } = await supabase.rpc('is_platform_owner');
  if (ownerError || isOwner !== true) {
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

  const { data: bookRow, error: bookError } = await supabase
    .from('global_books')
    .insert({
      title,
      author: author || null,
      description: description || null,
      cuisine_region: region,
      cuisine_country: country || null,
      cuisine_style: style || null,
      tags,
    })
    .select('id')
    .single();

  if (bookError || !bookRow) {
    return NextResponse.json({ error: bookError?.message ?? 'Could not create global book.' }, { status: 500 });
  }

  const storagePath = `global/${bookRow.id}/${Date.now()}-${safeName}`;
  const { error: storageError } = await supabase.storage
    .from('global-pdfs')
    .upload(storagePath, file, { contentType: 'application/pdf', upsert: false });

  if (storageError) {
    return NextResponse.json({ error: storageError.message }, { status: 500 });
  }

  const { error: pdfError } = await supabase.from('global_pdf_library').insert({
    global_book_id: bookRow.id,
    storage_path: storagePath,
    file_size_bytes: file.size,
    page_count: Number.isFinite(pageCount) ? Math.max(pageCount, 1) : 1,
    checksum_sha256: checksum,
    uploaded_by: authData.user.id,
  });
  if (pdfError) {
    return NextResponse.json({ error: pdfError.message }, { status: 500 });
  }

  const chunkRows = chunks.map((chunk) => ({
    tenant_id: null,
    tenant_book_id: null,
    global_book_id: bookRow.id,
    source_type: 'global_pdf',
    content: chunk.content,
    metadata: {
      book_title: title,
      page_number: chunk.pageNumber,
      region,
      country: country || null,
      style: style || null,
      tags,
      storage_path: storagePath,
    },
    embedding: chunk.embedding,
  }));

  const { error: chunksError } = await supabase.from('book_chunks').insert(chunkRows);
  if (chunksError) {
    return NextResponse.json({ error: chunksError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, bookId: bookRow.id, chunkCount: chunkRows.length });
}
