import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { fixtureEvidence } from "../production-acceptance/prepare-fixture.mjs";
import {
  PRODUCTION_ORIGIN,
  validateProductionOrigin,
} from "../production-acceptance/production-origin.mjs";

const execFileAsync = promisify(execFile);

function response(body, ok = true) {
  return { response: { ok }, body };
}

test("production origin accepts only the configured HTTPS origin", () => {
  assert.equal(validateProductionOrigin(PRODUCTION_ORIGIN), PRODUCTION_ORIGIN);
  assert.equal(
    validateProductionOrigin(`${PRODUCTION_ORIGIN}/`),
    PRODUCTION_ORIGIN,
  );
  for (const value of [
    "http://cocinacore.31-220-98-21.sslip.io",
    "https://other.example",
    `${PRODUCTION_ORIGIN}/other-path`,
  ]) {
    assert.throws(
      () => validateProductionOrigin(value),
      /authorized production origin/,
    );
  }
});

test("fixture evidence requires real, bounded evidence for every module", () => {
  const base = {
    coverage: [
      response({
        forecast: {
          status: "ready",
          horizonDays: 7,
          scheduledMealCount: 1,
          items: [{ status: "sufficient" }],
        },
      }),
      response({
        forecast: {
          status: "ready",
          horizonDays: 14,
          scheduledMealCount: 1,
          items: [{ status: "partial" }],
        },
      }),
    ],
    waste: response({
      report: { status: "ready", lots: [{ expirationDate: "2026-10-30" }] },
    }),
    proposal: response({
      mealPlanId: "plan",
      expectedUpdatedAt: "updated",
      sourceFingerprint: "fingerprint",
      proposal: { plan: {}, changes: [], limitations: [] },
    }),
    shopping: [
      response({
        status: "ready",
        horizonDays: 7,
        scheduledMealCount: 1,
        cost: { status: "complete" },
        items: [],
      }),
      response({
        status: "ready",
        horizonDays: 14,
        scheduledMealCount: 1,
        cost: { status: "partial" },
        items: [],
      }),
    ],
  };
  assert.deepEqual(fixtureEvidence(base), {
    coverageReady: true,
    wasteReady: true,
    proposalReady: true,
    shoppingReady: true,
  });

  const partial = structuredClone(base);
  partial.coverage[1].body.forecast.items[0].status = "unknown";
  assert.equal(fixtureEvidence(partial).coverageReady, false);
});

test("missing configuration fails the fixture process instead of reporting success", async () => {
  await assert.rejects(
    execFileAsync(
      process.execPath,
      ["scripts/production-acceptance/prepare-fixture.mjs"],
      {
        cwd: new URL("../..", import.meta.url),
        env: { PATH: process.env.PATH },
      },
    ),
    (error) => error.code === 1 && error.stdout.includes("FIXTURE_NO_GO"),
  );
});
