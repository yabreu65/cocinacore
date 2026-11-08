import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  requireUser: vi.fn(),
  hydrateMealPlanWarmup: vi.fn(),
  isWarmupQueueEnabled: vi.fn(),
  runMealPlanWarmupJob: vi.fn(),
  createMealPlanWarmupCapability: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock('@/lib/auth/server', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/meal-planner/recipe-warmup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/meal-planner/recipe-warmup')>();
  return { ...actual, hydrateMealPlanWarmup: mocks.hydrateMealPlanWarmup };
});
vi.mock('@/lib/queue/meal-plan-warmup', () => ({
  isWarmupQueueEnabled: mocks.isWarmupQueueEnabled,
  runMealPlanWarmupJob: mocks.runMealPlanWarmupJob,
}));
vi.mock('@/lib/auth/internal-capability', () => ({
  createMealPlanWarmupCapability: mocks.createMealPlanWarmupCapability,
}));

import { POST } from './route';

const meal = {
  name: 'Arroz de verduras',
  time: '30 min',
  difficulty: 'Fácil',
  badge: 'Rápido',
  fusionTag: 'Andina',
  missing: 0,
  aiScore: 86,
};
const validBody = {
  calendar: [{ day: 'Lunes', meals: { Desayuno: meal, Almuerzo: meal, Cena: meal } }],
  targetDays: ['Lunes'],
  inventory: ['arroz'],
  baseCuisine: 'Latinoamericana',
  fusionCuisines: [],
  peopleCount: 2,
  culinaryProfile: { level: 'Intermedio', preferred: [], avoid: [], goals: [] },
};

function request(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/meal-plan/warmup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/meal-plan/warmup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({
      id: 'user-1',
      tenant: { tenantId: 'tenant-1', role: 'owner', tenantType: 'home' },
    });
    mocks.checkRateLimit.mockResolvedValue({
      success: true,
      limit: 3,
      remaining: 2,
      resetAt: Math.floor(Date.now() / 1000) + 60,
      storage: 'redis',
    });
    mocks.isWarmupQueueEnabled.mockReturnValue(false);
    mocks.createMealPlanWarmupCapability.mockReturnValue('test-capability');
    mocks.hydrateMealPlanWarmup.mockResolvedValue({
      calendar: validBody.calendar,
      failed: 0,
      warmedSlots: 0,
    });
  });

  it.each([
    ['missing required field', { ...validBody, inventory: undefined }],
    ['wrong top-level type', { ...validBody, peopleCount: '2' }],
    [
      'invalid nested field',
      {
        ...validBody,
        calendar: [
          {
            ...validBody.calendar[0],
            meals: { ...validBody.calendar[0].meals, Cena: { ...meal, missing: '0' } },
          },
        ],
      },
    ],
  ])('returns 400 for %s', async (_name, body) => {
    const response = await POST(request(body));

    expect(response.status).toBe(400);
    expect(mocks.hydrateMealPlanWarmup).not.toHaveBeenCalled();
  });

  it('requires authentication before accepting warmup work', async () => {
    mocks.requireUser.mockRejectedValueOnce(new Error('Unauthorized'));

    const response = await POST(request(validBody));

    expect(response.status).toBe(401);
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
  });

  it('passes the fully validated contract without casts', async () => {
    const response = await POST(request(validBody));

    expect(response.status).toBe(200);
    const warmupInput: unknown = mocks.hydrateMealPlanWarmup.mock.calls[0]?.[0];
    expect(warmupInput).toMatchObject({
      ...validBody,
      origin: 'http://localhost',
      actorUserId: 'user-1',
      actorTenantId: 'tenant-1',
    });
    expect((warmupInput as { warmupRequestId?: unknown }).warmupRequestId).toEqual(
      expect.any(String)
    );
  });

  it('returns a generic error when the warmup implementation throws', async () => {
    mocks.hydrateMealPlanWarmup.mockRejectedValueOnce(new Error('private provider payload'));

    const response = await POST(request(validBody));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'No se pudo completar el warmup.' });
  });

  it('returns a recoverable error when queue admission is unavailable', async () => {
    mocks.isWarmupQueueEnabled.mockReturnValue(true);
    mocks.runMealPlanWarmupJob.mockResolvedValueOnce(null);

    const response = await POST(request(validBody));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'No se pudo iniciar el warmup inteligente.' });
    expect(mocks.hydrateMealPlanWarmup).not.toHaveBeenCalled();
  });

  it('returns 503 when shared rate-limit storage is unavailable', async () => {
    mocks.checkRateLimit.mockResolvedValueOnce({
      success: false,
      limit: 3,
      remaining: 0,
      resetAt: Math.floor(Date.now() / 1000) + 60,
      storage: 'unavailable',
    });

    const response = await POST(request(validBody));

    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toEqual(expect.any(String));
    expect(mocks.hydrateMealPlanWarmup).not.toHaveBeenCalled();
  });
});
