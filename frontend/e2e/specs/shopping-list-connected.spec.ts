import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { Pool } from 'pg';
import { validateE2ETargets } from '../database-target';
import { injectAuth } from '../fixtures/auth';

const database = new Pool({ connectionString: validateE2ETargets(process.env).databaseUrl });

test.describe('Connected shopping list API', () => {
  test.afterAll(async () => {
    await database.end();
  });

  test('confirms an actual 30-unit purchase for two 11+15-unit source rows exactly once', async ({
    page,
  }) => {
    await injectAuth(page);
    const profile = await page.request.get('/api/profile');
    expect(profile.ok()).toBeTruthy();
    const { user } = (await profile.json()) as {
      user: { id: string; tenant: { tenantId: string } | null };
    };
    const tenantId = user.tenant?.tenantId;
    if (!tenantId) throw new Error('Missing E2E tenant');

    const name = `E2E shopping pack ${randomUUID()}`;
    const ids: string[] = [];
    let inventoryId: string | null = null;
    try {
      for (const amount of [11, 15]) {
        const created = await page.request.post('/api/shopping-list', {
          data: { ingredientName: name, quantity: `${amount} unidad`, source: 'manual' },
        });
        expect(created.status()).toBe(201);
        const payload = (await created.json()) as { item: { id: string } };
        ids.push(payload.item.id);
      }
      const originalRows = ids.map((id, index) => ({
        id,
        ingredientName: name,
        quantity: `${[11, 15][index]} unidad`,
      }));
      const payload = {
        groupKey: `pending:${name.toLowerCase()}`,
        rows: originalRows,
        actualQuantity: '30 unidad',
      };
      const tooSmall = await page.request.post('/api/shopping-list/purchase-group', {
        data: { ...payload, actualQuantity: '25 unidad' },
      });
      expect(tooSmall.status()).toBe(409);
      const pending = await database.query<{ status: string }>(
        'select status from public.shopping_list_items where tenant_id=$1 and user_id=$2 and id=any($3::uuid[])',
        [tenantId, user.id, ids]
      );
      expect(pending.rows.map((row) => row.status)).toEqual(['pending', 'pending']);

      const purchased = await page.request.post('/api/shopping-list/purchase-group', {
        data: payload,
      });
      expect(purchased.status()).toBe(200);
      const receipt = (await purchased.json()) as {
        items: Array<{
          id: string;
          status: string;
          quantity: string;
          purchased_quantity: string;
          purchased_unit: string;
          transfer_inventory_item_id: string;
        }>;
        inventoryItem: { id: string; quantity: string; unit: string };
      };
      inventoryId = receipt.inventoryItem.id;
      expect(receipt.inventoryItem).toMatchObject({ quantity: '30', unit: 'unidad' });
      expect(receipt.items).toHaveLength(2);
      for (const source of receipt.items) {
        expect(ids).toContain(source.id);
        expect(source.status).toBe('purchased');
        expect(source.transfer_inventory_item_id).toBe(inventoryId);
        expect(source.purchased_quantity).toBe('30');
      }
      const records = await database.query<{
        quantity: string;
        status: string;
        transfer_inventory_item_id: string;
      }>(
        'select quantity,status,transfer_inventory_item_id from public.shopping_list_items where tenant_id=$1 and user_id=$2 and id=any($3::uuid[]) order by quantity',
        [tenantId, user.id, ids]
      );
      expect(records.rows.map((r) => r.quantity)).toEqual(['11 unidad', '15 unidad']);
      expect(
        records.rows.every(
          (r) => r.status === 'purchased' && r.transfer_inventory_item_id === inventoryId
        )
      ).toBe(true);
      const movements = await database.query<{ quantity: string; unit: string }>(
        'select quantity,unit from public.inventory_movements where inventory_item_id=$1 and tenant_id=$2 and user_id=$3',
        [inventoryId, tenantId, user.id]
      );
      expect(movements.rows).toHaveLength(1);
      expect(Number(movements.rows[0]?.quantity)).toBe(30);
      expect(movements.rows[0]?.unit).toBe('unidad');
      const replay = await page.request.post('/api/shopping-list/purchase-group', {
        data: payload,
      });
      expect(replay.status()).toBe(409);

      const listed = await page.request.get('/api/shopping-list?status=purchased');
      expect(listed.ok()).toBe(true);
      const all = (await listed.json()) as {
        items: Array<{
          id: string;
          purchased_quantity?: string | null;
          purchased_unit?: string | null;
        }>;
      };
      expect(all.items.filter((i) => ids.includes(i.id))).toEqual(
        expect.arrayContaining(
          ids.map((id) =>
            expect.objectContaining({
              id,
              purchased_quantity: '30',
              purchased_unit: 'unidad',
            })
          )
        )
      );
    } finally {
      if (ids.length > 0)
        await database.query(
          'delete from public.shopping_list_items where tenant_id=$1 and user_id=$2 and id=any($3::uuid[])',
          [tenantId, user.id, ids]
        );
      if (inventoryId) {
        await database.query(
          'delete from public.inventory_movements where inventory_item_id=$1 and tenant_id=$2 and user_id=$3',
          [inventoryId, tenantId, user.id]
        );
        await database.query(
          'delete from public.recipe_inventory_items where id=$1 and tenant_id=$2 and user_id=$3',
          [inventoryId, tenantId, user.id]
        );
      }
    }
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
          expect.objectContaining({
            id: itemId,
            ingredient_name: ingredientName,
            status: 'pending',
          }),
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
