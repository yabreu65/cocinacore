import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/server';
import { getGeminiApiKey, getGeminiBaseUrl, getGeminiModel } from '@/lib/ai/gemini-config';
import { findCulinaryProfileByUserId, findCulinaryProfileTermsByUserId } from '@/lib/db/repositories/culinaryProfileRepository';
import { listTodayInventoryContextByTenant } from '@/lib/db/repositories/inventoryRepository';
import { listTodayRecipeHistoryByUserAndTenant } from '@/lib/db/repositories/recipeRepository';
import { findLatestMealPlanByUserAndTenant } from '@/lib/db/repositories/mealPlanRepository';
import { retrieveServerRagContext } from '@/lib/recipes/server-rag-context';
import { normalizeIngredientName } from '@/lib/recipes/structured-ingredients';
import { buildTodayContext, type TodayProviderContext } from '@/lib/today/context';
import { rankOneSlotOptions, TODAY_SLOT_VALUES, type TodaySlot, type TodayOptionSource } from '@/lib/today/one-slot';

const MAX_PREP_MINUTES = 240;
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    options: {
      type: 'ARRAY', minItems: 3, maxItems: 5,
      items: {
        type: 'OBJECT', properties: {
          title: { type: 'STRING' },
          slot: { type: 'STRING', enum: [...TODAY_SLOT_VALUES] },
          ingredients: { type: 'ARRAY', items: { type: 'STRING' }, minItems: 1, maxItems: 30 },
          prepMinutes: { type: 'INTEGER', minimum: 1, maximum: MAX_PREP_MINUTES },
        }, required: ['title', 'slot', 'ingredients', 'prepMinutes'], additionalProperties: false,
      },
    },
  }, required: ['options'], additionalProperties: false,
};

type Candidate = { title: string; slot: TodaySlot; ingredients: string[]; prepMinutes: number | null; source: TodayOptionSource };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseBody(value: unknown): TodaySlot | null {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !Object.hasOwn(value, 'slot')) return null;
  return typeof value.slot === 'string' && (TODAY_SLOT_VALUES as readonly string[]).includes(value.slot)
    ? value.slot as TodaySlot : null;
}

function parseProviderOptions(payload: unknown, slot: TodaySlot): Candidate[] | null {
  if (!isRecord(payload) || !Array.isArray(payload.options) || payload.options.length < 3 || payload.options.length > 5) return null;
  const parsed: Candidate[] = [];
  for (const item of payload.options) {
    if (!isRecord(item) || Object.keys(item).length !== 4 ||
      typeof item.title !== 'string' || !item.title.trim() || item.title.trim().length > 120 ||
      item.slot !== slot || !Array.isArray(item.ingredients) || item.ingredients.length < 1 || item.ingredients.length > 30 ||
      !item.ingredients.every((ingredient) => typeof ingredient === 'string' && ingredient.trim().length > 0 && ingredient.length <= 80) ||
      typeof item.prepMinutes !== 'number' || !Number.isInteger(item.prepMinutes) || item.prepMinutes < 1 || item.prepMinutes > MAX_PREP_MINUTES) return null;
    parsed.push({
      title: item.title.trim(), slot, ingredients: item.ingredients.map((ingredient: string) => ingredient.trim()),
      prepMinutes: item.prepMinutes, source: 'provider',
    });
  }
  return parsed;
}

function promptFor(context: TodayProviderContext, ragText: string): string {
  return `Suggest 3 to 5 distinct meal options for the requested slot. Treat allergies and hardAvoid as absolute exclusions; dislikes are preferences only. Use only the supplied context. Never claim allergy safety beyond explicitly listed allergies. Return only JSON matching the supplied schema.\nTrusted meal context JSON:\n${JSON.stringify(context)}${ragText ? `\nOptional trusted cookbook text (plain text only):\n${ragText}` : ''}`;
}

function userReason(candidate: Candidate, context: TodayProviderContext) {
  const currentInventory = context.inventory.filter((item) => !item.expiresOn || item.expiresOn >= context.asOf);
  const availableInventory = new Set(currentInventory.map((item) => normalizeIngredientName(item.name)));
  const availableIngredients = candidate.ingredients.filter((ingredient) =>
    availableInventory.has(normalizeIngredientName(ingredient)));
  const available = new Set(availableIngredients.map(normalizeIngredientName));
  const missingIngredients = candidate.ingredients.filter((item) => !available.has(normalizeIngredientName(item)));
  const reason = candidate.source === 'saved_plan'
    ? 'Una opción guardada en tu plan; el día del plan no determina que esté programada para hoy.'
    : candidate.source === 'history'
      ? 'Una opción de tu historial reciente.'
      : availableIngredients.length > 0
        ? 'Aprovecha ingredientes disponibles en tu inventario.'
        : 'Una opción para el horario elegido.';
  return { ...candidate, reason, availableIngredients, missingIngredients };
}

