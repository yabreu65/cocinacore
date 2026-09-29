import { describe, expect, it } from 'vitest';
import {
  rehydrateMealPlanner,
  shouldApplyMealPlannerRehydration,
  type MealPlanPublicResponse,
} from './rehydration';
import type { StructuredMealPlan } from './structured-plan';

const plan: StructuredMealPlan = {
  period: 'week',
  dayCount: 7,
  days: Array.from({ length: 7 }, (_, index) => ({
    dayIndex: index + 1,
    label: index === 0 ? 'Lunes' : `Día ${index + 1}`,
    meals: [
      {
        mealType: 'breakfast',
        title: 'Avena',
        description: null,
        ingredients: [{ name: 'Avena', quantity: 1, unit: 'taza' }],
      },
      {
        mealType: 'lunch',
        title: 'Arroz',
        description: null,
        ingredients: [{ name: 'Arroz', quantity: null, unit: null }],
      },
      {
        mealType: 'dinner',
        title: 'Sopa',
        description: null,
        ingredients: [{ name: 'Calabaza', quantity: null, unit: null }],
      },
    ],
  })),
};

function response(overrides: Partial<MealPlanPublicResponse> = {}): MealPlanPublicResponse {
  return {
    plan,
    content: 'compatibility content',
    peopleCount: 2,
    period: 'fortnight',
    mode: 'balanced_ai',
    baseCuisine: 'Italiana',
    fusionCuisines: ['Japonesa'],
    fusionIntensity: 'alta',
    restrictions: ['Gluten', 'Lácteos'],
    ...overrides,
  };
}

describe('shouldApplyMealPlannerRehydration', () => {
  it('allows a pristine active form to apply the initial response', () => {
    expect(
      shouldApplyMealPlannerRehydration({
        active: true,
        generationStarted: false,
        userEdited: false,
      })
    ).toBe(true);
  });

  it('rejects the initial response after a user edit', () => {
    expect(
      shouldApplyMealPlannerRehydration({
        active: true,
        generationStarted: false,
        userEdited: true,
      })
    ).toBe(false);
  });

  it('rejects the initial response after generation starts', () => {
    expect(
      shouldApplyMealPlannerRehydration({
        active: true,
        generationStarted: true,
        userEdited: false,
      })
    ).toBe(false);
  });

  it('rejects the initial response after the component becomes inactive', () => {
    expect(
      shouldApplyMealPlannerRehydration({
        active: false,
        generationStarted: false,
        userEdited: false,
      })
    ).toBe(false);
  });
});

describe('rehydrateMealPlanner', () => {
  it('restores the persisted plan and editable settings without exposing fusion UI state', () => {
    expect(rehydrateMealPlanner(response())).toEqual({
      plan,
      peopleCount: 2,
      period: 'fortnight',
      baseCuisine: 'Italiana',
      restrictions: 'Gluten, Lácteos',
    });
  });

  it('uses safe page defaults when no persisted plan or legacy metadata exists', () => {
    expect(rehydrateMealPlanner({ plan: null, content: null })).toEqual({
      plan: null,
      peopleCount: 4,
      period: 'week',
      baseCuisine: 'Latinoamericana',
      restrictions: '',
    });
    expect(
      rehydrateMealPlanner(response({ peopleCount: 0, baseCuisine: ' ', restrictions: [' gluten ', 'GLUTEN'] }))
    ).toMatchObject({
      peopleCount: 4,
      baseCuisine: 'Latinoamericana',
      restrictions: 'gluten',
    });
  });
});
