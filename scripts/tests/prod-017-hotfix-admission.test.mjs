import test from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PROD_017_RELEASE,
  validateCommitMetadata,
  validateEnvironmentConfiguration,
  validateEvidence,
  validateGitCandidate,
} from "../prod-017-hotfix-admission.mjs";

function commitMetadata(overrides = {}) {
  return {
    sha: PROD_017_RELEASE.sha,
    parents: [PROD_017_RELEASE.parent],
    changes: PROD_017_RELEASE.changes.map((path) => ({ status: "M", path })),
    manifest: {
      migrations: Array.from({ length: 17 }, (_, index) => ({
        id: String(index + 1).padStart(3, "0"),
        filename:
          index === 16
            ? PROD_017_RELEASE.latestMigrationFile
            : `${String(index + 1).padStart(3, "0")}_migration.sql`,
      })),
    },
    releaseManifestBlob: "manifest-017",
    parentManifestBlob: "manifest-017",
    diffCheck: true,
    ...overrides,
  };
}

function validEvidence() {
  return {
    ciRun: {
      id: PROD_017_RELEASE.ciRunId,
      name: "CI",
      event: "workflow_dispatch",
      head_sha: PROD_017_RELEASE.sha,
      status: "completed",
      conclusion: "success",
      repository: { full_name: PROD_017_RELEASE.repository },
    },
    issue: {
      number: PROD_017_RELEASE.issueNumber,
      state: "open",
      body: [
        PROD_017_RELEASE.sha,
        PROD_017_RELEASE.parent,
        "GHSA-3g3m-2fjr-6pw4",
        "GHSA-g3hv-75wg-m249",
        "5 moderate production records",
        "0 high and 0 critical",
      ].join("\n"),
    },
    pullRequest: {
      number: PROD_017_RELEASE.pullRequestNumber,
      state: "open",
      draft: true,
      head: {
        sha: PROD_017_RELEASE.sha,
        ref: PROD_017_RELEASE.pullRequestHead,
        repo: { full_name: PROD_017_RELEASE.repository },
      },
      base: {
        ref: PROD_017_RELEASE.pullRequestBase,
        sha: PROD_017_RELEASE.parent,
        repo: { full_name: PROD_017_RELEASE.repository },
      },
    },
    environment: {
      name: "production",
      protection_rules: [
        {
          type: "required_reviewers",
          prevent_self_review: true,
          reviewers: [
            {
              type: "User",
              reviewer: {
                id: 42,
                login: "release-reviewer",
                type: "User",
              },
            },
          ],
        },
      ],
      deployment_branch_policy: {
        protected_branches: false,
        custom_branch_policies: true,
      },
    },
    branchPolicies: {
      total_count: 1,
      branch_policies: [{ id: 17, name: "main" }],
    },
  };
}

test("accepts only the exact candidate, direct parent, four modified files, and unchanged 017 manifest", () => {
  assert.equal(validateCommitMetadata(commitMetadata()), true);
});

test("validates the real pinned git object in this checkout", () => {
  assert.equal(validateGitCandidate(process.cwd()), true);
});

test("rejects a different SHA, branch name, or tag instead of accepting a movable reference", () => {
  for (const sha of ["a".repeat(40), "refs/heads/fix/hotfix", "v017"]) {
    assert.throws(
      () => validateCommitMetadata(commitMetadata({ sha })),
      /fixed prod-017 release/,
    );
  }
});

test("rejects a different or additional parent", () => {
  assert.throws(
    () => validateCommitMetadata(commitMetadata({ parents: ["b".repeat(40)] })),
    /fixed production-017 parent/,
  );
  assert.throws(
    () =>
      validateCommitMetadata(
        commitMetadata({ parents: [PROD_017_RELEASE.parent, "b".repeat(40)] }),
      ),
    /fixed production-017 parent/,
  );
});

