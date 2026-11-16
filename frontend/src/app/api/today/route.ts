import {
  getLocalDateInTimeZone,
  parseStructuredMealPlanValue,
} from '@/lib/meal-planner/structured-plan';
import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/server';
import type { AuthUser } from '@/lib/auth/types';
import { getGeminiApiKey, getGeminiBaseUrl, getGeminiModel } from '@/lib/ai/gemini-config';
import { serverLogger } from '@/lib/serverLogger';
import { checkRateLimit } from '@/lib/rate-limit';
import { getRetryAfterSeconds } from '@/lib/rate-limit-identity';
import {
  findCulinaryProfileByUserId,
  findCulinaryProfileTermsByUserId,
} from '@/lib/db/repositories/culinaryProfileRepository';
import { listTodayInventoryContextByTenant } from '@/lib/db/repositories/inventoryRepository';
import {
  listPersistentRecipes,
  listTodayRecipeHistoryByUserAndTenant,
} from '@/lib/db/repositories/recipeRepository';
import { findLatestMealPlanByUserAndTenant } from '@/lib/db/repositories/mealPlanRepository';
import { retrieveServerRagContext } from '@/lib/recipes/server-rag-context';
import { buildTodayContext, type TodayProviderContext } from '@/lib/today/context';
import { parseQuantity } from '@/lib/inventory/quantity-normalization';
import {
  rankOneSlotOptions,
  TODAY_SLOT_VALUES,
  type TodaySlot,
  type TodayOptionSource,
} from '@/lib/today/one-slot';
import {
  recommendLocalFirst,
  type LocalFirstCandidate,
  type LocalFirstRecommendation,
} from '@/lib/today/local-first-engine';

const MAX_PREP_MINUTES = 240;
const PROVIDER_TIMEOUT_MS = 60_000;
const TODAY_SCHEMA_ID = 'today_options';
const TODAY_SCHEMA_VERSION = 1;
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    options: {
      type: 'ARRAY',
      minItems: 3,
      maxItems: 5,
      items: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          slot: { type: 'STRING', enum: [...TODAY_SLOT_VALUES] },
          ingredients: { type: 'ARRAY', items: { type: 'STRING' }, minItems: 1, maxItems: 30 },
          prepMinutes: { type: 'INTEGER', minimum: 1, maximum: MAX_PREP_MINUTES },
        },
        required: ['title', 'slot', 'ingredients', 'prepMinutes'],
      },
    },
  },
  required: ['options'],
};

