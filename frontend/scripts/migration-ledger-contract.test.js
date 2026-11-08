'use strict';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS test harness.
const assert = require('node:assert/strict');
// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS test harness.
const test = require('node:test');
// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS migration script.
const manifest = require('../../db/migrations/manifest.json');
const {
  classifyLegacyLedger,
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