test("rejects extra, deleted, or migration paths", () => {
  const withExtra = [
    ...commitMetadata().changes,
    { status: "A", path: "db/migrations/018_new.sql" },
  ];
  assert.throws(
    () => validateCommitMetadata(commitMetadata({ changes: withExtra })),
    /four-file reviewed allowlist/,
  );

  const withDelete = commitMetadata().changes.map((change) =>
    change.path === "frontend/package-lock.json"
      ? { ...change, status: "D" }
      : change,
  );
  assert.throws(
    () => validateCommitMetadata(commitMetadata({ changes: withDelete })),
    /four-file reviewed allowlist/,
  );

  const withM5 = [
    ...commitMetadata().changes,
    {
      status: "M",
      path: "frontend/src/app/api/cooking-intent-preview/route.ts",
    },
  ];
  assert.throws(
    () => validateCommitMetadata(commitMetadata({ changes: withM5 })),
    /four-file reviewed allowlist/,
  );
});

test("rejects changed manifest, non-017 manifest, and failed diff check", () => {
  assert.throws(
    () =>
      validateCommitMetadata(
        commitMetadata({ releaseManifestBlob: "changed" }),
      ),
    /changed the migration manifest/,
  );
  assert.throws(
    () =>
      validateCommitMetadata(
        commitMetadata({
          manifest: { migrations: [{ id: "020", filename: "020_rls.sql" }] },
        }),
      ),
    /production 001-017 baseline/,
  );
  assert.throws(
    () => validateCommitMetadata(commitMetadata({ diffCheck: false })),
    /diff-check failed/,
  );
});

test("accepts the pinned successful CI, open draft PR, and issue risk record", () => {
  assert.equal(validateEvidence(validEvidence()), true);

  const evidence = validEvidence();
  assert.throws(
    () => validateEvidence({ ...evidence, environment: undefined }),
    /required human reviewer/,
  );
  assert.throws(
    () => validateEvidence({ ...evidence, branchPolicies: undefined }),
    /exactly the main branch/,
  );
});

test("accepts only a human required reviewer, self-review prevention, and exact main policy", () => {
  const evidence = validEvidence();
  assert.equal(
    validateEnvironmentConfiguration({
      environment: evidence.environment,
      branchPolicies: evidence.branchPolicies,
    }),
    true,
  );

  const noHumanReviewer = structuredClone(evidence.environment);
  noHumanReviewer.protection_rules[0].reviewers = [
    {
      type: "Team",
      reviewer: { id: 7, login: "security-team", type: "Team" },
    },
  ];
  assert.throws(
    () =>
      validateEnvironmentConfiguration({
        environment: noHumanReviewer,
        branchPolicies: evidence.branchPolicies,
      }),
    /required human reviewer/,
  );

  const botReviewer = structuredClone(evidence.environment);
  botReviewer.protection_rules[0].reviewers = [
    {
      type: "User",
      reviewer: { id: 8, login: "release-bot[bot]", type: "Bot" },
    },
  ];
  assert.throws(
    () =>
      validateEnvironmentConfiguration({
        environment: botReviewer,
        branchPolicies: evidence.branchPolicies,
      }),
    /required human reviewer/,
  );

  const broadBranchSetting = structuredClone(evidence.environment);
  broadBranchSetting.deployment_branch_policy = {
    protected_branches: true,
    custom_branch_policies: false,
  };
  assert.throws(
    () =>
      validateEnvironmentConfiguration({
        environment: broadBranchSetting,
        branchPolicies: evidence.branchPolicies,
      }),
    /explicit branch policies/,
  );

  const selfApprovalAllowed = structuredClone(evidence.environment);
  selfApprovalAllowed.protection_rules[0].prevent_self_review = false;
  assert.throws(
    () =>
      validateEnvironmentConfiguration({
        environment: selfApprovalAllowed,
        branchPolicies: evidence.branchPolicies,
      }),
    /required human reviewer/,
  );

  for (const branchPolicies of [
    { total_count: 0, branch_policies: [] },
    {
      total_count: 1,
      branch_policies: [{ id: 17, name: "release/*" }],
    },
    {
      total_count: 2,
      branch_policies: [
        { id: 17, name: "main" },
        { id: 18, name: "release/*" },
      ],
    },
    {
      total_count: 1,
      branch_policies: [{ id: 17, name: "main/*" }],
    },
  ]) {
    assert.throws(
      () =>
        validateEnvironmentConfiguration({
          environment: evidence.environment,
          branchPolicies,
        }),
      /exactly the main branch/,
    );
  }
});

