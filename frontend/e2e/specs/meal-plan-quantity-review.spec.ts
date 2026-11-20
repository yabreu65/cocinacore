import { expect, test } from '@playwright/test';
import { injectAuth } from '../fixtures/auth';
import { STUB_MEAL_PLAN_RESPONSE } from '../fixtures/stubs';

test('revises weekly quantities only after explicit preparation and partial approval', async ({ page }) => {
  await injectAuth(page);
  const mealPlanId = '0e6d36b4-146f-4718-8156-6c19d75a510c';
  const plan = {
    ...structuredClone(STUB_MEAL_PLAN_RESPONSE.plan),
    days: structuredClone(STUB_MEAL_PLAN_RESPONSE.plan.days).map((day) => day.dayIndex !== 1 ? day : {
      ...day,
      meals: day.meals.map((meal) => meal.mealType !== 'breakfast' ? meal : {
        ...meal, ingredients: [...meal.ingredients, { name: 'canela', quantity: null, unit: null }],
      }),
    }),
    schedule: {
      startDate: '2999-01-01', timeZone: 'UTC', confirmedAt: '2026-01-01T00:00:00Z',
      portionConfirmation: { peopleCount: 4, confirmedAt: '2026-01-01T00:00:00Z' },
    },
  };
  const items = plan.days.flatMap((day) => day.meals.flatMap((meal) => meal.ingredients.map((ingredient, ingredientIndex) => ({
    dayIndex: day.dayIndex, mealType: meal.mealType,
    name: ingredient.name,
    quantity: day.dayIndex === 1 && ingredientIndex === 0 ? 500 : null,
    unit: day.dayIndex === 1 && ingredientIndex === 0 ? 'g' : null,
    ingredientIndex,
  }))));
  let preparations = 0;
  let saves = 0;
  let shoppingReads = 0;
  let planReads = 0;
  await page.route('**/api/meal-plan/consumption**', (route) => route.fulfill({ json: { consumptions: {} } }));
  await page.route('**/api/meal-plan/shopping-suggestions**', (route) => {
    shoppingReads++;
    return route.fulfill({ json: {
      items: [], status: 'ready', expectedUpdatedAt: 'fixture', sourceFingerprint: 'fixture',
      cost: { status: 'unknown', estimatedTotal: null, knownItemCount: 0, itemCount: 0 },
    } });
  });
  await page.route('**/api/meal-plan', (route) => {
    expect(route.request().method()).toBe('GET');
    planReads++;
    const currentPlan = saves ? {
      ...plan,
      days: plan.days.map((day) => day.dayIndex !== 1 ? day : {
        ...day,
        meals: day.meals.map((meal) => meal.mealType !== 'breakfast' ? meal : {
          ...meal, ingredients: meal.ingredients.map((ingredient, index) => index === 0 ? { ...ingredient, quantity: 500, unit: 'g' } : ingredient),
        }),
      }),
    } : plan;
    return route.fulfill({ json: { id: mealPlanId, plan: currentPlan, content: null, peopleCount: 4, period: 'week' } });
  });
  await page.route('**/api/meal-plan/quantity-review', (route) => {
    const body: unknown = route.request().postDataJSON();
    if (route.request().method() === 'POST') {
      preparations++;
      expect(body).toEqual({ mealPlanId });
      return route.fulfill({ json: { mealPlanId, expectedUpdatedAt: 'fixture', fingerprint: 'source', items } });
    }
    expect(route.request().method()).toBe('PUT');
    saves++;
    expect(body).toEqual({ mealPlanId, expectedUpdatedAt: 'fixture', fingerprint: 'source', items: [items[0]] });
    return route.fulfill({ json: { mealPlanId } });
  });

  await page.goto('/meal-planner');
  await expect(page.getByRole('heading', { name: 'Agenda confirmada' })).toBeVisible();
  const prepare = page.getByRole('button', { name: 'Preparar cantidades estimadas para mi menú' });
  await expect(prepare).toBeVisible();
  expect(preparations).toBe(0);
  expect(saves).toBe(0);
  await prepare.click();
  await expect(page.getByRole('heading', { name: 'Estimación de IA — revisar' })).toBeVisible();
  expect(preparations).toBe(1);
  expect(saves).toBe(0);
  await page.locator('summary').filter({ hasText: 'LUNES' }).click();
  await expect(page.getByText(/No calculable: completá/).first()).toBeVisible();
  const approval = page.getByLabel('Aprobar avena').first();
  await expect(approval).toBeChecked();
  const uncalculable = page.getByLabel('Aprobar canela');
  const otherMeal = page.locator('h4').filter({ hasText: 'Almuerzo:' }).first().locator('..').getByRole('checkbox').first();
  await expect(uncalculable).not.toBeChecked();
  await expect(uncalculable).toBeDisabled();
  await expect(otherMeal).not.toBeChecked();
  await expect(page.getByText(`Cantidades listas para guardar: 1. Sin seleccionar: ${items.length - 1}.`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Guardar cantidades aprobadas' })).toBeEnabled();
  await approval.uncheck();
  await expect(page.getByText(`Cantidades listas para guardar: 0. Sin seleccionar: ${items.length}.`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Guardar cantidades aprobadas' })).toBeDisabled();
  await approval.check();
  await page.getByRole('button', { name: 'Guardar cantidades aprobadas' }).click();
  await expect.poll(() => saves).toBe(1);
  await expect.poll(() => planReads).toBe(2);
  await expect.poll(() => shoppingReads).toBe(2);
});
