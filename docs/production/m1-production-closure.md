# M1 Production Closure Record

**Evidence date:** 2026-10-15
**Record status:** Technical closure reviewed and accepted by the ChatGPT PM on 2026-10-15; PR #12 is published and open, and the PM reports CI green. Merge/integration into `main` and separate human sign-off remain pending.
**Evidence basis:** Production facts below were verified by the PM and supplied for this record. The executor did not access production or independently recheck live state.

This acta records the reported M1 production state and separates it from unresolved recovery and traceability evidence. It does not authorize a deployment, database operation, restore, or production access.

## Scope and release identity

| Item | Recorded state | Evidence and qualification |
|---|---|---|
| Target | VPS `vmi3361868` | PM-verified, 2026-10-15. |
| Application | `cocinacore-web`, running | PM-verified, 2026-10-15. |
| Deployed source SHA | `75fd5bd5e7bcce1581962447cf66793765d0c2fc` | PM-verified deployed SHA, 2026-10-15; its release lineage is also documented by the historical GitHub certificate and successful workflow below. |
| M1 boundary | Migrations 001–012 are applied. M2 and migrations 013/014 are not deployed. | PM-verified, 2026-10-15. No claim is made here about unreported database contents or migration checksum attestation. |

M1 production is the existing Pawtech deployment, not the standalone Compose reference. This record does not assert that any historical deployment image, inventory, database observation, or CI status remains current.

## Runtime and health evidence

| Check | Result reported by PM | Evidence date and limit |
|---|---|---|
| Networks | `pawtech_internal` and `pawtech_public` | PM-verified, 2026-10-15. |
| PostgreSQL and Redis | Both running and healthy | PM-verified, 2026-10-15. Service identities and health-probe output were not attached to the supplied evidence. |
| Internal health | `/api/health`: HTTP 200, status `ok` | PM-verified, 2026-10-15. This executor did not issue the request. |
| Public health | `https://cocinacore.31-220-98-21.sslip.io/api/health`: valid HTTPS, HTTP 200, status `ok`; dependencies `database` and `redis` reported healthy | PM-verified, 2026-10-15. Certificate details and raw response were not attached to the supplied evidence. |

These are dated observations, not a continuous-availability guarantee or a fresh check at the time this record is later read.

## Official GitHub release certification — historical

The PM reports having verified these durable GitHub records. They establish the recorded M1 release/certification chain, not a live production check on the date this acta is later read:

