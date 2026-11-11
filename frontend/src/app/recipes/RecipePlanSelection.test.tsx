import { describe, expect, it } from 'vitest';
import { mealTypeInSpanish } from './RecipePlanSelection';

describe('UX5: clear menu selection language', () => {
  it('describes meal types in Spanish instead of exposing internal enums', () => {
    expect(mealTypeInSpanish('breakfast')).toBe('Desayuno');
    expect(mealTypeInSpanish('lunch')).toBe('Almuerzo');
    expect(mealTypeInSpanish('dinner')).toBe('Cena');
  });
});
