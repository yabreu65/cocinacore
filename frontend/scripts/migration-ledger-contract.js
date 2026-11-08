'use strict';

const LEGACY_UNVERIFIABLE_FILENAMES = Object.freeze([
  '011_canonical_email_invariant.sql',
  '012_meal_plan_consumption.sql',
  '013_culinary_profile_context.sql',
  '014_culinary_profile_field_constraints.sql',
  '015_shopping_inventory_transfer.sql',
  '016_persistent_user_recipes.sql',
  '017_persistent_recipe_archive.sql',
]);

const MANIFEST_BACKFILL = 'manifest_backfill';
const LEGACY_UNVERIFIABLE = 'legacy_unverifiable';
const MIGRATION_FILE = 'migration_file';

function expectedLegacy017Prefix(migrations) {
  const prefix = migrations.slice(0, 17);
  if (
    prefix.length !== 17 ||
    prefix[16]?.filename !== '017_persistent_recipe_archive.sql' ||
    prefix
      .slice(10)
      .some((entry, index) => entry.filename !== LEGACY_UNVERIFIABLE_FILENAMES[index]) ||
    prefix.slice(10).some((entry) => entry.legacyChecksumBackfillAllowed)
  ) {
    throw new Error('Trusted 017 legacy adoption contract is invalid.');
  }
  return prefix;
}

function expectedBackfillablePrefix(migrations) {
  const prefix = migrations.filter((entry) => entry.legacyChecksumBackfillAllowed);
  if (prefix.length !== 10 || prefix.some((entry, index) => entry !== migrations[index])) {
    throw new Error('Trusted legacy checksum-backfill contract is invalid.');
  }
  return prefix;
}

function assertOrderedRows(rows, expected, label) {
  if (
    !Array.isArray(rows) ||
    rows.length !== expected.length ||
    rows.some((row, index) => row.filename !== expected[index].filename)
  ) {
    throw new Error(`BASELINE_MISMATCH: ${label} does not match the trusted ordered prefix.`);
  }
  for (let index = 0; index < rows.length; index += 1) {
    const current = new Date(rows[index].applied_at).getTime();
    if (!Number.isFinite(current)) {
      throw new Error(`BASELINE_MISMATCH: ${label} contains an invalid timestamp.`);
    }
    if (index > 0) {
      const previous = new Date(rows[index - 1].applied_at).getTime();
      if (current < previous) {
        throw new Error(`BASELINE_MISMATCH: ${label} timestamps are not ordered.`);
      }
    }
  }
}

function classifyLegacyLedger(rows, migrations) {
  const backfillable = expectedBackfillablePrefix(migrations);
  const target017 = expectedLegacy017Prefix(migrations);
  if (
    rows.length === backfillable.length &&
    rows.every((row, index) => row.filename === backfillable[index].filename)
  ) {
    assertOrderedRows(rows, backfillable, 'Legacy ledger');
    return 'legacy-010';
  }
  if (
    rows.length === target017.length &&
    rows.every((row, index) => row.filename === target017[index].filename)
  ) {
    assertOrderedRows(rows, target017, '017 adoption ledger');
    return 'production-017-unverifiable';
  }
  throw new Error('BASELINE_MISMATCH: Legacy ledger migration set mismatch.');
}

function validateEstablishedLedger(rows, migrations) {
  if (!Array.isArray(rows) || rows.length > migrations.length) {
    throw new Error('BASELINE_MISMATCH: Established ledger migration prefix is invalid.');
  }
  const prefix = migrations.slice(0, rows.length);
  assertOrderedRows(rows, prefix, 'Established ledger');
  const expectedByName = new Map(migrations.map((entry) => [entry.filename, entry]));
  for (const row of rows) {
    const migration = expectedByName.get(row.filename);
    if (!migration)
      throw new Error(`BASELINE_MISMATCH: unknown applied migration ${row.filename}.`);
    if (row.checksum_source === LEGACY_UNVERIFIABLE) {
      if (!LEGACY_UNVERIFIABLE_FILENAMES.includes(row.filename) || row.checksum !== null) {
        throw new Error(`MIGRATION_CHECKSUM_MISMATCH: ${row.filename}`);
      }
      continue;
    }
    if (row.checksum !== migration.sha256) {
      throw new Error(`MIGRATION_CHECKSUM_MISMATCH: ${row.filename}`);
    }
    if (row.checksum_source === MANIFEST_BACKFILL) {
      if (!migration.legacyChecksumBackfillAllowed) {
        throw new Error(`MIGRATION_CHECKSUM_MISMATCH: ${row.filename}`);
      }
      continue;
    }
    if (row.checksum_source !== MIGRATION_FILE) {
      throw new Error(`MIGRATION_CHECKSUM_MISMATCH: ${row.filename}`);
    }
  }
  return new Set(rows.map((row) => row.filename));
}

function validateChecksummedLedger(rows, migrations) {
  if (!Array.isArray(rows) || rows.length > migrations.length) {
    throw new Error('BASELINE_MISMATCH: Established ledger migration prefix is invalid.');
  }
  const prefix = migrations.slice(0, rows.length);
  if (rows.some((row, index) => row.filename !== prefix[index].filename)) {
    throw new Error(
      'BASELINE_MISMATCH: Established ledger migration prefix does not match the trusted ordered prefix.'
    );
  }
  for (const [index, row] of rows.entries()) {
    if (row.checksum !== prefix[index].sha256) {
      throw new Error(`MIGRATION_CHECKSUM_MISMATCH: ${row.filename}`);
    }
  }
  return new Set(rows.map((row) => row.filename));
}

function assertM5ExpectedPending(migrations, applied, expected) {
  const expectedM5 = ['018_cooking_sessions.sql', '019_real_consumption_reconciliation.sql'];
  if (
    !(expected instanceof Set) ||
    expected.size !== expectedM5.length ||
    [...expected].some((filename, index) => filename !== expectedM5[index])
  ) {
    throw new Error(
      'MIGRATION_EXPECTED_PENDING_MISMATCH: M5 requires the exact ordered 018/019 pair.'
    );
  }
  if (migrations[17]?.filename !== expectedM5[0] || migrations[18]?.filename !== expectedM5[1]) {
    throw new Error('Trusted M5 migration sequence is incomplete.');
  }
  const knownFilenames = new Set(migrations.map((migration) => migration.filename));
  if ([...applied].some((filename) => !knownFilenames.has(filename))) {
    throw new Error('BASELINE_MISMATCH: unknown applied migration prevents M5 execution.');
  }
  const appliedPrefix = migrations
    .slice(0, 17)
    .every((migration) => applied.has(migration.filename));
  const only017Pending = expectedM5.every((filename) => !applied.has(filename));
  const noLaterApplied = migrations
    .slice(19)
    .every((migration) => !applied.has(migration.filename));
  if (!appliedPrefix || !only017Pending || !noLaterApplied) {
    throw new Error(
      'MIGRATION_EXPECTED_PENDING_MISMATCH: M5 requires exact baseline 017 and pending 018/019.'
    );
  }
}

module.exports = {
  LEGACY_UNVERIFIABLE_FILENAMES,
  MANIFEST_BACKFILL,
  LEGACY_UNVERIFIABLE,
  MIGRATION_FILE,
  classifyLegacyLedger,
  validateChecksummedLedger,
  validateEstablishedLedger,
  assertM5ExpectedPending,
};
