import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { serverLogger } from '@/lib/serverLogger';
import { requireUser } from '@/lib/auth/server';
import { getGeminiApiKey, getGeminiBaseUrl, getGeminiModel } from '@/lib/ai/gemini-config';
import { checkRateLimit } from '@/lib/rate-limit';
import { normalizeExplicitUnit } from '@/lib/inventory/quantity-normalization';
import { withQuantityReviewSource } from '@/lib/db/repositories/mealPlanRepository';
import { equalPostgresTimestamps, postgresTimestampToIso } from '@/lib/db/postgres-timestamp';
import type { UserMealPlanRow } from '@/lib/db/types';
import { hasRestrictedMealPlanContent, mealPlanRestrictionsChanged, parseStructuredMealPlanValue } from '@/lib/meal-planner/structured-plan';
import { missingQuantityItems, quantityReviewItemsSchema, validateReviewItems, type QuantityReviewItem } from '@/lib/meal-planner/quantity-review';

const requestSchema = z.object({ mealPlanId: z.string().uuid() }).strict();
const prepareSchema = requestSchema.extend({ dayIndex: z.number().int().min(1).max(7).default(1) }).strict();
const confirmSchema = requestSchema.extend({
  expectedUpdatedAt: z.string().min(1).max(100),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  items: quantityReviewItemsSchema,
}).strict();
const providerSchema = z.object({ items: quantityReviewItemsSchema }).strict();
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
type FailureReason = 'rate_limiter_unavailable' | 'rate_limit_exceeded' | 'gemini_key_missing' |
  'gemini_unavailable' | 'gemini_rate_limited' | 'gemini_response_invalid' |
  'gemini_request_failed' | 'gemini_timeout' | 'plan_read_unavailable' | 'prompt_too_large';
const failureMessages: Record<FailureReason, string> = {
  rate_limiter_unavailable: 'El servicio de solicitudes no está disponible. Intentá de nuevo más tarde.',
  rate_limit_exceeded: 'Se alcanzó el límite de solicitudes. Intentá de nuevo en un minuto.',
  gemini_key_missing: 'Las estimaciones de IA no están configuradas. Avisá al administrador.',
  gemini_unavailable: 'Gemini está ocupado temporalmente. Volvé a intentar en unos minutos.',
  gemini_rate_limited: 'Gemini alcanzó el límite de solicitudes. Intentá más tarde.',
  gemini_response_invalid: 'Gemini no devolvió cantidades válidas. Podés intentar de nuevo.',
  gemini_request_failed: 'No se pudo completar la consulta con Gemini. Intentá más tarde.',
  gemini_timeout: 'La preparación tardó demasiado. Intentá nuevamente con este día.',
  plan_read_unavailable: 'No se pudo consultar el menú guardado. No se modificó nada.',
  prompt_too_large: 'El día contiene demasiada información para preparar las cantidades.',
};
function unavailable(status: number, reason: FailureReason) {
  // Reason only: no ingredient names, prompts, credentials, user IDs or provider bodies.
  serverLogger.warn('meal_plan.quantity_review.unavailable', { reason, status });
  return NextResponse.json({ error: failureMessages[reason] }, { status });
}

export async function POST(request: NextRequest) {
  const scope = await identity(request);
  if (!scope) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: unknown;
  try { body = await readBody(request); } catch { return invalid(); }
  const input = prepareSchema.safeParse(body);
  if (!input.success) return invalid();
  try {
    const source = await withQuantityReviewSource(scope, input.data.mealPlanId, async (_client, row, restrictions) => {
      const plan = checkPlan(row, restrictions);
      if (!plan) return { status: 'conflict' as const };
      if (plan.dayCount !== 7 || row.period !== 'week') return { status: 'long' as const };
      const missing = missingQuantityItems(plan).filter(item => item.dayIndex === input.data.dayIndex);
      if (!missing.length) return { status: 'none' as const };
      return { status: 'ready' as const, plan, missing, peopleCount: row.people_count, updatedAt: row.updated_at, fingerprint: fingerprint(row, restrictions) };
    });
    if (!source) return NextResponse.json({ error: 'Menú no encontrado.' }, { status: 404 });
    if (source.status === 'conflict') return conflict();
    if (source.status === 'long') return NextResponse.json({ error: 'La revisión completa solo está disponible para menús de 7 días.' }, { status: 409 });
    if (source.status === 'none') return NextResponse.json({ error: 'Este día no tiene cantidades pendientes.' }, { status: 409 });
    const limit = await checkRateLimit('meal-plan', scope.tenantId, scope.userId, { requireSharedStore: true });
    if (!limit.success) return limit.storage === 'unavailable' ? unavailable(503, 'rate_limiter_unavailable') : unavailable(429, 'rate_limit_exceeded');
    const apiKey = getGeminiApiKey();
    if (!apiKey) return unavailable(503, 'gemini_key_missing');
    const prompt = `Estima cantidades de ingredientes para revisión humana, nunca para compra directa. Las cantidades son TOTALES para ${source.peopleCount} personas, no por persona. Devuelve JSON {"items":[{"dayIndex":${input.data.dayIndex},"mealType":"breakfast","ingredientIndex":0,"name":"...","quantity":1,"unit":"g"}]} con exactamente una entrada por cada ingrediente pendiente, copiando identidad y nombre exactamente. Si no es fiable usa quantity y unit null. No alteres componentes existentes. Unidades permitidas: unidad, g, kg, ml, l, paquete, cucharada, cucharadita, taza. Menú: ${JSON.stringify(source.plan.days.filter(day => day.dayIndex === input.data.dayIndex))}. Pendientes: ${JSON.stringify(source.missing)}`;
    if (prompt.length > 150000) return unavailable(413, 'prompt_too_large');
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 45000);
    const abort = () => controller.abort();
    request.signal.addEventListener('abort', abort, { once: true });
    try {
      const aborted = new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        if (request.signal.aborted) controller.abort();
      });
      const provider = async () => {
        const response = await fetch(`${getGeminiBaseUrl()}/models/${getGeminiModel()}:generateContent?key=${apiKey}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json' } }),
        });
        if (!response.ok) return { status: response.status, items: null };
        const raw = await boundedText(response.body, 150000);
        const envelope = envelopeSchema.parse(JSON.parse(raw));
        const parsed = providerSchema.parse(JSON.parse(envelope.candidates[0].content.parts[0].text));
        return { status: 200, items: parsed.items };
      };
      const result = await Promise.race([provider(), aborted]);
      if (!result.items) return result.status === 503 ? unavailable(503, 'gemini_unavailable') : result.status === 429 ? unavailable(429, 'gemini_rate_limited') : unavailable(502, 'gemini_response_invalid');
      if (!validateReviewItems(source.plan, result.items, true, input.data.dayIndex)) return unavailable(502, 'gemini_response_invalid');
      const stillCurrent = await withQuantityReviewSource(scope, input.data.mealPlanId, async (_client, row, restrictions) =>
        checkPlan(row, restrictions) !== null && fingerprint(row, restrictions) === source.fingerprint
      );
      if (!stillCurrent) return conflict();
      return NextResponse.json({ mealPlanId: input.data.mealPlanId, expectedUpdatedAt: source.updatedAt, fingerprint: source.fingerprint, items: result.items });
    } catch { return timedOut ? unavailable(504, 'gemini_timeout') : unavailable(502, 'gemini_request_failed'); }
    finally { clearTimeout(timer); request.signal.removeEventListener('abort', abort); }
  } catch { return unavailable(503, 'plan_read_unavailable'); }
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
