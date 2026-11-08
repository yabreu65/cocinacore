'use strict';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- Keep this test's Node harness in CommonJS.
const assert = require('node:assert/strict');
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Keep this test's Node harness in CommonJS.
const test = require('node:test');
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Load the trusted migration fixture.
const migrationManifest = require('../../db/migrations/manifest.json');
const {
  assertPublicSchemaAcl,
  assertReservedRoleOwnership,
  attestLedger,
  attestBaselineCatalog,
  expectedCatalog,
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Load the provisioner's CommonJS exports directly.
} = require('./provision-database');
const {
  LEGACY_UNVERIFIABLE,
  MANIFEST_BACKFILL,
  MIGRATION_FILE,
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Load the migration ledger contract directly.
} = require('./migration-ledger-contract');

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

function ledgerClient(columns, invariants, rows) {
  const results = [{ rows: columns }, { rows: [invariants] }, { rows }];
  return {
    query: async () => results.shift(),
  };
}

function checksummedLedgerRows(count) {
  return migrationManifest.migrations.slice(0, count).map((migration, index) => ({
    filename: migration.filename,
    applied_at: new Date(Date.UTC(2026, 0, index + 1)),
    checksum: migration.sha256,
  }));
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

test('attests established checksummed and provenance ledger modes without conflating them', async () => {
  const sharedColumns = [
    { attname: 'filename', data_type: 'text', attnotnull: true },
    {
      attname: 'applied_at',
      data_type: 'timestamp with time zone',
      attnotnull: true,
      default_expression: 'now()',
    },
  ];
  const commonInvariants = {
    relrowsecurity: true,
    primary_keys: 1,
    public_grants: 0,
    checksum_source_constraints: 0,
    checksum_source_definition: null,
  };
  const checksummed = await attestLedger(
    ledgerClient(
      [...sharedColumns, { attname: 'checksum', data_type: 'text', attnotnull: true }],
      commonInvariants,
      checksummedLedgerRows(19)
    ),
    migrationManifest,
    true
  );
  assert.equal(checksummed.ledgerMode, 'checksummed');
  assert.equal(checksummed.appliedMigrations.size, 19);

  const provenanceColumns = [
    ...sharedColumns,
    { attname: 'checksum', data_type: 'text', attnotnull: false },
    { attname: 'checksum_source', data_type: 'text', attnotnull: true },
  ];
  const provenanceRows = migrationManifest.migrations.slice(0, 19).map((migration, index) => {
    const isUnverifiable = index >= 10 && index < 17;
    return {
      filename: migration.filename,
      applied_at: new Date(Date.UTC(2026, 0, index + 1)),
      checksum: isUnverifiable ? null : migration.sha256,
      checksum_source: isUnverifiable
        ? LEGACY_UNVERIFIABLE
        : index < 10
          ? MANIFEST_BACKFILL
          : MIGRATION_FILE,
    };
  });
  const provenance = await attestLedger(
    ledgerClient(
      provenanceColumns,
      {
        ...commonInvariants,
        checksum_source_constraints: 1,
        checksum_source_definition:
          "CHECK ((((checksum_source = 'legacy_unverifiable'::text) AND (checksum IS NULL)) OR ((checksum_source = ANY (ARRAY['manifest_backfill'::text, 'migration_file'::text])) AND (checksum IS NOT NULL))))",
      },
      provenanceRows
    ),
    migrationManifest,
    true
  );
  assert.equal(provenance.ledgerMode, 'provenance');
  assert.equal(provenance.appliedMigrations.size, 19);
});

test('rejects an altered provenance constraint and refuses legacy shape as established', async () => {
  const columns = [
    { attname: 'filename', data_type: 'text', attnotnull: true },
    {
      attname: 'applied_at',
      data_type: 'timestamp with time zone',
      attnotnull: true,
      default_expression: 'now()',
    },
    { attname: 'checksum', data_type: 'text', attnotnull: false },
    { attname: 'checksum_source', data_type: 'text', attnotnull: true },
  ];
  const invariants = {
    relrowsecurity: true,
    primary_keys: 1,
    public_grants: 0,
    checksum_source_constraints: 1,
    checksum_source_definition: 'CHECK (true)',
  };
  await assert.rejects(
    attestLedger(ledgerClient(columns, invariants, []), migrationManifest, true),
    /BASELINE_MISMATCH: migration ledger security\/primary-key contract is invalid/
  );
  await assert.rejects(
    attestLedger(
      ledgerClient(columns.slice(0, 2), { ...invariants, checksum_source_constraints: 0 }, []),
      migrationManifest,
      true
    ),
    /Legacy ledger columns mismatch/
  );
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

test('checks PUBLIC schema ACL through the pseudo-role ACL entry', async () => {
  let statement;
  await assertPublicSchemaAcl({
    async query(text) {
      statement = text;
      return { rows: [{ public_usage: true, public_create: false }] };
    },
  });
  assert.match(statement, /a\.grantee\s*=\s*0/);
  assert.match(statement, /pg_catalog\.aclexplode/);
  assert.doesNotMatch(statement, /has_schema_privilege/);

  await assert.rejects(
    assertPublicSchemaAcl({
      async query() {
        return { rows: [{ public_usage: true, public_create: true }] };
      },
    }),
    /public schema ACL does not match/
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
