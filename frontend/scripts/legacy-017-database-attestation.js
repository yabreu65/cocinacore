'use strict';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- Keep this Node provisioner module in CommonJS.
const crypto = require('crypto');
const {
  assertSignature: assertLegacy017Signature,
  CONSTRAINT_NAMES: LEGACY_017_CONSTRAINT_NAMES,
  FUNCTION_NAMES: LEGACY_017_FUNCTION_NAMES,
  INDEX_NAMES: LEGACY_017_INDEX_NAMES,
  TRIGGER_NAMES: LEGACY_017_TRIGGER_NAMES,
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Reuse the reviewed CommonJS attestation contract.
} = require('./legacy-017-attestation');

async function attestLegacy017Structure(client) {
  const columns = await client.query(
    `select c.relname || '.' || a.attname as identity,
            pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type,
            a.attnotnull,
            coalesce(pg_catalog.pg_get_expr(d.adbin, d.adrelid), '') as default_expression
       from pg_catalog.pg_attribute a
       join pg_catalog.pg_class c on c.oid = a.attrelid
       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       left join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where n.nspname = 'public'
        and c.relkind in ('r','p')
        and c.relname || '.' || a.attname = any($1::text[])
        and a.attnum > 0 and not a.attisdropped
      order by identity`,
    [
      [
        'shopping_list_items.transfer_inventory_item_id',
        'shopping_list_items.transferred_at',
        'user_culinary_profiles.allergies',
        'user_culinary_profiles.available_time_minutes',
        'user_culinary_profiles.disliked_ingredients',
        'user_culinary_profiles.household_members',
        'user_meal_plans.consumption_payload',
        'user_recipes.archived_at',
      ],
    ]
  );
  const constraints = await client.query(
    `select c.relname || '.' || x.conname as identity,
            x.contype::text as type,
            x.convalidated as validated,
            pg_catalog.pg_get_constraintdef(x.oid) as definition
       from pg_catalog.pg_constraint x
       join pg_catalog.pg_class c on c.oid = x.conrelid
       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and x.conname = any($1::text[])
      order by identity`,
    [LEGACY_017_CONSTRAINT_NAMES]
  );
  const indexes = await client.query(
    `select i.relname as identity,
            x.indisvalid as valid,
            x.indisready as ready,
            pg_catalog.pg_get_indexdef(x.indexrelid) as definition
       from pg_catalog.pg_index x
       join pg_catalog.pg_class i on i.oid = x.indexrelid
       join pg_catalog.pg_class t on t.oid = x.indrelid
       join pg_catalog.pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public' and i.relname = any($1::text[])
      order by identity`,
    [LEGACY_017_INDEX_NAMES]
  );
  const policies = await client.query(`
    select c.relname || '.' || p.polname as identity,
           p.polcmd::text as command,
           p.polpermissive as permissive,
           p.polroles::text as roles,
           coalesce(pg_catalog.pg_get_expr(p.polqual, p.polrelid), '') as using_expression,
           coalesce(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid), '') as check_expression,
           c.relrowsecurity as rls_enabled,
           c.relforcerowsecurity as rls_forced
      from pg_catalog.pg_policy p
      join pg_catalog.pg_class c on c.oid = p.polrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname in ('user_recipes','user_recipe_versions')
     order by identity
  `);
  const functions = await client.query(
    `select n.nspname || '.' || p.proname || '(' ||
             pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' as identity,
            pg_catalog.pg_get_functiondef(p.oid) as definition,
            p.prosecdef as security_definer
       from pg_catalog.pg_proc p
       join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = any($1::text[])
      order by identity`,
    [LEGACY_017_FUNCTION_NAMES]
  );
  const triggers = await client.query(
    `select t.tgname as identity,
            pg_catalog.pg_get_triggerdef(t.oid) as definition,
            t.tgenabled as enabled
       from pg_catalog.pg_trigger t
       join pg_catalog.pg_class c on c.oid = t.tgrelid
       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and not t.tgisinternal and t.tgname = any($1::text[])
      order by identity`,
    [LEGACY_017_TRIGGER_NAMES]
  );
  const data = await client.query(`
    select not exists (
             select 1 from public.users
              where email <> pg_catalog.lower(pg_catalog.btrim(email)) or email = ''
           ) as canonical_emails,
           not exists (
             select 1 from public.users
              group by email having count(*) > 1
           ) as unique_emails,
           not exists (
             select 1
               from public.user_culinary_profile_terms as profile_terms
               join public.culinary_terms as terms on terms.id = profile_terms.term_id
               join public.culinary_dimensions as dimensions on dimensions.id = terms.dimension_id
              where dimensions.key in ('cuisine','dietary','technique','ingredient_type','goal')
              group by profile_terms.user_id, dimensions.key
             having count(*) > case dimensions.key
                      when 'cuisine' then 6 when 'dietary' then 12
                      when 'technique' then 8 when 'ingredient_type' then 8 when 'goal' then 6
                    end
           ) as culinary_term_groups_within_limits
  `);

  const actual = {
    columns: columns.rows.map((row) => [
      row.identity,
      row.data_type,
      row.attnotnull,
      row.default_expression,
    ]),
    constraints: constraints.rows.map((row) => [
      row.identity,
      row.type,
      row.validated,
      row.definition,
    ]),
    indexes: indexes.rows.map((row) => [row.identity, row.valid, row.ready, row.definition]),
    policies: policies.rows.map((row) => [
      row.identity,
      row.command,
      row.permissive,
      row.roles,
      row.using_expression,
      row.check_expression,
      row.rls_enabled,
      row.rls_forced,
    ]),
    functions: functions.rows.map((row) => [
      row.identity,
      crypto.createHash('sha256').update(row.definition).digest('hex'),
      row.security_definer,
    ]),
    triggers: triggers.rows.map((row) => [row.identity, row.definition, row.enabled]),
    dataConditions: {
      canonicalEmails: data.rows[0]?.canonical_emails,
      uniqueEmails: data.rows[0]?.unique_emails,
      culinaryTermGroupsWithinLimits: data.rows[0]?.culinary_term_groups_within_limits,
    },
  };
  assertLegacy017Signature(actual);
}

module.exports = { attestLegacy017Structure };
