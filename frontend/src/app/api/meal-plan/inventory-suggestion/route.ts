import { NextRequest, NextResponse } from 'next/server';
import { serverLogger } from '@/lib/serverLogger';
import {
  validateRequest,
  InventorySuggestionSchema,
  type InventorySuggestionBody,
} from '@/lib/validation';
import { checkRateLimit } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

  // 1. Zod validation (passthrough allows legacy inventory/restrictions/profile fields)
  const validation = await validateRequest(request, InventorySuggestionSchema.passthrough());
  if (!validation.success) {
    return Response.json(validation.error.body, { status: validation.error.status });
  }

  const body = validation.data as InventorySuggestionBody & {
    inventory?: string[];
    restrictions?: string[];
    profile?: {
      preferred?: string[];
      goals?: string[];
      level?: string | null;
    };
  };

  // 2. Rate limit
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rateLimit = await checkRateLimit('inventory-suggestion', ip);
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
    serverLogger.error('inventory_suggestion.misconfigured', { requestId });
    return NextResponse.json({ error: 'GEMINI_API_KEY no está configurada.' }, { status: 500 });
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

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    serverLogger.error('inventory_suggestion.upstream_error', {
      requestId,
      durationMs: Date.now() - startedAt,
      status: response.status,
    });
    return NextResponse.json(
      { error: `No se pudo calcular inventario sugerido: ${errorText}` },
      { status: 502 }
    );
  }

  const payload = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

  if (!text) {
    serverLogger.warn('inventory_suggestion.empty_response', {
      requestId,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ error: 'Gemini no devolvió inventario sugerido.' }, { status: 502 });
  }

  const clean = text
    .replace(/^```json\s*/i, '')
    .replace(/^```/i, '')
    .replace(/```$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(clean) as { items?: unknown };
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    serverLogger.info('inventory_suggestion.success', {
      requestId,
      durationMs: Date.now() - startedAt,
      itemsCount: items.length,
    });
    return NextResponse.json({ items, peopleCount });
  } catch {
    serverLogger.error('inventory_suggestion.parse_error', {
      requestId,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json(
      { error: 'No se pudo parsear JSON de inventario sugerido.' },
      { status: 502 }
    );
  }
}
