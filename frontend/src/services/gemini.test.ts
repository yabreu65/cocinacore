import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeminiEmbeddingService } from './gemini';

function stalledFetch(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>) {
  let signal: AbortSignal | undefined;
  fetchMock.mockImplementationOnce((_input, init) => new Promise((_resolve, reject) => {
    signal = init?.signal as AbortSignal | undefined;
    signal?.addEventListener('abort', () => {
      reject(new DOMException('request aborted', 'AbortError'));
    }, { once: true });
  }));
  return () => signal;
}

describe('Gemini embedding cancellation', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('uses the configured model and exact stored vector dimensions for both query and batch', async () => {
    vi.stubEnv('GEMINI_EMBEDDING_MODEL', 'gemini-embedding-001');
    vi.stubEnv('GEMINI_BASE_URL', 'http://127.0.0.1:4319/v1beta');
    const values = Array.from({ length: 1536 }, (_, i) => i === 0 ? 1 : 0);
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ embedding: { values } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ embeddings: [{ values }] })));
    vi.stubGlobal('fetch', fetchMock);
    const service = new GeminiEmbeddingService('test-key');
    expect(await service.generateEmbedding('rice')).toEqual(values);
    expect(await service.generateEmbeddings(['rice'])).toEqual([values]);
    const [queryCall, batchCall] = fetchMock.mock.calls;
    expect(String(queryCall[0])).toContain('/models/gemini-embedding-001:embedContent');
    expect(queryCall[1]?.body).toEqual(expect.stringContaining('"outputDimensionality":1536'));
    expect(String(batchCall[0])).toContain('/models/gemini-embedding-001:batchEmbedContents');
    expect(batchCall[1]?.body).toEqual(expect.stringContaining('"outputDimensionality":1536'));
  });

  it('rejects incompatible vectors instead of padding or truncating them', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ embedding: { values: [1, 2] } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ embeddings: [{ values: Array(3072).fill(1) }] })));
    vi.stubGlobal('fetch', fetchMock);
    const service = new GeminiEmbeddingService('test-key');
    await expect(service.generateEmbedding('rice')).rejects.toThrow();
    await expect(service.generateEmbeddings(['rice'])).rejects.toThrow();
  });

  it('forwards an abort signal to the single RAG embedding request', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    const getSignal = stalledFetch(fetchMock);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    const pending = new GeminiEmbeddingService('test-key').generateEmbedding('rice', controller.signal);
    const rejected = expect(pending).rejects.toThrow();

    await vi.advanceTimersByTimeAsync(60_000);
    await rejected;
    clearTimeout(timeout);

    expect(getSignal()).toBe(controller.signal);
    expect(getSignal()?.aborted).toBe(true);
  });
});
