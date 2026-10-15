import { describe, expect, it } from 'vitest';
import { mapMealPlanLoadError } from './meal-plan-load-error';

describe('mapMealPlanLoadError', () => {
  it('explains that a saved plan must be regenerated when restrictions changed', () => {
    expect(mapMealPlanLoadError('MEAL_PLAN_RESTRICTIONS_CHANGED')).toBe(
      'Tus restricciones cambiaron desde que se creó este menú. Genera uno nuevo para respetarlas.'
    );
  });

  it('preserves generic error text and fallback behavior', () => {
    expect(mapMealPlanLoadError('No se pudo recuperar el menú guardado.')).toBe(
      'No se pudo recuperar el menú guardado.'
    );
    expect(mapMealPlanLoadError(null)).toBe('No se pudo cargar el menú guardado.');
  });

  it('maps only the exact stale-restrictions code', () => {
    expect(mapMealPlanLoadError('MEAL_PLAN_RESTRICTIONS_CHANGED: detail')).toBe(
      'MEAL_PLAN_RESTRICTIONS_CHANGED: detail'
    );
  });
});
