import { createHash, randomBytes } from "node:crypto";

const SAFE_CODES = new Set([
  "IDENTITY_PASS",
  "IDENTITY_NO_GO",
  "IDENTITY_HEALTH_NO_GO",
  "IDENTITY_AUTH_NO_GO",
  "IDENTITY_MISMATCH",
  "IDENTITY_PROOF_INVALID",
]);

export function identityCommitment(userId, tenantId, nonce) {
  return createHash("sha256")
    .update(`${userId}|${tenantId}|${nonce}`, "utf8")
    .digest("hex");
}

export function createIdentityProof(userId, tenantId) {
  const nonce = randomBytes(32).toString("hex");
  return {
    userId,
    tenantId,
    nonce,
    commitment: identityCommitment(userId, tenantId, nonce),
  };
}

export function verifyIdentityProof({ userId, tenantId, nonce, commitment }) {
  return (
    /^[a-f0-9]{64}$/i.test(nonce) &&
    /^[a-f0-9]{64}$/i.test(commitment) &&
    identityCommitment(userId, tenantId, nonce) === commitment.toLowerCase()
  );
}

export function consumeIdentityProof(proof, usedNonces) {
  if (!verifyIdentityProof(proof) || usedNonces.has(proof.nonce)) return false;
  usedNonces.add(proof.nonce);
  return true;
}

function safeCode(code) {
  if (!SAFE_CODES.has(code)) throw new Error("unsafe status code");
  console.log(code);
}

async function requestJson(url, init) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => null);
  return { response, body };
}

async function main() {
  const baseUrl = process.env.E2E_PRODUCTION_URL?.replace(/\/$/, "");
  const email = process.env.E2E_PRODUCTION_USER_EMAIL;
  const password = process.env.E2E_PRODUCTION_USER_PASSWORD;
  const expectedUserId = process.env.E2E_PRODUCTION_USER_ID;
  const expectedTenantId = process.env.E2E_PRODUCTION_TENANT_ID;
  if (!baseUrl || !email || !password || !expectedUserId || !expectedTenantId) {
    safeCode("IDENTITY_NO_GO");
    process.exitCode = 1;
    return;
  }

  const health = await requestJson(`${baseUrl}/api/health`);
  if (
    !health.response.ok ||
    health.body?.status !== "ok" ||
    health.body?.dependencies?.database?.status !== "ok" ||
    health.body?.dependencies?.redis?.status !== "ok"
  ) {
    safeCode("IDENTITY_HEALTH_NO_GO");
    process.exitCode = 1;
    return;
  }

  const login = await requestJson(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify({ email, password }),
  });
  const cookie = login.response.headers.get("set-cookie")?.split(";", 1)[0];
  if (!login.response.ok || !cookie) {
    safeCode("IDENTITY_AUTH_NO_GO");
    process.exitCode = 1;
    return;
  }

  const session = await requestJson(`${baseUrl}/api/auth/session`, {
    headers: { cookie },
  });
  const userId = session.body?.user?.id;
  const tenantId = session.body?.user?.tenant?.tenantId;
  if (
    !session.response.ok ||
    typeof userId !== "string" ||
    typeof tenantId !== "string"
  ) {
    safeCode("IDENTITY_AUTH_NO_GO");
    process.exitCode = 1;
    return;
  }
  if (userId !== expectedUserId || tenantId !== expectedTenantId) {
    safeCode("IDENTITY_MISMATCH");
    process.exitCode = 1;
    return;
  }

  const proof = createIdentityProof(userId, tenantId);
  for (const value of [proof.nonce, proof.commitment])
    console.log(`::add-mask::${value}`);
  console.log(`IDENTITY_NONCE=${proof.nonce}`);
  console.log(`IDENTITY_COMMITMENT=${proof.commitment}`);
}

if (import.meta.url === `file://${process.argv[1]}`)
  main().catch(() => {
    safeCode("IDENTITY_NO_GO");
    process.exitCode = 1;
  });
