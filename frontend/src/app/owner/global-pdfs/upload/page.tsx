'use client';

import { ChangeEvent, useRef, useState } from 'react';
import { FileUp, Globe2, Hash, Sparkles } from 'lucide-react';

import { assertPdfUploadSize, chunkPdfPage, estimatedPdfChunkBytes, preparePdfChunks, embedPdfChunks, type ParsedChunk } from './pdf-embeddings';

type PdfPageLike = {
  getTextContent: () => Promise<{ items: Array<{ str?: string } | Record<string, unknown>> }>;
};

type PdfExtraction = { pageCount: number; textPages: number; chunks: ParsedChunk[] };

async function extractPdfChunks(
  file: File,
  onPage: (completed: number, total: number) => void,
): Promise<PdfExtraction> {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

  const bytes = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjsLib.getDocument({ data: bytes });
  try {
    const pdf = await loadingTask.promise;
    const chunks: ParsedChunk[] = [];
    let textPages = 0;
    let estimatedBytes = file.size + 2;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = (await pdf.getPage(pageNumber)) as unknown as PdfPageLike;
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .trim();
      const pageChunks = chunkPdfPage(pageText, pageNumber);
      if (pageChunks.length) textPages += 1;
      for (const chunk of pageChunks) {
        estimatedBytes += estimatedPdfChunkBytes(chunk);
        assertPdfUploadSize(estimatedBytes);
        chunks.push(chunk);
      }
      onPage(pageNumber, pdf.numPages);
    }
    return { pageCount: pdf.numPages, textPages, chunks };
  } finally {
    await loadingTask.destroy();
  }
}

type UploadProgress = { stage: 'extract' | 'embed' | 'wait' | 'upload'; completed: number; total: number; seconds?: number };
type TextCoverage = { pageCount: number; textPages: number };

