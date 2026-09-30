import type {
  MealConsumptionPayload,
  MealConsumptionRecord,
} from '@/lib/meal-planner/consumption';

export function shouldApplyConsumptionResponse(input: {
  componentActive: boolean;
  requestVersion: number;
  latestRequestVersion: number;
  activePlanId: string | null;
  mealPlanId: string;
}): boolean {
  return (
    input.componentActive &&
    input.requestVersion === input.latestRequestVersion &&
    input.activePlanId === input.mealPlanId
  );
}

export function withConsumptionRecord(
  current: MealConsumptionPayload,
  key: string,
  record: MealConsumptionRecord
): MealConsumptionPayload {
  return { ...current, [key]: record };
}
