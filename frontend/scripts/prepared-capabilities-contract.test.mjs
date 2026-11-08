import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const {
  PREPARED_CAPABILITIES_CONTRACT,
  assertPreparedCapabilitiesManifest,
} = require('./prepared-capabilities-contract.js');
const copy = () => structuredClone(PREPARED_CAPABILITIES_CONTRACT);

describe('prepared capability manifest contract', () => {
  it('accepts exactly the seven reviewed inert declarations', () => {
    const manifest = copy();
    assert.equal(manifest.objects.length, 7);
    assert.doesNotThrow(() => assertPreparedCapabilitiesManifest(manifest));
  });
  for (const [name, mutate] of [
    ['missing declaration', () => undefined],
    ['arbitrary owner', (v) => (v.objects[0].owner = 'postgres')],
    ['arbitrary identity', (v) => (v.objects[0].identity = 'public.unrelated')],
    [
      'incorrect function signature',
      (v) => (v.objects[1].identity = 'public.signup_new_account(text)'),
    ],
    [
      'definition fingerprint drift',
      (v) => (v.objects[2].definitionMd5 = '00000000000000000000000000000000'),
    ],
    ['missing security barrier', (v) => (v.objects[0].options = [])],
    ['unexpected ACL state', (v) => (v.acl = 'public')],
    ['unexpected state', (v) => (v.state = 'activated')],
    ['additional object', (v) => v.objects.push({ kind: 'view', identity: 'public.extra' })],
    ['extra declaration property', (v) => (v.objects[0].unexpected = true)],
    ['additional contract property', (v) => (v.unexpected = true)],
    ['missing object', (v) => v.objects.pop()],
  ]) {
    it(`rejects ${name}`, () => {
      const value = copy();
      const replacement = mutate(value);
      assert.throws(
        () =>
          assertPreparedCapabilitiesManifest(name === 'missing declaration' ? replacement : value),
        /PREPARED_CAPABILITIES_MANIFEST_MISMATCH/
      );
    });
  }
});
