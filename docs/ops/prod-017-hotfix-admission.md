# Production 017 Isolated Security Hotfix Admission

## Status and scope

This is a temporary, candidate-specific route for the production-017 security candidate:

- Candidate: `d4a13a61cc0d24c4eda96a7baffaacfd0e47c191`
- Direct parent: `ad99d502ff19d7bb154c04c24697d2a43c1b17e8`
- CI evidence: run `42310527377`
- Risk record: issue `#92`
- Review PR: `#93`, expected to remain an open draft against
  `release/prod-017-security-base` at the exact parent above.

This mechanism does not authorize a deployment by itself. It must first be reviewed and integrated
into trusted `main`; no workflow may be dispatched from the candidate or another feature branch.
The candidate remains a separate source commit and its release image is built from its exact Git
SHA. The ordinary `.github/workflows/deploy.yml` path is not relaxed and still requires ancestry in
`origin/main`.

## Admission contract

The workflow has no caller-controlled SHA, branch, tag, PR, CI run, or issue selector. Its
`admission_mode` is either `gha` (the existing Environment-required path) or `manual` (the
one-time owner-authorization path). Only the two manual record selectors can vary; the workflow
and server-side deploy script pin the candidate and parent. Admission fails closed if any of these
checks fail:

1. The workflow is dispatched from `refs/heads/main`, and its trusted workflow SHA is an ancestor
   of the server's freshly fetched `origin/main`.
2. The candidate is the exact fixed 40-character SHA above and has exactly one parent, the exact
   production baseline above. The current healthy application image must also be exactly
   `cocinacore:deploy-ad99d502ff19d7bb154c04c24697d2a43c1b17e8`, with immutable Docker image ID
   `sha256:b72d20d7c9e6634584b562837e563355c87d02439c0c64bd44d870f0056a7204`. A branch or tag is
   never substituted for either SHA, and moving the baseline image tag fails closed.
3. Its direct diff consists only of the four reviewed modified files: the PDF.js E2E spec,
   `frontend/package.json`, its lockfile, and the shopping-suggestions route test. Added, deleted,
   renamed, or extra files fail admission. This excludes SQL, migrations, and M5/M6 application
   paths.
4. The candidate and its parent have the same migration manifest, containing exactly migrations
   001–017 and ending at `017_persistent_recipe_archive.sql`; `git diff --check` passes.
5. GitHub API evidence still reports the pinned CI run completed successfully on the exact SHA,
   issue #92 open with both GHSA records and the five moderate production findings documented, and
   PR #93 open/draft with the exact candidate and isolated base.
6. The workflow reads the fixed `production` Environment metadata and deployment-branch policy
   endpoints using its read-only Actions token. Admission requires a `required_reviewers` rule with
   at least one `User` reviewer, `prevent_self_review: true`, and exactly one custom branch policy
   named `main`. Missing, malformed, inaccessible, or unexpected API responses fail closed. The
   workflow does not fall back to the presence of `environment: production` as proof of approval.

The latest read-only settings check found that the `production` Environment exists but has
`protection_rules=[]`, `protected_branches=null`, and `deployment_branch_policy=null`; the branch
policy endpoint returned 404 because no policy is configured. Therefore the current environment
fails the workflow-time admission check and cannot proceed to deployment. This is an external
**NO-GO** until administrators configure the required reviewer and exact `main` branch policy,
then independently reverify both endpoints. No settings were changed as part of this work. If the
Actions read token cannot access either endpoint, the validator rejects; no broader token or
alternate manual assertion is introduced here.

The API reads are limited to the fixed CI run, issue, PR, and production Environment contract. The
default GitHub token receives only `contents: read`, `actions: read`, `issues: read`, and
`pull-requests: read`. No production secret is available to the validation job.

### One-time owner-authorized manual path

The manual path is an explicit owner authorization, **not an independent human review** and not a
replacement for a required reviewer. It exists only for this fixed production-017 exception. A
manual workflow dispatch must supply an attempt ID and a comment ID for an unedited owner-authored
comment on Issue #92. The comment body is exactly a marker followed by one JSON object with these
fixed fields:

