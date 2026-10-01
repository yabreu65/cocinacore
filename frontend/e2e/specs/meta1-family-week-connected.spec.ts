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
type CleanupSeed = {
  identity: Identity;
  ingredientName: string;
  inventoryIds: string[];
  planMarker: string;
  planId: string | null;
  source: string | null;
};
type CleanupCounts = { movements: string; shopping: string; plans: string; inventory: string };

const mealLabels = {
  breakfast: 'Desayuno',
  lunch: 'Almuerzo',
  dinner: 'Cena',
} as const;
const mealTypes = ['breakfast', 'lunch', 'dinner'] as const;

async function authenticatedIdentity(page: Page): Promise<Identity> {
  await injectAuth(page, undefined, { allowSignup: true });
  const response = await page.request.get('/api/profile');
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as {
    user?: { id?: string; tenant?: { tenantId?: string } | null };
  };
  const userId = payload.user?.id;
  const tenantId = payload.user?.tenant?.tenantId;
  if (!userId || !tenantId)
    throw new Error('Authenticated E2E identity is missing user or tenant.');
  return { userId, tenantId };
}

function canonicalWeekPlan(ingredientName: string) {
  const labels = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  return {
    period: 'week',
    dayCount: 7,
    days: Array.from({ length: 7 }, (_, index) => ({
      dayIndex: index + 1,
      label: labels[index],
      meals: mealTypes.map((mealType) => ({
        mealType,
        title: `${mealLabels[mealType]} familiar ${index + 1}`,
        description: null,
        ingredients: [{ name: ingredientName, quantity: 0.1, unit: 'kg' }],
      })),
    })),
  };
}

async function ingredientInventory(identity: Identity, ingredientName: string) {
  return database.query<{ id: string; quantity: string | null; unit: string | null }>(
    `select id, quantity, unit from public.recipe_inventory_items
      where tenant_id=$1 and user_id=$2 and ingredient_name=$3
      order by created_at, id`,
    [identity.tenantId, identity.userId, ingredientName]
  );
}

function inventoryTotal(rows: Array<{ quantity: string | null }>): number {
  return Number(rows.reduce((sum, row) => sum + Number(row.quantity ?? 0), 0).toFixed(4));
}

async function cleanupTestData(seed: CleanupSeed): Promise<void> {
  const failures: unknown[] = [];
  const attempt = async (operation: () => Promise<unknown>) => {
    try {
      await operation();
    } catch (error) {
      failures.push(error);
    }
  };
  const { tenantId, userId } = seed.identity;
  const planIds = new Set<string>(seed.planId ? [seed.planId] : []);
  const sources = new Set<string>(seed.source ? [seed.source] : []);
  await attempt(async () => {
    const plans = await database.query<{ id: string }>(
      `select id from public.user_meal_plans
        where tenant_id=$1 and user_id=$2 and ai_content=$3`,
      [tenantId, userId, seed.planMarker]
    );
    for (const plan of plans.rows) {
      planIds.add(plan.id);
      sources.add(`meal-plan:${plan.id}`);
    }
  });

  for (const planId of planIds) {
    await attempt(() => database.query(
      `delete from public.inventory_movements
        where tenant_id=$1 and user_id=$2 and source_meal_plan_id=$3`,
      [tenantId, userId, planId]
    ));
    await attempt(() => database.query(
      `delete from public.user_meal_plans where id=$1 and tenant_id=$2 and user_id=$3`,
      [planId, tenantId, userId]
    ));
  }
  for (const source of sources) {
    await attempt(() => database.query(
      `delete from public.shopping_list_items
        where tenant_id=$1 and user_id=$2 and source=$3 and ingredient_name=$4`,
      [tenantId, userId, source, seed.ingredientName]
    ));
  }
  await attempt(() => database.query(
    `delete from public.recipe_inventory_items
      where tenant_id=$1 and user_id=$2
        and (id=any($4::uuid[]) or ingredient_name=$3)`,
    [tenantId, userId, seed.ingredientName, seed.inventoryIds]
  ));

  let leftovers: CleanupCounts | null = null;
  await attempt(async () => {
    const result = await database.query<CleanupCounts>(
      `select
         (select count(*)::text from public.inventory_movements
           where tenant_id=$1 and user_id=$2 and source_meal_plan_id=any($3::uuid[])) as movements,
         (select count(*)::text from public.shopping_list_items
           where tenant_id=$1 and user_id=$2 and source=any($4::text[]) and ingredient_name=$5) as shopping,
         (select count(*)::text from public.user_meal_plans
           where tenant_id=$1 and user_id=$2 and (id=any($3::uuid[]) or ai_content=$6)) as plans,
         (select count(*)::text from public.recipe_inventory_items
           where tenant_id=$1 and user_id=$2 and ingredient_name=$5) as inventory`,
      [tenantId, userId, Array.from(planIds), Array.from(sources), seed.ingredientName, seed.planMarker]
    );
    leftovers = result.rows[0] ?? null;
  });
  if (!leftovers || Object.values(leftovers).some((count) => count !== '0')) {
    failures.push(new Error(`Test cleanup left scoped data behind: ${JSON.stringify(leftovers)}`));
  }
  if (failures.length) throw new AggregateError(failures, 'Failed to clean up family-week E2E data.');
}

