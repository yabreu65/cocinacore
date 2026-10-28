import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import {
  createManifest,
  markManifest,
  recordOperation,
  stableInventoryCandidates,
  verifyPreparationIdentity,
} from "./fixture-manifest.mjs";

const QA_MARKER = "m4-acceptance-fixture-issue-84";
const SAFE_CODES = new Set([
  "FIXTURE_PASS",
  "FIXTURE_NO_GO",
  "FIXTURE_READ_NO_GO",
  "FIXTURE_WRITE_NO_GO",
  "FIXTURE_IDENTITY_NO_GO",
]);

function safe(code) {
  if (!SAFE_CODES.has(code)) throw new Error("unsafe fixture code");
  console.log(code);
}

let activeManifest = null;
let activeManifestPath = null;

async function persistManifest() {
  if (!activeManifest || !activeManifestPath) return;
  const serialized = JSON.stringify(activeManifest, null, 2);
  await writeFile(activeManifestPath, serialized, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(activeManifestPath, 0o600);
}

async function fail(code) {
  if (activeManifest) {
    markManifest(activeManifest, "failed");
    await persistManifest();
  }
  safe(code);
}

async function api(baseUrl, cookie, path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      cookie,
      "content-type": "application/json",
    },
  });
  const body = await response.json().catch(() => null);
  return { response, body };
}

function isFortnightPlan(body) {
  return (
    body?.id && body?.period === "fortnight" && body?.plan?.days?.length === 14
  );
}

function ingredientNames(plan) {
  return [
    ...new Set(
      plan.days
        .flatMap((day) =>
          day.meals.flatMap((meal) =>
            meal.ingredients.map((ingredient) =>
              typeof ingredient.name === "string" ? ingredient.name.trim() : "",
            ),
          ),
        )
        .filter(Boolean),
    ),
  ];
}

function isoDate(daysFromNow) {
  const date = new Date(Date.now() + daysFromNow * 86_400_000);
  return date.toISOString().slice(0, 10);
}

