import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const {
  attestActivatedCapabilities,
  loadActivationAttestation,
} = require('./activated-capabilities-attestation.js');

function mockClient(result, error) {
  const queries = [];
  return {
    queries,
    async query(sql) {
      queries.push(sql);
      if (error) throw new Error(error);
      return { rows: [{ activation_state: result }] };
    },
  };
}

describe('activated PostgreSQL state attestation', () => {
  for (const state of ['active', 'pending']) {
    it(`returns the fixed catalog result ${state}`, async () => {
      const client = mockClient(state);
      assert.equal(await attestActivatedCapabilities(client), state);
      assert.equal(client.queries.length, 1);
      assert.equal(client.queries[0], loadActivationAttestation());
      assert.match(client.queries[0], /ACTIVATED_CAPABILITIES_POLICY_MISMATCH/);
    });
  }

  it('reads the final result from PostgreSQL multi-statement queries', async () => {
    const client = {
      async query() {
        return [{ rows: [] }, { rows: [{ activation_state: 'pending' }] }];
      },
    };
    assert.equal(await attestActivatedCapabilities(client), 'pending');
  });

  it('selects the exact 021 catalog only when explicitly requested', async () => {
    const client = mockClient('active');
    assert.equal(await attestActivatedCapabilities(client, '021'), 'active');
    assert.equal(client.queries[0], loadActivationAttestation('021'));
    assert.notEqual(client.queries[0], loadActivationAttestation('020'));
    assert.match(client.queries[0], /INVENTORY_021_CONSTRAINT_MISMATCH/);
    assert.match(client.queries[0], /count\(\*\)=72/);
  });

  it('requires active 020 capabilities for 021', async () => {
    await assert.rejects(attestActivatedCapabilities(mockClient('pending'), '021'), /ACTIVATION_PENDING/);
  });

  it('accepts the pinned 024 catalog only when 020 capabilities are active', async () => {
    const activeClient = mockClient('active');
    assert.equal(await attestActivatedCapabilities(activeClient, '024'), 'active');
    assert.equal(activeClient.queries.length, 1);
    assert.equal(activeClient.queries[0], loadActivationAttestation('024'));

    await assert.rejects(attestActivatedCapabilities(mockClient('pending'), '024'), /ACTIVATION_PENDING/);
    const unsupportedClient = mockClient('active');
    await assert.rejects(attestActivatedCapabilities(unsupportedClient, '026'), /unsupported catalog version/);
    assert.equal(unsupportedClient.queries.length, 0);
  });

  it('pins 025 inventory and retains each earlier component without the 024 inventory', async () => {
    const inventory = readFileSync(new URL('./activated-capabilities-025-inventory.sql', import.meta.url));
    assert.equal(createHash('sha256').update(inventory).digest('hex'),
      '71793cce59481043e7fe53a067b9c59768e8d0dd3b988d588cde12fd778fe455');
    const sql = loadActivationAttestation('025');
    for (const name of ['activated-capabilities-024-first-admin.sql', 'activated-capabilities-023-retention.sql', 'activated-capabilities-022-occurrences.sql', 'activated-capabilities-025-inventory.sql']) {
      assert.ok(sql.includes(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')));
    }
    assert.ok(!sql.includes(readFileSync(new URL('./activated-capabilities-024-inventory.sql', import.meta.url), 'utf8')));
    assert.match(sql, /count\(\*\)=74 FROM actual/);
    assert.match(sql, /count\(\*\)=54 FROM expected/);
    const oldInventory = readFileSync(new URL('./activated-capabilities-024-inventory.sql', import.meta.url));
    assert.equal(createHash('sha256').update(oldInventory).digest('hex'),
      'a4de388c8f60fd4bc735bf75ed6f70ff249bb8aa2a246615114aaceab4623771');
    const text = inventory.toString();
    for (const [table, columns] of Object.entries({
      tenant_books: ['tenant_id', 'title', 'author', 'description'],
      tenant_pdf_library: ['tenant_id', 'tenant_book_id', 'storage_path', 'file_size_bytes', 'page_count', 'checksum_sha256', 'uploaded_by', 'processing_status', 'processed_chunks_count'],
    })) {
      for (const column of columns) assert.ok(text.includes(`('${table}','${column}','INSERT',false)`));
    }
    assert.match(text, /documents_tenant_books_insert','a','cocinacore_runtime_rls',true,'-','049b61188bb1ee07a817bc83960a81f7/);
    assert.match(text, /documents_tenant_pdfs_insert','a','cocinacore_runtime_rls',true,'-'/);
    assert.match(text, /AND \(tenant_book_id IS NOT NULL\)/);
    assert.match(text, /count\(\*\)=55 FROM expected/);

    await assert.rejects(attestActivatedCapabilities(mockClient('pending'), '025'), /ACTIVATION_PENDING/);
  });

  it('rejects modified 025 inventory without changing the 024 attestation', () => {
    const fs = require('node:fs');
    const original = fs.readFileSync;
    try {
      fs.readFileSync = function (filename, ...args) {
        const value = original.call(this, filename, ...args);
        return String(filename).endsWith('activated-capabilities-025-inventory.sql')
          ? Buffer.concat([Buffer.from(value), Buffer.from('\n-- tampered')]) : value;
      };
      assert.throws(() => loadActivationAttestation('025'), /untrusted activated-capabilities-025-inventory/);
      assert.doesNotThrow(() => loadActivationAttestation('024'));
    } finally {
      fs.readFileSync = original;
    }
  });

  it('requires both the 021 capability contract and 022 occurrence constraints', async () => {
    const client = mockClient('active');
    assert.equal(await attestActivatedCapabilities(client, '022'), 'active');
    assert.match(client.queries[0], /CONSUMPTION_022_UNIQUE_MISMATCH/);
    assert.match(client.queries[0], /CONSUMPTION_022_CHECK_MISMATCH/);
    assert.ok(client.queries[0].endsWith(loadActivationAttestation('021')));
    await assert.rejects(attestActivatedCapabilities(mockClient('pending'), '022'), /ACTIVATION_PENDING/);
    await assert.rejects(attestActivatedCapabilities(mockClient(undefined,'CONSUMPTION_022_UNIQUE_MISMATCH'), '022'), /CONSUMPTION_022_UNIQUE_MISMATCH/);
  });

  it('requires the prior 022 contracts and the non-cascading 023 movement FK', async () => {
    const client = mockClient('active');
    assert.equal(await attestActivatedCapabilities(client, '023'), 'active');
    assert.match(client.queries[0], /INVENTORY_023_RETENTION_FK_MISMATCH/);
    assert.ok(client.queries[0].endsWith(loadActivationAttestation('022')));
    await assert.rejects(attestActivatedCapabilities(mockClient('pending'), '023'), /ACTIVATION_PENDING/);
    await assert.rejects(attestActivatedCapabilities(mockClient(undefined, 'INVENTORY_023_RETENTION_FK_MISMATCH'), '023'), /INVENTORY_023_RETENTION_FK_MISMATCH/);
  });

  it('pins the 021 catalog bytes independently of the 020 contract', () => {
    assert.equal(createHash('sha256').update(loadActivationAttestation('021')).digest('hex'),
      '637be0a5b5c875f1f74d9088843fe2442024984e8f8d24365997301575072631');
  });

  it('rejects unknown activation results', async () => {
    await assert.rejects(
      attestActivatedCapabilities(mockClient('unknown')),
      /invalid activation state/
    );
  });

  it('fails closed on a PostgreSQL catalog mismatch', async () => {
    await assert.rejects(
      attestActivatedCapabilities(mockClient(undefined, 'ACTIVATED_CAPABILITIES_POLICY_MISMATCH')),
      /ACTIVATED_CAPABILITIES_MISMATCH.*ACTIVATED_CAPABILITIES_POLICY_MISMATCH/
    );
  });

  it('pins the read-only PG16 contract and fixed reviewed policy hashes', () => {
    const sql = loadActivationAttestation();
    const bytes = readFileSync(
      new URL('./activated-capabilities-attestation.sql', import.meta.url)
    );
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      '62e96281227b57c71e00879a2b019cf57beaa3e376e775c0a4d574dde38ab841'
    );
    assert.match(sql, /count\(\*\)=71/);
    assert.match(sql, /cocinacore_signup_bootstrap/);
    assert.match(sql, /cocinacore_global_writer_view_owner/);
    assert.match(sql, /owner_metrics_rls_guard/);
    assert.match(sql, /ACTIVATED_CAPABILITIES_RLS_MISMATCH/);
    assert.match(sql, /match_chunks/);
    assert.match(sql, /tenant_invitations/);
    assert.match(sql, /ACTIVATED_CAPABILITIES_RUNTIME_ACL_MISMATCH/);
    assert.match(sql, /ACTIVATED_CAPABILITIES_RUNTIME_COLUMN_ACL_MISMATCH/);
    assert.match(sql, /ACTIVATED_CAPABILITIES_RUNTIME_BOUNDARY_MISMATCH/);
  });
});
