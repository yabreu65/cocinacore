import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const PROD_017_RELEASE = Object.freeze({
  sha: "d4a13a61cc0d24c4eda96a7baffaacfd0e47c191",
  parent: "ad99d502ff19d7bb154c04c24697d2a43c1b17e8",
  ciRunId: 42310527377,
  issueNumber: 92,
  pullRequestNumber: 93,
  repository: "yabreu65/cocinacore",
  pullRequestHead: "fix/security-prod-017-20261106",
  pullRequestBase: "release/prod-017-security-base",
  migrationCount: 17,
  latestMigrationId: "017",
  latestMigrationFile: "017_persistent_recipe_archive.sql",
  changes: Object.freeze([
    "frontend/e2e/specs/pdfjs-upload-compat.spec.ts",
    "frontend/package-lock.json",
    "frontend/package.json",
    "frontend/src/app/api/meal-plan/shopping-suggestions/route.test.ts",
  ]),
});

function fail(message) {
  throw new Error(message);
}

function sameList(actual, expected) {
  return (
    actual.length === expected.length &&
    actual.every((entry, index) => entry === expected[index])
  );
}

export function validateCommitMetadata(metadata) {
  if (metadata.sha !== PROD_017_RELEASE.sha)
    fail("candidate commit SHA is not the fixed prod-017 release");
  if (!sameList(metadata.parents, [PROD_017_RELEASE.parent])) {
    fail("candidate must have exactly the fixed production-017 parent");
  }

  const expectedChanges = PROD_017_RELEASE.changes
    .map((file) => `M\t${file}`)
    .sort();
  const actualChanges = metadata.changes
    .map(({ status, path: file }) => `${status}\t${file}`)
    .sort();
  if (!sameList(actualChanges, expectedChanges)) {
    fail(
      "candidate diff does not match the exact four-file reviewed allowlist",
    );
  }

  if (metadata.releaseManifestBlob !== metadata.parentManifestBlob) {
    fail("candidate changed the migration manifest");
  }

  const migrations = metadata.manifest?.migrations;
  const latest = Array.isArray(migrations) ? migrations.at(-1) : undefined;
  if (
    !Array.isArray(migrations) ||
    migrations.length !== PROD_017_RELEASE.migrationCount ||
    latest?.id !== PROD_017_RELEASE.latestMigrationId ||
    latest?.filename !== PROD_017_RELEASE.latestMigrationFile
  ) {
    fail(
      "candidate migration manifest is not exactly the production 001-017 baseline",
    );
  }

  if (metadata.diffCheck !== true) fail("candidate diff-check failed");
  return true;
}

export function validateEnvironmentConfiguration({
  environment,
  branchPolicies,
}) {
  const rules = environment?.protection_rules;
  const reviewerRule = Array.isArray(rules)
    ? rules.find(
        (rule) =>
          rule?.type === "required_reviewers" &&
          rule.prevent_self_review === true &&
          Array.isArray(rule.reviewers) &&
          rule.reviewers.some(
            (reviewer) =>
              reviewer?.type === "User" &&
              reviewer.reviewer?.type === "User" &&
              typeof reviewer.reviewer.login === "string" &&
              reviewer.reviewer.login.length > 0 &&
              !/\[bot\]$/i.test(reviewer.reviewer.login) &&
              Number.isSafeInteger(reviewer.reviewer?.id) &&
              reviewer.reviewer.id > 0,
          ),
      )
    : undefined;

  if (environment?.name !== "production" || !reviewerRule) {
    fail(
      "production Environment lacks a required human reviewer with self-approval prevention",
    );
  }

  const deploymentBranchPolicy = environment.deployment_branch_policy;
  if (
    deploymentBranchPolicy?.protected_branches !== false ||
    deploymentBranchPolicy?.custom_branch_policies !== true
  ) {
    fail(
      "production Environment must restrict deployments to explicit branch policies",
    );
  }

  if (
    branchPolicies?.total_count !== 1 ||
    !Array.isArray(branchPolicies.branch_policies) ||
    branchPolicies.branch_policies.length !== 1 ||
    branchPolicies.branch_policies[0]?.name !== "main"
  ) {
    fail("production Environment must allow exactly the main branch");
  }

  return true;
}

