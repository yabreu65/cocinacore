export type ParsedChunk = { content: string; pageNumber: number };

// Preserve the existing per-document bound rather than silently truncating books.
export const MAX_PDF_CHUNKS = 160;
const BATCH_SIZE = 100;
const BATCH_CHAR_LIMIT = 100_000;
const VECTOR_DIMENSIONS = 1536;

export function preparePdfChunks(chunks: ParsedChunk[]): ParsedChunk[] {
  if (!chunks.length) {
    throw new Error('El PDF no contiene texto extraíble. Usá una versión con texto o aplicá OCR antes de subirlo.');
  }
  if (chunks.length > MAX_PDF_CHUNKS) {
    throw new Error('El PDF supera el límite actual de 160 fragmentos. Dividí el libro en partes para indexar todo el contenido.');
  }
  return chunks;
}

function isValidVector(value: unknown): value is number[] {
  return Array.isArray(value) &&
    value.length === VECTOR_DIMENSIONS &&
    value.every((entry) => typeof entry === 'number' && Number.isFinite(entry)) &&
    value.some((entry) => entry !== 0);
}

export async function embedPdfChunks(chunks: ParsedChunk[]): Promise<number[][]> {
  const candidates = preparePdfChunks(chunks);
  const batches: string[][] = [];
  let batch: string[] = [];
  let characters = 0;
  for (const { content } of candidates) {
    if (!content.trim() || content.length > 5000) {
      throw new Error('El PDF contiene un fragmento de texto inválido.');
    }
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
  for (const texts of batches) {
    const response = await fetch('/api/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts }),
    });
    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => null);
      const message = payload && typeof payload === 'object' && 'error' in payload &&
        typeof payload.error === 'string' ? payload.error : 'Error de embeddings.';
      throw new Error(message);
    }
    const payload: unknown = await response.json();
    const vectors = payload && typeof payload === 'object' && 'embeddings' in payload
      ? payload.embeddings : null;
    if (!Array.isArray(vectors) || vectors.length !== texts.length || !vectors.every(isValidVector)) {
      throw new Error('El servicio de embeddings devolvió un resultado incompleto o inválido. No se indexó el PDF.');
    }
    embeddings.push(...vectors);
  }
  return embeddings;
}
