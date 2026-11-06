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
