import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertPdfUploadSize, chunkPdfPage, embedPdfChunks, preparePdfChunks, PDF_UPLOAD_BUDGET_BYTES } from './pdf-embeddings';
import { EmbeddingsSchema } from '@/lib/validation';

const chunks = (count: number, size = 900) =>
  Array.from({ length: count }, (_, i) => ({
    content: String(i).padStart(4, '0') + 'a'.repeat(size - 4),
    pageNumber: i + 1,
  }));
const vector = (n: number) => [n + 1, ...Array<number>(1535).fill(0)];

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('global PDF embedding preparation', () => {
  it('rejects empty extraction without creating a synthetic chunk', () => {
    expect(() => preparePdfChunks([])).toThrow('no contiene texto extraíble');
  });
  it('rejects oversize payloads instead of silently truncating them', () => {
    expect(() => preparePdfChunks(chunks(1), PDF_UPLOAD_BUDGET_BYTES)).toThrow('50 MiB');
    expect(() => assertPdfUploadSize(PDF_UPLOAD_BUDGET_BYTES + 1)).toThrow('50 MiB');
  });
  it('preserves every fragment of a representative 264-page cookbook within the transport budget', () => {
    const input = chunks(308).map((chunk, i) => ({ ...chunk, pageNumber: Math.min(i + 1, 264) }));
    expect(preparePdfChunks(input, 31_393_957, 4096)).toEqual(input);
  });
  it('preserves short text pages and the tail of a long page', () => {
    expect(chunkPdfPage('  Sal al gusto.  ', 7)).toEqual([{ content: 'Sal al gusto.', pageNumber: 7 }]);
    expect(chunkPdfPage('  ', 8)).toEqual([]);
    const input = 'a'.repeat(900) + ' FINAL';
    const result = chunkPdfPage(input, 9);
    expect(result).toHaveLength(2);
    expect(result[1].content).toMatch(/FINAL$/);
    expect(result.every((chunk) => chunk.pageNumber === 9)).toBe(true);
  });
  it.each([900, 5000])('batches all 308 fragments of %i characters within the API contract', async (size) => {
    vi.useFakeTimers();
    const input = chunks(308, size);
    const requests: string[][] = [];
    const mockFetch = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { texts: string[] };
      expect(EmbeddingsSchema.safeParse(body).success).toBe(true);
      requests.push(body.texts);
      return Response.json({ embeddings: body.texts.map((t) => vector(Number(t.slice(0, 4)))) });
    });
    vi.stubGlobal('fetch', mockFetch);
    const progress = vi.fn();
    const result = embedPdfChunks(input, progress);
    await vi.runAllTimersAsync();
    expect(await result).toEqual(input.map((_, i) => vector(i)));
    expect(progress).toHaveBeenLastCalledWith(308, 308);
    expect(progress).toHaveBeenCalledTimes(requests.length);
    expect(requests.length).toBeGreaterThan(1);
    expect(requests.every((batch) => batch.length <= 60)).toBe(true);
    expect(requests.every((batch) =>
      batch.reduce((sum, text) => sum + new TextEncoder().encode(text).byteLength, 0) <= 20_000,
    )).toBe(true);
    expect(requests.flat()).toEqual(input.map((c) => c.content));
  });
  it('uses UTF-8 bytes instead of character count for multilingual text', async () => {
    vi.useFakeTimers();
    const input = Array.from({ length: 18 }, (_, i) => ({
      content: '食'.repeat(900), pageNumber: i + 1,
    }));
    const requests: string[][] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const { texts } = JSON.parse(String(init.body)) as { texts: string[] };
      requests.push(texts);
      return Response.json({ embeddings: texts.map((_, i) => vector(i)) });
    }));
    const result = embedPdfChunks(input);
    await vi.runAllTimersAsync();
    expect(await result).toHaveLength(18);
    expect(requests.map((batch) => batch.length)).toEqual([7, 7, 4]);
    expect(requests.flat()).toEqual(input.map((chunk) => chunk.content));
  });

  it('stops on a failed later batch rather than returning partial results', async () => {
    vi.useFakeTimers();
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ embeddings: chunks(60, 100).map((_, i) => vector(i)) }))
      .mockResolvedValueOnce(Response.json({ error: 'Servicio no disponible' }, { status: 503 }));
    vi.stubGlobal('fetch', mockFetch);
    const result = expect(embedPdfChunks(chunks(160, 100))).rejects.toThrow('Servicio no disponible');
    await vi.runAllTimersAsync();
    await result;
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
  it('paces batches and retries only the rejected batch after a short Retry-After', async () => {
    vi.useFakeTimers();
    const input = chunks(108, 100);
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ embeddings: input.slice(0, 60).map((_, i) => vector(i)) }))
      .mockResolvedValueOnce(Response.json({ error: 'Cuota' }, { status: 429, headers: { 'Retry-After': '3' } }))
      .mockResolvedValueOnce(Response.json({ embeddings: input.slice(60).map((_, i) => vector(60 + i)) }));
    vi.stubGlobal('fetch', mockFetch);
    const progress = vi.fn();
    const waiting = vi.fn();
    const promise = embedPdfChunks(input, progress, waiting);
    await vi.advanceTimersByTimeAsync(0);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(waiting).toHaveBeenCalledWith(60, 108, 65);
    await vi.advanceTimersByTimeAsync(64_999);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(waiting).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(64_999);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(await promise).toEqual(input.map((_, i) => vector(i)));
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockFetch.mock.calls[1][1]).toEqual(mockFetch.mock.calls[2][1]);
    expect(progress.mock.calls).toEqual([[60, 108], [108, 108]]);
  });

  it('honors a longer provider Retry-After rather than shortening it', async () => {
    vi.useFakeTimers();
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: 'Cuota' }, { status: 429, headers: { 'Retry-After': '120' } }))
      .mockResolvedValueOnce(Response.json({ embeddings: [vector(0)] }));
    vi.stubGlobal('fetch', mockFetch);
    const result = embedPdfChunks(chunks(1));
    await vi.advanceTimersByTimeAsync(119_999);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual([vector(0)]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('backs off for the private endpoint when its 429 has no Retry-After', async () => {
    vi.useFakeTimers();
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: 'Cuota' }, { status: 429 }))
      .mockResolvedValueOnce(Response.json({ embeddings: [vector(0)] }));
    vi.stubGlobal('fetch', mockFetch);
    const waiting = vi.fn();
    const result = embedPdfChunks(chunks(1), undefined, waiting, '/api/library/private-pdfs/embeddings');
    await vi.advanceTimersByTimeAsync(64_999);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(waiting).toHaveBeenCalledWith(0, 1, 65);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual([vector(0)]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it.each([null, '121', 'bad'])('stops when there is no usable bounded retry instruction: %s', async (delay) => {
    const headers = new Headers();
    if (delay !== null) headers.set('Retry-After', delay);
    const mockFetch = vi.fn().mockResolvedValue(Response.json({ error: 'Cuota' }, { status: 429, headers }));
    vi.stubGlobal('fetch', mockFetch);
    await expect(embedPdfChunks(chunks(1))).rejects.toThrow('Cuota');
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('stops after two retries when the same batch remains rate limited', async () => {
    vi.useFakeTimers();
    const mockFetch = vi.fn().mockImplementation(() => Promise.resolve(
      Response.json({ error: 'Cuota' }, { status: 429, headers: { 'Retry-After': '1' } }),
    ));
    vi.stubGlobal('fetch', mockFetch);
    const result = expect(embedPdfChunks(chunks(1))).rejects.toThrow('Cuota');
    await vi.advanceTimersByTimeAsync(130_000);
    await result;
    expect(mockFetch).toHaveBeenCalledTimes(3);
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
    await expect(embedPdfChunks(chunks(1300))).rejects.toThrow('50 MiB');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
