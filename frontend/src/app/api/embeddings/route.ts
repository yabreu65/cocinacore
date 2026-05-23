import { NextRequest, NextResponse } from 'next/server';

interface EmbeddingsRequestBody {
  texts?: string[];
}

type GeminiBatchEmbedResponse = {
  embeddings?: Array<{ values?: number[]; embedding?: { values?: number[] } }>;
};

const ENV_MODEL = process.env.GEMINI_EMBEDDING_MODEL;
const TARGET_EMBEDDING_DIM = Number(process.env.EMBEDDING_DIMENSIONS ?? '1536');
const FALLBACK_MODELS = ['gemini-embedding-001', 'gemini-embedding-2-preview'];
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 25;
const rateStore = new Map<string, { count: number; resetAt: number }>();


function normalizeDimensions(values: number[]): number[] {
  if (!Number.isFinite(TARGET_EMBEDDING_DIM) || TARGET_EMBEDDING_DIM <= 0) {
    return values;
  }

  if (values.length === TARGET_EMBEDDING_DIM) {
    return values;
  }

  if (values.length > TARGET_EMBEDDING_DIM) {
    return values.slice(0, TARGET_EMBEDDING_DIM);
  }

  return [...values, ...Array.from({ length: TARGET_EMBEDDING_DIM - values.length }, () => 0)];
}

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const current = rateStore.get(key);

  if (!current || now > current.resetAt) {
    rateStore.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }

  if (current.count >= RATE_MAX_REQUESTS) {
    return true;
  }

  current.count += 1;
  rateStore.set(key, current);
  return false;
}

async function requestEmbeddings(apiKey: string, model: string, texts: string[]) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: `models/${model}`,
          content: { parts: [{ text }] },
          outputDimensionality: TARGET_EMBEDDING_DIM,
        })),
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    return { ok: false as const, errorText, status: response.status };
  }

  const payload = (await response.json()) as GeminiBatchEmbedResponse;
  const embeddings = (payload.embeddings ?? [])
    .map((item) => item.values ?? item.embedding?.values)
    .filter((values): values is number[] => Array.isArray(values))
    .map((values) => normalizeDimensions(values));

  if (embeddings.length !== texts.length) {
    return {
      ok: false as const,
      errorText: `La respuesta de embeddings no coincide con los textos enviados. enviados=${texts.length}, recibidos=${embeddings.length}, raw=${JSON.stringify(payload).slice(0, 400)}`,
      status: 502,
    };
  }

  return { ok: true as const, embeddings };
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY no está configurada en el servidor.' }, { status: 500 });
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  if (isRateLimited(ip)) {
    return NextResponse.json({ error: 'Límite de solicitudes excedido. Espera un minuto.' }, { status: 429 });
  }

  const body = (await request.json()) as EmbeddingsRequestBody;
  const texts = Array.isArray(body.texts) ? body.texts.map((text) => text.trim()).filter((text) => text.length > 0) : [];

  if (texts.length === 0) {
    return NextResponse.json({ error: 'Debes enviar al menos un texto.' }, { status: 400 });
  }

  if (texts.length > 120) {
    return NextResponse.json({ error: 'Máximo 120 textos por solicitud.' }, { status: 400 });
  }

  const modelsToTry = [...new Set([ENV_MODEL, ...FALLBACK_MODELS].filter(Boolean) as string[])];
  const errors: string[] = [];

  for (const model of modelsToTry) {
    const result = await requestEmbeddings(apiKey, model, texts);
    if (result.ok) {
      return NextResponse.json({ embeddings: result.embeddings, modelUsed: model });
    }

    errors.push(`[${model}] ${result.errorText}`);

    // If model not found, continue fallback. For other statuses also try fallback just in case.
  }

  return NextResponse.json(
    {
      error: `No se pudieron generar embeddings con Gemini. Modelos probados: ${modelsToTry.join(', ')}. Detalles: ${errors.join(' | ')}`,
    },
    { status: 502 },
  );
}
