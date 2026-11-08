import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { serverLogger } from '@/lib/serverLogger';
import { validateRequest, InventorySuggestionSchema } from '@/lib/validation';
import { checkRateLimit } from '@/lib/rate-limit';
import { getGeminiApiKey, getGeminiModel } from '@/lib/ai/gemini-config';
import { getRetryAfterSeconds, getTrustedClientIdentity } from '@/lib/rate-limit-identity';

const TIMEOUT_MS = 30_000;
const listItem = z.string().trim().max(200);
const RequestSchema = InventorySuggestionSchema.extend({
  inventory: z.array(listItem).max(80).optional(),
  restrictions: z.array(listItem).max(20).optional(),
  profile: z
    .object({
      preferred: z.array(listItem).max(12).optional(),
      goals: z.array(listItem).max(12).optional(),
      level: z.string().trim().max(200).nullable().optional(),
    })
    .strict()
    .optional(),
}).strict();
const ProviderEnvelopeSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z.object({ parts: z.array(z.object({ text: z.string().max(100_000) })).min(1) }),
      })
    )
    .min(1),
});
const SuggestionSchema = z.object({
  items: z
    .array(
      z.object({
        ingredient: z.string().trim().min(1).max(200),
        quantity: z.number().finite().nonnegative().max(1_000_000).nullable(),
        unit: z.string().trim().max(100),
        estimated: z.boolean(),
        confidence: z.number().finite().min(0).max(1),
        source: z.string().trim().max(200),
      })
    )
    .max(200),
});

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const apiKey = getGeminiApiKey();
  const model = getGeminiModel();

  // Validate every field used to construct the prompt.
  const validation = await validateRequest(request, RequestSchema);
  if (!validation.success) {
    return Response.json(validation.error.body, { status: validation.error.status });
  }

  const body = validation.data;

  // 2. Rate limit
  let rateLimit: Awaited<ReturnType<typeof checkRateLimit>>;
  try {
    rateLimit = await checkRateLimit(
      'inventory-suggestion',
      getTrustedClientIdentity(request),
      undefined,
      { requireSharedStore: true }
    );
  } catch {
    serverLogger.warn('inventory_suggestion.rate_limit_error', { requestId });
    return NextResponse.json(
      { error: 'La sugerencia de inventario no está disponible temporalmente.' },
      { status: 503 }
    );
  }
  if (!rateLimit.success) {
    const retryAfter = getRetryAfterSeconds(rateLimit.resetAt);
    const storageUnavailable = rateLimit.storage === 'unavailable';
    return Response.json(
      {
        error: storageUnavailable
          ? 'La sugerencia de inventario no está disponible temporalmente.'
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
    serverLogger.warn('inventory_suggestion.misconfigured', { requestId });
    return NextResponse.json(
      {
        error: 'La sugerencia de inventario no está disponible temporalmente.',
      },
      { status: 503 }
    );
  }

  const menuContent = body.menuContent?.trim() ?? '';
  const peopleCount =
    typeof body.peopleCount === 'number' &&
    Number.isFinite(body.peopleCount) &&
    body.peopleCount > 0
      ? body.peopleCount
      : 4;
  const inventory =
    (body.inventory ?? []).filter(Boolean).slice(0, 80).join(', ') || 'No especificado';
  const restrictions =
    (body.restrictions ?? []).filter(Boolean).slice(0, 20).join(', ') || 'No especificado';
  const preferred =
    (body.profile?.preferred ?? []).filter(Boolean).slice(0, 12).join(', ') || 'No especificado';
  const goals =
    (body.profile?.goals ?? []).filter(Boolean).slice(0, 12).join(', ') || 'No especificado';
  const level = body.profile?.level?.trim() || 'No especificado';

  if (!menuContent) {
    serverLogger.warn('inventory_suggestion.invalid_input', {
      requestId,
      reason: 'missing_menu_content',
    });
    return NextResponse.json({ error: 'No hay menú para calcular inventario.' }, { status: 400 });
  }

  serverLogger.info('inventory_suggestion.request', {
    requestId,
    model,
    peopleCount,
    hasMenu: menuContent.length > 0,
  });

  const prompt = `Eres un asistente culinario y de abastecimiento.
Analiza este menú y genera SOLO JSON válido (sin markdown, sin comentarios).

Personas: ${peopleCount}
Inventario actual: ${inventory}
Restricciones: ${restrictions}
Preferencias: ${preferred}
Objetivos: ${goals}
Nivel: ${level}

Menú:
${menuContent}

Devuelve un JSON con esta estructura exacta:
{
  "items": [
    {
      "ingredient": "string",
      "quantity": number | null,
      "unit": "string",
      "estimated": boolean,
      "confidence": number,
      "source": "string"
    }
  ]
}

Reglas:
- Si el menú no da cantidad exacta, estima y marca estimated=true.
- confidence entre 0 y 1.
- source debe indicar día/comida cuando sea posible.
- No incluyas texto fuera del JSON.`;

  const controller = new AbortController();
  let timedOut = false;
  const abortFromClient = () => controller.abort();
  request.signal.addEventListener('abort', abortFromClient, { once: true });
  if (request.signal.aborted) controller.abort();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, TIMEOUT_MS);
  let abortListener: (() => void) | undefined;

  try {
    // Race the entire provider operation, including body consumption, against cancellation.
    const aborted = new Promise<never>((_, reject) => {
      abortListener = () => reject(new Error('Provider request aborted'));
      controller.signal.addEventListener('abort', abortListener, { once: true });
      if (controller.signal.aborted) abortListener();
    });
    const provider = async () => {
      if (controller.signal.aborted) throw new Error('Provider request aborted');
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
          signal: controller.signal,
        }
      );
      if (!response.ok) throw new Error('Provider request failed');
      const payload: unknown = await response.json();
      const envelope = ProviderEnvelopeSchema.parse(payload);
      const text = envelope.candidates[0].content.parts[0].text.trim();
      const clean = text
        .replace(/^```json\s*/i, '')
        .replace(/^```/i, '')
        .replace(/```$/i, '')
        .trim();
      const parsed: unknown = JSON.parse(clean);
      return SuggestionSchema.parse(parsed);
    };
    const { items } = await Promise.race([provider(), aborted]);
    serverLogger.info('inventory_suggestion.success', {
      requestId,
      durationMs: Date.now() - startedAt,
      itemsCount: items.length,
    });
    return NextResponse.json({ items, peopleCount });
  } catch {
    serverLogger.warn('inventory_suggestion.provider_error', {
      requestId,
      durationMs: Date.now() - startedAt,
      reason: timedOut
        ? 'timeout'
        : controller.signal.aborted
          ? 'client_aborted'
          : 'provider_failure',
    });
    return NextResponse.json(
      { error: 'No se pudo calcular inventario sugerido temporalmente.' },
      { status: timedOut ? 504 : controller.signal.aborted ? 499 : 502 }
    );
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', abortFromClient);
    if (abortListener) controller.signal.removeEventListener('abort', abortListener);
  }
}
