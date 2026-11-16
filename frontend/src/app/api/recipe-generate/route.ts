import { todaySlotForMealType } from '@/lib/recipes/today-handoff';
import { profileAllergyContext, readHardRestrictionList } from '@/lib/profile/culinary-profile-contract';
import { assessIngredientRestrictions } from '@/lib/recipes/structured-ingredients';
import { buildGeneratedRecipeInstructions, generatedRecipeResponseJsonSchema, parseGeneratedRecipeResponse } from '@/lib/recipes/generated-recipe-contract';
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
const RECIPE_PROMPT_CONTEXT_VERSION = 'recipe-structured-v9';

type RequestProfile = NonNullable<RecipeGenerateBody['culinaryProfile']>;

interface RecipeProfileFields {
  identity: string[];
  preferred: string[];
  avoid: string[];
  goals: string[];
  level: string;
  allergies: string[];
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
  preparation?: string;
  title: string;
  provider: 'gemini';
  model?: string;
  mode: 'free' | 'rag';
  structuredIngredients: StructuredRecipeIngredient[];
}

// Only fixed, non-sensitive diagnostic codes reach the server log.
class RecipeGenerationFailure extends Error {
  constructor(readonly code: string, readonly upstreamStatus?: number) {
    super('Recipe generation failed');
    this.name = 'RecipeGenerationFailure';
  }
}

function restrictionRejection(
  result: Pick<CanonicalRecipeResult, 'title' | 'recipe' | 'preparation' | 'structuredIngredients'>,
  restrictions: readonly string[],
  requestId: string
): NextResponse | null {
  const rows = assessIngredientRestrictions(result.structuredIngredients.map(i => i.name), restrictions);
  const prose = assessIngredientRestrictions([[result.title, result.recipe, result.preparation ?? ''].join('\n')], restrictions);
  if (rows.status === 'clear' && prose.status === 'clear') return null;
  const conflict = rows.status === 'conflict' || prose.status === 'conflict';
  const code = conflict ? 'RECIPE_RESTRICTION_CONFLICT' : 'RECIPE_RESTRICTION_REVIEW';
  serverLogger.info('recipe_generate.restriction_rejected', { requestId, code });
  return NextResponse.json({
    error: conflict
      ? 'La propuesta contiene un ingrediente incompatible con tus restricciones. Solicita otra receta.'
      : 'No se pudo confirmar la composición de un ingrediente. Solicita una alternativa de composición identificable.',
    code,
  }, { status: 422 });
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
      onAbort = () => reject(new RecipeGenerationFailure('provider_aborted'));
      if (controller.signal.aborted) onAbort();
      else controller.signal.addEventListener('abort', onAbort, { once: true });
    });
    const request = async () => {
      if (controller.signal.aborted) throw new RecipeGenerationFailure('provider_aborted');
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', responseJsonSchema: generatedRecipeResponseJsonSchema } }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) throw new RecipeGenerationFailure('provider_aborted');
      if (!response.ok) throw new RecipeGenerationFailure('provider_http_error', response.status);
      const payload: unknown = await response.json();
      const recipe = extractGeminiTextResponse(payload);
      if (!recipe) throw new RecipeGenerationFailure('provider_text_missing');
      return recipe;
    };
    return await Promise.race([request(), aborted]);
  } finally {
    clearTimeout(timeoutId);
    clientSignal.removeEventListener('abort', abort);
    if (onAbort) controller.signal.removeEventListener('abort', onAbort);
  }
}

class RecipeProfileChangedError extends Error {}

