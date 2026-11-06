import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getGeminiApiKey: vi.fn(),
  getGeminiModel: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock('@/lib/ai/gemini-config', () => ({
  getGeminiApiKey: mocks.getGeminiApiKey,
  getGeminiModel: mocks.getGeminiModel,
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mocks.checkRateLimit }));

import { POST } from './route';

function request(
  body: unknown = { menuContent: 'Sopa de verduras' },
  signal?: AbortSignal
): NextRequest {
  return new NextRequest('http://localhost/api/meal-plan/inventory-suggestion', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}

describe('POST /api/meal-plan/inventory-suggestion error boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getGeminiApiKey.mockReturnValue('test-key');
    mocks.getGeminiModel.mockReturnValue('test-model');
    mocks.checkRateLimit.mockResolvedValue({
      success: true,
      limit: 10,
      remaining: 9,
      resetAt: Math.floor(Date.now() / 1000) + 60,
      storage: 'redis',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('returns a generic response when the server key is unavailable', async () => {
    mocks.getGeminiApiKey.mockReturnValue('');

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'La sugerencia de inventario no está disponible temporalmente.',
    });
  });

  it('handles network exceptions and malformed provider JSON without leaking details', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('private prompt and provider payload'));
    try {
      const response = await POST(request());
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({
        error: 'No se pudo calcular inventario sugerido temporalmente.',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it.each([
    { menuContent: 'Soup', inventory: 'not an array' },
    { menuContent: 'Soup', restrictions: [null] },
    { menuContent: 'Soup', profile: { preferred: [123] } },
    { menuContent: 'Soup', profile: { level: {} } },
    { menuContent: 'Soup', inventory: Array(81).fill('x') },
  ])('rejects malformed legacy fields before calling the provider', async (body) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await POST(request(body));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns validated items and strips unexpected provider fields', async () => {
    const item = {
      ingredient: 'Tomato',
      quantity: 2,
      unit: 'unit',
      estimated: false,
      confidence: 0.9,
      source: 'Lunch',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: `\`\`\`json\n${JSON.stringify({ items: [{ ...item, secret: 'ignored' }] })}\n\`\`\``,
                  },
                ],
              },
            },
          ],
        })
      )
    );
    const response = await POST(
      request({
        menuContent: 'Soup',
        peopleCount: 2,
        inventory: ['Tomato'],
        profile: { level: null },
      })
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [item], peopleCount: 2 });
  });

  it.each([
    null,
    {},
    { candidates: [null] },
    { candidates: [{ content: { parts: [{ text: '{invalid' }] } }] },
    { candidates: [{ content: { parts: [{ text: '{}' }] } }] },
    {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  items: [
                    {
                      ingredient: 'x',
                      quantity: -1,
                      unit: 'g',
                      estimated: false,
                      confidence: 2,
                      source: 'x',
                    },
                  ],
                }),
              },
            ],
          },
        },
      ],
    },
  ])('rejects malformed provider content safely', async (payload) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(payload)));
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: 'No se pudo calcular inventario sugerido temporalmente.',
    });
  });

  it('fails closed when the rate limit store throws', async () => {
    mocks.checkRateLimit.mockRejectedValue(new Error('secret'));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('secret');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aborts a hung provider request at the deadline', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, options: RequestInit) => {
        signal = options.signal ?? undefined;
        return new Promise(() => {});
      })
    );
    const pending = POST(request());
    await vi.advanceTimersByTimeAsync(30_000);
    const response = await pending;
    expect(signal?.aborted).toBe(true);
    expect(response.status).toBe(504);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('times out even if the response body never completes', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, options: RequestInit) => {
        signal = options.signal ?? undefined;
        return { ok: true, json: () => new Promise(() => {}) };
      })
    );
    const pending = POST(request());
    await vi.advanceTimersByTimeAsync(30_000);
    expect((await pending).status).toBe(504);
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('handles upstream HTTP errors and invalid response JSON safely', async () => {
    for (const upstream of [new Response('secret', { status: 500 }), new Response('not JSON')]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(upstream));
      const response = await POST(request());
      expect(response.status).toBe(502);
      expect(JSON.stringify(await response.json())).not.toContain('secret');
    }
  });

  it('aborts while reading the provider response when the client disconnects', async () => {
    const client = new AbortController();
    let signal: AbortSignal | undefined;
    let started!: () => void;
    const reading = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, options: RequestInit) => {
        signal = options.signal ?? undefined;
        return {
          ok: true,
          json: () => {
            started();
            return new Promise(() => {});
          },
        };
      })
    );
    const pending = POST(request(undefined, client.signal));
    await reading;
    client.abort();
    const response = await pending;
    expect(signal?.aborted).toBe(true);
    expect(response.status).toBe(499);
  });

  it('does not call the provider when the client is already aborted', async () => {
    const client = new AbortController();
    client.abort();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await POST(request(undefined, client.signal));
    expect(response.status).toBe(499);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