- [Issue #6](https://github.com/yabreu65/cocinacore/issues/6) is **CLOSED**, dated 2026-10-06. Its [certificate comment](https://github.com/yabreu65/cocinacore/issues/6#issuecomment-6005962459) declares `STEP7_COMPLETE=YES`, `STEP8_COMPLETE=YES`, `STEP9_COMPLETE=YES`, and `M1_PRODUCTION=YES`.
- The certificate records M1.7 functional verification as **2/2 passed** and cleanup of temporary data.
- [Workflow run 37387790187](https://github.com/yabreu65/cocinacore/actions/runs/37387790187) reports `success` for both SHA validation and VPS deployment jobs.
- The PM reports that `git show` identifies deployed SHA `75fd5bd5e7bcce1581962447cf66793765d0c2fc` as the merge of **PR #8**, and `git merge-base --is-ancestor` confirms that SHA is an ancestor of `origin/main`.

This resolves the earlier evidence gap about the deployed SHA's issue/workflow/repository lineage. It does not establish current runtime health, backup restorability, SSH host-trust configuration, or the remaining administrative items below. The PM's 2026-10-15 runtime observations remain separately attributed above.

## Backup and recovery boundary

The PM reports that the predeploy backup existed and its SHA-256 verification passed. This establishes the reported integrity check only; it does **not** demonstrate that the backup can be restored. A real restoration test has not been performed for this backup, and this task did not access or restore it.

The supplied evidence does not identify the backup artifact's secure locator, creation time, checksum value, or a retained verification receipt. Record or link those details in the approved restricted operational record (not in this repository) if needed for audit traceability. Do not add backup contents, secrets, or sensitive paths here.

**Recovery status:** application rollback procedures are documented, but no production database restore capability is claimed. Any restore drill requires separate authorization and an approved environment.

## Documentation and operating boundary

The [Pawtech M1 production runbook](runbook.md) remains the operational procedure; [Production Reality First](production-reality-first.md) remains the evidence and approval discipline. This closure record is an evidence index and does not amend those procedures.

M1's documented release path is exact-SHA deployment with read-only migration verification, `MIGRATION_EXPECTATION=NO_OP`, and `DATABASE_CHANGED=NO`. No provisioning, mutating migration, DDL, automatic database restore, or shared-infrastructure mutation is part of this M1 closure. See the [runbook](runbook.md) and [production decision discipline](production-reality-first.md).

## Evidence register

| Claim | Classification | What this record establishes |
|---|---|---|
| Runtime, deployed SHA, networks, services, migration range, and internal/public health above | **PM-verified current evidence**, dated 2026-10-15 | Recorded as supplied by the PM; not independently re-observed by the executor. |
| Issue #6 certificate, workflow run 37387790187, PR #8/SHA lineage | **PM-verified historical GitHub records** | The certificate declares Step 7/8/9 and M1 production complete; the two workflow jobs succeeded; the deployed SHA is reported as PR #8's merge and an ancestor of `origin/main`. This traces the release but is not current runtime evidence. |
| Step 5/6/7 repository records and historical inventory | **Repository history, not current production evidence** | Inform boundaries and follow-up questions only. Historical records include [Step 5](../../odd/tasks/m1-step5-official-production-workflow.md), [Step 6](../../odd/tasks/m1-step6-isolated-rehearsal.md), [Step 7](../../odd/tasks/m1-step7-git-integration.md), and the [Pawtech deploy contract](../../odd/tasks/pawtech-production-deploy-contract.md). Older SHAs, inventories, and statuses are not current observations. |
| This acta and its runbook link | **Repository change in this task** | Documentation only. No production/VPS/database/network request was made by the executor. |

## Open administrative and traceability items

The release-chain item is resolved by the historical GitHub certificate and workflow evidence above. The PM accepts the existing M1 production certification and current health evidence as sufficient for **technical M1 closure**. The following items remain open or deferred, without being misrepresented as completed:

1. **Separate human sign-off and merge/integration:** PR #12 is published and open, and the PM reports CI green; merge/integration into `main` remains pending. Separate human sign-off also remains pending. The PM's technical review is not a new human authorization to deploy or modify production.
2. **SSH host-trust traceability:** the historical Step 7 record said the required GitHub `production` Environment secret `VPS_SSH_KNOWN_HOSTS` had not been verified at that time. The supplied certificate and successful workflow status do not establish whether the secret and strict host-key check were in place for this deployment. Reconcile against the protected deployment record without copying the secret value into the repository.
3. **Backup audit trail and recovery:** identify the protected backup artifact and retain its checksum-verification receipt in the approved restricted record; separately decide whether and when to authorize a restore drill. No restoration has been proven.
4. **Migration audit detail:** the PM evidence confirms applied IDs 001–012, not per-migration checksum verification or an attached ledger export. Historical records describe an older ledger without a checksum column; do not treat that older schema observation as current without verification. If stronger provenance is required, PM should identify an approved read-only evidence source; do not modify production as part of this acta.
5. **Backup retention/offsite controls:** the PM evidence does not establish retention or offsite-access policy. Older deploy-contract notes marked these unknown at that historical point; current policy/status needs confirmation if required for formal closure.

## Closure decision

**PM technical decision (2026-10-15): M1_PRODUCTION=YES; technical M1 closure ACCEPTED.** The production state was directly checked by the PM on this date, and the historical release chain is certified by Issue #6 and the successful workflow cited above. This acceptance does not certify database restorability or resolve the explicitly deferred operational items. PR #12 is published and open, and the PM reports CI green; merge/integration into `main` and separate human sign-off remain pending. M2 and migrations 013/014 remain outside this production state and are not approved by this acta.
