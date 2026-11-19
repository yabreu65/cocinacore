import { NextRequest, NextResponse } from 'next/server';
import { serverLogger } from '@/lib/serverLogger';
import { extractGeminiTextResponse } from '@/services/apiDtos';
import { validateRequest, MealPlanRequestSchema, type MealPlanBody } from '@/lib/validation';
import { checkRateLimit } from '@/lib/rate-limit';
import { getGeminiApiKey, getGeminiBaseUrl, getGeminiModel } from '@/lib/ai/gemini-config';
import { requireUser } from '@/lib/auth/server';
import type { AuthUser } from '@/lib/auth/types';
import { listInventoryItemsByTenant } from '@/lib/db/repositories/inventoryRepository';
import {
  findCulinaryProfileByUserId,
  findCulinaryProfileTermsByUserId,
} from '@/lib/db/repositories/culinaryProfileRepository';
import {
  createMealPlan,
  findLatestMealPlanByUserAndTenant,
  findMealPlanByIdForUserAndTenant,
} from '@/lib/db/repositories/mealPlanRepository';
import { buildMealPlanInventoryContext } from '@/lib/meal-planner/inventory-context';
import {
  buildPersistedMealPlanProfileContext,
  formatPersistedMealPlanProfileContext,
} from '@/lib/meal-planner/profile-context';
import { getMealPlanPeriodLabel } from '@/lib/meal-planner/prompt';
import {
  buildStructuredMealPlanInstructions,
  hasRestrictedMealPlanContent,
  mealPlanRestrictionsChanged,
  parseStructuredMealPlanResponse,
  parseStructuredMealPlanValue,
  renderStructuredMealPlan,
  structuredMealPlanResponseJsonSchema,
} from '@/lib/meal-planner/structured-plan';
import { z } from 'zod';
import { validateOperationalMealPlanRequest } from '@/lib/operational-domain';
import { getRetryAfterSeconds } from '@/lib/rate-limit-identity';

// Keep one bounded request per plan; long periods need more output time.
const AI_REQUEST_TIMEOUT_MS: Record<MealPlanBody['period'], number> = {
  week: 60_000,
  fortnight: 120_000,
  month: 180_000,
};

class MealPlanProviderError extends Error {
  constructor(readonly status: number) { super('provider_response_failed'); }
}
const DEFAULT_PEOPLE_COUNT = 4;
const DEFAULT_BASE_CUISINE = 'Latinoamericana';

function normalizeRestrictions(values: string[]): string[] {
  const seen = new Set<string>();
  const restrictions: string[] = [];

  for (const value of values) {
    const normalized = value.trim().replace(/\s+/g, ' ').slice(0, 100);
    const key = normalized.toLocaleLowerCase();
    if (!normalized || seen.has(key)) continue;

    seen.add(key);
    restrictions.push(normalized);
  }

  return restrictions;
}

function isMealPlanPeriod(value: unknown): value is MealPlanBody['period'] {
  return value === 'week' || value === 'fortnight' || value === 'month';
}

