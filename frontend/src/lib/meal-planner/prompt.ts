export type MealPlanPeriod = 'week' | 'fortnight' | 'month';

export const MEAL_PLAN_PERIOD_DAY_COUNTS: Readonly<Record<MealPlanPeriod, 7 | 14 | 30>> = {
  week: 7,
  fortnight: 14,
  month: 30,
};

const WEEK_DAY_HEADERS = [
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
  'Domingo',
] as const;

export function getMealPlanDayCount(period: MealPlanPeriod): 7 | 14 | 30 {
  return MEAL_PLAN_PERIOD_DAY_COUNTS[period];
}

export function getMealPlanPeriodLabel(period: MealPlanPeriod): string {
  return `${getMealPlanDayCount(period)} días`;
}

export function getMealPlanCanonicalDayLabel(period: MealPlanPeriod, dayIndex: number): string {
  if (!Number.isInteger(dayIndex) || dayIndex < 1 || dayIndex > getMealPlanDayCount(period)) {
    throw new RangeError('dayIndex must be within the requested meal plan period');
  }

  return period === 'week' ? WEEK_DAY_HEADERS[dayIndex - 1] : `Día ${dayIndex}`;
}

function buildDayMealFormat(dayHeader: string): string {
  return `${dayHeader}
Desayuno: ...
Almuerzo: ...
Cena: ...`;
}

export function buildMealPlanFormatInstructions(period: MealPlanPeriod): string {
  const dayCount = getMealPlanDayCount(period);
  const dayHeaders =
    period === 'week'
      ? WEEK_DAY_HEADERS
      : Array.from({ length: dayCount }, (_, index) => `Día ${index + 1}`);

  return `Debes devolver exactamente ${dayCount} días completos.
No saltees días.
Formato OBLIGATORIO:
${dayHeaders.map(buildDayMealFormat).join('\n\n')}`;
}
