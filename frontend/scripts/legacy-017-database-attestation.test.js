'use strict';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- Keep this test's Node harness in CommonJS.
const assert = require('node:assert/strict');
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Keep this test's Node harness in CommonJS.
const test = require('node:test');
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Load the database attestation directly.
const { attestLegacy017Structure } = require('./legacy-017-database-attestation');

test('attests the fixed legacy-017 signature using only catalog and read-only data queries', async () => {
  const queries = [];
  const client = {
    async query(text, values) {
      queries.push({ text, values });
      return { rows: [] };
    },
  };

  await assert.rejects(
    attestLegacy017Structure(client),
    /BASELINE_MISMATCH: production-017 columns signature differs/
  );
  assert.equal(queries.length, 7);
  assert.match(queries[0].text, /pg_catalog\.pg_attribute/);
  assert.deepEqual(queries[0].values[0], [
    'shopping_list_items.transfer_inventory_item_id',
    'shopping_list_items.transferred_at',
    'user_culinary_profiles.allergies',
    'user_culinary_profiles.available_time_minutes',
    'user_culinary_profiles.disliked_ingredients',
    'user_culinary_profiles.household_members',
    'user_meal_plans.consumption_payload',
    'user_recipes.archived_at',
  ]);
  assert.match(queries[1].text, /pg_catalog\.pg_constraint/);
  assert.match(queries[2].text, /pg_catalog\.pg_index/);
  assert.match(queries[3].text, /pg_catalog\.pg_policy/);
  assert.match(queries[4].text, /pg_catalog\.pg_proc/);
  assert.match(queries[5].text, /pg_catalog\.pg_trigger/);
  assert.match(queries[6].text, /not exists/);
  assert.ok(
    queries.every(({ text }) => !/^\s*(insert|update|delete|alter|drop|create)\b/i.test(text))
  );
});

test('rejects drift in a legacy-017 catalog column before accepting the baseline', async () => {
  let queryIndex = 0;
  const client = {
    async query() {
      queryIndex += 1;
      return {
        rows: queryIndex === 1 ? [{ identity: 'user_recipes.unexpected_column' }] : [],
      };
    },
  };

  await assert.rejects(
    attestLegacy017Structure(client),
    /BASELINE_MISMATCH: production-017 columns signature differs/
  );
});