export default function OwnerGlobalPdfsUploadPage() {
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [description, setDescription] = useState('');
  const [region, setRegion] = useState('Iberoamericana');
  const [country, setCountry] = useState('');
  const [style, setStyle] = useState('');
  const [tags, setTags] = useState('');
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [coverage, setCoverage] = useState<TextCoverage | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';
    setSelectedFile(file);
    setCoverage(null);
    setMessage(null);
    setError(null);
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

    if (working) return;
    setWorking(true);
    setCoverage(null);
    setProgress({ stage: 'extract', completed: 0, total: 0 });
    setMessage(null);
    setError(null);

    try {
      assertPdfUploadSize(selectedFile.size);
      const { pageCount, textPages, chunks } = await extractPdfChunks(selectedFile, (completed, total) => {
        setProgress({ stage: 'extract', completed, total });
      });
      setCoverage({ pageCount, textPages });

      const metadata = {
        title: title.trim(),
        author: author.trim(),
        description: description.trim(),
        region,
        country: country.trim(),
        style: style.trim(),
        tags: tags.split(',').map((value) => value.trim()).filter(Boolean).join(','),
        pageCount: String(pageCount),
      };
      const metadataBytes = new TextEncoder().encode(JSON.stringify(metadata) + selectedFile.name).byteLength;
      const chunkCandidates = preparePdfChunks(chunks, selectedFile.size, metadataBytes);
      setProgress({ stage: 'embed', completed: 0, total: chunkCandidates.length });
      const embeddings = await embedPdfChunks(chunkCandidates, (completed, total) => {
        setProgress({ stage: 'embed', completed, total });
      }, (completed, total, seconds) => {
        setProgress({ stage: 'wait', completed, total, seconds });
      });

      const chunksJson = JSON.stringify(chunkCandidates.map((chunk, index) => ({
        ...chunk,
        embedding: embeddings[index],
      })));
      assertPdfUploadSize(selectedFile.size + metadataBytes + new TextEncoder().encode(chunksJson).byteLength);
      const formData = new FormData();
      formData.set('file', selectedFile);
      for (const [key, value] of Object.entries(metadata)) formData.set(key, value);
      formData.set('chunks', chunksJson);
      setProgress({ stage: 'upload', completed: 0, total: 0 });

      const uploadResponse = await fetch('/api/owner/global-pdfs', {
        method: 'POST',
        body: formData,
      });

      if (!uploadResponse.ok) {
        const payload = (await uploadResponse.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? 'No se pudo subir PDF global.');
      }

      const uploadPayload = (await uploadResponse.json()) as { chunkCount: number };

      if (uploadPayload.chunkCount !== chunkCandidates.length) {
        throw new Error('El servidor no confirmó todos los fragmentos. Revisá Documentos PDF antes de volver a cargar el libro.');
      }
      setMessage(`Global PDF cargado e indexado: ${uploadPayload.chunkCount} fragmentos de ${textPages} de ${pageCount} páginas con texto.`);
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
      setProgress(null);
    }
  };

  return (
    <section className="space-y-4">
      <article className="rounded-3xl border border-bistro-border bg-white/90 p-5 premium-shadow">
        <p className="inline-flex items-center gap-2 rounded-full border border-bistro-action-secondary/25 bg-bistro-action-secondary/10 px-3 py-1 text-xs font-semibold text-bistro-action-secondary">
          <Sparkles size={14} /> Ingesta global + indexación
        </p>
        <h2 className="mt-3 text-2xl font-semibold text-bistro-text-primary">Upload Global PDF</h2>
        <p className="mt-1 text-sm text-bistro-text-secondary">
          Subí contenido global por región culinaria y dejalo listo para búsqueda contextual.
        </p>
      </article>

      <article className="rounded-3xl border border-bistro-border bg-white/85 p-5 premium-shadow">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="font-medium text-bistro-text-primary">Título del libro global</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Ej: Cocina mediterránea familiar"
              className="h-11 w-full rounded-xl border border-bistro-border bg-white px-3"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium text-bistro-text-primary">Autor</span>
            <input
              value={author}
              onChange={(event) => setAuthor(event.target.value)}
              placeholder="Autor"
              className="h-11 w-full rounded-xl border border-bistro-border bg-white px-3"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="inline-flex items-center gap-2 font-medium text-bistro-text-primary">
              <Globe2 size={14} /> Región culinaria
            </span>
            <input
              value={region}
              onChange={(event) => setRegion(event.target.value)}
              placeholder="Iberoamericana"
              className="h-11 w-full rounded-xl border border-bistro-border bg-white px-3"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium text-bistro-text-primary">País (opcional)</span>
            <input
              value={country}
              onChange={(event) => setCountry(event.target.value)}
              placeholder="Venezuela"
              className="h-11 w-full rounded-xl border border-bistro-border bg-white px-3"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium text-bistro-text-primary">Estilo culinario</span>
            <input
              value={style}
              onChange={(event) => setStyle(event.target.value)}
              placeholder="Casera / Gourmet / Tradicional"
              className="h-11 w-full rounded-xl border border-bistro-border bg-white px-3"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="inline-flex items-center gap-2 font-medium text-bistro-text-primary">
              <Hash size={14} /> Tags
            </span>
            <input
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="tradicional, familia, sopas"
              className="h-11 w-full rounded-xl border border-bistro-border bg-white px-3"
            />
          </label>
          <label className="space-y-1 text-sm md:col-span-2">
            <span className="font-medium text-bistro-text-primary">Descripción editorial</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Contexto del libro y valor para la plataforma..."
              className="min-h-[110px] w-full rounded-xl border border-bistro-border bg-white px-3 py-2"
            />
          </label>
        </div>

        <div className="mt-4 rounded-2xl border border-dashed border-bistro-border bg-bistro-page p-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={onFileChange}
          />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-bistro-text-primary">Documento PDF</p>
              <p className="text-xs text-bistro-text-secondary">
                {selectedFile ? selectedFile.name : 'Ningún archivo seleccionado'}
              </p>
            </div>
            <button
              type="button"
              disabled={working}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-bistro-border bg-white px-3 py-2 text-sm font-semibold text-bistro-text-secondary hover:border-bistro-action-primary/35"
            >
              <FileUp size={14} /> Seleccionar PDF
            </button>
          </div>
        </div>

        {progress ? (
          <div role="status" aria-live="polite" className="mt-3 space-y-2 rounded-xl border border-bistro-border bg-bistro-page p-3 text-sm">
            <p className="font-semibold text-bistro-text-primary">
              {progress.stage === 'extract' ? `Extrayendo texto: ${progress.completed} de ${progress.total || '…'} páginas`
                : progress.stage === 'wait' ? `Límite temporal: esperando ${progress.seconds} segundos. ${progress.completed} de ${progress.total} fragmentos listos.`
                : progress.stage === 'embed' ? `Generando embeddings: ${progress.completed} de ${progress.total} fragmentos`
                : 'Guardando el PDF completo y su índice…'}
            </p>
            {progress.total > 0 ? (
              <progress aria-label="Progreso de indexación" className="h-2 w-full accent-bistro-action-secondary" value={progress.completed} max={progress.total} />
            ) : <p className="text-bistro-text-secondary">Mantené esta página abierta hasta que termine el proceso.</p>}
          </div>
        ) : null}

        {coverage && coverage.textPages < coverage.pageCount ? (
          <p className="mt-3 rounded-xl border border-bistro-warning/30 bg-bistro-warning/10 px-3 py-2 text-sm text-bistro-warning">
            Se encontró texto en {coverage.textPages} de {coverage.pageCount} páginas.
            Las {coverage.pageCount - coverage.textPages} páginas restantes no tienen texto extraíble.{' '}
            {message ? 'Se conservó el PDF original completo.' : 'Se conservará el PDF original completo si la carga finaliza.'} No se aplica OCR.
          </p>
        ) : null}

        {error ? (
          <p className="mt-3 rounded-xl border border-bistro-danger/30 bg-bistro-danger/10 px-3 py-2 text-sm text-bistro-danger">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className="mt-3 rounded-xl border border-bistro-action-secondary/30 bg-bistro-action-secondary/10 px-3 py-2 text-sm text-bistro-action-secondary">
            {message}
          </p>
        ) : null}

        <button
          type="button"
          onClick={() => void onSubmit()}
          disabled={working}
          className="mt-4 rounded-xl bg-bistro-action-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-bistro-action-primary disabled:opacity-60"
        >
          {working ? 'Procesando...' : 'Subir e indexar PDF global'}
        </button>
      </article>
    </section>
  );
}
