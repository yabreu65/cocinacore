'use strict';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS test harness.
const assert = require('node:assert/strict');
// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS test harness.
const test = require('node:test');
// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS migration script.
const manifest = require('../../db/migrations/manifest.json');
const {
  classifyLegacyLedger,
  validateChecksummedLedger,
  validateEstablishedLedger,
  assertM5ExpectedPending,
  MANIFEST_BACKFILL,
  LEGACY_UNVERIFIABLE,
  MIGRATION_FILE,
} = require('./migration-ledger-contract'); // eslint-disable-line @typescript-eslint/no-require-imports -- CommonJS migration script.

function legacyRows(count) {
  return manifest.migrations.slice(0, count).map((migration, index) => ({
    filename: migration.filename,
    applied_at: new Date(Date.UTC(2024, 0, 1, 0, 0, index)),
  }));
}

function establishedRows(count, adopted017 = false) {
  return manifest.migrations.slice(0, count).map((migration, index) => {
    const isUnverifiable = adopted017 && index >= 10 && index < 17;
    const backfilled = adopted017 && index < 10;
    return {
      filename: migration.filename,
      applied_at: new Date(Date.UTC(2024, 0, 1, 0, 0, index)),
      checksum: isUnverifiable ? null : migration.sha256,
      checksum_source: isUnverifiable
        ? LEGACY_UNVERIFIABLE
        : backfilled
          ? MANIFEST_BACKFILL
          : MIGRATION_FILE,
    };
  });
}

function checksummedRows(count) {
  return manifest.migrations.slice(0, count).map((migration, index) => ({
    filename: migration.filename,
    applied_at: new Date(Date.UTC(2024, 0, 1, 0, 0, index)),
    checksum: migration.sha256,
  }));
}

test('classifies only the explicit legacy 001-010 and 001-017 histories', () => {
  assert.equal(classifyLegacyLedger(legacyRows(10), manifest.migrations), 'legacy-010');
  assert.equal(
    classifyLegacyLedger(legacyRows(17), manifest.migrations),
    'production-017-unverifiable'
  );
});

test('rejects a missing, reordered, duplicated, or unknown legacy migration row', () => {
  const cases = [
    legacyRows(16),
    [...legacyRows(17)].reverse(),
    [...legacyRows(16), legacyRows(16)[0]],
    [...legacyRows(16), { filename: '999_untrusted.sql', applied_at: new Date() }],
  ];
  for (const rows of cases) {
    assert.throws(() => classifyLegacyLedger(rows, manifest.migrations), /BASELINE_MISMATCH/);
  }
});

test('validates adopted 017 with explicit uncertainty instead of invented checksums', () => {
  const rows = establishedRows(17, true);
  const applied = validateEstablishedLedger(rows, manifest.migrations);
  assert.equal(applied.size, 17);
  assert.equal(
    rows.slice(10).every((row) => row.checksum === null),
    true
  );
  assert.equal(
    rows.slice(10).every((row) => row.checksum_source === LEGACY_UNVERIFIABLE),
    true
  );
});

test('validates established three-column checksummed ledger prefixes', () => {
  assert.equal(validateChecksummedLedger(checksummedRows(19), manifest.migrations).size, 19);
  const timestampDrift = checksummedRows(19);
  timestampDrift[10].applied_at = new Date(Date.UTC(2030, 0, 1));
  assert.equal(validateChecksummedLedger(timestampDrift, manifest.migrations).size, 19);

  const falseChecksum = checksummedRows(19);
  falseChecksum[18].checksum = '0'.repeat(64);
  const missing = [...checksummedRows(18).slice(0, 17), checksummedRows(19)[18]];
  const reordered = checksummedRows(19);
  [reordered[17], reordered[18]] = [reordered[18], reordered[17]];
  for (const rows of [falseChecksum, missing, reordered]) {
    assert.throws(() => validateChecksummedLedger(rows, manifest.migrations));
  }
});

test('rejects false historic checksums, fake provenance, reordered rows, and unknown records', () => {
  const falseChecksum = establishedRows(17, true);
  falseChecksum[10].checksum = '0'.repeat(64);

  const falseSource = establishedRows(17, true);
  falseSource[10].checksum_source = MANIFEST_BACKFILL;

  const reordered = establishedRows(17, true);
  [reordered[15], reordered[16]] = [reordered[16], reordered[15]];

  const unknown = [
    ...establishedRows(17, true),
    {
      filename: '999_untrusted.sql',
      applied_at: new Date(),
      checksum: '0'.repeat(64),
      checksum_source: MIGRATION_FILE,
    },
  ];

  for (const rows of [falseChecksum, falseSource, reordered, unknown]) {
    assert.throws(() => validateEstablishedLedger(rows, manifest.migrations));
  }
});

test('validates the exact 018 then 019 pending sequence only after baseline 017', () => {
  const migrations = manifest.migrations;
  const expected = new Set(['018_cooking_sessions.sql', '019_real_consumption_reconciliation.sql']);
  const applied = new Set(migrations.slice(0, 17).map((migration) => migration.filename));
  assert.doesNotThrow(() => assertM5ExpectedPending(migrations, applied, expected));
  assert.throws(() =>
    assertM5ExpectedPending(migrations, new Set([...applied].slice(0, 16)), expected)
  );
  assert.throws(() =>
    assertM5ExpectedPending(migrations, applied, new Set(['018_cooking_sessions.sql']))
  );
  assert.throws(() =>
    assertM5ExpectedPending(
      migrations,
      new Set([...applied, ...[migrations[17].filename]]),
      expected
    )
  );
  assert.throws(() =>
    assertM5ExpectedPending(migrations, new Set([...applied, '020_fake.sql']), expected)
  );
});

