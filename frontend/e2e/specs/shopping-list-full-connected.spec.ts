import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import { injectAuth } from '../fixtures/auth';

const database = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://cocinacore_user:cocinacore_password@localhost:5433/cocinacore_local_db',
});

type Identity = { userId: string; tenantId: string };
type InventoryRow = Record<string, unknown> & {
  id: string;
  tenant_id: string;
  user_id: string;
};
type ShoppingRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  source: string;
  ingredient_name: string;
  quantity: string | null;
  status: 'pending' | 'purchased';
};

type Seed = {
  identity: Identity;
  planId: string;
  inventoryIds: string[];
  source: string;
  shortageName: string;
  shortageNormalizedName: string;
};

async function authenticatedIdentity(page: Page): Promise<Identity> {
  await injectAuth(page, undefined, { allowSignup: false });
  const response = await page.request.get('/api/profile');
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as {
    user?: { id?: string; tenant?: { tenantId?: string } | null };
  };
  const userId = payload.user?.id;
  const tenantId = payload.user?.tenant?.tenantId;
  if (!userId || !tenantId) throw new Error('Authenticated E2E identity is missing user or tenant.');
  return { userId, tenantId };
}

function canonicalPlan(shortageName: string, coveredName: string) {
  return {
    period: 'week',
    dayCount: 7,
    days: Array.from({ length: 7 }, (_, index) => ({
      dayIndex: index + 1,
      label: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'][index],
      meals: [
        {
          mealType: 'breakfast',
          title: 'Desayuno conectado',
          description: null,
          ingredients: index === 0
            ? [{ name: shortageName, quantity: 1, unit: 'kg' }, { name: coveredName, quantity: 0.1, unit: 'kg' }]
            : [{ name: coveredName, quantity: 0.1, unit: 'kg' }],
        },
        { mealType: 'lunch', title: 'Almuerzo conectado', description: null, ingredients: [{ name: coveredName, quantity: 0.1, unit: 'kg' }] },
        { mealType: 'dinner', title: 'Cena conectada', description: null, ingredients: [{ name: coveredName, quantity: 0.1, unit: 'kg' }] },
      ],
    })),
  };
}

async function ownedInventory(
  identity: Identity,
  inventoryIds: string[]
): Promise<InventoryRow[]> {
  if (inventoryIds.length === 0) return [];
  const result = await database.query<InventoryRow>(
    `select * from public.recipe_inventory_items
     where tenant_id = $1 and user_id = $2 and id = any($3::uuid[])
     order by id`,
    [identity.tenantId, identity.userId, inventoryIds]
  );
  return result.rows;
}

