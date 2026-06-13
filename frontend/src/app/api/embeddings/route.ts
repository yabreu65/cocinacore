import { NextRequest, NextResponse } from 'next/server';
import { serverLogger } from '@/lib/serverLogger';
import { validateRequest, EmbeddingsSchema, type EmbeddingsBody } from '@/lib/validation';
import { checkRateLimit } from '@/lib/rate-limit';
import { getGeminiApiKey, getGeminiEmbeddingModel } from '@/lib/ai/gemini-config';

type GeminiBatchEmbedResponse = {
  embeddings?: Array<{ values?: number[]; embedding?: { values?: number[] } }>;
};

const ENV_MODEL = getGeminiEmbeddingModel();
const TARGET_EMBEDDING_DIM = Number(process.env.EMBEDDING_DIMENSIONS ?? '1536');
const FALLBACK_MODELS = ['gemini-embedding-001', 'gemini-embedding-2-preview'];

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
    }
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
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const apiKey = getGeminiApiKey();

  if (!apiKey) {
    serverLogger.warn('embeddings.misconfigured', { requestId });
    return NextResponse.json(
      {
        error:
          'GEMINI_API_KEY no está configurada en el servidor. Configurala para usar embeddings.',
      },
      { status: 503 }
    );
  }

  // 1. Zod validation
  const validation = await validateRequest(request, EmbeddingsSchema);
  if (!validation.success) {
    return Response.json(validation.error.body, { status: validation.error.status });
  }

  const body: EmbeddingsBody = validation.data;
  const texts = body.texts.map((text) => text.trim()).filter((text) => text.length > 0);

  // 2. Rate limit via ioredis (replaces in-memory Map)
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rateLimit = await checkRateLimit('embeddings', ip);
  if (!rateLimit.success) {
    serverLogger.warn('embeddings.rate_limited', { requestId, ip });
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

  serverLogger.info('embeddings.request', {
    requestId,
    ip,
    textsCount: texts.length,
    modelsTried: [...new Set([ENV_MODEL, ...FALLBACK_MODELS].filter(Boolean) as string[])],
  });

  const modelsToTry = [...new Set([ENV_MODEL, ...FALLBACK_MODELS].filter(Boolean) as string[])];
  const errors: string[] = [];

  for (const model of modelsToTry) {
    const result = await requestEmbeddings(apiKey, model, texts);
    if (result.ok) {
      serverLogger.info('embeddings.success', {
        requestId,
        durationMs: Date.now() - startedAt,
        modelUsed: model,
        embeddingsCount: result.embeddings.length,
      });
      return NextResponse.json({ embeddings: result.embeddings, modelUsed: model });
    }

    errors.push(`[${model}] ${result.errorText}`);
  }

  serverLogger.error('embeddings.failure', {
    requestId,
    durationMs: Date.now() - startedAt,
    modelsTried: modelsToTry,
  });

  return NextResponse.json(
    {
      error: `No se pudieron generar embeddings con Gemini. Modelos probados: ${modelsToTry.join(', ')}. Detalles: ${errors.join(' | ')}`,
    },
    { status: 502 }
  );
}
