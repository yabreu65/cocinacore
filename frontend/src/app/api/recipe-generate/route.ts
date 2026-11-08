import { NextRequest, NextResponse } from 'next/server';
import { serverLogger } from '@/lib/serverLogger';
import { extractGeminiTextResponse } from '@/services/apiDtos';
import { getGeminiApiKey, getGeminiBaseUrl, getGeminiModel } from '@/lib/ai/gemini-config';
import {
  buildRecipeCacheKey,
  getCachedRecipe,
  hashRecipeContext,
  setCachedRecipe,
  type RecipeCacheKeyInput,
} from '@/lib/cache/recipe-cache';
import {
  containsRestrictedIngredientName,
  extractStructuredIngredients,
  validateStructuredIngredients,
  type StructuredRecipeIngredient,
} from '@/lib/recipes/structured-ingredients';
import { validateRequest, RecipeGenerateSchema, type RecipeGenerateBody } from '@/lib/validation';
import { checkRateLimit } from '@/lib/rate-limit';
import { requireUser } from '@/lib/auth/server';
import type { AuthUser } from '@/lib/auth/types';
import { loadPersistedRecipeContext } from '@/lib/recipes/persisted-context';
import { retrieveServerRagContext } from '@/lib/recipes/server-rag-context';
import { createRecipeHistory } from '@/lib/db/repositories/recipeRepository';
import type { Citation } from '@/services/types';
import { getRetryAfterSeconds, getTrustedClientIdentity } from '@/lib/rate-limit-identity';
import {
  hashCapabilityPayload,
  resolveMealPlanWarmupCapability,
} from '@/lib/auth/internal-capability';

const AI_REQUEST_TIMEOUT_MS = 60_000;
const RECIPE_PROMPT_CONTEXT_VERSION = 'recipe-persisted-context-v1';

type RequestProfile = NonNullable<RecipeGenerateBody['culinaryProfile']>;

interface RecipeProfileFields {
  identity: string[];
  preferred: string[];
  avoid: string[];
  goals: string[];
  level: string;
  allergies: string[];
}

function inferTitleFromRecipe(recipe: string): string {
  const clean = recipe
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .find(
      (line) =>
        line !== '[TITULO]' &&
        line !== 'TITULO' &&
        !line.toLowerCase().startsWith('ingredientes') &&
        !line.toLowerCase().startsWith('preparación') &&
        !line.toLowerCase().startsWith('preparacion')
    );

  if (!clean) return 'Receta generada';
  return clean
    .replace(/^#+\s*/, '')
    .replace(/^\d+[\.)-]\s*/, '')
    .trim();
}

function normalizeRequestValues(values: readonly string[] | undefined, maxItems: number): string[] {
  return (values ?? [])
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function buildRequestProfile(profile: RequestProfile | undefined): RecipeProfileFields {
  return {
    identity: normalizeRequestValues(profile?.identity, 6),
    preferred: normalizeRequestValues(profile?.preferred, 10),
    avoid: normalizeRequestValues(profile?.avoid, 10),
    goals: normalizeRequestValues(profile?.goals, 10),
    level: profile?.level?.trim() || 'No especificado',
    allergies: [],
  };
}

function normalizeHardAllergies(values: readonly string[]): string[] {
  const allergies: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = value
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100);
    const key = normalized
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    if (!normalized || seen.has(key) || allergies.length >= 32) continue;
    seen.add(key);
    allergies.push(normalized);
  }
  return allergies;
}

function formatRequestProfile(profile: RecipeProfileFields): string {
  return [
    `- Identidad de cocina: ${profile.identity.join(', ') || 'No especificado'}`,
    `- Preferencias: ${profile.preferred.join(', ') || 'No especificado'}`,
    `- Objetivos: ${profile.goals.join(', ') || 'No especificado'}`,
    `- Restricciones/evitar: ${profile.avoid.join(', ') || 'No especificado'}`,
    `- Nivel culinario: ${profile.level}`,
  ].join('\n');
}

interface CanonicalRecipeResult {
  recipe: string;
  title: string;
  provider: 'gemini';
  model?: string;
  mode: 'free' | 'rag';
  structuredIngredients: StructuredRecipeIngredient[];
}