test.describe('Connected full Meal Planner to Shopping List journey', () => {
  test.afterAll(async () => {
    await database.end();
  });

  test('confirms, purchases, reloads, and rehydrates one planner shortage without mutating inventory', async ({ page }) => {
    const identity = await authenticatedIdentity(page);
    const unique = `e2e-m1-5-4-${randomUUID()}`;
    const shortageName = `${unique} shortage ingredient`;
    const coveredName = `${unique} covered ingredient`;
    const shortageNormalizedName = shortageName.toLowerCase();
    let seed: Seed | null = null;
    let inventoryBefore: InventoryRow[] = [];

    try {
      const inventoryResult = await database.query<{ id: string }>(
        `insert into public.recipe_inventory_items
           (tenant_id, user_id, ingredient_name, quantity, unit, category, normalized_name)
         values ($1, $2, $3, '0.25', 'kg', 'e2e', $3),
                ($1, $2, $4, '1000', 'kg', 'e2e', $4)
         returning id`,
        [identity.tenantId, identity.userId, shortageName, coveredName]
      );
      const inventoryIds = inventoryResult.rows.map((row) => row.id);
      if (inventoryIds.length !== 2) throw new Error('Failed to seed the owned inventory row.');

      const planResult = await database.query<{ id: string }>(
        `insert into public.user_meal_plans
           (tenant_id, user_id, people_count, period, mode, base_cuisine, fusion_cuisines,
            fusion_intensity, restrictions, inventory_snapshot, calendar_payload, ai_content)
         values ($1, $2, 2, 'week', 'balanced_ai', 'E2E', '{}', 'media', '{}',
                 '{"inventoryLines":[]}'::jsonb, $3::jsonb, 'E2E connected canonical plan')
         returning id`,
        [identity.tenantId, identity.userId, JSON.stringify(canonicalPlan(shortageName, coveredName))]
      );
      const planId = planResult.rows[0]?.id;
      if (!planId) throw new Error('Failed to seed the canonical meal plan.');

      const source = `meal-plan:${planId}`;
      seed = {
        identity,
        planId,
        inventoryIds,
        source,
        shortageName,
        shortageNormalizedName,
      };
      inventoryBefore = await ownedInventory(identity, inventoryIds);
      expect(inventoryBefore).toHaveLength(2);

      const beforeConfirmation = await database.query<{ count: string }>(
        `select count(*)::text as count from public.shopping_list_items
         where tenant_id = $1 and user_id = $2 and source = $3`,
        [identity.tenantId, identity.userId, source]
      );
      expect(beforeConfirmation.rows[0]?.count).toBe('0');

      await page.goto('/meal-planner');
      await expect(page.getByRole('heading', { name: 'Planificador de menú' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Menú generado' })).toBeVisible();
      const suggestions = page.locator('section[aria-busy]');
      await expect(suggestions.getByRole('heading', { name: 'Faltantes para este menú' })).toBeVisible();
      const shortageCard = suggestions.locator('li').filter({ hasText: shortageName });
      await expect(shortageCard).toHaveCount(1);
      await expect(shortageCard.getByText(shortageName, { exact: true })).toBeVisible();
      await expect(shortageCard.getByText('Requerido: 1 kg · Disponible: 0.25 kg')).toBeVisible();
      await expect(shortageCard.getByText('Para comprar: 0.75 kg')).toBeVisible();

      const shortageCheckbox = shortageCard.getByRole('checkbox', { name: new RegExp(shortageName, 'i') });
      await expect(shortageCheckbox).toBeChecked();
      await shortageCheckbox.uncheck();
      await expect(shortageCheckbox).not.toBeChecked();
      await shortageCheckbox.check();
      await expect(shortageCheckbox).toBeChecked();

      const addButton = suggestions.getByRole('button', { name: 'Agregar seleccionados a compras' });
      await addButton.click();
      await expect(page.getByText('Se agregaron 1 artículo.', { exact: true })).toBeVisible();

      const addedResult = await database.query<ShoppingRow>(
        `select id, tenant_id, user_id, source, ingredient_name, quantity, status
         from public.shopping_list_items
         where tenant_id = $1 and user_id = $2 and source = $3`,
        [identity.tenantId, identity.userId, source]
      );
      expect(addedResult.rows).toHaveLength(1);
      const addedRow = addedResult.rows[0];
      if (!addedRow) throw new Error('The planner did not persist a shopping row.');
      expect(addedRow).toMatchObject({
        tenant_id: identity.tenantId,
        user_id: identity.userId,
        source,
        ingredient_name: shortageName,
        quantity: '0.75 kg',
        status: 'pending',
      });

      await page.goto('/app');
      await page.getByRole('link', { name: 'Compras', exact: true }).click();
      await expect(page).toHaveURL('/shopping-list');
      const shoppingArticle = page
        .getByRole('article')
        .filter({ has: page.getByRole('heading', { name: shortageName, exact: true }) });
      await expect(shoppingArticle).toHaveCount(1);
      await expect(shoppingArticle).toContainText('Cantidad: 0.75 kg');
      await expect(shoppingArticle).toContainText('Estado: Pendiente');
      await expect(shoppingArticle).toContainText('Desde el planificador');
      await expect(page.locator('body')).not.toContainText(source);
      await expect(page.getByText(source, { exact: true })).toHaveCount(0);

      const inventoryRequests: string[] = [];
      const requestListener = (request: { method(): string; url(): string }) => {
        if (request.url().includes('/api/inventory')) inventoryRequests.push(request.url());
      };
      page.on('request', requestListener);
      await shoppingArticle.getByRole('button', { name: 'Marcar como comprado' }).click();
      await expect(shoppingArticle.getByText('Estado: Comprado', { exact: true })).toBeVisible();
      page.off('request', requestListener);
      expect(inventoryRequests).toEqual([]);

      const purchasedResult = await database.query<ShoppingRow>(
        `select id, tenant_id, user_id, source, ingredient_name, quantity, status
         from public.shopping_list_items
         where id = $1 and tenant_id = $2 and user_id = $3 and source = $4`,
        [addedRow.id, identity.tenantId, identity.userId, source]
      );
      expect(purchasedResult.rows).toHaveLength(1);
      expect(purchasedResult.rows[0]).toMatchObject({
        id: addedRow.id,
        tenant_id: identity.tenantId,
        user_id: identity.userId,
        source,
        ingredient_name: shortageName,
        quantity: '0.75 kg',
        status: 'purchased',
      });

      await page.reload();
      const reloadedArticle = page
        .getByRole('article')
        .filter({ has: page.getByRole('heading', { name: shortageName, exact: true }) });
      await expect(reloadedArticle).toContainText('Cantidad: 0.75 kg');
      await expect(reloadedArticle).toContainText('Estado: Comprado');
      await expect(reloadedArticle).toContainText('Desde el planificador');

      await page.goto('/app');
      await page.getByRole('link', { name: 'Planificador', exact: true }).click();
      await expect(page).toHaveURL('/meal-planner');
      const returnedSuggestions = page.locator('section[aria-busy]');
      const returnedShortageCard = returnedSuggestions.locator('li').filter({ hasText: shortageName });
      await expect(returnedShortageCard).toHaveCount(1);
      await expect(returnedShortageCard.getByText('Ya comprado', { exact: true })).toBeVisible();
      const returnedCheckbox = returnedShortageCard.getByRole('checkbox', { name: new RegExp(shortageName, 'i') });
      await expect(returnedCheckbox).toBeDisabled();

      const idempotencyResponse = await page.request.post('/api/meal-plan/shopping-suggestions', {
        data: { mealPlanId: seed.planId, selectedItems: [seed.shortageNormalizedName] },
      });
      expect(idempotencyResponse.ok()).toBeTruthy();
      await expect(idempotencyResponse.json()).resolves.toMatchObject({
        added: [],
        alreadyPresent: [expect.objectContaining({
          ingredient_name: shortageName,
          status: 'purchased',
        })],
        ignored: [],
      });

      const afterIdempotency = await database.query<{ count: string }>(
        `select count(*)::text as count from public.shopping_list_items
         where tenant_id = $1 and user_id = $2 and source = $3`,
        [identity.tenantId, identity.userId, source]
      );
      expect(afterIdempotency.rows[0]?.count).toBe('1');

      const inventoryAfter = await ownedInventory(identity, seed.inventoryIds);
      expect(inventoryAfter).toEqual(inventoryBefore);
    } finally {
      if (seed) {
        const ownedShopping = await database.query<{ id: string }>(
          `select id from public.shopping_list_items
           where tenant_id = $1 and user_id = $2 and source = $3`,
          [seed.identity.tenantId, seed.identity.userId, seed.source]
        );
        const ownedShoppingIds = ownedShopping.rows.map((row) => row.id);
        if (ownedShoppingIds.length > 0) {
          await database.query(
            `delete from public.shopping_list_items
             where tenant_id = $1 and user_id = $2 and source = $3 and id = any($4::uuid[])`,
            [seed.identity.tenantId, seed.identity.userId, seed.source, ownedShoppingIds]
          );
        }
        await database.query(
          'delete from public.user_meal_plans where id = $1 and tenant_id = $2 and user_id = $3',
          [seed.planId, seed.identity.tenantId, seed.identity.userId]
        );
        await database.query(
          `delete from public.recipe_inventory_items
           where tenant_id = $1 and user_id = $2 and id = any($3::uuid[])`,
          [seed.identity.tenantId, seed.identity.userId, seed.inventoryIds]
        );

        const remainingShopping = await database.query<{ count: string }>(
          `select count(*)::text as count from public.shopping_list_items
           where tenant_id = $1 and user_id = $2 and source = $3`,
          [seed.identity.tenantId, seed.identity.userId, seed.source]
        );
        const remainingPlan = await database.query<{ count: string }>(
          `select count(*)::text as count from public.user_meal_plans
           where id = $1 and tenant_id = $2 and user_id = $3`,
          [seed.planId, seed.identity.tenantId, seed.identity.userId]
        );
        const remainingInventory = await database.query<{ count: string }>(
          `select count(*)::text as count from public.recipe_inventory_items
           where tenant_id = $1 and user_id = $2 and id = any($3::uuid[])`,
          [seed.identity.tenantId, seed.identity.userId, seed.inventoryIds]
        );
        expect(remainingShopping.rows[0]?.count).toBe('0');
        expect(remainingPlan.rows[0]?.count).toBe('0');
        expect(remainingInventory.rows[0]?.count).toBe('0');
      }
    }
  });
});
