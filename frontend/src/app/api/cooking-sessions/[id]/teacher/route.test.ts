import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  loadCookingTeacherContext: vi.fn(),
  getGeminiApiKey: vi.fn(),
  createCookingTeacherProvider: vi.fn(),
  retrieveServerRagContext: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/cooking-teacher-context', () => ({
  loadCookingTeacherContext: mocks.loadCookingTeacherContext,
}));
vi.mock('@/lib/ai/gemini-config', () => ({ getGeminiApiKey: mocks.getGeminiApiKey }));
vi.mock('@/lib/cooking-teacher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/cooking-teacher')>();
  return { ...actual, createCookingTeacherProvider: mocks.createCookingTeacherProvider };
});
vi.mock('@/lib/recipes/server-rag-context', () => ({
  retrieveServerRagContext: mocks.retrieveServerRagContext,
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mocks.checkRateLimit }));

import { POST } from './route';

const sessionId = '00000000-0000-4000-8000-000000000001';

const context = {
  authorization: { verified: true, tenantScoped: true, writes: 'none' },
  session: {
    id: sessionId,
    status: 'active',
    currentStep: 1,
    totalSteps: 1,
    mealType: 'lunch',
    dayIndex: 1,
  },
  recipe: {
    recipeId: '00000000-0000-4000-8000-000000000002',
    versionId: '00000000-0000-4000-8000-000000000003',
    versionNumber: 1,
    title: 'Receta de prueba',
    servings: 2,
  },
  operationalStep: { index: 1, title: 'Paso', instruction: 'Cocinar.' },
  pedagogicalBoundary: {
    derivedStagesAllowed: true,
    doNotAdvanceOperationalProgress: true,
    source: 'operational_step',
  },
  ingredients: [],
  restrictions: { status: 'clear', allergies: [], avoids: [], reasons: [], evidence: 'supported' },
  knowledgeReferences: [],
  limitations: [],
};