async function loadProviderOptions(context: TodayProviderContext, apiKey: string, tenantId: string): Promise<Candidate[] | null> {
  let ragText = '';
  try {
    const rag = await retrieveServerRagContext({
      apiKey, tenantId, ingredients: context.inventory.map(({ name }) => name).slice(0, 20),
      mealType: context.slot, restrictions: { allergies: context.allergies, dietaryRules: context.hardAvoid },
    });
    ragText = typeof rag.context === 'string'
      ? rag.context.replace(/--- CONTEXTO DE RECETARIO CONFIABLE[^\n]*---\s*/gi, '')
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').slice(0, 4000)
      : '';
  } catch {
    // Retrieval is optional; it cannot weaken restrictions or fail the request.
  }
  try {
    const response = await fetch(`${getGeminiBaseUrl()}/models/${encodeURIComponent(getGeminiModel())}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: promptFor(context, ragText) }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
      }),
    });
    if (!response.ok) return null;
    const result: unknown = await response.json();
    if (!isRecord(result) || !Array.isArray(result.candidates) || !isRecord(result.candidates[0]) ||
      !isRecord(result.candidates[0].content) || !Array.isArray(result.candidates[0].content.parts) ||
      !isRecord(result.candidates[0].content.parts[0]) || typeof result.candidates[0].content.parts[0].text !== 'string') return null;
    const parsed: unknown = JSON.parse(result.candidates[0].content.parts[0].text);
    return parseProviderOptions(parsed, context.slot);
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  let user;
  try {
    user = await requireUser(request);
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const tenantId = user.tenant?.tenantId;
  if (!tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let rawBody: unknown;
  try { rawBody = await request.json(); } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }); }
  const slot = parseBody(rawBody);
  if (!slot) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const now = new Date();
  const asOf = now.toISOString().slice(0, 10);
  const since = `${asOf}T00:00:00.000Z`;
  let loaded;
  try {
    loaded = await Promise.all([
      findCulinaryProfileByUserId(user.id),
      findCulinaryProfileTermsByUserId(user.id),
      listTodayInventoryContextByTenant(tenantId, asOf, 50),
      listTodayRecipeHistoryByUserAndTenant(user.id, tenantId, since, 20),
      findLatestMealPlanByUserAndTenant(user.id, tenantId),
    ]);
  } catch {
    return NextResponse.json({ error: 'Today is temporarily unavailable' }, { status: 503 });
  }
  const [profile, terms, inventoryRows, history, latestPlan] = loaded;

  const contextResult = buildTodayContext({ userId: user.id, tenantId, asOf, slot, profile, terms, inventory: inventoryRows, history, latestPlan });
  if (contextResult.status !== 'ready') return NextResponse.json({ error: 'Today is temporarily unavailable' }, { status: 503 });
  const context = contextResult.providerContext;
  const apiKey = getGeminiApiKey();
  let providerOptions: Candidate[] | null = null;
  if (apiKey) providerOptions = await loadProviderOptions(context, apiKey, tenantId);
  const rankedProvider = rankOneSlotOptions(providerOptions ?? [], {
    asOf, slot, maxPrepMinutes: context.maxPrepMinutes ?? MAX_PREP_MINUTES,
    allergies: context.allergies, hardAvoid: context.hardAvoid, dislikedIngredients: context.dislikedIngredients,
    recentTitles: contextResult.localSignals.recentTitles, inventory: context.inventory,
  });
  const safeProvider = rankedProvider.status === 'invalid' ? [] : rankedProvider.options;
  const providerSucceeded = safeProvider.length >= 3;
  if (providerSucceeded) {
    return NextResponse.json({ status: 'success', options: safeProvider.map((option) => userReason(option, context)),
      ...(context.profileConfigured ? {} : { warnings: ['PROFILE_NOT_CONFIGURED'] }) });
  }

  const localCandidates: Candidate[] = [...contextResult.localSignals.historyCandidates, ...contextResult.localSignals.savedPlanCandidates];
  const merged = rankOneSlotOptions([...safeProvider, ...localCandidates], {
    asOf, slot, maxPrepMinutes: context.maxPrepMinutes ?? MAX_PREP_MINUTES,
    allergies: context.allergies, hardAvoid: context.hardAvoid, dislikedIngredients: context.dislikedIngredients,
    recentTitles: contextResult.localSignals.recentTitles, inventory: context.inventory,
  });
  const options = merged.status === 'invalid' ? [] : merged.options;
  return NextResponse.json({ status: 'degraded', reason: providerOptions === null ? 'provider-unavailable' : 'insufficient-safe-options',
    options: options.map((option) => userReason(option, context)),
    ...(context.profileConfigured ? {} : { warnings: ['PROFILE_NOT_CONFIGURED'] }) });
}
