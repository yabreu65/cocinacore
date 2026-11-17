#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const PROTECTED_BASE = "915d395aab4da8a3888d66292caa6ad259d84b9c";
const EXPECTED_020_SHA256 =
  "1fbadb829792902ef19bdb0abd2c20e39409360986c9844d9cab3105df6eb33a";
const EXPECTED_020_BYTES = 130680;
const EXPECTED_020_ENTRY = {
  id: "020",
  filename: "020_tenant_rls_hardening.sql",
  lane: "migration",
  sha256: EXPECTED_020_SHA256,
  byteLength: EXPECTED_020_BYTES,
  transactional: "required",
  legacyChecksumBackfillAllowed: false,
  catalogAdditions: [],
};
const REQUIRED_FILES = [
  "frontend/src/lib/db.ts",
  "frontend/src/lib/auth/session.ts",
  "frontend/src/app/api/auth/signup/route.ts",
  "frontend/src/app/api/auth/login/route.ts",
  "frontend/src/app/api/auth/password-reset/request/route.ts",
  "frontend/src/app/api/auth/password-reset/update/route.ts",
  "frontend/src/lib/db/repositories/signupBootstrapRepository.ts",
  "frontend/src/lib/owner/metrics.ts",
  "frontend/src/lib/owner/global-writer.ts",
  "frontend/src/lib/recipes/server-rag-context.ts",
  "frontend/src/lib/db/repositories/bookChunkRepository.ts",
  "frontend/src/app/api/owner/global-pdfs/route.ts",
  "scripts/provision-020-inert-capabilities.sql",
  "scripts/provision-signup-bootstrap-roles.sql",
  "scripts/provision-runtime-role.sql",
  "scripts/provision-auth-role.sql",
  "scripts/provision-owner-metrics-role.sql",
  "scripts/provision-global-writer-role.sql",
  "frontend/scripts/activate-020-capabilities.js",
  "frontend/scripts/prepared-capabilities-attestation.js",
  "frontend/scripts/prepared-capabilities-attestation.sql",
  "frontend/scripts/activated-capabilities-attestation.js",
  "frontend/scripts/activated-capabilities-attestation.sql",
  "scripts/test-020e-b-recovery.sh",
  "docs/ops/rls-020e-b-recovery-runbook.md",
  "docs/ops/rls-020e-c-release-readiness.md",
];
const FIRST_ADMIN_REQUIRED_FILES = [
  "frontend/scripts/activated-capabilities-024-first-admin.sql",
  "frontend/scripts/activated-capabilities-024-inventory.sql",
  "frontend/scripts/bootstrap-first-platform-admin.js",
  "scripts/provision-first-platform-admin-roles.sql",
  "scripts/test-first-platform-admin-bootstrap.sh",
];
const LEGACY_016_017_FILES = [
  "scripts/migrate-pawtech-production.sh",
  ".github/workflows/migrate-production.yml",
];

