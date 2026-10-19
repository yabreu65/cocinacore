# M3.2 U2 — Persistent recipe APIs

## Goal
Implement tenant/user-scoped persistent recipe APIs and repositories over migration 016, with additive archive state in migration 017.

## Constraints
- Work only in `feat/m3-2-recetario-inteligente`.
- Preserve `.atl/skill-registry.md`, `.codegraph/`, and unrelated `odd/tasks/m3-2-u0-e2e-target-hardening.md` changes.
- No local PostgreSQL 5433, production, Redis, deploy, push, U3, or U4.
- Reuse existing auth, validation, DB, error, and route conventions.
- Archive is non-destructive and persisted by `archived_at` in migration 017.

## Planned scope
- Manual create, scoped list/search, detail, append-only edit, version listing, restore-as-new-version, and archive/unarchive without deletion.
- Duplicate detection is advisory only and never deletes or rejects the request solely for similarity.
- All reads/writes are scoped by authenticated tenant and user; repository transactions set `app.tenant_id` and `app.user_id` for forced RLS.
- Concurrent version creation serializes on the parent recipe row and relies on the unique version constraint as a second guard.

## Tasks
- [x] Add migration 017 archive state and manifest/catalog/checksum contract.
- [ ] Implement scoped recipe repository and validation/error contracts.
- [ ] Implement recipe API routes with compatibility-preserving auth and response DTOs.
- [ ] Add focused repository/route/contract tests and run authorized isolated checks.
- [ ] Commit each validated work unit and record SHAs.

## Acceptance criteria
- No destructive recipe/version deletion for archive or restore.
- Version rows are never updated; edits/restores append a new version.
- Cross-tenant/user access returns not-found semantics and does not leak ownership.
- Duplicate detection returns a warning signal without deleting or rejecting the recipe.
- Validation and database errors are safe and stable; concurrency is transactional.
- Existing M1–M3.1 routes/tests remain compatible.

## Evidence
- U1 commits: `a8fa5b5`, `8f0ce74`.
- Archive representation selected by user: additive `archived_at` column in migration 017.

## Validation evidence
- Migration 017 static contract: passed.
- Bootstrap/migrator configuration and U1 persistent-recipe contracts: passed.
- SQL checksum/byte-length and diff checks: passed.

## Commit evidence
- Task 1 commit pending.
