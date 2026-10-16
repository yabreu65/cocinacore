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
