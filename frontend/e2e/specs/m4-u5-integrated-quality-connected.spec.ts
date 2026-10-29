import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import { validateE2ETargets } from '../database-target';
import { injectAuth, signupIsolatedE2EUser } from '../fixtures/auth';
import {
  assertE2EDisposableIsolation,
  closeE2EDatabase,
  hasAppendOnlyE2EReferences,
} from '../fixtures/database';

const database = new Pool({ connectionString: validateE2ETargets(process.env).databaseUrl });

type Identity = { userId: string; tenantId: string };
type Seed = {
  identity: Identity;
  planId: string;
  inventoryIds: string[];
  recipeId: string;
  shoppingId: string | null;
  marker: string;
};

async function authenticatedIdentity(page: Page): Promise<Identity> {
  await assertE2EDisposableIsolation(database);
  await signupIsolatedE2EUser(page, 'm4-u5');
  const response = await page.request.get('/api/profile');
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as {
    user?: { id?: string; tenant?: { tenantId?: string } | null };
  };
  const userId = payload.user?.id;
  const tenantId = payload.user?.tenant?.tenantId;
  if (!userId || !tenantId) throw new Error('Missing authenticated E2E identity.');
  return { userId, tenantId };
}

function integratedPlan(ingredientNames: { soon: string; missing: string }) {
  const now = new Date().toISOString();
  const labels = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  return {
    period: 'week',
    dayCount: 7,
    schedule: {
      startDate: now.slice(0, 10),
      timeZone: 'UTC',
      confirmedAt: now,
      portionConfirmation: { peopleCount: 2, confirmedAt: now },
    },
    days: labels.map((label, index) => ({
      dayIndex: index + 1,
      label,
      meals: [
        {
          mealType: 'breakfast',
          title: `U5 desayuno ${index + 1}`,
          description: null,
          ingredients:
            index === 0
              ? [
                  { name: ingredientNames.soon, quantity: 0.5, unit: 'kg' },
                  { name: ingredientNames.missing, quantity: 1, unit: 'kg' },
                ]
              : [{ name: ingredientNames.soon, quantity: 0.05, unit: 'kg' }],
        },
        {
          mealType: 'lunch',
          title: `U5 almuerzo ${index + 1}`,
          description: null,
          ingredients: [{ name: ingredientNames.soon, quantity: 0.05, unit: 'kg' }],
        },
        {
          mealType: 'dinner',
          title: `U5 cena ${index + 1}`,
          description: null,
          ingredients: [{ name: ingredientNames.soon, quantity: 0.05, unit: 'kg' }],
        },
      ],
    })),
  };
}

async function cleanup(seed: Seed): Promise<void> {
  const { tenantId, userId } = seed.identity;
  if (seed.planId) {
    if (await hasAppendOnlyE2EReferences(database, tenantId, userId, [seed.planId])) return;
    await database.query(
      'delete from public.inventory_movements where tenant_id = $1 and user_id = $2 and source_meal_plan_id = $3',
      [tenantId, userId, seed.planId]
    );
    await database.query(
      'delete from public.shopping_list_items where tenant_id = $1 and user_id = $2 and source = $3',
      [tenantId, userId, `meal-plan:${seed.planId}`]
    );
    await database.query(
      'delete from public.user_meal_plans where id = $1 and tenant_id = $2 and user_id = $3',
      [seed.planId, tenantId, userId]
    );
  }
  if (seed.recipeId) {
    await database.query(
      'delete from public.user_recipe_versions where recipe_id = $1 and tenant_id = $2 and user_id = $3',
      [seed.recipeId, tenantId, userId]
    );
    await database.query(
      'delete from public.user_recipes where id = $1 and tenant_id = $2 and user_id = $3',
      [seed.recipeId, tenantId, userId]
    );
  }
  if (seed.inventoryIds.length > 0) {
    await database.query(
      'delete from public.recipe_inventory_items where tenant_id = $1 and user_id = $2 and ingredient_name like $3',
      [tenantId, userId, `${seed.marker}%`]
    );
  }
}

