import { NextResponse } from 'next/server';
import { generateRecipeWithOpenRouter } from '@/lib/ai/openrouter';

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ ok: false, error: 'Ruta disponible solo en desarrollo.' }, { status: 404 });
  }

  try {
    const response = await generateRecipeWithOpenRouter({
      ingredients: ['pollo', 'tomate', 'cebolla', 'ajo', 'arroz'],
      baseCuisine: 'Italiana',
      fusionCuisine: ['Venezolana'],
      restrictions: ['sin lactosa'],
      culinaryLevel: 'intermedio',
    });

    return NextResponse.json({
      ok: true,
      model: response.model,
      result: response.result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Error desconocido en OpenRouter.',
      },
      { status: 500 }
    );
  }
}
