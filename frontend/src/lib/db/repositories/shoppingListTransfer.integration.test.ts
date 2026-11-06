import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { getPool, scopedTransaction } from '@/lib/db';
import { transferPurchasedShoppingListItem } from './shoppingListRepository';

const enabled = process.env.COCINACORE_SIGNUP_REAL_SCHEMA_TEST === '1';
let admin: Pool;
const a = { tenantId: randomUUID(), userId: randomUUID() };
const b = { tenantId: randomUUID(), userId: randomUUID() };

async function fixture(name: string): Promise<string> {
  const id = randomUUID();
  await admin.query(
    `insert into shopping_list_items(id, tenant_id, user_id, source, ingredient_name, quantity, status)
     values ($1,$2,$3,'manual',$4,'2 kg','purchased')`,
    [id, a.tenantId, a.userId, name]
  );
  return id;
}
async function physical(itemId: string) {
  const result = await admin.query<{
    inventory_count: number;
    movement_count: number;
    marker: string | null;
  }>(
    `select s.transfer_inventory_item_id as marker,
      (select count(*)::int from recipe_inventory_items i where i.id = s.transfer_inventory_item_id) inventory_count,
      (select count(*)::int from inventory_movements m where m.inventory_item_id = s.transfer_inventory_item_id) movement_count
     from shopping_list_items s where s.id=$1`,
    [itemId]
  );
  return result.rows[0];
}