test("rejects missing, failed, or wrong-SHA CI evidence", () => {
  const evidence = validEvidence();
  assert.throws(
    () => validateEvidence({ ...evidence, ciRun: undefined }),
    /pinned CI run/,
  );
  assert.throws(
    () =>
      validateEvidence({
        ...evidence,
        ciRun: { ...evidence.ciRun, conclusion: "failure" },
      }),
    /pinned CI run/,
  );
  assert.throws(
    () =>
      validateEvidence({
        ...evidence,
        ciRun: { ...evidence.ciRun, head_sha: "a".repeat(40) },
      }),
    /pinned CI run/,
  );
});

test("rejects missing issue risk evidence or changed issue identity", () => {
  const evidence = validEvidence();
  assert.throws(
    () =>
      validateEvidence({
        ...evidence,
        issue: { ...evidence.issue, body: "risk removed" },
      }),
    /issue #92/,
  );
  assert.throws(
    () =>
      validateEvidence({
        ...evidence,
        issue: { ...evidence.issue, state: "closed" },
      }),
    /issue #92/,
  );
});

test("rejects mutable PR target or changed candidate/base", () => {
  const evidence = validEvidence();
  assert.throws(
    () =>
      validateEvidence({
        ...evidence,
        pullRequest: { ...evidence.pullRequest, head: { sha: "a".repeat(40) } },
      }),
    /PR #93/,
  );
  assert.throws(
    () =>
      validateEvidence({
        ...evidence,
        pullRequest: {
          ...evidence.pullRequest,
          base: { ref: "main", sha: "b".repeat(40) },
        },
      }),
    /PR #93/,
  );
  assert.throws(
    () =>
      validateEvidence({
        ...evidence,
        pullRequest: { ...evidence.pullRequest, draft: false },
      }),
    /PR #93/,
  );
});

