import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { UserMealPlanRow } from '@/lib/db/types';
import type { UpdateMealPlanScheduleInput } from '@/lib/db/repositories/mealPlanRepository';

const mockRequireUser = vi.fn();
const mockFindMealPlanByIdForUserAndTenant = vi.fn();
const mockUpdateMealPlanScheduleForUserAndTenant = vi.fn();

vi.mock('@/lib/auth/server', () => ({ requireUser: mockRequireUser }));
vi.mock('@/lib/db/repositories/mealPlanRepository', () => ({
  findMealPlanByIdForUserAndTenant: mockFindMealPlanByIdForUserAndTenant,
  updateMealPlanScheduleForUserAndTenant: mockUpdateMealPlanScheduleForUserAndTenant,
}));
vi.mock('@/lib/serverLogger', () => ({ serverLogger: { info: vi.fn(), warn: vi.fn() } }));

const { POST } = await import('./route');

function request(body: unknown): Request {
  return new Request('https://app.example.test/api/meal-plan/schedule', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function validPlanRow(overrides: Partial<UserMealPlanRow> = {}): UserMealPlanRow {
  return {
    id: 'plan-1',
    tenant_id: 'tenant-1',
    user_id: 'user-1',
    people_count: 2,
    period: 'week',
    mode: 'balanced_ai',
    base_cuisine: 'Latinoamericana',
    fusion_cuisines: [],
    fusion_intensity: 'media',
    goal: null,
    restrictions: [],
    inventory_snapshot: {},
    calendar_payload: {
      period: 'week',
      dayCount: 7,
      days: Array.from({ length: 7 }, (_, index) => ({
        dayIndex: index + 1,
        meals: ['breakfast', 'lunch', 'dinner'].map((mealType) => ({
          mealType,
          title: `Comida ${index + 1}`,
          prepMinutes: 20,
          description: null,
          ingredients: [{ name: 'Arroz', quantity: 100, unit: 'g' }],
        })),
      })),
    },
    consumption_payload: {},
    ai_content: null,
    created_at: '2026-10-24T12:00:00.000Z',
    updated_at: '2026-10-24T12:00:00.000Z',
    ...overrides,
  };
}

const user = {
  id: 'user-1',
  email: 'user@example.test',
  fullName: null,
  tenant: { tenantId: 'tenant-1', role: 'owner', tenantType: 'home', onboardingCompleted: true },
  termsAcceptedAt: null,
  termsVersion: null,
  onboardingCompleted: true,
};

describe('POST /api/meal-plan/schedule', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-25T12:00:00.000Z'));
    mockRequireUser.mockReset().mockResolvedValue(user);
    mockFindMealPlanByIdForUserAndTenant.mockReset().mockResolvedValue(validPlanRow());
    mockUpdateMealPlanScheduleForUserAndTenant
      .mockReset()
      .mockImplementation(async (input: UpdateMealPlanScheduleInput) => ({
        ...validPlanRow(),
        calendar_payload: {
          ...(validPlanRow().calendar_payload as Record<string, unknown>),
          schedule: input.schedule,
        },
      }));
  });

  afterEach(() => vi.useRealTimers());

  it('rejects requests without an explicit confirmation before reading or writing plan data', async () => {
    const response = await POST(
      request({
        mealPlanId: 'plan-1',
        startDate: '2026-10-26',
        timeZone: 'UTC',
        portionBasisConfirmed: true,
      }) as unknown as NextRequest
    );

    expect(response.status).toBe(400);
    expect(mockFindMealPlanByIdForUserAndTenant).not.toHaveBeenCalled();
    expect(mockUpdateMealPlanScheduleForUserAndTenant).not.toHaveBeenCalled();
  });

  it.each([
    { startDate: '2026-02-30', timeZone: 'UTC' },
    { startDate: '2026-10-26', timeZone: 'Not/A_Timezone' },
    { startDate: '2026-10-24', timeZone: 'UTC' },
  ])(
    'rejects invalid, unparseable, or past schedules without mutating the plan',
    async (scheduleInput) => {
      const response = await POST(
        request({
          mealPlanId: 'plan-1',
          ...scheduleInput,
          confirmed: true,
          portionBasisConfirmed: true,
        }) as unknown as NextRequest
      );

      expect(response.status).toBe(400);
      expect(mockUpdateMealPlanScheduleForUserAndTenant).not.toHaveBeenCalled();
    }
  );

  it('requires explicit portion-basis confirmation before reading or updating a plan', async () => {
    const response = await POST(
      request({
        mealPlanId: 'plan-1',
        startDate: '2026-10-26',
        timeZone: 'UTC',
        confirmed: true,
      }) as unknown as NextRequest
    );

    expect(response.status).toBe(400);
    expect(mockFindMealPlanByIdForUserAndTenant).not.toHaveBeenCalled();
    expect(mockUpdateMealPlanScheduleForUserAndTenant).not.toHaveBeenCalled();
  });

  it('scopes plan lookup and schedule write to the authenticated user and tenant', async () => {
    const response = await POST(
      request({
        mealPlanId: 'plan-1',
        startDate: '2026-10-26',
        timeZone: 'America/Argentina/Buenos_Aires',
        confirmed: true,
        portionBasisConfirmed: true,
      }) as unknown as NextRequest
    );

    expect(response.status).toBe(200);
    expect(mockFindMealPlanByIdForUserAndTenant).toHaveBeenCalledWith(
      'plan-1',
      'user-1',
      'tenant-1'
    );
    expect(mockUpdateMealPlanScheduleForUserAndTenant).toHaveBeenCalledWith({
      mealPlanId: 'plan-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
      schedule: {
        startDate: '2026-10-26',
        timeZone: 'America/Argentina/Buenos_Aires',
        confirmedAt: '2026-10-25T12:00:00.000Z',
        portionConfirmation: {
          peopleCount: 2,
          confirmedAt: '2026-10-25T12:00:00.000Z',
        },
      },
    });
    expect(await response.json()).toMatchObject({
      schedule: {
        startDate: '2026-10-26',
        timeZone: 'America/Argentina/Buenos_Aires',
        confirmedAt: '2026-10-25T12:00:00.000Z',
        portionConfirmation: {
          peopleCount: 2,
          confirmedAt: '2026-10-25T12:00:00.000Z',
        },
      },
    });
  });

  it('does not update a plan that is not owned by the authenticated user and tenant', async () => {
    mockFindMealPlanByIdForUserAndTenant.mockResolvedValue(null);

    const response = await POST(
      request({
        mealPlanId: 'other-tenant-plan',
        startDate: '2026-10-26',
        timeZone: 'UTC',
        confirmed: true,
        portionBasisConfirmed: true,
      }) as unknown as NextRequest
    );

    expect(response.status).toBe(404);
    expect(mockFindMealPlanByIdForUserAndTenant).toHaveBeenCalledWith(
      'other-tenant-plan',
      'user-1',
      'tenant-1'
    );
    expect(mockUpdateMealPlanScheduleForUserAndTenant).not.toHaveBeenCalled();
  });

  it('rejects a repository result owned by another user or tenant before updating it', async () => {
    mockFindMealPlanByIdForUserAndTenant.mockResolvedValue(validPlanRow({ tenant_id: 'tenant-2' }));

    const response = await POST(
      request({
        mealPlanId: 'plan-1',
        startDate: '2026-10-26',
        timeZone: 'UTC',
        confirmed: true,
        portionBasisConfirmed: true,
      }) as unknown as NextRequest
    );

    expect(response.status).toBe(404);
    expect(mockUpdateMealPlanScheduleForUserAndTenant).not.toHaveBeenCalled();
  });

  it('requires an authenticated tenant and never reads plan data without one', async () => {
    mockRequireUser.mockResolvedValue({ ...user, tenant: null });

    const response = await POST(
      request({
        mealPlanId: 'plan-1',
        startDate: '2026-10-26',
        timeZone: 'UTC',
        confirmed: true,
        portionBasisConfirmed: true,
      }) as unknown as NextRequest
    );

    expect(response.status).toBe(401);
    expect(mockFindMealPlanByIdForUserAndTenant).not.toHaveBeenCalled();
    expect(mockUpdateMealPlanScheduleForUserAndTenant).not.toHaveBeenCalled();
  });

  it('returns a server error and does not schedule when persisted-plan lookup fails', async () => {
    mockFindMealPlanByIdForUserAndTenant.mockRejectedValue(new Error('database unavailable'));

    const response = await POST(
      request({
        mealPlanId: 'plan-1',
        startDate: '2026-10-26',
        timeZone: 'UTC',
        confirmed: true,
        portionBasisConfirmed: true,
      }) as unknown as NextRequest
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'No se pudo recuperar el menú guardado.' });
    expect(mockUpdateMealPlanScheduleForUserAndTenant).not.toHaveBeenCalled();
  });

  it('rejects a malformed persisted plan before attempting schedule persistence', async () => {
    mockFindMealPlanByIdForUserAndTenant.mockResolvedValue(
      validPlanRow({
        calendar_payload: { period: 'week', dayCount: 7, days: [] },
      })
    );

    const response = await POST(
      request({
        mealPlanId: 'plan-1',
        startDate: '2026-10-26',
        timeZone: 'UTC',
        confirmed: true,
        portionBasisConfirmed: true,
      }) as unknown as NextRequest
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'El menú guardado no tiene un formato válido.' });
    expect(mockUpdateMealPlanScheduleForUserAndTenant).not.toHaveBeenCalled();
  });

  it('returns a server error when schedule persistence fails', async () => {
    mockUpdateMealPlanScheduleForUserAndTenant.mockRejectedValue(new Error('database unavailable'));

    const response = await POST(
      request({
        mealPlanId: 'plan-1',
        startDate: '2026-10-26',
        timeZone: 'UTC',
        confirmed: true,
        portionBasisConfirmed: true,
      }) as unknown as NextRequest
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'No se pudo guardar la agenda.' });
    expect(mockFindMealPlanByIdForUserAndTenant).toHaveBeenCalledWith('plan-1', 'user-1', 'tenant-1');
  });

  it('requires authentication and never reads or writes plan data for anonymous requests', async () => {
    mockRequireUser.mockRejectedValue(new Error('unauthorized'));

    const response = await POST(
      request({
        mealPlanId: 'plan-1',
        startDate: '2026-10-26',
        timeZone: 'UTC',
        confirmed: true,
        portionBasisConfirmed: true,
      }) as unknown as NextRequest
    );

    expect(response.status).toBe(401);
    expect(mockFindMealPlanByIdForUserAndTenant).not.toHaveBeenCalled();
    expect(mockUpdateMealPlanScheduleForUserAndTenant).not.toHaveBeenCalled();
  });
});
