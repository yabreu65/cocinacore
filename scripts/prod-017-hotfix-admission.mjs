import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
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

export const PROD_017_MANUAL_AUTHORIZATION = Object.freeze({
  ownerLogin: "yabreu65",
  commentMarker: "COCINACORE-PROD-017-MANUAL-AUTHORIZATION-V1",
  attemptPattern: /^manual-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{16}$/,
  maxWindowMs: 2 * 60 * 60 * 1000,
  acceptedRisks: Object.freeze([
    "GHSA-3g3m-2fjr-6pw4",
    "GHSA-g3hv-75wg-m249",
    "5 moderate production records; 0 high and 0 critical",
  ]),
  rollbackConditions:
    "Application-only rollback using the same attempt ID; no PostgreSQL restore; no migrations.",
  fields: Object.freeze([
    "accepted_risks",
    "attempt_id",
    "authorized_by",
    "baseline_sha",
    "candidate_sha",
    "expires_at",
    "issue_number",
    "rollback_conditions",
    "schema_version",
    "valid_from",
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

function validateCiIssueAndPullRequest({ ciRun, issue, pullRequest }) {
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

  return true;
}

export function validateRepositoryOwner(repository) {
  const [, expectedName] = PROD_017_RELEASE.repository.split("/");
  const owner = repository?.owner;
  if (
    repository?.full_name !== PROD_017_RELEASE.repository ||
    repository?.name !== expectedName ||
    owner?.login !== PROD_017_MANUAL_AUTHORIZATION.ownerLogin ||
    owner?.type !== "User" ||
    !Number.isSafeInteger(owner?.id) ||
    owner.id <= 0
  ) {
    fail(
      "GitHub repository owner identity does not match the fixed release owner",
    );
  }
  return Object.freeze({ login: owner.login, id: owner.id });
}

export function validateEvidence({
  ciRun,
  issue,
  pullRequest,
  environment,
  branchPolicies,
}) {
  validateCiIssueAndPullRequest({ ciRun, issue, pullRequest });
  validateEnvironmentConfiguration({ environment, branchPolicies });
  return true;
}

function canonicalUtc(value, field) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)
  ) {
    fail(`manual authorization ${field} must be canonical UTC`);
  }
  const parsed = Date.parse(value);
  const canonical = Number.isFinite(parsed)
    ? new Date(parsed).toISOString().replace(".000Z", "Z")
    : "";
  if (!Number.isFinite(parsed) || canonical !== value) {
    fail(`manual authorization ${field} must be canonical UTC`);
  }
  return parsed;
}

function parseManualAuthorizationBody(body) {
  if (typeof body !== "string") fail("manual authorization comment is empty");
  const prefix = `${PROD_017_MANUAL_AUTHORIZATION.commentMarker}\n`;
  if (!body.startsWith(prefix)) {
    fail("manual authorization comment marker is missing");
  }
  let record;
  try {
    record = JSON.parse(body.slice(prefix.length));
  } catch {
    fail("manual authorization record is not valid JSON");
  }
  if (
    !record ||
    Array.isArray(record) ||
    typeof record !== "object" ||
    !sameList(
      Object.keys(record).sort(),
      [...PROD_017_MANUAL_AUTHORIZATION.fields].sort(),
    )
  ) {
    fail("manual authorization record fields do not match the fixed contract");
  }
  return record;
}

export function validateManualAttemptId(attemptId) {
  if (
    typeof attemptId !== "string" ||
    !PROD_017_MANUAL_AUTHORIZATION.attemptPattern.test(attemptId)
  ) {
    fail("manual attempt ID is invalid");
  }
  return true;
}

export function validateAttemptIdForMode(mode, attemptId) {
  const ghaModes = new Set([
    "deploy",
    "preflight",
    "prod-017-hotfix-preflight",
    "prod-017-hotfix-deploy",
  ]);
  const manualModes = new Set([
    "prod-017-manual-preflight",
    "prod-017-manual-deploy",
  ]);
  if (mode === "rollback") {
    if (
      typeof attemptId !== "string" ||
      !(
        /^gha-[0-9]{1,20}-[0-9]{1,6}$/.test(attemptId) ||
        PROD_017_MANUAL_AUTHORIZATION.attemptPattern.test(attemptId)
      )
    ) {
      fail("rollback attempt ID is invalid");
    }
    return true;
  }
  if (manualModes.has(mode)) return validateManualAttemptId(attemptId);
  if (ghaModes.has(mode)) {
    if (
      typeof attemptId !== "string" ||
      !/^gha-[0-9]{1,20}-[0-9]{1,6}$/.test(attemptId)
    ) {
      fail("GitHub Actions attempt ID is invalid");
    }
    return true;
  }
  fail("unsupported attempt ID mode");
}

export function validateManualAuthorization({
  repository,
  comment,
  commentId,
  attemptId,
  now = new Date(),
}) {
  validateManualAttemptId(attemptId);
  const owner = validateRepositoryOwner(repository);
  const numericCommentId = Number(commentId);
  if (
    !Number.isSafeInteger(numericCommentId) ||
    numericCommentId <= 0 ||
    Number(comment?.id) !== numericCommentId ||
    comment?.issue_url !==
      `https://api.github.com/repos/${PROD_017_RELEASE.repository}/issues/${PROD_017_RELEASE.issueNumber}` ||
    comment?.author_association !== "OWNER" ||
    comment?.user?.type !== "User" ||
    comment?.user?.login !== owner.login ||
    !Number.isSafeInteger(comment?.user?.id) ||
    comment.user.id !== owner.id ||
    typeof comment?.created_at !== "string" ||
    comment?.updated_at !== comment.created_at
  ) {
    fail(
      "manual authorization comment identity or immutable author evidence is invalid",
    );
  }
  const commentCreatedAt = canonicalUtc(
    comment.created_at,
    "comment created_at",
  );

  const record = parseManualAuthorizationBody(comment.body);
  if (
    record.schema_version !== 1 ||
    record.candidate_sha !== PROD_017_RELEASE.sha ||
    record.baseline_sha !== PROD_017_RELEASE.parent ||
    record.issue_number !== PROD_017_RELEASE.issueNumber ||
    record.attempt_id !== attemptId ||
    record.authorized_by !== owner.login ||
    record.rollback_conditions !==
      PROD_017_MANUAL_AUTHORIZATION.rollbackConditions ||
    !Array.isArray(record.accepted_risks) ||
    !sameList(record.accepted_risks, [
      ...PROD_017_MANUAL_AUTHORIZATION.acceptedRisks,
    ])
  ) {
    fail(
      "manual authorization does not match the fixed candidate, baseline, risks, and rollback contract",
    );
  }

  const validFrom = canonicalUtc(record.valid_from, "valid_from");
  const expiresAt = canonicalUtc(record.expires_at, "expires_at");
  const attemptTimestamp = attemptId.slice(
    "manual-".length,
    "manual-".length + 16,
  );
  const attemptInstant = canonicalUtc(
    `${attemptTimestamp.slice(0, 4)}-${attemptTimestamp.slice(4, 6)}-${attemptTimestamp.slice(6, 8)}T${attemptTimestamp.slice(9, 11)}:${attemptTimestamp.slice(11, 13)}:${attemptTimestamp.slice(13, 15)}Z`,
    "attempt timestamp",
  );
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  if (
    !Number.isFinite(nowMs) ||
    expiresAt <= validFrom ||
    expiresAt - validFrom > PROD_017_MANUAL_AUTHORIZATION.maxWindowMs ||
    attemptInstant < validFrom ||
    attemptInstant > expiresAt ||
    nowMs < validFrom ||
    nowMs > expiresAt ||
    commentCreatedAt > nowMs
  ) {
    fail("manual authorization is outside its valid execution window");
  }

  const fingerprint = createHash("sha256")
    .update(comment.body, "utf8")
    .digest("hex");
  return Object.freeze({
    commentId: numericCommentId,
    attemptId,
    candidateSha: PROD_017_RELEASE.sha,
    authorizer: PROD_017_MANUAL_AUTHORIZATION.ownerLogin,
    expiresAt: record.expires_at,
    fingerprint,
  });
}

export function validateManualEvidence({
  repository,
  ciRun,
  issue,
  pullRequest,
  comment,
  commentId,
  attemptId,
  now,
}) {
  validateCiIssueAndPullRequest({ ciRun, issue, pullRequest });
  return validateManualAuthorization({
    repository,
    comment,
    commentId,
    attemptId,
    now,
  });
}

export async function fetchManualEvidence({
  token,
  commentId,
  attemptId,
  fetchImpl = globalThis.fetch,
  now = new Date(),
}) {
  validateManualAttemptId(attemptId);
  if (
    !/^\d{1,20}$/.test(String(commentId)) ||
    !token ||
    typeof fetchImpl !== "function"
  ) {
    fail("manual GitHub evidence request is incomplete");
  }
  const base = `https://api.github.com/repos/${PROD_017_RELEASE.repository}`;
  const paths = [
    "",
    `/actions/runs/${PROD_017_RELEASE.ciRunId}`,
    `/issues/${PROD_017_RELEASE.issueNumber}`,
    `/pulls/${PROD_017_RELEASE.pullRequestNumber}`,
    `/issues/comments/${commentId}`,
  ];
  const responses = await Promise.all(
    paths.map(async (endpoint) => {
      let response;
      try {
        response = await fetchImpl(`${base}${endpoint}`, {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "X-GitHub-Api-Version": "2022-11-28",
          },
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        fail("manual GitHub evidence request failed");
      }
      if (!response.ok) fail("manual GitHub evidence is unavailable");
      try {
        return await response.json();
      } catch {
        fail("manual GitHub evidence response is malformed");
      }
    }),
  );
  return validateManualEvidence({
    repository: responses[0],
    ciRun: responses[1],
    issue: responses[2],
    pullRequest: responses[3],
    comment: responses[4],
    commentId,
    attemptId,
    now,
  });
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

async function main() {
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
  if (mode === "manual-api" && args.length === 2) {
    const authorization = await fetchManualEvidence({
      token: process.env.GH_TOKEN,
      commentId: args[0],
      attemptId: args[1],
    });
    process.stdout.write(
      `PROD_017_MANUAL_AUTH_OK|${authorization.commentId}|${authorization.attemptId}|${authorization.authorizer}|${authorization.expiresAt}|${authorization.fingerprint}\n`,
    );
    return;
  }
  fail(
    "usage: prod-017-hotfix-admission.mjs git <candidate-repository> | evidence <ci.json> <issue.json> <pull-request.json> <environment.json> <branch-policies.json> | manual-api <comment-id> <attempt-id>",
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`prod-017 admission rejected: ${error.message}\n`);
    process.exitCode = 1;
  }
}