type Candidate = {
  title: string;
  slot: TodaySlot;
  ingredients: string[];
  prepMinutes: number | null;
  source: TodayOptionSource;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validTodayTimeZone(value: string): boolean {
  return (
    value.length <= 100 &&
    /^[A-Za-z][A-Za-z0-9_+/-]*$/.test(value) &&
    getLocalDateInTimeZone(new Date(0), value) !== null
  );
}

function parseBody(value: unknown): { slot: TodaySlot; timeZone?: string } | null {
  if (
    !isRecord(value) ||
    !Object.hasOwn(value, 'slot') ||
    Object.keys(value).some((key) => key !== 'slot' && key !== 'timeZone') ||
    typeof value.slot !== 'string' ||
    !(TODAY_SLOT_VALUES as readonly string[]).includes(value.slot)
  )
    return null;
  if (Object.hasOwn(value, 'timeZone')) {
    if (
      typeof value.timeZone !== 'string' ||
      value.timeZone.length > 100 ||
      !validTodayTimeZone(value.timeZone)
    )
      return null;
    return { slot: value.slot as TodaySlot, timeZone: value.timeZone };
  }
  return { slot: value.slot as TodaySlot };
}

function parseProviderOptions(payload: unknown, slot: TodaySlot): Candidate[] | null {
  if (
    !isRecord(payload) ||
    Object.keys(payload).length !== 1 ||
    !Object.hasOwn(payload, 'options') ||
    !Array.isArray(payload.options) ||
    payload.options.length < 3 ||
    payload.options.length > 5
  )
    return null;
  const parsed: Candidate[] = [];
  for (const item of payload.options) {
    if (
      !isRecord(item) ||
      Object.keys(item).length !== 4 ||
      typeof item.title !== 'string' ||
      !item.title.trim() ||
      item.title.trim().length > 120 ||
      item.slot !== slot ||
      !Array.isArray(item.ingredients) ||
      item.ingredients.length < 1 ||
      item.ingredients.length > 30 ||
      !item.ingredients.every(
        (ingredient) =>
          typeof ingredient === 'string' && ingredient.trim().length > 0 && ingredient.length <= 80
      ) ||
      typeof item.prepMinutes !== 'number' ||
      !Number.isInteger(item.prepMinutes) ||
      item.prepMinutes < 1 ||
      item.prepMinutes > MAX_PREP_MINUTES
    )
      return null;
    parsed.push({
      title: item.title.trim(),
      slot,
      ingredients: item.ingredients.map((ingredient: string) => ingredient.trim()),
      prepMinutes: item.prepMinutes,
      source: 'provider',
    });
  }
  return parsed;
}

function promptFor(context: TodayProviderContext, ragText: string): string {
  return `Suggest 3 to 5 distinct meal options for the requested slot. Treat allergies and hardAvoid as absolute exclusions; dislikes are preferences only. Use only the supplied context. Never claim allergy safety beyond explicitly listed allergies. Return only JSON matching the supplied schema.\nTrusted meal context JSON:\n${JSON.stringify(context)}${ragText ? `\nOptional trusted cookbook text (plain text only):\n${ragText}` : ''}`;
}

function userReason(candidate: LocalFirstRecommendation) {
  const availableIngredients = candidate.ingredientAvailability
    .filter(({ availability }) => availability === 'sufficient')
    .map(({ name }) => name);
  const missingIngredients = candidate.ingredientAvailability
    .filter(({ availability }) => availability === 'missing' || availability === 'partial')
    .map(({ name }) => name);
  const unknownIngredients = candidate.ingredientAvailability
    .filter(({ availability }) => availability === 'unknown')
    .map(({ name }) => name);
  const reason =
    candidate.source === 'saved_plan'
      ? 'Una opción guardada en tu plan; el día del plan no determina que esté programada para hoy.'
      : candidate.source === 'saved_recipe'
        ? 'Una receta guardada en tu biblioteca.'
        : candidate.source === 'history'
          ? 'Una opción de tu historial reciente.'
          : availableIngredients.length > 0
            ? 'Aprovecha ingredientes disponibles en tu inventario.'
            : 'Una opción para el horario elegido.';
  return {
    title: candidate.title,
    slot: candidate.slot,
    ingredients: candidate.ingredients.map((ingredient) =>
      typeof ingredient === 'string' ? ingredient : ingredient.name
    ),
    prepMinutes: candidate.prepMinutes,
    ...(candidate.servings === undefined ? {} : { servings: candidate.servings }),
    source: candidate.provenance,
    provenance: candidate.provenance,
    availability: candidate.availability,
    reason,
    availableIngredients,
    missingIngredients,
    unknownIngredients,
    ingredientAvailability: candidate.ingredientAvailability,
    quantityProvenance: candidate.quantityProvenance,
    uncertainty: candidate.uncertainty,
  };
}

class ProviderTimeoutError extends Error {}

type RagOutcome =
  | 'success'
  | 'not_attempted'
  | 'unavailable_timeout'
  | 'unavailable_network'
  | 'unavailable_other';
type GenerationOutcome =
  | 'success'
  | 'not_configured'
  | 'http_non_2xx'
  | 'timeout'
  | 'network_error'
  | 'empty_response'
  | 'response_json_parse_error'
  | 'empty_envelope'
  | 'malformed_envelope'
  | 'empty_parts'
  | 'malformed_parts'
  | 'json_parse_error'
  | 'local_validation_failed';
type ProviderLoadResult = {
  options: Candidate[] | null;
  outcome: GenerationOutcome;
  httpStatus?: number;
  ragOutcome: RagOutcome;
};
type GenerationLoadResult = {
  options: Candidate[] | null;
  outcome: GenerationOutcome;
  httpStatus?: number;
};
type RankingOutcome = 'sufficient_safe_options' | 'insufficient_safe_options' | 'invalid';

function safeStatusClass(status: number): string {
  return `${Math.floor(status / 100)}xx`;
}

function safeModelIdentifier(model: string): string {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(model) ? model : 'custom';
}

function logTodayPipeline(input: {
  requestId: string;
  slot: TodaySlot;
  ragOutcome: RagOutcome;
  generationOutcome: GenerationOutcome;
  rankingOutcome: RankingOutcome;
  httpStatus?: number;
  providerOptionCount: number;
  safeProviderCount: number;
  fallbackOptionCount: number;
  profileConfigured: boolean;
  inventoryCount: number;
  model: string;
}): void {
  serverLogger.info('today_pipeline', {
    requestId: input.requestId,
    slot: input.slot,
    ragOutcome: input.ragOutcome,
    generationOutcome: input.generationOutcome,
    rankingOutcome: input.rankingOutcome,
    ...(input.httpStatus === undefined
      ? {}
      : { httpStatus: input.httpStatus, httpStatusClass: safeStatusClass(input.httpStatus) }),
    providerOptionCount: input.providerOptionCount,
    safeProviderCount: input.safeProviderCount,
    fallbackOptionCount: input.fallbackOptionCount,
    profileConfigured: input.profileConfigured,
    inventoryCount: input.inventoryCount,
    model: input.model,
    schemaId: TODAY_SCHEMA_ID,
    schemaVersion: TODAY_SCHEMA_VERSION,
  });
}

async function withProviderTimeout<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const operationResult = Promise.resolve()
    .then(() => operation(controller.signal))
    .catch((error: unknown) => {
      if (timedOut) throw new ProviderTimeoutError();
      throw error;
    });
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new ProviderTimeoutError());
      controller.abort();
    }, PROVIDER_TIMEOUT_MS);
  });
  try {
    return await Promise.race([operationResult, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function loadProviderOptions(
  context: TodayProviderContext,
  apiKey: string,
  tenantId: string,
  userId: string,
  configuredModel: string
): Promise<ProviderLoadResult> {
  let ragText = '';
  let ragOutcome: RagOutcome = 'success';
  try {
    const rag = await withProviderTimeout((signal) =>
      retrieveServerRagContext({
        apiKey,
        tenantId,
        userId,
        ingredients: context.inventory.map(({ name }) => name).slice(0, 20),
        mealType: context.slot,
        restrictions: { allergies: context.allergies, dietaryRules: context.hardAvoid },
        signal,
      })
    );
    ragText =
      typeof rag.context === 'string'
        ? rag.context
            .replace(/--- CONTEXTO DE RECETARIO CONFIABLE[^\n]*---\s*/gi, '')
            .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
            .slice(0, 4000)
        : '';
  } catch (error) {
    ragOutcome =
      error instanceof ProviderTimeoutError
        ? 'unavailable_timeout'
        : error instanceof TypeError || (isRecord(error) && error.name === 'AbortError')
          ? 'unavailable_network'
          : 'unavailable_other';
    // Retrieval is optional; it cannot weaken restrictions or fail the request.
  }
  try {
    const options = await withProviderTimeout(async (signal): Promise<GenerationLoadResult> => {
      const response = await fetch(
        `${getGeminiBaseUrl()}/models/${encodeURIComponent(configuredModel)}:generateContent`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: promptFor(context, ragText) }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: RESPONSE_SCHEMA,
            },
          }),
          signal,
        }
      );
      if (!response.ok)
        return { options: null, outcome: 'http_non_2xx', httpStatus: response.status };
      if (response.body === null || response.headers.get('content-length') === '0') {
        return { options: null, outcome: 'empty_response', httpStatus: response.status };
      }
      let result: unknown;
      try {
        result = await response.json();
      } catch {
        return { options: null, outcome: 'response_json_parse_error', httpStatus: response.status };
      }
      if (!isRecord(result) || !Array.isArray(result.candidates)) {
        return { options: null, outcome: 'malformed_envelope', httpStatus: response.status };
      }
      if (result.candidates.length === 0)
        return { options: null, outcome: 'empty_envelope', httpStatus: response.status };
      const candidates: unknown[] = result.candidates;
      const firstCandidate: unknown = candidates[0];
      if (
        !isRecord(firstCandidate) ||
        !isRecord(firstCandidate.content) ||
        !Array.isArray(firstCandidate.content.parts)
      ) {
        return { options: null, outcome: 'malformed_envelope', httpStatus: response.status };
      }
      if (firstCandidate.content.parts.length === 0)
        return { options: null, outcome: 'empty_parts', httpStatus: response.status };
      const parts: unknown[] = firstCandidate.content.parts;
      const firstPart: unknown = parts[0];
      if (!isRecord(firstPart) || typeof firstPart.text !== 'string') {
        return { options: null, outcome: 'malformed_parts', httpStatus: response.status };
      }
      if (!firstPart.text.trim())
        return { options: null, outcome: 'empty_parts', httpStatus: response.status };
      let parsed: unknown;
      try {
        parsed = JSON.parse(firstPart.text);
      } catch {
        return { options: null, outcome: 'json_parse_error', httpStatus: response.status };
      }
      const providerOptions = parseProviderOptions(parsed, context.slot);
      return providerOptions
        ? { options: providerOptions, outcome: 'success', httpStatus: response.status }
        : { options: null, outcome: 'local_validation_failed', httpStatus: response.status };
    });
    return { ...options, ragOutcome };
  } catch (error) {
    return {
      options: null,
      outcome: error instanceof ProviderTimeoutError ? 'timeout' : 'network_error',
      ragOutcome,
    };
  }
}

