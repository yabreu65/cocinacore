import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { verifyIdentityProof } from "./identity.mjs";

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
    return safe("FIXTURE_NO_GO");
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
    return safe("FIXTURE_IDENTITY_NO_GO");

  const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify({ email, password }),
  });
  const cookie = loginResponse.headers.get("set-cookie")?.split(";", 1)[0];
  if (!loginResponse.ok || !cookie) return safe("FIXTURE_READ_NO_GO");

  const session = await api(baseUrl, cookie, "/api/auth/session");
  const userId = session.body?.user?.id;
  const tenantId = session.body?.user?.tenant?.tenantId;
  if (
    !session.response.ok ||
    typeof userId !== "string" ||
    typeof tenantId !== "string"
  )
    return safe("FIXTURE_READ_NO_GO");
  if (
    !verifyIdentityProof({
      userId,
      tenantId,
      nonce: proof.IDENTITY_NONCE,
      commitment: proof.IDENTITY_COMMITMENT,
    })
  )
    return safe("FIXTURE_IDENTITY_NO_GO");

  const [profile, mealPlan, inventory] = await Promise.all([
    api(baseUrl, cookie, "/api/profile"),
    api(baseUrl, cookie, "/api/meal-plan"),
    api(baseUrl, cookie, "/api/inventory"),
  ]);
  if (!profile.response.ok || !mealPlan.response.ok || !inventory.response.ok)
    return safe("FIXTURE_READ_NO_GO");

  const created = { profile: false, mealPlan: false, inventory: [] };
  if (!profile.body?.profile) {
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
    if (!updatedProfile.response.ok) return safe("FIXTURE_WRITE_NO_GO");
    created.profile = true;
  }

  let plan = mealPlan.body;
  if (!isFortnightPlan(plan)) {
    if (plan?.id) return safe("FIXTURE_NO_GO");
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
      return safe("FIXTURE_WRITE_NO_GO");
    plan = { ...generated.body, period: "fortnight" };
    created.mealPlan = true;
  }

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
  if (!schedule.response.ok) return safe("FIXTURE_WRITE_NO_GO");

  const existingNames = new Set(
    (inventory.body.items ?? []).map((item) =>
      String(item.ingredient_name ?? "")
        .trim()
        .toLowerCase(),
    ),
  );
  const names = ingredientNames(plan.plan)
    .slice(0, 2)
    .filter((name) => !existingNames.has(name.toLowerCase()))
    .slice(0, 2);
  const expiryOffsets = [2, 21];
  for (let index = 0; index < names.length; index += 1) {
    const createdItem = await api(baseUrl, cookie, "/api/inventory", {
      method: "POST",
      body: JSON.stringify({
        ingredientName: names[index],
        quantity: "1",
        unit: "kg",
        expirationDate: isoDate(expiryOffsets[index]),
        notes: QA_MARKER,
      }),
    });
    if (!createdItem.response.ok || !createdItem.body?.item?.id)
      return safe("FIXTURE_WRITE_NO_GO");
    created.inventory.push(createdItem.body.item.id);
  }

  await mkdir(dirname(manifestPath), { recursive: true });
  const manifest = {
    version: 1,
    issue: 84,
    userId,
    tenantId,
    createdAt: new Date().toISOString(),
    marker: QA_MARKER,
    created,
    cleanup: { inventoryDeleteAllowed: true, mealPlanDeleteSupported: false },
    retention: "reuse-only; do not create a second plan",
  };
  const serialized = JSON.stringify(manifest, null, 2);
  await writeFile(manifestPath, serialized, { encoding: "utf8", mode: 0o600 });
  await chmod(manifestPath, 0o600);
  console.log(
    `FIXTURE_MANIFEST_SHA256=${createHash("sha256").update(serialized).digest("hex")}`,
  );
  safe("FIXTURE_PASS");
}

main().catch(() => {
  safe("FIXTURE_NO_GO");
  process.exitCode = 1;
});
