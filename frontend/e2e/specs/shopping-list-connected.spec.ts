import { expect, test } from '@playwright/test';
import { Pool } from 'pg';
import { injectAuth } from '../fixtures/auth';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://cocinacore_user:cocinacore_password@localhost:5433/cocinacore_local_db';

const database = new Pool({ connectionString: DATABASE_URL });

test.describe('Connected shopping list API', () => {
  test.afterAll(async () => {
    await database.end();
  });

  test('persists, updates, and deletes an explicitly created item', async ({ page }, testInfo) => {
    await injectAuth(page);
    const profileResponse = await page.request.get('/api/profile');
    expect(profileResponse.ok()).toBeTruthy();
    const profile = (await profileResponse.json()) as {
      user: { id: string; tenant: { tenantId: string } | null };
    };
    const { id: userId, tenant } = profile.user;
    const tenantId = tenant?.tenantId;
    if (!tenantId) throw new Error('Authenticated E2E identity is missing a tenant.');
    const ingredientName = `E2E shopping item ${Date.now()}-${testInfo.workerIndex}`;
    let itemId: string | null = null;

    try {
      const createResponse = await page.request.post('/api/shopping-list', {
        data: { ingredientName, quantity: '2 units', source: 'manual' },
      });
      expect(createResponse.status()).toBe(201);
      const created = (await createResponse.json()) as {
        item: {
          id: string;
          ingredient_name: string;
          quantity: string;
          source: string;
          status: string;
          tenant_id?: string;
          user_id?: string;
        };
      };
      itemId = created.item.id;
      expect(created.item).toMatchObject({
        ingredient_name: ingredientName,
        quantity: '2 units',
        source: 'manual',
        status: 'pending',
      });
      expect(created.item).not.toHaveProperty('tenant_id');
      expect(created.item).not.toHaveProperty('user_id');

      const stored = await database.query<{
        id: string;
        tenant_id: string;
        user_id: string;
        ingredient_name: string;
        status: string;
      }>(
        `select id, tenant_id, user_id, ingredient_name, status
         from public.shopping_list_items
         where id = $1 and tenant_id = $2 and user_id = $3`,
        [itemId, tenantId, userId]
      );
      expect(stored.rows).toHaveLength(1);
      expect(stored.rows[0]).toMatchObject({
        id: itemId,
        tenant_id: tenantId,
        user_id: userId,
        ingredient_name: ingredientName,
        status: 'pending',
      });

      const listedResponse = await page.request.get('/api/shopping-list?status=pending');
      expect(listedResponse.ok()).toBeTruthy();
      const listed = (await listedResponse.json()) as {
        items: Array<{ id: string; ingredient_name: string; status: string }>;
      };
      expect(listed.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: itemId, ingredient_name: ingredientName, status: 'pending' }),
        ])
      );

      const updateResponse = await page.request.patch(`/api/shopping-list/${itemId}`, {
        data: { status: 'purchased' },
      });
      expect(updateResponse.ok()).toBeTruthy();
      const updatedResponse = (await updateResponse.json()) as { item: { status: string } };
      expect(updatedResponse.item.status).toBe('purchased');

      const updated = await database.query<{ status: string }>(
        `select status from public.shopping_list_items
         where id = $1 and tenant_id = $2 and user_id = $3`,
        [itemId, tenantId, userId]
      );
      expect(updated.rows[0]?.status).toBe('purchased');

      const deleteResponse = await page.request.delete(`/api/shopping-list/${itemId}`);
      expect(deleteResponse.ok()).toBeTruthy();
      expect(await deleteResponse.json()).toEqual({ ok: true });

      const deleted = await database.query(
        `select id from public.shopping_list_items
         where id = $1 and tenant_id = $2 and user_id = $3`,
        [itemId, tenantId, userId]
      );
      expect(deleted.rows).toHaveLength(0);
      itemId = null;
    } finally {
      if (itemId) {
        await database.query(
          'delete from public.shopping_list_items where id = $1 and tenant_id = $2 and user_id = $3',
          [itemId, tenantId, userId]
        );
      }
    }
  });
});
