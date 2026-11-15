import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadTrustedMigration020 } = require('./activate-020-capabilities.js');
const repositoryRoot = path.resolve(import.meta.dirname, '../..');

function syntheticManifestRoot(
  t,
  { filename = '020_r4_activation_fixture.sql', include020 = true } = {}
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cocinacore-020-activation-manifest-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const migrationsDirectory = path.join(root, 'db/migrations');
  fs.mkdirSync(migrationsDirectory, { recursive: true });
  const manifest = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, 'db/migrations/manifest.json'), 'utf8')
  );
  manifest.migrations = manifest.migrations.slice(0, 19);
  for (const migration of manifest.migrations) {
    fs.copyFileSync(
      path.join(repositoryRoot, 'db/migrations', migration.filename),
      path.join(migrationsDirectory, migration.filename)
    );
  }

  if (include020) {
    const sql = Buffer.from('SELECT 1;\n');
    fs.writeFileSync(path.join(migrationsDirectory, filename), sql);
    manifest.migrations.push({
      id: '020',
      filename,
      lane: 'migration',
      sha256: crypto.createHash('sha256').update(sql).digest('hex'),
      byteLength: sql.length,
      transactional: 'required',
      legacyChecksumBackfillAllowed: false,
    });
  }
  fs.writeFileSync(
    path.join(migrationsDirectory, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  return root;
}

test('administrative activation manifest contract', async (t) => {
  await t.test('fails closed on a historical manifest without migration 020', (t) => {
    const root = syntheticManifestRoot(t, { include020: false });
    assert.throws(
      () => loadTrustedMigration020({ repositoryRoot: root }),
      (error) => error.activationCode === 'ACTIVATION_MANIFEST_020_UNAVAILABLE'
    );
  });

  await t.test('current manifest retains the exact historical activation boundary', () => {
    const contract = loadTrustedMigration020();
    assert.equal(contract.migration020.filename, '020_tenant_rls_hardening.sql');
    assert.equal(
      contract.migration020.sha256,
      '1fbadb829792902ef19bdb0abd2c20e39409360986c9844d9cab3105df6eb33a'
    );
    assert.equal(contract.expectedLedger.length, 20);
    assert.equal(contract.expectedLedger.at(-1).id, '020');
  });

  await t.test('uses the exact synthetic migration entry and verifies its trusted bytes', (t) => {
    const root = syntheticManifestRoot(t);
    const contract = loadTrustedMigration020({ repositoryRoot: root });
    assert.equal(contract.migration020.id, '020');
    assert.equal(contract.migration020.filename, '020_r4_activation_fixture.sql');
    assert.equal(contract.expectedLedger.length, 20);
  });

  await t.test('rejects a manifest checksum that does not match the 020 file', (t) => {
    const root = syntheticManifestRoot(t);
    const manifestPath = path.join(root, 'db/migrations/manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.migrations[19].sha256 = '0'.repeat(64);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    assert.throws(
      () => loadTrustedMigration020({ repositoryRoot: root }),
      (error) => error.activationCode === 'ACTIVATION_MANIFEST_020_CHECKSUM_MISMATCH'
    );
  });

  await t.test('rejects a manifest with a changed trusted base anchor', (t) => {
    const root = syntheticManifestRoot(t);
    const manifestPath = path.join(root, 'db/migrations/manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.trustedBaseCommit = 'f'.repeat(40);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    assert.throws(
      () => loadTrustedMigration020({ repositoryRoot: root }),
      (error) => error.activationCode === 'ACTIVATION_MANIFEST_INVALID'
    );
  });

  await t.test('rejects an unnumbered file even when its name begins with 020', (t) => {
    const root = syntheticManifestRoot(t, { filename: '020_untrusted.sql' });
    const manifestPath = path.join(root, 'db/migrations/manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.migrations[19].id = '021';
    manifest.migrations[19].filename = '020_untrusted.sql';
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    assert.throws(
      () => loadTrustedMigration020({ repositoryRoot: root }),
      (error) => error.activationCode === 'ACTIVATION_MANIFEST_INVALID'
    );
  });

  await t.test('does not fall back to runtime or migration URLs', () => {
    const script = path.join(repositoryRoot, 'frontend/scripts/activate-020-capabilities.js');
    const result = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        COCINACORE_ACTIVATION_DATABASE_URL: '',
        DATABASE_URL: 'postgresql://data-secret.example/test',
        MIGRATION_DATABASE_URL: 'postgresql://migration-secret.example/test',
      },
    });
    const output = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 1);
    assert.match(output, /ACTIVATION_DATABASE_URL_REQUIRED/);
    assert.doesNotMatch(output, /data-secret|migration-secret/);
  });
});
