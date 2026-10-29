#!/usr/bin/env node
import crypto from 'node:crypto';
import process from 'node:process';
import { Client } from 'pg';

const databaseUrl =
  process.env.M5_U4_MIGRATION_DATABASE_URL ||
  'postgresql://postgres:postgres@127.0.0.1:5435/cocinacore_local_db';
const parsed = new URL(databaseUrl);
if (
  process.env.M5_U4_DISPOSABLE !== '1' ||
  process.env.M5_U4_EXPECT_FRESH !== '1' ||
  parsed.hostname !== '127.0.0.1' ||
  parsed.port !== '5435' ||
  parsed.pathname !== '/cocinacore_local_db'
) {
  throw new Error(
    'Refusing to run migration 019 tests outside the named disposable PostgreSQL target.'
  );
}

const admin = new Client({ connectionString: databaseUrl });
const testRole = 'm5_u4_rls_test';
const testPassword = 'm5-u4-local-only-password';
const id = () => crypto.randomUUID();
const tenantId = id();
const userId = id();
const planId = id();
const recipeId = id();
const versionId = id();
const sessionId = id();
const rollbackSessionId = id();
const inventoryId = id();
const substituteInventoryId = id();
const movementId = id();
const operationId = id();
const itemId = id();
const omittedItemId = id();
const unknownItemId = id();
const substitutedItemId = id();
const claimId = id();
const sourceHash = 'a'.repeat(64);
const requestHash = 'b'.repeat(64);
let fixtureOwned = false;

const roleUrl = new URL(databaseUrl);
roleUrl.username = testRole;
roleUrl.password = testPassword;
const roleClient = () => new Client({ connectionString: roleUrl.toString() });
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const expectReject = async (promise, label, expectedCodes) => {
  try {
    await promise;
    throw new Error(`${label}: expected rejection`);
  } catch (error) {
    if (error instanceof Error && error.message === `${label}: expected rejection`) throw error;
    if (!expectedCodes.includes(error?.code)) {
      throw new Error(`${label}: unexpected error code ${error?.code || 'unknown'}`);
    }
  }
};
const setContext = async (client, tenant = tenantId, user = userId) => {
  await client.query('select set_config($1, $2, false), set_config($3, $4, false)', [
    'app.tenant_id',
    tenant,
    'app.user_id',
    user,
  ]);
};
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const cleanupFixture = async () => {
  await admin.query('begin');
  try {
    // The fresh-database guard makes these tables fixture-owned. TRUNCATE is
    // intentional here: the migration's append-only triggers must remain
    // active during the assertions, while disposable cleanup must be repeatable.
    await admin.query(`
      truncate table
        public.real_consumption_movement_links,
        public.real_consumption_substitutions,
        public.real_consumption_items,
        public.meal_consumption_claims,
        public.real_consumption_operations`);
    for (const table of [
      'inventory_movements',
      'recipe_inventory_items',
      'cooking_sessions',
      'user_recipe_versions',
      'user_recipes',
      'user_meal_plans',
      'tenant_memberships',
    ]) {
      await admin.query(`delete from public.${table} where tenant_id=$1 and user_id=$2`, [
        tenantId,
        userId,
      ]);
    }
    await admin.query('delete from public.users where id=$1 and tenant_id=$2', [userId, tenantId]);
    await admin.query('delete from public.tenants where id=$1', [tenantId]);
    await admin.query('commit');
  } catch (error) {
    await admin.query('rollback').catch(() => undefined);
    throw error;
  }
};

