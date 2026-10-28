import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  attachRecipeToMealPlanSlot: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/db/repositories/mealPlanRepository', () => ({
  attachRecipeToMealPlanSlot: mocks.attachRecipeToMealPlanSlot,
}));

import { POST } from './route';

const planId = '00000000-0000-4000-8000-000000000010';
const recipeId = '00000000-0000-4000-8000-000000000001';
const versionId = '00000000-0000-4000-8000-000000000002';
const user = { id: 'user-1', tenant: { tenantId: 'tenant-1', role: 'owner' } };

function request(body: unknown): NextRequest {
  return new NextRequest('https://app.example.test/api/meal-plan/recipe-selection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    mealPlanId: planId,
    dayIndex: 1,
    mealType: 'lunch',
    recipeId,
    versionId,
    expectedUpdatedAt: '2026-10-28T12:00:00.000Z',
    expectedCalendarPayload: { period: 'week', days: [] },
    confirmed: true,
    ...overrides,
  };
}

describe('POST /api/meal-plan/recipe-selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue(user);
    mocks.attachRecipeToMealPlanSlot.mockResolvedValue({
      status: 'applied',
      mealPlan: {},
      recipeId,
      versionId,
    });
  });

  it('rejects anonymous requests before attempting a selection', async () => {
    mocks.requireUser.mockRejectedValue(new Error('unauthorized'));
    const response = await POST(request(validBody()));
    expect(response.status).toBe(401);
    expect(mocks.attachRecipeToMealPlanSlot).not.toHaveBeenCalled();
  });

  it('requires explicit confirmation and bounded UUID inputs', async () => {
    const response = await POST(request(validBody({ confirmed: false, dayIndex: 31 })));
    expect(response.status).toBe(400);
    expect(mocks.attachRecipeToMealPlanSlot).not.toHaveBeenCalled();
  });

  it('passes the authenticated tenant and user to the atomic repository operation', async () => {
    const response = await POST(request(validBody()));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'applied',
      mealPlanId: planId,
      dayIndex: 1,
      mealType: 'lunch',
      recipeRef: { recipeId, versionId },
    });
    expect(mocks.attachRecipeToMealPlanSlot).toHaveBeenCalledWith({
      ...validBody(),
      userId: 'user-1',
      tenantId: 'tenant-1',
    });
  });

  it('returns idempotent success for a repeated identical selection', async () => {
    mocks.attachRecipeToMealPlanSlot.mockResolvedValue({
      status: 'already_applied',
      mealPlan: {},
      recipeId,
      versionId,
    });
    const response = await POST(request(validBody()));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status?: string };
    expect(body.status).toBe('already_applied');
  });

  it('returns a typed conflict for stale or occupied slots', async () => {
    mocks.attachRecipeToMealPlanSlot.mockResolvedValue({ status: 'conflict' });
    const response = await POST(request(validBody()));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'El menú cambió o el slot ya tiene otra receta.',
      code: 'MEAL_PLAN_SELECTION_CONFLICT',
    });
  });

  it('does not reveal an inaccessible recipe or plan', async () => {
    mocks.attachRecipeToMealPlanSlot.mockResolvedValue({ status: 'recipe_not_found' });
    const response = await POST(request(validBody()));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'No se encontró el recurso solicitado.' });
  });
});
