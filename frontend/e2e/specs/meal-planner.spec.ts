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

  test('generates preparation only after clicking one meal and keeps it inline without consuming stock', async ({
    page,
  }) => {
    await injectAuth(page);
    await stubMealPlan(page);
    let calls = 0;
    let requestedDish = '';
    await page.route('/api/recipe-generate', async (route) => {
      calls += 1;
      const body = route.request().postDataJSON() as {
        recipeName?: string;
        peopleCount?: number;
        ingredients?: string[];
      };
      requestedDish = body.recipeName ?? '';
      expect(body.peopleCount).toBe(4);
      expect(body.ingredients).toContain('pollo');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          title: 'Pollo al horno',
          recipe:
            'Pollo al horno\nINGREDIENTES\n- 1 kg pollo\nPREPARACIÓN\nPrecalentar el horno a 180 grados.',
          preparation: '1. Precalentar el horno a 180 grados.\n2. Hornear el pollo.',
          servings: 4,
        }),
      });
    });

    await page.goto('/meal-planner');
    const lunch = page.locator('article').filter({ hasText: 'Almuerzo: Pollo al horno' }).first();
    await expect(lunch.getByRole('button', { name: 'Ver preparación' })).toBeVisible();
    expect(calls).toBe(0);
    await lunch.getByRole('button', { name: 'Ver preparación' }).click();
    await expect(
      lunch.getByRole('region', { name: 'Preparación de Pollo al horno' })
    ).toContainText('Hornear el pollo.');
    expect(requestedDish).toBe('Pollo al horno');
    expect(calls).toBe(1);
    await lunch.getByRole('button', { name: 'Ocultar preparación' }).click();
    await expect(lunch.getByRole('region', { name: 'Preparación de Pollo al horno' })).toHaveCount(
      0
    );
    await lunch.getByRole('button', { name: 'Ver preparación' }).click();
    await expect(
      lunch.getByRole('region', { name: 'Preparación de Pollo al horno' })
    ).toBeVisible();
    expect(calls).toBe(1);
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

  test('preselects safe shopping quantities, hides exceptions and submits one reviewed selection', async ({
    page,
  }) => {
    await injectAuth(page);
    const confirmations: string[][] = [];
    const fixtureItem = (name: string, status: 'buy' | 'review', alreadyPresent = false) => ({
      normalizedName: name.toLowerCase(),
      ingredientName: name,
      requiredQuantity: status === 'buy' ? 2 : null,
      availableQuantity: 0.5,
      quantityToBuy: status === 'buy' ? 1.5 : null,
      unit: status === 'buy' ? 'kg' : 'unknown',
      status,
      usedInRecipes: ['Almuerzo de prueba'],
      estimatedCost: null,
      alreadyPresent,
      shoppingStatus: alreadyPresent ? 'pending' : null,
      transferCompleted: false,
      existingShoppingSources: [],
    });
    const items = [
      fixtureItem('Arroz', 'buy'),
      fixtureItem('Pollo', 'buy'),
      fixtureItem('Pimienta', 'review'),
      fixtureItem('Sal', 'buy', true),
    ];
    await page.route('/api/meal-plan', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          route.request().method() === 'GET'
            ? { plan: null, content: null }
            : { ...STUB_MEAL_PLAN_RESPONSE, id: 'plan-shopping-e2e' }
        ),
      });
    });
    await page.route('**/api/meal-plan/shopping-suggestions**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: items.map((item) =>
              item.normalizedName === 'arroz' && confirmations.length > 0
                ? { ...item, alreadyPresent: true, shoppingStatus: 'pending' }
                : item
            ),
            status: 'ready',
            expectedUpdatedAt: '2026-11-20T12:00:00.000Z',
            sourceFingerprint: 'a'.repeat(64),
          }),
        });
        return;
      }
      const body = route.request().postDataJSON() as { selectedItems: string[] };
      confirmations.push(body.selectedItems);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          added: [{ ingredient_name: 'Arroz', status: 'pending' }],
          alreadyPresent: [],
          ignored: [],
        }),
      });
    });
    await page.route('**/api/meal-plan/consumption**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ consumptions: {} }),
      });
    });

    const planner = new MealPlannerPage(page);
    await planner.goto();
    await planner.generatePlan();
    await expect(page.getByText('2 por comprar')).toBeVisible();
    await expect(page.getByText('1 ya en la lista')).toBeVisible();
    await expect(page.getByText('1 requieren revisar cantidad')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Agregar 2 productos al supermercado' })
    ).toBeEnabled();
    expect(confirmations).toHaveLength(0);
    await page.getByText('Revisar o ajustar 2 productos (2 seleccionados)').click();
    await page.getByRole('checkbox', { name: 'Pollo, Comprar' }).uncheck();
    await expect(
      page.getByRole('button', { name: 'Agregar 1 producto al supermercado' })
    ).toBeEnabled();
    await page.getByRole('button', { name: 'Agregar 1 producto al supermercado' }).click();
    await expect(page.getByRole('link', { name: 'Ver mi lista del supermercado' })).toBeVisible();
    expect(confirmations).toEqual([['arroz']]);
  });
});
