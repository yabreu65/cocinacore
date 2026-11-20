import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { validateE2ETargets } from '../database-target';
import { signupIsolatedE2EUser } from '../fixtures/auth';
import { assertE2EDisposableIsolation, closeE2EDatabase, resolveAuthenticatedE2EIdentity } from '../fixtures/database';

const database = new Pool({ connectionString: validateE2ETargets(process.env).databaseUrl });

test.describe('Connected weekly quantity review', () => {
  test.afterAll(async () => {
    await database.end();
    await closeE2EDatabase();
  });

  test('saves only an explicitly approved estimate and rejects stale or foreign writes', async ({ page, browser }, testInfo) => {
    await assertE2EDisposableIsolation(database);
    await signupIsolatedE2EUser(page, 'quantity-review');
    const identity = await resolveAuthenticatedE2EIdentity(page);
    const now = new Date().toISOString();
    const names = { selected: 'E2E selected rice', pending: 'E2E pending beans', known: 'E2E known carrot' };
    const plan = {
      period: 'week', dayCount: 7,
      schedule: { startDate: now.slice(0, 10), timeZone: 'UTC', confirmedAt: now,
        portionConfirmation: { peopleCount: 2, confirmedAt: now } },
      days: Array.from({ length: 7 }, (_, index) => ({
        dayIndex: index + 1,
        label: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'][index],
        meals: (['breakfast', 'lunch', 'dinner'] as const).map((mealType) => ({
          mealType, title: `E2E ${mealType}`, description: null,
          ingredients: index === 0 && mealType === 'breakfast'
            ? [{ name: names.selected, quantity: null, unit: null },
               { name: names.pending, quantity: null, unit: null },
               { name: names.known, quantity: 2, unit: 'kg' }]
            : [{ name: names.known, quantity: 2, unit: 'kg' }],
        })),
      })),
    };
    let planId: string | undefined;
    const inventoryId = randomUUID();
    try {
      const inventoryName = `e2e-quantity-review-stock-${inventoryId}`;
      await database.query(
        `insert into public.recipe_inventory_items
           (id, tenant_id, user_id, ingredient_name, quantity, unit, normalized_name, expiration_date)
         values ($1, $2, $3, $4, '2', 'kg', $4, '2999-12-31')`,
        [inventoryId, identity.tenantId, identity.userId, inventoryName]
      );
      const inserted = await database.query<{ id: string }>(
        `insert into public.user_meal_plans
           (tenant_id, user_id, people_count, period, mode, base_cuisine, fusion_cuisines,
            fusion_intensity, restrictions, inventory_snapshot, calendar_payload, ai_content)
         values ($1, $2, 2, 'week', 'balanced_ai', 'E2E', '{}', 'media', '{}',
                 '{"inventoryLines":[]}'::jsonb, $3::jsonb, 'E2E canonical plan') returning id`,
        [identity.tenantId, identity.userId, JSON.stringify(plan)]
      );
      planId = inserted.rows[0]?.id;
      if (!planId) throw new Error('Failed to seed quantity review plan.');
      const readPlan = () => database.query(
        `select people_count, period, mode, base_cuisine, fusion_cuisines, fusion_intensity,
                restrictions, inventory_snapshot, calendar_payload, consumption_payload, ai_content
         from public.user_meal_plans where id = $1 and tenant_id = $2 and user_id = $3`,
        [planId, identity.tenantId, identity.userId]
      );
      const readInventory = () => database.query(
        'select * from public.recipe_inventory_items where tenant_id = $1 and user_id = $2 order by id',
        [identity.tenantId, identity.userId]
      );
      const readShopping = () => database.query(
        'select * from public.shopping_list_items where tenant_id = $1 and user_id = $2 order by id',
        [identity.tenantId, identity.userId]
      );
      const [beforePlan, beforeInventory, beforeShopping] = await Promise.all([readPlan(), readInventory(), readShopping()]);
      expect(beforeInventory.rows).toHaveLength(1);
      expect(beforeInventory.rows[0]).toMatchObject({ id: inventoryId, ingredient_name: inventoryName, quantity: '2', unit: 'kg' });
      let postCount = 0;
      page.on('request', (request) => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/meal-plan/quantity-review') postCount++;
      });
      await page.goto('/meal-planner');
      await expect(page.getByRole('heading', { name: 'Agenda confirmada' })).toBeVisible();
      expect(postCount).toBe(0);
      const proposalResponse = page.waitForResponse((response) =>
        response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/meal-plan/quantity-review');
      await page.getByRole('button', { name: /Preparar cantidades estimadas de/ }).click();
      const proposal = await proposalResponse;
      expect(proposal.status()).toBe(200);
      expect(proposal.request().postDataJSON()).toEqual({ mealPlanId: planId, dayIndex: 1 });
      expect(postCount).toBe(1);
      await expect(page.getByRole('heading', { name: 'Estimación de IA — revisar' })).toBeVisible();
      expect((await readPlan()).rows).toEqual(beforePlan.rows);
      expect((await readInventory()).rows).toEqual(beforeInventory.rows);
      expect((await readShopping()).rows).toEqual(beforeShopping.rows);
      await page.locator('section[aria-labelledby="quantity-review-title"] summary').filter({ hasText: 'Lunes' }).click();
      await expect(page.getByLabel(`Cantidad de ${names.selected}`)).toHaveValue('100');
      await expect(page.getByLabel(`Aprobar ${names.selected}`)).not.toBeChecked();
      await expect(page.getByLabel(`Aprobar ${names.pending}`)).not.toBeChecked();
      await page.getByLabel(`Aprobar ${names.selected}`).check();
      const saveRequest = page.waitForRequest((request) =>
        request.method() === 'PUT' && new URL(request.url()).pathname === '/api/meal-plan/quantity-review');
      const saveResponse = page.waitForResponse((response) =>
        response.request().method() === 'PUT' && new URL(response.url()).pathname === '/api/meal-plan/quantity-review');
      await page.getByRole('button', { name: 'Guardar cantidades aprobadas' }).click();
      const request = await saveRequest;
      const save = await saveResponse;
      expect(save.status()).toBe(200);
      const body = request.postDataJSON() as { items: Array<{ name: string; quantity: number; unit: string }> };
      expect(body.items).toHaveLength(1);
      expect(body.items[0]).toMatchObject({ name: names.selected, quantity: 100, unit: 'g' });
      const expectedPlan = structuredClone(plan);
      expectedPlan.days[0].meals[0].ingredients[0] = { name: names.selected, quantity: 100, unit: 'g' };
      const [afterPlan, afterInventory, afterShopping] = await Promise.all([readPlan(), readInventory(), readShopping()]);
      expect(afterPlan.rows).toEqual([{ ...beforePlan.rows[0], calendar_payload: expectedPlan }]);
      expect(afterInventory.rows).toEqual(beforeInventory.rows);
      expect(afterShopping.rows).toEqual(beforeShopping.rows);
      const replay = await page.request.put('/api/meal-plan/quantity-review', { data: body });
      expect(replay.status()).toBe(409);

      const foreignContext = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
      try {
        const foreignPage = await foreignContext.newPage();
        await signupIsolatedE2EUser(foreignPage, 'quantity-review-foreign');
        const foreignIdentity = await resolveAuthenticatedE2EIdentity(foreignPage);
        expect(foreignIdentity.userId).not.toBe(identity.userId);
        const foreign = await foreignPage.request.put('/api/meal-plan/quantity-review', { data: body });
        expect(foreign.status()).toBe(404);
        expect((await readPlan()).rows).toEqual(afterPlan.rows);
      } finally {
        await foreignContext.close();
      }
    } finally {
      try {
        if (planId) await database.query(
          'delete from public.user_meal_plans where id = $1 and tenant_id = $2 and user_id = $3',
          [planId, identity.tenantId, identity.userId]
        );
      } finally {
        await database.query(
          'delete from public.recipe_inventory_items where id = $1 and tenant_id = $2 and user_id = $3',
          [inventoryId, identity.tenantId, identity.userId]
        );
      }
    }
  });
});
