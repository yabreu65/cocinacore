import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://cocinacore_user:cocinacore_password@localhost:5433/cocinacore_local_db';
const database = new Pool({ connectionString: DATABASE_URL });

type Identity = { userId: string; tenantId: string };
type Seed = {
  email: string;
  tenantName: string;
  identity: Identity | null;
  unique: string;
  planId: string | null;
  inventoryIds: string[];
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

async function createTestIdentity(
  page: Page,
  email: string,
  fullName: string,
  password: string
): Promise<Identity> {
  const response = await page.request.post('/api/auth/signup', {
    data: {
      email,
      password,
      confirmPassword: password,
      fullName,
      termsAccepted: true,
    },
  });
  if (!response.ok()) throw new Error(`M1.6 test account signup failed (${response.status()}).`);

  const profileResponse = await page.request.get('/api/profile');
  expect(profileResponse.ok()).toBeTruthy();
  const payload = (await profileResponse.json()) as {
    user?: { id?: string; tenant?: { tenantId?: string } | null };
  };
  const userId = payload.user?.id;
  const tenantId = payload.user?.tenant?.tenantId;
  if (!userId || !tenantId)
    throw new Error('M1.6 signup identity is missing user or tenant.');
  return { userId, tenantId };
}

async function cleanupTest(seed: Seed): Promise<void> {
  const failures: unknown[] = [];
  const attempt = async (operation: () => Promise<unknown>) => {
    try {
      await operation();
    } catch (error) {
      failures.push(error);
    }
  };

  let tenantId = seed.identity?.tenantId;
  let userId = seed.identity?.userId;
  await attempt(async () => {
    const account = await database.query<{ id: string; tenant_id: string | null }>(
      `select id, tenant_id from public.users where email=$1`,
      [seed.email]
    );
    if (account.rows.length > 1) throw new Error('Unique M1.6 email resolved to multiple users.');
    if (account.rows[0]) {
      userId = account.rows[0].id;
      tenantId = account.rows[0].tenant_id ?? tenantId;
    }
  });
  await attempt(async () => {
    const tenant = await database.query<{ id: string }>(
      `select id from public.tenants where id=coalesce($1::uuid, id) and name=$2`,
      [tenantId ?? null, seed.tenantName]
    );
    if (tenant.rows.length > 1) {
      throw new Error('Unique M1.6 tenant name resolved to multiple tenants.');
    }
    tenantId = tenant.rows[0]?.id ?? tenantId;
  });

  const planIds = new Set<string>(seed.planId ? [seed.planId] : []);
  if (tenantId && userId) {
    await attempt(async () => {
      const plans = await database.query<{ id: string }>(
        `select id from public.user_meal_plans where tenant_id=$1 and user_id=$2 and ai_content=$3`,
        [tenantId, userId, `E2E connected consumption ${seed.unique}`]
      );
      plans.rows.forEach(({ id }) => planIds.add(id));
    });
    const sources = [...planIds].map((id) => `meal-plan-consumption:${id}:1:breakfast`);
    const shoppingSources = [...planIds].map((id) => `meal-plan:${id}`);
    await attempt(() =>
      database.query(
        `delete from public.inventory_movements where tenant_id=$1 and user_id=$2
          and (source=any($3::text[]) or source_meal_plan_id=any($4::uuid[]))`,
        [tenantId, userId, sources, [...planIds]]
      )
    );
    await attempt(() =>
      database.query(
        `delete from public.shopping_list_items where tenant_id=$1 and user_id=$2 and source=any($3::text[])`,
        [tenantId, userId, shoppingSources]
      )
    );
    await attempt(() =>
      database.query(
        `delete from public.user_meal_plans where tenant_id=$1 and user_id=$2
          and (id=any($3::uuid[]) or ai_content=$4)`,
        [tenantId, userId, [...planIds], `E2E connected consumption ${seed.unique}`]
      )
    );
    await attempt(() =>
      database.query(
        `delete from public.recipe_inventory_items where tenant_id=$1 and user_id=$2
          and (id=any($3::uuid[]) or ingredient_name=any($4::text[]))`,
        [
          tenantId,
          userId,
          seed.inventoryIds,
          [`${seed.unique} tracked ingredient`, `${seed.unique} control ingredient`],
        ]
      )
    );
  }

  if (userId && tenantId) {
    await attempt(() =>
      database.query(`delete from public.users where id=$1 and email=$2`, [userId, seed.email])
    );
  }
  if (tenantId) {
    await attempt(() =>
      database.query(
        `delete from public.tenants t where t.id=$1 and t.name=$2
          and not exists (select 1 from public.users u where u.tenant_id=t.id)
          and not exists (select 1 from public.tenant_memberships m where m.tenant_id=t.id)`,
        [tenantId, seed.tenantName]
      )
    );
  }

  if (tenantId && userId) {
    const sources = [...planIds].map((id) => `meal-plan-consumption:${id}:1:breakfast`);
    const shoppingSources = [...planIds].map((id) => `meal-plan:${id}`);
    await attempt(async () => {
      const residuals = await database.query<{
        movements: string;
        shopping: string;
        plans: string;
        inventory: string;
        users: string;
        tenants: string;
      }>(
        `select
          (select count(*)::text from public.inventory_movements
            where tenant_id=$1 and user_id=$2
              and (source=any($3::text[]) or source_meal_plan_id=any($4::uuid[]))) movements,
          (select count(*)::text from public.shopping_list_items
            where tenant_id=$1 and user_id=$2 and source=any($5::text[])) shopping,
          (select count(*)::text from public.user_meal_plans
            where tenant_id=$1 and user_id=$2 and (id=any($4::uuid[]) or ai_content=$6)) plans,
          (select count(*)::text from public.recipe_inventory_items
            where tenant_id=$1 and user_id=$2
              and (id=any($7::uuid[]) or ingredient_name=any($8::text[]))) inventory,
          (select count(*)::text from public.users where id=$2 and email=$9) users,
          (select count(*)::text from public.tenants where id=$1 and name=$10) tenants`,
        [
          tenantId,
          userId,
          sources,
          [...planIds],
          shoppingSources,
          `E2E connected consumption ${seed.unique}`,
          seed.inventoryIds,
          [`${seed.unique} tracked ingredient`, `${seed.unique} control ingredient`],
          seed.email,
          seed.tenantName,
        ]
      );
      if (Object.values(residuals.rows[0] ?? {}).some((count) => count !== '0')) {
        failures.push(new Error(`M1.6 cleanup left scoped data: ${JSON.stringify(residuals.rows[0])}`));
      }
    });
  } else if (tenantId) {
    await attempt(async () => {
      const residual = await database.query<{ count: string }>(
        `select count(*)::text as count from public.tenants where id=$1 and name=$2`,
        [tenantId, seed.tenantName]
      );
      if (residual.rows[0]?.count !== '0') failures.push(new Error('M1.6 cleanup left its tenant behind.'));
    });
  }
  if (failures.length) throw new AggregateError(failures, 'Failed to clean up M1.6 E2E identity/data.');
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
    const unique = `e2e-m1-6-3-${randomUUID()}`;
    const email = `${unique}@example.invalid`;
    const fullName = `E2E M1.6 ${randomUUID()}`;
    const password = `M1.6-${randomUUID()}!aA9`;
    const tenantName = `Tenant of ${email}`;
    const trackedName = `${unique} tracked ingredient`;
    const missingName = `${unique} missing ingredient`;
    const controlName = `${unique} control ingredient`;
    const mealTitle = 'Desayuno para consumir';
    const seed: Seed = {
      email,
      tenantName,
      identity: null,
      unique,
      planId: null,
      inventoryIds: [],
    };
    let operationError: unknown;

    try {
      const identity = await createTestIdentity(page, email, fullName, password);
      seed.identity = identity;
      const inventoryResult = await database.query<{ id: string; ingredient_name: string }>(
        `insert into public.recipe_inventory_items
           (tenant_id, user_id, ingredient_name, quantity, unit, category, normalized_name)
         values ($1, $2, $3, '1.25', 'kg', 'e2e', $3),
                ($1, $2, $4, '1000', 'kg', 'e2e', $4)
         returning id, ingredient_name`,
        [identity.tenantId, identity.userId, trackedName, controlName]
      );
      seed.inventoryIds.push(...inventoryResult.rows.map((row) => row.id));
      const inventoryIds = seed.inventoryIds;
      const trackedInventoryId = inventoryResult.rows.find(
        (row) => row.ingredient_name === trackedName
      )?.id;
      if (inventoryIds.length !== 2 || !trackedInventoryId)
        throw new Error('Failed to seed owned inventory.');

      const planMarker = `E2E connected consumption ${unique}`;
      const planResult = await database.query<{ id: string }>(
        `insert into public.user_meal_plans
           (tenant_id, user_id, people_count, period, mode, base_cuisine, fusion_cuisines,
            fusion_intensity, restrictions, inventory_snapshot, calendar_payload, ai_content, consumption_payload)
         values ($1, $2, 2, 'week', 'balanced_ai', 'E2E', '{}', 'media', '{}',
                 '{"inventoryLines":[]}'::jsonb, $3::jsonb, $4, '{}'::jsonb)
         returning id`,
        [
          identity.tenantId,
          identity.userId,
          JSON.stringify(canonicalPlan(trackedName, missingName, controlName)),
          planMarker,
        ]
      );
      const planId = planResult.rows[0]?.id;
      if (!planId) throw new Error('Failed to seed canonical meal plan.');
      seed.planId = planId;
      const source = `meal-plan-consumption:${planId}:1:breakfast`;

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
    } catch (error) {
      operationError = error;
      throw error;
    } finally {
      try {
        await cleanupTest(seed);
      } catch (cleanupError) {
        if (operationError) {
          throw new AggregateError([operationError, cleanupError], 'M1.6 test and cleanup both failed.');
        }
        throw cleanupError;
      }
    }
  });
});
