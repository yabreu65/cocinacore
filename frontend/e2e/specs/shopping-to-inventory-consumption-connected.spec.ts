import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import { validateE2ETargets } from '../database-target';
import { signupIsolatedE2EUser } from '../fixtures/auth';
import {
  assertE2EDisposableIsolation,
  closeE2EDatabase,
  hasAppendOnlyE2EReferences,
} from '../fixtures/database';

const database = new Pool({
  connectionString: validateE2ETargets(process.env).databaseUrl,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 10_000,
  query_timeout: 15_000,
});

type Identity = { userId: string; tenantId: string };

async function authenticatedIdentity(page: Page): Promise<Identity> {
  await signupIsolatedE2EUser(page, 'shopping-consumption');
  const response = await page.goto('/api/profile');
  expect(response?.ok()).toBeTruthy();
  const payload = JSON.parse((await page.locator('body').innerText()) ?? '') as {
    user?: { id?: string; tenant?: { tenantId?: string } | null };
  };
  const userId = payload.user?.id;
  const tenantId = payload.user?.tenant?.tenantId;
  if (!userId || !tenantId)
    throw new Error('Authenticated E2E identity is missing user or tenant.');
  return { userId, tenantId };
}

function mealPlan(trackedName: string, mealTitle: string) {
  return {
    period: 'week',
    dayCount: 7,
    days: Array.from({ length: 7 }, (_, index) => ({
      dayIndex: index + 1,
      label: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'][index],
      meals: [
        {
          mealType: 'breakfast',
          title: index === 0 ? mealTitle : `Desayuno conectado ${index + 1}`,
          description: null,
          ingredients:
            index === 0
              ? [{ name: trackedName, quantity: 1, unit: 'kg' }]
              : [{ name: 'ingrediente de prueba', quantity: 1, unit: 'kg' }],
        },
        {
          mealType: 'lunch',
          title: `Almuerzo conectado ${index + 1}`,
          description: null,
          ingredients: [{ name: 'ingrediente de prueba', quantity: 1, unit: 'kg' }],
        },
        {
          mealType: 'dinner',
          title: `Cena conectada ${index + 1}`,
          description: null,
          ingredients: [{ name: 'ingrediente de prueba', quantity: 1, unit: 'kg' }],
        },
      ],
    })),
  };
}

