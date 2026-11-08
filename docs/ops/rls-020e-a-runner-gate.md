# 020E-A restricted-runner gate: blocked

Do not create, apply, or deploy canonical migration 020 until the independent object-owner contract is integrated with the restricted migration runner and validated end to end. The previously approved candidate policies remain unchanged.

## Reproduced blockers

The disposable PostgreSQL 16 harness installs and verifies migrations 001–019 using the official runner, provisions the existing candidate roles, and submits two temporary 020 fixture migrations to that runner. It uses `migration_admin`, which assumes `cocinacore_schema_owner`:

1. Creating a view and transferring its ownership to `cocinacore_identity_probe` fails with `must be able to SET ROLE "cocinacore_identity_probe"`. The transaction leaves neither the view nor a fixture ledger row. The real identity candidate requires this ownership transfer.
2. Replacing `owner_global_metrics`, already owned by `cocinacore_metrics_view_owner`, fails with `must be owner of view owner_global_metrics`. Its definition is unchanged and the fixture has no ledger row. The D4-A candidate replaces that view and creates a guard with the same independent owner.

The runner's role preflight permits exactly the single `migration_admin` to `cocinacore_schema_owner` membership. The signup and metrics provisioners also reject memberships of their NOLOGIN owners. Granting membership as a workaround would violate both contracts. Additionally, the runner's current `catalogAdditions` schema does not accept views, and its function ownership validation expects `cocinacore_schema_owner`, whereas the approved signup function is owned by `cocinacore_signup_bootstrap`.

These failures do not prove that a safe integration is impossible. A subsequent change needs an explicitly reviewed provisioning order and exact object/owner/ACL verification under FORCE RLS, preserving the transaction and ledger guarantees. It must not bypass catalog checks or quietly broaden role authority. Re-run the approved RLS, auth, metrics and writer regressions after that design is implemented.

## 020E-A1-P: inert preparation candidate

`scripts/provision-020-inert-capabilities.sql` prepares the seven reviewed identity, signup, metrics and global-writer objects in one administrative transaction, without exposing those objects to application LOGINs. It is a **candidate for disposable PostgreSQL 16**, not an authorization to change a persistent environment. It accepts an exact 019 ledger and either no prepared objects or all seven objects matching the fixed definitions, ownership, options and ACL contracts. Existing incompatible or partial states are rejected; existing LOGIN passwords are never rotated. When the metrics or writer LOGIN does not exist, the script requires a separate nonempty password for each and creates that restricted LOGIN with only database CONNECT and schema USAGE in addition to the PostgreSQL defaults. The four independent owners are NOLOGIN, non-inheriting and have no memberships.

1. Use the official restricted runner to apply and verify boundary 019. Provision the reviewed runtime/auth roles **before** preparing owner roles. Keep the legacy signup INSERT grants intact.
2. An explicitly authorized database administrator executes the candidate with `psql -X -1 -v ON_ERROR_STOP=1` and supplies `metrics_password` and `global_writer_password` securely when the corresponding LOGINs are absent. Do not enable query echo, shell tracing, or expose credentials in logs. The candidate holds the database-change advisory transaction lock and performs creation, ownership transfer, revocation and catalog attestation before the single commit.
3. The prepared `runtime_identity_probe` and signup function are owned by `cocinacore_identity_probe` and `cocinacore_signup_bootstrap`. The metrics guard and seven-count view are owned by `cocinacore_metrics_view_owner`; the three writer views are owned by `cocinacore_global_writer_view_owner`. Required source grants go only to those NOLOGIN owners. Signup EXECUTE, identity-probe SELECT, metrics SELECT and writer-view INSERT/SELECT grants to application LOGINs are **deferred**; PUBLIC has no access to those objects.
4. **Do not reprovision auth between preparation and 020.** Its current preflight rejects the prepared identity objects without FORCE RLS as an incomplete 020C1 state. Existing legacy auth INSERTs remain available so signup continues using its pre-020 path. Do not run the existing active metrics or writer provisioners over the prepared state: their contracts are incompatible and must not be used to activate capabilities prematurely.
5. If preparation fails before commit, the transaction rolls back, including newly created roles and objects, and the 019 ledger remains unchanged. If a later 020 attempt fails, the separately committed inert preparation remains in place; leave its LOGIN grants disabled, preserve the legacy signup configuration and investigate the failure. Re-running this script is allowed only when the complete prepared state is unchanged; partial, drifted or already activated states must fail closed. The eventual migration/activation and its independent-owner verification remain work for 020E-A1-R and the 020E-A gate.

