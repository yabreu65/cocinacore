import http from 'node:http';

const host = '127.0.0.1';
const port = Number(process.env.E2E_PROVIDER_PORT ?? 4319);
const embedding = Array.from({ length: 1536 }, () => 1);
const requests = [];

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
          ingredients: [{ name: 'avena', quantity: 1, unit: 'taza' }],
        },
        {
          mealType: 'lunch',
          title: 'Arroz conectado',
          description: 'Menú determinista',
          ingredients: [{ name: 'arroz', quantity: 1, unit: 'taza' }],
        },
        {
          mealType: 'dinner',
          title: 'Pollo conectado',
          description: null,
          ingredients: [{ name: 'pollo', quantity: 200, unit: 'g' }],
        },
      ],
    })),
  });
}

const recipeText = `[TITULO]

Pollo conectado determinista

INGREDIENTES
- 2 unidades tomate
- 1 taza arroz
- 200 g pollo

FUENTE
- Recetario conectado
- Página 7

PREPARACIÓN
1. Cociná el arroz y reservá.
2. Dorá el pollo con el tomate.
3. Serví el pollo sobre el arroz.

TIPS
- Ajustá la sal al final.`;

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
      const responseJsonSchema = body.generationConfig?.responseJsonSchema;
      return json(response, 200, {
        candidates: [
          {
            content: {
              parts: [{ text: responseJsonSchema ? structuredMealPlanText() : recipeText }],
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
