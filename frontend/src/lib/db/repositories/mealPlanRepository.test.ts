import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserMealPlanRow } from '@/lib/db/types';
import type { StructuredMealPlan } from '@/lib/meal-planner/structured-plan';

const queryMock = vi.fn();

vi.mock('@/lib/db', () => ({
  query: queryMock,
  mapSingleRow: (result: { rows: unknown[] }) => result.rows[0] ?? null,
}));

const {
  createMealPlan,
  findLatestMealPlanByUserAndTenant,
  MealPlanRepositoryError,
} = await import('./mealPlanRepository');

function structuredPlan(): StructuredMealPlan {
  return {
    period: 'week',
    dayCount: 7,
    days: Array.from({ length: 7 }, (_, index) => ({
      dayIndex: index + 1,
      label: index === 0 ? 'Lunes' : index === 6 ? 'Domingo' : `Día ${index + 1}`,
      meals: [
        {
          mealType: 'breakfast' as const,
          title: 'Avena',
          description: null,
          ingredients: [{ name: 'Avena', quantity: 1, unit: 'taza' }],
        },
        {
          mealType: 'lunch' as const,
          title: 'Arroz',
          description: null,
          ingredients: [{ name: 'Arroz', quantity: null, unit: null }],
        },
        {
          mealType: 'dinner' as const,
          title: 'Sopa',
          description: null,
          ingredients: [{ name: 'Calabaza', quantity: null, unit: null }],
        },
      ],
    })),
  };
}

function mealPlanRow(overrides: Partial<UserMealPlanRow> = {}): UserMealPlanRow {
  return {
    id: 'meal-plan-1',
    tenant_id: 'tenant-1',
    user_id: 'user-1',
    people_count: 4,
    period: 'week',
    mode: 'inventory_to_menu',
    base_cuisine: 'Latinoamericana',
    fusion_cuisines: [],
    fusion_intensity: 'media',
    goal: null,
    restrictions: [],
    inventory_snapshot: {},
    calendar_payload: structuredPlan(),
    ai_content: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('mealPlanRepository', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('inserts only the canonical structured plan as parameterized JSONB payload', async () => {
    const plan = structuredPlan();
    queryMock.mockResolvedValue({ rows: [mealPlanRow({ calendar_payload: plan })] });

    const created = await createMealPlan({
      tenantId: 'tenant-1',
      userId: 'user-1',
      peopleCount: 4,
      period: 'week',
      mode: 'inventory_to_menu',
      baseCuisine: 'Latinoamericana',
      fusionCuisines: ['Japonesa'],
      fusionIntensity: 'media',
      structuredPlan: plan,
    });

    expect(created).toEqual(mealPlanRow({ calendar_payload: plan }));
    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('insert into public.user_meal_plans');
    expect(sql).toContain('calendar_payload');
    expect(sql).not.toContain('ai_content');
    expect(params).toEqual([
      'tenant-1',
      'user-1',
      4,
      'week',
      'inventory_to_menu',
      'Latinoamericana',
      ['Japonesa'],
      'media',
      JSON.stringify(plan),
    ]);
  });

  it('throws a controlled error when an insert returns no row', async () => {
    queryMock.mockResolvedValue({ rows: [] });

    await expect(
      createMealPlan({
        tenantId: 'tenant-1',
        userId: 'user-1',
        peopleCount: 4,
        period: 'week',
        mode: 'inventory_to_menu',
        baseCuisine: 'Latinoamericana',
        fusionCuisines: [],
        fusionIntensity: 'media',
        structuredPlan: structuredPlan(),
      })
    ).rejects.toBeInstanceOf(MealPlanRepositoryError);
  });

  it('queries the latest row using both authenticated tenant and user predicates', async () => {
    const row = mealPlanRow();
    queryMock.mockResolvedValue({ rows: [row] });

    await expect(findLatestMealPlanByUserAndTenant('user-1', 'tenant-1')).resolves.toEqual(row);

    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/where tenant_id = \$1 and user_id = \$2/);
    expect(sql).toMatch(/order by created_at desc, id desc/);
    expect(sql).toMatch(/limit 1/);
    expect(params).toEqual(['tenant-1', 'user-1']);
  });
});
