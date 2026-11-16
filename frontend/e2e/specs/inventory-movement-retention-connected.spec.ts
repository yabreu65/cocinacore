import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { Pool } from 'pg';
import { validateE2ETargets } from '../database-target';
import { injectAuth } from '../fixtures/auth';
import { assertE2EDisposableIsolation } from '../fixtures/database';
import { resolveRecipePersistentIdentity } from '../fixtures/recipe-persistent';

const targets = validateE2ETargets(process.env);
const admin = new Pool({ connectionString: targets.databaseUrl });
const runtime = new Pool({ connectionString: targets.appDatabaseUrl });

test.afterAll(async () => {
  await Promise.all([admin.end(), runtime.end()]);
});

test('protects visible and hidden movement history without granting extra privileges', async ({ page }) => {
  await assertE2EDisposableIsolation(admin);
  await injectAuth(page);
  const identity = await resolveRecipePersistentIdentity(await page.request.get('/api/profile'));
  const foreignTenant = randomUUID();
  const foreignUser = randomUUID();
  const freshItem = randomUUID();
  const auditedItem = randomUUID();
  const hiddenItem = randomUUID();
  const foreignItem = randomUUID();
  const ownMovement = randomUUID();
  const hiddenMovement = randomUUID();
  const items = [freshItem, auditedItem, hiddenItem, foreignItem];
  const movements = [ownMovement, hiddenMovement];
  try {
    await admin.query('insert into public.tenants(id,name) values ($1,$2)', [foreignTenant, 'Disposable movement test']);
    await admin.query(
      "insert into public.users(id,tenant_id,email,password_hash) values ($1,$2,$3,'fixture')",
      [foreignUser, foreignTenant, foreignUser + '@example.invalid']
    );
    await admin.query(
      "insert into public.recipe_inventory_items(id,tenant_id,user_id,ingredient_name,quantity,unit) values ($1,$2,$3,'Fresh retention fixture','1','kg'),($4,$2,$3,'Audited retention fixture','1','kg'),($5,$2,$3,'Hidden retention fixture','1','kg'),($6,$7,$8,'Foreign retention fixture','1','kg')",
      [freshItem, identity.tenantId, identity.userId, auditedItem, hiddenItem, foreignItem, foreignTenant, foreignUser]
    );
    // Simulate an inconsistent historical row; only the isolated administrator
    // can seed it. The normal RLS INSERT policy rejects a foreign parent.
    await admin.query(
      "insert into public.inventory_movements(id,tenant_id,user_id,inventory_item_id,movement_type,quantity,unit,normalized_name) values ($1,$2,$3,$4,'purchase',1,'kg','audited'),($5,$6,$7,$8,'purchase',1,'kg','hidden')",
      [ownMovement, identity.tenantId, identity.userId, auditedItem, hiddenMovement, foreignTenant, foreignUser, hiddenItem]
    );
    const client = await runtime.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)", [identity.tenantId, identity.userId]);
      const visible = await client.query<{id: string}>('select id from public.inventory_movements where id = any($1::uuid[])', [movements]);
      expect(visible.rows.map(({ id }) => id)).toEqual([ownMovement]);
      await client.query('rollback');
    } finally {
      await client.query('rollback');
      client.release();
    }
    const remove = (id: string) => page.request.delete('/api/inventory?id=' + id);
    expect((await remove(foreignItem)).status()).toBe(404);
    expect((await remove(auditedItem)).status()).toBe(409);
    expect((await remove(hiddenItem)).status()).toBe(409);
    expect((await remove(freshItem)).status()).toBe(200);
    expect((await remove(freshItem)).status()).toBe(404);
    const remainingItems = await admin.query<{id: string}>('select id from public.recipe_inventory_items where id = any($1::uuid[])', [items]);
    expect(remainingItems.rows.map(({ id }) => id).sort()).toEqual([auditedItem, hiddenItem, foreignItem].sort());
    const retained = await admin.query<{id: string}>('select id from public.inventory_movements where id = any($1::uuid[])', [movements]);
    expect(retained.rows.map(({ id }) => id).sort()).toEqual([...movements].sort());
  } finally {
    // Exact disposable fixture identifiers only, children before parents.
    await admin.query('delete from public.inventory_movements where id = any($1::uuid[])', [movements]);
    await admin.query('delete from public.recipe_inventory_items where id = any($1::uuid[])', [items]);
    await admin.query('delete from public.users where id = $1 and tenant_id = $2', [foreignUser, foreignTenant]);
    await admin.query('delete from public.tenants where id = $1', [foreignTenant]);
  }
});
