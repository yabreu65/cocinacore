import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const {
  attestPreparedCapabilities,
  loadInertAttestation,
} = require('./prepared-capabilities-attestation.js');
const { PREPARED_CAPABILITIES_CONTRACT } = require('./prepared-capabilities-contract.js');

function mockClient(count, error) {
  const queries = [];
  return {
    queries,
    async query(sql) {
      queries.push(sql);
      if (queries.length === 1) return { rows: [{ count: String(count) }] };
      if (error) throw new Error(error);
      return { rows: [] };
    },
  };
}

describe('prepared PostgreSQL inert attestation', () => {
  it('accepts an unprepared 019 only when preparation is not required', async () => {
    const client = mockClient(0);
    assert.equal(await attestPreparedCapabilities(client), 'unprepared');
    assert.equal(client.queries.length, 1);
  });
  for (const count of [0, 1, 6, 8]) {
    it(`fails closed with ${count} objects when preparation is required`, async () => {
      const client = mockClient(count);
      await assert.rejects(
        attestPreparedCapabilities(client, { required: true }),
        /PREPARED_CAPABILITIES_PARTIAL/
      );
      assert.equal(client.queries.length, 1);
    });
  }
  it('executes fixed catalog and effective-privilege checks on the supplied client', async () => {
    const client = mockClient(7);
    assert.equal(await attestPreparedCapabilities(client, { required: true }), 'inert');
    assert.equal(client.queries.length, 2);
    assert.equal(client.queries[1], loadInertAttestation());
    assert.match(client.queries[1], /DO \$attest\$/);
    assert.match(client.queries[1], /DO \$inert_guard\$/);
  });
  it('fails closed on any PostgreSQL attestation error', async () => {
    const client = mockClient(7, '020 inert view ACL mismatch');
    await assert.rejects(attestPreparedCapabilities(client), /PREPARED_CAPABILITIES_MISMATCH/);
  });
  it('matches the reviewed A1-P attestation blocks without deriving expected values from PostgreSQL', () => {
    const preparer = readFileSync(
      new URL('../../scripts/provision-020-inert-capabilities.sql', import.meta.url),
      'utf8'
    );
    const fixed = loadInertAttestation();
    for (const tag of ['attest', 'inert_guard']) {
      const start = preparer.indexOf(`DO $${tag}$`);
      const end = preparer.indexOf(`$${tag}$;`, start) + `$${tag}$;`.length;
      assert.ok(start >= 0 && end > start);
      assert.ok(fixed.includes(preparer.slice(start, end)));
    }
  });
  it('uses definition fingerprints consistent with the fixed manifest contract', () => {
    const sql = loadInertAttestation();
    for (const object of PREPARED_CAPABILITIES_CONTRACT.objects) {
      if (object.identity === 'public.runtime_identity_probe') {
        const definition =
          ' SELECT u.id,\n    u.tenant_id\n   FROM users u\n     JOIN tenant_memberships m ON m.user_id = u.id AND m.tenant_id = u.tenant_id;';
        assert.equal(createHash('md5').update(definition).digest('hex'), object.definitionMd5);
        assert.ok(sql.includes(definition.replaceAll('\n', '\\n')));
      } else {
        assert.ok(sql.includes(object.definitionMd5), object.identity);
      }
    }
  });
});