test("runs the evidence wrapper with isolated fake GitHub responses and rejects failed CI", () => {
  const repository = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  const temporary = mkdtempSync(
    path.join(tmpdir(), "cocinacore-prod017-admission-test-"),
  );
  const fixtureDirectory = path.join(temporary, "fixtures");
  const fakeBinDirectory = path.join(temporary, "bin");
  mkdirSync(fixtureDirectory);
  mkdirSync(fakeBinDirectory);

  try {
    const evidence = validEvidence();
    for (const [name, value] of Object.entries({
      ci: evidence.ciRun,
      issue: evidence.issue,
      pull: evidence.pullRequest,
      environment: evidence.environment,
      branchPolicies: evidence.branchPolicies,
    })) {
      writeFileSync(
        path.join(fixtureDirectory, `${name}.json`),
        JSON.stringify(value),
      );
    }

    const fakeGh = path.join(fakeBinDirectory, "gh");
    writeFileSync(
      fakeGh,
      [
        "#!/bin/sh",
        "set -eu",
        'case "$2" in',
        '  repos/yabreu65/cocinacore/actions/runs/42310527377) cat "$PROD017_FIXTURE_DIR/ci.json" ;;',
        '  repos/yabreu65/cocinacore/issues/92) cat "$PROD017_FIXTURE_DIR/issue.json" ;;',
        '  repos/yabreu65/cocinacore/pulls/93) cat "$PROD017_FIXTURE_DIR/pull.json" ;;',
        '  repos/yabreu65/cocinacore/environments/production) [ "${PROD017_FAIL_PATH:-}" != "$2" ] || exit 1; cat "$PROD017_FIXTURE_DIR/environment.json" ;;',
        '  repos/yabreu65/cocinacore/environments/production/deployment-branch-policies) [ "${PROD017_FAIL_PATH:-}" != "$2" ] || exit 1; cat "$PROD017_FIXTURE_DIR/branchPolicies.json" ;;',
        "  *) exit 2 ;;",
        "esac",
        "",
      ].join("\n"),
    );
    chmodSync(fakeGh, 0o755);

    const script = path.join(repository, "scripts/validate-prod-017-hotfix.sh");
    const environment = {
      ...process.env,
      GH_TOKEN: "fixture-only-token",
      GITHUB_REPOSITORY: PROD_017_RELEASE.repository,
      PROD017_FIXTURE_DIR: fixtureDirectory,
      RUNNER_TEMP: temporary,
      PATH: `${fakeBinDirectory}${path.delimiter}${process.env.PATH}`,
    };
    const validResult = spawnSync("sh", [script, repository], {
      cwd: repository,
      env: environment,
      encoding: "utf8",
    });
    assert.equal(validResult.status, 0, validResult.stderr);
    assert.match(validResult.stdout, /PROD_017_GIT_ADMISSION_OK/);
    assert.match(validResult.stdout, /PROD_017_GITHUB_EVIDENCE_OK/);
    assert.deepEqual(readdirSync(temporary).sort(), ["bin", "fixtures"]);

    const failedEvidence = { ...evidence.ciRun, conclusion: "failure" };
    writeFileSync(
      path.join(fixtureDirectory, "ci.json"),
      JSON.stringify(failedEvidence),
    );
    const rejectedResult = spawnSync("sh", [script, repository], {
      cwd: repository,
      env: environment,
      encoding: "utf8",
    });
    assert.notEqual(rejectedResult.status, 0);
    assert.match(rejectedResult.stderr, /pinned CI run/);
    assert.deepEqual(readdirSync(temporary).sort(), ["bin", "fixtures"]);

    writeFileSync(
      path.join(fixtureDirectory, "ci.json"),
      JSON.stringify(evidence.ciRun),
    );

    const unavailableBranchPoliciesResult = spawnSync(
      "sh",
      [script, repository],
      {
        cwd: repository,
        env: {
          ...environment,
          PROD017_FAIL_PATH:
            "repos/yabreu65/cocinacore/environments/production/deployment-branch-policies",
        },
        encoding: "utf8",
      },
    );
    assert.notEqual(unavailableBranchPoliciesResult.status, 0);
    assert.match(
      unavailableBranchPoliciesResult.stderr,
      /production Environment branch policy metadata is unavailable/,
    );
    assert.deepEqual(readdirSync(temporary).sort(), ["bin", "fixtures"]);

    const unavailableEnvironmentResult = spawnSync("sh", [script, repository], {
      cwd: repository,
      env: {
        ...environment,
        PROD017_FAIL_PATH: "repos/yabreu65/cocinacore/environments/production",
      },
      encoding: "utf8",
    });
    assert.notEqual(unavailableEnvironmentResult.status, 0);
    assert.match(
      unavailableEnvironmentResult.stderr,
      /production Environment protection metadata is unavailable/,
    );
    assert.deepEqual(readdirSync(temporary).sort(), ["bin", "fixtures"]);

    writeFileSync(
      path.join(fixtureDirectory, "branchPolicies.json"),
      JSON.stringify({ total_count: 0, branch_policies: [] }),
    );
    const noBranchPolicyResult = spawnSync("sh", [script, repository], {
      cwd: repository,
      env: environment,
      encoding: "utf8",
    });
    assert.notEqual(noBranchPolicyResult.status, 0);
    assert.match(noBranchPolicyResult.stderr, /exactly the main branch/);
    assert.deepEqual(readdirSync(temporary).sort(), ["bin", "fixtures"]);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