describe.skipIf(!enabled)('shopping transfer on private migrated PostgreSQL', () => {
  beforeAll(async () => {
    const runtime = new URL(process.env.DATABASE_URL ?? '');
    const owner = new URL(process.env.SIGNUP_TEST_ADMIN_URL ?? '');
    if (
      runtime.hostname !== '127.0.0.1' ||
      runtime.username !== 'cocinacore_runtime_rls' ||
      runtime.pathname !== '/signup_real_disposable' ||
      runtime.host !== owner.host ||
      runtime.pathname !== owner.pathname ||
      ['5435', '6381'].includes(runtime.port)
    )
      throw new Error('Private disposable runtime/admin pair required');
    admin = new Pool({ connectionString: owner.toString(), max: 1 });
    const role = await getPool().query<{
      current_user: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>('select current_user, rolsuper, rolbypassrls from pg_roles where rolname=current_user');
    expect(role.rows[0]).toMatchObject({
      current_user: 'cocinacore_runtime_rls',
      rolsuper: false,
      rolbypassrls: false,
    });
    const marker = await admin.query<{ marker: string }>(
      "select shobj_description(oid,'pg_database') marker from pg_database where datname=current_database()"
    );
    expect(marker.rows[0].marker).toBe('cocinacore-signup-real-disposable');
    for (const [index, scope] of [a, b].entries()) {
      await admin.query('insert into tenants(id,name) values ($1,$2)', [
        scope.tenantId,
        `shopping-test-${index}`,
      ]);
      await admin.query(
        'insert into users(id,email,password_hash,tenant_id,role) values($1,$2,$3,$4,$5)',
        [
          scope.userId,
          `shopping-${index}-${randomUUID()}@example.test`,
          'fixture',
          scope.tenantId,
          'owner',
        ]
      );
    }
    if (process.env.COCINACORE_INVENTORY_RLS_TEST === '1') {
      for (const scope of [a, b])
        await admin.query('insert into tenant_memberships (tenant_id, user_id) values ($1, $2)', [
          scope.tenantId,
          scope.userId,
        ]);
    }
    await admin.query(`create table public.shopping_transfer_observation (pid integer, tenant text, actor text);
      grant insert on public.shopping_transfer_observation to cocinacore_runtime_rls;
      create function public.shopping_transfer_probe() returns trigger language plpgsql security invoker as $$
      begin
        insert into public.shopping_transfer_observation values (pg_backend_pid(), current_setting('app.tenant_id',true), current_setting('app.user_id',true));
        if new.normalized_name = 'rollbackrice' then raise exception 'injected transfer failure'; end if;
        if new.normalized_name = 'racerice' then perform pg_sleep(0.2); end if;
        return new;
      end $$;
      create trigger shopping_transfer_probe before insert on public.inventory_movements for each row execute function public.shopping_transfer_probe();`);
  });
  afterAll(async () => {
    await getPool().end();
    await admin?.end();
  });

  it('A: creates one ingredient and movement, persists marker and verified context', async () => {
    const id = await fixture('SuccessRice');
    const result = await transferPurchasedShoppingListItem(id, a.tenantId, a.userId);
    expect(result).not.toBeNull();
    expect(await physical(id)).toEqual({
      marker: result?.inventoryItem.id,
      inventory_count: 1,
      movement_count: 1,
    });
    const obs = await admin.query<{ tenant: string; actor: string }>(
      'select tenant, actor from shopping_transfer_observation order by ctid desc limit 1'
    );
    expect(obs.rows[0]).toEqual({ tenant: a.tenantId, actor: a.userId });
  });
  it('B: rolls back ingredient and movement after injected post-ingredient failure', async () => {
    const id = await fixture('RollbackRice');
    await expect(transferPurchasedShoppingListItem(id, a.tenantId, a.userId)).rejects.toThrow(
      'injected transfer failure'
    );
    expect(await physical(id)).toEqual({ marker: null, inventory_count: 0, movement_count: 0 });
    const leftovers = await admin.query<{ n: number }>(
      "select count(*)::int n from recipe_inventory_items where tenant_id=$1 and normalized_name='rollbackrice'",
      [a.tenantId]
    );
    expect(leftovers.rows[0].n).toBe(0);
  });
  it('C: replay returns the persisted transfer without duplicates', async () => {
    const id = await fixture('ReplayRice');
    const first = await transferPurchasedShoppingListItem(id, a.tenantId, a.userId);
    const second = await transferPurchasedShoppingListItem(id, a.tenantId, a.userId);
    expect(second?.inventoryItem.id).toBe(first?.inventoryItem.id);
    expect(await physical(id)).toEqual({
      marker: first?.inventoryItem.id,
      inventory_count: 1,
      movement_count: 1,
    });
  });
  it('D: simultaneous transfers serialize without duplicate rows', async () => {
    const id = await fixture('RaceRice');
    const results = await Promise.all([
      transferPurchasedShoppingListItem(id, a.tenantId, a.userId),
      transferPurchasedShoppingListItem(id, a.tenantId, a.userId),
    ]);
    expect(results[0]?.inventoryItem.id).toBe(results[1]?.inventoryItem.id);
    expect(await physical(id)).toEqual({
      marker: results[0]?.inventoryItem.id,
      inventory_count: 1,
      movement_count: 1,
    });
    const created = await admin.query<{ n: number }>(
      "select count(*)::int n from recipe_inventory_items where tenant_id=$1 and normalized_name='racerice'",
      [a.tenantId]
    );
    expect(created.rows[0].n).toBe(1);
  }, 10000);
  it('E: rejects wrong tenant/user through application predicates', async () => {
    const id = await fixture('ForeignRice');
    expect(await transferPurchasedShoppingListItem(id, b.tenantId, b.userId)).toBeNull();
    expect(await physical(id)).toEqual({ marker: null, inventory_count: 0, movement_count: 0 });
  });
  it('F: local context disappears on same backend after commit and rollback', async () => {
    for (const fail of [false, true]) {
      let pid = 0;
      const work = scopedTransaction(a, async (client) => {
        const result = await client.query<{ pid: number; tenant: string; actor: string }>(
          "select pg_backend_pid() pid,current_setting('app.tenant_id',true) tenant,current_setting('app.user_id',true) actor"
        );
        expect(result.rows[0]).toMatchObject({ tenant: a.tenantId, actor: a.userId });
        pid = result.rows[0].pid;
        if (fail) throw new Error('rollback requested');
      });
      if (fail) await expect(work).rejects.toThrow('rollback requested');
      else await work;
      const client = await getPool().connect();
      try {
        const result = await client.query<{
          pid: number;
          tenant: string | null;
          actor: string | null;
        }>(
          "select pg_backend_pid() pid, nullif(current_setting('app.tenant_id',true),'') tenant, nullif(current_setting('app.user_id',true),'') actor"
        );
        expect(result.rows[0]).toEqual({ pid, tenant: null, actor: null });
      } finally {
        client.release();
      }
    }
  });
});
