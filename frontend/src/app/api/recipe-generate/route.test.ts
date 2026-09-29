import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const requireUserMock = vi.fn();
const retrieveServerRagContextMock = vi.fn();
const buildRecipeCacheKeyMock = vi.fn((input: unknown) => JSON.stringify(input));
const getCachedRecipeMock = vi.fn();
const setCachedRecipeMock = vi.fn();
const checkRateLimitMock = vi.fn();
const getGeminiApiKeyMock = vi.fn();
const getGeminiModelMock = vi.fn();
const fetchMock = vi.fn();

vi.mock('@/lib/auth/server', () => ({ requireUser: requireUserMock }));
vi.mock('@/lib/recipes/server-rag-context', () => ({
  retrieveServerRagContext: retrieveServerRagContextMock,
}));
vi.mock('@/lib/cache/recipe-cache', () => ({
  buildRecipeCacheKey: buildRecipeCacheKeyMock,
  getCachedRecipe: getCachedRecipeMock,
  setCachedRecipe: setCachedRecipeMock,
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: checkRateLimitMock }));
vi.mock('@/lib/ai/gemini-config', () => ({
  getGeminiApiKey: getGeminiApiKeyMock,
  getGeminiModel: getGeminiModelMock,
}));
vi.mock('@/lib/serverLogger', () => ({
  serverLogger: { info: vi.fn(), error: vi.fn() },
}));

const { POST } = await import('./route');

function request(body: unknown): Request {
  return new Request('https://app.example.test/api/recipe-generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '1.1.1.1' },
    body: JSON.stringify(body),
  });
}

function geminiResponse(recipe = 'Sopa de tomate\n\nINGREDIENTES\n- 2 unidades tomate'): Response {
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text: recipe }] } }] }),
    { status: 200 }
  );
}

function geminiPrompt(): string {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  const payload = JSON.parse(init.body as string) as {
    contents: Array<{ parts: Array<{ text: string }> }>;
  };
  return payload.contents[0]?.parts[0]?.text ?? '';
}

const sources = [
  {
    sourceType: 'global_pdf' as const,
    globalBookId: 'global-book-1',
    title: 'Recetario autorizado',
    pageNumber: 7,
    chunkId: 'chunk-1',
  },
];