await admin.connect();
try {
  const preexisting = await admin.query(`
    select coalesce(sum(row_count), 0)::int as total
    from (
      select count(*)::int as row_count from public.tenants
      union all select count(*)::int from public.real_consumption_operations
      union all select count(*)::int from public.meal_consumption_claims
      union all select count(*)::int from public.real_consumption_items
      union all select count(*)::int from public.real_consumption_substitutions
      union all select count(*)::int from public.real_consumption_movement_links
    ) counts`);
  if (preexisting.rows[0].total !== 0) {
    throw new Error('Refusing to run migration 019 tests: disposable database is not fresh.');
  }
  fixtureOwned = true;
  await admin
    .query(`revoke all privileges on schema public from ${testRole}`)
    .catch(() => undefined);
  await admin
    .query(`revoke all privileges on all tables in schema public from ${testRole}`)
    .catch(() => undefined);
  await admin.query(`drop role if exists ${testRole}`);
  await admin.query(
    `create role ${testRole} login password '${testPassword}' nosuperuser nobypassrls`
  );
  await admin.query(`grant usage on schema public to ${testRole}`);
  await admin.query(
    `grant select on public.user_meal_plans, public.user_recipes, public.user_recipe_versions, public.cooking_sessions, public.recipe_inventory_items, public.inventory_movements to ${testRole}`
  );
  await admin.query(
    `grant select, insert, update, delete on public.real_consumption_operations, public.meal_consumption_claims, public.real_consumption_items, public.real_consumption_substitutions, public.real_consumption_movement_links to ${testRole}`
  );
  await admin.query(`grant select, insert on public.inventory_movements to ${testRole}`);

  await admin.query('begin');
  await admin.query('insert into public.tenants (id, tenant_type, name) values ($1, $2, $3)', [
    tenantId,
    'home',
    'M5 U4 disposable tenant',
  ]);
  await admin.query(
    'insert into public.users (id, email, password_hash, tenant_id, role, email_confirmed) values ($1, $2, $3, $4, $5, true)',
    [userId, `${id()}@m5-u4-disposable.invalid`, 'not-a-login-secret', tenantId, 'owner']
  );
  await admin.query(
    'insert into public.tenant_memberships (tenant_id, user_id, role) values ($1, $2, $3)',
    [tenantId, userId, 'owner']
  );
  await admin.query(
    `insert into public.user_meal_plans
    (id, tenant_id, user_id, period, mode, base_cuisine, calendar_payload)
    values ($1, $2, $3, 'week', 'balanced_ai', 'test', $4::jsonb)`,
    [
      planId,
      tenantId,
      userId,
      JSON.stringify({
        period: 'week',
        dayCount: 7,
        days: [
          {
            dayIndex: 1,
            label: 'Test',
            meals: [{ mealType: 'dinner', title: 'Test meal', description: null, ingredients: [] }],
          },
        ],
      }),
    ]
  );
  await admin.query(
    'insert into public.user_recipes (id, tenant_id, user_id, category) values ($1, $2, $3, $4)',
    [recipeId, tenantId, userId, 'test']
  );
  await admin.query(
    `insert into public.user_recipe_versions
    (id, recipe_id, tenant_id, user_id, version_number, title, instructions, servings, ingredients)
    values ($1, $2, $3, $4, 1, 'Test recipe', 'Test instruction', 2, '[]'::jsonb)`,
    [versionId, recipeId, tenantId, userId]
  );
  await admin.query(
    `insert into public.cooking_sessions
    (id, tenant_id, user_id, meal_plan_id, day_index, meal_type, recipe_id, recipe_version_id,
     status, current_step, total_steps, instruction_snapshot, source_updated_at,
     source_calendar_payload_hash, version, completed_at, retention_until)
    values ($1, $2, $3, $4, 1, 'dinner', $5, $6, 'completed', 1, 1, '{}'::jsonb,
      now(), $7, 1, now(), now() + interval '365 days')`,
    [sessionId, tenantId, userId, planId, recipeId, versionId, sourceHash]
  );
  await admin.query(
    `insert into public.cooking_sessions
    (id, tenant_id, user_id, meal_plan_id, day_index, meal_type, recipe_id, recipe_version_id,
     status, current_step, total_steps, instruction_snapshot, source_updated_at,
     source_calendar_payload_hash, version, completed_at, retention_until)
    values ($1, $2, $3, $4, 2, 'lunch', $5, $6, 'completed', 1, 1, '{}'::jsonb,
      now(), $7, 1, now(), now() + interval '365 days')`,
    [rollbackSessionId, tenantId, userId, planId, recipeId, versionId, sourceHash]
  );
  await admin.query(
    `insert into public.recipe_inventory_items
    (id, tenant_id, user_id, ingredient_name, quantity, unit, normalized_name)
    values ($1, $2, $3, 'Tomato', '2', 'kg', 'tomato')`,
    [inventoryId, tenantId, userId]
  );
  await admin.query(
    `insert into public.recipe_inventory_items
    (id, tenant_id, user_id, ingredient_name, quantity, unit, normalized_name)
    values ($1, $2, $3, 'Paprika', '1', 'kg', 'paprika')`,
    [substituteInventoryId, tenantId, userId]
  );
  await admin.query(
    `insert into public.inventory_movements
    (id, tenant_id, user_id, inventory_item_id, movement_type, quantity, unit, normalized_name, source)
    values ($1, $2, $3, $4, 'recipe_consumption', 1, 'kg', 'tomato', 'real-consumption:${operationId}')`,
    [movementId, tenantId, userId, inventoryId]
  );
  await admin.query('commit');

  const client = roleClient();
  await client.connect();
  try {
    await setContext(client);
    const visible = await client.query(
      'select id from public.real_consumption_operations where id=$1',
      [operationId]
    );
    assert(
      visible.rowCount === 0,
      'empty operation table should be readable under matching context'
    );

    await client.query(
      `insert into public.real_consumption_operations
      (id, tenant_id, user_id, cooking_session_id, meal_plan_id, day_index, meal_type,
       recipe_id, recipe_version_id, idempotency_key, request_hash, source_snapshot_hash,
       status, confirmed_at)
      values ($1,$2,$3,$4,$5,1,'dinner',$6,$7,'same-key',$8,$9,'confirmed',now())`,
      [
        operationId,
        tenantId,
        userId,
        sessionId,
        planId,
        recipeId,
        versionId,
        requestHash,
        sourceHash,
      ]
    );
    await client.query(
      `insert into public.real_consumption_items
      (id, operation_id, tenant_id, user_id, original_ingredient, normalized_original_ingredient,
       outcome, effective_ingredient, normalized_effective_ingredient, quantity, unit, quantity_status, inventory_item_id)
      values ($1,$2,$3,$4,'Tomato','tomato','used','Tomato','tomato',1,'kg','known',$5)`,
      [itemId, operationId, tenantId, userId, inventoryId]
    );
    await client.query(
      `insert into public.real_consumption_items
      (id, operation_id, tenant_id, user_id, original_ingredient, normalized_original_ingredient,
       outcome, quantity_status)
      values ($1,$2,$3,$4,'Onion','onion','omitted','unknown')`,
      [omittedItemId, operationId, tenantId, userId]
    );
    await client.query(
      `insert into public.real_consumption_items
      (id, operation_id, tenant_id, user_id, original_ingredient, normalized_original_ingredient,
       outcome, quantity_status)
      values ($1,$2,$3,$4,'Salt','salt','unknown','unknown')`,
      [unknownItemId, operationId, tenantId, userId]
    );
    await client.query(
      `insert into public.real_consumption_items
      (id, operation_id, tenant_id, user_id, original_ingredient, normalized_original_ingredient,
       outcome, effective_ingredient, normalized_effective_ingredient, quantity, unit, quantity_status, inventory_item_id)
      values ($1,$2,$3,$4,'Pepper','pepper','substituted','Paprika','paprika',0.25,'kg','known',$5)`,
      [substitutedItemId, operationId, tenantId, userId, substituteInventoryId]
    );
    await client.query(
      `insert into public.real_consumption_substitutions
      (operation_id, item_id, tenant_id, user_id, original_ingredient, substitute_ingredient, substitute_inventory_item_id)
      values ($1,$2,$3,$4,'Pepper','Paprika',$5)`,
      [operationId, substitutedItemId, tenantId, userId, substituteInventoryId]
    );
    await client.query(
      `insert into public.real_consumption_movement_links
      (operation_id, item_id, movement_id, tenant_id, user_id)
      values ($1,$2,$3,$4,$5)`,
      [operationId, itemId, movementId, tenantId, userId]
    );
    await client.query(
      `insert into public.meal_consumption_claims
      (id, tenant_id, user_id, meal_plan_id, day_index, meal_type, mode, operation_id, operation_status)
      values ($1,$2,$3,$4,1,'dinner','real_reconciliation',$5,'confirmed')`,
      [claimId, tenantId, userId, planId, operationId]
    );

    const own = await client.query(
      'select count(*)::int as count from public.real_consumption_operations'
    );
    assert(own.rows[0].count === 1, 'matching tenant/user should see its operation');
    await setContext(client, id(), id());
    for (const table of [
      'real_consumption_operations',
      'meal_consumption_claims',
      'real_consumption_items',
      'real_consumption_substitutions',
      'real_consumption_movement_links',
    ]) {
      const foreign = await client.query(`select count(*)::int as count from public.${table}`);
      assert(foreign.rows[0].count === 0, `mismatched tenant/user must not see ${table}`);
    }
    await expectReject(
      client.query(
        `insert into public.real_consumption_items
        (operation_id,tenant_id,user_id,original_ingredient,normalized_original_ingredient,outcome,quantity_status)
        values ($1,$2,$3,'Foreign','foreign','unknown','unknown')`,
        [operationId, tenantId, userId]
      ),
      'mismatched tenant/user write',
      ['42501']
    );

    await setContext(client);
    await expectReject(
      client.query(
        `insert into public.real_consumption_operations
        (tenant_id,user_id,cooking_session_id,meal_plan_id,day_index,meal_type,recipe_id,recipe_version_id,idempotency_key,request_hash,source_snapshot_hash,status,confirmed_at)
        values ($1,$2,$3,$4,1,'dinner',$5,$6,'same-key','${'c'.repeat(64)}',$7,'confirmed',now())`,
        [tenantId, userId, sessionId, planId, recipeId, versionId, sourceHash]
      ),
      'contradictory idempotency key',
      ['23505']
    );
    await expectReject(
      client.query(
        `insert into public.meal_consumption_claims
        (tenant_id,user_id,meal_plan_id,day_index,meal_type,mode)
        values ($1,$2,$3,1,'dinner','planned_legacy')`,
        [tenantId, userId, planId]
      ),
      'duplicate slot claim',
      ['23505']
    );
    await expectReject(
      client.query(
        `insert into public.meal_consumption_claims
        (tenant_id,user_id,meal_plan_id,day_index,meal_type,mode,operation_id,operation_status)
        values ($1,$2,$3,2,'lunch','real_reconciliation',$4,'confirmed')`,
        [tenantId, userId, planId, operationId]
      ),
      'operation attached to a second claim',
      ['23505']
    );
    await expectReject(
      client.query('update public.real_consumption_operations set status=$1 where id=$2', [
        'rejected',
        operationId,
      ]),
      'append-only update',
      ['P0001']
    );
    await expectReject(
      client.query('update public.meal_consumption_claims set mode=$1 where id=$2', [
        'planned_legacy',
        claimId,
      ]),
      'append-only claim update',
      ['P0001']
    );
    await expectReject(
      client.query(
        `insert into public.real_consumption_items
        (operation_id,tenant_id,user_id,original_ingredient,normalized_original_ingredient,outcome,quantity_status)
        values ($1,$2,$3,'Unknown','unknown','unknown','known')`,
        [operationId, tenantId, userId]
      ),
      'unknown quantity constraint',
      ['23514']
    );
  } finally {
    await client.end();
  }

  const first = roleClient();
  const second = roleClient();
  await Promise.all([first.connect(), second.connect()]);
  try {
    await setContext(first);
    await setContext(second);
    await first.query('begin');
    await first.query(
      `insert into public.meal_consumption_claims
      (tenant_id,user_id,meal_plan_id,day_index,meal_type,mode)
      values ($1,$2,$3,2,'breakfast','planned_legacy')`,
      [tenantId, userId, planId]
    );
    await second.query('begin');
    const secondInsert = second.query(
      `insert into public.meal_consumption_claims
      (tenant_id,user_id,meal_plan_id,day_index,meal_type,mode)
      values ($1,$2,$3,2,'breakfast','planned_legacy')`,
      [tenantId, userId, planId]
    );
    await first.query('commit');
    await expectReject(secondInsert, 'concurrent slot claim', ['23505']);
    await second.query('rollback');
  } finally {
    await first.end();
    await second.end();
  }

  const before = await admin.query(
    'select count(*)::int as count from public.inventory_movements where tenant_id=$1',
    [tenantId]
  );
  await admin.query('begin');
  try {
    await admin.query(
      `insert into public.real_consumption_operations
      (tenant_id,user_id,cooking_session_id,meal_plan_id,day_index,meal_type,recipe_id,recipe_version_id,idempotency_key,request_hash,source_snapshot_hash,status,confirmed_at)
      values ($1,$2,$3,$4,2,'lunch',$5,$6,'rollback-key','${hash('rollback')}' ,'${'d'.repeat(64)}','confirmed',now())`,
      [tenantId, userId, rollbackSessionId, planId, recipeId, versionId]
    );
    await admin.query('rollback');
  } catch (error) {
    await admin.query('rollback');
    throw error;
  }
  const after = await admin.query(
    'select count(*)::int as count from public.inventory_movements where tenant_id=$1',
    [tenantId]
  );
  assert(
    before.rows[0].count === after.rows[0].count,
    'schema-only operation must not write inventory movements'
  );

  console.log('M5 U4 migration 019 disposable schema tests: PASS');
  console.log(
    'RLS, tenant-safe FKs, idempotency uniqueness, claim concurrency, append-only trigger, quantity checks, rollback, and no implicit inventory writes verified.'
  );
} finally {
  await admin.query('rollback').catch(() => undefined);
  if (fixtureOwned) {
    await cleanupFixture().catch((error) => {
      console.error(`Disposable fixture cleanup failed: ${error.message}`);
    });
  }
  await admin
    .query(`revoke all privileges on schema public from ${testRole}`)
    .catch(() => undefined);
  await admin
    .query(`revoke all privileges on all tables in schema public from ${testRole}`)
    .catch(() => undefined);
  await admin.query('drop role if exists m5_u4_rls_test');
  await admin.end();
}
