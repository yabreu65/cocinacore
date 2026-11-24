import {
  assertPdfUploadSize,
  chunkPdfPage,
  embedPdfChunks,
  embeddingDeadlineMs,
  estimatedPdfChunkBytes,
  preparePdfChunks,
  type ParsedChunk,
} from '@/app/owner/global-pdfs/upload/pdf-embeddings';

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PAGES = 500;
const MAX_CHUNKS = 1000;

type Progress = { stage: 'extract' | 'embed' | 'wait' | 'upload'; completed: number; total: number; seconds?: number };
type TextItem = { str?: unknown };

export async function uploadPrivatePdf(
  file: File,
  title: string,
  author: string,
  onProgress: (progress: Progress) => void,
): Promise<void> {
  const cleanTitle = new TextDecoder().decode(new TextEncoder().encode(title.trim()));
  const cleanAuthor = new TextDecoder().decode(new TextEncoder().encode(author.trim()));
  if (!cleanTitle || cleanTitle.length > 160 || cleanAuthor.length > 160 || /[\u0000-\u001f\u007f]/.test(cleanTitle + cleanAuthor)) {
    throw new Error('Ingresá un título válido y un autor de hasta 160 caracteres.');
  }
  if (file.type !== 'application/pdf' || file.size > MAX_BYTES || file.size < 5) {
    throw new Error('Elegí un archivo PDF válido de hasta 10 MiB.');
  }
  const data = new Uint8Array(await file.arrayBuffer());
  if (![0x25, 0x50, 0x44, 0x46, 0x2d].every((byte, index) => data[index] === byte)) {
    throw new Error('El archivo no tiene una firma PDF válida.');
  }
  onProgress({ stage: 'extract', completed: 0, total: 0 });
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  const task = pdfjs.getDocument({ data });
  let pageCount: number;
  const chunks: ParsedChunk[] = [];
  const metadataBytes = new TextEncoder().encode(JSON.stringify({ title: cleanTitle, author: cleanAuthor }) + file.name).byteLength;
  let estimatedBytes = file.size + metadataBytes + 2;
  try {
    const pdf = await task.promise;
    pageCount = pdf.numPages;
    if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > MAX_PAGES) {
      throw new Error('El PDF debe tener entre 1 y 500 páginas.');
    }
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const rawText = (content.items as TextItem[])
        .map((item) => typeof item.str === 'string' ? item.str : '')
        .join(' ');
      // PostgreSQL cannot store NUL; encoding also replaces unpaired UTF-16 surrogates.
      const safeText = new TextDecoder().decode(new TextEncoder().encode(rawText)).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ');
      // Chunk boundaries may split a surrogate pair, so normalize each result too.
      const pageChunks = chunkPdfPage(safeText, pageNumber).map((chunk) => ({
        ...chunk,
        content: new TextDecoder().decode(new TextEncoder().encode(chunk.content)),
      }));
      if (chunks.length + pageChunks.length > MAX_CHUNKS) {
        throw new Error('El PDF supera el límite de 1000 fragmentos de texto.');
      }
      for (const chunk of pageChunks) {
        estimatedBytes += estimatedPdfChunkBytes(chunk);
        assertPdfUploadSize(estimatedBytes);
        chunks.push(chunk);
      }
      onProgress({ stage: 'extract', completed: pageNumber, total: pageCount });
    }
  } finally {
    await task.destroy();
  }
  const candidates = preparePdfChunks(chunks, file.size, metadataBytes);
  onProgress({ stage: 'embed', completed: 0, total: candidates.length });
  const embeddings = await embedPdfChunks(
    candidates,
    (completed, total) => onProgress({ stage: 'embed', completed, total }),
    (completed, total, seconds) => onProgress({ stage: 'wait', completed, total, seconds }),
    '/api/library/private-pdfs/embeddings',
    AbortSignal.timeout(embeddingDeadlineMs(candidates)),
  );
  const chunksJson = JSON.stringify(candidates.map((chunk, index) => ({ ...chunk, embedding: embeddings[index] })));
  assertPdfUploadSize(file.size + metadataBytes + new TextEncoder().encode(chunksJson).byteLength);
  const form = new FormData();
  form.set('file', file);
  form.set('title', cleanTitle);
  form.set('author', cleanAuthor);
  form.set('pageCount', String(pageCount));
  form.set('chunks', chunksJson);
  onProgress({ stage: 'upload', completed: 0, total: 0 });
  let response: Response;
  try {
    response = await fetch('/api/library/private-pdfs', { method: 'POST', body: form, signal: AbortSignal.timeout(120_000) });
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new Error('La carga tardó demasiado. Revisá tu biblioteca antes de volver a intentarlo: el servidor podría haberla guardado.');
    }
    throw new Error('No se pudo confirmar la carga. Revisá tu biblioteca antes de volver a intentarlo.');
  }
  if (!response.ok) {
    if (response.status === 409) throw new Error('El PDF ya existe o alcanzaste el límite de tu plan.');
    if (response.status === 401 || response.status === 403) throw new Error('Iniciá sesión con acceso a tu hogar para subir el PDF.');
    throw new Error('No se pudo guardar el PDF. Intentá nuevamente más tarde.');
  }
}