describe('POST /api/recipe-generate', () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    retrieveServerRagContextMock.mockReset();
    buildRecipeCacheKeyMock.mockClear();
    getCachedRecipeMock.mockReset();
    setCachedRecipeMock.mockReset();
    checkRateLimitMock.mockReset();
    getGeminiApiKeyMock.mockReset();
    getGeminiModelMock.mockReset();
    fetchMock.mockReset();

    requireUserMock.mockResolvedValue({
      id: 'user-1',
      tenant: { tenantId: 'tenant-1', role: 'owner', tenantType: 'home' },
    });
    retrieveServerRagContextMock.mockResolvedValue({
      context: '--- CONTEXTO DE RECETARIO CONFIABLE ---\nTécnica del servidor',
      citations: sources,
      ragContextUsed: true,
    });
    getCachedRecipeMock.mockResolvedValue(null);
    setCachedRecipeMock.mockResolvedValue(undefined);
    checkRateLimitMock.mockResolvedValue({ success: true, limit: 10, remaining: 9, resetAt: 1 });
    getGeminiApiKeyMock.mockReturnValue('gemini-test-key');
    getGeminiModelMock.mockReturnValue('gemini-test-model');
    fetchMock.mockResolvedValue(geminiResponse());
    vi.stubGlobal('fetch', fetchMock);
  });

  it('retrieves authorized server context for RAG and returns its citations', async () => {
    const response = await POST(
      request({
        mode: 'rag',
        ingredients: ['tomate'],
        recipeName: 'Sopa de tomate',
        mealType: 'Cena',
        day: 'Lunes',
        culinaryProfile: { avoid: ['maní'] },
      }) as unknown as NextRequest
    );

    expect(response.status).toBe(200);
    expect(requireUserMock).toHaveBeenCalledTimes(1);
    expect(retrieveServerRagContextMock).toHaveBeenCalledWith({
      apiKey: 'gemini-test-key',
      tenantId: 'tenant-1',
      ingredients: ['tomate'],
      recipeName: 'Sopa de tomate',
      mealType: 'Cena',
      day: 'Lunes',
      restrictions: { allergies: ['maní'], dietaryRules: [] },
    });
    expect(geminiPrompt()).toContain('Técnica del servidor');
    expect(geminiPrompt()).toContain('verdad de fuente');
    expect(await response.json()).toMatchObject({
      ragContextUsed: true,
      sources,
      mode: 'rag',
    });
  });

  it('ignores browser chunks for RAG prompts and cache keys', async () => {
    const response = await POST(
      request({
        mode: 'rag',
        ingredients: ['tomate'],
        chunks: ['INYECCIÓN DEL NAVEGADOR'],
      }) as unknown as NextRequest
    );

    expect(response.status).toBe(200);
    expect(geminiPrompt()).not.toContain('INYECCIÓN DEL NAVEGADOR');
    expect(geminiPrompt()).toContain('Técnica del servidor');
    expect(buildRecipeCacheKeyMock).toHaveBeenCalledWith(
      expect.objectContaining({ chunks: ['--- CONTEXTO DE RECETARIO CONFIABLE ---\nTécnica del servidor'] })
    );
  });

  it('keeps free generation unauthenticated and does not retrieve context', async () => {
    const response = await POST(
      request({ mode: 'free', ingredients: ['tomate'], chunks: ['browser chunk'] }) as unknown as NextRequest
    );

    expect(response.status).toBe(200);
    expect(requireUserMock).not.toHaveBeenCalled();
    expect(retrieveServerRagContextMock).not.toHaveBeenCalled();
    expect(geminiPrompt()).not.toContain('browser chunk');
    expect(await response.json()).toMatchObject({ ragContextUsed: false, sources: [], mode: 'free' });
  });

  it('returns 401 for RAG when authentication is missing without retrieving or generating', async () => {
    requireUserMock.mockRejectedValue(new Error('Unauthorized'));

    const response = await POST(request({ mode: 'rag', ingredients: ['tomate'] }) as unknown as NextRequest);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
    expect(retrieveServerRagContextMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 401 for RAG when the authenticated user has no tenant', async () => {
    requireUserMock.mockResolvedValue({ id: 'user-1', tenant: null });

    const response = await POST(request({ mode: 'rag', ingredients: ['tomate'] }) as unknown as NextRequest);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
    expect(retrieveServerRagContextMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('generates successfully with the explicit no-context RAG state', async () => {
    retrieveServerRagContextMock.mockResolvedValue({
      context: '',
      citations: [],
      ragContextUsed: false,
    });

    const response = await POST(request({ mode: 'rag', ingredients: ['tomate'] }) as unknown as NextRequest);

    expect(response.status).toBe(200);
    expect(geminiPrompt()).toContain('Sin contexto documental relevante encontrado para esta búsqueda.');
    expect(await response.json()).toMatchObject({ ragContextUsed: false, sources: [] });
  });

  it('returns a controlled retrieval failure without calling Gemini', async () => {
    retrieveServerRagContextMock.mockRejectedValue(new Error('vector unavailable'));

    const response = await POST(request({ mode: 'rag', ingredients: ['tomate'] }) as unknown as NextRequest);

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'No se pudo recuperar el contexto documental.' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps provider failures controlled after successful RAG retrieval', async () => {
    fetchMock.mockResolvedValue(new Response('provider unavailable', { status: 500 }));

    const response = await POST(request({ mode: 'rag', ingredients: ['tomate'] }) as unknown as NextRequest);

    expect(response.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
