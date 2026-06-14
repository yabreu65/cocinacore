import { NextRequest, NextResponse } from 'next/server';
import { serverLogger } from '@/lib/serverLogger';
import { getGeminiApiKey, getGeminiModel } from '@/lib/ai/gemini-config';
import {
  buildRecipeCacheKey,
  getCachedRecipe,
  setCachedRecipe,
  type RecipeCacheKeyInput,
} from '@/lib/cache/recipe-cache';
import {
  extractStructuredIngredients,
  validateStructuredIngredients,
  type StructuredRecipeIngredient,
} from '@/lib/recipes/structured-ingredients';
import { validateRequest, RecipeGenerateSchema, type RecipeGenerateBody } from '@/lib/validation';
import { checkRateLimit } from '@/lib/rate-limit';

const AI_REQUEST_TIMEOUT_MS = 60_000;

function inferTitleFromRecipe(recipe: string): string {
  const clean = recipe
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .find(
      (line) =>
        line !== '[TITULO]' &&
        line !== 'TITULO' &&
        !line.toLowerCase().startsWith('ingredientes') &&
        !line.toLowerCase().startsWith('preparación') &&
        !line.toLowerCase().startsWith('preparacion')
    );

  if (!clean) return 'Receta generada';
  return clean
    .replace(/^#+\s*/, '')
    .replace(/^\d+[\.)-]\s*/, '')
    .trim();
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const apiKey = getGeminiApiKey();
  const model = getGeminiModel();

  const validation = await validateRequest(request, RecipeGenerateSchema);
  if (!validation.success) {
    return Response.json(validation.error.body, { status: validation.error.status });
  }

  const body: RecipeGenerateBody = validation.data;
  const providerPreference = body.provider ?? 'auto';

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rateLimit = await checkRateLimit('recipe-generate', ip);
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

  const mode = body.mode === 'rag' ? 'rag' : 'free';
  const requestedRecipeName = body.recipeName?.trim() ?? '';
  const requestedMealType = body.mealType?.trim() ?? '';
  const requestedDay = body.day?.trim() ?? '';
  const ingredients = (body.ingredients ?? []).filter(Boolean).slice(0, 30);
  const peopleCount =
    typeof body.peopleCount === 'number' &&
    Number.isFinite(body.peopleCount) &&
    body.peopleCount > 0
      ? Math.floor(body.peopleCount)
      : 4;
  const chunks = mode === 'rag' ? (body.chunks ?? []).filter(Boolean).slice(0, 14) : [];
  const profile = body.culinaryProfile;
  const preferred = (profile?.preferred ?? []).filter(Boolean).slice(0, 10);
  const avoid = (profile?.avoid ?? []).filter(Boolean).slice(0, 10);
  const goals = (profile?.goals ?? []).filter(Boolean).slice(0, 10);
  const identity = (profile?.identity ?? []).filter(Boolean).slice(0, 6);
  const level = profile?.level?.trim() || 'No especificado';

  serverLogger.info('recipe_generate.request', {
    requestId,
    model,
    mode,
    providerPreference,
    peopleCount,
    ingredientsCount: ingredients.length,
    chunksCount: chunks.length,
    hasProfile: Boolean(profile),
    requestedRecipeName,
    requestedMealType,
    requestedDay,
  });

  const focusedRecipeInstruction = requestedRecipeName
    ? `Receta objetivo (OBLIGATORIO): ${requestedRecipeName}`
    : 'Receta objetivo (OBLIGATORIO): usa el primer ingrediente como plato principal.';

  const slotContextInstruction =
    requestedMealType || requestedDay
      ? `Contexto del slot: ${requestedDay || 'Día no especificado'} · ${requestedMealType || 'Comida no especificada'}`
      : 'Contexto del slot: no especificado';

  const commonPromptHeader = `Eres un chef-editor culinario. Debes devolver una receta en español con formato claro y exacto, sin JSON.

${focusedRecipeInstruction}
${slotContextInstruction}

SI HAY CONTEXTO DOCUMENTAL, prioriza ese contenido y usa el NOMBRE de la receta que aparezca en el texto fuente.

Ingredientes del usuario:
${ingredients.join('; ') || 'No especificados'}

Perfil culinario del usuario:
- Identidad de cocina: ${identity.join(', ') || 'No especificado'}
- Preferencias: ${preferred.join(', ') || 'No especificado'}
- Objetivos: ${goals.join(', ') || 'No especificado'}
- Restricciones/evitar: ${avoid.join(', ') || 'No especificado'}
- Nivel culinario: ${level}
- Comensales: ${peopleCount}
`;

  const ragPrompt = `Contexto documental:
${chunks.length > 0 ? chunks.join('\n---\n') : 'Sin contexto documental.'}

Formato de salida OBLIGATORIO:
[TITULO]

INGREDIENTES
- 2 unidades tomate
- 1 taza arroz
- 200 g pollo

FUENTE
- [autor/libro si está disponible en el contexto]
- [página si está disponible]

PREPARACIÓN
1. ...
2. ...

TIPS
- ...

Reglas:
- Genera SOLO UNA receta para el plato objetivo; no agregues acompañantes extra ni segundas recetas.
- El título debe ser únicamente el nombre del plato objetivo (sin introducciones largas).
- No inventes fuentes.
- Si el contexto no trae autor/página, indícalo como "No especificado en contexto".
- Ajusta cantidades explícitamente para ${peopleCount} comensales.
- Si el PDF no trae cantidades base claras, estima cantidades y acláralo en una línea final: "Cantidades estimadas para ${peopleCount} personas".
- Respeta estrictamente restricciones de "evitar".
- Cada ingrediente debe ir en una sola línea.
- Cada línea de ingrediente debe empezar con cantidad numérica + unidad + nombre.
- Evita subtítulos dentro de INGREDIENTES.
- Evita frases largas tipo "para el sofrito" dentro de la lista; deja solo el ingrediente base.
- Máximo 450 palabras.`;
  const freePrompt = `Formato de salida OBLIGATORIO:
[TITULO]

INGREDIENTES
- 2 unidades tomate
- 1 taza arroz
- 200 g pollo

PREPARACIÓN
1. ...
2. ...

TIPS
- ...

Reglas:
- Genera SOLO UNA receta para el plato objetivo; no agregues acompañantes extra ni segundas recetas.
- El título debe ser únicamente el nombre del plato objetivo (sin introducciones largas).
- NO incluyas sección "FUENTE" ni referencias bibliográficas.
- No menciones PDFs ni biblioteca.
- Ajusta cantidades explícitamente para ${peopleCount} comensales.
- Respeta estrictamente restricciones de "evitar".
- Cada ingrediente debe ir en una sola línea.
- Cada línea de ingrediente debe empezar con cantidad numérica + unidad + nombre.
- Evita subtítulos dentro de INGREDIENTES.
- Evita frases largas tipo "para el sofrito" dentro de la lista; deja solo el ingrediente base.
- Máximo 450 palabras.`;

  const prompt = `${commonPromptHeader}\n${mode === 'rag' ? ragPrompt : freePrompt}`;
  const recipeCacheKeyInput: RecipeCacheKeyInput = {
    mode,
    requestedRecipeName,
    requestedMealType,
    requestedDay,
    ingredients,
    peopleCount,
    identity,
    preferred,
    avoid,
    level,
    chunks,
  };
  const recipeCacheKey = buildRecipeCacheKey(recipeCacheKeyInput);

  const cached = await getCachedRecipe(recipeCacheKey);
  if (cached) {
    return NextResponse.json({
      recipe: cached.recipe,
      title: cached.title,
      provider: cached.provider,
      model: cached.model,
      mode: cached.mode,
      structuredIngredients: cached.structuredIngredients,
      cached: true,
    });
  }

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
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY no está configurada.');
    }

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
      const errorText = await response.text();
      throw new Error(`No se pudo generar receta con Gemini: ${errorText}`);
    }

    const payload = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const recipe = payload.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!recipe) {
      throw new Error('Gemini no devolvió contenido de receta.');
    }

    const title = inferTitleFromRecipe(recipe);
    const structuredIngredients = extractStructuredIngredients(recipe);
    const safeStructuredIngredients: StructuredRecipeIngredient[] = validateStructuredIngredients(
      structuredIngredients
    )
      ? structuredIngredients
      : [];
    serverLogger.info('recipe_generate.success', {
      requestId,
      durationMs: Date.now() - startedAt,
      provider: 'gemini',
      mode,
      titleLength: title.length,
    });
    await setCachedRecipe(recipeCacheKey, {
      recipe,
      title,
      provider: 'gemini',
      mode,
      structuredIngredients: safeStructuredIngredients,
      createdAt: Date.now(),
    });
    return NextResponse.json({
      recipe,
      title,
      provider: 'gemini',
      mode,
      structuredIngredients: safeStructuredIngredients,
    });
  } catch (error) {
    serverLogger.error('recipe_generate.failed', {
      requestId,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : 'Gemini error desconocido',
    });
    return NextResponse.json(
      {
        error: `Falló Gemini: ${error instanceof Error ? error.message : 'error desconocido'}`,
      },
      { status: 502 }
    );
  }
}
