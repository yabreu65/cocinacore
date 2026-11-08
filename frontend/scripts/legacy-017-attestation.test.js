'use strict';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS test harness.
const assert = require('node:assert/strict');
// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS test harness.
const test = require('node:test');
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Fixed baseline contract.
const { SIGNATURE, assertSignature } = require('./legacy-017-attestation');

function baseline() {
  return {
    columns: SIGNATURE.columns.map((row) => [...row]),
    constraints: SIGNATURE.constraints.map((row) => [...row]),
    indexes: SIGNATURE.indexes.map((row) => [...row]),
    policies: SIGNATURE.policies.map((row) => [...row]),
    functions: SIGNATURE.functions.map((row) => [...row]),
    triggers: SIGNATURE.triggers.map((row) => [...row]),
    dataConditions: {
      canonicalEmails: true,
      uniqueEmails: true,
      culinaryTermGroupsWithinLimits: true,
    },
  };
}

test('accepts the fixed PostgreSQL 16 migration 011-017 structural signature', () => {
  assert.doesNotThrow(() => assertSignature(baseline()));
});

test('keeps expected policies immutable against mutation', () => {
  const policy = SIGNATURE.policies[0];
  assert.equal(Object.isFrozen(policy), true);
  assert.equal(Reflect.set(policy, 4, 'true'), false);
  assert.match(policy[4], /current_setting/);
});

test('rejects changed columns, unvalidated/altered constraints, invalid indexes, and extra policies', () => {
  const columns = baseline();
  columns.columns[0][1] = 'text';

  const constraints = baseline();
  constraints.constraints[0][2] = false;

  const indexes = baseline();
  indexes.indexes[0][1] = false;

  const policies = baseline();
  policies.policies.push([...policies.policies[0]]);

  for (const actual of [columns, constraints, indexes, policies]) {
    assert.throws(() => assertSignature(actual), /BASELINE_MISMATCH/);
  }
});

test('rejects altered function and trigger definitions or failed data invariants', () => {
  const functions = baseline();
  functions.functions[0][1] = '0'.repeat(64);

  const triggers = baseline();
  triggers.triggers[0][2] = 'D';

  const data = baseline();
  data.dataConditions.culinaryTermGroupsWithinLimits = false;

  for (const actual of [functions, triggers, data]) {
    assert.throws(() => assertSignature(actual), /BASELINE_MISMATCH/);
  }
});
