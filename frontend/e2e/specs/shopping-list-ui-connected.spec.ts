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
type ShoppingRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  source: string;
  ingredient_name: string;
  quantity: string | null;
  status: 'pending' | 'purchased';
};

async function authenticatedIdentity(page: Page): Promise<Identity> {
  await injectAuth(page, undefined, { allowSignup: false });

  const response = await page.goto('/api/profile');
  expect(response?.ok()).toBeTruthy();
  const payload = JSON.parse((await page.locator('body').innerText()) ?? '') as {
    user?: { id?: string; tenant?: { tenantId?: string } | null };
  };
  const userId = payload.user?.id;
  const tenantId = payload.user?.tenant?.tenantId;
  if (!userId || !tenantId) throw new Error('Authenticated E2E identity is missing user or tenant.');
  return { userId, tenantId };
}

test.describe('Connected Shopping List UI + PostgreSQL', () => {
  test.afterAll(async () => {
    await database.end();
  });

  test('persists seeded provenance, creates and toggles rows, reloads, and deliberately deletes only the created row', async ({ page }, testInfo) => {
    const identity = await authenticatedIdentity(page);
    const unique = `e2e-shopping-ui-${randomUUID()}`;
    const planSource = `meal-plan:${randomUUID()}`;
    const names = {
      manual: `${unique} seeded manual`,
      planner: `${unique} planner purchased`,
      created: `${unique} created in UI`,
    };
    const ownedRowIds: string[] = [];
    let cleanupSucceeded = false;

    try {
      const existing = await database.query<{ count: string }>(
        `select count(*)::text as count from public.shopping_list_items
         where tenant_id = $1 and user_id = $2 and ingredient_name = any($3::text[])`,
        [identity.tenantId, identity.userId, Object.values(names)]
      );
      expect(existing.rows[0]?.count).toBe('0');

      const seededManual = await database.query<{ id: string }>(
        `insert into public.shopping_list_items
           (tenant_id, user_id, source, ingredient_name, quantity, status)
         values ($1, $2, 'manual', $3, $4, 'pending') returning id`,
        [identity.tenantId, identity.userId, names.manual, '3 units']
      );
      const manualId = seededManual.rows[0]?.id;
      if (!manualId) throw new Error('Failed to seed the manual pending shopping row.');
      ownedRowIds.push(manualId);

      const seededPlanner = await database.query<{ id: string }>(
        `insert into public.shopping_list_items
           (tenant_id, user_id, source, ingredient_name, quantity, status)
         values ($1, $2, $3, $4, $5, 'purchased') returning id`,
        [identity.tenantId, identity.userId, planSource, names.planner, '1 bag']
      );
      const plannerId = seededPlanner.rows[0]?.id;
      if (!plannerId) throw new Error('Failed to seed the Planner purchased shopping row.');
      ownedRowIds.push(plannerId);

      await page.goto('/shopping-list');
      await expect(page.getByRole('heading', { name: 'Lista de compras' })).toBeVisible();
      const plannerHeading = page.getByRole('heading', { name: names.planner });
      const plannerArticle = page.getByRole('article').filter({ has: plannerHeading });
      await expect(plannerHeading).toHaveCount(1);
      await expect(plannerHeading).toBeVisible();
      await expect(plannerArticle.getByText('Desde el planificador')).toBeVisible();

      await page.getByLabel(/ingrediente/i).fill(names.created);
      await page.getByLabel(/cantidad/i).fill('2 frascos');
      await page.getByRole('button', { name: 'Agregar', exact: true }).click();
      const createdArticle = page.getByRole('article').filter({ has: page.getByRole('heading', { name: names.created }) });
      await expect(createdArticle).toBeVisible();
      const createdRows = await database.query<{ id: string }>(
        `select id from public.shopping_list_items
         where tenant_id = $1 and user_id = $2 and source = 'manual' and ingredient_name = $3`,
        [identity.tenantId, identity.userId, names.created]
      );
      expect(createdRows.rows).toHaveLength(1);
      const createdId = createdRows.rows[0]?.id;
      if (!createdId) throw new Error('The UI-created shopping row was not persisted.');
      ownedRowIds.push(createdId);

      const manualArticle = page.getByRole('article').filter({ has: page.getByRole('heading', { name: names.manual }) });
      await manualArticle.getByRole('button', { name: 'Marcar como comprado' }).click();
      await plannerArticle.getByRole('button', { name: 'Marcar como pendiente' }).click();
      await expect(manualArticle.getByText('Estado: Comprado', { exact: true })).toBeVisible();
      await expect(plannerArticle.getByText('Estado: Pendiente', { exact: true })).toBeVisible();

      const expectedRows: ShoppingRow[] = [
        { id: manualId, tenant_id: identity.tenantId, user_id: identity.userId, source: 'manual', ingredient_name: names.manual, quantity: '3 units', status: 'purchased' },
        { id: plannerId, tenant_id: identity.tenantId, user_id: identity.userId, source: planSource, ingredient_name: names.planner, quantity: '1 bag', status: 'pending' },
        { id: createdId, tenant_id: identity.tenantId, user_id: identity.userId, source: 'manual', ingredient_name: names.created, quantity: '2 frascos', status: 'pending' },
      ];
      const persisted = await database.query<ShoppingRow>(
        `select id, tenant_id, user_id, source, ingredient_name, quantity, status
         from public.shopping_list_items where tenant_id = $1 and user_id = $2 and id = any($3::uuid[])
         order by id`,
        [identity.tenantId, identity.userId, ownedRowIds]
      );
      expect(persisted.rows).toHaveLength(3);
      for (const expected of expectedRows) expect(persisted.rows).toContainEqual(expected);

      await page.reload();
      await expect(page.getByRole('heading', { name: names.manual })).toHaveCount(1);
      await expect(page.getByRole('heading', { name: names.planner })).toBeVisible();
      await expect(plannerArticle.getByText('Desde el planificador')).toBeVisible();
      await expect(page.getByRole('heading', { name: names.created })).toBeVisible();
      await expect(manualArticle.getByText('Estado: Comprado', { exact: true })).toBeVisible();
      await expect(plannerArticle.getByText('Estado: Pendiente', { exact: true })).toBeVisible();

      page.once('dialog', (dialog) => dialog.accept());
      await page.getByRole('article').filter({ has: page.getByRole('heading', { name: names.created }) })
        .getByRole('button', { name: `Eliminar ${names.created}` }).click();
      await expect(page.getByRole('heading', { name: names.created })).toHaveCount(0);

      const afterDelete = await database.query<ShoppingRow>(
        `select id, tenant_id, user_id, source, ingredient_name, quantity, status
         from public.shopping_list_items where tenant_id = $1 and user_id = $2 and id = any($3::uuid[])
         order by id`,
        [identity.tenantId, identity.userId, ownedRowIds]
      );
      expect(afterDelete.rows).toHaveLength(2);
      expect(afterDelete.rows).toEqual(expect.arrayContaining(expectedRows.slice(0, 2)));
      expect(afterDelete.rows.some((row) => row.id === createdId)).toBe(false);
    } finally {
      if (ownedRowIds.length === 0) {
        cleanupSucceeded = true;
      } else {
        await database.query(
          `delete from public.shopping_list_items
           where tenant_id = $1 and user_id = $2 and id = any($3::uuid[])`,
          [identity.tenantId, identity.userId, ownedRowIds]
        );
        const remaining = await database.query<{ count: string }>(
          `select count(*)::text as count from public.shopping_list_items
           where tenant_id = $1 and user_id = $2 and id = any($3::uuid[])`,
          [identity.tenantId, identity.userId, ownedRowIds]
        );
        expect(remaining.rows[0]?.count).toBe('0');
        cleanupSucceeded = true;
      }
      expect(cleanupSucceeded).toBe(true);
      testInfo.annotations.push({
        type: 'cleanup-result',
        description: ownedRowIds.length > 0
          ? 'Exact user+tenant-scoped row cleanup succeeded.'
          : 'No shopping rows were created; no cleanup was needed.',
      });
    }
  });
});
