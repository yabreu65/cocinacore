import type { FusionIntensity, MealPlanMode } from '@/lib/db/types';
import type { MealPlanPeriod } from './prompt';
import type { StructuredMealPlan } from './structured-plan';

export interface MealPlanPublicResponse {
  id?: string;
  createdAt?: string;
  plan: StructuredMealPlan | null;
  content: string | null;
  peopleCount?: number;
  period?: MealPlanPeriod;
  mode?: MealPlanMode;
  baseCuisine?: string;
  fusionCuisines?: string[];
  fusionIntensity?: FusionIntensity;
  restrictions?: string[];
}

export interface MealPlannerRehydratedState {
  plan: StructuredMealPlan | null;
  peopleCount: number;
  period: MealPlanPeriod;
  baseCuisine: string;
  restrictions: string;
}

export interface MealPlannerRehydrationGuard {
  active: boolean;
  generationStarted: boolean;
  userEdited: boolean;
}

export interface MealPlannerSuggestionsGuard {
  componentActive: boolean;
  requestVersion: number;
  latestRequestVersion: number;
  activePlanId: string | null;
  mealPlanId: string;
}

const DEFAULT_STATE: Omit<MealPlannerRehydratedState, 'plan'> = {
  peopleCount: 4,
  period: 'week',
  baseCuisine: 'Latinoamericana',
  restrictions: '',
};

export function shouldApplyMealPlannerRehydration({
  active,
  generationStarted,
  userEdited,
}: MealPlannerRehydrationGuard): boolean {
  return active && !generationStarted && !userEdited;
}

export function shouldApplyMealPlannerSuggestions({
  componentActive,
  requestVersion,
  latestRequestVersion,
  activePlanId,
  mealPlanId,
}: MealPlannerSuggestionsGuard): boolean {
  return (
    componentActive &&
    requestVersion === latestRequestVersion &&
    activePlanId === mealPlanId
  );
}

function normalizeRestrictionList(values: string[] | undefined): string {
  if (!values) return '';

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const restriction = value.trim().replace(/\s+/g, ' ');
    const key = restriction.toLocaleLowerCase();
    if (!restriction || seen.has(key)) continue;
    seen.add(key);
    normalized.push(restriction);
  }

  return normalized.join(', ');
}

/** Converts the safe GET payload into the page's editable state without generating a new plan. */
export function rehydrateMealPlanner(
  response: MealPlanPublicResponse
): MealPlannerRehydratedState {
  if (!response.plan) return { plan: null, ...DEFAULT_STATE };

  return {
    plan: response.plan,
    peopleCount:
      typeof response.peopleCount === 'number' &&
      Number.isInteger(response.peopleCount) &&
      response.peopleCount >= 1 &&
      response.peopleCount <= 100
        ? response.peopleCount
        : DEFAULT_STATE.peopleCount,
    period: response.period ?? DEFAULT_STATE.period,
    baseCuisine: response.baseCuisine?.trim() || DEFAULT_STATE.baseCuisine,
    restrictions: normalizeRestrictionList(response.restrictions),
  };
}
