'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { attestBaselineCatalog } = require('./provision-database');

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
  return error instanceof Error && !(error instanceof TypeError) && /BASELINE_MISMATCH/.test(error.message);
}

test('admits an applied 014-declared function for both legacy and target ownership', async () => {
  for (const ownerState of ['legacy', 'target']) {
    const owner = ownerState === 'legacy' ? 'cocinacore' : 'cocinacore_schema_owner';
    await assert.doesNotReject(
      attest({ functions: [{ identity: additionIdentity, owner, security_definer: false }] }, ownerState)
    );
  }
});

test('rejects an applied declared function with the wrong owner', async () => {
  await assert.rejects(
    attest({
      functions: [{ identity: additionIdentity, owner: 'unexpected_owner', security_definer: false }],
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
      functions: [{ identity: 'public.untrusted_function()', owner: 'cocinacore', security_definer: false }],
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
