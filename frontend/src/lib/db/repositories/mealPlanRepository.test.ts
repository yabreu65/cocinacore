import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserMealPlanRow } from '@/lib/db/types';
import type { StructuredMealPlan } from '@/lib/meal-planner/structured-plan';

const queryMock = vi.fn();
const transactionMock = vi.fn();
const scopedMock = vi.fn();

vi.mock('@/lib/db', () => ({
  query: queryMock,
  transaction: transactionMock,
  scopedTransaction: scopedMock,
  mapSingleRow: (result: { rows: unknown[] }) => result.rows[0] ?? null,
}));

const {
  createMealPlan,
  findLatestMealPlanByUserAndTenant,
  findMealPlanByIdForUserAndTenant,
  replaceMealPlanForAdaptiveProposal,
  updateMealPlanScheduleForUserAndTenant,
  attachRecipeToMealPlanSlot,
  MealPlanRepositoryError,
} = await import('./mealPlanRepository');

function structuredPlan(): StructuredMealPlan {
  const labels = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  return {
    period: 'week',
    dayCount: 7,
    days: Array.from({ length: 7 }, (_, index) => ({
      dayIndex: index + 1,
      label: labels[index],
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
    tenant_id: '00000000-0000-4000-8000-000000000001',
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

const tenantId = '00000000-0000-4000-8000-000000000001';
const tenantLockSql = 'select pg_advisory_xact_lock(hashtextextended($1, 0))';
const tenantLockKey = 'cocinacore:inventory-source:v1:' + tenantId;
const tenantLockMock = vi.fn();
function instrumentClient(client: { query: typeof queryMock }): { query: typeof queryMock } {
  return {
    query: ((sql: string, params: unknown[]): unknown => {
      if (sql === tenantLockSql && params[0] === tenantLockKey) return tenantLockMock(sql, params);
      return client.query(sql, params);
    }) as unknown as typeof queryMock,
  };
}

describe('mealPlanRepository', () => {
  beforeEach(() => {
    queryMock.mockReset();
    tenantLockMock.mockReset().mockResolvedValue({ rows: [] });
    transactionMock.mockReset();
    scopedMock
      .mockReset()
      .mockImplementation(
        async (_scope: unknown, callback: (client: { query: typeof queryMock }) => unknown) =>
          callback(instrumentClient({ query: queryMock }))
      );
  });

  it('inserts only the canonical structured plan as parameterized JSONB payload', async () => {
    const plan = structuredPlan();
    queryMock.mockResolvedValue({ rows: [mealPlanRow({ calendar_payload: plan })] });

    const created = await createMealPlan({
      tenantId: '00000000-0000-4000-8000-000000000001',
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

    expect(tenantLockMock).toHaveBeenCalledWith(tenantLockSql, [tenantLockKey]);
    expect(tenantLockMock.mock.invocationCallOrder[0]).toBeLessThan(
      queryMock.mock.invocationCallOrder[0]
    );
    expect(created).toEqual(mealPlanRow({ calendar_payload: plan }));
    expect(scopedMock).toHaveBeenCalledWith(
      { tenantId: '00000000-0000-4000-8000-000000000001', userId: 'user-1' },
      expect.any(Function)
    );
    expect(transactionMock).not.toHaveBeenCalled();
    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('insert into public.user_meal_plans');
    expect(sql).toContain('restrictions');
    expect(sql).toContain('inventory_snapshot');
    expect(sql).toContain('calendar_payload');
    expect(sql).toContain('ai_content');
    expect(params).toEqual([
      '00000000-0000-4000-8000-000000000001',
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
      findMealPlanByIdForUserAndTenant(
        'meal-plan-1',
        'user-1',
        '00000000-0000-4000-8000-000000000001'
      )
    ).resolves.toEqual(row);

    expect(scopedMock).toHaveBeenCalledWith(
      { tenantId: '00000000-0000-4000-8000-000000000001', userId: 'user-1' },
      expect.any(Function)
    );
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/where id = \$1 and tenant_id = \$2 and user_id = \$3/);
    expect(params).toEqual(['meal-plan-1', '00000000-0000-4000-8000-000000000001', 'user-1']);
  });

  it('adds confirmed schedule metadata without replacing the persisted plan JSON', async () => {
    const plan = structuredPlan();
    const schedule = {
      startDate: '2099-10-26',
      timeZone: 'America/Argentina/Buenos_Aires',
      confirmedAt: '2026-10-25T12:00:00.000Z',
      portionConfirmation: { peopleCount: 4, confirmedAt: '2026-10-25T12:00:00.000Z' },
    };
    const updatedRow = mealPlanRow({ calendar_payload: { ...plan, schedule } });
    queryMock.mockResolvedValue({ rows: [updatedRow] });

    const updated = await updateMealPlanScheduleForUserAndTenant({
      mealPlanId: 'meal-plan-1',
      userId: 'user-1',
      tenantId: '00000000-0000-4000-8000-000000000001',
      schedule,
      expectedUpdatedAt: updatedRow.updated_at,
      expectedCalendarPayload: plan,
      expectedPeopleCount: 4,
      expectedPeriod: 'week',
    });

    expect(updated).toEqual(updatedRow);
    expect(updated?.calendar_payload).toMatchObject({ ...plan, schedule });
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("jsonb_set(calendar_payload, '{schedule}', $1::jsonb, true)");
    expect(sql).toMatch(/where id = \$2 and tenant_id = \$3 and user_id = \$4/);
    expect(params).toEqual([
      JSON.stringify(schedule),
      'meal-plan-1',
      tenantId,
      'user-1',
      updatedRow.updated_at,
      JSON.stringify(plan),
      4,
      'week',
    ]);
    expect(sql).toContain('and updated_at = $5::timestamptz and calendar_payload = $6::jsonb');
    expect(sql).toContain('and people_count = $7 and period = $8');
    expect(tenantLockMock.mock.invocationCallOrder[0]).toBeLessThan(
      queryMock.mock.invocationCallOrder[0]
    );
  });

  it('throws a controlled error when an insert returns no row', async () => {
    queryMock.mockResolvedValue({ rows: [] });

    await expect(
      createMealPlan({
        tenantId: '00000000-0000-4000-8000-000000000001',
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

    await expect(
      findLatestMealPlanByUserAndTenant('user-1', '00000000-0000-4000-8000-000000000001')
    ).resolves.toEqual(row);

    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/where tenant_id = \$1 and user_id = \$2/);
    expect(sql).toMatch(/order by created_at desc, id desc/);
    expect(sql).toMatch(/limit 1/);
    expect(params).toEqual(['00000000-0000-4000-8000-000000000001', 'user-1']);
  });

  function adaptiveInput(plan = structuredPlan()) {
    return {
      mealPlanId: 'meal-plan-1',
      userId: 'user-1',
      tenantId: '00000000-0000-4000-8000-000000000001',
      expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
      expectedCalendarPayload: plan,
      structuredPlan: plan,
    };
  }

  const profile = {
    user_id: 'user-1',
    tenant_id: '00000000-0000-4000-8000-000000000001',
    allergies: [],
  };

  function mockAdaptiveReads(
    current = mealPlanRow(),
    currentProfile: unknown = profile,
    terms: unknown[] = []
  ) {
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [current] })
      .mockResolvedValueOnce({ rows: currentProfile ? [currentProfile] : [] })
      .mockResolvedValueOnce({ rows: terms });
  }

  it('locks and re-reads profile and exact plan revision before an atomic adaptive replacement', async () => {
    const plan = structuredPlan();
    const updatedRow = mealPlanRow({
      calendar_payload: plan,
      updated_at: '2026-01-01T00:01:00.000Z',
    });
    mockAdaptiveReads();
    queryMock.mockResolvedValueOnce({ rows: [updatedRow] });
    await expect(replaceMealPlanForAdaptiveProposal(adaptiveInput(plan))).resolves.toEqual(
      updatedRow
    );
    expect(scopedMock).toHaveBeenCalledWith(
      { tenantId: '00000000-0000-4000-8000-000000000001', userId: 'user-1' },
      expect.any(Function),
      { isolationLevel: 'read committed' }
    );
    expect(tenantLockMock.mock.invocationCallOrder[0]).toBeLessThan(
      queryMock.mock.invocationCallOrder[0]
    );
    expect(queryMock).toHaveBeenCalledTimes(5);
    expect(queryMock.mock.calls[0]).toEqual([
      'select pg_advisory_xact_lock(hashtextextended($1, 0))',
      ['culinary-profile:00000000-0000-4000-8000-000000000001:user-1'],
    ]);
    const [readSql, readParams] = queryMock.mock.calls[1] as [string, unknown[]];
    expect(readSql).toContain('for update');
    expect(readSql).toContain('and updated_at = $4::timestamptz and calendar_payload = $5::jsonb');
    expect(readParams).toEqual([
      'meal-plan-1',
      '00000000-0000-4000-8000-000000000001',
      'user-1',
      '2026-01-01T00:00:00.000Z',
      JSON.stringify(plan),
    ]);
    expect(queryMock.mock.calls[2]?.[0]).toContain('public.user_culinary_profiles');
    expect(queryMock.mock.calls[3]?.[0]).toContain('public.user_culinary_profile_terms');
    const [sql, params] = queryMock.mock.calls[4] as [string, unknown[]];
    expect(sql).toContain('and updated_at = $6::timestamptz');
    expect(sql).toContain('and calendar_payload = $7::jsonb');
    expect(sql).toContain('tenant_id = $4 and user_id = $5');
    expect(params).toEqual([
      JSON.stringify(plan),
      expectedStoredContent(plan),
      'meal-plan-1',
      '00000000-0000-4000-8000-000000000001',
      'user-1',
      '2026-01-01T00:00:00.000Z',
      JSON.stringify(plan),
    ]);
  });

  it('rejects restrictions observed after acquiring the shared profile lock', async () => {
    mockAdaptiveReads(mealPlanRow(), { ...profile, allergies: ['Arroz'] });
    await expect(replaceMealPlanForAdaptiveProposal(adaptiveInput())).resolves.toBeNull();
    expect(queryMock).toHaveBeenCalledTimes(4);
  });

  it('enforces persisted plan restrictions even when the profile is absent', async () => {
    mockAdaptiveReads(mealPlanRow({ restrictions: ['Arroz'] }), null);
    await expect(replaceMealPlanForAdaptiveProposal(adaptiveInput())).resolves.toBeNull();
    expect(queryMock).toHaveBeenCalledTimes(4);
  });

  it('does not truncate persisted avoid terms to the prompt context limit', async () => {
    const terms = Array.from({ length: 12 }, (_, index) => ({
      user_id: 'user-1',
      preference_type: 'avoid',
      term_label: `Ingrediente ${index}`,
    }));
    terms.push({ user_id: 'user-1', preference_type: 'avoid', term_label: 'Arroz' });
    mockAdaptiveReads(mealPlanRow(), profile, terms);
    await expect(replaceMealPlanForAdaptiveProposal(adaptiveInput())).resolves.toBeNull();
    expect(queryMock).toHaveBeenCalledTimes(4);
  });

  it.each([
    ['foreign profile', { ...profile, tenant_id: 'other-tenant' }, []],
    ['malformed allergies', { ...profile, allergies: null }, []],
    [
      'terms without profile',
      null,
      [{ user_id: 'user-1', preference_type: 'avoid', term_label: 'Arroz' }],
    ],
    [
      'foreign term',
      profile,
      [{ user_id: 'other-user', preference_type: 'avoid', term_label: 'Arroz' }],
    ],
  ])('fails closed on %s', async (_label, currentProfile, terms) => {
    mockAdaptiveReads(mealPlanRow(), currentProfile, terms as unknown[]);
    await expect(replaceMealPlanForAdaptiveProposal(adaptiveInput())).resolves.toBeNull();
    expect(queryMock).toHaveBeenCalledTimes(4);
  });

  it('does not write after a stale plan revision', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    await expect(replaceMealPlanForAdaptiveProposal(adaptiveInput())).resolves.toBeNull();
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it('does not read or write after failure to acquire the profile lock', async () => {
    queryMock.mockRejectedValueOnce(new Error('lock failed'));
    await expect(replaceMealPlanForAdaptiveProposal(adaptiveInput())).rejects.toThrow(
      'lock failed'
    );
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('attaches an exact recipe version only after confirmation and an unchanged snapshot', async () => {
    const plan = structuredPlan();
    const scheduledPlan = {
      ...plan,
      schedule: {
        startDate: '2026-10-28',
        timeZone: 'America/Caracas',
        confirmedAt: '2026-10-27T12:00:00.000Z',
        portionConfirmation: { peopleCount: 4, confirmedAt: '2026-10-27T12:00:00.000Z' },
      },
    };
    const current = mealPlanRow({ calendar_payload: scheduledPlan });
    const updated = mealPlanRow({
      calendar_payload: {
        ...scheduledPlan,
        days: scheduledPlan.days.map((day) =>
          day.dayIndex === 1
            ? {
                ...day,
                meals: day.meals.map((meal) =>
                  meal.mealType === 'lunch'
                    ? { ...meal, recipeRef: { recipeId: 'recipe-1', versionId: 'version-1' } }
                    : meal
                ),
              }
            : day
        ),
      },
    });
    const client = { query: vi.fn() };
    scopedMock.mockImplementation(
      async (_scope: unknown, callback: (value: typeof client) => unknown) =>
        callback(instrumentClient(client))
    );
    client.query
      .mockResolvedValueOnce({ rows: [current] })
      .mockResolvedValueOnce({ rows: [{ id: 'recipe-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'version-1' }] })
      .mockResolvedValueOnce({ rows: [{ matches: true }] })
      .mockResolvedValueOnce({ rows: [updated] });

    await expect(
      attachRecipeToMealPlanSlot({
        mealPlanId: 'meal-plan-1',
        userId: 'user-1',
        tenantId: '00000000-0000-4000-8000-000000000001',
        dayIndex: 1,
        mealType: 'lunch',
        recipeId: 'recipe-1',
        versionId: 'version-1',
        expectedUpdatedAt: current.updated_at,
        expectedCalendarPayload: current.calendar_payload,
      })
    ).resolves.toMatchObject({ status: 'applied', recipeId: 'recipe-1', versionId: 'version-1' });
    expect(tenantLockMock.mock.invocationCallOrder[0]).toBeLessThan(
      client.query.mock.invocationCallOrder[0]
    );
    expect(client.query).toHaveBeenCalledTimes(5);
    expect(client.query.mock.calls[0][1]).toEqual([
      'meal-plan-1',
      '00000000-0000-4000-8000-000000000001',
      'user-1',
    ]);
    expect(client.query.mock.calls[1][1]).toEqual([
      'recipe-1',
      '00000000-0000-4000-8000-000000000001',
      'user-1',
    ]);
    expect(client.query.mock.calls[2][1]).toEqual([
      'version-1',
      'recipe-1',
      '00000000-0000-4000-8000-000000000001',
      'user-1',
    ]);
    expect(client.query.mock.calls[3][1]).toEqual([
      'meal-plan-1',
      '00000000-0000-4000-8000-000000000001',
      'user-1',
      current.updated_at,
      JSON.stringify(current.calendar_payload),
    ]);
  });

  it('returns a conflict and does not update when the plan snapshot is stale', async () => {
    const current = mealPlanRow({
      calendar_payload: {
        ...structuredPlan(),
        schedule: {
          startDate: '2026-10-28',
          timeZone: 'America/Caracas',
          confirmedAt: '2026-10-27T12:00:00.000Z',
          portionConfirmation: { peopleCount: 4, confirmedAt: '2026-10-27T12:00:00.000Z' },
        },
      },
    });
    const client = { query: vi.fn() };
    scopedMock.mockImplementation(
      async (_scope: unknown, callback: (value: typeof client) => unknown) =>
        callback(instrumentClient(client))
    );
    client.query
      .mockResolvedValueOnce({ rows: [current] })
      .mockResolvedValueOnce({ rows: [{ id: 'recipe-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'version-1' }] })
      .mockResolvedValueOnce({ rows: [{ matches: false }] });

    await expect(
      attachRecipeToMealPlanSlot({
        mealPlanId: 'meal-plan-1',
        userId: 'user-1',
        tenantId: '00000000-0000-4000-8000-000000000001',
        dayIndex: 1,
        mealType: 'lunch',
        recipeId: 'recipe-1',
        versionId: 'version-1',
        expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
        expectedCalendarPayload: structuredPlan(),
      })
    ).resolves.toEqual({ status: 'conflict' });
    expect(client.query).toHaveBeenCalledTimes(4);
  });
  it.each(['create', 'attach', 'adaptive', 'schedule'] as const)(
    'does not access business rows when tenant lock fails for %s',
    async (writer) => {
      tenantLockMock.mockRejectedValueOnce(new Error('tenant lock failed'));
      const common = { tenantId, userId: 'user-1' };
      const input = adaptiveInput();
      const writers = {
        create: () =>
          createMealPlan({
            ...common,
            peopleCount: 4,
            period: 'week',
            mode: 'inventory_to_menu',
            baseCuisine: 'Latinoamericana',
            fusionCuisines: [],
            fusionIntensity: 'media',
            restrictions: [],
            inventorySnapshot: { inventoryLines: [] },
            structuredPlan: structuredPlan(),
          }),
        attach: () =>
          attachRecipeToMealPlanSlot({
            ...input,
            dayIndex: 1,
            mealType: 'lunch',
            recipeId: 'recipe-1',
            versionId: 'version-1',
          }),
        adaptive: () => replaceMealPlanForAdaptiveProposal(input),
        schedule: () =>
          updateMealPlanScheduleForUserAndTenant({
            ...input,
            expectedPeopleCount: 4,
            expectedPeriod: 'week',
            schedule: {
              startDate: '2099-10-26',
              timeZone: 'UTC',
              confirmedAt: '2026-10-25T12:00:00.000Z',
              portionConfirmation: { peopleCount: 4, confirmedAt: '2026-10-25T12:00:00.000Z' },
            },
          }),
      };
      await expect(writers[writer]()).rejects.toThrow('tenant lock failed');
      expect(tenantLockMock).toHaveBeenCalledOnce();
      expect(queryMock).not.toHaveBeenCalled();
    }
  );

  it.each(['stale', 'wrong people', 'past', 'malformed timestamp'] as const)(
    'rejects schedule %s without applying a stale confirmation',
    async (kind) => {
      const plan = structuredPlan();
      const input = {
        ...adaptiveInput(plan),
        expectedPeopleCount: 4,
        expectedPeriod: 'week' as const,
        schedule: {
          startDate: '2099-10-26',
          timeZone: 'UTC',
          confirmedAt: '2026-10-25T12:00:00.000Z',
          portionConfirmation: { peopleCount: 4, confirmedAt: '2026-10-25T12:00:00.000Z' },
        },
      };
      if (kind === 'wrong people') input.schedule.portionConfirmation.peopleCount = 2;
      if (kind === 'past') input.schedule.startDate = '2000-01-01';
      if (kind === 'malformed timestamp') input.expectedUpdatedAt = 'not a timestamp';
      queryMock.mockResolvedValue({ rows: [] });
      await expect(updateMealPlanScheduleForUserAndTenant(input)).resolves.toBeNull();
      expect(queryMock).toHaveBeenCalledTimes(kind === 'stale' ? 1 : 0);
    }
  );
});

it('executes scoped plan read on the supplied transaction client', async () => {
  const client = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'plan' }] }) };
  scopedMock.mockImplementation(
    async (
      _scope: unknown,
      callback: (connection: typeof client) => Promise<unknown>
    ): Promise<unknown> => callback(instrumentClient(client))
  );
  const scope = { tenantId: '00000000-0000-4000-8000-000000000001', userId: 'user-1' };
  await expect(
    findMealPlanByIdForUserAndTenant('plan', scope.userId, scope.tenantId, scope)
  ).resolves.toEqual({ id: 'plan' });
  expect(scopedMock).toHaveBeenCalledWith(scope, expect.any(Function));
  expect(client.query).toHaveBeenCalledWith(
    expect.stringContaining('tenant_id = $2 and user_id = $3'),
    ['plan', '00000000-0000-4000-8000-000000000001', 'user-1']
  );
  await expect(
    findMealPlanByIdForUserAndTenant('plan', 'other', scope.tenantId, scope)
  ).rejects.toThrow('scope mismatch');
});
