/** Candidate bounds for the private upload lane. This does not parse PDF structure. */
export const PRIVATE_PDF_MAX_BYTES = 10 * 1024 * 1024;
export const PRIVATE_PDF_MAX_PAGES = 500;
export const PRIVATE_PDF_MAX_CHUNKS = 1000;
const MAX_CHUNK_LENGTH = 5000;
const VECTOR_DIMENSIONS = 1536;

export type PrivatePdfChunk = {
  content: string;
  pageNumber: number;
  embedding: number[];
};

export function validatePrivatePdfFile(type: string, bytes: Uint8Array): boolean {
  return type === 'application/pdf' && bytes.length >= 5 && bytes.length <= PRIVATE_PDF_MAX_BYTES &&
    bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
}

export function validatePrivatePdfIndex(pageCount: unknown, chunks: unknown): chunks is PrivatePdfChunk[] {
  if (typeof pageCount !== 'number' || !Number.isSafeInteger(pageCount) || pageCount < 1 ||
      pageCount > PRIVATE_PDF_MAX_PAGES || !Array.isArray(chunks) || chunks.length < 1 ||
      chunks.length > PRIVATE_PDF_MAX_CHUNKS) return false;

  return chunks.every((chunk: unknown) => {
    if (!chunk || typeof chunk !== 'object') return false;
    const value = chunk as Record<string, unknown>;
    return typeof value.content === 'string' && value.content.trim().length > 0 &&
      value.content.length <= MAX_CHUNK_LENGTH &&
      typeof value.pageNumber === 'number' && Number.isSafeInteger(value.pageNumber) &&
      value.pageNumber >= 1 && value.pageNumber <= pageCount &&
      Array.isArray(value.embedding) && value.embedding.length === VECTOR_DIMENSIONS &&
      value.embedding.every((entry: unknown) => typeof entry === 'number' && Number.isFinite(entry)) &&
      value.embedding.some((entry: number) => entry !== 0);
  });
}