test('registers the additive first-platform-admin capability after the verified baseline', () => {
  const migration = manifest.migrations.find((entry) => entry.id === '024');
  assert.equal(migration?.filename, '024_first_platform_admin_bootstrap.sql');
  assert.equal(migration?.lane, 'migration');
  assert.equal(migration?.transactional, 'required');
  assert.equal(migration?.legacyChecksumBackfillAllowed, false);
  assert.deepEqual(
    migration?.catalogAdditions,
    [
      { kind: 'table', schema: 'public', identity: 'public.first_platform_admin_bootstrap_claim' },
      { kind: 'index', schema: 'public', identity: 'first_platform_admin_bootstrap_claim.first_platform_admin_bootstrap_claim_pkey' },
      { kind: 'constraint', schema: 'public', identity: 'first_platform_admin_bootstrap_claim.first_platform_admin_bootstrap_claim_pkey' },
      { kind: 'constraint', schema: 'public', identity: 'first_platform_admin_bootstrap_claim.first_platform_admin_bootstrap_claim_singleton_check' },
      { kind: 'constraint', schema: 'public', identity: 'first_platform_admin_bootstrap_claim.first_platform_admin_bootstrap_claim_email_check' },
      { kind: 'constraint', schema: 'public', identity: 'first_platform_admin_bootstrap_claim.first_platform_admin_bootstrap_claim_approval_reference_check' },
      { kind: 'function', schema: 'public', identity: 'public.provision_first_platform_administrator' },
    ],
  );
});

test('requires active 023 capabilities before applying or verifying migration 024', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Inspect the CommonJS migration runner source as a static contract.
  const runner = require('node:fs').readFileSync(require.resolve('./run-migrations.js'), 'utf8');
  assert.ok(runner.includes("const FIRST_ADMIN_MIGRATION = '024_first_platform_admin_bootstrap.sql'"));
  assert.ok(runner.includes('FIRST_ADMIN_MIGRATION, PRIVATE_PDF_MIGRATION].includes(migration.filename)'));
  assert.ok(runner.includes('migration.filename === FIRST_ADMIN_MIGRATION && post020Applied'));
  assert.ok(runner.includes("attestActivatedCapabilities(client, '023')"));
});


test('pins migration 025 bytes and its narrow transactional manifest contract', () => {
  const fs = require('node:fs'); // eslint-disable-line @typescript-eslint/no-require-imports
  const crypto = require('node:crypto'); // eslint-disable-line @typescript-eslint/no-require-imports
  const path = require('node:path'); // eslint-disable-line @typescript-eslint/no-require-imports
  const migration = manifest.migrations.at(-1);
  const bytes = fs.readFileSync(path.join(__dirname, '../../db/migrations/025_private_tenant_pdf_creation.sql'));
  assert.deepEqual(migration, {
    id: '025', filename: '025_private_tenant_pdf_creation.sql', lane: 'migration',
    sha256: '6e630b5f95c9327363aee4ca42ecabccc5fec52c8a73bacf3fe6d20d30a5c9e3',
    byteLength: 2500, transactional: 'required', legacyChecksumBackfillAllowed: false, catalogAdditions: [],
  });
  assert.equal(bytes.length, migration.byteLength);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), migration.sha256);
  const sql = bytes.toString();
  assert.equal((sql.match(/CREATE POLICY /g) || []).length, 2);
  assert.equal((sql.match(/GRANT INSERT /g) || []).length, 2);
  assert.match(sql, /INSERT \(tenant_id, title, author, description\)/);
  assert.match(sql, /INSERT \(tenant_id, tenant_book_id, storage_path, file_size_bytes, page_count, checksum_sha256,\s*uploaded_by, processing_status, processed_chunks_count\)/);
  assert.equal((sql.match(/FOR INSERT TO cocinacore_runtime_rls/g) || []).length, 2);
  assert.equal((sql.match(/EXISTS \(SELECT 1 FROM public\.runtime_identity_probe\)/g) || []).length, 2);
  assert.match(sql, /parent_book\.id = tenant_pdf_library\.tenant_book_id/);
  assert.match(sql, /parent_book\.tenant_id = tenant_pdf_library\.tenant_id/);
  assert.match(sql, /tenant_book_id IS NOT NULL/);
  assert.doesNotMatch(sql, /SECURITY DEFINER|CREATE ROLE|GRANT UPDATE/i);
});

test('routes 025 through the previous and current attestations', () => {
  const runner = require('node:fs').readFileSync(require.resolve('./run-migrations.js'), 'utf8'); // eslint-disable-line @typescript-eslint/no-require-imports
  assert.match(runner, /applied\.has\(PRIVATE_PDF_MIGRATION\) \? '025'/);
  assert.match(runner, /migration\.filename === PRIVATE_PDF_MIGRATION && post020Applied[\s\S]*?attestActivatedCapabilities\(client, '024'\)/);
  assert.match(runner, /attestActivatedCapabilities\(client, capabilityVersion\(new Set\(\[migration\.filename\]\)\)\)/);
  assert.match(runner, /attestActivatedCapabilities\(client, capabilityVersion\(applied\)\)/);
  assert.match(runner, /'024', '025'\]\.includes\(stopAfter\)/);
});
