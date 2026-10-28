import assert from "node:assert/strict";
import test from "node:test";
import { createIdentityProof } from "../production-acceptance/identity.mjs";
import {
  createManifest,
  classifyFixtureExpiration,
  markManifest,
  recordOperation,
  selectFixtureLot,
  stableInventoryCandidates,
  verifyPreparationIdentity,
} from "../production-acceptance/fixture-manifest.mjs";

test("manifest preserves a completed operation when a later operation fails", () => {
  const manifest = createManifest({ userId: "user-1", tenantId: "tenant-1" });
  recordOperation(manifest, "profile", "started");
  recordOperation(manifest, "profile", "completed", { changed: true });
  recordOperation(manifest, "mealPlan", "started");
  recordOperation(manifest, "mealPlan", "failed", {
    code: "FIXTURE_WRITE_NO_GO",
  });
  markManifest(manifest, "failed");
  assert.equal(manifest.status, "failed");
  assert.equal(
    manifest.operations.find((operation) => operation.name === "profile")
      .status,
    "completed",
  );
  assert.equal(
    manifest.operations.find((operation) => operation.name === "mealPlan")
      .status,
    "failed",
  );
});

test("stable inventory candidates make repeated preparation idempotent", () => {
  const items = [
    {
      ingredient_name: "Tomate",
      notes: "m4-acceptance-fixture-issue-84",
      id: "fixture-1",
    },
    { ingredient_name: "Cebolla", notes: null, id: "real-1" },
  ];
  assert.deepEqual(
    stableInventoryCandidates(["Tomate", "Cebolla", "Papa"], items),
    [
      { name: "Tomate", existing: items[0], shouldCreate: false },
      { name: "Cebolla", existing: items[1], shouldCreate: false },
    ],
  );
});

test("preparation rejects an incorrect user or tenant before writes", () => {
  const proof = createIdentityProof("user-1", "tenant-1");
  assert.equal(verifyPreparationIdentity(proof), true);
  assert.equal(
    verifyPreparationIdentity({ ...proof, userId: "user-2" }),
    false,
  );
  assert.equal(
    verifyPreparationIdentity({ ...proof, tenantId: "tenant-2" }),
    false,
  );
});

test("classifies PostgreSQL timestamps in the report timezone", () => {
  const now = new Date("2026-10-28T16:00:00.000Z");
  assert.equal(
    classifyFixtureExpiration("2026-10-28 00:00:00+00", { now }).status,
    "due_today",
  );
  assert.equal(
    classifyFixtureExpiration("2026-10-27T23:00:00-04:00", { now }).status,
    "expired",
  );
  assert.equal(
    classifyFixtureExpiration("not-a-date", { now }).status,
    "unknown",
  );
});

test("reuses a valid QA lot without changing it", () => {
  const item = {
    id: "lot-1",
    user_id: "user-1",
    tenant_id: "tenant-1",
    ingredient_name: "Tomate",
    quantity: "1",
    unit: "kg",
    expiration_date: "2026-11-02 00:00:00+00",
    notes: "m4-acceptance-fixture-issue-84",
  };
  const selection = selectFixtureLot({
    items: [item],
    ingredientName: "Tomate",
    marker: item.notes,
    userId: "user-1",
    tenantId: "tenant-1",
    now: new Date("2026-10-28T16:00:00.000Z"),
  });
  assert.equal(selection.kind, "reuse");
  assert.equal(selection.existing, item);
});

test("renews an expired QA lot on the same identity", () => {
  const selection = selectFixtureLot({
    items: [
      {
        id: "lot-1",
        user_id: "user-1",
        tenant_id: "tenant-1",
        ingredient_name: "Tomate",
        quantity: "1",
        unit: "kg",
        expiration_date: "2026-10-27 00:00:00+00",
        notes: "qa",
      },
    ],
    ingredientName: "Tomate",
    marker: "qa",
    userId: "user-1",
    tenantId: "tenant-1",
    now: new Date("2026-10-28T16:00:00.000Z"),
  });
  assert.equal(selection.kind, "renew");
  assert.equal(selection.existing.id, "lot-1");
});

test("rejects foreign, incompatible, and duplicate QA lots closed", () => {
  const base = {
    id: "lot-1",
    user_id: "user-1",
    tenant_id: "tenant-1",
    ingredient_name: "Tomate",
    quantity: "1",
    unit: "kg",
    expiration_date: "2026-10-27 00:00:00+00",
    notes: "qa",
  };
  const args = {
    ingredientName: "Tomate",
    marker: "qa",
    userId: "user-1",
    tenantId: "tenant-1",
    now: new Date("2026-10-28T16:00:00.000Z"),
  };
  assert.equal(
    selectFixtureLot({
      items: [{ ...base, user_id: "other-user" }],
      ...args,
    }).reason,
    "qa_lot_identity_or_quantity",
  );
  assert.equal(
    selectFixtureLot({
      items: [{ ...base, expiration_date: "invalid" }],
      ...args,
    }).reason,
    "qa_lot_expiration",
  );
  assert.equal(
    selectFixtureLot({ items: [base, { ...base, id: "lot-2" }], ...args })
      .reason,
    "duplicate_qa_lot",
  );
});

test("keeps the manifest recoverable after a renewal write fails", () => {
  const manifest = createManifest({ userId: "user-1", tenantId: "tenant-1" });
  recordOperation(manifest, "inventory:Tomate", "started", {
    recordId: "lot-1",
    operation: "renew",
    previousStatus: "expired",
  });
  recordOperation(manifest, "inventory:Tomate", "failed", {
    code: "FIXTURE_WRITE_NO_GO",
    previousExpiration: "2026-10-27 00:00:00+00",
  });
  markManifest(manifest, "failed");
  assert.equal(manifest.status, "failed");
  assert.equal(manifest.operations[0].operation, "renew");
  assert.equal(manifest.operations[0].previousStatus, "expired");
  assert.equal(manifest.operations[0].code, "FIXTURE_WRITE_NO_GO");
});
