const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_OPENROUTER_MODEL = 'qwen/qwen3-next-80b-a3b-instruct:free';
const DEFAULT_APP_URL = 'http://localhost:3000';
const DEFAULT_APP_NAME = 'CocinaCore';

type OpenRouterMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

type OpenRouterChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    } | null;
  }>;
  error?: {
    message?: string;
  };
};

export type OpenRouterRecipeInput = {
  ingredients: string[];
  peopleCount?: number;
  baseCuisine?: string | null;
  fusionCuisine?: string[] | null;
  restrictions?: string[] | null;
  culinaryLevel?: 'principiante' | 'intermedio' | 'chef' | string | null;
};

function getOpenRouterConfig() {
  const apiKey = process.env.AI_API_KEY ?? process.env.OPENROUTER_API_KEY;
  const model =
    process.env.AI_MODEL ?? process.env.OPENROUTER_TEXT_MODEL ?? DEFAULT_OPENROUTER_MODEL;
  const baseUrl =
    process.env.AI_BASE_URL ?? process.env.OPENROUTER_BASE_URL ?? DEFAULT_OPENROUTER_BASE_URL;
  const appUrl = process.env.APP_PUBLIC_URL ?? DEFAULT_APP_URL;
  const appName = process.env.APP_NAME ?? DEFAULT_APP_NAME;

  if (!apiKey) {
    throw new Error('AI_API_KEY/OPENROUTER_API_KEY no está configurada.');
  }

  return { apiKey, model, baseUrl, appUrl, appName };
}

async function openRouterChatCompletion(
  messages: OpenRouterMessage[]
): Promise<{ model: string; content: string }> {
  const { apiKey, model, baseUrl, appUrl, appName } = getOpenRouterConfig();
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': appUrl,
      'X-Title': appName,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.5,
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as OpenRouterChatResponse;

  if (!response.ok) {
    const errorMessage = payload.error?.message ?? `OpenRouter error HTTP ${response.status}`;
    throw new Error(errorMessage);
  }

  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error('OpenRouter respondió sin contenido.');
  }

  return { model, content };
}

export async function generateRecipeWithOpenRouter(
  input: OpenRouterRecipeInput
): Promise<{ model: string; result: string }> {
  const ingredients = input.ingredients.filter((item) => item.trim().length > 0);
  if (ingredients.length === 0) {
    throw new Error('Debe enviar al menos un ingrediente.');
  }

  const baseCuisine = input.baseCuisine?.trim() || 'Latinoamericana';
  const peopleCount =
    typeof input.peopleCount === 'number' &&
    Number.isFinite(input.peopleCount) &&
    input.peopleCount > 0
      ? Math.floor(input.peopleCount)
      : 4;
  const fusion = (input.fusionCuisine ?? []).filter((item) => item.trim().length > 0);
  const restrictions = (input.restrictions ?? []).filter((item) => item.trim().length > 0);
  const culinaryLevel = input.culinaryLevel?.trim() || 'principiante';

  const fusionText = fusion.length > 0 ? fusion.join(', ') : 'sin fusión';
  const restrictionsText = restrictions.length > 0 ? restrictions.join(', ') : 'sin restricciones';

  const messages: OpenRouterMessage[] = [
    {
      role: 'system',
      content:
        'Sos un chef profesional y devolvés recetas claras en español con: título, ingredientes estructurados, preparación paso a paso, tiempo total y tips prácticos. La sección de ingredientes debe ser estrictamente parseable.',
    },
    {
      role: 'user',
      content: `Generá una receta con estos datos:
- Ingredientes: ${ingredients.join(', ')}
- Comensales: ${peopleCount}
- Cocina base: ${baseCuisine}
- Fusión culinaria: ${fusionText}
- Restricciones: ${restrictionsText}
- Nivel culinario: ${culinaryLevel}

La receta debe ser realista para cocina casera y fácil de seguir, ajustada en cantidades para ${peopleCount} personas.`,
    },
    {
      role: 'assistant',
      content: `Formato obligatorio de salida:
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

Reglas estrictas:
- Cada ingrediente debe ir en una sola línea.
- Cada línea de ingrediente debe empezar con cantidad numérica + unidad + nombre.
- Evitá subtítulos dentro de INGREDIENTES.
- Evitá frases largas tipo “para el sofrito” dentro de la lista; dejá solo el ingrediente base.
- Si algo no tiene cantidad clara, escribilo como “al gusto” para que se marque como no estructurado.`,
    },
  ];

  const completion = await openRouterChatCompletion(messages);
  return { model: completion.model, result: completion.content };
}
