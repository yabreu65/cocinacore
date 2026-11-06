import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { getPool } from '@/lib/db';
import {
  createRecipeHistory,
  findRecipeHistoryById,
  listRecipeHistoryByTenant,
  updateRecipeFeedback,
} from './recipeRepository';
import { findMealPlanByIdForUserAndTenant } from './mealPlanRepository';
import {
  addMealPlanShoppingItems,
  createShoppingListItem,
  deleteShoppingListItem,
  listShoppingListItems,
  updateShoppingListItemStatus,
} from './shoppingListRepository';

const enabled = process.env.COCINACORE_PLANS_HISTORY_SHOPPING_RLS_TEST === '1';
type Scope = { tenantId: string; userId: string };

const tenantA = randomUUID();
const tenantB = randomUUID();
const userA1 = randomUUID();
const userA2 = randomUUID();
const userB1 = randomUUID();
const a1: Scope = { tenantId: tenantA, userId: userA1 };
const a2: Scope = { tenantId: tenantA, userId: userA2 };
const b1: Scope = { tenantId: tenantB, userId: userB1 };

const ids = {
  planA1Week: randomUUID(),
  planA1Fortnight: randomUUID(),
  planA2: randomUUID(),
  planB1: randomUUID(),
  historyA1: randomUUID(),
  historyA2: randomUUID(),
  historyB1: randomUUID(),
  shoppingA1: randomUUID(),
  shoppingA2: randomUUID(),
  shoppingB1: randomUUID(),
};

let admin: Pool;
let runtime: Pool;