export function validateEvidence({
  ciRun,
  issue,
  pullRequest,
  environment,
  branchPolicies,
}) {
  if (
    Number(ciRun?.id) !== PROD_017_RELEASE.ciRunId ||
    ciRun?.head_sha !== PROD_017_RELEASE.sha ||
    ciRun?.status !== "completed" ||
    ciRun?.conclusion !== "success" ||
    ciRun?.event !== "workflow_dispatch" ||
    ciRun?.name !== "CI" ||
    ciRun?.repository?.full_name !== PROD_017_RELEASE.repository
  ) {
    fail(
      "pinned CI run is missing, failed, or does not attest the exact candidate SHA",
    );
  }

  const issueBody = typeof issue?.body === "string" ? issue.body : "";
  const requiredRiskEvidence = [
    PROD_017_RELEASE.sha,
    PROD_017_RELEASE.parent,
    "GHSA-3g3m-2fjr-6pw4",
    "GHSA-g3hv-75wg-m249",
    "5 moderate production records",
    "0 high and 0 critical",
  ];
  if (
    Number(issue?.number) !== PROD_017_RELEASE.issueNumber ||
    issue?.state !== "open" ||
    !requiredRiskEvidence.every((value) => issueBody.includes(value))
  ) {
    fail(
      "issue #92 no longer documents the pinned release and accepted moderate advisory risk",
    );
  }

  if (
    Number(pullRequest?.number) !== PROD_017_RELEASE.pullRequestNumber ||
    pullRequest?.state !== "open" ||
    pullRequest?.draft !== true ||
    pullRequest?.head?.sha !== PROD_017_RELEASE.sha ||
    pullRequest?.head?.ref !== PROD_017_RELEASE.pullRequestHead ||
    pullRequest?.head?.repo?.full_name !== PROD_017_RELEASE.repository ||
    pullRequest?.base?.ref !== PROD_017_RELEASE.pullRequestBase ||
    pullRequest?.base?.sha !== PROD_017_RELEASE.parent ||
    pullRequest?.base?.repo?.full_name !== PROD_017_RELEASE.repository
  ) {
    fail("PR #93 no longer targets the isolated fixed candidate/base");
  }

  validateEnvironmentConfiguration({ environment, branchPolicies });

  return true;
}

function git(repo, args) {
  return execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trimEnd();
}

export function validateGitCandidate(repo = process.cwd()) {
  const sha = PROD_017_RELEASE.sha;
  const parent = PROD_017_RELEASE.parent;
  const parents = git(repo, ["rev-list", "--parents", "-n", "1", sha])
    .split(/\s+/)
    .slice(1);
  const changes = git(repo, [
    "diff-tree",
    "--no-commit-id",
    "--name-status",
    "-r",
    parent,
    sha,
  ])
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status, ...parts] = line.split("\t");
      return { status, path: parts.join("\t") };
    });
  const manifest = JSON.parse(
    git(repo, ["show", `${sha}:db/migrations/manifest.json`]),
  );
  const releaseManifestBlob = git(repo, [
    "rev-parse",
    `${sha}:db/migrations/manifest.json`,
  ]);
  const parentManifestBlob = git(repo, [
    "rev-parse",
    `${parent}:db/migrations/manifest.json`,
  ]);
  execFileSync("git", ["diff", "--check", parent, sha], {
    cwd: repo,
    stdio: "ignore",
  });

  return validateCommitMetadata({
    sha,
    parents,
    changes,
    manifest,
    releaseManifestBlob,
    parentManifestBlob,
    diffCheck: true,
  });
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === "git" && args.length === 1) {
    validateGitCandidate(path.resolve(args[0]));
    process.stdout.write("PROD_017_GIT_ADMISSION_OK\n");
    return;
  }
  if (mode === "evidence" && args.length === 5) {
    validateEvidence({
      ciRun: readJson(args[0]),
      issue: readJson(args[1]),
      pullRequest: readJson(args[2]),
      environment: readJson(args[3]),
      branchPolicies: readJson(args[4]),
    });
    process.stdout.write("PROD_017_GITHUB_EVIDENCE_OK\n");
    return;
  }
  fail(
    "usage: prod-017-hotfix-admission.mjs git <candidate-repository> | evidence <ci.json> <issue.json> <pull-request.json> <environment.json> <branch-policies.json>",
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`prod-017 admission rejected: ${error.message}\n`);
    process.exitCode = 1;
  }
}
