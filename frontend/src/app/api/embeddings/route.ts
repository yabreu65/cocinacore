import { NextRequest, NextResponse } from 'next/server';
import { serverLogger } from '@/lib/serverLogger';
import { validateRequest, EmbeddingsSchema, type EmbeddingsBody } from '@/lib/validation';
import { checkRateLimit } from '@/lib/rate-limit';
import { getGeminiApiKey, getGeminiEmbeddingModel, getGeminiBaseUrl, GEMINI_EMBEDDING_DIMENSIONS, isConfiguredEmbedding } from '@/lib/ai/gemini-config';
import { getRetryAfterSeconds, getTrustedClientIdentity } from '@/lib/rate-limit-identity';
import { requireUser } from '@/lib/auth/server';
import type { AuthUser } from '@/lib/auth/types';
import { isPlatformOwner } from '@/lib/db/repositories/platformOwnerRepository';

const EMBEDDINGS_TIMEOUT_MS = 15_000;

function providerRetrySeconds(header: string | null, body: unknown): number | null {
  const candidates: number[] = [];
  if (header && /^\d+$/.test(header)) {
    candidates.push(Number(header));
  } else if (header) {
    const date = Date.parse(header);
    if (Number.isFinite(date)) candidates.push(Math.ceil((date - Date.now()) / 1000));
  }
  if (body && typeof body === 'object' && 'error' in body) {
    const error = body.error;
    if (error && typeof error === 'object' && 'details' in error && Array.isArray(error.details)) {
      for (const detail of error.details as unknown[]) {
        if (detail && typeof detail === 'object' && '@type' in detail &&
          detail['@type'] === 'type.googleapis.com/google.rpc.RetryInfo' &&
          'retryDelay' in detail && typeof detail.retryDelay === 'string' && /^\d+(?:\.\d{1,9})?s$/.test(detail.retryDelay)) {
          candidates.push(Math.ceil(Number(detail.retryDelay.slice(0, -1))));
        }
      }
    }
  }
  const seconds = candidates.filter((value) => Number.isSafeInteger(value) && value >= 0);
  return seconds.length ? Math.max(1, ...seconds) : null;
}

async function requestEmbeddings(
  apiKey: string,
  model: string,
  texts: string[],
  signal: AbortSignal
) {
  try {
    const response = await fetch(
      `${getGeminiBaseUrl()}/models/${model}:batchEmbedContents?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          requests: texts.map((text) => ({
            model: `models/${model}`,
            content: { parts: [{ text }] },
            outputDimensionality: GEMINI_EMBEDDING_DIMENSIONS,
          })),
        }),
      }
    );

    if (response.status === 429) {
      const body: unknown = await response.json().catch(() => null);
      return {
        ok: false as const,
        status: 429,
        retryAfter: providerRetrySeconds(response.headers.get('Retry-After'), body),
      };
    }
    if (!response.ok) return { ok: false as const, status: response.status };

    const payload: unknown = await response.json();
    if (
      !payload ||
      typeof payload !== 'object' ||
      !('embeddings' in payload) ||
      !Array.isArray(payload.embeddings) ||
      payload.embeddings.length !== texts.length
    ) {
      return { ok: false as const, status: 502 };
    }

    const embeddings: number[][] = [];
    for (const item of payload.embeddings as unknown[]) {
      if (!item || typeof item !== 'object') return { ok: false as const, status: 502 };
      const record = item as Record<string, unknown>;
      const nested = record.embedding;
      const values =
        record.values ??
        (nested && typeof nested === 'object'
          ? (nested as Record<string, unknown>).values
          : undefined);
      if (!isConfiguredEmbedding(values)) {
        return { ok: false as const, status: 502 };
      }
      embeddings.push(values);
    }

    return { ok: true as const, embeddings };
  } catch (error) {
    serverLogger.warn('embeddings.provider_error', {
      model,
      reason: error instanceof Error ? error.name : 'unknown',
    });
    return { ok: false as const, status: 502 };
  }
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  let user: AuthUser;
  try {
    user = await requireUser(request, 'Unauthorized');
    if (!(await isPlatformOwner(user))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'Forbidden') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const apiKey = getGeminiApiKey();

  if (!apiKey) {
    serverLogger.warn('embeddings.misconfigured', { requestId });
    return NextResponse.json(
      {
        error: 'El servicio de embeddings no está disponible temporalmente.',
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
  const clientIdentity = user.id || getTrustedClientIdentity(request);
  const rateLimit = await checkRateLimit('embeddings', clientIdentity, user.id, {
    requireSharedStore: true,
  });
  if (!rateLimit.success) {
    const retryAfter = getRetryAfterSeconds(rateLimit.resetAt);
    const storageUnavailable = rateLimit.storage === 'unavailable';
    serverLogger.warn('embeddings.rate_limited', { requestId, storage: rateLimit.storage });
    return Response.json(
      {
        error: storageUnavailable
          ? 'El servicio de embeddings no está disponible temporalmente.'
          : 'Rate limit exceeded',
        retryAfter,
      },
      {
        status: storageUnavailable ? 503 : 429,
        headers: {
          'Retry-After': String(retryAfter),
          'X-RateLimit-Limit': String(rateLimit.limit),
          'X-RateLimit-Remaining': String(rateLimit.remaining),
          'X-RateLimit-Reset': String(rateLimit.resetAt),
        },
      }
    );
  }

  serverLogger.info('embeddings.request', {
    requestId,
    storage: rateLimit.storage,
    textsCount: texts.length,
    model: getGeminiEmbeddingModel(),
  });

  const model = getGeminiEmbeddingModel();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EMBEDDINGS_TIMEOUT_MS);
  const abortFromRequest = () => controller.abort();
  request.signal.addEventListener('abort', abortFromRequest, { once: true });
  try {
    const result = await requestEmbeddings(apiKey, model, texts, controller.signal);
    if (result.ok) {
      serverLogger.info('embeddings.success', {
        requestId,
        durationMs: Date.now() - startedAt,
        modelUsed: model,
        embeddingsCount: result.embeddings.length,
      });
      return NextResponse.json({ embeddings: result.embeddings, modelUsed: model });
    }
    serverLogger.warn('embeddings.model_failed', { requestId, model, status: result.status });
    if (result.status === 429) {
      const retryAfter = 'retryAfter' in result ? result.retryAfter : null;
      return NextResponse.json(
        { error: 'Gemini ha alcanzado un límite de uso. Revisá la cuota del proyecto.', retryAfter },
        { status: 429, headers: retryAfter ? { 'Retry-After': String(retryAfter) } : {} },
      );
    }
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener('abort', abortFromRequest);
  }

  serverLogger.error('embeddings.failure', {
    requestId,
    durationMs: Date.now() - startedAt,
    model,
  });

  return NextResponse.json(
    {
      error: 'No se pudieron generar embeddings temporalmente.',
    },
    { status: 502 }
  );
}
