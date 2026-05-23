import { NextRequest, NextResponse } from 'next/server';

interface Body {
  ingredients?: string[];
  chunks?: string[];
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
    .find((line) => !line.toLowerCase().startsWith('ingredientes') && !line.toLowerCase().startsWith('preparación') && !line.toLowerCase().startsWith('preparacion'));

  if (!clean) return 'Receta generada';
  return clean.replace(/^#+\s*/, '').replace(/^\d+[\.)-]\s*/, '').trim();
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY no está configurada.' }, { status: 500 });
  }

  const body = (await request.json()) as Body;
  const ingredients = (body.ingredients ?? []).filter(Boolean).slice(0, 30);
  const chunks = (body.chunks ?? []).filter(Boolean).slice(0, 14);
  const profile = body.culinaryProfile;
  const preferred = (profile?.preferred ?? []).filter(Boolean).slice(0, 10);
  const avoid = (profile?.avoid ?? []).filter(Boolean).slice(0, 10);
  const goals = (profile?.goals ?? []).filter(Boolean).slice(0, 10);
  const identity = (profile?.identity ?? []).filter(Boolean).slice(0, 6);
  const level = profile?.level?.trim() || 'No especificado';

  const prompt = `Eres un chef-editor culinario. Debes devolver una receta en español con formato claro y exacto, sin JSON.

SI HAY CONTEXTO DOCUMENTAL, prioriza ese contenido y usa el NOMBRE de la receta que aparezca en el texto fuente.

Ingredientes del usuario:
${ingredients.join('; ') || 'No especificados'}

Perfil culinario del usuario:
- Identidad de cocina: ${identity.join(', ') || 'No especificado'}
- Preferencias: ${preferred.join(', ') || 'No especificado'}
- Objetivos: ${goals.join(', ') || 'No especificado'}
- Restricciones/evitar: ${avoid.join(', ') || 'No especificado'}
- Nivel culinario: ${level}

Contexto documental:
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
- Respeta estrictamente restricciones de "evitar".
- Máximo 450 palabras.`;

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    return NextResponse.json({ error: `No se pudo generar receta: ${errorText}` }, { status: 502 });
  }

  const payload = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const recipe = payload.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

  if (!recipe) {
    return NextResponse.json({ error: 'Gemini no devolvió contenido de receta.' }, { status: 502 });
  }

  const title = inferTitleFromRecipe(recipe);
  return NextResponse.json({ recipe, title });
}