test.describe('META 1 full family week', () => {
  test.afterAll(async () => {
    await database.end();
  });

  test('completes a seven-day household loop from shortage to purchase, stock intake, cooking, and exact final inventory', async ({
    page,
  }) => {
    const identity = await authenticatedIdentity(page);
    const unique = `e2e-m1-7-${randomUUID()}`;
    const ingredientName = `${unique} arroz familiar`;
    const normalizedName = ingredientName.toLowerCase();
    const planMarker = `E2E META 1 family week ${unique}`;
    const seed: CleanupSeed = {
      identity,
      ingredientName,
      inventoryIds: [],
      planMarker,
      planId: null,
      source: null,
    };
    let operationError: unknown;

    try {
      const inventory = await database.query<{ id: string }>(
        `insert into public.recipe_inventory_items
           (tenant_id, user_id, ingredient_name, quantity, unit, category, normalized_name)
         values ($1,$2,$3,'1.4','kg','e2e',$4)
         returning id`,
        [identity.tenantId, identity.userId, ingredientName, normalizedName]
      );
      seed.inventoryIds.push(...inventory.rows.map((row) => row.id));
      expect(inventory.rows).toHaveLength(1);

      const plan = await database.query<{ id: string }>(
        `insert into public.user_meal_plans
           (tenant_id, user_id, people_count, period, mode, base_cuisine, fusion_cuisines,
            fusion_intensity, restrictions, inventory_snapshot, calendar_payload, ai_content, consumption_payload)
         values ($1,$2,4,'week','balanced_ai','E2E','{}','media','{}',
                 '{"inventoryLines":[]}'::jsonb,$3::jsonb,$4,'{}'::jsonb)
         returning id`,
        [identity.tenantId, identity.userId, JSON.stringify(canonicalWeekPlan(ingredientName)), planMarker]
      );
      const planId = plan.rows[0]?.id;
      if (!planId) throw new Error('Failed to seed the family week plan.');
      seed.planId = planId;
      seed.source = `meal-plan:${planId}`;
      const source = seed.source;

      await page.goto('/meal-planner');
      await expect(page.getByRole('heading', { name: 'Menú generado' })).toBeVisible();
      const suggestions = page.locator('section[aria-busy]');
      const shortage = suggestions.locator('li').filter({ hasText: ingredientName });
      await expect(shortage).toHaveCount(1);
      await expect(shortage).toContainText('Requerido: 2.1 kg · Disponible: 1.4 kg');
      await expect(shortage).toContainText('Para comprar: 0.7 kg');
      await shortage.getByRole('checkbox', { name: new RegExp(ingredientName, 'i') }).check();
      await suggestions.getByRole('button', { name: 'Agregar seleccionados a compras' }).click();
      await expect(page.getByText('Se agregaron 1 artículo.', { exact: true })).toBeVisible();

      const shoppingBeforePurchase = await database.query<{
        id: string;
        quantity: string | null;
        status: string;
      }>(
        `select id, quantity, status from public.shopping_list_items
          where tenant_id=$1 and user_id=$2 and source=$3 and ingredient_name=$4`,
        [identity.tenantId, identity.userId, source, ingredientName]
      );
      expect(shoppingBeforePurchase.rows).toHaveLength(1);
      expect(shoppingBeforePurchase.rows[0]).toMatchObject({
        quantity: '0.7 kg',
        status: 'pending',
      });

      await page.goto('/app');
      await page.getByRole('link', { name: 'Compras', exact: true }).click();
      const shoppingArticle = page
        .getByRole('article')
        .filter({ has: page.getByRole('heading', { name: ingredientName, exact: true }) });
      await expect(shoppingArticle).toContainText('Cantidad: 0.7 kg');
      await shoppingArticle.getByRole('button', { name: 'Marcar como comprado' }).click();
      await expect(shoppingArticle.getByText('Estado: Comprado', { exact: true })).toBeVisible();

      const inventoryAfterPurchaseFlag = await ingredientInventory(identity, ingredientName);
      expect(inventoryAfterPurchaseFlag.rows).toHaveLength(1);
      expect(inventoryTotal(inventoryAfterPurchaseFlag.rows)).toBe(1.4);

      await page.goto('/app');
      await page.getByRole('link', { name: 'Inventario', exact: true }).click();
      await expect(page).toHaveURL('/recipes/inventory');
      await page.getByPlaceholder('Ingrediente').fill(ingredientName);
      await page.getByPlaceholder('Cantidad').fill('0.7');
      await page.getByPlaceholder('Unidad').fill('kg');
      await page.getByRole('button', { name: 'Agregar', exact: true }).click();
      await expect(page.getByText(ingredientName, { exact: true })).toHaveCount(2);

      const stockedInventory = await ingredientInventory(identity, ingredientName);
      seed.inventoryIds.push(...stockedInventory.rows.map((row) => row.id));
      expect(stockedInventory.rows).toHaveLength(2);
      expect(inventoryTotal(stockedInventory.rows)).toBe(2.1);
      expect(stockedInventory.rows.every((row) => row.unit === 'kg')).toBe(true);

      await page.goto('/app');
      await page.getByRole('link', { name: 'Planificador', exact: true }).click();
      await expect(page).toHaveURL('/meal-planner');
      await expect(page.getByText('No hay faltantes accionables para este menú.')).toBeVisible();
      await expect(page.locator('article').filter({ hasText: ingredientName })).toHaveCount(21);

      for (let dayIndex = 1; dayIndex <= 7; dayIndex += 1) {
        for (const mealType of mealTypes) {
          const title = `${mealLabels[mealType]} familiar ${dayIndex}`;
          const article = page.locator('article').filter({
            hasText: `${mealLabels[mealType]}: ${title}`,
          });
          const button = article.getByRole('button', {
            name: `Ya cociné ${mealLabels[mealType]}: ${title}`,
          });
          await expect(button).toBeVisible();
          await button.click();
          await expect(article.getByText('Cocinado', { exact: true })).toBeVisible();
          await expect(button).toHaveCount(0);
        }
      }

      const finalInventory = await ingredientInventory(identity, ingredientName);
      expect(finalInventory.rows).toHaveLength(2);
      expect(inventoryTotal(finalInventory.rows)).toBe(0);
      expect(finalInventory.rows.every((row) => Number(row.quantity ?? 0) >= 0)).toBe(true);

      const movementSummary = await database.query<{
        count: string;
        distinct_sources: string;
        total_quantity: string;
      }>(
        `select count(*)::text as count,
                count(distinct source)::text as distinct_sources,
                coalesce(sum(quantity),0)::text as total_quantity
           from public.inventory_movements
          where tenant_id=$1 and user_id=$2 and source_meal_plan_id=$3
            and movement_type='recipe_consumption'`,
        [identity.tenantId, identity.userId, planId]
      );
      expect(movementSummary.rows[0]?.count).toBe('21');
      expect(movementSummary.rows[0]?.distinct_sources).toBe('21');
      expect(Number(movementSummary.rows[0]?.total_quantity)).toBe(2.1);

      const persisted = await database.query<{ consumption_payload: Record<string, unknown> }>(
        `select consumption_payload from public.user_meal_plans
          where id=$1 and tenant_id=$2 and user_id=$3`,
        [planId, identity.tenantId, identity.userId]
      );
      expect(Object.keys(persisted.rows[0]?.consumption_payload ?? {})).toHaveLength(21);

      const purchasedRow = await database.query<{ status: string; quantity: string | null }>(
        `select status, quantity from public.shopping_list_items
          where tenant_id=$1 and user_id=$2 and source=$3 and ingredient_name=$4`,
        [identity.tenantId, identity.userId, source, ingredientName]
      );
      expect(purchasedRow.rows).toEqual([{ status: 'purchased', quantity: '0.7 kg' }]);

      await expect(page.getByText('No hay faltantes accionables para este menú.')).toBeVisible();
      await page.reload();
      await expect(page.getByText('Cocinado', { exact: true })).toHaveCount(21);
      await expect(page.getByText('No hay faltantes accionables para este menú.')).toBeVisible();

      const replay = await page.request.post('/api/meal-plan/consumption', {
        data: { mealPlanId: planId, dayIndex: 1, mealType: 'breakfast' },
      });
      expect(replay.ok()).toBeTruthy();
      await expect(replay.json()).resolves.toMatchObject({ alreadyConsumed: true });

      const replayInventory = await ingredientInventory(identity, ingredientName);
      expect(inventoryTotal(replayInventory.rows)).toBe(0);
      const replayMovementCount = await database.query<{ count: string }>(
        `select count(*)::text as count from public.inventory_movements
          where tenant_id=$1 and user_id=$2 and source_meal_plan_id=$3
            and movement_type='recipe_consumption'`,
        [identity.tenantId, identity.userId, planId]
      );
      expect(replayMovementCount.rows[0]?.count).toBe('21');
    } catch (error) {
      operationError = error;
      throw error;
    } finally {
      try {
        await cleanupTestData(seed);
      } catch (cleanupError) {
        if (operationError) {
          throw new AggregateError(
            [operationError, cleanupError],
            'Family-week test failed and cleanup also failed.'
          );
        }
        throw cleanupError;
      }
    }
  });

  test('cleans inventory when plan setup fails its database constraint', async ({ page }) => {
    const identity = await authenticatedIdentity(page);
    const unique = `e2e-m1-7-setup-failure-${randomUUID()}`;
    const ingredientName = `${unique} arroz familiar`;
    const seed: CleanupSeed = {
      identity,
      ingredientName,
      inventoryIds: [],
      planMarker: `E2E META 1 setup failure ${unique}`,
      planId: null,
      source: null,
    };

    try {
      const inventory = await database.query<{ id: string }>(
        `insert into public.recipe_inventory_items
           (tenant_id, user_id, ingredient_name, quantity, unit, category, normalized_name)
         values ($1,$2,$3,'1.4','kg','e2e',$4)
         returning id`,
        [identity.tenantId, identity.userId, ingredientName, ingredientName.toLowerCase()]
      );
      seed.inventoryIds.push(...inventory.rows.map((row) => row.id));
      await expect(database.query(
        `insert into public.user_meal_plans
           (tenant_id, user_id, period, mode, ai_content)
         values ($1,$2,'invalid-period','balanced_ai',$3)`,
        [identity.tenantId, identity.userId, seed.planMarker]
      )).rejects.toThrow();
    } finally {
      await cleanupTestData(seed);
    }
  });
});