async function requestGeminiRecipe(
  url: string,
  prompt: string,
  clientSignal: AbortSignal
): Promise<string> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  clientSignal.addEventListener('abort', abort, { once: true });
  if (clientSignal.aborted) abort();
  const timeoutId = setTimeout(abort, AI_REQUEST_TIMEOUT_MS);
  let onAbort: (() => void) | undefined;
  try {
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error('Gemini provider request aborted'));
      if (controller.signal.aborted) onAbort();
      else controller.signal.addEventListener('abort', onAbort, { once: true });
    });
    const request = async () => {
      if (controller.signal.aborted) throw new Error('Gemini provider request aborted');
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) throw new Error('Gemini provider request aborted');
      if (!response.ok) throw new Error('Gemini provider request failed');
      const payload: unknown = await response.json();
      const recipe = extractGeminiTextResponse(payload);
      if (!recipe) throw new Error('Gemini no devolvió contenido de receta.');
      return recipe;
    };
    return await Promise.race([request(), aborted]);
  } finally {
    clearTimeout(timeoutId);
    clientSignal.removeEventListener('abort', abort);
    if (onAbort) controller.signal.removeEventListener('abort', onAbort);
  }
}

async function persistAuthenticatedRecipeHistory({
  user,
  result,
  requestedIngredients,
  peopleCount,
  persistedContext,
  ragContext,
}: {
  user: AuthUser | null;
  result: CanonicalRecipeResult;
  requestedIngredients: string[];
  peopleCount: number;
  persistedContext: Awaited<ReturnType<typeof loadPersistedRecipeContext>> | null;
  ragContext: { citations: Citation[]; ragContextUsed: boolean };
}): Promise<string | null> {
  if (!user?.tenant) return null;

  const history = await createRecipeHistory({
    tenantId: user.tenant.tenantId,
    userId: user.id,
    source: result.provider,
    recipeTitle: result.title,
    recipePayload: {
      full_recipe: result.recipe,
      title: result.title,
      provider: result.provider,
      model: result.model,
      mode: result.mode,
      structuredIngredients: result.structuredIngredients,
      requestedIngredients,
      peopleCount,
      ragContextUsed: ragContext.ragContextUsed,
      sources: ragContext.citations,
    },
    restrictionsSnapshot: {
      identity: persistedContext?.profile?.identity ?? [],
      preferred: persistedContext?.profile?.preferred ?? [],
      avoid: persistedContext?.profile?.avoid ?? [],
      goals: persistedContext?.profile?.goals ?? [],
      level: persistedContext?.profile?.level ?? 'No especificado',
    },
    inventorySnapshot: {
      inventoryLines: persistedContext?.inventoryLines ?? [],
      inventoryContext:
        persistedContext?.inventoryContext ?? 'Sin inventario persistido para este hogar.',
    },
  });
  return history.id;
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();

  const validation = await validateRequest(request, RecipeGenerateSchema);
  if (!validation.success) {
    return Response.json(validation.error.body, { status: validation.error.status });
  }

  const body: RecipeGenerateBody = validation.data;
  const providerPreference = body.provider ?? 'auto';
  const mode = body.mode === 'rag' ? 'rag' : 'free';
  const apiKey = getGeminiApiKey();
  const model = getGeminiModel();
  const geminiBaseUrl = getGeminiBaseUrl();
  const warmupCapability = request.headers.get('X-CocinaCore-Warmup-Capability');

  let user: AuthUser | null = null;
  let internalWarmupAuthorized = false;
  try {
    user = await requireUser(request, 'Unauthorized');
  } catch {
    user = null;
  }

  if (!user && warmupCapability) {
    try {
      const resolvedCapability = await resolveMealPlanWarmupCapability(warmupCapability, {
        method: 'POST',
        path: '/api/recipe-generate',
        operation: 'recipe-generate',
        jobId: request.headers.get('X-CocinaCore-Warmup-Job-Id') ?? '',
        bodyHash: hashCapabilityPayload(body),
      });
      user = resolvedCapability?.user ?? null;
      internalWarmupAuthorized = Boolean(resolvedCapability);
    } catch {
      user = null;
    }
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const tenantId = user?.tenant?.tenantId;
  const rateLimit = await checkRateLimit(
    'recipe-generate',
    tenantId ?? getTrustedClientIdentity(request),
    user?.id,
    { requireSharedStore: true }
  );
  if (!rateLimit.success) {
    const retryAfter = getRetryAfterSeconds(rateLimit.resetAt);
    const storageUnavailable = rateLimit.storage === 'unavailable';
    return Response.json(
      {
        error: storageUnavailable
          ? 'El generador no está disponible temporalmente.'
          : 'Rate limit exceeded',
        retryAfter,
      },
      {
        status: storageUnavailable ? 503 : 429,
        headers: {
          'Retry-After': String(retryAfter),
          'X-RateLimit-Limit': String(rateLimit.limit),
          'X-RateLimit-Remaining': String(rateLimit.remaining),
          'X-RateLimit-Reset': String(rateLimit.resetAt),
        },
      }
    );
  }

  let persistedContext: Awaited<ReturnType<typeof loadPersistedRecipeContext>> | null = null;
  if (user?.tenant) {
    try {
      persistedContext = await loadPersistedRecipeContext(user.id, user.tenant.tenantId);
    } catch (error) {
      serverLogger.error('recipe_generate.persisted_context_failed', {
        requestId,
        reason: error instanceof Error ? error.name : 'unknown',
      });
      return NextResponse.json(
        { error: 'No se pudo cargar el contexto culinario persistido.' },
        { status: 503 }
      );
    }
  }

  const ragUser = user?.tenant ? user : null;
  if (mode === 'rag' && !ragUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const requestedRecipeName = body.recipeName?.trim() ?? '';
  const requestedMealType = body.mealType?.trim() ?? '';
  const requestedDay = body.day?.trim() ?? '';
  const requestedIngredients = normalizeRequestValues(body.ingredients, 30);
  const peopleCount =
    typeof body.peopleCount === 'number' &&
    Number.isFinite(body.peopleCount) &&
    body.peopleCount > 0
      ? Math.floor(body.peopleCount)
      : 4;
  const requestProfile = buildRequestProfile(body.culinaryProfile);
  const profileFields: RecipeProfileFields = persistedContext
    ? {
        identity: persistedContext.profile?.identity ?? [],
        preferred: persistedContext.profile?.preferred ?? [],
        avoid: persistedContext.profile?.avoid ?? [],
        goals: persistedContext.profile?.goals ?? [],
        level: persistedContext.profile?.level ?? 'No especificado',
        allergies: persistedContext.profile?.allergies ?? [],
      }
    : requestProfile;
  let ragContext: { context: string; citations: Citation[]; ragContextUsed: boolean } = {
    context: '',
    citations: [],
    ragContextUsed: false,
  };

  if (mode === 'rag') {
    if (!ragUser?.tenant) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!apiKey) {
      return NextResponse.json(
        { error: 'Servicio de recetas RAG no disponible.' },
        { status: 503 }
      );
    }

    const ragIngredients =
      requestedIngredients.length > 0
        ? requestedIngredients
        : (persistedContext?.inventoryNames ?? []);

    try {
      ragContext = await retrieveServerRagContext({
        apiKey,
        tenantId: ragUser.tenant.tenantId,
        userId: ragUser.id,
        ingredients: ragIngredients,
        recipeName: requestedRecipeName || undefined,
        mealType: requestedMealType || undefined,
        day: requestedDay || undefined,
        restrictions: {
          allergies: normalizeHardAllergies([...profileFields.allergies, ...profileFields.avoid]),
          dietaryRules: [],
        },
      });
    } catch (error) {
      serverLogger.error('recipe_generate.rag_retrieval_failed', {
        requestId,
        reason: error instanceof Error ? error.name : 'unknown',
      });
      return NextResponse.json(
        { error: 'No se pudo recuperar el contexto documental.' },
        { status: 502 }
      );
    }
  }

  serverLogger.info('recipe_generate.request', {
    requestId,
    model,
    mode,
    providerPreference,
    peopleCount,
    requestedIngredientsCount: requestedIngredients.length,
    inventoryCount: persistedContext?.inventoryLines.length ?? 0,
    chunksCount: mode === 'rag' ? ragContext.citations.length : 0,
    hasPersistedProfile: Boolean(persistedContext?.profile),
  });

  const focusedRecipeInstruction = requestedRecipeName
    ? `Receta objetivo (OBLIGATORIO): ${requestedRecipeName}`
    : requestedIngredients.length > 0
      ? `Receta objetivo (OBLIGATORIO): usa el primer ingrediente solicitado como plato principal.`
      : 'Receta objetivo (OBLIGATORIO): elige un plato coherente priorizando el inventario real del hogar.';

  const slotContextInstruction =
    requestedMealType || requestedDay
      ? `Contexto del slot: ${requestedDay || 'Día no especificado'} · ${requestedMealType || 'Comida no especificada'}`
      : 'Contexto del slot: no especificado';

  const inventoryContext =
    persistedContext?.inventoryContext ?? 'Sin inventario persistido para este hogar.';
  const profileContext = persistedContext?.profileContext ?? formatRequestProfile(requestProfile);
  const profileSectionTitle = persistedContext
    ? 'Perfil culinario persistido del usuario autenticado:'
    : 'Perfil culinario de esta solicitud (no persistido):';
  const commonPromptHeader = `Eres un chef-editor culinario. Debes devolver una receta en español con formato claro y exacto, sin JSON.

Solicitud actual:
${focusedRecipeInstruction}
${slotContextInstruction}
- Ingredientes solicitados explícitamente: ${requestedIngredients.join('; ') || 'No especificados'}
- Estos ingredientes son solo el foco de la receta actual; no prueban disponibilidad en el inventario del hogar.
- Comensales: ${peopleCount}
- Restricciones duras: ${normalizeHardAllergies([...profileFields.allergies, ...profileFields.avoid]).join(', ') || 'Ninguna'}

Inventario real del hogar:
${inventoryContext}
No inventes cantidades de inventario: si una línea indica "cantidad no especificada", no la supongas.

${profileSectionTitle}
${profileContext}

SI HAY CONTEXTO DOCUMENTAL, prioriza ese contenido y usa el NOMBRE de la receta que aparezca en el texto fuente.
`;

  const ragPrompt = `Contexto documental confiable recuperado del recetario autorizado:
${ragContext.context || 'Sin contexto documental relevante encontrado para esta búsqueda.'}

Usá este contexto como verdad de fuente: no fabriques citas, autores ni páginas. Cuando una receta sea una síntesis propia a partir del contexto, distinguí explícitamente esa síntesis de las técnicas o datos documentados.

Formato de salida OBLIGATORIO:
[TITULO]

INGREDIENTES
- 2 unidades tomate
- 1 taza arroz
- 200 g pollo

FUENTE
- [autor/libro si está disponible en el contexto]
- [página si está disponible]

PREPARACIÓN
1. ...
2. ...

TIPS
- ...

Reglas:
- Genera SOLO UNA receta para el plato objetivo; no agregues acompañantes extra ni segundas recetas.
- El título debe ser únicamente el nombre del plato objetivo (sin introducciones largas).
- No inventes fuentes.
- Si el contexto no trae autor/página, indícalo como "No especificado en contexto".
- Ajusta cantidades explícitamente para ${peopleCount} comensales.
- Si el PDF no trae cantidades base claras, estima cantidades y acláralo en una línea final: "Cantidades estimadas para ${peopleCount} personas".
- Respeta estrictamente restricciones de "evitar".
- Cada ingrediente debe ir en una sola línea.
- Cada línea de ingrediente debe empezar con cantidad numérica + unidad + nombre.
- Evita subtítulos dentro de INGREDIENTES.
- Evita frases largas tipo "para el sofrito" dentro de la lista; deja solo el ingrediente base.
- Máximo 450 palabras.`;
  const freePrompt = `Formato de salida OBLIGATORIO:
[TITULO]

INGREDIENTES
- 2 unidades tomate
- 1 taza arroz
- 200 g pollo

PREPARACIÓN
1. ...
2. ...

TIPS
- ...

Reglas:
- Genera SOLO UNA receta para el plato objetivo; no agregues acompañantes extra ni segundas recetas.
- El título debe ser únicamente el nombre del plato objetivo (sin introducciones largas).
- NO incluyas sección "FUENTE" ni referencias bibliográficas.
- No menciones PDFs ni biblioteca.
- Ajusta cantidades explícitamente para ${peopleCount} comensales.
- Respeta estrictamente restricciones de "evitar".
- Cada ingrediente debe ir en una sola línea.
- Cada línea de ingrediente debe empezar con cantidad numérica + unidad + nombre.
- Evita subtítulos dentro de INGREDIENTES.
- Evita frases largas tipo "para el sofrito" dentro de la lista; deja solo el ingrediente base.
- Máximo 450 palabras.`;

  const prompt = `${commonPromptHeader}\n${mode === 'rag' ? ragPrompt : freePrompt}`;
  const recipeCacheKeyInput: RecipeCacheKeyInput = {
    mode,
    scope: user?.tenant ? { userId: user.id, tenantId: user.tenant.tenantId } : null,
    requestedRecipeName,
    requestedMealType,
    requestedDay,
    ingredients: requestedIngredients,
    peopleCount,
    goals: profileFields.goals,
    inventoryContextHash: hashRecipeContext(inventoryContext),
    profileContextHash: hashRecipeContext(profileContext),
    contextVersion: RECIPE_PROMPT_CONTEXT_VERSION,
    model,
    chunks: mode === 'rag' && ragContext.context ? [ragContext.context] : [],
  };
  const recipeCacheKey = buildRecipeCacheKey(recipeCacheKeyInput);

  const hardAllergies = normalizeHardAllergies([
    ...profileFields.allergies,
    ...profileFields.avoid,
  ]);
  const cached = await getCachedRecipe(recipeCacheKey);
  if (cached) {
    const hasUsableCachedIngredientNames =
      validateStructuredIngredients(cached.structuredIngredients) &&
      cached.structuredIngredients.some((ingredient) => ingredient.name.trim().length > 0);
    if (hardAllergies.length > 0 && !hasUsableCachedIngredientNames) {
      return NextResponse.json(
        { error: 'No se pudieron validar los ingredientes de la receta generada.' },
        { status: 502 }
      );
    }
    if (
      hasUsableCachedIngredientNames &&
      containsRestrictedIngredientName(
        [...cached.structuredIngredients.map((ingredient) => ingredient.name), cached.recipe],
        hardAllergies
      )
    ) {
      return NextResponse.json(
        { error: 'La receta generada contiene un ingrediente restringido.' },
        { status: 502 }
      );
    }

    let recipeHistoryId: string | null;
    try {
      recipeHistoryId = internalWarmupAuthorized
        ? null
        : await persistAuthenticatedRecipeHistory({
            user,
            result: cached,
            requestedIngredients,
            peopleCount,
            persistedContext,
            ragContext,
          });
    } catch (error) {
      serverLogger.error('recipe_generate.history_persist_failed', {
        requestId,
        reason: error instanceof Error ? error.name : 'unknown',
      });
      return NextResponse.json(
        { error: 'No se pudo guardar la receta en el historial.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      recipe: cached.recipe,
      title: cached.title,
      provider: cached.provider,
      model: cached.model,
      mode: cached.mode,
      structuredIngredients: cached.structuredIngredients,
      ragContextUsed: ragContext.ragContextUsed,
      sources: ragContext.citations,
      servings: peopleCount,
      ...(recipeHistoryId ? { recipeHistoryId } : {}),
      cached: true,
    });
  }

  try {
    if (!apiKey) {
      throw new Error('Provider unavailable');
    }

    const recipe = await requestGeminiRecipe(
      `${geminiBaseUrl}/models/${model}:generateContent?key=${apiKey}`,
      prompt,
      request.signal
    );

    const title = inferTitleFromRecipe(recipe);
    const structuredIngredients = extractStructuredIngredients(recipe);
    const hasUsableIngredientNames =
      validateStructuredIngredients(structuredIngredients) &&
      structuredIngredients.some((ingredient) => ingredient.name.trim().length > 0);
    if (hardAllergies.length > 0 && !hasUsableIngredientNames) {
      throw new Error('No se pudieron validar los ingredientes de la receta generada.');
    }
    if (
      containsRestrictedIngredientName(
        [...structuredIngredients.map((ingredient) => ingredient.name), recipe],
        hardAllergies
      )
    ) {
      throw new Error('La receta generada contiene un ingrediente restringido.');
    }

    const safeStructuredIngredients: StructuredRecipeIngredient[] = hasUsableIngredientNames
      ? structuredIngredients
      : [];
    const result: CanonicalRecipeResult = {
      recipe,
      title,
      provider: 'gemini',
      model,
      mode,
      structuredIngredients: safeStructuredIngredients,
    };

    let recipeHistoryId: string | null;
    try {
      recipeHistoryId = internalWarmupAuthorized
        ? null
        : await persistAuthenticatedRecipeHistory({
            user,
            result,
            requestedIngredients,
            peopleCount,
            persistedContext,
            ragContext,
          });
    } catch (error) {
      serverLogger.error('recipe_generate.history_persist_failed', {
        requestId,
        reason: error instanceof Error ? error.name : 'unknown',
      });
      return NextResponse.json(
        { error: 'No se pudo guardar la receta en el historial.' },
        { status: 500 }
      );
    }

    serverLogger.info('recipe_generate.success', {
      requestId,
      durationMs: Date.now() - startedAt,
      provider: 'gemini',
      mode,
      titleLength: title.length,
    });
    await setCachedRecipe(recipeCacheKey, {
      ...result,
      createdAt: Date.now(),
    });
    return NextResponse.json({
      recipe,
      title,
      provider: 'gemini',
      mode,
      structuredIngredients: safeStructuredIngredients,
      ragContextUsed: ragContext.ragContextUsed,
      sources: ragContext.citations,
      servings: peopleCount,
      ...(recipeHistoryId ? { recipeHistoryId } : {}),
    });
  } catch (error) {
    serverLogger.error('recipe_generate.failed', {
      requestId,
      durationMs: Date.now() - startedAt,
      reason: error instanceof Error ? error.name : 'unknown',
    });
    return NextResponse.json(
      { error: 'No se pudo generar la receta temporalmente.' },
      { status: 502 }
    );
  }
}
