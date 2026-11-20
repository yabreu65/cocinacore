import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { getGeminiApiKey, getGeminiBaseUrl, getGeminiModel } from '@/lib/ai/gemini-config';
import { checkRateLimit } from '@/lib/rate-limit';
import { normalizeExplicitUnit } from '@/lib/inventory/quantity-normalization';
import { withQuantityReviewSource } from '@/lib/db/repositories/mealPlanRepository';
import { equalPostgresTimestamps, postgresTimestampToIso } from '@/lib/db/postgres-timestamp';
import type { UserMealPlanRow } from '@/lib/db/types';
import { hasRestrictedMealPlanContent, mealPlanRestrictionsChanged, parseStructuredMealPlanValue } from '@/lib/meal-planner/structured-plan';
import { missingQuantityItems, quantityReviewItemSchema, quantityReviewItemsSchema, validateReviewItems, type QuantityReviewItem } from '@/lib/meal-planner/quantity-review';

const requestSchema = z.object({ mealPlanId: z.string().uuid() }).strict();
const confirmSchema = requestSchema.extend({
  expectedUpdatedAt: z.string().min(1).max(100),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  items: quantityReviewItemsSchema,
}).strict();
// Gemini's candidate quantities can be unusable while their positional identity
// is still valid. Treat such amounts as unknown instead of aborting the whole day.
const providerSchema = z.object({ items: z.array(z.object({
  dayIndex: z.number().int().min(1).max(7),
  mealType: z.enum(['breakfast', 'lunch', 'dinner']),
  ingredientIndex: z.number().int().min(0).max(29),
  name: z.string().min(1).max(120),
  quantity: z.number().finite().nullable(),
  unit: z.string().min(1).max(40).nullable(),
}).strict()).min(1).max(630) }).strict();
const envelopeSchema = z.object({ candidates: z.array(z.object({ content: z.object({ parts: z.array(z.object({ text: z.string().max(120000) })).length(1) }) })).length(1) });

