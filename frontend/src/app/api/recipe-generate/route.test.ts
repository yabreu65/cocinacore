import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const requireUserMock = vi.fn();
const loadPersistedRecipeContextMock = vi.fn();
const retrieveServerRagContextMock = vi.fn();
const buildRecipeCacheKeyMock = vi.fn((input: unknown) => JSON.stringify(input));
const hashRecipeContextMock = vi.fn(() => 'sha256-private-context');
const getCachedRecipeMock = vi.fn();
const setCachedRecipeMock = vi.fn();
const checkRateLimitMock = vi.fn();
const getGeminiApiKeyMock = vi.fn();
const getGeminiModelMock = vi.fn();
const fetchMock = vi.fn();

vi.mock('@/lib/auth/server', () => ({ requireUser: requireUserMock }));
vi.mock('@/lib/recipes/persisted-context', () => ({
  loadPersistedRecipeContext: loadPersistedRecipeContextMock,
}));
vi.mock('@/lib/recipes/server-rag-context', () => ({
  retrieveServerRagContext: retrieveServerRagContextMock,
}));
vi.mock('@/lib/cache/recipe-cache', () => ({
  buildRecipeCacheKey: buildRecipeCacheKeyMock,
  hashRecipeContext: hashRecipeContextMock,
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

function persistedContext(overrides: Record<string, unknown> = {}) {
  return {
    inventoryLines: ['- tomate: 2 kg'],
    inventoryContext: '- tomate: 2 kg',
    inventoryNames: ['tomate'],
    profile: {
      identity: ['Mediterránea'],
      preferred: ['Legumbres'],
      avoid: ['Maní'],
      goals: ['Comidas rápidas'],
      level: 'Intermedio',
    },
    profileContext:
      'Identidad/contexto: Mediterránea\n' +
      'Preferencias: Legumbres\n' +
      'Evitar: Maní\n' +
      'Objetivos: Comidas rápidas\n' +
      'Nivel: Intermedio',
    ...overrides,
  };
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
    loadPersistedRecipeContextMock.mockReset();
    retrieveServerRagContextMock.mockReset();
    buildRecipeCacheKeyMock.mockClear();
    hashRecipeContextMock.mockClear();
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
    loadPersistedRecipeContextMock.mockResolvedValue(persistedContext());
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

  it('loads authenticated tenant inventory and profile, keeping persisted sections authoritative', async () => {
    const response = await POST(
      request({
        mode: 'free',
        ingredients: ['zapallo'],
        culinaryProfile: {
          identity: ['Browser override'],
          preferred: ['Browser preference'],
          avoid: ['Browser avoid'],
          goals: ['Browser goal'],
          level: 'Browser level',
        },
      }) as unknown as NextRequest
    );

    expect(response.status).toBe(200);
    expect(requireUserMock).toHaveBeenCalledTimes(1);
    expect(loadPersistedRecipeContextMock).toHaveBeenCalledWith('user-1', 'tenant-1');
    expect(geminiPrompt()).toContain('Solicitud actual:');
    expect(geminiPrompt()).toContain('Ingredientes solicitados explícitamente: zapallo');
    expect(geminiPrompt()).toContain('solo el foco de la receta actual; no prueban disponibilidad');
    expect(geminiPrompt()).toContain('Inventario real del hogar:\n- tomate: 2 kg');
    expect(geminiPrompt()).toContain('Perfil culinario persistido del usuario autenticado:');
    expect(geminiPrompt()).toContain('Identidad/contexto: Mediterránea');
    expect(geminiPrompt()).toContain('Preferencias: Legumbres');
    expect(geminiPrompt()).toContain('Evitar: Maní');
    expect(geminiPrompt()).toContain('Objetivos: Comidas rápidas');
    expect(geminiPrompt()).toContain('Nivel: Intermedio');
    const prompt = geminiPrompt();
    const inventoryStart = prompt.indexOf('Inventario real del hogar:');
    const inventoryEnd = prompt.indexOf('Perfil culinario persistido', inventoryStart);
    expect(prompt.slice(inventoryStart, inventoryEnd)).not.toContain('zapallo');
    expect(geminiPrompt()).not.toContain('Browser override');
    expect(geminiPrompt()).not.toContain('Browser preference');
    expect(geminiPrompt()).not.toContain('Browser avoid');
    expect(buildRecipeCacheKeyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: { userId: 'user-1', tenantId: 'tenant-1' },
        goals: ['Comidas rápidas'],
        inventoryContextHash: 'sha256-private-context',
        profileContextHash: 'sha256-private-context',
        contextVersion: 'recipe-persisted-context-v1',
        model: 'gemini-test-model',
      })
    );
  });

  it('uses safe persisted missing markers instead of browser profile data', async () => {
    loadPersistedRecipeContextMock.mockResolvedValue(
      persistedContext({
        inventoryLines: [],
        inventoryContext: 'Sin inventario persistido para este hogar.',
        inventoryNames: [],
        profile: null,
        profileContext: 'Sin perfil culinario configurado.',
      })
    );

    const response = await POST(
      request({ mode: 'free', culinaryProfile: { identity: ['Dato del navegador'] } }) as unknown as NextRequest
    );

    expect(response.status).toBe(200);
    expect(geminiPrompt()).toContain('Sin inventario persistido para este hogar.');
    expect(geminiPrompt()).toContain('Sin perfil culinario configurado.');
    expect(geminiPrompt()).not.toContain('Dato del navegador');
  });

  it('retrieves authorized RAG context with persisted restrictions and preserves citations', async () => {
    const response = await POST(
      request({
        mode: 'rag',
        ingredients: ['zapallo'],
        recipeName: 'Sopa de zapallo',
        mealType: 'Cena',
        day: 'Lunes',
        culinaryProfile: { avoid: ['Browser override'] },
      }) as unknown as NextRequest
    );

    expect(response.status).toBe(200);
    expect(retrieveServerRagContextMock).toHaveBeenCalledWith({
      apiKey: 'gemini-test-key',
      tenantId: 'tenant-1',
      ingredients: ['zapallo'],
      recipeName: 'Sopa de zapallo',
      mealType: 'Cena',
      day: 'Lunes',
      restrictions: { allergies: ['Maní'], dietaryRules: [] },
    });
    expect(geminiPrompt()).toContain('Contexto documental confiable recuperado del recetario autorizado:');
    expect(geminiPrompt()).toContain('Técnica del servidor');
    expect(await response.json()).toMatchObject({
      ragContextUsed: true,
      sources,
      mode: 'rag',
    });
  });

  it('uses persisted inventory names as RAG retrieval fallback when no ingredients are requested', async () => {
    loadPersistedRecipeContextMock.mockResolvedValue(
      persistedContext({ inventoryNames: ['tomate', 'lentejas'] })
    );

    const response = await POST(request({ mode: 'rag' }) as unknown as NextRequest);

    expect(response.status).toBe(200);
    expect(retrieveServerRagContextMock).toHaveBeenCalledWith(
      expect.objectContaining({ ingredients: ['tomate', 'lentejas'], tenantId: 'tenant-1' })
    );
  });

  it('ignores browser chunks for RAG prompts and cache keys', async () => {
    const response = await POST(
      request({ mode: 'rag', ingredients: ['tomate'], chunks: ['INYECCIÓN DEL NAVEGADOR'] }) as unknown as NextRequest
    );

    expect(response.status).toBe(200);
    expect(geminiPrompt()).not.toContain('INYECCIÓN DEL NAVEGADOR');
    expect(buildRecipeCacheKeyMock).toHaveBeenCalledWith(
      expect.objectContaining({ chunks: ['--- CONTEXTO DE RECETARIO CONFIABLE ---\nTécnica del servidor'] })
    );
  });

  it('keeps anonymous free generation as a request-only fallback without repository context', async () => {
    requireUserMock.mockRejectedValue(new Error('Unauthorized'));

    const response = await POST(
      request({ mode: 'free', ingredients: ['tomate'], culinaryProfile: { avoid: ['lácteos'] } }) as unknown as NextRequest
    );

    expect(response.status).toBe(200);
    expect(loadPersistedRecipeContextMock).not.toHaveBeenCalled();
    expect(retrieveServerRagContextMock).not.toHaveBeenCalled();
    expect(geminiPrompt()).toContain('Perfil culinario de esta solicitud (no persistido):');
    expect(geminiPrompt()).toContain('Restricciones/evitar: lácteos');
    expect(buildRecipeCacheKeyMock).toHaveBeenCalledWith(expect.objectContaining({ scope: null }));
    expect(await response.json()).toMatchObject({ ragContextUsed: false, sources: [], mode: 'free' });
  });

  it('returns 401 for anonymous RAG without loading context or generating', async () => {
    requireUserMock.mockRejectedValue(new Error('Unauthorized'));

    const response = await POST(request({ mode: 'rag', ingredients: ['tomate'] }) as unknown as NextRequest);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
    expect(loadPersistedRecipeContextMock).not.toHaveBeenCalled();
    expect(retrieveServerRagContextMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 401 for RAG when the authenticated user has no tenant', async () => {
    requireUserMock.mockResolvedValue({ id: 'user-1', tenant: null });

    const response = await POST(request({ mode: 'rag', ingredients: ['tomate'] }) as unknown as NextRequest);

    expect(response.status).toBe(401);
    expect(loadPersistedRecipeContextMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a controlled persisted context failure without calling Gemini', async () => {
    loadPersistedRecipeContextMock.mockRejectedValue(new Error('database unavailable'));

    const response = await POST(request({ mode: 'free', ingredients: ['tomate'] }) as unknown as NextRequest);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'No se pudo cargar el contexto culinario persistido.' });
    expect(fetchMock).not.toHaveBeenCalled();
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
