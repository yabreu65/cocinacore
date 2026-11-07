# Production 017 Isolated Security Hotfix Admission

## Status and scope

This is a temporary, candidate-specific route for the production-017 security candidate:

- Candidate: `d4a13a61cc0d24c4eda96a7baffaacfd0e47c191`
- Direct parent: `ad99d502ff19d7bb154c04c24697d2a43c1b17e8`
- CI evidence: run `42310527377`
- Risk record: issue `#92`
- Review PR: `#93`, expected to remain an open draft against
  `release/prod-017-security-base` at the exact parent above.

This mechanism does not authorize a deployment. It must first be reviewed and integrated into
trusted `main`; no workflow may be dispatched from the candidate or another feature branch. The
candidate remains a separate source commit and its release image is built from its exact Git SHA.
The ordinary `.github/workflows/deploy.yml` path is not relaxed and still requires ancestry in
`origin/main`.

## Admission contract

The workflow has no caller-controlled SHA, branch, tag, PR, CI run, or issue inputs. Both the
workflow and the server-side deploy script pin the candidate and parent. Admission fails closed if
any of these checks fail:

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

## Server execution

After the production Environment approval, the workflow revalidates the GitHub evidence and exact
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
  `refs/heads/main`, and the deployment job also requires production Environment approval. Dispatch
  only from the trusted default branch.
- This does not defend against compromise of protected `main`, GitHub administrators, required
  Environment reviewers, the VPS deployment account, or a compromised approved GitHub Action.
  Those controls require independent repository/environment governance.
- The GitHub Environment reviewer configuration is external to Git and is a hard operational
  prerequisite. If it cannot be verified, do not use this route.

## Activation and revocation

Do not dispatch until the workflow, fixed validator, script mode, tests, and this document have been
reviewed and integrated into `main`; the workflow must be present on the default branch. Confirm the
production Environment protection immediately before any later deployment request. Dispatch from
`main` only, review the completed validation job, and use the explicit production Environment
approval as the final human gate. This document is preparation only and is not deployment approval.

After the fixed candidate has been deployed or the exception is no longer needed, revoke the route
by removing `.github/workflows/deploy-prod-017-hotfix.yml`, the `prod-017-hotfix-*` modes and fixed
candidate constants from the deploy script, the validator and its tests, then verify the ordinary
deploy workflow still requires main ancestry. Do not broaden this exception to another SHA; a later
hotfix requires a newly reviewed, separately pinned change.
