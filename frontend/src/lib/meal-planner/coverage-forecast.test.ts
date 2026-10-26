import { describe, expect, it } from 'vitest';
import { buildMealPlanCoverageForecast } from './coverage-forecast';
import { getLocalDateInTimeZone } from './structured-plan';
import type { StructuredMealPlan, StructuredMealPlanDay } from './structured-plan';

const schedule = {
  startDate: '2026-10-25',
  timeZone: 'UTC',
  confirmedAt: '2026-10-24T12:00:00.000Z',
  portionConfirmation: {
    peopleCount: 2,
    confirmedAt: '2026-10-24T12:00:00.000Z',
  },
};

const scheduleWithoutPortionConfirmation = {
  startDate: '2026-10-25',
  timeZone: 'UTC',
  confirmedAt: '2026-10-24T12:00:00.000Z',
};

function day(
  dayIndex: number,
  ingredients: Array<{ name: string; quantity: number | null; unit: string | null }> = []
): StructuredMealPlanDay {
  return {
    dayIndex,
    label: `Día ${dayIndex}`,
    meals: [
      {
        mealType: 'lunch',
        title: `Comida ${dayIndex}`,
        prepMinutes: 20,
        description: null,
        ingredients,
      },
    ],
  };
}

function plan(
  days: StructuredMealPlanDay[],
  overrides: Partial<StructuredMealPlan> = {}
): StructuredMealPlan {
  return {
    period: days.length > 7 ? 'fortnight' : 'week',
    dayCount: days.length,
    days,
    schedule,
    ...overrides,
  };
}

const rice = (quantity: number | null = 500, unit: string | null = 'g') => ({
  name: 'Arroz',
  quantity,
  unit,
});

function completeWeek(existingDays: StructuredMealPlanDay[]): StructuredMealPlan {
  const byIndex = new Map(existingDays.map((entry) => [entry.dayIndex, entry]));
  return plan(
    Array.from({ length: 7 }, (_, index) => byIndex.get(index + 1) ?? day(index + 1, [rice(0)]))
  );
}

const now = new Date('2026-10-25T12:00:00.000Z');

