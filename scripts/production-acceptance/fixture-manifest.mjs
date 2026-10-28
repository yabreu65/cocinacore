import { verifyIdentityProof } from "./identity.mjs";

export function createManifest({
  userId,
  tenantId,
  now = new Date().toISOString(),
}) {
  return {
    version: 2,
    issue: 84,
    userId,
    tenantId,
    createdAt: now,
    updatedAt: now,
    status: "started",
    marker: "m4-acceptance-fixture-issue-84",
    operations: [],
    created: { profile: false, mealPlan: false, inventory: [] },
    cleanup: { inventoryDeleteAllowed: true, mealPlanDeleteSupported: false },
    retention: "reuse-only; do not create a second plan",
  };
}

export function recordOperation(
  manifest,
  name,
  status,
  details = {},
  now = new Date().toISOString(),
) {
  const existing = manifest.operations.find(
    (operation) => operation.name === name && operation.status === "started",
  );
  if (status === "started") {
    manifest.operations.push({ name, status, startedAt: now, ...details });
  } else if (existing) {
    Object.assign(existing, { status, completedAt: now, ...details });
  } else {
    manifest.operations.push({ name, status, completedAt: now, ...details });
  }
  manifest.updatedAt = now;
  return manifest;
}

export function markManifest(manifest, status, now = new Date().toISOString()) {
  manifest.status = status;
  manifest.updatedAt = now;
  return manifest;
}

export function verifyPreparationIdentity({
  userId,
  tenantId,
  nonce,
  commitment,
}) {
  return verifyIdentityProof({ userId, tenantId, nonce, commitment });
}

export function stableInventoryCandidates(
  planNames,
  inventoryItems,
  marker = "m4-acceptance-fixture-issue-84",
) {
  const stableNames = [...new Set(planNames)].slice(0, 2);
  const normalized = (value) => value.trim().toLocaleLowerCase();
  return stableNames.map((name) => {
    const matching = inventoryItems.filter(
      (item) =>
        normalized(String(item.ingredient_name ?? "")) === normalized(name),
    );
    const fixture = matching.find((item) => item.notes === marker);
    return {
      name,
      existing: fixture ?? matching[0] ?? null,
      shouldCreate: !fixture && matching.length === 0,
    };
  });
}
