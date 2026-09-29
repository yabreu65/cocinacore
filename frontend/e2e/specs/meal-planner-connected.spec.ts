import { expect, test, type Page } from '@playwright/test';
import { injectAuth } from '../fixtures/auth';
import {
  cleanupConnectedRecipeData,
  clearRecipeCache,
  closeE2EDatabase,
  latestMealPlan,
  resolveAuthenticatedE2EIdentity,
  seedConnectedRecipeData,
  type ConnectedRecipeSeed,
} from '../fixtures/database';

const PROVIDER_INSPECTION_URL = 'http://127.0.0.1:4319/__e2e/requests';
const PROVIDER_RESET_URL = 'http://127.0.0.1:4319/__e2e/reset';

type ProviderInspection = { generationCallCount: number };

async function resetProvider(page: Page): Promise<void> {
  const response = await page.request.post(PROVIDER_RESET_URL);
  expect(response.ok()).toBeTruthy();
}

async function inspectProvider(page: Page): Promise<ProviderInspection> {
  const response = await page.request.get(PROVIDER_INSPECTION_URL);
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as ProviderInspection;
}

test.describe('Connected meal planner', () => {
  test.describe.configure({ mode: 'serial' });

  let seed: ConnectedRecipeSeed | null = null;

  test.beforeEach(async ({ page }, testInfo) => {
    await injectAuth(page);
    await clearRecipeCache();
    await resetProvider(page);
    const identity = await resolveAuthenticatedE2EIdentity(page);
    seed = await seedConnectedRecipeData({
      identity,
      runId: `meal-planner-connected-${testInfo.title}`,
      includeRagChunks: false,
    });
  });

  test.afterEach(async ({ page }) => {
    if (seed) {
      await cleanupConnectedRecipeData(seed);
      seed = null;
    }
    await clearRecipeCache();
    await resetProvider(page);
  });

  test.afterAll(async () => {
    await closeE2EDatabase();
  });

  test('preserves edits made before rehydration, then persists and reloads the authenticated meal plan', async ({ page }) => {
    if (!seed) throw new Error('Connected meal planner seed was not initialized.');

    let releaseInitialGet!: () => void;
    const initialGetReleased = new Promise<void>((resolve) => {
      releaseInitialGet = resolve;
    });
    let signalInitialGetPending!: () => void;
    const initialGetPending = new Promise<void>((resolve) => {
      signalInitialGetPending = resolve;
    });

    await page.route('**/api/meal-plan', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }

      signalInitialGetPending();
      await initialGetReleased;
      await route.continue();
    });
    const initialGetResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/meal-plan') && response.request().method() === 'GET'
    );

    await page.goto('/meal-planner');
    await expect(page.getByRole('heading', { name: 'Planificador de menú' })).toBeVisible();
    await initialGetPending;
    await page.getByLabel('Comensales').fill('2');
    await page.getByLabel('Período').selectOption('fortnight');
    await page.getByLabel('Período').selectOption('week');
    await page.getByLabel('Cocina base').fill('Italiana');
    await page.getByLabel('Restricciones (separadas por comas)').fill('Gluten, Lácteos');

    releaseInitialGet();
    await initialGetResponse;
    await page.unroute('**/api/meal-plan');

    await expect(page.getByLabel('Comensales')).toHaveValue('2');
    await expect(page.getByLabel('Período')).toHaveValue('week');
    await expect(page.getByLabel('Cocina base')).toHaveValue('Italiana');
    await expect(page.getByLabel('Restricciones (separadas por comas)')).toHaveValue(
      'Gluten, Lácteos'
    );

    await page.getByRole('button', { name: 'Generar menú' }).click();

    await expect(page.getByRole('heading', { name: 'Menú generado' })).toBeVisible();
    await expect(page.getByText('Lunes', { exact: true })).toBeVisible();
    expect((await inspectProvider(page)).generationCallCount).toBe(1);

    const stored = await latestMealPlan(seed.identity);
    expect(stored).not.toBeNull();
    expect(stored).toMatchObject({
      user_id: seed.identity.userId,
      tenant_id: seed.identity.tenantId,
      people_count: 2,
      period: 'week',
      mode: 'balanced_ai',
      base_cuisine: 'Italiana',
      fusion_cuisines: [],
      fusion_intensity: 'media',
      restrictions: ['Gluten', 'Lácteos'],
      inventory_snapshot: {
        inventoryLines: ['- tomato: 2 units', '- rice: 1 cup', '- chicken: 200 g'],
      },
      calendar_payload: expect.objectContaining({ period: 'week', dayCount: 7 }),
    });
    expect(stored?.calendar_payload.days).toHaveLength(7);
    expect(stored?.ai_content).toContain('Lunes');
    expect(stored?.ai_content).toContain('Avena conectada');

    await resetProvider(page);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Menú generado' })).toBeVisible();
    await expect(page.getByLabel('Comensales')).toHaveValue('2');
    await expect(page.getByLabel('Período')).toHaveValue('week');
    await expect(page.getByLabel('Cocina base')).toHaveValue('Italiana');
    await expect(page.getByLabel('Restricciones (separadas por comas)')).toHaveValue(
      'Gluten, Lácteos'
    );
    expect((await inspectProvider(page)).generationCallCount).toBe(0);
  });
});
