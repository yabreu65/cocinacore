import { NextRequest, NextResponse } from 'next/server';
import { serverLogger } from '@/lib/serverLogger';
import { generateRecipeWithOpenRouter } from '@/lib/ai/openrouter';

interface Body {
  ingredients?: string[];
  chunks?: string[];
  mode?: 'free' | 'rag';
  provider?: 'auto' | 'gemini' | 'openrouter';
  peopleCount?: number;
  culinaryProfile?: {
    level?: string | null;
    preferred?: string[];
    avoid?: string[];
    goals?: string[];
    identity?: string[];
  };
}

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
  return clean.replace(/^#+\s*/, '').replace(/^\d+[\.)-]\s*/, '').trim();
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash';

  const body = (await request.json()) as Body;
  const mode = body.mode === 'rag' ? 'rag' : 'free';
  const providerPreference = body.provider ?? 'auto';
  const ingredients = (body.ingredients ?? []).filter(Boolean).slice(0, 30);
  const peopleCount = typeof body.peopleCount === 'number' && Number.isFinite(body.peopleCount) && body.peopleCount > 0
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
  });

  const commonPromptHeader = `Eres un chef-editor culinario. Debes devolver una receta en español con formato claro y exacto, sin JSON.

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
- ...

FUENTE
- [autor/libro si está disponible en el contexto]
- [página si está disponible]

PREPARACIÓN
1. ...
2. ...

TIPS
- ...

Reglas:
- No inventes fuentes.
- Si el contexto no trae autor/página, indícalo como "No especificado en contexto".
- Ajusta cantidades explícitamente para ${peopleCount} comensales.
- Si el PDF no trae cantidades base claras, estima cantidades y acláralo en una línea final: "Cantidades estimadas para ${peopleCount} personas".
- Respeta estrictamente restricciones de "evitar".
- Máximo 450 palabras.`;
  const freePrompt = `Formato de salida OBLIGATORIO:
[TITULO]

INGREDIENTES
- ...

PREPARACIÓN
1. ...
2. ...

TIPS
- ...

Reglas:
- NO incluyas sección "FUENTE" ni referencias bibliográficas.
- No menciones PDFs ni biblioteca.
- Ajusta cantidades explícitamente para ${peopleCount} comensales.
- Respeta estrictamente restricciones de "evitar".
- Máximo 450 palabras.`;

  const prompt = `${commonPromptHeader}\n${mode === 'rag' ? ragPrompt : freePrompt}`;

  const runOpenRouterFallback = async (geminiErrorMessage: string) => {
    const openRouter = await generateRecipeWithOpenRouter({
      ingredients,
      baseCuisine: identity[0] ?? preferred[0] ?? 'Latinoamericana',
      fusionCuisine: identity.slice(1),
      restrictions: avoid,
      culinaryLevel: level,
      peopleCount,
    });
    const title = inferTitleFromRecipe(openRouter.result);
    serverLogger.info('recipe_generate.success', {
      requestId,
      durationMs: Date.now() - startedAt,
      provider: 'openrouter',
      model: openRouter.model,
      mode,
      titleLength: title.length,
      fallbackFrom: geminiErrorMessage,
    });
    return NextResponse.json({ recipe: openRouter.result, title, provider: 'openrouter', model: openRouter.model, mode });
  };

  try {
    if (providerPreference === 'openrouter') {
      return await runOpenRouterFallback('forced_openrouter');
    }

    if (!apiKey) {
      throw new Error('GEMINI_API_KEY no está configurada.');
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`No se pudo generar receta con Gemini: ${errorText}`);
    }

    const payload = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const recipe = payload.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!recipe) {
      throw new Error('Gemini no devolvió contenido de receta.');
    }

    const title = inferTitleFromRecipe(recipe);
    serverLogger.info('recipe_generate.success', {
      requestId,
      durationMs: Date.now() - startedAt,
      provider: 'gemini',
      mode,
      titleLength: title.length,
    });
    return NextResponse.json({ recipe, title, provider: 'gemini', mode });
  } catch (geminiError) {
    if (providerPreference === 'gemini') {
      serverLogger.error('recipe_generate.gemini_forced_failed', {
        requestId,
        durationMs: Date.now() - startedAt,
        error: geminiError instanceof Error ? geminiError.message : 'Gemini error desconocido',
      });
      return NextResponse.json(
        {
          error: `Falló Gemini (forzado): ${
            geminiError instanceof Error ? geminiError.message : 'error desconocido'
          }`,
        },
        { status: 502 }
      );
    }

    serverLogger.warn('recipe_generate.gemini_failed_fallback_openrouter', {
      requestId,
      durationMs: Date.now() - startedAt,
      error: geminiError instanceof Error ? geminiError.message : 'Gemini error desconocido',
    });

    try {
      return await runOpenRouterFallback(geminiError instanceof Error ? geminiError.message : 'gemini_unknown_error');
    } catch (openRouterError) {
      serverLogger.error('recipe_generate.fallback_failed', {
        requestId,
        durationMs: Date.now() - startedAt,
        geminiError: geminiError instanceof Error ? geminiError.message : 'Gemini error desconocido',
        openRouterError: openRouterError instanceof Error ? openRouterError.message : 'OpenRouter error desconocido',
      });
      return NextResponse.json(
        {
          error: `Falló Gemini y OpenRouter. Gemini: ${
            geminiError instanceof Error ? geminiError.message : 'error desconocido'
          } | OpenRouter: ${openRouterError instanceof Error ? openRouterError.message : 'error desconocido'}`,
        },
        { status: 502 }
      );
    }
  }
}