test.describe('M4 U5 integrated connected quality', () => {
  test.afterAll(async () => {
    await database.end();
    await closeE2EDatabase();
  });

  test('connects auth, profile-scoped inventory, U1-U4, purchase transfer, and consumption', async ({
    page,
  }, testInfo) => {
    const identity = await authenticatedIdentity(page);
    const marker = `e2e-u5-${testInfo.workerIndex}-${randomUUID()}`;
    const names = { soon: `${marker} tomato`, missing: `${marker} lentil` };
    const seed: Seed = {
      identity,
      planId: '',
      inventoryIds: [],
      recipeId: '',
      shoppingId: null,
      marker,
    };

    try {
      const inventory = await database.query<{ id: string }>(
        `insert into public.recipe_inventory_items
           (tenant_id, user_id, ingredient_name, quantity, unit, category, normalized_name, expiration_date)
         values ($1, $2, $3, '0.5', 'kg', 'e2e', $3, current_date + 2)
         returning id`,
        [identity.tenantId, identity.userId, names.soon]
      );
      seed.inventoryIds = inventory.rows.map((row) => row.id);

      const recipe = await database.query<{ id: string }>(
        `insert into public.user_recipes (tenant_id, user_id, category, tags)
         values ($1, $2, 'e2e', ARRAY['u5']) returning id`,
        [identity.tenantId, identity.userId]
      );
      seed.recipeId = recipe.rows[0]?.id ?? '';
      await database.query(
        `insert into public.user_recipe_versions
           (recipe_id, tenant_id, user_id, version_number, title, instructions, servings, ingredients)
         values ($1, $2, $3, 1, $4, 'Use the soon-expiring ingredient.', 2, $5::jsonb)`,
        [
          seed.recipeId,
          identity.tenantId,
          identity.userId,
          `${marker} recipe`,
          JSON.stringify([{ name: names.soon, quantity: '0.5', unit: 'kg' }]),
        ]
      );

      const planResult = await database.query<{ id: string }>(
        `insert into public.user_meal_plans
           (tenant_id, user_id, people_count, period, mode, base_cuisine, fusion_cuisines,
            fusion_intensity, restrictions, inventory_snapshot, calendar_payload, ai_content, consumption_payload)
         values ($1, $2, 2, 'week', 'balanced_ai', 'E2E', '{}', 'media', '{}',
                 '{"inventoryLines":[]}'::jsonb, $3::jsonb, $4, '{}'::jsonb)
         returning id`,
        [identity.tenantId, identity.userId, JSON.stringify(integratedPlan(names)), marker]
      );
      seed.planId = planResult.rows[0]?.id ?? '';
      expect(seed.planId).toMatch(/^[0-9a-f-]{36}$/i);

      const coverage = await page.request.get('/api/meal-plan/coverage?horizonDays=7');
      expect(coverage.ok()).toBeTruthy();
      const coverageBody = (await coverage.json()) as {
        mealPlanId: string;
        forecast: { items: Array<{ ingredientName: string; status: string }> };
      };
      expect(coverageBody.mealPlanId).toBe(seed.planId);
      expect(coverageBody.forecast.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ ingredientName: names.soon }),
          expect.objectContaining({ ingredientName: names.missing }),
        ])
      );
      const coverage14 = await page.request.get('/api/meal-plan/coverage?horizonDays=14');
      expect(coverage14.ok()).toBeTruthy();

      const waste = await page.request.get('/api/waste-prevention?timeZone=UTC&dueSoonDays=5');
      expect(waste.ok()).toBeTruthy();
      const wasteBody = (await waste.json()) as {
        report: { lots: Array<{ ingredientName: string }>; suggestions: Array<{ title: string }> };
      };
      expect(wasteBody.report.lots).toEqual(
        expect.arrayContaining([expect.objectContaining({ ingredientName: names.soon })])
      );

      const proposalResponse = await page.request.post('/api/meal-plan/adaptive-proposal', {
        data: { mealPlanId: seed.planId },
      });
      expect(proposalResponse.ok()).toBeTruthy();
      const proposalBody = (await proposalResponse.json()) as {
        expectedUpdatedAt: string;
        sourceFingerprint: string;
        proposal: { plan: unknown };
      };
      const confirm = await page.request.post('/api/meal-plan/adaptive-proposal/confirm', {
        data: {
          mealPlanId: seed.planId,
          expectedUpdatedAt: proposalBody.expectedUpdatedAt,
          sourceFingerprint: proposalBody.sourceFingerprint,
          proposedPlan: proposalBody.proposal.plan,
        },
      });
      expect(confirm.ok()).toBeTruthy();
      const replayConfirm = await page.request.post('/api/meal-plan/adaptive-proposal/confirm', {
        data: {
          mealPlanId: seed.planId,
          expectedUpdatedAt: proposalBody.expectedUpdatedAt,
          sourceFingerprint: proposalBody.sourceFingerprint,
          proposedPlan: proposalBody.proposal.plan,
        },
      });
      expect(replayConfirm.status()).toBe(409);

      const shoppingSnapshot = await page.request.get(
        `/api/meal-plan/shopping-suggestions?mealPlanId=${seed.planId}&horizon=7`
      );
      expect(shoppingSnapshot.ok()).toBeTruthy();
      const shoppingBody = (await shoppingSnapshot.json()) as {
        expectedUpdatedAt: string;
        sourceFingerprint: string;
        items: Array<{ normalizedName: string; ingredientName: string; status: string }>;
      };
      const buy = shoppingBody.items.find((item) => item.ingredientName === names.missing);
      expect(buy?.status).toBe('buy');
      const addShopping = await page.request.post('/api/meal-plan/shopping-suggestions', {
        data: {
          mealPlanId: seed.planId,
          horizonDays: 7,
          selectedItems: [buy?.normalizedName],
          expectedUpdatedAt: shoppingBody.expectedUpdatedAt,
          expectedFingerprint: shoppingBody.sourceFingerprint,
        },
      });
      expect(addShopping.ok()).toBeTruthy();
      const added = (await addShopping.json()) as { added: Array<{ id: string; status: string }> };
      seed.shoppingId = added.added[0]?.id ?? null;
      expect(seed.shoppingId).toMatch(/^[0-9a-f-]{36}$/i);

      const markPurchased = await page.request.patch(`/api/shopping-list/${seed.shoppingId}`, {
        data: { status: 'purchased' },
      });
      expect(markPurchased.ok()).toBeTruthy();
      const transfer = await page.request.post(`/api/shopping-list/${seed.shoppingId}/inventory`);
      expect(transfer.ok()).toBeTruthy();
      const transferReplay = await page.request.post(
        `/api/shopping-list/${seed.shoppingId}/inventory`
      );
      expect(transferReplay.ok()).toBeTruthy();
      const inventoryCount = await database.query<{ count: string }>(
        `select count(*)::text as count from public.recipe_inventory_items
         where tenant_id = $1 and user_id = $2 and ingredient_name = $3`,
        [identity.tenantId, identity.userId, names.missing]
      );
      expect(inventoryCount.rows[0]?.count).toBe('1');

      const consume = await page.request.post('/api/meal-plan/consumption', {
        data: { mealPlanId: seed.planId, dayIndex: 1, mealType: 'breakfast' },
      });
      expect(consume.ok()).toBeTruthy();
      const consumeReplay = await page.request.post('/api/meal-plan/consumption', {
        data: { mealPlanId: seed.planId, dayIndex: 1, mealType: 'breakfast' },
      });
      expect(consumeReplay.ok()).toBeTruthy();

      await page.goto('/meal-planner');
      await expect(page.getByRole('heading', { name: 'Planificador de menú' })).toBeVisible();
      await page.goto('/shopping-list');
      await expect(page.getByRole('heading', { name: /Compras/i })).toBeVisible();

      await page.context().clearCookies();
      const unauthenticated = await page.request.get('/api/meal-plan/coverage?horizonDays=7');
      expect(unauthenticated.status()).toBe(401);
    } finally {
      await cleanup(seed);
    }
  });

  test('renders the M4 surfaces at a mobile viewport without horizontal overflow', async ({
    browser,
  }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    try {
      await injectAuth(page);
      for (const path of ['/app', '/meal-planner', '/shopping-list']) {
        await page.goto(path);
        await expect(page.locator('body')).toBeVisible();
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
        ).toBe(true);
      }
    } finally {
      await context.close();
    }
  });
});
