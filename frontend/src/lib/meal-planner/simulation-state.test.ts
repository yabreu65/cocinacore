import { describe, expect, it } from 'vitest';
import {
  applyOptimizationState,
  buildMealKey,
  moveMealAcrossDayState,
  moveMealAcrossSlotState,
  type PlannerDayState,
} from './simulation-state';

const makeDay = (day: string, suffix: string): PlannerDayState => ({
  day,
  meals: {
    Desayuno: { name: `D-${suffix}`, time: '10', difficulty: 'Fácil', badge: '', fusionTag: '', missing: 0, aiScore: 90 },
    Almuerzo: { name: `A-${suffix}`, time: '20', difficulty: 'Media', badge: '', fusionTag: '', missing: 0, aiScore: 90 },
    Cena: { name: `C-${suffix}`, time: '30', difficulty: 'Alta', badge: '', fusionTag: '', missing: 0, aiScore: 90 },
  },
});

describe('simulation-state', () => {
  it('moves recipe across days when not locked', () => {
    const days = [makeDay('Lunes', 'L'), makeDay('Martes', 'M')];
    const moved = moveMealAcrossDayState(days, 0, 'Almuerzo', 1, []);
    expect(moved[0].meals.Almuerzo.name).toBe('A-M');
    expect(moved[1].meals.Almuerzo.name).toBe('A-L');
  });

  it('prevents day move when recipe is locked', () => {
    const days = [makeDay('Lunes', 'L'), makeDay('Martes', 'M')];
    const locked = [buildMealKey('Lunes', 'Almuerzo')];
    const moved = moveMealAcrossDayState(days, 0, 'Almuerzo', 1, locked);
    expect(moved[0].meals.Almuerzo.name).toBe('A-L');
    expect(moved[1].meals.Almuerzo.name).toBe('A-M');
  });

  it('moves recipe across meal slots when not locked', () => {
    const days = [makeDay('Lunes', 'L')];
    const moved = moveMealAcrossSlotState(days, 0, 'Desayuno', 1, []);
    expect(moved[0].meals.Desayuno.name).toBe('A-L');
    expect(moved[0].meals.Almuerzo.name).toBe('D-L');
  });

  it('keeps state when moving out of bounds', () => {
    const days = [makeDay('Lunes', 'L')];
    const moved = moveMealAcrossDayState(days, 0, 'Desayuno', -1, []);
    expect(moved[0].meals.Desayuno.name).toBe('D-L');
  });

  it('supports consecutive moves without duplicating recipes', () => {
    const days = [makeDay('Lunes', 'L'), makeDay('Martes', 'M'), makeDay('Miércoles', 'W')];
    const step1 = moveMealAcrossDayState(days, 0, 'Cena', 1, []);
    const step2 = moveMealAcrossDayState(step1, 1, 'Cena', 1, []);
    expect(step2[0].meals.Cena.name).toBe('C-M');
    expect(step2[1].meals.Cena.name).toBe('C-W');
    expect(step2[2].meals.Cena.name).toBe('C-L');
  });

  it('optimization respects locked meals', () => {
    const days = [makeDay('Lunes', 'L'), makeDay('Martes', 'M'), makeDay('Miércoles', 'W')];
    const locked = [buildMealKey('Miércoles', 'Almuerzo')];
    const optimized = applyOptimizationState(days, 'reuse_proteins', locked);
    expect(optimized[2].meals.Almuerzo.name).toBe('A-W');
    expect(optimized[1].meals.Almuerzo.name).toBe('A-M');
  });
});
