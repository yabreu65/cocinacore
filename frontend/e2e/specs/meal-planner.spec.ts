import { test, expect } from '@playwright/test';
import { injectAuth } from '../fixtures/auth';
import { STUB_MEAL_PLAN_RESPONSE, stubMealPlan } from '../fixtures/stubs';
import { MealPlannerPage } from '../pages/meal-planner';

test.describe('Meal Planner', () => {
  test('user can generate a meal plan with stubbed AI', async ({ page }) => {
    await injectAuth(page);
    await stubMealPlan(page);

    const mealPlannerPage = new MealPlannerPage(page);
    await mealPlannerPage.goto();

    // Wait for page to load
    await expect(mealPlannerPage.title).toBeVisible();

    // Generate plan
    await mealPlannerPage.generatePlan();

    // Should see stubbed meal plan content
    await expect(page.locator('body')).toContainText('LUNES', { timeout: 10000 });
  });

  test('meal planner page loads for authenticated user', async ({ page }) => {
    await injectAuth(page);

    const mealPlannerPage = new MealPlannerPage(page);
    await mealPlannerPage.goto();

    await expect(mealPlannerPage.title).toBeVisible();
    await expect(mealPlannerPage.generateButton).toBeVisible();
  });

  test('shows an adaptive proposal before confirmation and only confirms after an explicit click', async ({
    page,
  }) => {
    await injectAuth(page);
    let confirmationCalls = 0;
    const shoppingHorizons: string[] = [];
    await page.route('/api/meal-plan', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ plan: null, content: null }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...STUB_MEAL_PLAN_RESPONSE, id: 'plan-u3-e2e' }),
      });
    });
    await page.route('**/api/meal-plan/shopping-suggestions**', async (route) => {
      if (route.request().method() === 'GET') {
        shoppingHorizons.push(new URL(route.request().url()).searchParams.get('horizon') ?? '');
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [],
          status: 'ready',
          expectedUpdatedAt: '2026-10-27T00:00:00.000Z',
          sourceFingerprint: 'shopping-fixture',
          cost: { status: 'complete', estimatedTotal: 0, knownItemCount: 0, itemCount: 0 },
        }),
      });
    });
    await page.route('**/api/meal-plan/consumption**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ consumptions: {} }),
        });
        return;
      }
      await route.continue();
    });
    await page.route('/api/meal-plan/adaptive-proposal', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          mealPlanId: 'plan-u3-e2e',
          expectedUpdatedAt: '2026-10-27T00:00:00.000Z',
          sourceFingerprint: 'fixture-source',
          proposal: {
            plan: STUB_MEAL_PLAN_RESPONSE.plan,
            changes: [
              {
                slotKey: '1:dinner',
                previousMeal: 'Sopa de verduras',
                proposedMeal: 'Pollo al horno',
                reason: 'Vencimiento próximo.',
              },
            ],
            lockedSlotKeys: [],
            evidence: [{ label: 'Vencimientos', status: 'known', detail: 'Inventario fixture.' }],
            confidence: 'high',
            metrics: {},
            limitations: ['Solo reordena recetas existentes.'],
          },
        }),
      });
    });
    await page.route('/api/meal-plan/adaptive-proposal/confirm', async (route) => {
      confirmationCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'plan-u3-e2e',
          plan: STUB_MEAL_PLAN_RESPONSE.plan,
          content: 'fixture',
        }),
      });
    });

    const mealPlannerPage = new MealPlannerPage(page);
    await mealPlannerPage.goto();
    await mealPlannerPage.generatePlan();
    await expect(page.getByRole('heading', { name: 'Menú generado' })).toBeVisible();
    await page.getByRole('combobox', { name: 'Horizonte' }).selectOption('14');
    await expect.poll(() => shoppingHorizons).toContain('14');
    await page.getByRole('button', { name: 'Preparar propuesta' }).click();
    await expect(page.getByTestId('adaptive-proposal')).toBeVisible();
    expect(confirmationCalls).toBe(0);
    await page.getByRole('button', { name: 'Confirmar y guardar propuesta' }).click();
    await expect(page.getByText('Propuesta confirmada.', { exact: false })).toBeVisible();
    await expect.poll(() => shoppingHorizons.filter((horizon) => horizon === '14')).toHaveLength(2);
    expect(confirmationCalls).toBe(1);
  });
});
