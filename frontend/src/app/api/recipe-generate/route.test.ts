import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const requireUserMock = vi.fn();
const loadPersistedRecipeContextMock = vi.fn();
interface RagRetrievalInput {
  restrictions: { allergies: string[]; dietaryRules: string[] };
}

interface RagRetrievalResult {
  context: string;
  citations: typeof sources;
  ragContextUsed: boolean;
}

const retrieveServerRagContextMock = vi.fn<
  (input: RagRetrievalInput) => Promise<RagRetrievalResult>
>();
const buildRecipeCacheKeyMock = vi.fn((input: unknown) => JSON.stringify(input));
const hashRecipeContextMock = vi.fn(() => 'sha256-private-context');
const getCachedRecipeMock = vi.fn();
const setCachedRecipeMock = vi.fn();
const checkRateLimitMock = vi.fn();
const getGeminiApiKeyMock = vi.fn();
const getGeminiModelMock = vi.fn();
const getGeminiBaseUrlMock = vi.fn();
interface RecipeHistoryCall {
  tenantId: string;
  userId: string;
  source: string;
  recipeTitle: string;
  recipePayload: {
    full_recipe: string;
    title: string;
    provider: string;
    model: string;
    mode: string;
    structuredIngredients: unknown;
    requestedIngredients?: string[];
    peopleCount?: number;
    ragContextUsed: boolean;
    sources: typeof sources;
  };
  restrictionsSnapshot: {
    identity: string[];
    preferred: string[];
    avoid: string[];
    goals: string[];
    level: string;
  };
  inventorySnapshot: {
    inventoryLines: string[];
    inventoryContext: string;
  };
}

const createRecipeHistoryMock = vi.fn<(history: RecipeHistoryCall) => Promise<unknown>>();
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
  getGeminiBaseUrl: getGeminiBaseUrlMock,
}));
vi.mock('@/lib/serverLogger', () => ({
  serverLogger: { info: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/db/repositories/recipeRepository', () => ({
  createRecipeHistory: createRecipeHistoryMock,
}));

const { POST } = await import('./route');

function request(body: unknown): Request {
  return new Request('https://app.example.test/api/recipe-generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '1.1.1.1' },
    body: JSON.stringify(body),
  });
}

