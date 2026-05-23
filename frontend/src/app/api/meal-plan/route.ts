import { NextRequest, NextResponse } from 'next/server';

interface Body {
  mode?: 'inventory_to_menu' | 'menu_to_shopping';
  period?: 'week' | 'month';
  baseCuisine?: string;
  fusionCuisines?: string[];
  fusionIntensity?: 'sutil' | 'media' | 'alta';
  cuisine?: string;
  country?: string;
  inventory?: string[];
  culinaryProfile?: {
    preferred?: string[];
    avoid?: string[];
    goals?: string[];
    level?: string | null;
  };
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY no está configurada.' }, { status: 500 });
  }

  const body = (await request.json()) as Body;
  const mode = body.mode ?? 'inventory_to_menu';
  const period = body.period ?? 'week';
  const baseCuisine = (body.baseCuisine ?? body.cuisine ?? 'Latinoamericana').trim();
  const fusionCuisines = (body.fusionCuisines ?? (body.country ? [body.country] : []))
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 2);
  const fusionIntensity = body.fusionIntensity ?? 'media';
  const inventory = (body.inventory ?? []).map((v) => v.trim()).filter(Boolean).slice(0, 120);
  const profilePreferred = (body.culinaryProfile?.preferred ?? []).map((v) => v.trim()).filter(Boolean).slice(0, 12);
  const profileAvoid = (body.culinaryProfile?.avoid ?? []).map((v) => v.trim()).filter(Boolean).slice(0, 12);
  const profileGoals = (body.culinaryProfile?.goals ?? []).map((v) => v.trim()).filter(Boolean).slice(0, 12);
  const profileLevel = body.culinaryProfile?.level?.trim() || 'No especificado';

  const periodLabel = period === 'month' ? '30 días' : '7 días';
  const cuisineLabel = fusionCuisines.length > 0
    ? `${baseCuisine} fusionada con ${fusionCuisines.join(' y ')}`
    : baseCuisine;

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

  const prompt = mode === 'inventory_to_menu'
    ? `Genera un menú de ${periodLabel} basado ÚNICAMENTE en este inventario: ${inventory.join(', ') || 'sin inventario'}.
Cocina objetivo: ${cuisineLabel}.
Intensidad de fusión: ${fusionIntensity}.
Perfil del usuario:
- Preferencias: ${profilePreferred.join(', ') || 'No especificado'}
- Evitar: ${profileAvoid.join(', ') || 'No especificado'}
- Objetivos: ${profileGoals.join(', ') || 'No especificado'}
- Nivel: ${profileLevel}

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
- Preferencias: ${profilePreferred.join(', ') || 'No especificado'}
- Evitar: ${profileAvoid.join(', ') || 'No especificado'}
- Objetivos: ${profileGoals.join(', ') || 'No especificado'}
- Nivel: ${profileLevel}

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

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    return NextResponse.json({ error: `No se pudo generar menú: ${errorText}` }, { status: 502 });
  }

  const payload = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const content = payload.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

  if (!content) {
    return NextResponse.json({ error: 'Gemini no devolvió menú.' }, { status: 502 });
  }

  return NextResponse.json({ content });
}
