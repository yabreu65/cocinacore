export type MealType = 'Desayuno' | 'Almuerzo' | 'Cena';

export type PlannerMealCardState = {
  name: string;
  time: string;
  difficulty: 'Fácil' | 'Media' | 'Alta';
  badge: string;
  fusionTag: string;
  missing: number;
  aiScore: number;
};

export type PlannerDayState = {
  day: string;
  meals: Record<MealType, PlannerMealCardState>;
};

const MEALS: MealType[] = ['Desayuno', 'Almuerzo', 'Cena'];

export function buildMealKey(day: string, mealType: MealType): string {
  return `${day}::${mealType}`;
}

function cloneDays<T extends PlannerDayState>(days: T[]): T[] {
  return days.map((entry) => ({ ...entry, meals: { ...entry.meals } }));
}

export function moveMealAcrossDayState<T extends PlannerDayState>(
  days: T[],
  dayIndex: number,
  mealType: MealType,
  direction: -1 | 1,
  lockedMeals: string[],
): T[] {
  if (days.length === 0) return days;
  const sourceDay = days[dayIndex];
  if (!sourceDay) return days;

  const targetIndex = dayIndex + direction;
  if (targetIndex < 0 || targetIndex >= days.length) return days;
  const targetDay = days[targetIndex];
  if (!targetDay) return days;

  const sourceKey = buildMealKey(sourceDay.day, mealType);
  const targetKey = buildMealKey(targetDay.day, mealType);
  if (lockedMeals.includes(sourceKey) || lockedMeals.includes(targetKey)) return days;

  const copy = cloneDays(days);
  const source = copy[dayIndex].meals[mealType];
  copy[dayIndex].meals[mealType] = copy[targetIndex].meals[mealType];
  copy[targetIndex].meals[mealType] = source;
  return copy;
}

export function moveMealAcrossSlotState<T extends PlannerDayState>(
  days: T[],
  dayIndex: number,
  mealType: MealType,
  direction: -1 | 1,
  lockedMeals: string[],
): T[] {
  const day = days[dayIndex];
  if (!day) return days;
  const sourceIdx = MEALS.indexOf(mealType);
  const targetIdx = sourceIdx + direction;
  if (targetIdx < 0 || targetIdx >= MEALS.length) return days;
  const targetMeal = MEALS[targetIdx];

  const sourceKey = buildMealKey(day.day, mealType);
  const targetKey = buildMealKey(day.day, targetMeal);
  if (lockedMeals.includes(sourceKey) || lockedMeals.includes(targetKey)) return days;

  const copy = cloneDays(days);
  const source = copy[dayIndex].meals[mealType];
  copy[dayIndex].meals[mealType] = copy[dayIndex].meals[targetMeal];
  copy[dayIndex].meals[targetMeal] = source;
  return copy;
}

export type OptimizationMode =
  | 'reduce_waste'
  | 'optimize_cost'
  | 'prioritize_fresh'
  | 'reduce_missing'
  | 'reuse_proteins'
  | 'balance_ingredients';

function swapMeal(
  days: PlannerDayState[],
  fromDay: number,
  toDay: number,
  mealType: MealType,
  lockedMeals: string[],
): void {
  if (!days[fromDay] || !days[toDay]) return;
  const sourceKey = buildMealKey(days[fromDay].day, mealType);
  const targetKey = buildMealKey(days[toDay].day, mealType);
  if (lockedMeals.includes(sourceKey) || lockedMeals.includes(targetKey)) return;
  const temp = days[fromDay].meals[mealType];
  days[fromDay].meals[mealType] = days[toDay].meals[mealType];
  days[toDay].meals[mealType] = temp;
}

export function applyOptimizationState<T extends PlannerDayState>(
  days: T[],
  mode: OptimizationMode,
  lockedMeals: string[],
): T[] {
  if (days.length < 2) return days;
  const copy = cloneDays(days);

  switch (mode) {
    case 'optimize_cost':
    case 'reduce_missing':
      swapMeal(copy, copy.length - 1, 0, 'Almuerzo', lockedMeals);
      break;
    case 'prioritize_fresh':
      swapMeal(copy, 1, 0, 'Cena', lockedMeals);
      break;
    case 'reuse_proteins':
      swapMeal(copy, 2, 1, 'Almuerzo', lockedMeals);
      break;
    case 'balance_ingredients':
      swapMeal(copy, 0, 1, 'Desayuno', lockedMeals);
      break;
    case 'reduce_waste':
    default:
      swapMeal(copy, copy.length - 1, 0, 'Cena', lockedMeals);
      break;
  }

  return copy;
}
