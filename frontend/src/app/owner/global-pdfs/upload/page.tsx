'use client';

import { ChangeEvent, useRef, useState } from 'react';
import { FileUp, Globe2, Hash, Sparkles } from 'lucide-react';
import { getSupabaseBrowserClient } from '@/lib/supabaseClient';

type ParsedChunk = { content: string; pageNumber: number };

type PdfPageLike = {
  getTextContent: () => Promise<{ items: Array<{ str?: string } | Record<string, unknown>> }>;
};

function sanitizeFileName(fileName: string): string {
  return fileName.toLowerCase().replace(/[^a-z0-9._-]/g, '-');
}

async function sha256Hex(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function chunkText(content: string, maxChars = 900, overlap = 120): string[] {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  const chunks: string[] = [];
  let start = 0;

  while (start < normalized.length) {
    const end = Math.min(start + maxChars, normalized.length);
    const slice = normalized.slice(start, end).trim();
    if (slice.length > 40) chunks.push(slice);
    if (end >= normalized.length) break;
    start = Math.max(0, end - overlap);
  }

  return chunks;
}

async function extractPdfChunks(file: File): Promise<{ pageCount: number; chunks: ParsedChunk[] }> {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

  const bytes = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjsLib.getDocument({ data: bytes });
  const pdf = await loadingTask.promise;
  const chunks: ParsedChunk[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = (await pdf.getPage(pageNumber)) as unknown as PdfPageLike;
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .trim();

    for (const piece of chunkText(pageText)) {
      chunks.push({ content: piece, pageNumber });
    }
  }

  return { pageCount: pdf.numPages, chunks };
}

async function generateEmbeddingsFromApi(texts: string[]): Promise<number[][]> {
  const response = await fetch('/api/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texts }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({ error: 'Error de embeddings.' }))) as { error?: string };
    throw new Error(payload.error ?? 'Error de embeddings.');
  }

  const payload = (await response.json()) as { embeddings: number[][] };
  return payload.embeddings;
}

export default function OwnerGlobalPdfsUploadPage() {
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [description, setDescription] = useState('');
  const [region, setRegion] = useState('Iberoamericana');
  const [country, setCountry] = useState('');
  const [style, setStyle] = useState('');
  const [tags, setTags] = useState('');
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';
    setSelectedFile(file);
  };

  const onSubmit = async () => {
    if (!selectedFile) {
      setError('Seleccioná un PDF primero.');
      return;
    }

    if (!title.trim()) {
      setError('El título del libro global es obligatorio.');
      return;
    }

    setWorking(true);
    setMessage(null);
    setError(null);

    try {
      const supabase = getSupabaseBrowserClient();
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) throw new Error('No hay sesión activa.');

      const checksum = await sha256Hex(selectedFile);
      const safeName = sanitizeFileName(selectedFile.name);

      const { pageCount, chunks } = await extractPdfChunks(selectedFile);
      const chunkCandidates = (chunks.length > 0 ? chunks : [{ content: `Documento global: ${title}`, pageNumber: 1 }]).slice(0, 160);
      const embeddings = await generateEmbeddingsFromApi(chunkCandidates.map((chunk) => chunk.content));

      const parsedTags = tags
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0);

      const { data: bookRow, error: bookError } = await supabase
        .from('global_books')
        .insert({
          title: title.trim(),
          author: author.trim() || null,
          description: description.trim() || null,
          cuisine_region: region,
          cuisine_country: country.trim() || null,
          cuisine_style: style.trim() || null,
          tags: parsedTags,
        })
        .select('id')
        .single();

      if (bookError || !bookRow) throw bookError ?? new Error('No se pudo crear global book.');

      const storagePath = `global/${bookRow.id}/${Date.now()}-${safeName}`;
      const { error: storageError } = await supabase.storage.from('global-pdfs').upload(storagePath, selectedFile, {
        contentType: 'application/pdf',
        upsert: false,
      });
      if (storageError) throw storageError;

      const { error: pdfError } = await supabase.from('global_pdf_library').insert({
        global_book_id: bookRow.id,
        storage_path: storagePath,
        file_size_bytes: selectedFile.size,
        page_count: Math.max(pageCount, 1),
        checksum_sha256: checksum,
        uploaded_by: authData.user.id,
      });
      if (pdfError) throw pdfError;

      const chunkRows = chunkCandidates.map((chunk, index) => ({
        tenant_id: null,
        tenant_book_id: null,
        global_book_id: bookRow.id,
        source_type: 'global_pdf',
        content: chunk.content,
        metadata: {
          book_title: title.trim(),
          page_number: chunk.pageNumber,
          region,
          country: country.trim() || null,
          style: style.trim() || null,
          tags: parsedTags,
          storage_path: storagePath,
        },
        embedding: embeddings[index],
      }));

      const { error: chunksError } = await supabase.from('book_chunks').insert(chunkRows);
      if (chunksError) throw chunksError;

      setMessage(`Global PDF cargado e indexado: ${chunkRows.length} chunk(s).`);
      setSelectedFile(null);
      setTitle('');
      setAuthor('');
      setDescription('');
      setCountry('');
      setStyle('');
      setTags('');
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'No se pudo subir PDF global.');
    } finally {
      setWorking(false);
    }
  };

  return (
    <section className="space-y-4">
      <article className="rounded-3xl border border-[#E8DDD2] bg-white/90 p-5 premium-shadow">
        <p className="inline-flex items-center gap-2 rounded-full border border-[#6D4AFF]/25 bg-[#6D4AFF]/10 px-3 py-1 text-xs font-semibold text-[#5A3EE6]">
          <Sparkles size={14} /> Ingesta global + indexación
        </p>
        <h2 className="mt-3 text-2xl font-semibold text-[#241A14]">Upload Global PDF</h2>
        <p className="mt-1 text-sm text-[#6B5A50]">Subí contenido global por región culinaria y dejalo listo para búsqueda contextual.</p>
      </article>

      <article className="rounded-3xl border border-[#E8DDD2] bg-white/85 p-5 premium-shadow">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="font-medium text-[#241A14]">Título del libro global</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ej: Cocina mediterránea familiar" className="h-11 w-full rounded-xl border border-[#E8DDD2] bg-white px-3" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium text-[#241A14]">Autor</span>
            <input value={author} onChange={(event) => setAuthor(event.target.value)} placeholder="Autor" className="h-11 w-full rounded-xl border border-[#E8DDD2] bg-white px-3" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="inline-flex items-center gap-2 font-medium text-[#241A14]"><Globe2 size={14} /> Región culinaria</span>
            <input value={region} onChange={(event) => setRegion(event.target.value)} placeholder="Iberoamericana" className="h-11 w-full rounded-xl border border-[#E8DDD2] bg-white px-3" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium text-[#241A14]">País (opcional)</span>
            <input value={country} onChange={(event) => setCountry(event.target.value)} placeholder="Venezuela" className="h-11 w-full rounded-xl border border-[#E8DDD2] bg-white px-3" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium text-[#241A14]">Estilo culinario</span>
            <input value={style} onChange={(event) => setStyle(event.target.value)} placeholder="Casera / Gourmet / Tradicional" className="h-11 w-full rounded-xl border border-[#E8DDD2] bg-white px-3" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="inline-flex items-center gap-2 font-medium text-[#241A14]"><Hash size={14} /> Tags</span>
            <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="tradicional, familia, sopas" className="h-11 w-full rounded-xl border border-[#E8DDD2] bg-white px-3" />
          </label>
          <label className="space-y-1 text-sm md:col-span-2">
            <span className="font-medium text-[#241A14]">Descripción editorial</span>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Contexto del libro y valor para la plataforma..." className="min-h-[110px] w-full rounded-xl border border-[#E8DDD2] bg-white px-3 py-2" />
          </label>
        </div>

        <div className="mt-4 rounded-2xl border border-dashed border-[#E8DDD2] bg-[#FAF6F1] p-4">
          <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden" onChange={onFileChange} />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-[#241A14]">Documento PDF</p>
              <p className="text-xs text-[#6B5A50]">{selectedFile ? selectedFile.name : 'Ningún archivo seleccionado'}</p>
            </div>
            <button type="button" onClick={() => fileInputRef.current?.click()} className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#E8DDD2] bg-white px-3 py-2 text-sm font-semibold text-[#6B5A50] hover:border-[#C56A1A]/35">
              <FileUp size={14} /> Seleccionar PDF
            </button>
          </div>
        </div>

        {error ? <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        {message ? <p className="mt-3 rounded-xl border border-[#567A3B]/30 bg-[#567A3B]/10 px-3 py-2 text-sm text-[#567A3B]">{message}</p> : null}

        <button
          type="button"
          onClick={() => void onSubmit()}
          disabled={working}
          className="mt-4 rounded-xl bg-[#C56A1A] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#A55412] disabled:opacity-60"
        >
          {working ? 'Procesando...' : 'Subir e indexar PDF global'}
        </button>
      </article>
    </section>
  );
}