Disposable PostgreSQL tests exercise exact-state reapplication, preserved passwords, real-login access denials, legacy auth SQL, independent-owner `SET ROLE` denial, injected rollback, partial state, owner/definition/ACL/membership drift and the unchanged 019 ledger. This does not prove the official migrator can activate 020 or validate post-020 rollback.

## 020E-A1-R2: prepared-state attestation, activation still blocked

The restricted runner checks the static manifest declaration and attests the seven installed objects against fixed PostgreSQL 16 catalog rules copied from the reviewed A1-P provisioner. The attestation verifies the independent owners, definitions, options, ACLs, effective privileges and owner-role boundaries using the same transaction client. The attestation SQL is pinned by a fixed checksum; the installed catalog does not supply the expected contract.

Boundary 019 may be verified without prepared objects; a partial or altered preparation fails closed. A pending 020 requires the complete inert state before its SQL and ledger write, and the runner checks it again before commit. The disposable harness exercises owner, definition, ACL, role, function and extra-object drift, a failed synthetic transaction, a successful synthetic schema-owner DDL fixture, its checksum and idempotent rerun. The fixture is not in the canonical manifest.

**Activation remains NO-GO.** `--verify-complete` explicitly rejects an applied 020 until a separate activated-state contract exists. The post-SQL inert check intentionally prevents treating activation as verified. The restricted runner cannot perform independent-owner DDL, and no new membership, privileged connection or active LOGIN grant is authorized by this change. Do not create, apply or authorize canonical 020 on this evidence. The next step is to design and test post-020 activation attestation and the approved activation mechanism independently.

## 020E-A1: partial pre-activation guard

The existing metrics and global-writer provisioners grant their LOGIN roles access to their views before 020. They therefore cannot be used as the requested inert preparation boundary as-is. `scripts/rls-candidates/020e-a1-inert-capability-guard.sql` adds a **negative check only**: it rejects untrusted application roles or memberships, direct table access by metrics/writer logins, and effective LOGIN access to the signup function, identity probe, metrics views, or writer views. It includes inherited and column-level privileges. The guard does not create or attest prepared objects, compare their definitions or all ACLs, change the runner/manifest, or authorize activation.

The disposable harness tests that the guard rejects the existing active metrics and writer grants, accepts a transaction-local fixture with those grants revoked, and leaves the original grants unchanged after rollback. A successful negative guard by itself is **not** evidence of exact preparation: that requires the separate candidate above. The next stage must add exact post-activation catalog contracts, a narrowly allowlisted owner-aware runner inventory, and restricted-runner activation fixtures before 020E-A can resume.

Preparation is a separate committed administrative transaction, not part of 020. Do not use the legacy provisioners as an inert preparation path or attempt activation before the next gate. A post-020 operational rollback remains outside this evidence.

### 020E-A1-P: legacy auth sequencing constraint

The disposable 019 harness verifies that, after creating the two signup NOLOGIN roles but before installing identity RLS, the real auth LOGIN still performs the legacy tenant/user/owner-membership/session sequence in one transaction. The fixture is rolled back. This verifies neither the seven-object prepared state nor HTTP signup in that state.

The existing auth provisioner rejects this owner-only state as `Refusing partial 020C1 identity installation`: its legacy branch requires both signup owner roles to be absent, while its other branch requires the completed 020C1 objects and FORCE RLS. The rejection was compared against a pre/post fingerprint of roles, schema, and populated tenant, user and membership data. Any eventual preparation contract must address this sequencing explicitly without revoking legacy auth INSERTs, rotating existing credentials, or accepting an incomplete secure installation.

## Local evidence

Run only against the harness-owned, tmpfs-backed PostgreSQL 16 cluster with Node 22.22.3:

```sh
DOCKER_CONTEXT=desktop-linux bash scripts/test-bootstrap-migrator-integration.sh
```