function request(body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/cooking-sessions/${sessionId}/teacher`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.10' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/cooking-sessions/[id]/teacher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ id: 'user-1', tenant: { tenantId: 'tenant-1' } });
    mocks.checkRateLimit.mockResolvedValue({
      success: true,
      limit: 20,
      remaining: 19,
      resetAt: Math.floor(Date.now() / 1000) + 60,
      storage: 'redis',
    });
    mocks.loadCookingTeacherContext.mockResolvedValue(context);
    mocks.getGeminiApiKey.mockReturnValue('test-key');
    mocks.retrieveServerRagContext.mockResolvedValue({
      context: '',
      citations: [],
      ragContextUsed: false,
    });
    mocks.createCookingTeacherProvider.mockReturnValue({
      answer: vi.fn().mockResolvedValue({
        kind: 'explanation',
        answer: 'Explicación.',
        evidence: 'partial',
        citations: [],
        limitations: [],
        sessionMutation: 'none',
      }),
    });
  });

  it('rejects anonymous requests before loading session data', async () => {
    mocks.requireUser.mockRejectedValue(new Error('Unauthorized'));
    const response = await POST(request({ question: '¿Qué hago?' }), {
      params: Promise.resolve({ id: sessionId }),
    });

    expect(response.status).toBe(401);
    expect(mocks.loadCookingTeacherContext).not.toHaveBeenCalled();
  });

  it('does not misclassify session infrastructure failures as anonymous', async () => {
    mocks.requireUser.mockRejectedValue(new Error('database connection refused'));
    const response = await POST(request({ question: '¿Qué hago?' }), {
      params: Promise.resolve({ id: sessionId }),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty('response');
    expect(mocks.loadCookingTeacherContext).not.toHaveBeenCalled();
  });

  it('returns 504 when authentication exceeds the deadline', async () => {
    mocks.requireUser.mockImplementation(
      async (_request: unknown, _message: unknown, options: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) =>
          options.signal.addEventListener('abort', () => resolve())
        );
        throw new Error('aborted');
      }
    );
    vi.useFakeTimers();
    try {
      const pending = POST(request({ question: '¿Qué hago?' }), {
        params: Promise.resolve({ id: sessionId }),
      });
      await vi.advanceTimersByTimeAsync(15_000);
      const response = await pending;
      expect(response.status).toBe(504);
      expect(await response.json()).not.toHaveProperty('response');
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns 503 rather than a synthetic success on context infrastructure failure', async () => {
    mocks.loadCookingTeacherContext.mockRejectedValue(new Error('private database error'));
    const response = await POST(request({ question: '¿Qué hago?' }), {
      params: Promise.resolve({ id: sessionId }),
    });
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('private database error');
  });

  it('returns 503 when the provider reports unavailable', async () => {
    mocks.createCookingTeacherProvider.mockReturnValue({
      answer: vi.fn().mockResolvedValue({ kind: 'provider_unavailable' }),
    });
    const response = await POST(request({ question: '¿Qué hago?' }), {
      params: Promise.resolve({ id: sessionId }),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty('response');
  });

  it('rejects invalid questions without calling the provider', async () => {
    const response = await POST(request({ question: '' }), {
      params: Promise.resolve({ id: sessionId }),
    });

    expect(response.status).toBe(400);
    expect(mocks.createCookingTeacherProvider).not.toHaveBeenCalled();
  });

  it('fails closed on deterministic restrictions without provider access', async () => {
    mocks.loadCookingTeacherContext.mockResolvedValue({
      ...context,
      restrictions: {
        status: 'blocked',
        allergies: ['maní'],
        avoids: [],
        reasons: ['Restricción aplicable.'],
        evidence: 'supported',
      },
    });
    const response = await POST(request({ question: 'Explicame el paso.' }), {
      params: Promise.resolve({ id: sessionId }),
    });
    const body = (await response.json()) as { response: { kind: string; sessionMutation: string } };

    expect(response.status).toBe(200);
    expect(body.response.kind).toBe('safe_refusal');
    expect(body.response.sessionMutation).toBe('none');
    expect(mocks.createCookingTeacherProvider).not.toHaveBeenCalled();
    expect(mocks.retrieveServerRagContext).not.toHaveBeenCalled();
  });

  it('returns provider output without exposing a domain command', async () => {
    const response = await POST(request({ question: '¿Qué señal visual debería observar?' }), {
      params: Promise.resolve({ id: sessionId }),
    });
    const body = (await response.json()) as {
      response: { answer: string; sessionMutation: string };
    };

    expect(response.status).toBe(200);
    expect(body.response.answer).toBe('Explicación.');
    expect(body.response.sessionMutation).toBe('none');
    expect(mocks.retrieveServerRagContext).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        userId: 'user-1',
        recipeName: 'Receta de prueba',
        signal: expect.any(AbortSignal) as unknown as AbortSignal,
        deadlineAt: expect.any(Number) as unknown as number,
      })
    );
    expect(mocks.loadCookingTeacherContext).toHaveBeenCalledWith(
      sessionId,
      'tenant-1',
      'user-1',
      expect.objectContaining({
        signal: expect.any(AbortSignal) as unknown as AbortSignal,
        deadlineAt: expect.any(Number) as unknown as number,
      })
    );
    expect(mocks.checkRateLimit).toHaveBeenNthCalledWith(
      1,
      'cooking-teacher-user',
      'user-1',
      undefined,
      expect.objectContaining({
        requireSharedStore: true,
        signal: expect.any(AbortSignal) as unknown as AbortSignal,
        deadlineAt: expect.any(Number) as unknown as number,
      })
    );
    expect(mocks.checkRateLimit).toHaveBeenNthCalledWith(
      2,
      'cooking-teacher-tenant',
      'tenant-1',
      undefined,
      expect.objectContaining({
        requireSharedStore: true,
        signal: expect.any(AbortSignal) as unknown as AbortSignal,
        deadlineAt: expect.any(Number) as unknown as number,
      })
    );
  });

  it('fails closed when the shared limiter is unavailable and emits Retry-After seconds', async () => {
    mocks.checkRateLimit.mockResolvedValue({
      success: false,
      limit: 20,
      remaining: 0,
      resetAt: Math.floor(Date.now() / 1000) + 60,
      storage: 'unavailable',
    });

    const response = await POST(request({ question: '¿Qué señal debería observar?' }), {
      params: Promise.resolve({ id: sessionId }),
    });
    const body = (await response.json()) as { error: string; retryAfter: number };

    expect(response.status).toBe(503);
    expect(body.error).toContain('temporalmente');
    expect(body.retryAfter).toBeGreaterThanOrEqual(1);
    expect(response.headers.get('retry-after')).toBe(String(body.retryAfter));
    expect(mocks.loadCookingTeacherContext).not.toHaveBeenCalled();
  });
});