```text
COCINACORE-PROD-017-MANUAL-AUTHORIZATION-V1
{"schema_version":1,"candidate_sha":"d4a13a61cc0d24c4eda96a7baffaacfd0e47c191","attempt_id":"manual-YYYYMMDDTHHMMSSZ-0123456789abcdef","valid_from":"YYYY-MM-DDTHH:MM:SSZ","expires_at":"YYYY-MM-DDTHH:MM:SSZ","authorized_by":"yabreu65","issue_number":92,"accepted_risks":["GHSA-3g3m-2fjr-6pw4","GHSA-g3hv-75wg-m249","5 moderate production records; 0 high and 0 critical"],"baseline_sha":"ad99d502ff19d7bb154c04c24697d2a43c1b17e8","rollback_conditions":"Application-only rollback using the same attempt ID; no PostgreSQL restore; no migrations."}
```

The comment body must contain only the marker line and JSON object shown above (without Markdown
fences). Before a later, separately authorized dispatch, generate a fresh unique attempt ID locally:

```sh
ATTEMPT_ID=$(node -e 'const { randomBytes } = require("node:crypto"); const stamp = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString().replace(/[-:]/g, "").replace(".000", ""); process.stdout.write(`manual-${stamp}-${randomBytes(8).toString("hex")}\n`);')
printf '%s\n' "$ATTEMPT_ID"
```

This 16-hex suffix is a uniqueness nonce, not a credential or authorization. Never reuse it. Copy
the exact value into the comment's `attempt_id` and `manual_attempt_id` workflow input. Set
`valid_from` no later than the attempt timestamp and `expires_at` no more than two hours after
`valid_from`. In a later GitHub Actions dispatch from `main`, select workflow
`Deploy isolated production-017 security hotfix`, set `admission_mode=manual`, enter the same
`manual_attempt_id`, and enter the Issue #92 comment's numeric `authorization_comment_id`.

The production-side verifier uses the workflow's existing read-only `GITHUB_TOKEN` to re-fetch the
fixed repository metadata, successful CI run, Issue #92, PR #93, and selected comment on the remote
preflight and deploy invocations. Each invocation uses a separate SSH connection; the token is sent
through encrypted stdin and is not an SSH command argument, logged, or written to disk. The deploy
script captures it into a non-exported shell variable and unsets `GH_TOKEN` at entry; only the
pinned verifier process receives it for API calls. The token is cleared after preflight validation
and after the final deploy-time revalidation, before Docker cutover commands. No API write permission
or new credential is added.

The verifier requires repository metadata to identify `yabreu65` as the current user owner and
requires the comment's numeric author ID to equal the repository owner's ID, in addition to
`user.login=yabreu65` and `author_association=OWNER`. The comment ID must match the API object; an
edited comment (`updated_at` different from `created_at`) or deleted/unavailable comment is
rejected. The record must bind the exact candidate/baseline, known accepted-risk list,
application-only rollback wording, and a valid UTC execution window no longer than two hours.
Inputs do not authorize anything by themselves. GHA attempts use only
`manual-<UTC timestamp>-<16 lowercase hex characters>`. No manual ID is accepted by GHA modes.

Before any production Docker/network/application inspection, the manual preflight atomically
reserves the authorization under the existing manual state directory using the deployment lock
and a mode-0600 record. The manual deploy re-fetches and revalidates the owner comment and pinned
CI/PR evidence before build, compares its comment ID, expiry and fingerprint to the reservation,
and atomically consumes it. After backup/schema checks and candidate health, it performs a second
fresh GitHub revalidation immediately before writing cutover state; comment ID, owner, expiry and
fingerprint must still match the consumed authorization. A preflight that reaches reservation burns the attempt even if a later preflight check
fails; do not retry it. Reuse, missing state, an expired or altered comment, an incorrect
SHA/baseline, or missing CI evidence fails closed. Cutover state binds the comment ID, owner, expiry
and comment fingerprint. Manual rollback uses that consumed state and the same attempt ID; it does
not require a new approval and remains application-only.

