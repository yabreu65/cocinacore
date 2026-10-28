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
import { validateProductionOrigin } from "./production-origin.mjs";

const QA_MARKER = "m4-acceptance-fixture-issue-84";
const SAFE_CODES = new Set([
  "FIXTURE_PASS",
  "FIXTURE_NO_GO",
  "FIXTURE_READ_NO_GO",
  "FIXTURE_WRITE_NO_GO",
  "FIXTURE_IDENTITY_NO_GO",
  "FIXTURE_PARTIAL",
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
  try {
    if (activeManifest) {
      markManifest(
        activeManifest,
        code === "FIXTURE_PARTIAL" ? "partial" : "failed",
      );
      await persistManifest();
    }
  } catch {
    // Keep the public result safe even if private recovery persistence fails.
  }
  safe(code);
  process.exitCode = 1;
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

function fixtureEvidence({ coverage, waste, proposal, shopping }) {
  const coverageReady = coverage.every(
    (result) =>
      result.response.ok &&
      result.body?.forecast?.status === "ready" &&
      (result.body?.forecast?.horizonDays === 7 ||
        result.body?.forecast?.horizonDays === 14) &&
      result.body.forecast.scheduledMealCount > 0 &&
      Array.isArray(result.body.forecast.items) &&
      result.body.forecast.items.every((item) => item.status !== "unknown"),
  );
  const wasteReady =
    waste.response.ok &&
    waste.body?.report?.status === "ready" &&
    Array.isArray(waste.body.report.lots) &&
    waste.body.report.lots.some(
      (lot) =>
        typeof lot.expirationDate === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(lot.expirationDate),
    );
  const proposalReady =
    proposal.response.ok &&
    typeof proposal.body?.mealPlanId === "string" &&
    typeof proposal.body?.expectedUpdatedAt === "string" &&
    typeof proposal.body?.sourceFingerprint === "string" &&
    Array.isArray(proposal.body?.proposal?.changes) &&
    isRecord(proposal.body?.proposal?.plan) &&
    Array.isArray(proposal.body?.proposal?.limitations);
  const shoppingReady = shopping.every(
    (result) =>
      result.response.ok &&
      result.body?.status === "ready" &&
      (result.body?.horizonDays === 7 || result.body?.horizonDays === 14) &&
      result.body.scheduledMealCount > 0 &&
      result.body?.cost?.status !== "unknown" &&
      Array.isArray(result.body?.items) &&
      result.body.items.every(
        (item) =>
          typeof item.ingredientName === "string" &&
          typeof item.normalizedName === "string" &&
          (item.quantityToBuy === null ||
            (typeof item.quantityToBuy === "number" &&
              Number.isFinite(item.quantityToBuy))),
      ),
  );
  return { coverageReady, wasteReady, proposalReady, shoppingReady };
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

const UNIT_ALIASES = new Map([
  ["u", "unidad"],
  ["und", "unidad"],
  ["unidad", "unidad"],
  ["unidades", "unidad"],
  ["g", "g"],
  ["gr", "g"],
  ["gramo", "g"],
  ["gramos", "g"],
  ["kg", "kg"],
  ["kilo", "kg"],
  ["kilos", "kg"],
  ["kilogramo", "kg"],
  ["kilogramos", "kg"],
  ["ml", "ml"],
  ["mililitro", "ml"],
  ["mililitros", "ml"],
  ["l", "l"],
  ["litro", "l"],
  ["litros", "l"],
  ["paquete", "paquete"],
  ["paquetes", "paquete"],
  ["cda", "cucharada"],
  ["cucharada", "cucharada"],
  ["cucharadas", "cucharada"],
  ["cdta", "cucharadita"],
  ["cucharadita", "cucharadita"],
  ["cucharaditas", "cucharadita"],
  ["taza", "taza"],
  ["tazas", "taza"],
]);

function ingredientRequirements(plan) {
  const requirements = new Map();
  for (const day of plan.days) {
    for (const meal of day.meals) {
      for (const ingredient of meal.ingredients) {
        const name =
          typeof ingredient.name === "string" ? ingredient.name.trim() : "";
        const rawUnit =
          typeof ingredient.unit === "string"
            ? ingredient.unit.trim().toLocaleLowerCase()
            : "";
        const unit = UNIT_ALIASES.get(rawUnit);
        const quantity = ingredient.quantity;
        if (
          name &&
          typeof quantity === "number" &&
          Number.isFinite(quantity) &&
          quantity > 0 &&
          unit
        ) {
          requirements.set(name.toLocaleLowerCase(), { quantity, unit });
        }
      }
    }
  }
  return requirements;
}

function isoDate(daysFromNow) {
  const date = new Date(Date.now() + daysFromNow * 86_400_000);
  return date.toISOString().slice(0, 10);
}

async function main() {
  let baseUrl;
  try {
    baseUrl = validateProductionOrigin(process.env.E2E_PRODUCTION_URL);
  } catch {
    return fail("FIXTURE_NO_GO");
  }
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
  const requirements = ingredientRequirements(plan.plan);
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
    const requirement = requirements.get(candidate.name.toLocaleLowerCase());
    if (!requirement) return fail("FIXTURE_PARTIAL");
    const createdItem = await api(baseUrl, cookie, "/api/inventory", {
      method: "POST",
      body: JSON.stringify({
        ingredientName: candidate.name,
        quantity: String(requirement.quantity),
        unit: requirement.unit,
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

  const evidence = await Promise.all([
    Promise.all(
      [7, 14].map((horizonDays) =>
        api(
          baseUrl,
          cookie,
          `/api/meal-plan/coverage?horizonDays=${horizonDays}`,
        ),
      ),
    ),
    api(baseUrl, cookie, "/api/waste-prevention"),
    api(baseUrl, cookie, "/api/meal-plan/adaptive-proposal", {
      method: "POST",
      body: JSON.stringify({ mealPlanId: plan.id }),
    }),
    Promise.all(
      [7, 14].map((horizonDays) =>
        api(
          baseUrl,
          cookie,
          `/api/meal-plan/shopping-suggestions?mealPlanId=${encodeURIComponent(plan.id)}&horizon=${horizonDays}`,
        ),
      ),
    ),
  ]);
  const evidenceStatus = fixtureEvidence({
    coverage: evidence[0],
    waste: evidence[1],
    proposal: evidence[2],
    shopping: evidence[3],
  });
  if (Object.values(evidenceStatus).some((value) => !value)) {
    return fail("FIXTURE_PARTIAL");
  }

  markManifest(activeManifest, "completed");
  await persistManifest();
  const serialized = JSON.stringify(activeManifest, null, 2);
  console.log(
    `FIXTURE_MANIFEST_SHA256=${createHash("sha256").update(serialized).digest("hex")}`,
  );
  safe("FIXTURE_PASS");
}

if (import.meta.url === `file://${process.argv[1]}`)
  main().catch(async () => {
    await fail("FIXTURE_NO_GO");
  });

export { fixtureEvidence };
