import { describe, expect, it } from 'vitest';
import type { MealConsumptionPayload } from '@/lib/meal-planner/consumption';
import { shouldApplyConsumptionResponse, withConsumptionRecord } from './consumptionState';

const record = {
  consumedAt: '2026-09-30T22:00:00.000Z',
  dayIndex: 1,
  mealType: 'breakfast' as const,
  mealTitle: 'Avena',
  decrements: [],
  skipped: [],
};

describe('Meal Planner consumption UI state', () => {
  it('accepts only the latest response for the active plan', () => {
    expect(
      shouldApplyConsumptionResponse({
        componentActive: true,
        requestVersion: 3,
        latestRequestVersion: 3,
        activePlanId: 'plan-1',
        mealPlanId: 'plan-1',
      })
    ).toBe(true);
    expect(
      shouldApplyConsumptionResponse({
        componentActive: true,
        requestVersion: 2,
        latestRequestVersion: 3,
        activePlanId: 'plan-1',
        mealPlanId: 'plan-1',
      })
    ).toBe(false);
  });

  it('rejects responses for an old plan or an unmounted component', () => {
    expect(
      shouldApplyConsumptionResponse({
        componentActive: true,
        requestVersion: 3,
        latestRequestVersion: 3,
        activePlanId: 'plan-2',
        mealPlanId: 'plan-1',
      })
    ).toBe(false);
    expect(
      shouldApplyConsumptionResponse({
        componentActive: false,
        requestVersion: 3,
        latestRequestVersion: 3,
        activePlanId: 'plan-1',
        mealPlanId: 'plan-1',
      })
    ).toBe(false);
  });

  it('merges one cooked meal without mutating other meal records', () => {
    const previous: MealConsumptionPayload = {
      '2:lunch': { ...record, dayIndex: 2, mealType: 'lunch' },
    };
    const next = withConsumptionRecord(previous, '1:breakfast', record);
    expect(next['1:breakfast']).toEqual(record);
    expect(next['2:lunch']).toEqual(previous['2:lunch']);
    expect(previous['1:breakfast']).toBeUndefined();
  });
});
