import http from 'node:http';

const host = '127.0.0.1';
const port = Number(process.env.E2E_PROVIDER_PORT ?? 4319);
const embedding = Array.from({ length: 1536 }, () => 1);
const requests = [];

function structuredTodayText() {
  return JSON.stringify({
    options: [
      { title: 'Tomato rice bowl', slot: 'lunch', ingredients: ['rice', 'tomato', 'olive oil'], prepMinutes: 25 },
      { title: 'Bean and corn tacos', slot: 'lunch', ingredients: ['beans', 'corn', 'tortillas'], prepMinutes: 30 },
      { title: 'Spinach pasta', slot: 'lunch', ingredients: ['pasta', 'spinach', 'garlic'], prepMinutes: 20 },
      { title: 'Peanut bowl', slot: 'lunch', ingredients: ['rice', 'peanut', 'carrot'], prepMinutes: 25 },
    ],
  });
}

function structuredMealPlanText() {
  return JSON.stringify({
    period: 'week',
    dayCount: 7,
    days: Array.from({ length: 7 }, (_, index) => ({
      dayIndex: index + 1,
      meals: [
        {
          mealType: 'breakfast',
          title: 'Avena conectada',
          description: null,
          prepMinutes: 20,
          ingredients: [{ name: 'avena', quantity: 1, unit: 'taza' }],
        },
        {
          mealType: 'lunch',
          title: 'Arroz conectado',
          description: 'Menú determinista',
          prepMinutes: 25,
          ingredients: [{ name: 'arroz', quantity: 1, unit: 'taza' }],
        },
        {
          mealType: 'dinner',
          title: 'Pollo conectado',
          description: null,
          prepMinutes: 30,
          ingredients: [{ name: 'pollo', quantity: 200, unit: 'g' }],
        },
      ],
    })),
  });
}

function structuredRecipeText(body) {
  const prompt = body.contents?.[0]?.parts?.[0]?.text ?? '';
  const servings = Number(/servings debe ser (\d+)/.exec(prompt)?.[1] ?? 4);
  return JSON.stringify({
    outcome: 'recipe', title: 'Pollo conectado determinista', servings,
    ingredients: [
      { name: 'tomate', quantity: '2', unit: 'unidades', quantityNote: null },
      { name: 'arroz', quantity: '1', unit: 'taza', quantityNote: null },
      { name: 'pollo', quantity: '200', unit: 'g', quantityNote: null },
    ],
    steps: ['Cociná el {{2}} y reservá.', 'Dorá el {{3}} con el {{1}}.', 'Serví el {{3}} sobre el {{2}}.'],
  });
}

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString('utf8');
  return body ? JSON.parse(body) : {};
}

function record(pathname, body) {
  requests.push({
    pathname,
    body,
    receivedAt: new Date().toISOString(),
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${host}:${port}`);

  if (request.method === 'GET' && url.pathname === '/__e2e/health') {
    return json(response, 200, { ok: true });
  }

  if (request.method === 'GET' && url.pathname === '/__e2e/requests') {
    return json(response, 200, {
      generationCallCount: requests.filter((entry) => entry.pathname.endsWith(':generateContent'))
        .length,
      requests,
    });
  }

  if (request.method === 'POST' && url.pathname === '/__e2e/reset') {
    requests.length = 0;
    return json(response, 200, { ok: true });
  }

  if (request.method !== 'POST') {
    return json(response, 404, { error: 'Not found' });
  }

  try {
    const body = await readJson(request);
    record(url.pathname, body);

    if (url.pathname.endsWith(':embedContent')) {
      return json(response, 200, { embedding: { values: embedding } });
    }

    if (url.pathname.endsWith(':batchEmbedContents')) {
      const count = Array.isArray(body.requests) ? body.requests.length : 0;
      return json(response, 200, {
        embeddings: Array.from({ length: count }, () => ({ values: embedding })),
      });
    }

    if (url.pathname.endsWith(':generateContent')) {
      const responseSchema = body.generationConfig?.responseSchema;
      const responseJsonSchema = body.generationConfig?.responseJsonSchema;
      const text = responseSchema?.properties?.options
        ? structuredTodayText()
        : responseJsonSchema?.properties?.ingredients && responseJsonSchema?.properties?.steps
          ? structuredRecipeText(body)
          : responseJsonSchema
            ? structuredMealPlanText()
            : structuredRecipeText(body);
      return json(response, 200, {
        candidates: [
          {
            content: {
              parts: [{ text }],
            },
          },
        ],
      });
    }

    return json(response, 404, { error: 'Unsupported Gemini fixture endpoint' });
  } catch (error) {
    return json(response, 400, {
      error: error instanceof Error ? error.message : 'Invalid request',
    });
  }
});

server.listen(port, host, () => {
  console.log(`E2E Gemini provider fixture listening on http://${host}:${port}`);
});