function fingerprint(row: UserMealPlanRow, restrictions: string[]) {
  if (!equalPostgresTimestamps(row.updated_at, row.updated_at)) throw new Error('Invalid timestamp evidence');
  return createHash('sha256').update(JSON.stringify([postgresTimestampToIso(row.updated_at), row.calendar_payload, row.people_count, row.period, row.restrictions, [...restrictions].sort()])).digest('hex');
}
function checkPlan(row: UserMealPlanRow, restrictions: string[]) {
  const parsed = parseStructuredMealPlanValue(row.calendar_payload, row.period);
  if (!parsed.success || !parsed.plan.schedule?.portionConfirmation ||
      parsed.plan.schedule.portionConfirmation.peopleCount !== row.people_count ||
      mealPlanRestrictionsChanged(row, restrictions) || hasRestrictedMealPlanContent(parsed.plan, restrictions)) return null;
  return parsed.plan;
}
async function boundedText(stream: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<string> {
  if (!stream) throw new Error('Missing body');
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error('Body too large');
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}
async function readBody(request: NextRequest): Promise<unknown> {
  const length = request.headers.get('content-length');
  if (length && Number(length) > 100000) throw new Error('Body too large');
  return JSON.parse(await boundedText(request.body, 100000)) as unknown;
}
async function identity(request: NextRequest) {
  try {
    const user = await requireUser(request);
    return user.tenant ? { userId: user.id, tenantId: user.tenant.tenantId } : null;
  } catch { return null; }
}
const invalid = () => NextResponse.json({ error: 'Solicitud inválida.' }, { status: 400 });
const conflict = () => NextResponse.json({ error: 'El menú o las restricciones cambiaron. Prepará una nueva revisión.' }, { status: 409 });
const unavailable = (status: number) => NextResponse.json({ error:
  status === 429 ? 'Gemini alcanzó su límite de solicitudes. Esperá unos minutos antes de intentar nuevamente.' :
  status === 504 ? 'Gemini tardó demasiado en estimar las cantidades. No se guardó ningún dato.' :
  status === 502 ? 'Gemini devolvió estimaciones incompletas o inválidas. No se guardó ningún dato.' :
  status === 503 ? 'El servicio de estimaciones no está disponible en este momento. Intentá más tarde.' :
  'No se pudieron preparar las estimaciones. Intentá más tarde.',
}, { status });

class EstimateFailure extends Error {
  constructor(readonly status: number, readonly code: string, readonly upstreamStatus: number | null = null) {
    super(code);
  }
}

function recordEstimateFailure(error: EstimateFailure, batch: number, elapsedMs: number) {
  // Never log prompt, ingredients, user identifiers, response bodies or credentials.
  console.warn('quantity_review.provider_failed', {
    code: error.code, status: error.status, upstreamStatus: error.upstreamStatus,
    batch, durationMs: elapsedMs,
  });
}


export async function POST(request: NextRequest) {
  const scope = await identity(request);
  if (!scope) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: unknown;
  try { body = await readBody(request); } catch { return invalid(); }
  const input = requestSchema.safeParse(body);
  if (!input.success) return invalid();
  try {
    const source = await withQuantityReviewSource(scope, input.data.mealPlanId, async (_client, row, restrictions) => {
      const plan = checkPlan(row, restrictions);
      if (!plan) return { status: 'conflict' as const };
      if (plan.dayCount !== 7 || row.period !== 'week') return { status: 'long' as const };
      const missing = missingQuantityItems(plan);
      if (!missing.length) return { status: 'none' as const };
      return { status: 'ready' as const, plan, missing, peopleCount: row.people_count, updatedAt: row.updated_at, fingerprint: fingerprint(row, restrictions) };
    });
    if (!source) return NextResponse.json({ error: 'Menú no encontrado.' }, { status: 404 });
    if (source.status === 'conflict') return conflict();
    if (source.status === 'long') return NextResponse.json({ error: 'La revisión completa solo está disponible para menús de 7 días.' }, { status: 409 });
    if (source.status === 'none') return NextResponse.json({ error: 'El menú no tiene cantidades pendientes.' }, { status: 409 });
    const limit = await checkRateLimit('meal-plan', scope.tenantId, scope.userId, { requireSharedStore: true });
    if (!limit.success) return unavailable(limit.storage === 'unavailable' ? 503 : 429);
    const apiKey = getGeminiApiKey();
    if (!apiKey) return unavailable(503);
    // A full weekly menu can contain hundreds of unknown quantities. Keep each
    // provider response limited to one day, without duplicating servings.
    const batches = source.plan.days.map(day => ({
      day, missing: source.missing.filter(item => item.dayIndex === day.dayIndex),
    })).filter(batch => batch.missing.length > 0);
    const chunks: QuantityReviewItem[][] = Array.from({ length: batches.length }, () => []);
    const controllers = new Set<AbortController>();
    const abort = () => { for (const controller of controllers) controller.abort(); };
    request.signal.addEventListener('abort', abort, { once: true });
    let next = 0;
    let failure: EstimateFailure | null = null;
    const estimateDay = async (index: number): Promise<QuantityReviewItem[]> => {
      const { day, missing } = batches[index];
      const prompt = `Estima cantidades de ingredientes para revisión humana, nunca para compra directa. Las cantidades son TOTALES para ${source.peopleCount} personas, no por persona. Devuelve JSON {"items":[{"dayIndex":1,"mealType":"breakfast","ingredientIndex":0,"name":"...","quantity":1,"unit":"g"}]} con exactamente una entrada por cada ingrediente pendiente, copiando identidad y nombre exactamente. Si no es fiable usa quantity y unit null. No alteres componentes existentes. Unidades permitidas: unidad, g, kg, ml, l, paquete, cucharada, cucharadita, taza. Menú del día: ${JSON.stringify(day)}. Pendientes: ${JSON.stringify(missing)}`;
      if (prompt.length > 30000) throw new EstimateFailure(502, 'batch_too_large');
      const controller = new AbortController();
      controllers.add(controller);
      let timedOut = false;
      const started = Date.now();
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 45000);
      try {
        if (request.signal.aborted) throw new EstimateFailure(503, 'client_aborted');
        const aborted = new Promise<never>((_, reject) => {
          controller.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
          if (request.signal.aborted) controller.abort();
        });
        const provider = async () => {
          const response = await fetch(`${getGeminiBaseUrl()}/models/${getGeminiModel()}:generateContent?key=${apiKey}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json' } }),
          });
          if (!response.ok) throw new EstimateFailure(response.status === 429 || response.status === 503 ? response.status : 502, 'provider_http', response.status);
          const raw = await boundedText(response.body, 50000);
          const envelope = envelopeSchema.parse(JSON.parse(raw));
          const parsed = providerSchema.parse(JSON.parse(envelope.candidates[0].content.parts[0].text));
          const dayPlan = { ...source.plan, days: [day] };
          const items = parsed.items.map(item => {
            // Never guess an amount or silently alter existing evidence. A bad
            // quantity/unit degrades only that entry to an explicit unknown.
            return quantityReviewItemSchema.safeParse(item).success &&
              validateReviewItems(dayPlan, [item], false) ? item : { ...item, quantity: null, unit: null };
          });
          if (!validateReviewItems(dayPlan, items, true)) {
            throw new EstimateFailure(502, 'provider_invalid_items');
          }
          return items;
        };
        return await Promise.race([provider(), aborted]);
      } catch (error) {
        const classified = error instanceof EstimateFailure ? error :
          new EstimateFailure(timedOut ? 504 : request.signal.aborted ? 503 : 502,
            timedOut ? 'provider_timeout' : request.signal.aborted ? 'client_aborted' : 'provider_invalid_response');
        recordEstimateFailure(classified, index + 1, Date.now() - started);
        throw classified;
      } finally {
        clearTimeout(timer);
        controllers.delete(controller);
      }
    };
    try {
      // Maximum of two concurrent requests per user action; no retries.
      const worker = async () => {
        while (!failure && next < batches.length) {
          const index = next++;
          try { chunks[index] = await estimateDay(index); }
          catch (error) {
            if (!failure) { failure = error as EstimateFailure; abort(); }
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(2, batches.length) }, () => worker()));
      if (failure) return unavailable((failure as EstimateFailure).status);
      const items = chunks.flat();
      if (!validateReviewItems(source.plan, items, true)) return unavailable(502);
      const stillCurrent = await withQuantityReviewSource(scope, input.data.mealPlanId, async (_client, row, restrictions) =>
        checkPlan(row, restrictions) !== null && fingerprint(row, restrictions) === source.fingerprint
      );
      if (!stillCurrent) return conflict();
      return NextResponse.json({ mealPlanId: input.data.mealPlanId, expectedUpdatedAt: source.updatedAt, fingerprint: source.fingerprint, items });
    } catch { return unavailable(503); }
    finally { request.signal.removeEventListener('abort', abort); }
  } catch { return unavailable(503); }
}

export async function PUT(request: NextRequest) {
  const scope = await identity(request);
  if (!scope) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: unknown;
  try { body = await readBody(request); } catch { return invalid(); }
  const input = confirmSchema.safeParse(body);
  if (!input.success || input.data.items.some(item => item.quantity === null || item.unit === null)) return invalid();
  try {
    const result = await withQuantityReviewSource(scope, input.data.mealPlanId, async (client, row, restrictions) => {
      const plan = checkPlan(row, restrictions);
      if (!plan || plan.dayCount !== 7 || row.period !== 'week' || !equalPostgresTimestamps(row.updated_at, input.data.expectedUpdatedAt) ||
          fingerprint(row, restrictions) !== input.data.fingerprint || !validateReviewItems(plan, input.data.items, false)) return false;
      // Update the original JSON rather than reserializing the parser's normalized view.
      const payload = structuredClone(row.calendar_payload) as { days: Array<{ dayIndex: number; meals: Array<{ mealType: string; ingredients: Array<{ quantity: number | null; unit: string | null }> }> }> };
      for (const item of input.data.items as QuantityReviewItem[]) {
        const ingredient = payload.days.find(day => day.dayIndex === item.dayIndex)!.meals.find(meal => meal.mealType === item.mealType)!.ingredients[item.ingredientIndex];
        if (ingredient.quantity === null) ingredient.quantity = item.quantity;
        if (normalizeExplicitUnit(ingredient.unit) === 'unknown') ingredient.unit = normalizeExplicitUnit(item.unit);
      }
      const updated = await client.query<UserMealPlanRow>(`update public.user_meal_plans set calendar_payload = $1::jsonb, updated_at = now() where id = $2 and tenant_id = $3 and user_id = $4 and updated_at = $5::timestamptz and calendar_payload = $6::jsonb and people_count = $7 and period = $8 returning *`, [JSON.stringify(payload), row.id, scope.tenantId, scope.userId, input.data.expectedUpdatedAt, JSON.stringify(row.calendar_payload), row.people_count, row.period]);
      return updated.rows.length === 1;
    });
    if (result === null) return NextResponse.json({ error: 'Menú no encontrado.' }, { status: 404 });
    if (!result) return conflict();
    return NextResponse.json({ mealPlanId: input.data.mealPlanId });
  } catch { return NextResponse.json({ error: 'No se pudieron guardar las cantidades.' }, { status: 500 }); }
}
