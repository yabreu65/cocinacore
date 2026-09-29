import { expect, test } from '@playwright/test';
import { Pool } from 'pg';
import { injectAuth } from '../fixtures/auth';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://cocinacore_user:cocinacore_password@localhost:5433/cocinacore_local_db';
const database = new Pool({ connectionString: DATABASE_URL });

type Identity = { userId: string; tenantId: string };
type Seed = { identity: Identity; planId: string; inventoryIds: string[]; source: string };

async function authenticatedIdentity(page: Parameters<typeof injectAuth>[0]): Promise<Identity> {
  await injectAuth(page);
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

function structuredPlan(names: Record<string, string>) {
  return {
    period: 'week',
    dayCount: 7,
    days: Array.from({ length: 7 }, (_, index) => ({
      dayIndex: index + 1,
      label: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'][index],
      meals: [
        {
          mealType: 'breakfast',
          title: 'Desayuno de prueba',
          description: null,
          ingredients: index === 0
            ? [
                { name: names.covered, quantity: 1, unit: 'kg' },
                { name: names.partial, quantity: 1, unit: 'kg' },
                { name: names.missing, quantity: 1, unit: 'kg' },
                { name: names.unknown, quantity: null, unit: null },
              ]
            : [{ name: names.covered, quantity: 0.1, unit: 'kg' }],
        },
        { mealType: 'lunch', title: 'Almuerzo', description: null, ingredients: [{ name: names.covered, quantity: 0.1, unit: 'kg' }] },
        { mealType: 'dinner', title: 'Cena', description: null, ingredients: [{ name: names.covered, quantity: 0.1, unit: 'kg' }] },
      ],
    })),
  };
}

test.describe('Connected Meal Planner shopping confirmation', () => {
  test.afterAll(async () => {
    await database.end();
  });

  test('shows persisted shortages and writes only explicit selection, then reloads idempotently', async ({ page }, testInfo) => {
    const identity = await authenticatedIdentity(page);
    const unique = `e2e-${Date.now()}-${testInfo.workerIndex}-${Math.random().toString(36).slice(2, 8)}`;
    const names = {
      covered: `${unique} covered ingredient`,
      partial: `${unique} partial ingredient`,
      missing: `${unique} missing ingredient`,
      unknown: `${unique} unknown ingredient`,
    };
    let seed: Seed | null = null;

    try {
      const inventory = await database.query<{ id: string }>(
        `insert into public.recipe_inventory_items
           (tenant_id, user_id, ingredient_name, quantity, unit, normalized_name)
         values ($1, $2, $3, '1000', 'kg', $3),
                ($1, $2, $4, '0.25', 'kg', $4)
         returning id`,
        [identity.tenantId, identity.userId, names.covered, names.partial]
      );
      const inventoryIds = inventory.rows.map((row) => row.id);
      const plan = structuredPlan(names);
      const insertedPlan = await database.query<{ id: string }>(
        `insert into public.user_meal_plans
           (tenant_id, user_id, people_count, period, mode, base_cuisine, fusion_cuisines,
            fusion_intensity, restrictions, inventory_snapshot, calendar_payload, ai_content)
         values ($1, $2, 2, 'week', 'balanced_ai', 'E2E', '{}', 'media', '{}',
                 '{"inventoryLines":[]}'::jsonb, $3::jsonb, 'E2E canonical plan')
         returning id`,
        [identity.tenantId, identity.userId, JSON.stringify(plan)]
      );
      const planId = insertedPlan.rows[0]?.id;
      if (!planId) throw new Error('Failed to seed canonical meal plan.');
      seed = { identity, planId, inventoryIds, source: `meal-plan:${planId}` };

      const before = await database.query<{ count: string }>(
        'select count(*)::text as count from public.shopping_list_items where tenant_id = $1 and user_id = $2 and source = $3',
        [identity.tenantId, identity.userId, seed.source]
      );
      expect(before.rows[0]?.count).toBe('0');

      await page.goto('/meal-planner');
      await expect(page.getByRole('heading', { name: 'Planificador de menú' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Menú generado' })).toBeVisible();
      const suggestionsSection = page.locator('section[aria-busy]');
      await expect(suggestionsSection.getByRole('heading', { name: 'Faltantes para este menú' })).toBeVisible();
      await expect(suggestionsSection.getByText(names.covered, { exact: false })).toHaveCount(0);
      await expect(suggestionsSection.getByText(names.partial, { exact: false })).toBeVisible();
      await expect(suggestionsSection.getByText(names.missing, { exact: false })).toBeVisible();
      await expect(suggestionsSection.getByText(names.unknown, { exact: false })).toBeVisible();
      await expect(suggestionsSection.getByText('Requerido: 1 kg · Disponible: 0.25 kg')).toBeVisible();
      await expect(suggestionsSection.getByText('Para comprar: 0.75 kg')).toBeVisible();
      await expect(suggestionsSection.getByText(/Lunes · Desayuno · Desayuno de prueba/).first()).toBeVisible();
      await expect(suggestionsSection.getByText('Comprar', { exact: true }).first()).toBeVisible();
      await expect(suggestionsSection.getByText('Revisar', { exact: true })).toBeVisible();

      const addButton = suggestionsSection.getByRole('button', { name: 'Agregar seleccionados a compras' });
      await expect(addButton).toBeVisible();
      const confirmationRows = await database.query<{ count: string }>(
        'select count(*)::text as count from public.shopping_list_items where tenant_id = $1 and user_id = $2 and source = $3',
        [identity.tenantId, identity.userId, seed.source]
      );
      expect(confirmationRows.rows[0]?.count).toBe('0');

      await page.getByRole('checkbox', { name: new RegExp(names.partial, 'i') }).check();
      await page.getByRole('checkbox', { name: new RegExp(names.missing, 'i') }).uncheck();
      await expect(page.getByRole('checkbox', { name: new RegExp(names.missing, 'i') })).not.toBeChecked();
      await expect(page.getByRole('checkbox', { name: new RegExp(names.unknown, 'i') })).not.toBeChecked();
      await addButton.click();
      await expect(page.getByText(/Se agregaron 1 artículo/)).toBeVisible();

      const persisted = await database.query<{
        id: string; tenant_id: string; user_id: string; source: string;
        ingredient_name: string; quantity: string | null; status: string;
      }>(
        `select id, tenant_id, user_id, source, ingredient_name, quantity, status
         from public.shopping_list_items where tenant_id = $1 and user_id = $2 and source = $3`,
        [identity.tenantId, identity.userId, seed.source]
      );
      expect(persisted.rows).toHaveLength(1);
      expect(persisted.rows[0]).toMatchObject({
        tenant_id: identity.tenantId,
        user_id: identity.userId,
        source: seed.source,
        ingredient_name: names.partial,
        quantity: '0.75 kg',
        status: 'pending',
      });

      await page.reload();
      await expect(page.getByRole('heading', { name: 'Faltantes para este menú' })).toBeVisible();
      await expect(page.getByText('Ya está en compras', { exact: true })).toBeVisible();
      await expect(page.getByRole('checkbox', { name: new RegExp(names.partial, 'i') })).not.toBeChecked();

      const replay = await page.request.post('/api/meal-plan/shopping-suggestions', {
        data: { mealPlanId: seed.planId, selectedItems: [names.partial.toLocaleLowerCase()] },
      });
      expect(replay.ok()).toBeTruthy();
      const replayBody = (await replay.json()) as {
        added: unknown[];
        alreadyPresent: Array<{ ingredient_name: string; status: string }>;
        ignored: string[];
      };
      expect(replayBody).toMatchObject({
        added: [],
        alreadyPresent: [expect.objectContaining({ ingredient_name: names.partial, status: 'pending' })],
        ignored: [],
      });
      const afterReplay = await database.query<{ count: string }>(
        'select count(*)::text as count from public.shopping_list_items where tenant_id = $1 and user_id = $2 and source = $3',
        [identity.tenantId, identity.userId, seed.source]
      );
      expect(afterReplay.rows[0]?.count).toBe('1');
    } finally {
      if (seed) {
        await database.query(
          'delete from public.shopping_list_items where tenant_id = $1 and user_id = $2 and source = $3',
          [seed.identity.tenantId, seed.identity.userId, seed.source]
        );
        await database.query('delete from public.user_meal_plans where id = $1', [seed.planId]);
      }
      if (seed?.inventoryIds.length) {
        await database.query('delete from public.recipe_inventory_items where id = any($1::uuid[])', [seed.inventoryIds]);
      } else {
        await database.query(
          'delete from public.recipe_inventory_items where tenant_id = $1 and user_id = $2 and ingredient_name = any($3::text[])',
          [identity.tenantId, identity.userId, Object.values(names)]
        );
      }
    }
  });
});
