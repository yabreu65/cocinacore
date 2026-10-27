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
  findMealPlanByIdForUserAndTenant,
  replaceMealPlanForAdaptiveProposal,
  updateMealPlanScheduleForUserAndTenant,
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

function expectedStoredContent(plan: StructuredMealPlan): string {
  return plan.days
    .map((day) =>
      [
        day.label,
        'Desayuno: Avena (tiempo no estimado) (1 taza Avena)',
        'Almuerzo: Arroz (tiempo no estimado) (Arroz)',
        'Cena: Sopa (tiempo no estimado) (Calabaza)',
      ].join('\n')
    )
    .join('\n\n');
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
    consumption_payload: {},
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
      restrictions: ['Gluten'],
      inventorySnapshot: { inventoryLines: ['- arroz: 1 taza'] },
      structuredPlan: plan,
    });

    expect(created).toEqual(mealPlanRow({ calendar_payload: plan }));
    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('insert into public.user_meal_plans');
    expect(sql).toContain('restrictions');
    expect(sql).toContain('inventory_snapshot');
    expect(sql).toContain('calendar_payload');
    expect(sql).toContain('ai_content');
    expect(params).toEqual([
      'tenant-1',
      'user-1',
      4,
      'week',
      'inventory_to_menu',
      'Latinoamericana',
      ['Japonesa'],
      'media',
      ['Gluten'],
      JSON.stringify({ inventoryLines: ['- arroz: 1 taza'] }),
      JSON.stringify(plan),
      expectedStoredContent(plan),
    ]);
  });

  it('looks up a plan using id, tenant and user ownership predicates', async () => {
    const row = mealPlanRow();
    queryMock.mockResolvedValue({ rows: [row] });

    await expect(
      findMealPlanByIdForUserAndTenant('meal-plan-1', 'user-1', 'tenant-1')
    ).resolves.toEqual(row);

    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/where id = \$1 and tenant_id = \$2 and user_id = \$3/);
    expect(params).toEqual(['meal-plan-1', 'tenant-1', 'user-1']);
  });

  it('adds confirmed schedule metadata without replacing the persisted plan JSON', async () => {
    const plan = structuredPlan();
    const schedule = {
      startDate: '2026-10-26',
      timeZone: 'America/Argentina/Buenos_Aires',
      confirmedAt: '2026-10-25T12:00:00.000Z',
    };
    const updatedRow = mealPlanRow({ calendar_payload: { ...plan, schedule } });
    queryMock.mockResolvedValue({ rows: [updatedRow] });

    const updated = await updateMealPlanScheduleForUserAndTenant({
      mealPlanId: 'meal-plan-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
      schedule,
    });

    expect(updated).toEqual(updatedRow);
    expect(updated?.calendar_payload).toMatchObject({ ...plan, schedule });
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("jsonb_set(calendar_payload, '{schedule}', $1::jsonb, true)");
    expect(sql).toMatch(/where id = \$2 and tenant_id = \$3 and user_id = \$4/);
    expect(params).toEqual([JSON.stringify(schedule), 'meal-plan-1', 'tenant-1', 'user-1']);
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
        restrictions: [],
        inventorySnapshot: { inventoryLines: [] },
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

  it('uses tenant ownership, exact snapshot and updated_at for an atomic adaptive replacement', async () => {
    const plan = structuredPlan();
    const updatedRow = mealPlanRow({
      calendar_payload: plan,
      updated_at: '2026-01-01T00:01:00.000Z',
    });
    queryMock.mockResolvedValue({ rows: [updatedRow] });

    await expect(
      replaceMealPlanForAdaptiveProposal({
        mealPlanId: 'meal-plan-1',
        userId: 'user-1',
        tenantId: 'tenant-1',
        expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
        expectedCalendarPayload: plan,
        structuredPlan: plan,
      })
    ).resolves.toEqual(updatedRow);

    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('and updated_at = $6::timestamptz');
    expect(sql).toContain('and calendar_payload = $7::jsonb');
    expect(sql).toContain('tenant_id = $4 and user_id = $5');
    expect(params).toEqual([
      JSON.stringify(plan),
      expectedStoredContent(plan),
      'meal-plan-1',
      'tenant-1',
      'user-1',
      '2026-01-01T00:00:00.000Z',
      JSON.stringify(plan),
    ]);
  });
});