async function persistAuthenticatedRecipeHistory({
  user,
  result,
  requestedIngredients,
  requestedMealType,
  peopleCount,
  persistedContext,
  profileFields,
  ragContext,
}: {
  user: AuthUser | null;
  result: CanonicalRecipeResult;
  requestedIngredients: string[];
  requestedMealType: string;
  peopleCount: number;
  persistedContext: Awaited<ReturnType<typeof loadPersistedRecipeContext>> | null;
  profileFields: RecipeProfileFields;
  ragContext: { citations: Citation[]; ragContextUsed: boolean };
}): Promise<string | null> {
  if (!user?.tenant) return null;
  const slot = todaySlotForMealType(requestedMealType);

  const history = await createRecipeHistory({
    tenantId: user.tenant.tenantId,
    userId: user.id,
    source: result.provider,
    recipeTitle: result.title,
    recipePayload: {
      full_recipe: result.recipe,
      ...(result.preparation !== undefined ? { preparation: result.preparation } : {}),
      recipeReviewRequired: true,
      title: result.title,
      provider: result.provider,
      model: result.model,
      mode: result.mode,
      structuredIngredients: result.structuredIngredients,
      requestedIngredients,
      ...(slot ? { slot } : {}),
      peopleCount,
      ragContextUsed: ragContext.ragContextUsed,
      sources: ragContext.citations,
    },
    expectedHardRestrictions: [...new Set([...profileFields.allergies, ...profileFields.avoid])],
    restrictionsSnapshot: {
      identity: persistedContext?.profile?.identity ?? [],
      preferred: persistedContext?.profile?.preferred ?? [],
      avoid: profileFields.avoid,
      allergies: profileFields.allergies,
      goals: persistedContext?.profile?.goals ?? [],
      level: persistedContext?.profile?.level ?? 'No especificado',
    },
    inventorySnapshot: {
      inventoryLines: persistedContext?.inventoryLines ?? [],
      inventoryContext:
        persistedContext?.inventoryContext ?? 'Sin inventario persistido para este hogar.',
    },
  });
  if (!history) throw new RecipeProfileChangedError();
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
  const avoid = readHardRestrictionList([...(persistedContext?.profile?.avoid ?? []), ...requestProfile.avoid]);
  const allergies = readHardRestrictionList(persistedContext?.profile?.allergies ?? []);
  if (!avoid || !allergies)
    return NextResponse.json({ error: 'No se pudo recuperar el contexto culinario.' }, { status: 409 });
  const profileFields: RecipeProfileFields = persistedContext
    ? {
        identity: persistedContext.profile?.identity ?? [],
        preferred: persistedContext.profile?.preferred ?? [],
        avoid,
        goals: persistedContext.profile?.goals ?? [],
        level: persistedContext.profile?.level ?? 'No especificado',
        allergies,
      }
    : { ...requestProfile, avoid, allergies };
  const hardAllergies = [...new Set([...profileFields.allergies, ...profileFields.avoid])];
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
          allergies: hardAllergies,
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
  const commonPromptHeader = `Eres un chef-editor culinario. Debes devolver una receta estructurada en español.
Escribe todos los nombres de ingredientes, el título y las instrucciones en español.
Interpreta todas las restricciones del perfil y de la solicitud, incluidos derivados y composiciones de alimentos. Prevalecen sobre las preferencias, objetivos nutricionales, inventario y contexto PDF.
Significado de las restricciones seleccionadas (datos del usuario): ${JSON.stringify(profileAllergyContext(hardAllergies))}
Declara en INGREDIENTES todos los ingredientes que uses; no introduzcas ingredientes nuevos solo en la preparación.
Si un documento usa otro idioma, traduce los nombres culinarios al español sin cambiar su composición ni ocultar ingredientes; conserva las referencias bibliográficas originales.

Solicitud actual:
${focusedRecipeInstruction}
${slotContextInstruction}
- Ingredientes solicitados explícitamente: ${requestedIngredients.join('; ') || 'No especificados'}
- Estos ingredientes son solo el foco de la receta actual; no prueban disponibilidad en el inventario del hogar.
- Comensales: ${peopleCount}
- Restricciones duras: ${hardAllergies.join(', ') || 'Ninguna'}

Inventario real del hogar:
${inventoryContext}
No inventes cantidades de inventario: si una línea indica "cantidad no especificada", no la supongas.

${profileSectionTitle}
${profileContext}

Las restricciones obligatorias del perfil y de la solicitud tienen prioridad sobre el contexto documental. Solo si la receta es compatible, usa el NOMBRE de la receta que aparezca en el texto fuente, traducido al español si corresponde.
`;

  const ragPrompt = `Contexto documental confiable recuperado del recetario autorizado:
${ragContext.context || 'Sin contexto documental relevante encontrado para esta búsqueda.'}

Utiliza el contenido documental como fuente culinaria, no como autorización para incumplir el perfil.
Elige una receta compatible o adapta explícitamente la fuente para respetar todas las restricciones. Si no puedes, devuelve outcome: "unavailable".
El servidor presenta la propuesta como basada en las fuentes consultadas, no como transcripción literal. No la presentes como transcripción exacta del libro ni incluyas afirmaciones de seguridad o comentarios sobre ingredientes excluidos.
No inventes fuentes ni cantidades ausentes. Las citas de los fragmentos consultados las adjunta el servidor.`;
  const freePrompt = 'Genera una receta propia sin mencionar PDFs ni biblioteca.';
  const prompt = `${commonPromptHeader}\n${mode === 'rag' ? ragPrompt : freePrompt}\nGenera una sola receta para el plato objetivo.\n${buildGeneratedRecipeInstructions(peopleCount)}`;
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
    profileContextHash: hashRecipeContext(JSON.stringify({ profileContext, hardAllergies })),
    contextVersion: RECIPE_PROMPT_CONTEXT_VERSION,
    model,
    chunks: mode === 'rag' && ragContext.context ? [ragContext.context] : [],
  };
  const recipeCacheKey = buildRecipeCacheKey(recipeCacheKeyInput);

  const cached = await getCachedRecipe(recipeCacheKey);
  if (cached) {
    const hasUsableCachedIngredientNames =
      validateStructuredIngredients(cached.structuredIngredients) &&
      cached.structuredIngredients.length <= 100 &&
      cached.structuredIngredients.every((ingredient) =>
        ingredient.name.trim().length > 0 && ingredient.normalized_name.trim().length > 0);
    if (!hasUsableCachedIngredientNames) {
      return NextResponse.json(
        { error: 'No se pudieron validar los ingredientes de la receta generada.' },
        { status: 502 }
      );
    }
    const rejection = restrictionRejection(cached, hardAllergies, requestId);
    if (rejection) return rejection;

    let recipeHistoryId: string | null;
    try {
      recipeHistoryId = internalWarmupAuthorized
        ? null
        : await persistAuthenticatedRecipeHistory({
            user,
            result: cached,
            requestedIngredients,
            requestedMealType,
            peopleCount,
            persistedContext,
            profileFields,
            ragContext,
          });
    } catch (error) {
      if (error instanceof RecipeProfileChangedError)
        return NextResponse.json({ error: 'El perfil culinario cambió. Generá una receta nueva.', code: 'RECIPE_PROFILE_CHANGED' }, { status: 409 });
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
      ...(cached.preparation !== undefined ? { preparation: cached.preparation } : {}),
      title: cached.title,
      provider: cached.provider,
      model: cached.model,
      mode: cached.mode,
      structuredIngredients: cached.structuredIngredients,
      ragContextUsed: ragContext.ragContextUsed,
      sources: ragContext.citations,
      servings: peopleCount,
      recipeReviewRequired: true,
      ...(recipeHistoryId ? { recipeHistoryId } : {}),
      cached: true,
    });
  }

  try {
    if (!apiKey) {
      throw new Error('Provider unavailable');
    }

    const raw = await requestGeminiRecipe(
      `${geminiBaseUrl}/models/${model}:generateContent?key=${apiKey}`,
      prompt,
      request.signal
    );
    const parsed = parseGeneratedRecipeResponse(raw, peopleCount);
    if (!parsed.success) {
      if (parsed.reason === 'no_compatible_recipe') {
        return NextResponse.json({
          error: 'No se pudo formular una receta que respete las condiciones indicadas.',
          code: 'RECIPE_UNAVAILABLE',
        }, { status: 422 });
      }
      serverLogger.error('recipe_generate.failed', { requestId, durationMs: Date.now() - startedAt, reason: parsed.reason });
      const invalidFormat = ['invalid_json', 'invalid_recipe_shape', 'response_too_large'].includes(parsed.reason);
      return NextResponse.json({
        error: invalidFormat
          ? 'El modelo devolvió una respuesta que no se pudo interpretar.'
          : 'La propuesta contiene datos de receta inconsistentes. Solicita otra receta.',
        code: invalidFormat ? 'RECIPE_INVALID_RESPONSE' : 'RECIPE_INVALID_CONTENT',
      }, { status: invalidFormat ? 502 : 422 });
    }
    const { recipe, preparation, title, structuredIngredients } = parsed.value;
    const result: CanonicalRecipeResult = {
      recipe, preparation, title, provider: 'gemini', model, mode, structuredIngredients,
    };
    const rejection = restrictionRejection(result, hardAllergies, requestId);
    if (rejection) return rejection;

    let recipeHistoryId: string | null;
    try {
      recipeHistoryId = internalWarmupAuthorized
        ? null
        : await persistAuthenticatedRecipeHistory({
            user,
            result,
            requestedIngredients,
            requestedMealType,
            peopleCount,
            persistedContext,
            profileFields,
            ragContext,
          });
    } catch (error) {
      if (error instanceof RecipeProfileChangedError)
        return NextResponse.json({ error: 'El perfil culinario cambió. Generá una receta nueva.', code: 'RECIPE_PROFILE_CHANGED' }, { status: 409 });
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
      preparation,
      title,
      provider: 'gemini',
      model,
      mode,
      structuredIngredients,
      ragContextUsed: ragContext.ragContextUsed,
      sources: ragContext.citations,
      servings: peopleCount,
      recipeReviewRequired: true,
      ...(recipeHistoryId ? { recipeHistoryId } : {}),
    });
  } catch (error) {
    serverLogger.error('recipe_generate.failed', {
      requestId,
      durationMs: Date.now() - startedAt,
      reason: error instanceof RecipeGenerationFailure ? error.code : error instanceof Error ? error.name : 'unknown',
      ...(error instanceof RecipeGenerationFailure && error.upstreamStatus !== undefined
        ? { upstreamStatus: error.upstreamStatus }
        : {}),
    });
    return NextResponse.json(
      { error: 'No se pudo generar la receta temporalmente.' },
      { status: 502 }
    );
  }
}
