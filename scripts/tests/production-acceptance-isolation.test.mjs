import assert from "node:assert/strict";
import test from "node:test";
import {
  consumeIdentityProof,
  createIdentityProof,
} from "../production-acceptance/identity.mjs";
import {
  evaluateIsolation,
  ISOLATION_CODES,
} from "../production-acceptance/isolation.mjs";

const role = {
  rolsuper: false,
  rolbypassrls: false,
  rolcreaterole: false,
  rolcreatedb: false,
};
const base = { userId: "user-1", tenantId: "tenant-1" };

function decision(overrides = {}) {
  const proof = createIdentityProof(base.userId, base.tenantId);
  return evaluateIsolation({
    ...base,
    ...proof,
    role,
    rows: [
      {
        commitment: proof.commitment,
        userCount: 1,
        membershipCount: 1,
        pendingInvitationCount: 0,
      },
    ],
    ...overrides,
  });
}

test("production acceptance isolation rejects tampering and nonce replay", () => {
  const proof = createIdentityProof(base.userId, base.tenantId);
  const used = new Set();
  assert.equal(consumeIdentityProof(proof, used), true);
  assert.equal(consumeIdentityProof(proof, used), false);
  assert.equal(
    consumeIdentityProof({ ...proof, commitment: "0".repeat(64) }, new Set()),
    false,
  );
});
test("production acceptance isolation passes only one dedicated tenant member", () => {
  assert.deepEqual(decision(), {
    pass: true,
    code: ISOLATION_CODES.pass,
    writesAllowed: true,
  });
});
test("production acceptance isolation stops when an additional user exists", () => {
  const proof = createIdentityProof(base.userId, base.tenantId);
  assert.deepEqual(
    evaluateIsolation({
      ...base,
      ...proof,
      role,
      rows: [
        {
          commitment: proof.commitment,
          userCount: 2,
          membershipCount: 2,
          pendingInvitationCount: 0,
        },
      ],
    }),
    { pass: false, code: ISOLATION_CODES.additionalUser, writesAllowed: false },
  );
});
test("production acceptance isolation stops when membership is not exclusive", () => {
  const proof = createIdentityProof(base.userId, base.tenantId);
  assert.deepEqual(
    evaluateIsolation({
      ...base,
      ...proof,
      role,
      rows: [
        {
          commitment: proof.commitment,
          userCount: 1,
          membershipCount: 2,
          pendingInvitationCount: 0,
        },
      ],
    }),
    {
      pass: false,
      code: ISOLATION_CODES.additionalMembership,
      writesAllowed: false,
    },
  );
});
test("production acceptance isolation rejects incompatible pending invitations", () => {
  const proof = createIdentityProof(base.userId, base.tenantId);
  assert.deepEqual(
    evaluateIsolation({
      ...base,
      ...proof,
      role,
      rows: [
        {
          commitment: proof.commitment,
          userCount: 1,
          membershipCount: 1,
          pendingInvitationCount: 1,
        },
      ],
    }),
    {
      pass: false,
      code: ISOLATION_CODES.pendingInvitation,
      writesAllowed: false,
    },
  );
});
test("production acceptance isolation rejects identity mismatch before writes", () => {
  assert.equal(
    decision({ userId: "wrong-user" }).code,
    ISOLATION_CODES.wrongIdentity,
  );
  assert.equal(decision({ userId: "wrong-user" }).writesAllowed, false);
});
