import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { Pool } from 'pg';
import { injectAuth } from '../fixtures/auth';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://cocinacore_user:cocinacore_password@localhost:5433/cocinacore_local_db';
const database = new Pool({ connectionString: DATABASE_URL });

type Identity = { userId: string; tenantId: string };
type Seed = {
  identity: Identity;
  planId: string;
  inventoryIds: string[];
  trackedInventoryId: string;
  source: string;
};

type MovementRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  inventory_item_id: string;
  movement_type: string;
  quantity: string;
  unit: string;
  normalized_name: string;
  source: string;
  source_recipe: string | null;
  source_meal_plan_id: string | null;
  notes: string | null;
};

async function authenticatedIdentity(page: Parameters<typeof injectAuth>[0]): Promise<Identity> {
  await injectAuth(page, undefined, { allowSignup: false });
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

function canonicalPlan(trackedName: string, missingName: string, controlName: string) {
  return {
    period: 'week',
    dayCount: 7,
    days: Array.from({ length: 7 }, (_, index) => ({
      dayIndex: index + 1,
      label: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'][index],
      meals: [
        {
          mealType: 'breakfast',
          title: index === 0 ? 'Desayuno para consumir' : `Desayuno conectado ${index + 1}`,
          description: null,
          ingredients:
            index === 0
              ? [
                  { name: trackedName, quantity: 1, unit: 'kg' },
                  { name: missingName, quantity: 0.5, unit: 'kg' },
                ]
              : [{ name: controlName, quantity: 0.01, unit: 'kg' }],
        },
        {
          mealType: 'lunch',
          title: `Almuerzo conectado ${index + 1}`,
          description: null,
          ingredients: [{ name: controlName, quantity: 0.01, unit: 'kg' }],
        },
        {
          mealType: 'dinner',
          title: `Cena conectada ${index + 1}`,
          description: null,
          ingredients: [{ name: controlName, quantity: 0.01, unit: 'kg' }],
        },
      ],
    })),
  };
}

test.describe('Connected cooked meal consumption', () => {
  test.afterAll(async () => {
    await database.end();
  });

  test('confirms one cooked meal, decrements inventory once, persists evidence, and replays idempotently', async ({
    page,
  }) => {
    const identity = await authenticatedIdentity(page);
    const unique = `e2e-m1-6-3-${randomUUID()}`;
    const trackedName = `${unique} tracked ingredient`;
    const missingName = `${unique} missing ingredient`;
    const controlName = `${unique} control ingredient`;
    const mealTitle = 'Desayuno para consumir';
    let seed: Seed | null = null;

    try {
      const inventoryResult = await database.query<{ id: string; ingredient_name: string }>(
        `insert into public.recipe_inventory_items
           (tenant_id, user_id, ingredient_name, quantity, unit, category, normalized_name)
         values ($1, $2, $3, '1.25', 'kg', 'e2e', $3),
                ($1, $2, $4, '1000', 'kg', 'e2e', $4)
         returning id, ingredient_name`,
        [identity.tenantId, identity.userId, trackedName, controlName]
      );
      const inventoryIds = inventoryResult.rows.map((row) => row.id);
      const trackedInventoryId = inventoryResult.rows.find(
        (row) => row.ingredient_name === trackedName
      )?.id;
      if (inventoryIds.length !== 2 || !trackedInventoryId)
        throw new Error('Failed to seed owned inventory.');

      const planResult = await database.query<{ id: string }>(
        `insert into public.user_meal_plans
           (tenant_id, user_id, people_count, period, mode, base_cuisine, fusion_cuisines,
            fusion_intensity, restrictions, inventory_snapshot, calendar_payload, ai_content, consumption_payload)
         values ($1, $2, 2, 'week', 'balanced_ai', 'E2E', '{}', 'media', '{}',
                 '{"inventoryLines":[]}'::jsonb, $3::jsonb, 'E2E connected consumption plan', '{}'::jsonb)
         returning id`,
        [
          identity.tenantId,
          identity.userId,
          JSON.stringify(canonicalPlan(trackedName, missingName, controlName)),
        ]
      );
      const planId = planResult.rows[0]?.id;
      if (!planId) throw new Error('Failed to seed canonical meal plan.');
      const source = `meal-plan-consumption:${planId}:1:breakfast`;
      seed = { identity, planId, inventoryIds, trackedInventoryId, source };

      const beforeInventory = await database.query<{ quantity: string | null }>(
        `select quantity from public.recipe_inventory_items
          where id=$1 and tenant_id=$2 and user_id=$3`,
        [trackedInventoryId, identity.tenantId, identity.userId]
      );
      expect(beforeInventory.rows[0]?.quantity).toBe('1.25');

      const beforeMovements = await database.query<{ count: string }>(
        `select count(*)::text as count from public.inventory_movements
          where tenant_id=$1 and user_id=$2 and source=$3`,
        [identity.tenantId, identity.userId, source]
      );
      expect(beforeMovements.rows[0]?.count).toBe('0');

      const beforeShopping = await database.query<{ count: string }>(
        `select count(*)::text as count from public.shopping_list_items
          where tenant_id=$1 and user_id=$2 and source=$3`,
        [identity.tenantId, identity.userId, `meal-plan:${planId}`]
      );
      expect(beforeShopping.rows[0]?.count).toBe('0');

      await page.goto('/meal-planner');
      await expect(page.getByRole('heading', { name: 'Menú generado' })).toBeVisible();
      const mealArticle = page.locator('article').filter({ hasText: `Desayuno: ${mealTitle}` });
      const cookButton = mealArticle.getByRole('button', {
        name: `Ya cociné Desayuno: ${mealTitle}`,
      });
      await expect(cookButton).toBeVisible();
      await cookButton.click();

      const status = page.getByRole('status');
      await expect(status).toContainText('Comida registrada.');
      await expect(status).toContainText('Se actualizaron 1 existencia del inventario.');
      await expect(status).toContainText('1 ingrediente quedó sin descuento automático.');
      await expect(mealArticle.getByText('Cocinado', { exact: true })).toBeVisible();
      await expect(cookButton).toHaveCount(0);

      const afterInventory = await database.query<{ quantity: string | null }>(
        `select quantity from public.recipe_inventory_items
          where id=$1 and tenant_id=$2 and user_id=$3`,
        [trackedInventoryId, identity.tenantId, identity.userId]
      );
      expect(afterInventory.rows[0]?.quantity).toBe('0.25');

      const movement = await database.query<MovementRow>(
        `select * from public.inventory_movements
          where tenant_id=$1 and user_id=$2 and source=$3`,
        [identity.tenantId, identity.userId, source]
      );
      expect(movement.rows).toHaveLength(1);
      expect(movement.rows[0]).toMatchObject({
        tenant_id: identity.tenantId,
        user_id: identity.userId,
        inventory_item_id: trackedInventoryId,
        movement_type: 'recipe_consumption',
        unit: 'kg',
        normalized_name: trackedName,
        source,
        source_recipe: mealTitle,
        source_meal_plan_id: planId,
        notes: 'Confirmed by user via Ya cociné',
      });
      expect(Number(movement.rows[0]?.quantity)).toBe(1);

      const persistedPlan = await database.query<{ consumption_payload: Record<string, unknown> }>(
        `select consumption_payload from public.user_meal_plans
          where id=$1 and tenant_id=$2 and user_id=$3`,
        [planId, identity.tenantId, identity.userId]
      );
      const persistedRecord = persistedPlan.rows[0]?.consumption_payload['1:breakfast'] as
        | {
            dayIndex?: number;
            mealType?: string;
            mealTitle?: string;
            decrements?: unknown[];
            skipped?: Array<{ ingredientName?: string; reason?: string }>;
            consumedAt?: string;
          }
        | undefined;
      expect(persistedRecord).toMatchObject({
        dayIndex: 1,
        mealType: 'breakfast',
        mealTitle,
      });
      expect(persistedRecord?.decrements).toHaveLength(1);
      expect(persistedRecord?.skipped).toEqual([
        expect.objectContaining({ ingredientName: missingName, reason: 'not_in_inventory' }),
      ]);
      expect(Date.parse(persistedRecord?.consumedAt ?? '')).not.toBeNaN();

      await page.reload();
      const rehydratedArticle = page
        .locator('article')
        .filter({ hasText: `Desayuno: ${mealTitle}` });
      await expect(rehydratedArticle.getByText('Cocinado', { exact: true })).toBeVisible();
      await expect(
        rehydratedArticle.getByRole('button', { name: `Ya cociné Desayuno: ${mealTitle}` })
      ).toHaveCount(0);

      const replay = await page.request.post('/api/meal-plan/consumption', {
        data: { mealPlanId: planId, dayIndex: 1, mealType: 'breakfast' },
      });
      expect(replay.ok()).toBeTruthy();
      const replayBody = (await replay.json()) as {
        alreadyConsumed?: boolean;
        record?: { consumedAt?: string };
      };
      expect(replayBody.alreadyConsumed).toBe(true);
      expect(replayBody.record?.consumedAt).toBe(persistedRecord?.consumedAt);

      const replayInventory = await database.query<{ quantity: string | null }>(
        `select quantity from public.recipe_inventory_items
          where id=$1 and tenant_id=$2 and user_id=$3`,
        [trackedInventoryId, identity.tenantId, identity.userId]
      );
      expect(replayInventory.rows[0]?.quantity).toBe('0.25');

      const replayMovements = await database.query<{ count: string }>(
        `select count(*)::text as count from public.inventory_movements
          where tenant_id=$1 and user_id=$2 and source=$3`,
        [identity.tenantId, identity.userId, source]
      );
      expect(replayMovements.rows[0]?.count).toBe('1');

      const afterShopping = await database.query<{ count: string }>(
        `select count(*)::text as count from public.shopping_list_items
          where tenant_id=$1 and user_id=$2 and source=$3`,
        [identity.tenantId, identity.userId, `meal-plan:${planId}`]
      );
      expect(afterShopping.rows[0]?.count).toBe('0');
    } finally {
      if (seed) {
        await database.query(
          `delete from public.inventory_movements
            where tenant_id=$1 and user_id=$2 and source=$3`,
          [seed.identity.tenantId, seed.identity.userId, seed.source]
        );
        await database.query(
          `delete from public.shopping_list_items
            where tenant_id=$1 and user_id=$2 and source=$3`,
          [seed.identity.tenantId, seed.identity.userId, `meal-plan:${seed.planId}`]
        );
        await database.query(
          `delete from public.user_meal_plans
            where id=$1 and tenant_id=$2 and user_id=$3`,
          [seed.planId, seed.identity.tenantId, seed.identity.userId]
        );
        await database.query(
          `delete from public.recipe_inventory_items
            where tenant_id=$1 and user_id=$2 and id=any($3::uuid[])`,
          [seed.identity.tenantId, seed.identity.userId, seed.inventoryIds]
        );

        const leftovers = await database.query<{
          movements: string;
          plans: string;
          inventory: string;
          shopping: string;
        }>(
          `select
             (select count(*)::text from public.inventory_movements where tenant_id=$1 and user_id=$2 and source=$3) as movements,
             (select count(*)::text from public.user_meal_plans where id=$4 and tenant_id=$1 and user_id=$2) as plans,
             (select count(*)::text from public.recipe_inventory_items where tenant_id=$1 and user_id=$2 and id=any($5::uuid[])) as inventory,
             (select count(*)::text from public.shopping_list_items where tenant_id=$1 and user_id=$2 and source=$6) as shopping`,
          [
            seed.identity.tenantId,
            seed.identity.userId,
            seed.source,
            seed.planId,
            seed.inventoryIds,
            `meal-plan:${seed.planId}`,
          ]
        );
        expect(leftovers.rows[0]).toEqual({
          movements: '0',
          plans: '0',
          inventory: '0',
          shopping: '0',
        });
      }
    }
  });
});