async function inContext<T>(
  scope: Scope | { tenantId: string; userId: string } | null,
  operation: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await runtime.connect();
  try {
    await client.query('begin');
    if (scope) {
      await client.query(
        "select set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)",
        [scope.tenantId, scope.userId]
      );
    }
    const result = await operation(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

describe.skipIf(!enabled)(
  '020D1 plans, history and shopping FORCE RLS on disposable PostgreSQL',
  () => {
    beforeAll(async () => {
      const adminUrl = new URL(process.env.SIGNUP_TEST_ADMIN_URL ?? '');
      const runtimeUrl = new URL(process.env.DATABASE_URL ?? '');
      if (
        adminUrl.hostname !== '127.0.0.1' ||
        adminUrl.pathname !== '/signup_real_disposable' ||
        runtimeUrl.hostname !== adminUrl.hostname ||
        runtimeUrl.host !== adminUrl.host ||
        runtimeUrl.pathname !== adminUrl.pathname ||
        runtimeUrl.username !== 'cocinacore_runtime_rls' ||
        ['5435', '6381'].includes(runtimeUrl.port)
      ) {
        throw new Error('Private disposable PostgreSQL with restricted runtime required');
      }
      admin = new Pool({ connectionString: adminUrl.toString(), max: 2 });
      runtime = new Pool({ connectionString: runtimeUrl.toString(), max: 1 });

      const marker = await admin.query<{ marker: string }>(
        "select shobj_description(oid,'pg_database') marker from pg_database where datname=current_database()"
      );
      expect(marker.rows[0].marker).toBe('cocinacore-signup-real-disposable');
      const protectedTables = await runtime.query<{
        table_name: string;
        enabled: boolean;
        forced: boolean;
      }>(
        `select c.relname as table_name, c.relrowsecurity as enabled, c.relforcerowsecurity as forced
       from pg_class c where c.oid = any(array[
         'public.user_meal_plans'::regclass,
         'public.recipe_ai_history'::regclass,
         'public.shopping_list_items'::regclass
       ]) order by c.relname`
      );
      expect(protectedTables.rows).toEqual([
        { table_name: 'recipe_ai_history', enabled: true, forced: true },
        { table_name: 'shopping_list_items', enabled: true, forced: true },
        { table_name: 'user_meal_plans', enabled: true, forced: true },
      ]);
      const identity = await runtime.query<{
        current_user: string;
        rolbypassrls: boolean;
        rolsuper: boolean;
      }>('select current_user, rolbypassrls, rolsuper from pg_roles where rolname=current_user');
      expect(identity.rows[0]).toEqual({
        current_user: 'cocinacore_runtime_rls',
        rolbypassrls: false,
        rolsuper: false,
      });

      await admin.query('insert into tenants(id, name) values ($1, $2), ($3, $4)', [
        tenantA,
        '020D1 Tenant A',
        tenantB,
        '020D1 Tenant B',
      ]);
      for (const [scope, label] of [
        [a1, 'a1'],
        [a2, 'a2'],
        [b1, 'b1'],
      ] as const) {
        await admin.query(
          'insert into users(id, email, password_hash, tenant_id, role) values ($1, $2, $3, $4, $5)',
          [
            scope.userId,
            `020d1-${label}-${randomUUID()}@example.test`,
            'fixture',
            scope.tenantId,
            'owner',
          ]
        );
        await admin.query('insert into tenant_memberships(tenant_id, user_id) values ($1, $2)', [
          scope.tenantId,
          scope.userId,
        ]);
      }

      await admin.query(
        `insert into user_meal_plans(id, tenant_id, user_id, period, mode)
       values ($1, $2, $3, 'week', 'inventory_to_menu'),
              ($4, $2, $3, 'fortnight', 'balanced_ai'),
              ($5, $2, $6, 'week', 'menu_to_shopping'),
              ($7, $8, $9, 'week', 'inventory_to_menu')`,
        [
          ids.planA1Week,
          tenantA,
          userA1,
          ids.planA1Fortnight,
          ids.planA2,
          userA2,
          ids.planB1,
          tenantB,
          userB1,
        ]
      );
      await admin.query(
        `insert into recipe_ai_history(id, tenant_id, user_id, source, recipe_title, recipe_payload)
       values ($1, $2, $3, 'ai', 'A1 recipe', '{"title":"A1 recipe"}'),
              ($4, $2, $5, 'ai', 'A2 recipe', '{"title":"A2 recipe"}'),
              ($6, $7, $8, 'ai', 'B1 recipe', '{"title":"B1 recipe"}')`,
        [ids.historyA1, tenantA, userA1, ids.historyA2, userA2, ids.historyB1, tenantB, userB1]
      );
      await admin.query(
        `insert into shopping_list_items(id, tenant_id, user_id, source, ingredient_name)
       values ($1, $2, $3, 'manual', 'A1 manual rice'),
              ($4, $2, $5, 'meal-plan:fixture-a2', 'A2 plan beans'),
              ($6, $7, $8, 'manual', 'B1 manual beans')`,
        [ids.shoppingA1, tenantA, userA1, ids.shoppingA2, userA2, ids.shoppingB1, tenantB, userB1]
      );
    });

    afterAll(async () => {
      await Promise.all([admin?.end(), runtime?.end(), getPool().end()]);
    });

    it('isolates unfiltered meal-plan and shopping reads by owner while sharing history only in-tenant', async () => {
      const a1Rows = await inContext(a1, async (client) => {
        const plans = await client.query<{ id: string; period: string }>(
          'select id, period from public.user_meal_plans order by id'
        );
        const history = await client.query<{ id: string }>(
          'select id from public.recipe_ai_history order by id'
        );
        const shopping = await client.query<{ id: string; source: string }>(
          'select id, source from public.shopping_list_items order by id'
        );
        return { plans: plans.rows, history: history.rows, shopping: shopping.rows };
      });
      expect(a1Rows.plans.map((row) => row.id).sort()).toEqual(
        [ids.planA1Week, ids.planA1Fortnight].sort()
      );
      expect(a1Rows.plans.map((row) => row.period).sort()).toEqual(['fortnight', 'week']);
      expect(a1Rows.history.map((row) => row.id).sort()).toEqual(
        [ids.historyA1, ids.historyA2].sort()
      );
      expect(a1Rows.shopping).toEqual([{ id: ids.shoppingA1, source: 'manual' }]);

      const a2Rows = await inContext(a2, async (client) => ({
        plans: (await client.query<{ id: string }>('select id from public.user_meal_plans')).rows,
        history: (await client.query<{ id: string }>('select id from public.recipe_ai_history'))
          .rows,
        shopping: (await client.query<{ id: string }>('select id from public.shopping_list_items'))
          .rows,
      }));
      expect(a2Rows.plans.map((row) => row.id)).toEqual([ids.planA2]);
      expect(a2Rows.history.map((row) => row.id).sort()).toEqual(
        [ids.historyA1, ids.historyA2].sort()
      );
      expect(a2Rows.shopping.map((row) => row.id)).toEqual([ids.shoppingA2]);

      const bRows = await inContext(b1, async (client) => ({
        plans: (await client.query<{ id: string }>('select id from public.user_meal_plans')).rows,
        history: (await client.query<{ id: string }>('select id from public.recipe_ai_history'))
          .rows,
        shopping: (await client.query<{ id: string }>('select id from public.shopping_list_items'))
          .rows,
      }));
      expect(bRows.plans.map((row) => row.id)).toEqual([ids.planB1]);
      expect(bRows.history.map((row) => row.id)).toEqual([ids.historyB1]);
      expect(bRows.shopping.map((row) => row.id)).toEqual([ids.shoppingB1]);
    });

    it('keeps meal plans tenant-owned, updateable only by their owner, and non-deletable', async () => {
      const inserted = await inContext(a1, (client) =>
        client.query<{ id: string }>(
          `insert into user_meal_plans(tenant_id, user_id, period, mode)
         values ($1, $2, 'week', 'inventory_to_menu') returning id`,
          [tenantA, userA1]
        )
      );
      const ownId = inserted.rows[0].id;
      expect(
        (
          await inContext(a1, (client) =>
            client.query('update user_meal_plans set goal=$1 where id=$2', ['less waste', ownId])
          )
        ).rowCount
      ).toBe(1);
      expect(
        (
          await inContext(a1, (client) =>
            client.query('update user_meal_plans set goal=$1 where id=$2', ['stolen', ids.planA2])
          )
        ).rowCount
      ).toBe(0);
      await expect(
        inContext(a1, (client) =>
          client.query('update user_meal_plans set user_id=$1 where id=$2', [userA2, ownId])
        )
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        inContext(a1, (client) => client.query('delete from user_meal_plans where id=$1', [ownId]))
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        inContext(a1, (client) =>
          client.query(
            `insert into user_meal_plans(tenant_id, user_id, period, mode)
           values ($1, $2, 'week', 'inventory_to_menu')`,
            [tenantB, userB1]
          )
        )
      ).rejects.toMatchObject({ code: '42501' });

      await expect(
        findMealPlanByIdForUserAndTenant(ids.planA1Week, userA1, tenantA)
      ).resolves.toMatchObject({
        id: ids.planA1Week,
        tenant_id: tenantA,
        user_id: userA1,
        period: 'week',
      });
      await expect(
        findMealPlanByIdForUserAndTenant(ids.planA2, userA1, tenantA)
      ).resolves.toBeNull();
    });

    it('shares recipe history inside a tenant but restricts writes and deletes to its creator', async () => {
      const created = await createRecipeHistory({
        tenantId: tenantA,
        userId: userA1,
        source: 'manual',
        recipeTitle: 'Runtime-created recipe',
        recipePayload: { title: 'Runtime-created recipe' },
      });
      const shared = await listRecipeHistoryByTenant(tenantA, {}, a2);
      expect(shared.some((row) => row.id === created.id)).toBe(true);
      expect(
        (await listRecipeHistoryByTenant(tenantB, {}, b1)).some((row) => row.id === created.id)
      ).toBe(false);
      await expect(findRecipeHistoryById(created.id, tenantA, a2)).resolves.toMatchObject({
        id: created.id,
        tenant_id: tenantA,
      });
      await expect(
        updateRecipeFeedback(created.id, tenantA, userA1, 'accepted')
      ).resolves.toMatchObject({
        user_feedback: 'accepted',
      });
      await expect(
        updateRecipeFeedback(created.id, tenantA, userA2, 'discarded')
      ).resolves.toBeNull();

      await expect(
        inContext(a1, (client) =>
          client.query(
            `insert into recipe_ai_history(tenant_id, user_id, source, recipe_payload)
           values ($1, $2, 'ai', '{}'::jsonb)`,
            [tenantA, userA2]
          )
        )
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        inContext(a1, (client) =>
          client.query('update recipe_ai_history set tenant_id=$1 where id=$2', [
            tenantB,
            created.id,
          ])
        )
      ).rejects.toMatchObject({ code: '42501' });
      expect(
        (
          await inContext(a1, (client) =>
            client.query('delete from recipe_ai_history where id=$1', [ids.historyA2])
          )
        ).rowCount
      ).toBe(0);
      expect(
        (
          await inContext(a1, (client) =>
            client.query('delete from recipe_ai_history where id=$1', [created.id])
          )
        ).rowCount
      ).toBe(1);
    });

    it('keeps shopping lists private, preserves source values, and deduplicates concurrent plan inserts', async () => {
      const manual = await createShoppingListItem({
        tenantId: tenantA,
        userId: userA1,
        ingredientName: 'Manual lentils',
        source: 'manual',
      });
      const listed = await listShoppingListItems(tenantA, userA1, {}, undefined, a1);
      expect(listed.some((row) => row.id === manual.id && row.source === 'manual')).toBe(true);
      expect(
        (await listShoppingListItems(tenantA, userA2, {}, undefined, a2)).some(
          (row) => row.id === manual.id
        )
      ).toBe(false);
      expect(
        (await listShoppingListItems(tenantB, userB1, {}, undefined, b1)).some(
          (row) => row.id === manual.id
        )
      ).toBe(false);

      await expect(
        inContext(a1, (client) =>
          client.query(
            `insert into shopping_list_items(tenant_id, user_id, source, ingredient_name)
           values ($1, $2, 'meal-plan:foreign', 'foreign item')`,
            [tenantA, userA2]
          )
        )
      ).rejects.toMatchObject({ code: '42501' });
      expect(
        (
          await inContext(a1, (client) =>
            client.query("update shopping_list_items set status='purchased' where id=$1", [
              ids.shoppingA2,
            ])
          )
        ).rowCount
      ).toBe(0);
      await expect(
        inContext(a1, (client) =>
          client.query('update shopping_list_items set tenant_id=$1 where id=$2', [
            tenantB,
            manual.id,
          ])
        )
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        inContext(a1, (client) =>
          client.query('update shopping_list_items set user_id=$1 where id=$2', [userA2, manual.id])
        )
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        updateShoppingListItemStatus(ids.shoppingA2, tenantA, userA1, 'purchased')
      ).resolves.toBeNull();
      await expect(
        updateShoppingListItemStatus(manual.id, tenantA, userA1, 'purchased')
      ).resolves.toMatchObject({
        id: manual.id,
        source: 'manual',
        status: 'purchased',
      });
      expect(await deleteShoppingListItem(ids.shoppingA2, tenantA, userA1)).toBeNull();
      expect(await deleteShoppingListItem(manual.id, tenantA, userA1)).toMatchObject({
        id: manual.id,
      });

      const source = `meal-plan:${randomUUID()}`;
      const input = {
        tenantId: tenantA,
        userId: userA1,
        source,
        dedupeScope: 'source' as const,
        items: [
          { ingredientName: 'Brown rice', quantity: '1 kg' },
          { ingredientName: ' brown  rice ', quantity: '2 kg' },
        ],
      };
      const results = await Promise.all([
        addMealPlanShoppingItems(input),
        addMealPlanShoppingItems(input),
      ]);
      expect(results.reduce((sum, result) => sum + result.added.length, 0)).toBe(1);
      expect(results.reduce((sum, result) => sum + result.alreadyPresent.length, 0)).toBe(1);
      const persisted = await listShoppingListItems(tenantA, userA1, {}, undefined, a1);
      expect(persisted.filter((row) => row.source === source)).toHaveLength(1);
    });

    it('fails closed without context, with invalid UUID context, and with tenant/user mismatch', async () => {
      const noContext = await inContext(null, async (client) => ({
        plans: await client.query('select id from user_meal_plans'),
        history: await client.query('select id from recipe_ai_history'),
        shopping: await client.query('select id from shopping_list_items'),
      }));
      expect(noContext.plans.rowCount).toBe(0);
      expect(noContext.history.rowCount).toBe(0);
      expect(noContext.shopping.rowCount).toBe(0);

      const mismatch = await inContext({ tenantId: tenantA, userId: userB1 }, async (client) => ({
        plans: await client.query('select id from user_meal_plans'),
        history: await client.query('select id from recipe_ai_history'),
        shopping: await client.query('select id from shopping_list_items'),
      }));
      expect(mismatch.plans.rowCount).toBe(0);
      expect(mismatch.history.rowCount).toBe(0);
      expect(mismatch.shopping.rowCount).toBe(0);

      for (const table of ['user_meal_plans', 'recipe_ai_history', 'shopping_list_items']) {
        try {
          const result = await inContext({ tenantId: 'not-a-uuid', userId: userA1 }, (client) =>
            client.query(`select id from public.${table}`)
          );
          expect(result.rowCount).toBe(0);
        } catch (error) {
          expect(error).toMatchObject({ code: '22P02' });
        }
      }
    });

    it('clears transaction-local identity after both commit and rollback on the same backend', async () => {
      for (const rollback of [false, true]) {
        const client = await runtime.connect();
        let pid: number;
        try {
          await client.query('begin');
          await client.query(
            "select set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)",
            [a1.tenantId, a1.userId]
          );
          const current = await client.query<{ pid: number; count: number }>(
            `select pg_backend_pid() pid, count(*)::int count from user_meal_plans
           where id = any($1::uuid[])`,
            [[ids.planA1Week, ids.planA1Fortnight]]
          );
          pid = current.rows[0].pid;
          expect(current.rows[0].count).toBe(2);
          if (rollback) await client.query('rollback');
          else await client.query('commit');

          const after = await client.query<{
            pid: number;
            tenant: string | null;
            actor: string | null;
          }>(
            "select pg_backend_pid() pid, nullif(current_setting('app.tenant_id', true), '') tenant, nullif(current_setting('app.user_id', true), '') actor"
          );
          expect(after.rows[0]).toEqual({ pid, tenant: null, actor: null });
          expect(
            (
              await client.query('select id from user_meal_plans where id = any($1::uuid[])', [
                [ids.planA1Week, ids.planA1Fortnight],
              ])
            ).rowCount
          ).toBe(0);
        } finally {
          client.release();
        }
      }
    });
  }
);
