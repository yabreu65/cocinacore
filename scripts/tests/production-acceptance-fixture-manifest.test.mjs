import assert from "node:assert/strict";
import test from "node:test";
import { createIdentityProof } from "../production-acceptance/identity.mjs";
import {
  createManifest,
  markManifest,
  recordOperation,
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