export async function POST(request: NextRequest) {
  let user: AuthUser;
  try {
    user = await requireUser(request);
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const tenantId = user.tenant?.tenantId;
  if (!tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  const body = parseBody(rawBody);
  if (!body) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  const { slot } = body;

  const rateLimit = await checkRateLimit('today', tenantId, user.id, {
    requireSharedStore: true,
  });
  if (!rateLimit.success) {
    const retryAfter = getRetryAfterSeconds(rateLimit.resetAt);
    return NextResponse.json(
      {
        error:
          rateLimit.storage === 'unavailable'
            ? 'El recomendador no está disponible temporalmente.'
            : 'Rate limit exceeded',
        retryAfter,
      },
      {
        status: rateLimit.storage === 'unavailable' ? 503 : 429,
        headers: {
          'Retry-After': String(retryAfter),
          'X-RateLimit-Limit': String(rateLimit.limit),
          'X-RateLimit-Remaining': String(rateLimit.remaining),
          'X-RateLimit-Reset': String(rateLimit.resetAt),
        },
      }
    );
  }

  const now = new Date();
  let profile, terms, latestPlan, inventoryRows, history, asOf: string, timeZone: string;
  try {
    [profile, terms, latestPlan] = await Promise.all([
      findCulinaryProfileByUserId(user.id, tenantId),
      findCulinaryProfileTermsByUserId(user.id, tenantId),
      findLatestMealPlanByUserAndTenant(user.id, tenantId),
    ]);
    if (latestPlan && (latestPlan.tenant_id !== tenantId || latestPlan.user_id !== user.id))
      return NextResponse.json({ error: 'Today is temporarily unavailable' }, { status: 503 });
    const parsed = latestPlan
      ? parseStructuredMealPlanValue(latestPlan.calendar_payload, latestPlan.period)
      : null;
    timeZone =
      body.timeZone ?? (parsed?.success ? parsed.plan.schedule?.timeZone : undefined) ?? 'UTC';
    if (!validTodayTimeZone(timeZone))
      return NextResponse.json({ error: 'Today is temporarily unavailable' }, { status: 503 });
    const localDate = getLocalDateInTimeZone(now, timeZone);
    if (!localDate)
      return NextResponse.json({ error: 'Today is temporarily unavailable' }, { status: 503 });
    asOf = localDate;
    [inventoryRows, history] = await Promise.all([
      listTodayInventoryContextByTenant(
        tenantId,
        asOf,
        50,
        { tenantId, userId: user.id },
        timeZone
      ),
      listTodayRecipeHistoryByUserAndTenant(user.id, tenantId, asOf, 20, timeZone),
    ]);
  } catch {
    return NextResponse.json({ error: 'Today is temporarily unavailable' }, { status: 503 });
  }

  const contextResult = buildTodayContext({
    userId: user.id,
    tenantId,
    asOf,
    timeZone,
    slot,
    profile,
    terms,
    inventory: inventoryRows,
    history,
    latestPlan,
  });
  if (contextResult.status !== 'ready')
    return NextResponse.json({ error: 'Today is temporarily unavailable' }, { status: 503 });
  const context = contextResult.providerContext;
  const requestId = randomUUID();
  const configuredModel = getGeminiModel();
  const model = safeModelIdentifier(configuredModel);
  const apiKey = getGeminiApiKey();
  const providerLoad = apiKey
    ? await loadProviderOptions(context, apiKey, tenantId, user.id, configuredModel)
    : { options: null, outcome: 'not_configured' as const, ragOutcome: 'not_attempted' as const };
  const providerOptions = providerLoad.options;
  const rankedProvider = rankOneSlotOptions(providerOptions ?? [], {
    asOf,
    slot,
    maxPrepMinutes: context.maxPrepMinutes ?? MAX_PREP_MINUTES,
    allergies: context.allergies,
    hardAvoid: context.hardAvoid,
    dislikedIngredients: context.dislikedIngredients,
    recentTitles: contextResult.localSignals.recentTitles,
    inventory: context.inventory,
  });
  const safeProvider = rankedProvider.status === 'invalid' ? [] : rankedProvider.options;
  const providerSucceeded = safeProvider.length >= 3;
  const persistentRecipes = await listPersistentRecipes(
    { tenantId, userId: user.id },
    { limit: 50 }
  ).catch(() => []);

  const localCandidates: LocalFirstCandidate[] = [
    ...persistentRecipes.map(
      (recipe): LocalFirstCandidate => ({
        id: recipe.id,
        title: recipe.current_version.title,
        slot,
        ingredients: recipe.current_version.ingredients.map(({ name, quantity, unit }) => {
          const parsed = typeof quantity === 'string' ? parseQuantity(quantity) : null;
          return {
            name,
            quantity: parsed?.structured ? parsed.value : null,
            unit: unit ?? (parsed?.structured ? parsed.unit : null),
          };
        }),
        prepMinutes: null,
        servings: recipe.current_version.servings,
        source: 'saved_recipe',
        ...(recipe.current_version.ingredients.some(
          ({ quantity }) => typeof quantity === 'string' && quantity.trim().length > 0
        )
          ? {
              quantityProvenance: recipe.current_version.source_recipe_history_id
                ? ('ai_estimate' as const)
                : ('unknown' as const),
            }
          : {}),
        identity: { userId: recipe.user_id, tenantId: recipe.tenant_id },
      })
    ),
    ...contextResult.localSignals.historyCandidates.map(
      (candidate, index): LocalFirstCandidate => ({
        ...candidate,
        id: `history-${index}-${candidate.title}`,
        identity: { userId: user.id, tenantId },
      })
    ),
    ...contextResult.localSignals.savedPlanCandidates.map(
      (candidate, index): LocalFirstCandidate => ({
        ...candidate,
        id: `saved-plan-${index}-${candidate.title}`,
        identity: { userId: user.id, tenantId },
        plannedDate: null,
      })
    ),
    ...safeProvider.map(
      (candidate, index): LocalFirstCandidate => ({
        ...candidate,
        id: `provider-${index}-${candidate.title}`,
      })
    ),
  ];
  const recommendations = recommendLocalFirst({
    asOf,
    slot,
    maxPrepMinutes: context.maxPrepMinutes ?? MAX_PREP_MINUTES,
    userId: user.id,
    tenantId,
    allergies: context.allergies,
    hardAvoid: context.hardAvoid,
    dislikedIngredients: context.dislikedIngredients,
    preferred: context.preferred,
    recentTitles: contextResult.localSignals.recentTitles,
    inventory: context.inventory.map((item) => ({
      ingredient_name: item.name,
      quantity: item.quantity ?? null,
      unit: item.unit ?? null,
      ...(item.expiresOn ? { expiresOn: item.expiresOn } : {}),
    })),
    candidates: localCandidates,
    plannedMeals: [],
    providerStatus: providerOptions === null ? 'unavailable' : 'available',
  });
  const options = recommendations.status === 'ready' ? recommendations.recommendations : [];
  logTodayPipeline({
    requestId,
    slot,
    ragOutcome: providerLoad.ragOutcome,
    generationOutcome: providerLoad.outcome,
    rankingOutcome:
      rankedProvider.status === 'invalid'
        ? 'invalid'
        : providerSucceeded
          ? 'sufficient_safe_options'
          : 'insufficient_safe_options',
    model,
    ...(providerLoad.httpStatus === undefined ? {} : { httpStatus: providerLoad.httpStatus }),
    providerOptionCount: Math.min(providerOptions?.length ?? 0, 5),
    safeProviderCount: Math.min(safeProvider.length, 5),
    fallbackOptionCount: Math.min(
      options.filter((option) => option.source !== 'provider').length,
      50
    ),
    profileConfigured: context.profileConfigured,
    inventoryCount: Math.min(context.inventory.length, 50),
  });
  return NextResponse.json({
    status: providerSucceeded ? 'success' : 'degraded',
    ...(!providerSucceeded
      ? {
          reason: providerOptions === null ? 'provider-unavailable' : 'insufficient-safe-options',
        }
      : {}),
    options: options.map((option) => userReason(option)),
    ...(context.profileConfigured ? {} : { warnings: ['PROFILE_NOT_CONFIGURED'] }),
  });
}
