import { NextRequest, NextResponse } from 'next/server';
import { serverLogger } from '@/lib/serverLogger';
import { validateRequest, MealPlanSchema, type MealPlanBody } from '@/lib/validation';
import { checkRateLimit } from '@/lib/rate-limit';
import { getGeminiApiKey, getGeminiModel } from '@/lib/ai/gemini-config';

const AI_REQUEST_TIMEOUT_MS = 60_000;

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const apiKey = getGeminiApiKey();
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
  const inventory = (body.inventory ?? [])
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 120);
  const peopleCount =
    typeof body.peopleCount === 'number' &&
    Number.isFinite(body.peopleCount) &&
    body.peopleCount > 0
      ? Math.floor(body.peopleCount)
      : 4;
  const profilePreferred = (body.culinaryProfile?.preferred ?? [])
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 12);
  const profileAvoid = (body.culinaryProfile?.avoid ?? [])
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 12);
  const profileGoals = (body.culinaryProfile?.goals ?? [])
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 12);
  const profileLevel = body.culinaryProfile?.level?.trim() || 'No especificado';
  const chunks = (body.chunks ?? [])
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 10);

  const periodLabel = period === 'month' ? '30 días' : period === 'fortnight' ? '14 días' : '7 días';
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
    inventoryCount: inventory.length,
    fusionCount: fusionCuisines.length,
  });

  const strictWeekFormat = `Formato OBLIGATORIO:
Lunes
Desayuno: ...
Almuerzo: ...
Cena: ...

Martes
Desayuno: ...
Almuerzo: ...
Cena: ...

Miércoles
Desayuno: ...
Almuerzo: ...
Cena: ...

Jueves
Desayuno: ...
Almuerzo: ...
Cena: ...

Viernes
Desayuno: ...
Almuerzo: ...
Cena: ...

Sábado
Desayuno: ...
Almuerzo: ...
Cena: ...

Domingo
Desayuno: ...
Almuerzo: ...
Cena: ...`;

  const prompt =
    mode === 'inventory_to_menu'
      ? `Genera un menú de ${periodLabel} basado ÚNICAMENTE en este inventario: ${inventory.join(', ') || 'sin inventario'}.
Cocina objetivo: ${cuisineLabel}.
Intensidad de fusión: ${fusionIntensity}.
Perfil del usuario:
- Personas: ${peopleCount}
- Preferencias: ${profilePreferred.join(', ') || 'No especificado'}
- Evitar: ${profileAvoid.join(', ') || 'No especificado'}
- Objetivos: ${profileGoals.join(', ') || 'No especificado'}
- Nivel: ${profileLevel}
Contexto PDF:
${chunks.length > 0 ? chunks.join('\n---\n') : 'Sin contexto PDF.'}

Reglas:
- No inventes ingredientes fuera del inventario.
- Si falta algo crítico, marcar como "pendiente de compra".
- Respeta estrictamente "Evitar".
- Integra técnicas/sabores de fusión si se especifican culturas de fusión.
- Si intensidad es sutil: prioriza cocina base y toques menores de fusión.
- Si intensidad es media: balancea cocina base y fusión.
- Si intensidad es alta: fusión protagonista manteniendo coherencia culinaria.
- Debes devolver SIEMPRE los 7 días completos (Lunes a Domingo), con desayuno, almuerzo y cena para cada día.
- No saltees días.
- No uses texto narrativo largo.
- ${strictWeekFormat}
- Español.
- Máximo 900 palabras.`
      : `Genera un menú de ${periodLabel} de cocina ${cuisineLabel} y luego una lista de compras.
Intensidad de fusión: ${fusionIntensity}.
Perfil del usuario:
- Personas: ${peopleCount}
- Preferencias: ${profilePreferred.join(', ') || 'No especificado'}
- Evitar: ${profileAvoid.join(', ') || 'No especificado'}
- Objetivos: ${profileGoals.join(', ') || 'No especificado'}
- Nivel: ${profileLevel}
Contexto PDF:
${chunks.length > 0 ? chunks.join('\n---\n') : 'Sin contexto PDF.'}

Reglas:
- Debes devolver SIEMPRE los 7 días completos (Lunes a Domingo), con desayuno, almuerzo y cena para cada día.
- No saltees días.
- ${strictWeekFormat}
- Incluir sección "LISTA DE COMPRAS" agrupada por categoría.
- Respeta estrictamente "Evitar".
- Integra técnicas/sabores de fusión si se especifican culturas de fusión.
- Si intensidad es sutil: prioriza cocina base y toques menores de fusión.
- Si intensidad es media: balancea cocina base y fusión.
- Si intensidad es alta: fusión protagonista manteniendo coherencia culinaria.
- Español.
- Máximo 1000 palabras.`;

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
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        }
      );
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Gemini timeout/error');
    }

    if (!response.ok) {
      throw new Error(await response.text());
    }

    const payload = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const content = payload.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (!content) {
      throw new Error('Gemini no devolvió contenido.');
    }

    serverLogger.info('meal_plan.success', {
      requestId,
      durationMs: Date.now() - startedAt,
      contentLength: content.length,
    });
    return NextResponse.json({ content, plan: content });
  } catch (error) {
    serverLogger.warn('meal_plan.failed', {
      requestId,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : 'Gemini error desconocido',
    });
    return NextResponse.json(
      {
        error: `No se pudo generar menú. Gemini: ${error instanceof Error ? error.message : 'error desconocido'}`,
      },
      { status: 502 }
    );
  }
}