function getPublicMealPlanSettings(persistedPlan: {
  people_count: unknown;
  period: unknown;
  mode: unknown;
  base_cuisine: unknown;
  fusion_cuisines: unknown;
  fusion_intensity: unknown;
  restrictions: unknown;
}) {
  return {
    peopleCount:
      typeof persistedPlan.people_count === 'number' &&
      Number.isInteger(persistedPlan.people_count) &&
      persistedPlan.people_count >= 1 &&
      persistedPlan.people_count <= 100
        ? persistedPlan.people_count
        : DEFAULT_PEOPLE_COUNT,
    period: isMealPlanPeriod(persistedPlan.period) ? persistedPlan.period : 'week',
    mode:
      persistedPlan.mode === 'inventory_to_menu' ||
      persistedPlan.mode === 'menu_to_shopping' ||
      persistedPlan.mode === 'balanced_ai'
        ? persistedPlan.mode
        : 'inventory_to_menu',
    baseCuisine:
      typeof persistedPlan.base_cuisine === 'string' && persistedPlan.base_cuisine.trim()
        ? persistedPlan.base_cuisine.trim().slice(0, 100)
        : DEFAULT_BASE_CUISINE,
    fusionCuisines: Array.isArray(persistedPlan.fusion_cuisines)
      ? persistedPlan.fusion_cuisines
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim().slice(0, 100))
          .filter(Boolean)
          .slice(0, 2)
      : [],
    fusionIntensity:
      persistedPlan.fusion_intensity === 'sutil' ||
      persistedPlan.fusion_intensity === 'media' ||
      persistedPlan.fusion_intensity === 'alta'
        ? persistedPlan.fusion_intensity
        : 'media',
    restrictions: Array.isArray(persistedPlan.restrictions)
      ? normalizeRestrictions(
          persistedPlan.restrictions.filter((value): value is string => typeof value === 'string')
        )
      : [],
  };
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();

  let user: AuthUser;
  try {
    user = await requireUser(request);
  } catch {
    serverLogger.warn('meal_plan.unauthorized', { requestId });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!user.tenant) {
    serverLogger.warn('meal_plan.unauthorized', { requestId });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const tenantId = user.tenant.tenantId;

  const apiKey = getGeminiApiKey();
  const baseUrl = getGeminiBaseUrl();
  const model = getGeminiModel();

  const validation = await validateRequest(request, MealPlanRequestSchema);
  if (!validation.success) {
    return Response.json(validation.error.body, { status: validation.error.status });
  }

  const body = validation.data as MealPlanBody & {
    cuisine?: string;
    country?: string;
  };

  const operationalValidation = validateOperationalMealPlanRequest(user.tenant, {
    period: body.period,
    peopleCount: body.peopleCount,
  });
  if (!operationalValidation.success) {
    return NextResponse.json(
      { error: 'Invalid operational meal-plan request', code: operationalValidation.code },
      { status: 400 }
    );
  }

  const rateLimit = await checkRateLimit('meal-plan', tenantId, user.id, {
    requireSharedStore: true,
  });
  if (!rateLimit.success) {
    const retryAfter = getRetryAfterSeconds(rateLimit.resetAt);
    const storageUnavailable = rateLimit.storage === 'unavailable';
    return Response.json(
      {
        error: storageUnavailable
          ? 'El planificador no está disponible temporalmente.'
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

  if (!apiKey) {
    serverLogger.warn('meal_plan.misconfigured', { requestId });
    return NextResponse.json(
      {
        error: 'No hay proveedor IA configurado. Definí GEMINI_API_KEY.',
      },
      { status: 503 }
    );
  }

  const mode = body.mode ?? 'inventory_to_menu';
  const period = body.period ?? 'week';
  const baseCuisine = (body.baseCuisine ?? body.cuisine ?? 'Latinoamericana').trim();
  const fusionCuisines = (body.fusionCuisines ?? (body.country ? [body.country] : []))
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 2);
  const fusionIntensity = body.fusionIntensity ?? 'media';
  const restrictions = normalizeRestrictions(body.restrictions);
  let inventoryItems: Awaited<ReturnType<typeof listInventoryItemsByTenant>>;
  let persistedProfile: Awaited<ReturnType<typeof findCulinaryProfileByUserId>>;
  let persistedProfileTerms: Awaited<ReturnType<typeof findCulinaryProfileTermsByUserId>>;
  try {
    [inventoryItems, persistedProfile, persistedProfileTerms] = await Promise.all([
      listInventoryItemsByTenant(tenantId, undefined, undefined, {}, { tenantId, userId: user.id }),
      findCulinaryProfileByUserId(user.id, tenantId),
      findCulinaryProfileTermsByUserId(user.id, tenantId),
    ]);
  } catch {
    serverLogger.warn('meal_plan.profile_retrieval_failed', { requestId });
    return NextResponse.json({ error: 'No se pudo recuperar el contexto culinario.' }, { status: 500 });
  }
  const inventoryLines = buildMealPlanInventoryContext(inventoryItems, tenantId);
  const inventoryContext =
    inventoryLines.join('\n') || 'Sin inventario persistido para este hogar.';
  const persistedProfileContextData = buildPersistedMealPlanProfileContext(
    persistedProfile,
    persistedProfileTerms,
    user.id,
    tenantId
  );
  if ((persistedProfile || persistedProfileTerms.length > 0) && !persistedProfileContextData)
    return NextResponse.json({ error: 'No se pudo recuperar el contexto culinario.' }, { status: 409 });
  const persistedProfileContext = formatPersistedMealPlanProfileContext(
    persistedProfileContextData
  );
  const peopleCount =
    typeof body.peopleCount === 'number' &&
    Number.isFinite(body.peopleCount) &&
    body.peopleCount > 0
      ? Math.floor(body.peopleCount)
      : DEFAULT_PEOPLE_COUNT;
  const chunks = (body.chunks ?? [])
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 10);

  const restrictionContext =
    restrictions.length > 0
      ? restrictions.map((restriction) => `- ${restriction}`).join('\n')
      : 'Sin restricciones explícitas para esta solicitud.';
  const periodLabel = getMealPlanPeriodLabel(period);
  const cuisineLabel =
    fusionCuisines.length > 0
      ? `${baseCuisine} fusionada con ${fusionCuisines.join(' y ')}`
      : baseCuisine;

  serverLogger.info('meal_plan.request', {
    requestId,
    model,
    mode,
    period,
    peopleCount,
    inventoryCount: inventoryLines.length,
    fusionCount: fusionCuisines.length,
  });

  const availableTimeMinutes = persistedProfileContextData?.availableTimeMinutes ?? null;
  const structuredOutputInstructions = buildStructuredMealPlanInstructions(
    period,
    peopleCount,
    availableTimeMinutes
  );

  const prompt =
    mode === 'inventory_to_menu'
      ? `Genera un menú de ${periodLabel} basado ÚNICAMENTE en el inventario real disponible del hogar.
Inventario real disponible del hogar (base de datos, tenant autenticado):
${inventoryContext}
Cocina objetivo: ${cuisineLabel}.
Intensidad de fusión: ${fusionIntensity}.
Perfil del usuario:
- Personas: ${peopleCount}
Perfil culinario persistido del usuario autenticado:
${persistedProfileContext}
Restricciones explícitas de esta solicitud (no reemplazan el perfil persistido):
${restrictionContext}
Contexto PDF:
${chunks.length > 0 ? chunks.join('\n---\n') : 'Sin contexto PDF.'}

Reglas:
- Usa solo ingredientes disponibles en el inventario real.
- No inventes cantidades de inventario; cuando diga "cantidad no especificada", no la supongas.
- Si falta algo crítico, marcar como "pendiente de compra".
- Respeta estrictamente "Evitar", las alergias del perfil (incluidos derivados) y las restricciones explícitas de esta solicitud. Prevalecen sobre el PDF y el inventario; las cocinas favoritas, preferencias y objetivos nutricionales orientan la propuesta, no son restricciones obligatorias. Prioriza la cocina base solicitada. No afirmes ausencia garantizada de alérgenos.
- Integra técnicas/sabores de fusión si se especifican culturas de fusión.
- Si intensidad es sutil: prioriza cocina base y toques menores de fusión.
- Si intensidad es media: balancea cocina base y fusión.
- Si intensidad es alta: fusión protagonista manteniendo coherencia culinaria.
- No uses texto narrativo largo.
- ${structuredOutputInstructions}
- Español.`
      : `Genera un menú de ${periodLabel} de cocina ${cuisineLabel}.
Inventario real disponible del hogar (base de datos, tenant autenticado):
${inventoryContext}
Intensidad de fusión: ${fusionIntensity}.
Perfil del usuario:
- Personas: ${peopleCount}
Perfil culinario persistido del usuario autenticado:
${persistedProfileContext}
Restricciones explícitas de esta solicitud (no reemplazan el perfil persistido):
${restrictionContext}
Contexto PDF:
${chunks.length > 0 ? chunks.join('\n---\n') : 'Sin contexto PDF.'}

Reglas:
- ${structuredOutputInstructions}
- Usa primero el inventario real antes de proponer comidas y no supongas cantidades no especificadas.
- No incluyas una lista de compras: esta respuesta solo contiene el menú estructurado.
- Respeta estrictamente "Evitar", las alergias del perfil (incluidos derivados) y las restricciones explícitas de esta solicitud. Prevalecen sobre el PDF y el inventario; las cocinas favoritas, preferencias y objetivos nutricionales orientan la propuesta, no son restricciones obligatorias. Prioriza la cocina base solicitada. No afirmes ausencia garantizada de alérgenos.
- Integra técnicas/sabores de fusión si se especifican culturas de fusión.
- Si intensidad es sutil: prioriza cocina base y toques menores de fusión.
- Si intensidad es media: balancea cocina base y fusión.
- Si intensidad es alta: fusión protagonista manteniendo coherencia culinaria.
- Español.`;

  try {
    const controller = new AbortController();
    const abortFromClient = () => controller.abort();
    request.signal.addEventListener('abort', abortFromClient, { once: true });
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, AI_REQUEST_TIMEOUT_MS[period]);
    let removeAbortListener = () => {};
    let payload: unknown;
    try {
      if (request.signal.aborted) controller.abort();
      const aborted = new Promise<never>((_, reject) => {
        const onAbort = () => reject(new Error(timedOut ? 'provider_request_timeout' : 'provider_request_aborted'));
        removeAbortListener = () => controller.signal.removeEventListener('abort', onAbort);
        if (controller.signal.aborted) onAbort();
        else controller.signal.addEventListener('abort', onAbort, { once: true });
      });
      const providerRequest = async (): Promise<unknown> => {
        if (controller.signal.aborted) throw new Error('provider_request_aborted');
        const response = await fetch(`${baseUrl}/models/${model}:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              responseJsonSchema: structuredMealPlanResponseJsonSchema,
            },
          }),
        });
        if (!response.ok) {
          serverLogger.warn('meal_plan.provider_response_failed', {
            requestId,
            model,
            status: response.status,
          });
          throw new MealPlanProviderError(response.status);
        }
        return response.json() as Promise<unknown>;
      };
      payload = await Promise.race([providerRequest(), aborted]);
      if (controller.signal.aborted) throw new Error(timedOut ? 'provider_request_timeout' : 'provider_request_aborted');
    } finally {
      clearTimeout(timeoutId);
      request.signal.removeEventListener('abort', abortFromClient);
      removeAbortListener();
    }

    const candidateText = extractGeminiTextResponse(payload);

    if (!candidateText) {
      serverLogger.warn('meal_plan.invalid_provider_response', {
        requestId,
        model,
        period,
        reason: 'empty_response',
      });
      return NextResponse.json(
        { error: 'El proveedor IA devolvió un plan inválido.' },
        { status: 502 }
      );
    }

    const parsedPlan = parseStructuredMealPlanResponse(candidateText, period);
    if (!parsedPlan.success) {
      serverLogger.warn('meal_plan.invalid_provider_response', {
        requestId,
        model,
        period,
        reason: parsedPlan.reason,
      });
      return NextResponse.json(
        { error: 'El proveedor IA devolvió un plan inválido.' },
        { status: 502 }
      );
    }

    const exceedsAvailableTime =
      availableTimeMinutes !== null &&
      parsedPlan.plan.days.some((day) =>
        day.meals.some(
          (meal) =>
            meal.prepMinutes === null ||
            meal.prepMinutes === undefined ||
            meal.prepMinutes > availableTimeMinutes
        )
      );
    if (exceedsAvailableTime) {
      serverLogger.warn('meal_plan.invalid_provider_response', {
        requestId,
        model,
        period,
        reason: 'available_time_exceeded',
      });
      return NextResponse.json(
        { error: 'El proveedor IA devolvió un plan inválido.' },
        { status: 502 }
      );
    }
    parsedPlan.plan.availableTimeMinutesSnapshot = availableTimeMinutes;

    const hardRestrictions = [
      ...(persistedProfileContextData?.allergies ?? []),
      ...(persistedProfileContextData?.avoid ?? []),
      ...restrictions,
    ];
    if (hasRestrictedMealPlanContent(parsedPlan.plan, hardRestrictions)) {
      serverLogger.warn('meal_plan.invalid_provider_response', {
        requestId,
        model,
        period,
        reason: 'restricted_ingredient',
      });
      return NextResponse.json(
        { error: 'El proveedor IA devolvió un plan inválido.' },
        { status: 502 }
      );
    }

    let persistedPlan: Awaited<ReturnType<typeof createMealPlan>>;
    try {
      persistedPlan = await createMealPlan({
        tenantId,
        userId: user.id,
        peopleCount,
        period,
        mode,
        baseCuisine,
        fusionCuisines,
        fusionIntensity,
        restrictions,
        expectedHardRestrictions: hardRestrictions,
        inventorySnapshot: { inventoryLines },
        structuredPlan: parsedPlan.plan,
      });
    } catch {
      serverLogger.warn('meal_plan.persistence_failed', {
        requestId,
        period,
        mode,
      });
      return NextResponse.json({ error: 'No se pudo guardar el menú generado.' }, { status: 500 });
    }

    if (!persistedPlan) {
      return NextResponse.json({ error: 'El perfil culinario cambió. Generá un menú nuevo.', code: 'MEAL_PLAN_RESTRICTIONS_CHANGED' }, { status: 409 });
    }
    const content = renderStructuredMealPlan(parsedPlan.plan);
    serverLogger.info('meal_plan.success', {
      requestId,
      durationMs: Date.now() - startedAt,
      period,
      dayCount: parsedPlan.plan.dayCount,
    });
    return NextResponse.json({ id: persistedPlan.id, content, plan: parsedPlan.plan });
  } catch (error) {
    const providerBusy = error instanceof MealPlanProviderError && (error.status === 429 || error.status === 503);
    const timedOut = error instanceof Error && error.message === 'provider_request_timeout';
    serverLogger.warn('meal_plan.failed', {
      requestId,
      durationMs: Date.now() - startedAt,
      reason: providerBusy ? 'provider_busy' : timedOut ? 'provider_timeout' : 'provider_error',
    });
    return NextResponse.json(
      { error: providerBusy
        ? 'El proveedor IA está temporalmente saturado o alcanzó su límite de uso. Intenta más tarde.'
        : timedOut
          ? 'El proveedor IA tardó demasiado en completar el menú. Intenta nuevamente.'
          : 'No se pudo generar menú con el proveedor IA.' },
      { status: providerBusy ? 503 : timedOut ? 504 : 502 }
    );
  }
}

export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID();

  let user: AuthUser;
  try {
    user = await requireUser(request);
  } catch {
    serverLogger.warn('meal_plan.unauthorized', { requestId });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!user.tenant) {
    serverLogger.warn('meal_plan.unauthorized', { requestId });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const tenantId = user.tenant.tenantId;
  const mealPlanId = new URL(request.url).searchParams.get('mealPlanId');
  if (mealPlanId !== null && !z.string().uuid().safeParse(mealPlanId).success)
    return NextResponse.json({ error: 'Identificador de menú inválido.' }, { status: 400 });
  let persistedPlan: Awaited<ReturnType<typeof findLatestMealPlanByUserAndTenant>>;
  try {
    persistedPlan = mealPlanId
      ? await findMealPlanByIdForUserAndTenant(mealPlanId, user.id, tenantId)
      : await findLatestMealPlanByUserAndTenant(user.id, tenantId);
  } catch {
    serverLogger.warn('meal_plan.retrieval_failed', { requestId });
    return NextResponse.json({ error: 'No se pudo recuperar el menú guardado.' }, { status: 500 });
  }

  if (!persistedPlan) {
    return mealPlanId ? NextResponse.json({ error: 'Menú no encontrado.' }, { status: 404 })
      : NextResponse.json({ plan: null, content: null });
  }

  const settings = getPublicMealPlanSettings(persistedPlan);
  if (!isMealPlanPeriod(persistedPlan.period)) {
    serverLogger.warn('meal_plan.invalid_persisted_plan', {
      requestId,
      mealPlanId: persistedPlan.id,
      reason: 'period_invalid',
    });
    return NextResponse.json({ error: 'No se pudo recuperar el menú guardado.' }, { status: 500 });
  }

  const parsedPlan = parseStructuredMealPlanValue(
    persistedPlan.calendar_payload,
    persistedPlan.period
  );
  if (!parsedPlan.success) {
    serverLogger.warn('meal_plan.invalid_persisted_plan', {
      requestId,
      mealPlanId: persistedPlan.id,
      period: persistedPlan.period,
      reason: parsedPlan.reason,
    });
    return NextResponse.json({ error: 'No se pudo recuperar el menú guardado.' }, { status: 500 });
  }

  let currentProfile: Awaited<ReturnType<typeof findCulinaryProfileByUserId>>;
  let currentProfileTerms: Awaited<ReturnType<typeof findCulinaryProfileTermsByUserId>>;
  try {
    [currentProfile, currentProfileTerms] = await Promise.all([
      findCulinaryProfileByUserId(user.id, tenantId),
      findCulinaryProfileTermsByUserId(user.id, tenantId),
    ]);
  } catch {
    serverLogger.warn('meal_plan.profile_retrieval_failed', { requestId });
    return NextResponse.json({ error: 'No se pudo recuperar el menú guardado.' }, { status: 500 });
  }

  const profileContext = buildPersistedMealPlanProfileContext(
    currentProfile,
    currentProfileTerms,
    user.id,
    tenantId
  );
  if ((currentProfile || currentProfileTerms.length > 0) && !profileContext)
    return NextResponse.json({ error: 'No se pudo recuperar el contexto culinario.' }, { status: 409 });
  const currentHardRestrictions = [
    ...(profileContext?.allergies ?? []),
    ...(profileContext?.avoid ?? []),
  ];
  if (mealPlanRestrictionsChanged(persistedPlan, currentHardRestrictions) ||
      hasRestrictedMealPlanContent(parsedPlan.plan, [...(persistedPlan.restrictions ?? []), ...currentHardRestrictions])) {
    serverLogger.warn('meal_plan.stale_restrictions', {
      requestId,
      mealPlanId: persistedPlan.id,
    });
    return NextResponse.json(
      {
        error: 'MEAL_PLAN_RESTRICTIONS_CHANGED',
        code: 'MEAL_PLAN_RESTRICTIONS_CHANGED',
      },
      { status: 409 }
    );
  }

  return NextResponse.json({
    plan: parsedPlan.plan,
    content: renderStructuredMealPlan(parsedPlan.plan),
    id: persistedPlan.id,
    createdAt: persistedPlan.created_at,
    updatedAt: persistedPlan.updated_at,
    ...settings,
  });
}
