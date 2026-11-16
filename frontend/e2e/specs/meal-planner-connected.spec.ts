import { expect, test, type Page } from '@playwright/test';
import { injectAuth } from '../fixtures/auth';
import { Pool } from 'pg';
import { validateE2ETargets } from '../database-target';
import {
  assertE2EDisposableIsolation,
  cleanupConnectedRecipeData,
  clearRecipeCache,
  closeE2EDatabase,
  latestMealPlan,
  resolveAuthenticatedE2EIdentity,
  seedConnectedRecipeData,
  type ConnectedRecipeSeed,
} from '../fixtures/database';

const PROVIDER_BASE_URL = `http://127.0.0.1:${process.env.E2E_PROVIDER_PORT ?? '4319'}`;
const PROVIDER_INSPECTION_URL = `${PROVIDER_BASE_URL}/__e2e/requests`;
const PROVIDER_RESET_URL = `${PROVIDER_BASE_URL}/__e2e/reset`;

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
      availableTimeMinutes: 35,
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
    await page.getByLabel('Restricciones (separadas por comas)').fill('Sésamo, Lácteos');

    releaseInitialGet();
    await initialGetResponse;
    await page.unroute('**/api/meal-plan');

    await expect(page.getByLabel('Comensales')).toHaveValue('2');
    await expect(page.getByLabel('Período')).toHaveValue('week');
    await expect(page.getByLabel('Cocina base')).toHaveValue('Italiana');
    await expect(page.getByLabel('Restricciones (separadas por comas)')).toHaveValue(
      'Sésamo, Lácteos'
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
      restrictions: ['Sésamo', 'Lácteos'],
      inventory_snapshot: {
        inventoryLines: ['- tomato: 2 units', '- rice: 1 cup', '- chicken: 200 g'],
        evaluatedHardRestrictions: expect.arrayContaining(['Sésamo', 'Lácteos']),
      },
      calendar_payload: expect.objectContaining({ period: 'week', dayCount: 7 }),
    });
    expect(stored?.calendar_payload).toHaveProperty('availableTimeMinutesSnapshot', 35);
    expect(stored?.calendar_payload.days).toHaveLength(7);
    const generatedDays = stored?.calendar_payload.days as
      | Array<{ meals: Array<{ prepMinutes: number }> }>
      | undefined;
    for (const day of generatedDays ?? []) {
      for (const meal of day.meals) {
        expect(Number.isInteger(meal.prepMinutes)).toBeTruthy();
        expect(meal.prepMinutes).toBeGreaterThanOrEqual(1);
        expect(meal.prepMinutes).toBeLessThanOrEqual(240);
        expect(meal.prepMinutes).toBeLessThanOrEqual(35);
      }
    }
    expect(stored?.ai_content).toContain('Lunes');
    expect(stored?.ai_content).toContain('Avena conectada');

    await resetProvider(page);
    await page.route('**/api/meal-plan', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      const body = (await response.json()) as {
        plan: { availableTimeMinutesSnapshot?: number | null; days: Array<{ meals: Array<{ prepMinutes?: number | null }> }> };
      };
      delete body.plan.availableTimeMinutesSnapshot;
      for (const day of body.plan.days) {
        for (const meal of day.meals) delete meal.prepMinutes;
      }
      await route.fulfill({ response, json: body });
    });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Menú generado' })).toBeVisible();
    await expect(page.getByText('tiempo no estimado').first()).toBeVisible();
    await expect(page.getByLabel('Comensales')).toHaveValue('2');
    await expect(page.getByLabel('Período')).toHaveValue('week');
    await expect(page.getByLabel('Cocina base')).toHaveValue('Italiana');
    await expect(page.getByLabel('Restricciones (separadas por comas)')).toHaveValue(
      'Sésamo, Lácteos'
    );
    expect((await inspectProvider(page)).generationCallCount).toBe(0);
  });
  test('rejects the deterministic oats fixture when gluten is excluded', async ({ page }) => {
    if (!seed) throw new Error('Connected meal planner seed was not initialized.');
    const before = await latestMealPlan(seed.identity);
    const response = await page.request.post('/api/meal-plan', { data: {
      mode: 'balanced_ai', period: 'week', restrictions: ['Gluten'],
    } });
    expect(response.status()).toBe(502);
    expect(await latestMealPlan(seed.identity)).toEqual(before);
  });

  test('rejects a menu when a new restriction is committed during generation', async ({ page }) => {
    if (!seed) throw new Error('Connected meal planner seed was not initialized.');
    const { userId, tenantId } = seed.identity;
    const before = await latestMealPlan(seed.identity);
    const database = new Pool({ connectionString: validateE2ETargets(process.env).databaseUrl });
    await assertE2EDisposableIsolation(database);
    const client = await database.connect();
    let pending: ReturnType<typeof page.request.post> | undefined;
    let originalAllergies: string[] | undefined;
    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `culinary-profile:${tenantId.toLowerCase()}:${userId.toLowerCase()}`,
      ]);
      const original = await client.query<{ allergies: string[] }>(
        'select allergies from public.user_culinary_profiles where user_id = $1 and tenant_id = $2',
        [userId, tenantId]
      );
      originalAllergies = original.rows[0]?.allergies;
      if (!originalAllergies) throw new Error('Synthetic profile not found.');
      pending = page.request.post('/api/meal-plan', { data: {
        mode: 'balanced_ai', period: 'week', restrictions: [],
      } });
      await expect.poll(async () => (await inspectProvider(page)).generationCallCount).toBe(1);
      // The provider has seen the old profile; the create transaction waits
      // on this same advisory lock before it can persist the response.
      await client.query(
        'update public.user_culinary_profiles set allergies = $1 where user_id = $2 and tenant_id = $3',
        [[...originalAllergies, 'alergia nueva desconocida'], userId, tenantId]
      );
      await client.query('commit');
      const response = await pending;
      expect(response.status()).toBe(409);
      expect(await response.json()).toMatchObject({ code: 'MEAL_PLAN_RESTRICTIONS_CHANGED' });
      expect(await latestMealPlan(seed.identity)).toEqual(before);
    } finally {
      await client.query('rollback');
      if (pending) await pending.catch(() => undefined);
      if (originalAllergies) await client.query(
        'update public.user_culinary_profiles set allergies = $1 where user_id = $2 and tenant_id = $3',
        [originalAllergies, userId, tenantId]
      );
      client.release();
      await database.end();
    }
  });

});