This authorizes the owner to make the single-person risk decision and therefore does not satisfy
the prior independent-review requirement. The production Environment is not treated as the
authorization source in manual mode. The ordinary GHA admission path still requires its configured
Environment reviewer and exact `main` branch policy.

## Server execution

After the selected admission gate passes, the workflow revalidates the GitHub evidence and exact
Git object. It uses strict SSH host verification and the production Environment's existing SSH
secrets. On the VPS it does not check out the candidate or run the candidate's deploy script. It
fetches refs, verifies the trusted workflow SHA is on `origin/main`, then executes
`scripts/deploy-pawtech-production.sh` from that trusted main commit in one of two narrowly scoped
modes:

- `prod-017-hotfix-preflight`: validates the fixed release contract, runtime configuration,
  services, and current healthy rollback target without deployment mutations.
- `prod-017-hotfix-deploy`: repeats the fixed release contract, archives only the exact candidate
  SHA, verifies the scheduled backup, and runs only `npm run db:migrate:verify`. The candidate must
  match schema 017; pending migrations fail. The script does not run `db:migrate`, provisioning, DDL,
  or database restore.
- `prod-017-manual-preflight` and `prod-017-manual-deploy`: use the same candidate and deployment
  engine, but require the verified owner comment, the reserved one-use manual attempt, and the
  server-side read-only GitHub token check before Docker access. The existing `gha-*` modes remain
  restricted to GHA-generated attempt IDs.

The existing attempt record and application-only rollback remain in force. The record binds the
candidate SHA, image, previous container ID/image, verified backup result, and attempt ID. A failed
cutover self-recovers; a failed independent public smoke invokes the existing rollback mode using
the same trusted script and attempt identity. Rollback validates the prior container identity and
health and never restores PostgreSQL or mutates shared services.

## Threat model and limits

- A changed workflow input cannot select a different release because there are no release inputs;
  the candidate is a fixed constant, independently checked by the server-side script.
- A moved branch/tag cannot change the admitted object. The fixed SHA, direct parent, status/path
  diff, manifest, GitHub evidence, and exact server-side archive all have to agree.
- A workflow edited on a feature branch cannot reach the deployment job: both jobs require
  `refs/heads/main`. The GHA path additionally requires Environment approval; the manual path uses
  an owner-authored, exact, expiring Issue #92 record and explicitly does not claim independent
  human review. Dispatch only from the trusted default branch.
- This does not defend against compromise of protected `main`, GitHub administrators, required
  Environment reviewers, the VPS deployment account, or a compromised approved GitHub Action.
  Those controls require independent repository/environment governance.
- The GitHub Environment reviewer configuration is external to Git and is a hard operational
  prerequisite. If it cannot be verified, do not use this route.

## Activation and revocation

Do not dispatch until the workflow, fixed validator, script modes, tests, and this document have been
reviewed and integrated into `main`; the workflow must be present on the default branch. For GHA
mode, confirm production Environment protection immediately before a later request and use its
explicit approval. For manual mode, first create the exact owner authorization comment on Issue #92,
with a fresh attempt ID and short UTC window, then dispatch from `main` with its comment ID and
matching manual attempt ID. Review the validation job, remote preflight, and one-use reservation
evidence. If preflight reserves the attempt but later checks fail, write a new authorization comment
with a new attempt ID; never retry the old one. Manual authorization is owner approval only, not
independent review. This document is preparation only and is not deployment approval.

After the fixed candidate has been deployed or the exception is no longer needed, revoke the route
by removing `.github/workflows/deploy-prod-017-hotfix.yml`, the `prod-017-hotfix-*` and
`prod-017-manual-*` modes and fixed candidate constants from the deploy script, the validator and
its tests, then verify the ordinary deploy workflow still requires main ancestry. Preserve
consumed authorization/deployment state for audit and rollback retention; do not delete it as part
of route revocation. Do not broaden this exception to another SHA; a later hotfix requires a newly
reviewed, separately pinned change.
