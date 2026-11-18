import { afterEach, describe, expect, it, vi } from 'vitest';
import { embedPdfChunks, preparePdfChunks } from './pdf-embeddings';
import { EmbeddingsSchema } from '@/lib/validation';

const chunks = (count: number, size = 900) =>
  Array.from({ length: count }, (_, i) => ({
    content: String(i).padStart(4, '0') + 'a'.repeat(size - 4),
    pageNumber: i + 1,
  }));
const vector = (n: number) => [n + 1, ...Array<number>(1535).fill(0)];

afterEach(() => vi.unstubAllGlobals());

describe('global PDF embedding preparation', () => {
  it('rejects empty extraction without creating a synthetic chunk', () => {
    expect(() => preparePdfChunks([])).toThrow('no contiene texto extraíble');
  });
  it('rejects oversize documents instead of silently truncating them', () => {
    expect(() => preparePdfChunks(chunks(161))).toThrow('160 fragmentos');
  });
  it('preserves page attribution and every fragment within the document limit', () => {
    const input = chunks(160);
    expect(preparePdfChunks(input)).toEqual(input);
  });
  it.each([900, 5000])('batches all 160 fragments of %i characters within the API contract', async (size) => {
    const input = chunks(160, size);
    const requests: string[][] = [];
    const mockFetch = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { texts: string[] };
      expect(EmbeddingsSchema.safeParse(body).success).toBe(true);
      requests.push(body.texts);
      return Response.json({ embeddings: body.texts.map((t) => vector(Number(t.slice(0, 4)))) });
    });
    vi.stubGlobal('fetch', mockFetch);
    expect(await embedPdfChunks(input)).toEqual(input.map((_, i) => vector(i)));
    expect(requests.length).toBeGreaterThan(1);
    expect(requests.flat()).toEqual(input.map((c) => c.content));
  });
  it('stops on a failed later batch rather than returning partial results', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ embeddings: chunks(100).map((_, i) => vector(i)) }))
      .mockResolvedValueOnce(Response.json({ error: 'Servicio no disponible' }, { status: 503 }));
    vi.stubGlobal('fetch', mockFetch);
    await expect(embedPdfChunks(chunks(160))).rejects.toThrow('Servicio no disponible');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
  it.each([
    { vectors: [] },
    { vectors: [[0.1]] },
    { vectors: [Array<number>(1536).fill(0)] },
  ])('rejects invalid or incomplete response vectors', async ({ vectors }) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ embeddings: vectors })));
    await expect(embedPdfChunks(chunks(1))).rejects.toThrow('resultado incompleto o inválido');
  });
  it('does not request embeddings for missing or oversized content', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    await expect(embedPdfChunks([])).rejects.toThrow('no contiene texto extraíble');
    await expect(embedPdfChunks(chunks(161))).rejects.toThrow('160 fragmentos');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