describe('buildMealPlanCoverageForecast', () => {
  it('keeps legacy plans unknown until an explicit schedule is confirmed', () => {
    const result = buildMealPlanCoverageForecast({
      plan: plan([day(1, [rice()])], { schedule: undefined }),
      inventoryItems: [{ ingredient_name: 'Arroz', quantity: '1 kg', unit: null }],
      consumptionPayload: {},
      horizonDays: 7,
      now,
    });

    expect(result).toMatchObject({
      status: 'unknown',
      reason: 'schedule_not_confirmed',
      items: [],
    });
  });

  it('returns unknown rather than sufficient when ingredient portions lack explicit confirmation', () => {
    const result = buildMealPlanCoverageForecast({
      plan: plan(
        Array.from({ length: 7 }, (_, index) => day(index + 1, [rice(100)])),
        { schedule: scheduleWithoutPortionConfirmation }
      ),
      inventoryItems: [{ ingredient_name: 'Arroz', quantity: '100 kg', unit: null }],
      consumptionPayload: {},
      horizonDays: 7,
      now,
    });

    expect(result).toMatchObject({
      status: 'unknown',
      reason: 'portion_basis_not_confirmed',
      items: [],
      summary: { sufficient: 0 },
    });
  });

  it('uses only meals inside the selected 7- or 14-day calendar horizon', () => {
    const scheduledPlan = plan(
      Array.from({ length: 14 }, (_, index) =>
        day(index + 1, [rice(index === 0 || index === 7 ? 500 : 0)])
      )
    );
    const inventoryItems = [{ ingredient_name: 'Arroz', quantity: '750 g', unit: null }];

    const sevenDays = buildMealPlanCoverageForecast({
      plan: scheduledPlan,
      inventoryItems,
      consumptionPayload: {},
      horizonDays: 7,
      now,
    });
    const fourteenDays = buildMealPlanCoverageForecast({
      plan: scheduledPlan,
      inventoryItems,
      consumptionPayload: {},
      horizonDays: 14,
      now,
    });

    expect(sevenDays.items[0]).toMatchObject({ requiredTotalQuantity: 500, status: 'sufficient' });
    expect(fourteenDays.items[0]).toMatchObject({
      requiredTotalQuantity: 1000,
      status: 'partial',
      missingQuantity: 250,
    });
  });

  it('returns unknown when the explicit plan does not cover the entire selected horizon', () => {
    const result = buildMealPlanCoverageForecast({
      plan: plan(Array.from({ length: 7 }, (_, index) => day(index + 1, [rice()]))),
      inventoryItems: [{ ingredient_name: 'Arroz', quantity: '10 kg', unit: null }],
      consumptionPayload: {},
      horizonDays: 14,
      now,
    });

    expect(result).toMatchObject({
      status: 'unknown',
      reason: 'plan_does_not_cover_horizon',
      items: [],
    });
  });

  it('starts the horizon on the selected date when the confirmed plan begins in the future', () => {
    const result = buildMealPlanCoverageForecast({
      plan: plan(
        Array.from({ length: 7 }, (_, index) => day(index + 1, [rice()])),
        { schedule: { ...schedule, startDate: '2026-10-27' } }
      ),
      inventoryItems: [{ ingredient_name: 'Arroz', quantity: '10 kg', unit: null }],
      consumptionPayload: {},
      horizonDays: 7,
      now,
    });

    expect(result).toMatchObject({
      status: 'ready',
      fromDate: '2026-10-27',
      throughDate: '2026-11-02',
      scheduledMealCount: 7,
    });
  });

  it('returns unknown for an invalid schedule confirmation timestamp', () => {
    const result = buildMealPlanCoverageForecast({
      plan: plan(
        Array.from({ length: 7 }, (_, index) => day(index + 1, [rice()])),
        {
          schedule: {
            ...schedule,
            confirmedAt: '2026-02-30T12:00:00.000Z',
          },
        }
      ),
      inventoryItems: [{ ingredient_name: 'Arroz', quantity: '10 kg', unit: null }],
      consumptionPayload: {},
      horizonDays: 7,
      now,
    });

    expect(result).toMatchObject({ status: 'unknown', reason: 'invalid_schedule', items: [] });
  });

  it('excludes meals with confirmed consumption to avoid reserving them twice', () => {
    const scheduledPlan = completeWeek([day(1, [rice()]), day(2, [rice()])]);
    const consumptionPayload = {
      '1:lunch': {
        consumedAt: '2026-10-25T11:00:00.000Z',
        dayIndex: 1,
        mealType: 'lunch',
        mealTitle: 'Comida 1',
        decrements: [],
        skipped: [],
      },
    };

    const result = buildMealPlanCoverageForecast({
      plan: scheduledPlan,
      inventoryItems: [{ ingredient_name: 'Arroz', quantity: '500 g', unit: null }],
      consumptionPayload,
      horizonDays: 7,
      now,
    });

    expect(result).toMatchObject({ status: 'ready', consumedMealCount: 1 });
    expect(result.items[0]).toMatchObject({ requiredTotalQuantity: 500, status: 'sufficient' });
  });

  it('does not apply prior-schedule consumption to a rescheduled future meal', () => {
    const result = buildMealPlanCoverageForecast({
      plan: {
        ...completeWeek([day(1, [rice()])]),
        schedule: {
          ...schedule,
          startDate: '2026-10-28',
          confirmedAt: '2026-10-25T12:00:00.000Z',
        },
      },
      inventoryItems: [],
      consumptionPayload: {
        '1:lunch': {
          consumedAt: '2026-10-25T11:00:00.000Z',
          dayIndex: 1,
          mealType: 'lunch',
          mealTitle: 'Comida 1',
          decrements: [],
          skipped: [],
        },
      },
      horizonDays: 7,
      now,
    });

    expect(result).toMatchObject({ status: 'ready', scheduledMealCount: 7, consumedMealCount: 0 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ requiredTotalQuantity: 500, status: 'unknown' });
  });

  it('preserves unknown when a required ingredient has no quantified inventory row', () => {
    const result = buildMealPlanCoverageForecast({
      plan: completeWeek([day(1, [rice()])]),
      inventoryItems: [],
      consumptionPayload: {},
      horizonDays: 7,
      now,
    });

    expect(result.status).toBe('ready');
    expect(result.items[0]).toMatchObject({
      status: 'unknown',
      availableQuantity: null,
      missingQuantity: null,
    });
  });

  it('converts comparable inventory units without changing the scheduled requirement', () => {
    const result = buildMealPlanCoverageForecast({
      plan: completeWeek([day(1, [rice(750, 'g')])]),
      inventoryItems: [{ ingredient_name: 'Arroz', quantity: '1', unit: 'kg' }],
      consumptionPayload: {},
      horizonDays: 7,
      now,
    });

    expect(result.items[0]).toMatchObject({
      requiredTotalQuantity: 750,
      requiredUnit: 'g',
      availableQuantity: 1000,
      availableUnit: 'g',
      missingQuantity: 0,
      status: 'sufficient',
    });
  });

  it('keeps incompatible inventory units unknown', () => {
    const result = buildMealPlanCoverageForecast({
      plan: completeWeek([day(1, [{ name: 'Leche', quantity: 1, unit: 'l' }])]),
      inventoryItems: [{ ingredient_name: 'Leche', quantity: '500 g', unit: null }],
      consumptionPayload: {},
      horizonDays: 7,
      now,
    });

    expect(result.items[0]).toMatchObject({
      requiredUnit: 'l',
      availableQuantity: null,
      missingQuantity: null,
      status: 'unknown',
    });
  });

  it('uses the explicit schedule timezone for calendar-day boundaries', () => {
    const instant = new Date('2026-10-26T03:00:00.000Z');

    expect(getLocalDateInTimeZone(instant, 'America/Argentina/Buenos_Aires')).toBe('2026-10-26');
    expect(getLocalDateInTimeZone(instant, 'America/Los_Angeles')).toBe('2026-10-25');
  });

  it('returns unknown with coherent future range dates when a consumption timestamp is invalid', () => {
    const result = buildMealPlanCoverageForecast({
      plan: {
        ...completeWeek([day(1, [rice()])]),
        schedule: { ...schedule, startDate: '2026-10-27' },
      },
      inventoryItems: [{ ingredient_name: 'Arroz', quantity: '10 kg', unit: null }],
      consumptionPayload: {
        '1:lunch': {
          consumedAt: '2026-02-30T12:00:00.000Z',
          dayIndex: 1,
          mealType: 'lunch',
          mealTitle: 'Comida 1',
          decrements: [],
          skipped: [],
        },
      },
      horizonDays: 7,
      now,
    });

    expect(result).toMatchObject({
      status: 'unknown',
      reason: 'invalid_consumption',
      fromDate: '2026-10-27',
      throughDate: '2026-11-02',
      items: [],
    });
  });

  it('returns unknown when consumption evidence is malformed', () => {
    const result = buildMealPlanCoverageForecast({
      plan: completeWeek([day(1, [rice()])]),
      inventoryItems: [{ ingredient_name: 'Arroz', quantity: '1 kg', unit: null }],
      consumptionPayload: { '1:lunch': { consumedAt: 'not-a-date' } },
      horizonDays: 7,
      now,
    });

    expect(result).toMatchObject({ status: 'unknown', reason: 'invalid_consumption', items: [] });
  });
});
