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

function calendarDate(value, timeZone) {
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value.trim();
  const dateOnly = /^(\d{4}-\d{2}-\d{2})$/.exec(text);
  if (dateOnly) return dateOnly[1];
  const midnightUtc =
    /^(\d{4}-\d{2}-\d{2})[ T]00:00:00(?:\.\d+)?(?:Z|[+\-]00(?::?00)?)$/.exec(
      text,
    );
  if (midnightUtc) return midnightUtc[1];
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(parsed);
  const values = Object.fromEntries(
    parts.map(({ type, value: part }) => [type, part]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

export function classifyFixtureExpiration(
  expirationDate,
  { now = new Date(), timeZone = "America/Caracas", dueSoonDays = 5 } = {},
) {
  const expiration = calendarDate(expirationDate, timeZone);
  if (!expiration) return { status: "unknown", calendarDate: null };
  const today = calendarDate(now.toISOString(), timeZone);
  if (!today) return { status: "unknown", calendarDate: expiration };
  const daysRemaining = Math.round(
    (Date.parse(`${expiration}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
      86_400_000,
  );
  if (daysRemaining < 0) {
    return { status: "expired", calendarDate: expiration, daysRemaining };
  }
  if (daysRemaining === 0) {
    return { status: "due_today", calendarDate: expiration, daysRemaining };
  }
  if (daysRemaining <= dueSoonDays) {
    return { status: "due_soon", calendarDate: expiration, daysRemaining };
  }
  return { status: "valid", calendarDate: expiration, daysRemaining };
}

export function selectFixtureLot({
  items,
  ingredientName,
  marker,
  userId,
  tenantId,
  now,
  timeZone = "America/Caracas",
}) {
  const normalized = String(ingredientName).trim().toLocaleLowerCase();
  const matches = items.filter(
    (item) =>
      String(item.ingredient_name ?? item.ingredientName ?? "")
        .trim()
        .toLocaleLowerCase() === normalized,
  );
  const qaMatches = matches.filter((item) => item.notes === marker);
  if (qaMatches.length > 1)
    return { kind: "invalid", reason: "duplicate_qa_lot" };
  const existing = qaMatches[0] ?? matches[0] ?? null;
  if (!existing) return { kind: "create", existing: null };
  if (existing.notes !== marker)
    return { kind: "invalid", reason: "unmarked_lot" };
  if (
    existing.id == null ||
    existing.tenant_id !== tenantId ||
    existing.user_id !== userId ||
    typeof existing.quantity !== "string" ||
    !existing.quantity.trim() ||
    typeof existing.unit !== "string" ||
    !existing.unit.trim()
  ) {
    return { kind: "invalid", reason: "qa_lot_identity_or_quantity" };
  }
  const expiration = classifyFixtureExpiration(
    existing.expiration_date ?? existing.expirationDate,
    { now, timeZone },
  );
  if (expiration.status === "unknown") {
    return { kind: "invalid", reason: "qa_lot_expiration" };
  }
  return {
    kind: expiration.status === "expired" ? "renew" : "reuse",
    existing,
    expiration,
  };
}
