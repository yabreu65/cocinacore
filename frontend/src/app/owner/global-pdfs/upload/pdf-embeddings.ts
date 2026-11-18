export type ParsedChunk = { content: string; pageNumber: number };

// Nginx allows 50 MiB for the multipart upload. Reserve 1 MiB for
// multipart framing and headers; preflight text, vectors and metadata in UTF-8.
export const PDF_UPLOAD_BUDGET_BYTES = 49 * 1024 * 1024;
const BATCH_SIZE = 100;
const BATCH_CHAR_LIMIT = 100_000;
const VECTOR_DIMENSIONS = 1536;
const MAX_RETRIES_PER_BATCH = 2;
const MAX_RETRIES_PER_UPLOAD = 6;
const MAX_RETRY_DELAY_SECONDS = 120;
// Conservative per-upload pacing for the observed free-tier quota of
// 100 embedding inputs/minute. Other clients can still consume shared quota.
const MIN_BATCH_PAUSE_SECONDS = 61;
// A finite JS number serialized as JSON needs at most 25 ASCII bytes,
// plus one separator. This upper bound avoids provider calls for oversized uploads.
const MAX_VECTOR_JSON_BYTES = VECTOR_DIMENSIONS * 26;
const encoder = new TextEncoder();

export function chunkPdfPage(content: string, pageNumber: number): ParsedChunk[] {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  const chunks: ParsedChunk[] = [];
  let start = 0;
  while (start < normalized.length) {
    const end = Math.min(start + 900, normalized.length);
    const piece = normalized.slice(start, end).trim();
    if (piece) chunks.push({ content: piece, pageNumber });
    if (end >= normalized.length) break;
    start = end - 120;
  }
  return chunks;
}

export function assertPdfUploadSize(bytes: number): void {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > PDF_UPLOAD_BUDGET_BYTES) {
    throw new Error('El PDF y su índice superan el tamaño de carga admitido por el servidor (50 MiB). No se guardó el libro.');
  }
}

export function estimatedPdfChunkBytes(chunk: ParsedChunk): number {
  if (!chunk.content.trim() || chunk.content.length > 5000 ||
    !Number.isSafeInteger(chunk.pageNumber) || chunk.pageNumber < 1) {
    throw new Error('El PDF contiene un fragmento de texto inválido.');
  }
  return encoder.encode(JSON.stringify({ ...chunk, embedding: [] })).byteLength
    + MAX_VECTOR_JSON_BYTES + 1;
}

export function preparePdfChunks(
  chunks: ParsedChunk[],
  fileSizeBytes = 0,
  metadataBytes = 0,
): ParsedChunk[] {
  if (!chunks.length) {
    throw new Error('El PDF no contiene texto extraíble. Usá una versión con texto o aplicá OCR antes de subirlo.');
  }
  assertPdfUploadSize(fileSizeBytes);
  assertPdfUploadSize(metadataBytes);
  let bytes = fileSizeBytes + metadataBytes + 2;
  for (const chunk of chunks) {
    bytes += estimatedPdfChunkBytes(chunk);
    assertPdfUploadSize(bytes);
  }
  return chunks;
}

function isValidVector(value: unknown): value is number[] {
  return Array.isArray(value) &&
    value.length === VECTOR_DIMENSIONS &&
    value.every((entry) => typeof entry === 'number' && Number.isFinite(entry)) &&
    value.some((entry) => entry !== 0);
}

export async function embedPdfChunks(
  chunks: ParsedChunk[],
  onProgress?: (completed: number, total: number) => void,
  onWait?: (completed: number, total: number, seconds: number) => void,
): Promise<number[][]> {
  const candidates = preparePdfChunks(chunks);
  const batches: string[][] = [];
  let batch: string[] = [];
  let characters = 0;
  for (const { content } of candidates) {
    if (batch.length >= BATCH_SIZE || characters + content.length > BATCH_CHAR_LIMIT) {
      batches.push(batch);
      batch = [];
      characters = 0;
    }
    batch.push(content);
    characters += content.length;
  }
  if (batch.length) batches.push(batch);

  const embeddings: number[][] = [];
  let retries = 0;
  const pause = async (seconds: number) => {
    onWait?.(embeddings.length, candidates.length, seconds);
    await new Promise<void>((resolve) => setTimeout(resolve, seconds * 1000));
  };
  for (const texts of batches) {
    if (embeddings.length > 0) await pause(MIN_BATCH_PAUSE_SECONDS);
    let batchRetries = 0;
    let response: Response;
    while (true) {
      response = await fetch('/api/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts }),
      });
      if (response.ok) break;
      const payload: unknown = await response.json().catch(() => null);
      const message = payload && typeof payload === 'object' && 'error' in payload &&
        typeof payload.error === 'string' ? payload.error : 'Error de embeddings.';
      const header = response.headers.get('Retry-After');
      const seconds = header && /^\d+$/.test(header) ? Number(header) : null;
      if (response.status !== 429 || seconds === null || !Number.isSafeInteger(seconds) ||
        seconds < 1 || seconds > MAX_RETRY_DELAY_SECONDS ||
        batchRetries >= MAX_RETRIES_PER_BATCH || retries >= MAX_RETRIES_PER_UPLOAD) {
        throw new Error(message);
      }
      batchRetries += 1;
      retries += 1;
      await pause(Math.max(MIN_BATCH_PAUSE_SECONDS, seconds));
    }
    const payload: unknown = await response.json();
    const vectors = payload && typeof payload === 'object' && 'embeddings' in payload
      ? payload.embeddings : null;
    if (!Array.isArray(vectors) || vectors.length !== texts.length || !vectors.every(isValidVector)) {
      throw new Error('El servicio de embeddings devolvió un resultado incompleto o inválido. No se indexó el PDF.');
    }
    embeddings.push(...vectors);
    onProgress?.(embeddings.length, candidates.length);
  }
  return embeddings;
}
