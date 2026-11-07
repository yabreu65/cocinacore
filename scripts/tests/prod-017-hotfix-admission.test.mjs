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
  validateManualAttemptId,
  validateAttemptIdForMode,
  validateManualAuthorization,
  validateManualEvidence,
  validateRepositoryOwner,
  fetchManualEvidence,
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

const MANUAL_NOW = new Date("2026-11-07T02:00:00Z");
const MANUAL_ATTEMPT = "manual-20261107T020000Z-a1b2c3d4e5f60718";
const MANUAL_COMMENT_ID = 987654321;
const OWNER_ID = 1234567;

function validRepositoryMetadata(overrides = {}) {
  return {
    id: 7654321,
    name: "cocinacore",
    full_name: PROD_017_RELEASE.repository,
    owner: { id: OWNER_ID, login: "yabreu65", type: "User" },
    ...overrides,
  };
}

function validManualComment(overrides = {}) {
  const record = {
    schema_version: 1,
    candidate_sha: PROD_017_RELEASE.sha,
    attempt_id: MANUAL_ATTEMPT,
    valid_from: "2026-11-07T01:59:00Z",
    expires_at: "2026-11-07T03:00:00Z",
    authorized_by: "yabreu65",
    issue_number: 92,
    accepted_risks: [
      "GHSA-3g3m-2fjr-6pw4",
      "GHSA-g3hv-75wg-m249",
      "5 moderate production records; 0 high and 0 critical",
    ],
    baseline_sha: PROD_017_RELEASE.parent,
    rollback_conditions:
      "Application-only rollback using the same attempt ID; no PostgreSQL restore; no migrations.",
  };
  return {
    id: MANUAL_COMMENT_ID,
    issue_url: "https://api.github.com/repos/yabreu65/cocinacore/issues/92",
    author_association: "OWNER",
    user: { id: OWNER_ID, login: "yabreu65", type: "User" },
    created_at: "2026-11-07T01:59:30Z",
    updated_at: "2026-11-07T01:59:30Z",
    body: `COCINACORE-PROD-017-MANUAL-AUTHORIZATION-V1\n${JSON.stringify(record)}`,
    ...overrides,
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

test("accepts a fixed owner authorization bound to one manual attempt", async () => {
  const result = validateManualAuthorization({
    repository: validRepositoryMetadata(),
    comment: validManualComment(),
    commentId: MANUAL_COMMENT_ID,
    attemptId: MANUAL_ATTEMPT,
    now: MANUAL_NOW,
  });
  assert.equal(result.commentId, MANUAL_COMMENT_ID);
  assert.equal(result.attemptId, MANUAL_ATTEMPT);
  assert.equal(result.candidateSha, PROD_017_RELEASE.sha);
  assert.equal(result.authorizer, "yabreu65");
  assert.match(result.fingerprint, /^[0-9a-f]{64}$/);

  assert.equal(
    validateManualEvidence({
      repository: validRepositoryMetadata(),
      ...validEvidence(),
      comment: validManualComment(),
      commentId: MANUAL_COMMENT_ID,
      attemptId: MANUAL_ATTEMPT,
      now: MANUAL_NOW,
    }).attemptId,
    MANUAL_ATTEMPT,
  );
  assert.equal(
    validateAttemptIdForMode("prod-017-manual-deploy", MANUAL_ATTEMPT),
    true,
  );
  assert.equal(
    validateAttemptIdForMode("prod-017-hotfix-deploy", "gha-42310527377-1"),
    true,
  );
  assert.throws(
    () =>
      validateAttemptIdForMode("prod-017-manual-deploy", "gha-42310527377-1"),
    /manual attempt ID/,
  );
  assert.throws(
    () => validateAttemptIdForMode("prod-017-hotfix-deploy", MANUAL_ATTEMPT),
    /GitHub Actions attempt ID/,
  );
});

test("rejects malformed, reused, forged, or altered manual authorization", () => {
  assert.throws(
    () => validateManualAttemptId("manual-../../gha-1-1"),
    /manual attempt ID/,
  );
  assert.throws(
    () => validateManualAttemptId("manual-20261107T020000Z-A1B2C3D4E5F60718"),
    /manual attempt ID/,
  );

  const wrongAttempt = validManualComment();
  const wrongAttemptRecord = JSON.parse(wrongAttempt.body.split("\n")[1]);
  wrongAttemptRecord.attempt_id = "manual-20261107T020000Z-1111111111111111";
  wrongAttempt.body = `COCINACORE-PROD-017-MANUAL-AUTHORIZATION-V1\n${JSON.stringify(wrongAttemptRecord)}`;
  assert.throws(
    () =>
      validateManualAuthorization({
        repository: validRepositoryMetadata(),
        comment: wrongAttempt,
        commentId: MANUAL_COMMENT_ID,
        attemptId: MANUAL_ATTEMPT,
        now: MANUAL_NOW,
      }),
    /fixed candidate, baseline, risks, and rollback/,
  );

  const forgedAuthor = validManualComment({
    user: { id: OWNER_ID + 1, login: "intruder", type: "User" },
  });
  assert.throws(
    () =>
      validateManualAuthorization({
        repository: validRepositoryMetadata(),
        comment: forgedAuthor,
        commentId: MANUAL_COMMENT_ID,
        attemptId: MANUAL_ATTEMPT,
        now: MANUAL_NOW,
      }),
    /comment identity/,
  );
  const wrongAssociation = validManualComment({
    author_association: "COLLABORATOR",
  });
  assert.throws(
    () =>
      validateManualAuthorization({
        repository: validRepositoryMetadata(),
        comment: wrongAssociation,
        commentId: MANUAL_COMMENT_ID,
        attemptId: MANUAL_ATTEMPT,
        now: MANUAL_NOW,
      }),
    /comment identity/,
  );
  const wrongCommentId = validManualComment({ id: MANUAL_COMMENT_ID + 1 });
  assert.throws(
    () =>
      validateManualAuthorization({
        repository: validRepositoryMetadata(),
        comment: wrongCommentId,
        commentId: MANUAL_COMMENT_ID,
        attemptId: MANUAL_ATTEMPT,
        now: MANUAL_NOW,
      }),
    /comment identity/,
  );
  const edited = validManualComment({ updated_at: "2026-11-07T02:00:00Z" });
  assert.throws(
    () =>
      validateManualAuthorization({
        repository: validRepositoryMetadata(),
        comment: edited,
        commentId: MANUAL_COMMENT_ID,
        attemptId: MANUAL_ATTEMPT,
        now: MANUAL_NOW,
      }),
    /comment identity/,
  );
  const malformedCommentTimestamp = validManualComment({
    created_at: "not-a-timestamp",
    updated_at: "not-a-timestamp",
  });
  assert.throws(
    () =>
      validateManualAuthorization({
        repository: validRepositoryMetadata(),
        comment: malformedCommentTimestamp,
        commentId: MANUAL_COMMENT_ID,
        attemptId: MANUAL_ATTEMPT,
        now: MANUAL_NOW,
      }),
    /comment created_at must be canonical UTC/,
  );

  for (const change of [
    { candidate_sha: "a".repeat(40) },
    { baseline_sha: "b".repeat(40) },
    { issue_number: 93 },
    { authorized_by: "someone-else" },
    { rollback_conditions: "restore database" },
    { accepted_risks: ["GHSA-3g3m-2fjr-6pw4"] },
  ]) {
    const comment = validManualComment();
    const record = JSON.parse(comment.body.split("\n")[1]);
    Object.assign(record, change);
    comment.body = `COCINACORE-PROD-017-MANUAL-AUTHORIZATION-V1\n${JSON.stringify(record)}`;
    assert.throws(
      () =>
        validateManualAuthorization({
          repository: validRepositoryMetadata(),
          comment,
          commentId: MANUAL_COMMENT_ID,
          attemptId: MANUAL_ATTEMPT,
          now: MANUAL_NOW,
        }),
      /fixed candidate, baseline, risks, and rollback/,
    );
  }

  const extraField = validManualComment();
  const extraRecord = JSON.parse(extraField.body.split("\n")[1]);
  extraRecord.skip_checks = true;
  extraField.body = `COCINACORE-PROD-017-MANUAL-AUTHORIZATION-V1\n${JSON.stringify(extraRecord)}`;
  assert.throws(
    () =>
      validateManualAuthorization({
        repository: validRepositoryMetadata(),
        comment: extraField,
        commentId: MANUAL_COMMENT_ID,
        attemptId: MANUAL_ATTEMPT,
        now: MANUAL_NOW,
      }),
    /fields do not match/,
  );
});

test("rejects expired, future, or overlong owner authorization windows", () => {
  for (const [valid_from, expires_at] of [
    ["2026-11-07T00:00:00Z", "2026-11-07T01:59:59Z"],
    ["2026-11-07T02:01:00Z", "2026-11-07T03:00:00Z"],
    ["2026-11-07T01:00:00Z", "2026-11-07T04:00:00Z"],
  ]) {
    const comment = validManualComment();
    const record = JSON.parse(comment.body.split("\n")[1]);
    record.valid_from = valid_from;
    record.expires_at = expires_at;
    comment.body = `COCINACORE-PROD-017-MANUAL-AUTHORIZATION-V1\n${JSON.stringify(record)}`;
    assert.throws(
      () =>
        validateManualAuthorization({
          repository: validRepositoryMetadata(),
          comment,
          commentId: MANUAL_COMMENT_ID,
          attemptId: MANUAL_ATTEMPT,
          now: MANUAL_NOW,
        }),
      /valid execution window/,
    );
  }
});

test("manual validation fails closed for missing CI evidence and migration changes", () => {
  const evidence = {
    repository: validRepositoryMetadata(),
    ...validEvidence(),
    comment: validManualComment(),
    commentId: MANUAL_COMMENT_ID,
    attemptId: MANUAL_ATTEMPT,
    now: MANUAL_NOW,
  };
  assert.throws(
    () => validateManualEvidence({ ...evidence, ciRun: undefined }),
    /pinned CI run/,
  );

  const withSql = [
    ...commitMetadata().changes,
    { status: "A", path: "db/migrations/020_rls.sql" },
  ];
  assert.throws(
    () => validateCommitMetadata(commitMetadata({ changes: withSql })),
    /four-file reviewed allowlist/,
  );
});

test("fetches only pinned read-only GitHub evidence and never returns the token", async () => {
  const evidence = validEvidence();
  const values = new Map([
    [
      `https://api.github.com/repos/${PROD_017_RELEASE.repository}`,
      validRepositoryMetadata(),
    ],
    [
      `https://api.github.com/repos/yabreu65/cocinacore/actions/runs/${PROD_017_RELEASE.ciRunId}`,
      evidence.ciRun,
    ],
    [
      `https://api.github.com/repos/yabreu65/cocinacore/issues/92`,
      evidence.issue,
    ],
    [
      `https://api.github.com/repos/yabreu65/cocinacore/pulls/93`,
      evidence.pullRequest,
    ],
    [
      `https://api.github.com/repos/yabreu65/cocinacore/issues/comments/${MANUAL_COMMENT_ID}`,
      validManualComment(),
    ],
  ]);
  const urls = [];
  const result = await fetchManualEvidence({
    token: "fixture-token-never-logged",
    commentId: MANUAL_COMMENT_ID,
    attemptId: MANUAL_ATTEMPT,
    now: MANUAL_NOW,
    fetchImpl: async (url, options) => {
      urls.push(url);
      assert.equal(
        options.headers.Authorization,
        "Bearer fixture-token-never-logged",
      );
      assert.equal(options.method, undefined);
      assert.equal(options.redirect, "error");
      return { ok: true, json: async () => values.get(url) };
    },
  });
  assert.deepEqual(urls.sort(), [...values.keys()].sort());
  assert.equal(JSON.stringify(result).includes("fixture-token"), false);
  await assert.rejects(
    fetchManualEvidence({
      token: "",
      commentId: MANUAL_COMMENT_ID,
      attemptId: MANUAL_ATTEMPT,
      fetchImpl: async () => {
        throw new Error("should not fetch");
      },
    }),
    /incomplete/,
  );
});

test("requires the real repository owner identity to match the commenter ID", () => {
  assert.deepEqual(validateRepositoryOwner(validRepositoryMetadata()), {
    login: "yabreu65",
    id: OWNER_ID,
  });

  for (const repository of [
    validRepositoryMetadata({ full_name: "attacker/cocinacore" }),
    validRepositoryMetadata({
      owner: { id: OWNER_ID, login: "intruder", type: "User" },
    }),
    validRepositoryMetadata({
      owner: { id: OWNER_ID, login: "yabreu65", type: "Organization" },
    }),
    validRepositoryMetadata({
      owner: { id: "1234567", login: "yabreu65", type: "User" },
    }),
  ]) {
    assert.throws(() => validateRepositoryOwner(repository), /owner identity/);
  }

  const wrongAccount = validManualComment({
    user: { id: OWNER_ID + 1, login: "yabreu65", type: "User" },
  });
  assert.throws(
    () =>
      validateManualAuthorization({
        repository: validRepositoryMetadata(),
        comment: wrongAccount,
        commentId: MANUAL_COMMENT_ID,
        attemptId: MANUAL_ATTEMPT,
        now: MANUAL_NOW,
      }),
    /comment identity/,
  );
});

test("rejects deleted comments, network failures, and incomplete GitHub responses", async () => {
  const validValues = [
    validRepositoryMetadata(),
    validEvidence().ciRun,
    validEvidence().issue,
    validEvidence().pullRequest,
    validManualComment(),
  ];
  let call = 0;
  const deletedComment = async () => {
    const current = call++;
    return current === 4
      ? { ok: false, status: 404, json: async () => ({}) }
      : { ok: true, json: async () => validValues[current] };
  };
  await assert.rejects(
    fetchManualEvidence({
      token: "fixture-token",
      commentId: MANUAL_COMMENT_ID,
      attemptId: MANUAL_ATTEMPT,
      fetchImpl: deletedComment,
    }),
    /evidence is unavailable/,
  );

  await assert.rejects(
    fetchManualEvidence({
      token: "fixture-token",
      commentId: MANUAL_COMMENT_ID,
      attemptId: MANUAL_ATTEMPT,
      fetchImpl: async () => {
        throw new Error("simulated network outage");
      },
    }),
    /evidence request failed/,
  );

  const completeEvidence = new Map([
    [
      `https://api.github.com/repos/${PROD_017_RELEASE.repository}`,
      validRepositoryMetadata(),
    ],
    [
      `https://api.github.com/repos/${PROD_017_RELEASE.repository}/actions/runs/${PROD_017_RELEASE.ciRunId}`,
      validEvidence().ciRun,
    ],
    [
      `https://api.github.com/repos/${PROD_017_RELEASE.repository}/issues/${PROD_017_RELEASE.issueNumber}`,
      validEvidence().issue,
    ],
    [
      `https://api.github.com/repos/${PROD_017_RELEASE.repository}/pulls/${PROD_017_RELEASE.pullRequestNumber}`,
      validEvidence().pullRequest,
    ],
    [
      `https://api.github.com/repos/${PROD_017_RELEASE.repository}/issues/comments/${MANUAL_COMMENT_ID}`,
      validManualComment(),
    ],
  ]);
  await assert.rejects(
    fetchManualEvidence({
      token: "fixture-token",
      commentId: MANUAL_COMMENT_ID,
      attemptId: MANUAL_ATTEMPT,
      fetchImpl: async (url) => ({
        ok: true,
        json: async () =>
          url === `https://api.github.com/repos/${PROD_017_RELEASE.repository}`
            ? undefined
            : completeEvidence.get(url),
      }),
    }),
    /owner identity/,
  );

  await assert.rejects(
    fetchManualEvidence({
      token: "fixture-token",
      commentId: MANUAL_COMMENT_ID,
      attemptId: MANUAL_ATTEMPT,
      fetchImpl: async () => ({
        ok: true,
        json: async () => {
          throw new Error("malformed response");
        },
      }),
    }),
    /response is malformed/,
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
