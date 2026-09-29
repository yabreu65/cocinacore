import { NextRequest, NextResponse } from 'next/server';
import { serverLogger } from '@/lib/serverLogger';
import { validateRequest, MealPlanSchema, type MealPlanBody } from '@/lib/validation';
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
} from '@/lib/db/repositories/mealPlanRepository';
import { buildMealPlanInventoryContext } from '@/lib/meal-planner/inventory-context';
import {
  buildPersistedMealPlanProfileContext,
  formatPersistedMealPlanProfileContext,
} from '@/lib/meal-planner/profile-context';
import { getMealPlanPeriodLabel } from '@/lib/meal-planner/prompt';
import {
  buildStructuredMealPlanInstructions,
  parseStructuredMealPlanResponse,
  parseStructuredMealPlanValue,
  renderStructuredMealPlan,
  structuredMealPlanResponseJsonSchema,
} from '@/lib/meal-planner/structured-plan';

const AI_REQUEST_TIMEOUT_MS = 60_000;
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
      ? normalizeRestrictions(persistedPlan.restrictions.filter((value): value is string => typeof value === 'string'))
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

  const validation = await validateRequest(request, MealPlanSchema.passthrough());
  if (!validation.success) {
    return Response.json(validation.error.body, { status: validation.error.status });
  }

  const body = validation.data as MealPlanBody & { cuisine?: string; country?: string };

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rateLimit = await checkRateLimit('meal-plan', ip);
  if (!rateLimit.success) {
    return Response.json(
      { error: 'Rate limit exceeded', retryAfter: rateLimit.resetAt },
      {
        status: 429,
        headers: {
          'Retry-After': String(rateLimit.resetAt),
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
  const [inventoryItems, persistedProfile, persistedProfileTerms] = await Promise.all([
    listInventoryItemsByTenant(tenantId),
    findCulinaryProfileByUserId(user.id),
    findCulinaryProfileTermsByUserId(user.id),
  ]);
  const inventoryLines = buildMealPlanInventoryContext(inventoryItems, tenantId);
  const inventoryContext =
    inventoryLines.join('\n') || 'Sin inventario persistido para este hogar.';
  const persistedProfileContext = formatPersistedMealPlanProfileContext(
    buildPersistedMealPlanProfileContext(persistedProfile, persistedProfileTerms, user.id, tenantId)
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

  const structuredOutputInstructions = buildStructuredMealPlanInstructions(period);

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
- Respeta estrictamente "Evitar" y las restricciones explícitas de esta solicitud.
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
- Respeta estrictamente "Evitar" y las restricciones explícitas de esta solicitud.
- Integra técnicas/sabores de fusión si se especifican culturas de fusión.
- Si intensidad es sutil: prioriza cocina base y toques menores de fusión.
- Si intensidad es media: balancea cocina base y fusión.
- Si intensidad es alta: fusión protagonista manteniendo coherencia culinaria.
- Español.`;

  const fetchWithTimeout = async (url: string, init: RequestInit) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
  };

  try {
    let response: Response;
    try {
      response = await fetchWithTimeout(
        `${baseUrl}/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              responseJsonSchema: structuredMealPlanResponseJsonSchema,
            },
          }),
        }
      );
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Gemini timeout/error');
    }

    if (!response.ok) {
      serverLogger.warn('meal_plan.provider_response_failed', {
        requestId,
        model,
        status: response.status,
      });
      throw new Error('provider_response_failed');
    }

    const payload = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const candidateText = payload.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!candidateText) {
      serverLogger.warn('meal_plan.invalid_provider_response', {
        requestId,
        model,
        period,
        reason: 'empty_response',
      });
      return NextResponse.json({ error: 'El proveedor IA devolvió un plan inválido.' }, { status: 502 });
    }

    const parsedPlan = parseStructuredMealPlanResponse(candidateText, period);
    if (!parsedPlan.success) {
      serverLogger.warn('meal_plan.invalid_provider_response', {
        requestId,
        model,
        period,
        reason: parsedPlan.reason,
      });
      return NextResponse.json({ error: 'El proveedor IA devolvió un plan inválido.' }, { status: 502 });
    }

    let persistedPlan;
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

    const content = renderStructuredMealPlan(parsedPlan.plan);
    serverLogger.info('meal_plan.success', {
      requestId,
      durationMs: Date.now() - startedAt,
      period,
      dayCount: parsedPlan.plan.dayCount,
    });
    return NextResponse.json({ id: persistedPlan.id, content, plan: parsedPlan.plan });
  } catch (error) {
    serverLogger.warn('meal_plan.failed', {
      requestId,
      durationMs: Date.now() - startedAt,
      reason: error instanceof Error ? error.message : 'provider_error',
    });
    return NextResponse.json(
      { error: 'No se pudo generar menú con el proveedor IA.' },
      { status: 502 }
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
  let persistedPlan;
  try {
    persistedPlan = await findLatestMealPlanByUserAndTenant(user.id, tenantId);
  } catch {
    serverLogger.warn('meal_plan.retrieval_failed', { requestId });
    return NextResponse.json({ error: 'No se pudo recuperar el menú guardado.' }, { status: 500 });
  }

  if (!persistedPlan) {
    return NextResponse.json({ plan: null, content: null });
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

  const parsedPlan = parseStructuredMealPlanValue(persistedPlan.calendar_payload, persistedPlan.period);
  if (!parsedPlan.success) {
    serverLogger.warn('meal_plan.invalid_persisted_plan', {
      requestId,
      mealPlanId: persistedPlan.id,
      period: persistedPlan.period,
      reason: parsedPlan.reason,
    });
    return NextResponse.json({ error: 'No se pudo recuperar el menú guardado.' }, { status: 500 });
  }

  return NextResponse.json({
    plan: parsedPlan.plan,
    content: renderStructuredMealPlan(parsedPlan.plan),
    id: persistedPlan.id,
    createdAt: persistedPlan.created_at,
    ...settings,
  });
}
