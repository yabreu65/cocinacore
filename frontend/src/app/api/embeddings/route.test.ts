import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getGeminiApiKey: vi.fn(),
  getGeminiEmbeddingModel: vi.fn(),
  checkRateLimit: vi.fn(),
  requireUser: vi.fn(),
  isPlatformOwner: vi.fn(),
}));

vi.mock('@/lib/ai/gemini-config', () => ({
  getGeminiApiKey: mocks.getGeminiApiKey,
  getGeminiEmbeddingModel: mocks.getGeminiEmbeddingModel,
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock('@/lib/auth/server', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/db/repositories/platformOwnerRepository', () => ({
  isPlatformOwner: mocks.isPlatformOwner,
}));

import { POST } from './route';

function request(): NextRequest {
  return new NextRequest('http://localhost/api/embeddings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ texts: ['cebolla'] }),
  });
}

describe('POST /api/embeddings error boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getGeminiApiKey.mockReturnValue('test-key');
    mocks.getGeminiEmbeddingModel.mockReturnValue('test-model');
    mocks.requireUser.mockResolvedValue({
      id: 'owner-1',
      tenant: { tenantId: 'tenant-1', role: 'owner', tenantType: 'home' },
    });
    mocks.isPlatformOwner.mockResolvedValue(true);
    mocks.checkRateLimit.mockResolvedValue({
      success: true,
      limit: 10,
      remaining: 9,
      resetAt: Math.floor(Date.now() / 1000) + 60,
      storage: 'redis',
    });
  });

  it('returns a generic response when the server key is unavailable', async () => {
    mocks.getGeminiApiKey.mockReturnValue('');

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'El servicio de embeddings no está disponible temporalmente.',
    });
  });

  it('requires an authenticated platform owner before consuming provider quota', async () => {
    mocks.requireUser.mockRejectedValueOnce(new Error('Unauthorized'));

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
  });

  it('rejects authenticated users without platform-owner authorization', async () => {
    mocks.isPlatformOwner.mockResolvedValueOnce(false);

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
  });

  it('does not expose an upstream body or private payload on malformed provider output', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ secret: 'private provider details' }), { status: 200 })
      );
    try {
      const response = await POST(request());
      const body = (await response.json()) as { error: string };

      expect(response.status).toBe(502);
      expect(body.error).toBe('No se pudieron generar embeddings temporalmente.');
      expect(body.error).not.toContain('private provider details');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it.each([
    null,
    { embeddings: [null] },
    { embeddings: [{ values: [] }] },
    { embeddings: [{ values: [1, '2'] }] },
    { embeddings: [{ values: [1, null] }] },
    { embeddings: [{ values: [1] }, { values: [2] }] },
  ])('rejects malformed embedding payload %#', async (payload) => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(new Response(JSON.stringify(payload))));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const response = await POST(request());
      expect(response.status).toBe(502);
      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('accepts valid nested vectors and normalizes their dimensions', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ embeddings: [{ embedding: { values: [0.25, 0.5] } }] }))
        )
    );
    try {
      const response = await POST(request());
      const body = (await response.json()) as { embeddings: number[][] };
      expect(response.status).toBe(200);
      expect(body.embeddings[0]).toHaveLength(1536);
      expect(body.embeddings[0].slice(0, 3)).toEqual([0.25, 0.5, 0]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