test.describe('Shopping purchase to inventory to Ya cociné', () => {
  test.afterAll(async () => {
    await database.end();
    await closeE2EDatabase();
  });

  test('transfers legacy purchased rows with structured quantities and rejects unstructured quantities', async ({
    page,
  }) => {
    await assertE2EDisposableIsolation(database);
    const identity = await authenticatedIdentity(page);
    const unique = `e2e-shopping-legacy-${randomUUID()}`;
    const rows = [
      { id: randomUUID(), ingredient: `${unique} harina`, quantity: '4 kilos' },
      { id: randomUUID(), ingredient: `${unique} arroz`, quantity: '1 kilo' },
      { id: randomUUID(), ingredient: `${unique} bolsa`, quantity: '1 bolsa' },
    ];
    const shoppingIds = rows.map((row) => row.id);
    const inventoryIds: string[] = [];
    let operationError: unknown;

    try {
      for (const row of rows) {
        await database.query(
          `insert into public.shopping_list_items
             (id, tenant_id, user_id, source, ingredient_name, quantity, status,
              transfer_inventory_item_id, transferred_at)
           values ($1, $2, $3, 'manual', $4, $5, 'purchased', null, null)`,
          [row.id, identity.tenantId, identity.userId, row.ingredient, row.quantity]
        );
      }

      const transfers: { id: string; ingredient: string }[] = [];
      for (const row of rows.slice(0, 2)) {
        const response = await page.request.post(`/api/shopping-list/${row.id}/inventory`);
        expect(response.status()).toBe(200);
        const payload = (await response.json()) as {
          inventoryItem: { id: string; ingredient_name: string; quantity: string; unit: string };
        };
        expect(payload.inventoryItem).toMatchObject({
          ingredient_name: row.ingredient,
          unit: 'kg',
        });
        inventoryIds.push(payload.inventoryItem.id);
        transfers.push({
          id: payload.inventoryItem.id,
          ingredient: payload.inventoryItem.ingredient_name,
        });
      }

      for (const [index, transfer] of transfers.entries()) {
        const state = await database.query<{ quantity: string; unit: string; movements: string }>(
          `select i.quantity::text as quantity, i.unit,
                  (select count(*)::text from public.inventory_movements m
                   where m.tenant_id=$1 and m.user_id=$2 and m.inventory_item_id=i.id
                     and m.movement_type='purchase') movements
           from public.recipe_inventory_items i
           where i.id=$3 and i.tenant_id=$1 and i.user_id=$2 and i.ingredient_name=$4`,
          [identity.tenantId, identity.userId, transfer.id, transfer.ingredient]
        );
        expect(state.rows).toEqual([
          { quantity: index === 0 ? '4' : '1', unit: 'kg', movements: '1' },
        ]);
      }

      const invalidResponse = await page.request.post(`/api/shopping-list/${rows[2].id}/inventory`);
      expect(invalidResponse.status()).toBe(400);
      expect(await invalidResponse.json()).toEqual({
        error: 'Shopping list item must have a structured quantity and unit',
      });
      const invalidState = await database.query<{ inventory_items: string; movements: string }>(
        `select (select count(*)::text from public.recipe_inventory_items i
                 where i.tenant_id=$1 and i.user_id=$2 and i.ingredient_name=$3) inventory_items,
                (select count(*)::text from public.inventory_movements m
                 join public.recipe_inventory_items i on i.id=m.inventory_item_id
                 where m.tenant_id=$1 and m.user_id=$2 and i.ingredient_name=$3) movements`,
        [identity.tenantId, identity.userId, rows[2].ingredient]
      );
      expect(invalidState.rows).toEqual([{ inventory_items: '0', movements: '0' }]);
    } catch (error) {
      operationError = error;
      throw error;
    } finally {
      try {
        if (inventoryIds.length > 0) {
          await database.query(
            `delete from public.inventory_movements
             where tenant_id=$1 and user_id=$2 and inventory_item_id=any($3::uuid[])`,
            [identity.tenantId, identity.userId, inventoryIds]
          );
          await database.query(
            `delete from public.recipe_inventory_items
             where tenant_id=$1 and user_id=$2 and id=any($3::uuid[])`,
            [identity.tenantId, identity.userId, inventoryIds]
          );
        }
        await database.query(
          `delete from public.shopping_list_items
           where id=any($1::uuid[]) and tenant_id=$2 and user_id=$3`,
          [shoppingIds, identity.tenantId, identity.userId]
        );
      } catch (cleanupError) {
        if (operationError)
          throw new AggregateError([operationError, cleanupError], 'Test and cleanup both failed.');
        throw cleanupError;
      }
    }
  });

  test('transfers only after confirmation and consumes transferred stock once', async ({
    page,
  }) => {
    page.setDefaultTimeout(10_000);
    page.setDefaultNavigationTimeout(15_000);
    const identity = await authenticatedIdentity(page);
    const unique = `e2e-shopping-transfer-${randomUUID()}`;
    const ingredient = `${unique} lentejas`;
    const mealTitle = 'Desayuno con compra transferida';
    let shoppingId: string | null = null;
    let inventoryId: string | null = null;
    let planId: string | null = null;
    let operationError: unknown;

    try {
      const seeded = await database.query<{ id: string }>(
        `insert into public.shopping_list_items
           (tenant_id, user_id, source, ingredient_name, quantity, status)
         values ($1, $2, 'manual', $3, '2 kg', 'pending') returning id`,
        [identity.tenantId, identity.userId, ingredient]
      );
      shoppingId = seeded.rows[0]?.id ?? null;
      if (!shoppingId) throw new Error('Could not seed the purchased shopping row.');

      await page.goto('/shopping-list');
      const article = page
        .getByRole('article')
        .filter({ has: page.getByRole('heading', { name: ingredient }) });
      await expect(article.getByRole('button', { name: 'Marcar como comprado' })).toBeVisible();
      await article.getByRole('button', { name: 'Marcar como comprado' }).click();
      await expect(article.getByText('Estado: Comprado', { exact: true })).toBeVisible();
      await expect(article.getByRole('button', { name: 'Agregar al inventario' })).toBeVisible();
      page.once('dialog', (dialog) => dialog.dismiss());
      await article.getByRole('button', { name: 'Agregar al inventario' }).click();
      await expect(article.getByRole('button', { name: 'Agregar al inventario' })).toBeVisible();

      page.once('dialog', (dialog) => dialog.accept());
      await article.getByRole('button', { name: 'Agregar al inventario' }).click();
      await expect(article.getByRole('status')).toHaveText('Agregado al inventario');
      await page.reload();
      const reloadedArticle = page
        .getByRole('article')
        .filter({ has: page.getByRole('heading', { name: ingredient }) });
      await expect(reloadedArticle.getByRole('status')).toHaveText('Agregado al inventario');

      const replay = await page.request.post(`/api/shopping-list/${shoppingId}/inventory`, {
        timeout: 15_000,
      });
      expect(replay.ok()).toBeTruthy();
      const transfer = (await replay.json()) as { item: { transfer_inventory_item_id: string } };
      inventoryId = transfer.item.transfer_inventory_item_id;
      expect(inventoryId).toBeTruthy();
      const purchaseState = await database.query<{ quantity: string; movements: string }>(
        `select i.quantity::text as quantity,
                (select count(*)::text from public.inventory_movements m
                 where m.tenant_id=$1 and m.user_id=$2 and m.inventory_item_id=i.id and m.movement_type='purchase') movements
         from public.recipe_inventory_items i where i.id=$3 and i.tenant_id=$1 and i.user_id=$2`,
        [identity.tenantId, identity.userId, inventoryId]
      );
      expect(purchaseState.rows).toEqual([{ quantity: '2', movements: '1' }]);

      const plan = await database.query<{ id: string }>(
        `insert into public.user_meal_plans
           (tenant_id, user_id, people_count, period, mode, base_cuisine, fusion_cuisines,
            fusion_intensity, restrictions, inventory_snapshot, calendar_payload, ai_content, consumption_payload)
         values ($1, $2, 1, 'week', 'balanced_ai', 'E2E', '{}', 'media', '{}',
                 '{"inventoryLines":[]}'::jsonb, $3::jsonb, $4, '{}'::jsonb) returning id`,
        [
          identity.tenantId,
          identity.userId,
          JSON.stringify(mealPlan(ingredient, mealTitle)),
          `E2E shopping transfer ${unique}`,
        ]
      );
      planId = plan.rows[0]?.id ?? null;
      if (!planId) throw new Error('Could not seed the meal plan.');

      const restoredResponse = await page.request.get('/api/meal-plan', { timeout: 15_000 });
      const restoredPayload = (await restoredResponse.json()) as {
        id?: string;
        plan?: { days?: unknown[] } | null;
        error?: string;
      };
      expect(restoredResponse.status(), JSON.stringify(restoredPayload)).toBe(200);
      expect(restoredPayload.id).toBe(planId);
      expect(restoredPayload.plan?.days).toHaveLength(7);

      const consumptionResponse = await page.request.get(
        `/api/meal-plan/consumption?mealPlanId=${encodeURIComponent(planId)}`,
        { timeout: 15_000 }
      );
      const consumptionPayload = (await consumptionResponse.json()) as {
        consumptions?: Record<string, unknown>;
        error?: string;
      };
      expect(consumptionResponse.status(), JSON.stringify(consumptionPayload)).toBe(200);
      expect(consumptionPayload.consumptions).toEqual({});

      await page.goto('/meal-planner');
      await expect(page.getByRole('heading', { name: 'Menú generado' })).toBeVisible();
      await expect(
        page.getByText('Cargando comidas cocinadas...', { exact: true })
      ).not.toBeVisible();
      const meal = page.locator('article').filter({ hasText: `Desayuno: ${mealTitle}` });
      const cookButton = meal.getByRole('button', { name: `Ya cociné Desayuno: ${mealTitle}` });
      await expect(cookButton).toBeVisible();
      await expect(cookButton).toBeEnabled();
      await cookButton.click();
      await expect(page.getByRole('status')).toContainText('Comida registrada.');
      const consumed = await database.query<{ quantity: string; count: string }>(
        `select i.quantity::text as quantity,
                (select count(*)::text from public.inventory_movements m
                 where m.tenant_id=$1 and m.user_id=$2 and m.inventory_item_id=i.id
                   and m.movement_type='recipe_consumption') count
         from public.recipe_inventory_items i where i.id=$3 and i.tenant_id=$1 and i.user_id=$2`,
        [identity.tenantId, identity.userId, inventoryId]
      );
      expect(consumed.rows).toEqual([{ quantity: '1', count: '1' }]);
      const cookReplay = await page.request.post('/api/meal-plan/consumption', {
        data: { mealPlanId: planId, dayIndex: 1, mealType: 'breakfast' },
      });
      expect(cookReplay.ok()).toBeTruthy();
      expect(((await cookReplay.json()) as { alreadyConsumed?: boolean }).alreadyConsumed).toBe(
        true
      );
      const finalState = await database.query<{ quantity: string; count: string }>(
        `select i.quantity::text as quantity,
                (select count(*)::text from public.inventory_movements m
                 where m.tenant_id=$1 and m.user_id=$2 and m.inventory_item_id=i.id
                   and m.movement_type='recipe_consumption') count
         from public.recipe_inventory_items i where i.id=$3 and i.tenant_id=$1 and i.user_id=$2`,
        [identity.tenantId, identity.userId, inventoryId]
      );
      expect(finalState.rows).toEqual([{ quantity: '1', count: '1' }]);
    } catch (error) {
      operationError = error;
      throw error;
    } finally {
      try {
        if (
          planId &&
          (await hasAppendOnlyE2EReferences(database, identity.tenantId, identity.userId, [planId]))
        ) {
          return;
        }
        if (planId)
          await database.query(
            'delete from public.user_meal_plans where id=$1 and tenant_id=$2 and user_id=$3',
            [planId, identity.tenantId, identity.userId]
          );
        if (inventoryId)
          await database.query(
            'delete from public.inventory_movements where tenant_id=$1 and user_id=$2 and inventory_item_id=$3',
            [identity.tenantId, identity.userId, inventoryId]
          );
        if (shoppingId)
          await database.query(
            'delete from public.shopping_list_items where id=$1 and tenant_id=$2 and user_id=$3',
            [shoppingId, identity.tenantId, identity.userId]
          );
        if (inventoryId)
          await database.query(
            'delete from public.recipe_inventory_items where id=$1 and tenant_id=$2 and user_id=$3',
            [inventoryId, identity.tenantId, identity.userId]
          );
      } catch (cleanupError) {
        if (operationError)
          throw new AggregateError([operationError, cleanupError], 'Test and cleanup both failed.');
        throw cleanupError;
      }
    }
  });
});
