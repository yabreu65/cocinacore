import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const requireUserMock = vi.fn();
const consumePlannedMealMock = vi.fn();
const getMealPlanConsumptionsMock = vi.fn();

vi.mock('@/lib/auth/server', () => ({ requireUser: requireUserMock }));
vi.mock('@/lib/db/repositories/mealPlanConsumptionRepository', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/db/repositories/mealPlanConsumptionRepository')>()),
  consumePlannedMeal: consumePlannedMealMock,
  getMealPlanConsumptions: getMealPlanConsumptionsMock,
}));

const { GET, POST } = await import('./route');
const { MealPlanConsumptionError } = await import('@/lib/db/repositories/mealPlanConsumptionRepository');

const PLAN_ID = '11111111-1111-4111-8111-111111111111';
const user = {
  id: 'user-1',
  email: 'test@example.test',
  fullName: null,
  tenant: { tenantId: 'tenant-1', role: 'owner' as const, tenantType: 'home' as const, onboardingCompleted: true },
  termsAcceptedAt: null,
  termsVersion: null,
  onboardingCompleted: true,
};

function request(path: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(`https://app.example.test${path}`, init);
}

describe('/api/meal-plan/consumption', () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    consumePlannedMealMock.mockReset();
    getMealPlanConsumptionsMock.mockReset();
    requireUserMock.mockResolvedValue(user);
    getMealPlanConsumptionsMock.mockResolvedValue({});
    consumePlannedMealMock.mockResolvedValue({
      alreadyConsumed: false,
      record: {
        consumedAt: '2026-09-30T21:00:00.000Z',
        dayIndex: 1,
        mealType: 'breakfast',
        mealTitle: 'Desayuno',
        decrements: [],
        skipped: [],
      },
    });
  });

  it('returns scoped consumption state for a valid plan', async () => {
    const response = await GET(request(`/api/meal-plan/consumption?mealPlanId=${PLAN_ID}`));
    expect(response.status).toBe(200);
    expect(getMealPlanConsumptionsMock).toHaveBeenCalledWith(PLAN_ID, 'user-1', 'tenant-1');
    expect(await response.json()).toEqual({ consumptions: {} });
  });

  it('rejects invalid GET identifiers before repository access', async () => {
    const response = await GET(request('/api/meal-plan/consumption?mealPlanId=nope'));
    expect(response.status).toBe(400);
    expect(getMealPlanConsumptionsMock).not.toHaveBeenCalled();
  });

  it('returns 401 when no authenticated tenant user exists', async () => {
    requireUserMock.mockRejectedValueOnce(new Error('Unauthorized'));
    const response = await GET(request(`/api/meal-plan/consumption?mealPlanId=${PLAN_ID}`));
    expect(response.status).toBe(401);
    expect(getMealPlanConsumptionsMock).not.toHaveBeenCalled();
  });

  it('confirms the exact meal using authenticated scope only', async () => {
    const response = await POST(request('/api/meal-plan/consumption', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mealPlanId: PLAN_ID, dayIndex: 1, mealType: 'breakfast' }),
    }));
    expect(response.status).toBe(200);
    expect(consumePlannedMealMock).toHaveBeenCalledWith({
      mealPlanId: PLAN_ID,
      dayIndex: 1,
      mealType: 'breakfast',
      tenantId: 'tenant-1',
      userId: 'user-1',
    });
  });

  it.each([
    [{ mealPlanId: 'bad', dayIndex: 1, mealType: 'breakfast' }],
    [{ mealPlanId: PLAN_ID, dayIndex: 0, mealType: 'breakfast' }],
    [{ mealPlanId: PLAN_ID, dayIndex: 1, mealType: 'snack' }],
    [{ mealPlanId: PLAN_ID, dayIndex: 1, mealType: 'breakfast', tenantId: 'other' }],
  ])('rejects malformed or browser-controlled confirmation fields', async (body) => {
    const response = await POST(request('/api/meal-plan/consumption', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }));
    expect(response.status).toBe(400);
    expect(consumePlannedMealMock).not.toHaveBeenCalled();
  });

  it('maps an exact missing plan to 404', async () => {
    consumePlannedMealMock.mockRejectedValueOnce(
      new MealPlanConsumptionError('not_found', 'Meal plan not found')
    );
    const response = await POST(request('/api/meal-plan/consumption', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mealPlanId: PLAN_ID, dayIndex: 1, mealType: 'lunch' }),
    }));
    expect(response.status).toBe(404);
  });
});
