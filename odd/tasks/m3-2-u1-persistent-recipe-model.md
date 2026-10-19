# M3.2 U1 — Persistent recipe model

## Goal
Implement the next additive migration for persistent user-owned recipes without duplicating existing AI history, inventory, books/RAG, or premium tables.

## Constraints
- Work only in `feat/m3-2-recetario-inteligente`.
- Preserve `.atl/skill-registry.md`, `.codegraph/`, and all existing data.
- Never connect to the local original DB or production; isolated validation must use a fresh uniquely identified test database/service.
- No deploy, production migration, U2, PR, push, or unrelated refactor.

## Design
- `public.user_recipes`: mutable identity/metadata owned by `tenant_id` + `user_id`, with category and tags; a composite FK requires the pair to exist in `tenant_memberships`.
- `public.user_recipe_versions`: append-only version content with recipe ownership, monotonically positive version number, title/instructions/servings, structured ingredient JSONB array, and nullable link to existing `recipe_ai_history`.
- Composite owner FK from versions to recipes prevents cross-tenant/user ownership mismatch.
- Database trigger rejects updates to version rows; new content is represented by a new version. Parent deletion remains the controlled cascade for tenant/user cleanup.
- Both tables force row-level security using the application transaction settings `app.tenant_id` and `app.user_id`; missing context denies access.
- Existing `recipe_ai_history`, `recipe_inventory_items`, `tenant_books`, `book_chunks`, and premium tables are not repurposed or duplicated.

## Tasks
- [x] Finalize schema against current migration and ownership contracts.
- [x] Add migration `016_persistent_user_recipes.sql` and manifest/checksum/catalog metadata.
- [x] Extend migrator/provisioner forward catalog handling for table/index additions without changing historical baseline counts.
- [x] Add focused static/contract tests for migration metadata and database invariants.
- [x] Validate once against a fresh isolated test database, then commit the work unit.

## Acceptance criteria
- Migration sequence remains continuous and exact-bijective with the manifest.
- Existing manifest checksums and baseline ownership counts remain unchanged.
- New tables enforce tenant/user ownership, positive versions, structured ingredient arrays, category/tags bounds, and immutable version updates.
- Optional AI-history link is nullable and does not duplicate history storage.
- Focused tests and isolated DB validation pass; no local original or production endpoint is contacted.
- `.atl/skill-registry.md` and `.codegraph/` remain untouched.

## Evidence
- U0 hardening commits: `8e0b916`, `8eb9a0f`.
- U0 gate verified: focused Vitest `12/12` and `tsc --noEmit` exit `0` from `frontend/`.
- Current base: `origin/main`/`main` at `0611bead36689945167a081e4c5675d64a87418f`; branch contains the two U0 commits.

## Validation evidence
- Focused persistent-recipe contract: passed.
- Bootstrap/migrator configuration contract: passed.
- Culinary-profile field-constraint contract: passed.
- Node syntax checks for migrator/provisioner: passed.
- Migration dry-run listed `001`–`016`: passed.
- `git diff --check`: passed.
- Disposable M32-U1 runs used only fresh loopback pgvector containers with synthetic credentials. Migration 001–016 application, repeat idempotence, repeat provisioner attestation, and migration-ledger verification passed.
- Post-review database evidence: catalog tables/constraints/indexes/trigger/function and schema-owner checks passed; versioning, constraint rejection, composite tenant/user mismatch, AI-history ownership, immutable update, rollback, and parent membership checks passed across isolated runs.
- Final RLS validation passed in isolated PostgreSQL 16/pgvector: owner-visible, cross-tenant-hidden, cross-tenant-write-rejected, and missing-context-rejected. Provision, migration 001–016, repeat migration, repeat provisioner attestation, and migration-ledger verification all passed.
- Every disposable container was stopped/removed by its owning run; pre-existing container IDs were unchanged. No local 5433, production, Redis, shared service, deploy, or push was used.

## Commit evidence
- Work-unit commit: `a8fa5b5` (`feat(db): add persistent user recipe model`).