The harness creates and removes its own disposable cluster. Its `boundary-restricted-identity-view-owner` and `boundary-restricted-metrics-view-owner` checks use the official Node runner and assert the failed fixture migrations do not leave ledger entries. The synthetic fixtures are not a canonical 020.

## Premium REST and invitations

Repository search found `PremiumBoardService` only as an exported, client-injected service; no in-repository construction or Supabase client dependency was found. The current premium page is a placeholder. This does not establish whether a separately deployed consumer exists or which credential and policies it uses. External configuration and Supabase policy verification remain a production blocker and were not queried.

The D5 invitation candidate permits tenant-scoped summary reads only. It does not authorize creation, acceptance, or token access; those capabilities need separate approval.

## Rollback decision boundary

The fixture tests prove only that a failed runner transaction leaves no fixture view or ledger row and does not modify the existing metrics view. No canonical 020 has been applied, so rollback after successful 020, application rollback with its policies still active, signup compatibility, metrics/writer disablement, and backup restoration remain **untested**. Before any eventual deployment, rehearse these cases against an isolated environment and verify a recoverable backup. Prefer rolling back to an application version proven compatible with the installed policies or temporarily disabling affected functionality; do not restore broad legacy auth INSERT grants as a shortcut. No destructive persistent-database command is authorized by this document.

## 020E-A1-R3: positive activated-state attestation

`frontend/scripts/activated-capabilities-attestation.sql` is an independent read-only PostgreSQL 16 contract pinned by SHA-256 in its JavaScript loader. It checks the seven prepared objects and fixed owners/definitions/options, the exact 71 policies across the 27 FORCE-RLS tables (including the nine historical policies), the six-role capability boundary, login grants as a subset of a fixed activation allowlist, denied auth INSERTs, the identity-probe boundary, the seven-column metrics view, the global-writer views, the D5 invitation projection, and direct `match_chunks` denial. Policy and definition expectations are fixed literals, never generated from the installed catalog.

The runner uses inert attestation before the first pending migration with prefix 020. In the same runner transaction as the SQL and checksum ledger insert, it then validates the complete post-020 object/policy state and reports either `ACTIVATION PENDING` or an active state. Missing allowlisted LOGIN grants are pending, not a false success; unexpected, excessive, or misdirected grants fail closed. Once the ledger includes 020, reruns attest the post-020 contract rather than incorrectly demanding inert ACLs. `--verify-complete` succeeds only for the exact active grant set; pending activation is rejected explicitly.

The disposable integration harness applies a synthetic structural 020 through the official runner, leaving approved LOGIN capabilities revoked. A separate disposable administrator fixture grants those capabilities under their NOLOGIN object owners; real LOGIN tests then exercise signup, seven metrics, the global writer, tenant-scoped runtime visibility, and RAG denial. This is a lab proof of catalog states, not an authorization or production procedure for activating grants.

The administrative preparation transaction and the future runner-managed 020 transaction are separate commits. Grants on independently owned objects require a separately authorized administrative operation; this stage attests its result but does not implement that operational procedure. Signup continuity is **not assumed**: once 020C1 revokes auth's direct INSERTs, signup can be interrupted until `cocinacore_auth` receives EXECUTE on `signup_new_account`. The disposable sequence proves each side of that transition, not continuous availability across production cutover. Do not reprovision auth between inert preparation and the 020C1 transition; its current preflight intentionally rejects the partially installed signup roles.

At the close of the R3 stage, canonical migration 020 had not been created or applied. Persistent databases, credentials, production, and Contabo were not accessed. The next gate was to develop and rehearse a separately authorized activation operation in disposable PostgreSQL; that stage result was **not** a production GO.

## 020E-A1-R4: administrative activation candidate

`frontend/scripts/activate-020-capabilities.js` is a separate, one-off administrative candidate. It is not imported by or called from the restricted migration runner. It accepts no command-line overrides and requires `COCINACORE_ACTIVATION_DATABASE_URL`; it never falls back to `DATABASE_URL` or `MIGRATION_DATABASE_URL`, and it does not load `.env` files. The URL is not logged. The script requires a direct PostgreSQL 16 administrative superuser session because there are no persistent memberships that would let a LOGIN assume the four legitimate NOLOGIN owners. It does not create roles, grant memberships, alter credentials, or run from an application request.