async function main() {
  const baseUrl = process.env.E2E_PRODUCTION_URL?.replace(/\/$/, "");
  const email = process.env.E2E_PRODUCTION_USER_EMAIL;
  const password = process.env.E2E_PRODUCTION_USER_PASSWORD;
  const manifestPath = process.env.M4_FIXTURE_MANIFEST_PATH;
  const proofPath = process.env.M4_IDENTITY_PROOF_PATH;
  if (!baseUrl || !email || !password || !manifestPath || !proofPath)
    return fail("FIXTURE_NO_GO");
  const proofText = await readFile(proofPath, "utf8").catch(() => null);
  const proof = proofText
    ? Object.fromEntries(
        proofText
          .trim()
          .split("\n")
          .map((line) => line.split("=", 2)),
      )
    : null;
  if (!proof?.IDENTITY_NONCE || !proof.IDENTITY_COMMITMENT)
    return fail("FIXTURE_IDENTITY_NO_GO");

  const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify({ email, password }),
  });
  const cookie = loginResponse.headers.get("set-cookie")?.split(";", 1)[0];
  if (!loginResponse.ok || !cookie) return fail("FIXTURE_READ_NO_GO");

  const session = await api(baseUrl, cookie, "/api/auth/session");
  const userId = session.body?.user?.id;
  const tenantId = session.body?.user?.tenant?.tenantId;
  if (
    !session.response.ok ||
    typeof userId !== "string" ||
    typeof tenantId !== "string"
  )
    return fail("FIXTURE_READ_NO_GO");
  if (
    !verifyPreparationIdentity({
      userId,
      tenantId,
      nonce: proof.IDENTITY_NONCE,
      commitment: proof.IDENTITY_COMMITMENT,
    })
  )
    return fail("FIXTURE_IDENTITY_NO_GO");

  activeManifestPath = manifestPath;
  await mkdir(dirname(manifestPath), { recursive: true });
  activeManifest = createManifest({ userId, tenantId });
  await persistManifest();

  recordOperation(activeManifest, "baseline-read", "started");
  await persistManifest();
  const [profile, mealPlan, inventory] = await Promise.all([
    api(baseUrl, cookie, "/api/profile"),
    api(baseUrl, cookie, "/api/meal-plan"),
    api(baseUrl, cookie, "/api/inventory"),
  ]);
  if (!profile.response.ok || !mealPlan.response.ok || !inventory.response.ok)
    return fail("FIXTURE_READ_NO_GO");
  recordOperation(activeManifest, "baseline-read", "completed");
  await persistManifest();

  if (!profile.body?.profile) {
    recordOperation(activeManifest, "profile", "started");
    await persistManifest();
    const updatedProfile = await api(baseUrl, cookie, "/api/profile", {
      method: "PUT",
      body: JSON.stringify({
        level: "Principiante",
        availableTimeMinutes: 30,
        allergies: [],
        dislikedIngredients: [],
        householdMembers: [],
      }),
    });
    if (!updatedProfile.response.ok) return fail("FIXTURE_WRITE_NO_GO");
    activeManifest.created.profile = true;
    recordOperation(activeManifest, "profile", "completed", { changed: true });
    await persistManifest();
  } else {
    recordOperation(activeManifest, "profile", "reused");
    await persistManifest();
  }

  let plan = mealPlan.body;
  if (!isFortnightPlan(plan)) {
    if (plan?.id) return fail("FIXTURE_NO_GO");
    recordOperation(activeManifest, "meal-plan", "started");
    await persistManifest();
    const generated = await api(baseUrl, cookie, "/api/meal-plan", {
      method: "POST",
      body: JSON.stringify({
        period: "fortnight",
        mode: "balanced_ai",
        peopleCount: 2,
        baseCuisine: "Latinoamericana",
        fusionIntensity: "sutil",
        restrictions: [],
      }),
    });
    if (
      !generated.response.ok ||
      !generated.body?.id ||
      generated.body?.plan?.days?.length !== 14
    )
      return fail("FIXTURE_WRITE_NO_GO");
    plan = { ...generated.body, period: "fortnight" };
    activeManifest.created.mealPlan = true;
    recordOperation(activeManifest, "meal-plan", "completed", {
      recordId: plan.id,
    });
    await persistManifest();
  } else {
    recordOperation(activeManifest, "meal-plan", "reused", {
      recordId: plan.id,
    });
    await persistManifest();
  }

  recordOperation(activeManifest, "schedule", "started", { recordId: plan.id });
  await persistManifest();
  const schedule = await api(baseUrl, cookie, "/api/meal-plan/schedule", {
    method: "POST",
    body: JSON.stringify({
      mealPlanId: plan.id,
      startDate: isoDate(0),
      timeZone: "America/Caracas",
      confirmed: true,
      portionBasisConfirmed: true,
    }),
  });
  if (!schedule.response.ok) return fail("FIXTURE_WRITE_NO_GO");
  recordOperation(activeManifest, "schedule", "completed", {
    recordId: plan.id,
  });
  await persistManifest();

  const candidates = stableInventoryCandidates(
    ingredientNames(plan.plan),
    inventory.body.items ?? [],
  );
  const expiryOffsets = [2, 21];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const operationName = `inventory:${candidate.name}`;
    recordOperation(activeManifest, operationName, "started");
    await persistManifest();
    if (!candidate.shouldCreate) {
      recordOperation(activeManifest, operationName, "reused", {
        recordId: candidate.existing?.id,
      });
      await persistManifest();
      continue;
    }
    const createdItem = await api(baseUrl, cookie, "/api/inventory", {
      method: "POST",
      body: JSON.stringify({
        ingredientName: candidate.name,
        quantity: "1",
        unit: "kg",
        expirationDate: isoDate(expiryOffsets[index]),
        notes: QA_MARKER,
      }),
    });
    if (!createdItem.response.ok || !createdItem.body?.item?.id)
      return fail("FIXTURE_WRITE_NO_GO");
    activeManifest.created.inventory.push(createdItem.body.item.id);
    recordOperation(activeManifest, operationName, "completed", {
      recordId: createdItem.body.item.id,
    });
    await persistManifest();
  }

  markManifest(activeManifest, "completed");
  await persistManifest();
  const serialized = JSON.stringify(activeManifest, null, 2);
  console.log(
    `FIXTURE_MANIFEST_SHA256=${createHash("sha256").update(serialized).digest("hex")}`,
  );
  safe("FIXTURE_PASS");
}

main().catch(async () => {
  await fail("FIXTURE_NO_GO");
  process.exitCode = 1;
});