function fail(message) {
  console.error(`NO-GO: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {
    root: REPO_ROOT,
    releaseSha: undefined,
    approvalReference: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--help") {
      console.log(
        "Usage: node scripts/check-020-release-candidate.mjs [--root DIR] [--release-sha SHA --owner-approval-reference REF]",
      );
      process.exit(0);
    }
    if (
      !["--root", "--release-sha", "--owner-approval-reference"].includes(
        option,
      )
    )
      fail("unknown option");
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`missing value for ${option}`);
    index += 1;
    if (option === "--root") args.root = path.resolve(value);
    if (option === "--release-sha") args.releaseSha = value;
    if (option === "--owner-approval-reference") args.approvalReference = value;
  }
  if (args.releaseSha && !args.approvalReference)
    fail(
      "release SHA mode requires a distinct M6-020 owner approval reference",
    );
  if (!args.releaseSha && args.approvalReference)
    fail("owner approval reference is only valid with release SHA mode");
  if (args.releaseSha && !/^[0-9a-f]{40}$/.test(args.releaseSha))
    fail("release SHA must be a full 40-character lowercase commit SHA");
  if (args.approvalReference && /^U5(?:-|$)/i.test(args.approvalReference))
    fail("the legacy U5 approval reference is not approval for M6 020");
  if (args.approvalReference && !args.approvalReference.trim())
    fail("M6-020 owner approval reference must not be empty");
  if (args.approvalReference) {
    const approval =
      /^M6-020:([0-9a-f]{40}):([A-Za-z0-9][A-Za-z0-9._/-]*)$/i.exec(
        args.approvalReference,
      );
    if (!approval)
      fail(
        "owner approval reference must use M6-020:<release-sha>:<record-id>",
      );
    if (approval[1].toLowerCase() !== args.releaseSha)
      fail("owner approval reference must bind to the exact release SHA");
  }
  if (args.releaseSha && args.root !== REPO_ROOT)
    fail("--root cannot be combined with release SHA mode");
  return args;
}

function git(args, options = {}) {
  try {
    return execFileSync("git", args, { cwd: REPO_ROOT, ...options });
  } catch {
    fail("required local Git object or ref is unavailable");
  }
}

function readCandidate(relativePath, candidateRoot, releaseSha) {
  if (releaseSha) return git(["show", `${releaseSha}:${relativePath}`]);
  try {
    return readFileSync(path.join(candidateRoot, relativePath));
  } catch {
    fail(`required candidate file is missing: ${relativePath}`);
  }
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function parseJson(buffer, name) {
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch {
    fail(`${name} is not valid JSON`);
  }
}

function checkIntegratedRelease(releaseSha) {
  if (!git(["cat-file", "-e", `${releaseSha}^{commit}`], { stdio: "ignore" }))
    return;
  try {
    execFileSync(
      "git",
      ["merge-base", "--is-ancestor", releaseSha, "refs/remotes/origin/main"],
      {
        cwd: REPO_ROOT,
        stdio: "ignore",
      },
    );
  } catch {
    fail(
      "release SHA is not integrated into the locally available origin/main ref",
    );
  }
}

function checkCandidate({ candidateRoot, releaseSha }) {
  const migrationPath = "db/migrations/020_tenant_rls_hardening.sql";
  const migration = readCandidate(migrationPath, candidateRoot, releaseSha);
  if (
    migration.length !== EXPECTED_020_BYTES ||
    sha256(migration) !== EXPECTED_020_SHA256
  )
    fail(
      "canonical migration 020 checksum or byte length differs from the reviewed contract",
    );
  console.log("PASS canonical migration 020 checksum and byte length");

  const manifest = parseJson(
    readCandidate("db/migrations/manifest.json", candidateRoot, releaseSha),
    "migration manifest",
  );
  if (!Array.isArray(manifest.migrations))
    fail("manifest migration list is missing");
  const expectedIds = Array.from({ length: 20 }, (_, index) =>
    String(index + 1).padStart(3, "0"),
  );
  const entries = manifest.migrations;
  // A historical release approval is still bound to exactly 001–020.
  // Working-tree CI may validate exact successor artifacts through 024; this
  // does not authorize a release or change the original 020 artifact checks.
  const successor = !releaseSha && [21, 22, 23, 24].includes(entries.length);
  const occurrenceSuccessor = !releaseSha && [22, 23, 24].includes(entries.length);
  const retentionSuccessor = !releaseSha && [23, 24].includes(entries.length);
  const firstAdminSuccessor = !releaseSha && entries.length === 24;
  if (
    entries.length !== (firstAdminSuccessor ? 24 : retentionSuccessor ? 23 : occurrenceSuccessor ? 22 : successor ? 21 : expectedIds.length) ||
    entries.slice(0, 20).some((entry, index) => entry.id !== expectedIds[index])
  )
    fail("manifest migration sequence must contain the exact 001 through 020 prefix");
  if (successor) {
    const entry = entries[20];
    const relativePath = "db/migrations/021_inventory_price_reference.sql";
    const file = readCandidate(relativePath, candidateRoot, releaseSha);
    if (entry.id !== "021" || entry.filename !== "021_inventory_price_reference.sql" ||
        entry.lane !== "migration" || entry.transactional !== "required" ||
        entry.legacyChecksumBackfillAllowed !== false || entry.byteLength !== file.length ||
        entry.sha256 !== "90f3f0c401f8383c1d073d6717fce46b1bf8cc4347216097c3c5ab653f904a19" ||
        sha256(file) !== entry.sha256 ||
        JSON.stringify(entry.catalogAdditions) !== JSON.stringify([
          {kind: "constraint", schema: "public", identity: "tenants.tenants_currency_code_check"},
          {kind: "constraint", schema: "public", identity: "recipe_inventory_items.recipe_inventory_price_reference_check"}
        ]))
      fail("unreviewed migration 021 successor");
    console.log("PASS reviewed 021 successor present in working-tree artifact check only");
  }

  if (occurrenceSuccessor) {
    const entry = entries[21];
    const file = readCandidate("db/migrations/022_real_consumption_occurrences.sql", candidateRoot, releaseSha);
    const expected = {"id": "022", "filename": "022_real_consumption_occurrences.sql", "lane": "migration", "sha256": "371ad525d4081e801da81e9802a44af745b0091931be061af818f6ceabe073e3", "byteLength": 710, "transactional": "required", "legacyChecksumBackfillAllowed": false, "catalogAdditions": [{"kind": "constraint", "schema": "public", "identity": "real_consumption_items.real_consumption_items_ingredient_index_check"}, {"kind": "constraint", "schema": "public", "identity": "real_consumption_items.real_consumption_items_occurrence_key"}, {"kind": "index", "schema": "public", "identity": "real_consumption_items.real_consumption_items_occurrence_key"}]};
    if (JSON.stringify(entry) !== JSON.stringify(expected) || file.length !== expected.byteLength || sha256(file) !== expected.sha256)
      fail("unreviewed migration 022 successor");
    console.log("PASS exact 022 successor in working-tree artifact check only");
  }

  if (retentionSuccessor) {
    const entry = entries[22];
    const file = readCandidate("db/migrations/023_inventory_movement_retention.sql", candidateRoot, releaseSha);
    const expected = {"id": "023", "filename": "023_inventory_movement_retention.sql", "lane": "migration", "sha256": "553a90822a22f0d46b1fdfa5bd9c97cf8129c9125c477c4af5fc0654497bebba", "byteLength": 1835, "transactional": "required", "legacyChecksumBackfillAllowed": false, "catalogAdditions": []};
    if (JSON.stringify(entry) !== JSON.stringify(expected) || file.length !== expected.byteLength || sha256(file) !== expected.sha256)
      fail("unreviewed migration 023 successor");
    console.log("PASS exact 023 successor in working-tree artifact check only");
  }

  if (firstAdminSuccessor) {
    const entry = entries[23];
    const file = readCandidate("db/migrations/024_first_platform_admin_bootstrap.sql", candidateRoot, releaseSha);
    const expected = {
      id: "024",
      filename: "024_first_platform_admin_bootstrap.sql",
      lane: "migration",
      sha256: "2a43c9ea728735865073a25185a6ed724dfb1a4444eb9e5f39200b4e67d79944",
      byteLength: 10338,
      transactional: "required",
      legacyChecksumBackfillAllowed: false,
      catalogAdditions: [
        { kind: "table", schema: "public", identity: "public.first_platform_admin_bootstrap_claim" },
        { kind: "index", schema: "public", identity: "first_platform_admin_bootstrap_claim.first_platform_admin_bootstrap_claim_pkey" },
        { kind: "constraint", schema: "public", identity: "first_platform_admin_bootstrap_claim.first_platform_admin_bootstrap_claim_pkey" },
        { kind: "constraint", schema: "public", identity: "first_platform_admin_bootstrap_claim.first_platform_admin_bootstrap_claim_singleton_check" },
        { kind: "constraint", schema: "public", identity: "first_platform_admin_bootstrap_claim.first_platform_admin_bootstrap_claim_email_check" },
        { kind: "constraint", schema: "public", identity: "first_platform_admin_bootstrap_claim.first_platform_admin_bootstrap_claim_approval_reference_check" },
        { kind: "function", schema: "public", identity: "public.provision_first_platform_administrator" },
      ],
    };
    if (JSON.stringify(entry) !== JSON.stringify(expected) || file.length !== expected.byteLength || sha256(file) !== expected.sha256)
      fail("unreviewed migration 024 successor");
    console.log("PASS exact 024 successor in working-tree artifact check only");
  }

  for (const id of expectedIds.slice(0, 19)) {
    const entry = entries.find((candidate) => candidate.id === id);
    if (!entry || typeof entry.filename !== "string")
      fail(`manifest entry ${id} is missing`);
    const relativePath = `db/migrations/${entry.filename}`;
    const file = readCandidate(relativePath, candidateRoot, releaseSha);
    if (sha256(file) !== entry.sha256 || file.length !== entry.byteLength)
      fail(`manifest checksum or byte length mismatch for migration ${id}`);
    const baseline = git(["show", `${PROTECTED_BASE}:${relativePath}`]);
    if (!baseline.equals(file))
      fail(`migration ${id} differs from protected pre-M6 baseline`);
  }
  console.log(
    "PASS migrations 001–019 retain the protected baseline bytes and manifest checksums",
  );

  const entry020 = entries[19];
  if (JSON.stringify(entry020) !== JSON.stringify(EXPECTED_020_ENTRY))
    fail(
      "manifest migration 020 entry differs from the reviewed fixed contract",
    );
  console.log("PASS exact migration 020 manifest entry and sequence");

  for (const relativePath of LEGACY_016_017_FILES) {
    const candidate = readCandidate(relativePath, candidateRoot, releaseSha);
    const baseline = git(["show", `${PROTECTED_BASE}:${relativePath}`]);
    // The historical release gate is unchanged. The 022 working-tree
    // candidate alone needs an exact, bounded M5 script successor to avoid
    // executing or verifying 020+ under the old 018/019 approval.
    if (occurrenceSuccessor && relativePath === "scripts/migrate-pawtech-production.sh") {
      if (sha256(baseline) !== "c5043b278998214b966a63c3933256b65a64d724f6c8a982107763bbf8382363" ||
          sha256(candidate) !== "fba81447d8328b70bb84b8c58f1b89fb8dd20906bf74ee1051dbcdfe9593262b")
        fail("unrecognized bounded M5 migration script successor");
      console.log("PASS exact M5 script successor; approval remains limited to 018/019");
      continue;
    }
    if (!candidate.equals(baseline))
      fail(
        `historical 016/017 migration mechanism must remain unchanged: ${relativePath}`,
      );
  }
  console.log("PASS historical migration workflow and release-mode artifacts remain pinned");

  const requiredFiles = firstAdminSuccessor
    ? [...REQUIRED_FILES, ...FIRST_ADMIN_REQUIRED_FILES]
    : REQUIRED_FILES;
  for (const relativePath of requiredFiles) {
    const file = readCandidate(relativePath, candidateRoot, releaseSha);
    if (file.length === 0)
      fail(`required release asset is empty: ${relativePath}`);
  }
  console.log(
    "PASS required application, capability, and recovery assets are present",
  );
}

const args = parseArgs(process.argv.slice(2));
if (args.releaseSha) checkIntegratedRelease(args.releaseSha);

if (!args.releaseSha) {
  for (const requiredPath of [
    "db/migrations/020_tenant_rls_hardening.sql",
    "db/migrations/manifest.json",
  ]) {
    try {
      if (!statSync(path.join(args.root, requiredPath)).isFile())
        fail(`candidate path is not a file: ${requiredPath}`);
    } catch {
      fail(`candidate file is missing: ${requiredPath}`);
    }
  }
}

checkCandidate({ candidateRoot: args.root, releaseSha: args.releaseSha });
if (args.releaseSha)
  console.log(
    `PASS integrated release SHA ${args.releaseSha} (approval reference recorded separately)`,
  );
console.log(
  "READ-ONLY: this check does not approve, provision, migrate, activate, deploy, or reopen signup",
);
