import { describe, expect, it } from 'vitest';
import {
  buildMealPlanFormatInstructions,
  getMealPlanDayCount,
  type MealPlanPeriod,
} from './prompt';

const periods: Array<{ period: MealPlanPeriod; dayCount: number }> = [
  { period: 'week', dayCount: 7 },
  { period: 'fortnight', dayCount: 14 },
  { period: 'month', dayCount: 30 },
];

describe('meal planner prompt helpers', () => {
  it.each(periods)('maps $period to $dayCount days', ({ period, dayCount }) => {
    expect(getMealPlanDayCount(period)).toBe(dayCount);
  });

  it('uses named Monday-Sunday headers for a week', () => {
    const format = buildMealPlanFormatInstructions('week');

    expect(format).toContain('exactamente 7 días completos');
    expect(format).toContain('Lunes');
    expect(format).toContain('Domingo');
    expect(format).not.toContain('Día 1');
  });

  it.each([
    { period: 'fortnight' as const, dayCount: 14 },
    { period: 'month' as const, dayCount: 30 },
  ])('uses deterministic day headers for $period', ({ period, dayCount }) => {
    const format = buildMealPlanFormatInstructions(period);

    expect(format).toContain(`exactamente ${dayCount} días completos`);
    expect(format).toContain('Día 1');
    expect(format).toContain(`Día ${dayCount}`);
    expect(format).toContain('Desayuno: ...');
    expect(format).toContain('Almuerzo: ...');
    expect(format).toContain('Cena: ...');
    expect(format).not.toContain('SIEMPRE los 7 días completos');
    expect(format).not.toContain('Lunes');
    expect(format).not.toContain('Lunes a Domingo');
  });
});
