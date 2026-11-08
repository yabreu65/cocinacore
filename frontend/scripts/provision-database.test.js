'use strict';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- Keep this test's Node harness in CommonJS.
const assert = require('node:assert/strict');
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Keep this test's Node harness in CommonJS.
const test = require('node:test');
const {
  assertReservedRoleOwnership,
  attestBaselineCatalog,
  attestLegacy017Structure,
  expectedCatalog,
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Load the provisioner's CommonJS exports directly.
} = require('./provision-database');

const appliedFilename = '014_culinary_profile_field_constraints.sql';
const addition = {
  kind: 'function',
  schema: 'public',
  identity: 'public.is_valid_culinary_profile_text_list',
};
const additionIdentity = 'public.is_valid_culinary_profile_text_list()';
const emptyCatalog = () => ({
  schemas: { rows: [] },
  tables: { rows: [] },
  otherRelations: { rows: [] },
  functions: { rows: [] },
  indexes: { rows: [] },
  constraints: { rows: [] },
  types: { rows: [] },
  triggers: { rows: [] },
  extensions: { rows: [] },
});

function fixture({
  functions = [],
  migrations = [{ filename: appliedFilename, catalogAdditions: [addition] }],
  transferable = [],
} = {}) {
  const catalog = { ...emptyCatalog(), functions: { rows: functions } };
  let queryIndex = 0;
  const client = {
    async query() {
      const key = [
        'schemas',
        'tables',
        'otherRelations',
        'functions',
        'indexes',
        'constraints',
        'types',
        'triggers',
        'extensions',
      ][queryIndex++];
      return catalog[key];
    },
  };
  const manifest = {
    migrations,
    baselineObjects: {
      transferable,
      dependent: { indexes: [], constraints: [], types: [] },
    },
    extensions: [],
  };
  return { client, manifest };
}

function historicalFunction(owner = 'cocinacore') {
  return {
    kind: 'function',
    schema: 'public',
    name: 'historical_baseline_function',
    arguments: '',
    expectedLegacyOwner: 'cocinacore',
    targetOwner: 'cocinacore_schema_owner',
    row: {
      identity: 'public.historical_baseline_function()',
      owner,
      security_definer: false,
    },
  };
}

async function attest(options = {}, ownerState = 'legacy', applied = [appliedFilename]) {
  const { client, manifest } = fixture(options);
  return attestBaselineCatalog(client, manifest, ownerState, new Set(applied));
}

function isControlledBaselineMismatch(error) {
  return (
    error instanceof Error &&
    !(error instanceof TypeError) &&
    /BASELINE_MISMATCH/.test(error.message)
  );
}

test('admits an applied 014-declared function for both legacy and target ownership', async () => {
  for (const ownerState of ['legacy', 'target']) {
    const owner = ownerState === 'legacy' ? 'cocinacore' : 'cocinacore_schema_owner';
    await assert.doesNotReject(
      attest(
        { functions: [{ identity: additionIdentity, owner, security_definer: false }] },
        ownerState
      )
    );
  }
});

test('rejects an applied declared function with the wrong owner', async () => {
  await assert.rejects(
    attest({
      functions: [
        { identity: additionIdentity, owner: 'unexpected_owner', security_definer: false },
      ],
    }),
    /BASELINE_MISMATCH: applied function owner differs/
  );
});

test('rejects same-name overloads as ambiguous applied-function identity', async () => {
  await assert.rejects(
    attest({
      functions: [
        { identity: additionIdentity, owner: 'cocinacore', security_definer: false },
        {
          identity: 'public.is_valid_culinary_profile_text_list(integer)',
          owner: 'cocinacore',
          security_definer: false,
        },
      ],
    }),
    /BASELINE_MISMATCH/
  );
});

test('rejects a changed owner on a historical baseline function', async () => {
  const baseline = historicalFunction('unexpected_owner');
  const { row, ...declaration } = baseline;
  const options = { transferable: [declaration], functions: [row] };
  await assert.rejects(
    attest(options, 'legacy', []),
    /BASELINE_MISMATCH: unexpected owner for function/
  );
});

test('rejects a physical function from an unapplied migration as unexpected catalog state', async () => {
  await assert.rejects(
    attest(
      {
        migrations: [{ filename: appliedFilename, catalogAdditions: [addition] }],
        functions: [{ identity: additionIdentity, owner: 'cocinacore', security_definer: false }],
      },
      'legacy',
      []
    ),
    isControlledBaselineMismatch
  );
});

test('does not admit an undeclared function', async () => {
  await assert.rejects(
    attest({
      functions: [
        { identity: 'public.untrusted_function()', owner: 'cocinacore', security_definer: false },
      ],
    }),
    isControlledBaselineMismatch
  );
});

test('rejects unknown catalog objects with a controlled contract error', async () => {
  await assert.rejects(
    attest({
      functions: [
        { identity: additionIdentity, owner: 'cocinacore', security_definer: false },
        { identity: 'public.unexpected_function()', owner: 'cocinacore', security_definer: false },
      ],
    }),
    isControlledBaselineMismatch
  );
});

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

test('preserves custom pg-prefixed schemas in the role ownership and ACL audits', async () => {
  const statements = [];
  const client = {
    async query(text) {
      statements.push(text);
      if (statements.length === 2) return { rows: [{ count: 0 }] };
      return { rows: [], rowCount: 0 };
    },
  };

  await assertReservedRoleOwnership(
    client,
    { baselineObjects: { transferable: [] }, migrations: [] },
    new Set()
  );

  assert.equal(statements.length, 3);
  for (const statement of statements.slice(0, 2)) {
    assert.ok(statement.includes("n.nspname not like 'pg!_%' escape '!'"));
  }
});

test('qualifies relation-bound migration additions exactly once', () => {
  const migration = {
    filename: '018_test.sql',
    catalogAdditions: [
      { kind: 'index', schema: 'public', identity: 'cooking_sessions.idx_sessions' },
      { kind: 'constraint', schema: 'public', identity: 'cooking_sessions.sessions_owner' },
      { kind: 'trigger', schema: 'public', identity: 'cooking_sessions.sessions_guard' },
    ],
  };
  const actual = expectedCatalog(
    {
      baselineObjects: {
        transferable: [],
        dependent: { indexes: [], constraints: [], types: [] },
      },
      extensions: [],
      migrations: [migration],
    },
    new Set([migration.filename]),
    []
  );

  assert.deepEqual(actual.indexes, ['public.cooking_sessions.idx_sessions']);
  assert.deepEqual(actual.constraints, ['public.cooking_sessions.sessions_owner']);
  assert.deepEqual(actual.triggers, ['public.cooking_sessions.sessions_guard']);
  assert.throws(
    () =>
      expectedCatalog(
        {
          baselineObjects: {
            transferable: [],
            dependent: { indexes: [], constraints: [], types: [] },
          },
          extensions: [],
          migrations: [
            {
              ...migration,
              catalogAdditions: [
                {
                  kind: 'index',
                  schema: 'public',
                  identity: 'public.cooking_sessions.idx_sessions',
                },
              ],
            },
          ],
        },
        new Set([migration.filename]),
        []
      ),
    /BASELINE_MISMATCH: invalid index identity/
  );
});