async function responseError(response: Response): Promise<string> {
  const body: unknown = await response.json();
  if (typeof body !== 'object' || body === null || !('error' in body) || typeof body.error !== 'string') {
    throw new Error('Expected response to contain an error message.');
  }
  return body.error;
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
      allergies: ['Maní'],
      dislikedIngredients: [],
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

function recipeHistoryCall(): RecipeHistoryCall {
  const [history] = createRecipeHistoryMock.mock.calls[0] ?? [];

  if (!history) {
    throw new Error('Expected recipe history to be persisted.');
  }

  return history;
}

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
    getGeminiBaseUrlMock.mockReset();
    createRecipeHistoryMock.mockReset();
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
    getGeminiBaseUrlMock.mockReturnValue('https://generativelanguage.googleapis.com/v1beta');
    createRecipeHistoryMock.mockResolvedValue({ id: 'history-1' });
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

  it('passes persisted allergies and taxonomy avoidance as hard RAG restrictions, never dislikes', async () => {
    loadPersistedRecipeContextMock.mockResolvedValue(
      persistedContext({
        profile: {
          identity: [],
          preferred: [],
          avoid: [' Maní ', 'Huevo'],
          goals: [],
          level: 'Intermedio',
          allergies: ['Maní', ' Lácteos '],
          disliked_ingredients: ['Cilantro'],
        },
      })
    );

    const response = await POST(request({ mode: 'rag' }) as unknown as NextRequest);

    expect(response.status).toBe(200);
    expect(retrieveServerRagContextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        restrictions: { allergies: ['Maní', 'Lácteos', 'Huevo'], dietaryRules: [] },
      })
    );
    expect(retrieveServerRagContextMock.mock.calls[0]?.[0].restrictions.allergies).not.toContain(
      'Cilantro'
    );
  });

  it('rejects a generated ingredient matching the last of 32 hard restrictions', async () => {
    const allergies = Array.from({ length: 20 }, (_, index) => `Alergia personalizada ${index + 1}`);
    const avoid = [
      'Huevo',
      'Lácteos',
      'Gluten',
      'Maní',
      'Nueces',
      'Pescado',
      'Mariscos',
      'Soya',
      'Sésamo',
      'Mostaza',
      'Apio',
      'Cilantro',
    ];
    const allRestrictions = [...allergies, ...avoid];
    loadPersistedRecipeContextMock.mockResolvedValue(
      persistedContext({
        profile: {
          identity: [],
          preferred: [],
          avoid,
          goals: [],
          level: 'Intermedio',
          allergies,
          dislikedIngredients: ['Perejil'],
        },
        profileContext: `Restricciones del perfil: ${allRestrictions.join(', ')}`,
      })
    );
    fetchMock.mockResolvedValueOnce(
      geminiResponse('Sopa de tomate\n\nINGREDIENTES\n- 2 unidades cilantro')
    );

    const response = await POST(request({ mode: 'rag' }) as unknown as NextRequest);

    expect(retrieveServerRagContextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        restrictions: { allergies: allRestrictions, dietaryRules: [] },
      })
    );
    expect(geminiPrompt()).toContain(`Restricciones duras: ${allRestrictions.join(', ')}`);
    expect(geminiPrompt()).not.toContain('Perejil');
    expect(response.status).toBe(502);
    expect(await responseError(response)).toContain('ingrediente restringido');
    expect(createRecipeHistoryMock).not.toHaveBeenCalled();
    expect(setCachedRecipeMock).not.toHaveBeenCalled();
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
    expect(createRecipeHistoryMock).not.toHaveBeenCalled();
  });

  it('persists one authenticated free generation from canonical server data', async () => {
    const recipe = 'Sopa de tomate\n\nINGREDIENTES\n- 2 unidades tomate';
    fetchMock.mockResolvedValue(geminiResponse(recipe));

    const response = await POST(
      request({
        mode: 'free',
        ingredients: ['tomate', 'albahaca'],
        peopleCount: 2,
        culinaryProfile: { avoid: ['Browser override'] },
      }) as unknown as NextRequest
    );

    expect(response.status).toBe(200);
    expect(createRecipeHistoryMock).toHaveBeenCalledTimes(1);
    const history = recipeHistoryCall();
    expect(history).toMatchObject({
      tenantId: 'tenant-1',
      userId: 'user-1',
      source: 'gemini',
      recipeTitle: 'Sopa de tomate',
      recipePayload: {
        full_recipe: recipe,
        title: 'Sopa de tomate',
        provider: 'gemini',
        model: 'gemini-test-model',
        mode: 'free',
        requestedIngredients: ['tomate', 'albahaca'],
        peopleCount: 2,
        ragContextUsed: false,
        sources: [],
      },
      restrictionsSnapshot: {
        identity: ['Mediterránea'],
        preferred: ['Legumbres'],
        avoid: ['Maní'],
        goals: ['Comidas rápidas'],
        level: 'Intermedio',
      },
      inventorySnapshot: {
        inventoryLines: ['- tomate: 2 kg'],
        inventoryContext: '- tomate: 2 kg',
      },
    });
    expect(Array.isArray(history.recipePayload.structuredIngredients)).toBe(true);
    expect(setCachedRecipeMock).toHaveBeenCalledTimes(1);
  });

  it('persists authoritative RAG citations instead of browser chunks', async () => {
    const response = await POST(
      request({
        mode: 'rag',
        ingredients: ['tomate'],
        chunks: ['Browser source data that must not persist'],
      }) as unknown as NextRequest
    );

    expect(response.status).toBe(200);
    expect(createRecipeHistoryMock).toHaveBeenCalledTimes(1);
    const history = recipeHistoryCall();
    expect(history).toMatchObject({
      tenantId: 'tenant-1',
      userId: 'user-1',
      recipePayload: {
        mode: 'rag',
        ragContextUsed: true,
        sources,
      },
    });
    expect(JSON.stringify(history)).not.toContain(
      'Browser source data that must not persist'
    );
  });

  it('does not persist or expose import linkage for anonymous free generation', async () => {
    requireUserMock.mockRejectedValue(new Error('Unauthorized'));

    const response = await POST(request({ mode: 'free', ingredients: ['tomate'] }) as unknown as NextRequest);

    expect(response.status).toBe(200);
    expect(createRecipeHistoryMock).not.toHaveBeenCalled();
    const generated = (await response.json()) as Record<string, unknown>;
    expect(generated).toMatchObject({ servings: 4 });
    expect(generated).not.toHaveProperty('recipeHistoryId');
  });

  it('returns the persisted history id and servings for authenticated generation', async () => {
    const response = await POST(
      request({ mode: 'free', peopleCount: 3 }) as unknown as NextRequest
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      recipeHistoryId: 'history-1',
      servings: 3,
    });
    expect(createRecipeHistoryMock).toHaveBeenCalledTimes(1);
  });

  it('does not persist validation, authorization, retrieval, or malformed provider failures', async () => {
    const invalidResponse = await POST(
      request({ mode: 'unsupported-mode' }) as unknown as NextRequest
    );
    expect(invalidResponse.status).toBe(400);
    expect(createRecipeHistoryMock).not.toHaveBeenCalled();

    requireUserMock.mockRejectedValue(new Error('Unauthorized'));
    const unauthorizedResponse = await POST(
      request({ mode: 'rag', ingredients: ['tomate'] }) as unknown as NextRequest
    );
    expect(unauthorizedResponse.status).toBe(401);
    expect(createRecipeHistoryMock).not.toHaveBeenCalled();

    requireUserMock.mockResolvedValue({
      id: 'user-1',
      tenant: { tenantId: 'tenant-1', role: 'owner', tenantType: 'home' },
    });
    retrieveServerRagContextMock.mockRejectedValueOnce(new Error('vector unavailable'));
    const retrievalResponse = await POST(
      request({ mode: 'rag', ingredients: ['tomate'] }) as unknown as NextRequest
    );
    expect(retrievalResponse.status).toBe(502);
    expect(createRecipeHistoryMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ candidates: [] }), { status: 200 })
    );
    const malformedResponse = await POST(
      request({ mode: 'free', ingredients: ['tomate'] }) as unknown as NextRequest
    );
    expect(malformedResponse.status).toBe(502);
    expect(createRecipeHistoryMock).not.toHaveBeenCalled();
  });

  it('returns controlled 500 and skips caching when authenticated history persistence fails', async () => {
    createRecipeHistoryMock.mockRejectedValueOnce(new Error('database unavailable'));

    const response = await POST(request({ mode: 'free', ingredients: ['tomate'] }) as unknown as NextRequest);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'No se pudo guardar la receta en el historial.' });
    expect(setCachedRecipeMock).not.toHaveBeenCalled();
  });

  it('rejects a persisted hard allergy in provider recipe text outside safe structured ingredients', async () => {
    fetchMock.mockResolvedValueOnce(
      geminiResponse(
        'Sopa de tomate\n\nINGREDIENTES\n- 2 unidades tomate\n\nPREPARACIÓN\nAñadir maní al gusto.\n\nTIPS\nServir con maní.'
      )
    );

    const response = await POST(
      request({ mode: 'free', culinaryProfile: { avoid: [] } }) as unknown as NextRequest
    );

    expect(response.status).toBe(502);
    expect(createRecipeHistoryMock).not.toHaveBeenCalled();
    expect(setCachedRecipeMock).not.toHaveBeenCalled();
  });

  it('does not reject a partial-word collision between an allergen and ingredient', async () => {
    loadPersistedRecipeContextMock.mockResolvedValue(
      persistedContext({
        profile: {
          identity: [],
          preferred: [],
          avoid: [],
          goals: [],
          level: 'Intermedio',
          allergies: ['egg'],
          dislikedIngredients: [],
        },
      })
    );
    fetchMock.mockResolvedValueOnce(geminiResponse('Salteado\n\nINGREDIENTES\n- 2 unidades eggplant'));

    const response = await POST(request({ mode: 'free' }) as unknown as NextRequest);

    expect(response.status).toBe(200);
    expect(createRecipeHistoryMock).toHaveBeenCalledTimes(1);
    expect(setCachedRecipeMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a vegan-incompatible generated recipe before persistence and caching', async () => {
    loadPersistedRecipeContextMock.mockResolvedValue(
      persistedContext({
        profile: {
          identity: [],
          preferred: [],
          avoid: ['Vegano'],
          goals: [],
          level: 'Intermedio',
          allergies: [],
          dislikedIngredients: [],
        },
      })
    );
    fetchMock.mockResolvedValueOnce(geminiResponse('Guiso\n\nINGREDIENTES\n- 2 unidades pollo'));

    const response = await POST(request({ mode: 'free' }) as unknown as NextRequest);

    expect(response.status).toBe(502);
    expect(createRecipeHistoryMock).not.toHaveBeenCalled();
    expect(setCachedRecipeMock).not.toHaveBeenCalled();
  });

  it('accepts a generated recipe with a gluten-free title when its ingredients contain no conflict', async () => {
    loadPersistedRecipeContextMock.mockResolvedValue(
      persistedContext({
        profile: {
          identity: [],
          preferred: [],
          avoid: ['Sin TACC'],
          goals: [],
          level: 'Intermedio',
          allergies: [],
          dislikedIngredients: [],
        },
      })
    );
    fetchMock.mockResolvedValueOnce(
      geminiResponse('Arroz sin gluten\n\nINGREDIENTES\n- 1 taza arroz\n- 1 cucharada aceite de oliva')
    );

    const response = await POST(request({ mode: 'free' }) as unknown as NextRequest);

    expect(response.status).toBe(200);
    expect(createRecipeHistoryMock).toHaveBeenCalledTimes(1);
    expect(setCachedRecipeMock).toHaveBeenCalledTimes(1);
  });

  it('rejects an allergen in parsed ingredients without persisting or caching', async () => {
    fetchMock.mockResolvedValueOnce(
      geminiResponse('Sopa de tomate\n\nINGREDIENTES\n- 2 cucharadas de maní')
    );

    const response = await POST(request({ mode: 'free' }) as unknown as NextRequest);

    expect(response.status).toBe(502);
    expect(createRecipeHistoryMock).not.toHaveBeenCalled();
    expect(setCachedRecipeMock).not.toHaveBeenCalled();
  });

  it.each([
    { allergy: 'cacahuate', ingredient: 'peanut' },
    { allergy: 'cacahuete', ingredient: 'groundnuts' },
    { allergy: 'peanuts', ingredient: 'cacahuetes' },
  ])('rejects generated peanut synonym $ingredient for hard allergy $allergy', async ({ allergy, ingredient }) => {
    loadPersistedRecipeContextMock.mockResolvedValue(
      persistedContext({
        profile: {
          identity: [],
          preferred: [],
          avoid: [],
          goals: [],
          level: 'Intermedio',
          allergies: [allergy],
          dislikedIngredients: [],
        },
      })
    );
    fetchMock.mockResolvedValueOnce(
      geminiResponse(`Receta\n\nINGREDIENTES\n- 2 unidades ${ingredient}`)
    );

    const response = await POST(request({ mode: 'free' }) as unknown as NextRequest);

    expect(response.status).toBe(502);
    expect(createRecipeHistoryMock).not.toHaveBeenCalled();
    expect(setCachedRecipeMock).not.toHaveBeenCalled();
  });

  it('fails closed when hard allergies are active but ingredients cannot be parsed', async () => {
    fetchMock.mockResolvedValueOnce(geminiResponse('Sopa de tomate\n\nPREPARACIÓN\nCocinar el tomate.'));

    const response = await POST(request({ mode: 'free' }) as unknown as NextRequest);

    expect(response.status).toBe(502);
    expect(createRecipeHistoryMock).not.toHaveBeenCalled();
    expect(setCachedRecipeMock).not.toHaveBeenCalled();
  });

  it('rejects cached recipes that conflict with a persisted dietary category before returning them', async () => {
    loadPersistedRecipeContextMock.mockResolvedValue(
      persistedContext({
        profile: {
          identity: [],
          preferred: [],
          avoid: ['Sin lactosa'],
          goals: [],
          level: 'Intermedio',
          allergies: [],
          dislikedIngredients: [],
        },
      })
    );
    getCachedRecipeMock.mockResolvedValueOnce({
      recipe: 'Bebida\n\nINGREDIENTES\n- leche convencional',
      title: 'Bebida cacheada',
      provider: 'gemini',
      model: 'gemini-test-model',
      mode: 'free',
      structuredIngredients: [
        {
          name: 'leche convencional',
          normalized_name: 'leche convencional',
          quantity: 1,
          unit: 'taza',
          optional_quantity_text: null,
          category: 'Lácteos',
          estimated_cost_optional: null,
          structured: true,
        },
      ],
      createdAt: Date.now(),
    });

    const response = await POST(request({ mode: 'free', ingredients: ['tomate'] }) as unknown as NextRequest);

    expect(response.status).toBe(502);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(createRecipeHistoryMock).not.toHaveBeenCalled();
    expect(setCachedRecipeMock).not.toHaveBeenCalled();
  });

  it('serves a cached gluten-free recipe whose title contains the negated gluten token', async () => {
    loadPersistedRecipeContextMock.mockResolvedValue(
      persistedContext({
        profile: {
          identity: [],
          preferred: [],
          avoid: ['Sin TACC'],
          goals: [],
          level: 'Intermedio',
          allergies: [],
          dislikedIngredients: [],
        },
      })
    );
    getCachedRecipeMock.mockResolvedValueOnce({
      recipe: 'Arroz sin gluten\n\nINGREDIENTES\n- 1 taza arroz\n- 1 cucharada aceite de oliva',
      title: 'Arroz sin gluten',
      provider: 'gemini',
      model: 'gemini-test-model',
      mode: 'free',
      structuredIngredients: [
        { name: 'arroz', normalized_name: 'arroz', structured: true },
        { name: 'aceite de oliva', normalized_name: 'aceite de oliva', structured: true },
      ],
      createdAt: Date.now(),
    });

    const response = await POST(request({ mode: 'free', ingredients: ['arroz'] }) as unknown as NextRequest);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ title: 'Arroz sin gluten', cached: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(createRecipeHistoryMock).toHaveBeenCalledTimes(1);
  });

  it('rejects cached recipe text with a persisted hard allergy outside safe structured ingredients', async () => {
    getCachedRecipeMock.mockResolvedValueOnce({
      recipe:
        'Sopa de tomate\n\nINGREDIENTES\n- 2 unidades tomate\n\nPREPARACIÓN\nAñadir maní al gusto.\n\nTIPS\nServir con maní.',
      title: 'Sopa de tomate',
      provider: 'gemini',
      model: 'gemini-test-model',
      mode: 'free',
      structuredIngredients: [
        {
          name: 'tomate',
          normalized_name: 'tomate',
          quantity: 2,
          unit: 'unidad',
          optional_quantity_text: null,
          category: 'Verduras',
          estimated_cost_optional: null,
          structured: true,
        },
      ],
      createdAt: Date.now(),
    });

    const response = await POST(
      request({ mode: 'free', ingredients: ['tomate'], culinaryProfile: { avoid: [] } }) as unknown as NextRequest
    );

    expect(response.status).toBe(502);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(createRecipeHistoryMock).not.toHaveBeenCalled();
    expect(setCachedRecipeMock).not.toHaveBeenCalled();
  });

  it.each([
    { allergy: 'cacahuate', ingredient: 'peanut' },
    { allergy: 'cacahuetes', ingredient: 'groundnut' },
  ])('rejects cached $ingredient for hard allergy $allergy', async ({ allergy, ingredient }) => {
    loadPersistedRecipeContextMock.mockResolvedValue(
      persistedContext({
        profile: {
          identity: [],
          preferred: [],
          avoid: [],
          goals: [],
          level: 'Intermedio',
          allergies: [allergy],
          dislikedIngredients: [],
        },
      })
    );
    getCachedRecipeMock.mockResolvedValueOnce({
      recipe: `Receta de ${ingredient}`,
      title: 'Receta cacheada',
      provider: 'gemini',
      model: 'gemini-test-model',
      mode: 'free',
      structuredIngredients: [
        {
          name: ingredient,
          normalized_name: ingredient,
          quantity: 2,
          unit: 'unidad',
          optional_quantity_text: null,
          category: null,
          estimated_cost_optional: null,
          structured: true,
        },
      ],
      createdAt: Date.now(),
    });

    const response = await POST(request({ mode: 'free', ingredients: ['tomate'] }) as unknown as NextRequest);

    expect(response.status).toBe(502);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(createRecipeHistoryMock).not.toHaveBeenCalled();
    expect(setCachedRecipeMock).not.toHaveBeenCalled();
  });

  it('fails closed for cached recipes without usable ingredients when hard allergies are active', async () => {
    getCachedRecipeMock.mockResolvedValueOnce({
      recipe: 'Receta cacheada',
      title: 'Receta cacheada',
      provider: 'gemini',
      model: 'gemini-test-model',
      mode: 'free',
      structuredIngredients: [],
      createdAt: Date.now(),
    });

    const response = await POST(request({ mode: 'free', ingredients: ['tomate'] }) as unknown as NextRequest);

    expect(response.status).toBe(502);
    expect(await responseError(response)).toContain('validar los ingredientes');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(createRecipeHistoryMock).not.toHaveBeenCalled();
    expect(setCachedRecipeMock).not.toHaveBeenCalled();
  });

  it('persists a cache hit once without calling Gemini', async () => {
    getCachedRecipeMock.mockResolvedValueOnce({
      recipe: 'Receta cacheada',
      title: 'Receta cacheada',
      provider: 'gemini',
      model: 'gemini-test-model',
      mode: 'free',
      structuredIngredients: [
        {
          name: 'tomate',
          normalized_name: 'tomate',
          quantity: 2,
          unit: 'unidad',
          optional_quantity_text: null,
          category: 'Verduras',
          estimated_cost_optional: null,
          structured: true,
        },
      ],
      createdAt: Date.now(),
    });

    const response = await POST(request({ mode: 'free', ingredients: ['tomate'] }) as unknown as NextRequest);

    expect(response.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(createRecipeHistoryMock).toHaveBeenCalledTimes(1);
    expect(recipeHistoryCall()).toMatchObject({
      recipePayload: {
        full_recipe: 'Receta cacheada',
        model: 'gemini-test-model',
      },
    });
  });
});