Before connecting, it reads the fixed repository manifest, checks the prepared-capability declaration, validates the exact ordered migration entries and file hashes through id `020`, and fails with `ACTIVATION_MANIFEST_020_UNAVAILABLE` while this repository has only 001–019. It accepts no supplied migration filename or checksum. Its ledger preflight requires exactly the first twenty trusted manifest filenames/checksums, in order with unique application timestamps; a prefix match or a synthetic name not present in the fixed manifest is insufficient. The disposable harness mirrors a temporary manifest containing the exact synthetic 020 fixture into a temporary project root; neither that manifest nor the fixture is written into `db/migrations/` in the repository.

The operation takes one PostgreSQL client and one transaction. It obtains an exclusive transaction advisory lock using the same `cocinacore:database-change:v1:` plus database-name hash as the runner's session advisory lock, so the two operations serialize. It then checks the direct admin identity, trusted ledger, and complete R3 catalog attestation. It accepts only (A) the exact pending structure with all seven activation privileges absent or (B) the exact active state. Any subset of activation grants is rejected. For A, it assumes each legitimate NOLOGIN owner locally, grants only signup EXECUTE to auth, identity-probe SELECT to runtime, metrics SELECT to metrics LOGIN, three writer INSERT grants, and writer `id` SELECT on the books view. It runs the full positive attestation before commit and verifies that the PostgreSQL transaction id and role-membership snapshot did not change. State B is a no-grant no-op. Any error rolls back all grants.

### Signup continuity and controlled maintenance

Continuous signup across the 020 cutover is **not proven**. The disposable structural-020 state reproducibly rejects both the new signup function call (EXECUTE is not active yet) and the legacy direct INSERT path (revoked by 020C1); the tested SQL attempts leave no partial tenant, user, or membership. Therefore a future deployment must close signup before applying 020 (for example, return an explicit temporary 503 at the edge or put registration into maintenance), apply 020 with the restricted runner, activate with the separately authorized administrative operation, pass `--verify-complete`, perform SQL and HTTP signup smoke checks, and only then reopen registration. On any failure, keep registration closed and do not restore legacy INSERT grants. This is a release constraint, not a zero-downtime claim or an authorization to activate a persistent database.

The final R4 PostgreSQL 16 disposable harness run completed successfully with 72 explicit PASS assertions and 228 integration checks; its cleanup left no harness containers. It executes the same candidate against a temporary manifest-bound synthetic 020, tests no-020/invalid-ledger/partial-grant rejection without mutation, injects a PostgreSQL failure after three grants and verifies total rollback, rejects owner/policy/view-definition/ACL/ledger-name/checksum drift, attests active state, proves active-state idempotence, and reruns the restricted runner's `--verify-complete`. Real auth, metrics, writer, PUBLIC-like access, runtime probe and RAG checks remain part of that disposable sequence. The signup pending test is SQL-level; no Next.js HTTP server was exercised, so this is not zero-downtime evidence. This does **not** create or apply canonical migration 020, validate any persistent URL, or authorize production.

## 020E-A2: canonical migration candidate and disposable proof

`db/migrations/020_tenant_rls_hardening.sql` is the canonical transactional migration candidate. Its manifest entry is id `020`, name `020_tenant_rls_hardening.sql`, SHA-256 `1fbadb829792902ef19bdb0abd2c20e39409360986c9844d9cab3105df6eb33a`, byte length `130680`, and `transactional: required`. It declares no `catalogAdditions`: the migration creates no tables, functions, views, or other objects in the runner's catalog-addition inventory. Historical entries 001–019 are unchanged.

The migration is composed from the reviewed 020B, 020C, 020C1, 020D1–020D5 policies and preflights. It does not concatenate their independent-owner object provisioning or activate LOGIN grants:

| Component                    | Canonical 020 operation                                                                      | Deliberately not repeated                                                                           |
| ---------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 020B inventory               | Enable/FORCE RLS and install the reviewed inventory and movement policies.                   | No unrelated table/grant changes.                                                                   |
| 020C identity                | Enable/FORCE RLS on users, tenants, and memberships; install the reviewed identity policies. | Does not create, replace, or transfer ownership of `runtime_identity_probe`.                        |
| 020C1 signup                 | Install bootstrap policies and revoke auth's direct INSERT privileges.                       | Does not create/replace `signup_new_account` or grant its EXECUTE privilege to auth.                |
| 020D1 plans/history/shopping | Install the reviewed policies and RLS state.                                                 | Keeps the identity-probe LOGIN grant pending.                                                       |
| 020D2 culinary profiles      | Install the reviewed profile and profile-term policies.                                      | Does not change the prepared capability objects.                                                    |
| 020D3 documents/RAG          | Install document/chunk policies and RLS state.                                               | Does not create the identity view or grant it to runtime.                                           |
| 020D4-A owner metrics        | Enable/FORCE RLS and install source-table policies for the fixed metrics view owner.         | Does not create/replace either metrics view, transfer owners, or grant metrics access to its LOGIN. |
| 020D4-B global writer        | Install the reviewed owner policies.                                                         | Does not create/replace writer views or grant view access to its LOGIN.                             |
| 020D5 invitations            | Install only the tenant-scoped summary-read policy.                                          | Invitation creation and acceptance remain out of scope.                                             |

The seven fixed A1-P objects and their four NOLOGIN owners remain exactly as prepared and attested before 020. The runner applies 020 as `migration_admin` in a single transaction, then independently attests all 71 policies and 27 FORCE-RLS public relations before recording the checksum ledger row. R4 remains a separate administrative operation. Its only activation privileges are: auth EXECUTE on `signup_new_account`; runtime SELECT on `runtime_identity_probe`; metrics LOGIN SELECT on `owner_global_metrics`; writer LOGIN INSERT and `id` SELECT on the books view; and writer LOGIN INSERT on each PDF and chunks view. `--verify-complete` rejects the migration while this set is absent or incomplete.

### Disposable execution order

The validated order in PostgreSQL 16 is:

1. Use the official runner to install 001–019 and verify boundary 019.
2. Provision the reviewed runtime and auth identities. Prepare all seven inert objects with the A1-P provisioner, using only disposable credentials, then run the standalone guard and runner boundary attestation.
3. Keep registration in explicit maintenance while migration 020 is pending. Run only `frontend/scripts/run-migrations.js` through `migration_admin`; the runner reports `ACTIVATION PENDING` after successful 020.
4. If pending, run R4 with the disposable administrative URL only. Then run `--verify-complete`, and rerun the runner to prove 020 is skipped and the exact active state remains attested.
5. Reopen registration only after activation and application smoke tests succeed. This sequence is controlled maintenance, not zero downtime.

The PostgreSQL 16 disposable integration harness now executes the real canonical SQL through the restricted runner. It proves a real SQL fault rolls back the whole 020 transaction and ledger; the inert preparation survives; the canonical run records the actual manifest checksum; 71 policies/27 FORCE RLS relations are installed; pending `--verify-complete` is rejected; and the post-020 auth provisioner preserves function-only signup without restoring direct INSERT. It then runs R4, verifies active-state idempotence and `--verify-complete`, and exercises LOGIN role denials and RLS behavior. A temporary database clone is used for the PostgreSQL-backed application suites, including the HTTP handler integration for signup, login, sessions, and password reset; the clone and all test roles are removed by the harness.

The final disposable application regression batch reports **17 files passed, 81 tests passed and 10 tests skipped** because the owner-metrics and global-writer DB suites are run separately with their required activation flags. Those dedicated runs passed all **4 owner-metrics tests** and **5 global-writer tests**, including successful upload and rollback cases. In total, the selected application cases were **90 passed and 1 skipped**. The database clone explicitly revokes `CREATE` and `TEMP` from `PUBLIC`, grants `CONNECT` to the required test identities, and verifies the metrics guard under its NOLOGIN owner before starting Vitest; this preserves the database-level ACL contract instead of relying on template-database defaults.

The canonical migration and its checksum are candidates for the next review stage only. No persistent database was changed, and this evidence does not authorize production application. External Supabase REST access for premium functionality remains unverified. Invitation write/accept remains unimplemented and unauthorized. A failed migration leaves the separately committed A1-P inert state at boundary 019; a failed R4 leaves canonical 020 committed but capabilities pending. In either case keep signup closed, do not restore auth's legacy INSERTs, and recover only through the reviewed migration/activation path or a separately rehearsed application/backup recovery plan.
