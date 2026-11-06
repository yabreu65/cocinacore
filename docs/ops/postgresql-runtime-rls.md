# Restricted PostgreSQL runtime

The reviewed runtime identity is `cocinacore_runtime_rls`. It is validated on an isolated database with migrations 001–019. It is **not yet activated in the existing persistent local stack or production**.

> **Legacy RLS finding: NO-GO.** The restricted role and the nine protected M6 tables are not a universal tenant-isolation fix. Several legacy tables still have explicit grants without database-enforced RLS. This document records the residual risk and the required design gate; it must not be read as approval to activate the role or as proof that malformed SQL is tenant-safe.

## Privilege boundary

The canonical, explicit table/function ACL matrix is `scripts/provision-runtime-role.sql`; the integration harness executes that exact file, rather than recreating test-only grants.

- LOGIN, NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOINHERIT.
- No object ownership or role memberships. CONNECT on the target database and USAGE on public; no schema CREATE, database CREATE/TEMP, migration-ledger access, or sequence grants (application IDs are UUIDs).
- Per-table DML only for existing SQL consumers. Immutable versions/events/reconciliation records receive SELECT/INSERT, not UPDATE/DELETE. Mutable aggregates receive their required UPDATE privileges. No blanket ALL grant.
- Three application functions are executable: match_chunks, is_valid_culinary_profile_text_list and is_valid_culinary_household_members. Other application functions lose PUBLIC EXECUTE in this isolated database. Extension functions remain available; no SECURITY DEFINER helper is introduced.
- Legacy auth, inventory, meal-plan and profile tables without RLS retain server-side authorization and explicit user/tenant predicates. This role does **not** provide database-enforced isolation for every legacy table. Auth lookup and signup legitimately need access before tenant context exists.
- The nine protected tables use FORCE RLS. Recipe/cooking repositories set app.tenant_id/app.user_id with transaction-local set_config, preventing pooled context leakage after commit/rollback. The trusted backend selects that context; arbitrary SQL execution remains outside this threat boundary.

The provisioner rejects adoption of privileged/unmarked roles, memberships, ownership and unexpected PUBLIC relation grants. It is transactional and repeatable. Its PUBLIC hardening is database-wide: **never run it on a shared service database**. Supplying a password sets that role's password; reprovisioning an active role therefore requires a planned credential change and connection-pool restart. PostgreSQL roles are cluster-wide even though grants are database-local.

## Evidence

`bash scripts/test-signup-real-schema.sh` creates an owned, private tmpfs PostgreSQL container, applies/verifies migrations 001–019, verifies rejection of a privileged role fixture without altering it, provisions twice, then runs tests as the restricted login. The admin connection is used only for fixture setup, catalog verification and fault injection, never as the application request connection.

Results: 21 integration tests PASS, zero FAIL/SKIP. Coverage includes signup/rollback/commit failure/retry/concurrent duplicate email, exact ACLs, all nine populated RLS tables, foreign/missing-context reads and inserts, UPDATE/DELETE denial by RLS or ACL, one reused backend across commit/rollback, and real M5 lifecycle/reconciliation plus M6 teacher context. Legacy inventory/profile consumers are exercised with their explicit predicates. The role's SQL privileges do not replace application authorization on those legacy tables.

A compatibility defect was fixed by removing FOR UPDATE from immutable reconciliation/claim reads: those locks require UPDATE ACL and are unnecessary because the aggregate locks and unique constraints serialize writers. Unit and real restricted-role concurrent/idempotent reconciliation tests cover the change.

## Legacy isolation proof and remediation gate

The finding is directly reproducible on the disposable schema before any application route is involved. After inserting one inventory row for tenant A and one for tenant B, run as `cocinacore_runtime_rls`:

```sql
select set_config('app.tenant_id', '<tenant-a>', true);
select set_config('app.user_id', '<user-a>', true);
select tenant_id from public.recipe_inventory_items order by tenant_id;
```

Because `recipe_inventory_items` has no policy, the final query is governed only by the table grant and returns both tenants; omitting the context does not deny the query. The same proof applies to the legacy tenant-scoped inventory movements, AI history, meal plans, shopping items, tenant books/PDFs and culinary profiles. Existing repository predicates prevent the tested HTTP paths from making this malformed query, but they do not turn the database grant into an isolation boundary.

Closing this finding requires a separately approved additive migration and compatibility run, not a documentation-only grant change:

1. Split auth bootstrap/login from tenant-scoped runtime access, because signup and session lookup currently require pre-tenant reads of `tenants`, `users`, `tenant_memberships` and `sessions`.
2. Add a strict, fail-closed tenant-context helper and policies for each legacy table with a complete tenant relationship. Treat mixed global/tenant `book_chunks` separately and resolve the `user_culinary_profile_terms` relationship before writing a policy.
3. Provision only the reviewed non-superuser/non-`BYPASSRLS` role, then run populated tenant A/B, missing-context, malformed-context, role-privilege, signup and background-worker tests against the exact connection configuration. Keep a reversible connection switch and an approved rollback plan.

Until those gates pass, the correct disposition for the legacy finding is **NO-GO**; do not add broad RLS policies or revoke the current grants speculatively.

## Persistent local activation plan — not executed

The inspected container is labelled as the CocinaCore compose service owned by the main worktree, not this M6 worktree. Its configured identity cocinacore_user is a superuser/BYPASSRLS and owns legacy objects. At inspection, only the diagnostic psql connection was visible; this snapshot does not prove no future consumer exists. The application container was absent. The database did not contain the M6 policy tables. No persistent role, grant, credential or data was changed.

Before activation, the PM/operator must approve the target and maintenance window:

1. Verify all consumers, recoverable backup and migration ledger in that exact project database. Rehearse/bootstrap the separate migration lane; apply pending migrations under an approved migration identity, not the runtime.
2. Review the provisioner's database-wide PUBLIC changes and cluster-wide role name collision checks. Provision the restricted role with a new secret through a non-logged administrative session; do not reuse or change cocinacore_user.
3. Change only the application's connection configuration to that role and restart its pool. The compose app environment currently overrides env-file DATABASE_URL, so changing only an env file is insufficient. Do not commit credentials.
4. Run local authenticated signup, inventory/profile, M5/M6 and cross-tenant smoke tests using that actual configuration. Preserve old configuration for controlled rollback without deleting the new role or data.

No production identity or grants were inspected. Production activation, backup/migration readiness, credential delivery, representative p95 and deployment authorization remain separate gates. Disposable success is a GO for the restricted configuration design, not proof of activation or production readiness.
