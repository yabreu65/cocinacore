import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { StructuredMealPlan } from '@/lib/meal-planner/structured-plan';
import QuantityReview, { isQuantityReviewCurrent, reloadSavedPlan, reviewUnit } from './QuantityReview';

const plan: StructuredMealPlan = {
  period: 'week', dayCount: 7,
  days: Array.from({ length: 7 }, (_, index) => ({ dayIndex: index + 1, label: `Día ${index + 1}`, meals: [{ mealType: 'lunch', title: 'Plato', description: null, ingredients: [{ name: 'Avena', quantity: null, unit: null }] }] })),
  schedule: { startDate: '2026-11-21', timeZone: 'UTC', confirmedAt: '2026-11-20', portionConfirmation: { peopleCount: 4, confirmedAt: '2026-11-20' } },
};
const props = { mealPlanId: 'plan', disabled: false, isCurrent: () => true, onReloaded: vi.fn() };

describe('QuantityReview', () => {
  it('reports a failed reload instead of throwing after a confirmed save', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockRejectedValueOnce(new Error('network'));
    expect(await reloadSavedPlan('plan')).toBeNull();
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 }));
    expect(await reloadSavedPlan('plan')).toBeNull();
    fetchSpy.mockRestore();
  });
  it('rejects responses during generation or after the source plan changes', () => {
    expect(isQuantityReviewCurrent(true, false, 'plan', 'plan', plan, plan)).toBe(true);
    expect(isQuantityReviewCurrent(true, true, 'plan', 'plan', plan, plan)).toBe(false);
    expect(isQuantityReviewCurrent(true, false, 'plan', 'plan', { ...plan }, plan)).toBe(false);
    expect(isQuantityReviewCurrent(true, false, null, 'plan', plan, plan)).toBe(false);
  });
  it('uses the estimate only when the original unit is not recognized', () => {
    expect(reviewUnit('pizca', 'gramos')).toBe('g');
    expect(reviewUnit('kg', 'gramos')).toBe('kg');
    expect(reviewUnit('pizca', null)).toBeNull();
  });
  it('offers explicit preparation only for a confirmed plan with missing quantities, without fetching', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect(renderToStaticMarkup(createElement(QuantityReview, { ...props, plan }))).toContain('Preparar cantidades estimadas para mi menú');
    expect(renderToStaticMarkup(createElement(QuantityReview, { ...props, plan: { ...plan, schedule: undefined } }))).toBe('');
    expect(renderToStaticMarkup(createElement(QuantityReview, { ...props, plan: { ...plan, days: plan.days.map((day) => ({ ...day, meals: day.meals.map((meal) => ({ ...meal, ingredients: [{ name: 'Avena', quantity: 1, unit: 'g' }] })) })) } }))).toBe('');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
  it('does not offer calls for a longer menu', () => {
    const html = renderToStaticMarkup(createElement(QuantityReview, { ...props, plan: { ...plan, period: 'fortnight', dayCount: 14 } }));
    expect(html).toContain('aún no está disponible');
    expect(html).not.toContain('Preparar cantidades estimadas para mi menú');
  });
});
