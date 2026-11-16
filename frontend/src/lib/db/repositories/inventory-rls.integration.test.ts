import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool, type PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { createInventoryItem, deleteInventoryItem, listInventoryItemsScoped } from './inventoryRepository';
import { getPool } from '@/lib/db';
import { manageInventoryItem } from './inventoryManagementRepository';
import { consumePlannedMeal } from './mealPlanConsumptionRepository';

const enabled = process.env.COCINACORE_INVENTORY_RLS_TEST === '1';
const a = { tenantId: randomUUID(), userId: randomUUID() };
const a2 = { tenantId: a.tenantId, userId: randomUUID() };
const b = { tenantId: randomUUID(), userId: randomUUID() };
const itemA = randomUUID();
const itemB = randomUUID();
let admin: Pool;
let runtime: Pool;
async function context(client: PoolClient, scope: { tenantId: string; userId: string }) {
  await client.query(
    "select set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)",
    [scope.tenantId, scope.userId]
  );
}
async function scoped<T>(
  scope: { tenantId: string; userId: string },
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await runtime.connect();
  try {
    await client.query('begin');
    await context(client, scope);
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
describe.skipIf(!enabled)('candidate inventory RLS on disposable PostgreSQL', () => {
  beforeAll(async () => {
    const owner = new URL(process.env.SIGNUP_TEST_ADMIN_URL ?? '');
    const data = new URL(process.env.DATABASE_URL ?? '');
    if (
      owner.hostname !== '127.0.0.1' ||
      owner.pathname !== '/signup_real_disposable' ||
      data.host !== owner.host ||
      data.pathname !== owner.pathname ||
      data.username !== 'cocinacore_runtime_rls'
    )
      throw new Error('Disposable PostgreSQL required');
    admin = new Pool({ connectionString: owner.toString() });
    runtime = new Pool({ connectionString: data.toString(), max: 1 });
    const marker = await admin.query<{ marker: string }>(
      "select shobj_description(oid,'pg_database') marker from pg_database where datname=current_database()"
    );
    if (marker.rows[0].marker !== 'cocinacore-signup-real-disposable')
      throw new Error('Disposable marker missing');
    await admin.query("insert into tenants(id,name) values ($1,'A'),($2,'B')", [
      a.tenantId,
      b.tenantId,
    ]);
    for (const user of [a, a2, b]) {
      await admin.query(
        "insert into users(id,tenant_id,email,password_hash) values ($1,$2,$3,'fixture')",
        [user.userId, user.tenantId, `${user.userId}@example.test`]
      );
      await admin.query('insert into tenant_memberships(tenant_id,user_id) values ($1,$2)', [
        user.tenantId,
        user.userId,
      ]);
    }
    await admin.query(
      "insert into recipe_inventory_items(id,tenant_id,user_id,ingredient_name,quantity,unit) values ($1,$2,$3,'A','4','kg'),($4,$5,$6,'B','4','kg')",
      [itemA, a.tenantId, a.userId, itemB, b.tenantId, b.userId]
    );
    await admin.query(
      "insert into inventory_movements(tenant_id,user_id,inventory_item_id,movement_type,quantity,unit,normalized_name) values ($1,$2,$3,'purchase',1,'kg','a'),($4,$5,$6,'purchase',1,'kg','b')",
      [a.tenantId, a.userId, itemA, b.tenantId, b.userId, itemB]
    );
  });
  afterAll(async () => {
    await Promise.all([runtime?.end(), admin?.end(), getPool().end()]);
  });
  it('isolates unfiltered inventory and movements while sharing within a tenant', async () => {
    for (const scope of [a, a2, b]) {
      const actual = await scoped(scope, async (client) => ({
        inventory: await client.query<{ id: string }>('select id from recipe_inventory_items'),
        movements: await client.query<{ tenant_id: string }>(
          'select tenant_id from inventory_movements'
        ),
      }));
      expect(actual.inventory.rows.map((row) => row.id)).toEqual([
        scope.tenantId === a.tenantId ? itemA : itemB,
      ]);
      expect(actual.movements.rows.map((row) => row.tenant_id)).toEqual([scope.tenantId]);
    }
    expect((await listInventoryItemsScoped(a2)).map((item) => item.id)).toEqual([itemA]);
  });
  it('fails closed for absent, malformed or contradictory context and clears pooled connections', async () => {
    expect((await runtime.query('select * from recipe_inventory_items')).rowCount).toBe(0);
    expect(
      (
        await scoped({ tenantId: a.tenantId, userId: b.userId }, (client) =>
          client.query('select * from recipe_inventory_items')
        )
      ).rowCount
    ).toBe(0);
    await expect(
      scoped({ tenantId: 'invalid', userId: a.userId }, (client) =>
        client.query('select * from recipe_inventory_items')
      )
    ).rejects.toMatchObject({ code: '22P02' });
    await expect(
      scoped({ tenantId: a.tenantId, userId: 'invalid' }, (client) =>
        client.query('select * from inventory_movements')
      )
    ).rejects.toMatchObject({ code: '22P02' });
    const nonmember = randomUUID();
    await admin.query(
      "insert into users(id,tenant_id,email,password_hash) values ($1,$2,$3,'fixture')",
      [nonmember, a.tenantId, `${nonmember}@example.test`]
    );
    expect(
      (
        await scoped({ tenantId: a.tenantId, userId: nonmember }, (client) =>
          client.query('select * from recipe_inventory_items')
        )
      ).rowCount
    ).toBe(0);
    expect((await runtime.query('select * from recipe_inventory_items')).rowCount).toBe(0);
    expect((await runtime.query('select * from inventory_movements')).rowCount).toBe(0);
  });
  it('allows scoped CRUD but denies cross-tenant and identity changes', async () => {
    const created = await createInventoryItem({
      tenantId: a.tenantId,
      userId: a2.userId,
      ingredientName: 'Shared',
      quantity: '3',
      unit: 'kg',
    });
    const shared = (await listInventoryItemsScoped(a)).find((row) => row.id === created.id);
    if (!shared?.revision) throw new Error('Missing shared inventory revision');
    expect(
      await manageInventoryItem(a, {
        id: created.id,
        revision: shared.revision,
        action: 'stock',
        command: { kind: 'convert', unit: 'g' },
      })
    ).toMatchObject({
      status: 'updated',
      item: { quantity: '3000', unit: 'g', user_id: a2.userId },
    });
    expect(
      (
        await scoped(a, (c) =>
          c.query('update recipe_inventory_items set quantity=$1 where id=$2', ['8', itemB])
        )
      ).rowCount
    ).toBe(0);
    for (const col of ['tenant_id', 'user_id'])
      await expect(
        scoped(a, (c) =>
          c.query(`update recipe_inventory_items set ${col}=$1 where id=$2`, [b.userId, itemA])
        )
      ).rejects.toMatchObject({ code: '42501' });
    await expect(
      scoped(a, (c) =>
        c.query(
          "insert into recipe_inventory_items(tenant_id,user_id,ingredient_name) values ($1,$2,'bad')",
          [b.tenantId, b.userId]
        )
      )
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      scoped(a, (c) =>
        c.query(
          "insert into recipe_inventory_items(tenant_id,user_id,ingredient_name) values ($1,$2,'bad')",
          [a.tenantId, a2.userId]
        )
      )
    ).rejects.toMatchObject({ code: '42501' });
    expect(
      (await scoped(a, (c) => c.query('delete from recipe_inventory_items where id=$1', [itemB])))
        .rowCount
    ).toBe(0);
    expect(await deleteInventoryItem(itemB, a.tenantId, a)).toBe('not_found');
    expect(await deleteInventoryItem(itemA, a.tenantId, a)).toBe('history_unavailable');
    expect(await deleteInventoryItem(created.id, a.tenantId, a)).toBe('history_unavailable');
    expect((await listInventoryItemsScoped(a)).some((item) => item.id === created.id)).toBe(true);
    // This historical 020 fixture deliberately tests the old SQL ACL independently.
    expect((await scoped(a, (c) => c.query('delete from recipe_inventory_items where id=$1', [created.id]))).rowCount).toBe(1);
    expect((await admin.query('select id from public.inventory_movements where inventory_item_id = $1', [itemA])).rowCount).toBe(1);
  });
  it('enforces tenant parent references and append-only movements', async () => {
    const insert =
      "insert into inventory_movements(tenant_id,user_id,inventory_item_id,movement_type,quantity,unit,normalized_name) values ($1,$2,$3,'purchase',1,'kg','test')";
    await scoped(a2, (c) => c.query(insert, [a.tenantId, a2.userId, itemA]));
    await expect(
      scoped(a, (c) => c.query(insert, [a.tenantId, a.userId, itemB]))
    ).rejects.toMatchObject({ code: '42501' });
    for (const sql of [
      'update inventory_movements set quantity=2',
      'delete from inventory_movements',
    ])
      await expect(scoped(a, (c) => c.query(sql))).rejects.toMatchObject({ code: '42501' });
  });
  it('rolls back and commits with one transaction-local scope', async () => {
    const id = randomUUID();
    await expect(
      scoped(a, async (c) => {
        await c.query(
          "insert into recipe_inventory_items(id,tenant_id,user_id,ingredient_name) values ($1,$2,$3,'rollback')",
          [id, a.tenantId, a.userId]
        );
        throw new Error('rollback');
      })
    ).rejects.toThrow('rollback');
    expect(
      (await admin.query('select id from recipe_inventory_items where id=$1', [id])).rowCount
    ).toBe(0);
    await scoped(a, (c) =>
      c.query(
        "insert into recipe_inventory_items(id,tenant_id,user_id,ingredient_name) values ($1,$2,$3,'commit')",
        [id, a.tenantId, a.userId]
      )
    );
    expect(
      (await admin.query('select id from recipe_inventory_items where id=$1', [id])).rowCount
    ).toBe(1);
  });
  it('consumes a planned meal atomically and idempotently under candidate RLS', async () => {
    const inventory = await createInventoryItem({
      tenantId: a.tenantId,
      userId: a.userId,
      ingredientName: 'Planned Rice',
      normalizedName: 'planned rice',
      quantity: '4',
      unit: 'kg',
    });
    const calendar = {
      period: 'week',
      dayCount: 7,
      days: Array.from({ length: 7 }, (_, index) => ({
        dayIndex: index + 1,
        meals: ['breakfast', 'lunch', 'dinner'].map((mealType) => ({
          mealType,
          title: 'Planned meal',
          description: null,
          prepMinutes: 10,
          ingredients: [{ name: 'Planned Rice', quantity: 1, unit: 'kg' }],
        })),
      })),
    };
    const plan = await admin.query<{ id: string }>(
      `insert into user_meal_plans (tenant_id,user_id,period,mode,calendar_payload)
       values ($1,$2,'week','balanced_ai',$3::jsonb) returning id`,
      [a.tenantId, a.userId, JSON.stringify(calendar)]
    );
    const input = { ...a, mealPlanId: plan.rows[0].id, dayIndex: 1, mealType: 'lunch' as const };
    expect((await consumePlannedMeal(input)).alreadyConsumed).toBe(false);
    expect((await consumePlannedMeal(input)).alreadyConsumed).toBe(true);
    const inventoryAfter = await admin.query<{ quantity: string }>(
      'select quantity from recipe_inventory_items where id=$1',
      [inventory.id]
    );
    const movement = await admin.query<{ count: number }>(
      'select count(*)::int as count from inventory_movements where inventory_item_id=$1',
      [inventory.id]
    );
    expect(Number(inventoryAfter.rows[0].quantity)).toBe(3);
    expect(movement.rows[0].count).toBe(1);
  });
});
