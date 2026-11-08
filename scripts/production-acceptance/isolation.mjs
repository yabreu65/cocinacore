import { identityCommitment, verifyIdentityProof } from "./identity.mjs";

export const ISOLATION_CODES = Object.freeze({
  pass: "ISOLATION_PASS",
  wrongIdentity: "ISOLATION_IDENTITY_NO_GO",
  ambiguous: "ISOLATION_AMBIGUOUS_TENANT",
  additionalUser: "ISOLATION_ADDITIONAL_USER",
  additionalMembership: "ISOLATION_ADDITIONAL_MEMBERSHIP",
  pendingInvitation: "ISOLATION_INCOMPATIBLE_INVITATION",
  dbRole: "ISOLATION_DB_ROLE_NO_GO",
  appHealth: "ISOLATION_APP_HEALTH_NO_GO",
  dbHealth: "ISOLATION_DB_HEALTH_NO_GO",
  redisHealth: "ISOLATION_REDIS_HEALTH_NO_GO",
  query: "ISOLATION_QUERY_NO_GO",
});

export function evaluateIsolation({
  rows,
  userId,
  tenantId,
  nonce,
  commitment,
  role,
}) {
  if (!verifyIdentityProof({ userId, tenantId, nonce, commitment })) {
    return {
      pass: false,
      code: ISOLATION_CODES.wrongIdentity,
      writesAllowed: false,
    };
  }
  if (identityCommitment(userId, tenantId, nonce) !== commitment) {
    return {
      pass: false,
      code: ISOLATION_CODES.wrongIdentity,
      writesAllowed: false,
    };
  }
  if (
    !role ||
    role.rolsuper ||
    role.rolbypassrls ||
    role.rolcreaterole ||
    role.rolcreatedb
  ) {
    return { pass: false, code: ISOLATION_CODES.dbRole, writesAllowed: false };
  }
  const matches = rows.filter((row) => row.commitment === commitment);
  if (matches.length !== 1)
    return {
      pass: false,
      code: ISOLATION_CODES.ambiguous,
      writesAllowed: false,
    };
  const match = matches[0];
  if (match.userCount !== 1)
    return {
      pass: false,
      code: ISOLATION_CODES.additionalUser,
      writesAllowed: false,
    };
  if (match.membershipCount !== 1)
    return {
      pass: false,
      code: ISOLATION_CODES.additionalMembership,
      writesAllowed: false,
    };
  if (match.pendingInvitationCount !== 0)
    return {
      pass: false,
      code: ISOLATION_CODES.pendingInvitation,
      writesAllowed: false,
    };
  return { pass: true, code: ISOLATION_CODES.pass, writesAllowed: true };
}
