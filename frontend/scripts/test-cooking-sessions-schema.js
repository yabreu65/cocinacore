#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const crypto = require('crypto');
const { Client } = require('pg');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required.');

const roleName = `m5_u3_app_${process.pid}`;
const rolePassword = crypto.randomBytes(24).toString('hex');
const ids = {
  tenant: crypto.randomUUID(),
  user: crypto.randomUUID(),
  recipe: crypto.randomUUID(),
  version: crypto.randomUUID(),
  plan: crypto.randomUUID(),
  session: crypto.randomUUID(),
  secondSession: crypto.randomUUID(),
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function expectDatabaseError(action, code, message) {
  try {
    await action();
  } catch (error) {
    assert(error.code === code, `${message}: expected ${code}, got ${error.code}`);
    return;
  }
  throw new Error(`${message}: expected database error ${code}`);
}

async function main() {
  const admin = new Client({ connectionString: databaseUrl });
  const app = new Client({ connectionString: databaseUrl });
  let fixture;
  try {
    await admin.connect();
    await admin.query(
      `insert into public.tenants (id, tenant_type, name) values ($1, 'home', 'M5 U3 schema fixture')`,
      [ids.tenant]
    );
    await admin.query(
      `insert into public.users
        (id, email, password_hash, email_confirmed, full_name, tenant_id, role, terms_accepted_at, terms_version, onboarding_completed)
       values ($1, $2, 'fixture-password-hash', true, 'M5 U3 schema fixture', $3, 'owner', now(), 'v1', true)`,
      [ids.user, `m5-u3-${process.pid}@cocinacore.local`, ids.tenant]
    );
    await admin.query(
      `insert into public.tenant_memberships (tenant_id, user_id, role) values ($1, $2, 'owner')`,
      [ids.tenant, ids.user]
    );
    fixture = { userId: ids.user, tenantId: ids.tenant };

    await admin.query(`create role ${roleName} login password '${rolePassword}'`);
    await admin.query(`grant usage on schema public to ${roleName}`);
    await admin.query(
      `grant select on public.user_meal_plans, public.user_recipes, public.user_recipe_versions to ${roleName}`
    );
    await admin.query(`grant select, insert, update on public.cooking_sessions to ${roleName}`);
    await admin.query(`grant select, insert on public.cooking_session_events to ${roleName}`);

    await admin.query(
      `insert into public.user_recipes (id, tenant_id, user_id, category)
       values ($1, $2, $3, 'm5-u3-schema-test')`,
      [ids.recipe, fixture.tenantId, fixture.userId]
    );
    await admin.query(
      `insert into public.user_recipe_versions
        (id, recipe_id, tenant_id, user_id, version_number, title, instructions, servings, ingredients)
       values ($1, $2, $3, $4, 1, 'Schema test recipe', 'One guided step', 2, $5::jsonb)`,
      [
        ids.version,
        ids.recipe,
        fixture.tenantId,
        fixture.userId,
        JSON.stringify([{ name: 'Rice', quantity: 1, unit: 'cup' }]),
      ]
    );
    await admin.query(
      `insert into public.user_meal_plans
        (id, tenant_id, user_id, people_count, period, mode, base_cuisine, calendar_payload)
       values ($1, $2, $3, 2, 'week', 'menu_to_shopping', 'test', $4::jsonb)`,
      [
        ids.plan,
        fixture.tenantId,
        fixture.userId,
        JSON.stringify({
          period: 'week',
          dayCount: 7,
          days: [],
          schedule: {
            confirmedAt: new Date().toISOString(),
            portionConfirmation: { peopleCount: 2 },
          },
        }),
      ]
    );

    const beforeMovements = await admin.query(
      'select count(*)::int as count from public.inventory_movements'
    );
    const beforeConsumption = await admin.query(
      'select consumption_payload from public.user_meal_plans where id = $1',
      [ids.plan]
    );

    await app.connect();
    await app.query(`set role ${roleName}`);
    await app.query('select set_config($1, $2, false)', ['app.tenant_id', fixture.tenantId]);
    await app.query('select set_config($1, $2, false)', ['app.user_id', fixture.userId]);

    await app.query(
      `insert into public.cooking_sessions
        (id, tenant_id, user_id, meal_plan_id, day_index, meal_type, recipe_id, recipe_version_id,
         total_steps, instruction_snapshot, source_updated_at, source_calendar_payload_hash)
       values ($1, $2, $3, $4, 1, 'lunch', $5, $6, 1, $7::jsonb, now(), $8)`,
      [
        ids.session,
        fixture.tenantId,
        fixture.userId,
        ids.plan,
        ids.recipe,
        ids.version,
        JSON.stringify({ steps: [{ index: 1, title: 'Cook', instruction: 'One step' }] }),
        crypto.createHash('sha256').update('snapshot').digest('hex'),
      ]
    );
    const own = await app.query(
      'select count(*)::int as count from public.cooking_sessions where id = $1',
      [ids.session]
    );
    assert(own.rows[0].count === 1, 'Own session was not readable.');

    await app.query(
      `insert into public.cooking_session_events
        (session_id, tenant_id, user_id, operation_type, previous_step, next_step,
         previous_status, next_status, idempotency_key, payload_hash)
       values ($1, $2, $3, 'start', 1, 1, 'active', 'active', $4, $5)`,
      [
        ids.session,
        fixture.tenantId,
        fixture.userId,
        'start-1',
        crypto.createHash('sha256').update('start-1').digest('hex'),
      ]
    );
    await expectDatabaseError(
      () =>
        app.query(
          `insert into public.cooking_session_events
          (session_id, tenant_id, user_id, operation_type, previous_step, next_step,
           previous_status, next_status, idempotency_key, payload_hash)
         values ($1, $2, $3, 'advance', 1, 1, 'active', 'active', $4, $5)`,
          [
            ids.session,
            fixture.tenantId,
            fixture.userId,
            'start-1',
            crypto.createHash('sha256').update('different').digest('hex'),
          ]
        ),
      '23505',
      'Contradictory idempotency key was accepted'
    );

    await expectDatabaseError(
      () =>
        app.query(
          `insert into public.cooking_sessions
          (id, tenant_id, user_id, meal_plan_id, day_index, meal_type, recipe_id, recipe_version_id,
           total_steps, instruction_snapshot, source_updated_at, source_calendar_payload_hash)
         values ($1, $2, $3, $4, 1, 'lunch', $5, $6, 1, '{}'::jsonb, now(), $7)`,
          [
            ids.secondSession,
            fixture.tenantId,
            fixture.userId,
            ids.plan,
            ids.recipe,
            ids.version,
            crypto.createHash('sha256').update('second').digest('hex'),
          ]
        ),
      '23505',
      'Duplicate open slot was accepted'
    );

    await app.query('select set_config($1, $2, false)', ['app.tenant_id', crypto.randomUUID()]);
    const foreign = await app.query('select count(*)::int as count from public.cooking_sessions');
    assert(foreign.rows[0].count === 0, 'Foreign tenant could read sessions.');
    const foreignUpdate = await app.query(
      `update public.cooking_sessions set status = 'paused' where id = $1`,
      [ids.session]
    );
    assert(foreignUpdate.rowCount === 0, 'Foreign tenant could update a session.');

    await app.query('reset role');
    await expectDatabaseError(
      () =>
        admin.query(
          `insert into public.cooking_sessions
          (tenant_id, user_id, meal_plan_id, day_index, meal_type, recipe_id, recipe_version_id,
           total_steps, instruction_snapshot, source_updated_at, source_calendar_payload_hash)
         values ($1, $2, $3, 2, 'dinner', $4, $5, 1, '{}'::jsonb, now(), $6)`,
          [
            fixture.tenantId,
            fixture.userId,
            ids.plan,
            crypto.randomUUID(),
            ids.version,
            crypto.createHash('sha256').update('invalid').digest('hex'),
          ]
        ),
      '23503',
      'Invalid recipe reference was accepted'
    );
    const afterMovements = await admin.query(
      'select count(*)::int as count from public.inventory_movements'
    );
    const afterConsumption = await admin.query(
      'select consumption_payload from public.user_meal_plans where id = $1',
      [ids.plan]
    );
    assert(
      afterMovements.rows[0].count === beforeMovements.rows[0].count,
      'Inventory movements changed.'
    );
    assert(
      JSON.stringify(afterConsumption.rows[0].consumption_payload) ===
        JSON.stringify(beforeConsumption.rows[0].consumption_payload),
      'Consumption payload changed.'
    );

    console.log('PASS session ownership and creation');
    console.log('PASS idempotency uniqueness and contradictory retry rejection');
    console.log('PASS active-slot uniqueness');
    console.log('PASS RLS foreign-tenant read/update rejection');
    console.log('PASS invalid foreign-key rejection');
    console.log('PASS inventory and consumption unchanged');
  } finally {
    if (app._connected) {
      await app.query('reset role').catch(() => undefined);
      await app.end();
    }
    if (fixture) {
      await admin
        .query('delete from public.cooking_session_events where session_id = $1', [ids.session])
        .catch(() => undefined);
      await admin
        .query('delete from public.cooking_sessions where id in ($1, $2)', [
          ids.session,
          ids.secondSession,
        ])
        .catch(() => undefined);
      await admin
        .query('delete from public.user_meal_plans where id = $1', [ids.plan])
        .catch(() => undefined);
      await admin
        .query('delete from public.user_recipe_versions where id = $1', [ids.version])
        .catch(() => undefined);
      await admin
        .query('delete from public.user_recipes where id = $1', [ids.recipe])
        .catch(() => undefined);
      await admin
        .query('delete from public.users where id = $1', [ids.user])
        .catch(() => undefined);
      await admin
        .query('delete from public.tenants where id = $1', [ids.tenant])
        .catch(() => undefined);
    }
    await admin.query(`drop role if exists ${roleName}`).catch(() => undefined);
    await admin.end();
  }
}

main().catch((error) => {
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
