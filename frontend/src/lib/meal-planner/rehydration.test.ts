import { describe, expect, it } from 'vitest';
import {
  rehydrateMealPlanner,
  shouldApplyMealPlannerRehydration,
  shouldApplyMealPlannerSuggestions,
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

describe('shouldApplyMealPlannerSuggestions', () => {
  const currentRequest = {
    componentActive: true,
    requestVersion: 2,
    latestRequestVersion: 2,
    activePlanId: 'new-plan',
    mealPlanId: 'new-plan',
  };

  it('allows the active plan suggestions even after generation has started', () => {
    expect(shouldApplyMealPlannerSuggestions(currentRequest)).toBe(true);
  });

  it('rejects stale requests and responses for a different active plan', () => {
    expect(shouldApplyMealPlannerSuggestions({
      ...currentRequest,
      requestVersion: 1,
    })).toBe(false);
    expect(shouldApplyMealPlannerSuggestions({
      ...currentRequest,
      activePlanId: 'another-plan',
    })).toBe(false);
  });

  it('rejects responses after the component becomes inactive', () => {
    expect(shouldApplyMealPlannerSuggestions({
      ...currentRequest,
      componentActive: false,
    })).toBe(false);
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
