# F5.6 First Platform Administrator Provisioner
Feature: one-use, operator-restricted first platform administrator installation.
Scope: preserve existing RLS/runtime grants; add only the owner-authorized one-use capability; no live provisioning or deployment.

## Specs
- S1: "necesito crear un instalador con las bases de seguridad actual"
- S2: "Provisionador restringido de instalación" — "Un comando de operador crea la cuenta mediante una capacidad DB explícita, mínima y de un solo uso. Requiere diseñar y revisar esa capacidad sin debilitar RLS."
- S3: "Sí, autorizar ese cambio" — "Autorizo diseñar e implementar una función/provisión dedicada y sus grants mínimos; sin ampliar permisos del runtime ni relajar RLS."
- S4: "Activarlo al crear" — "La ejecución autorizada crea el primer administrador activo; falla si ya existe cualquier registro de plataforma."
- S5: "Sí, incluir integración exacta" — "Actualizar allowlists, contratos y secuencia de instalación; mantener todos los gates y no desplegar."
- S6: "Keep the approval reference" — "Require and persist a non-secret owner-approval reference as part of the one-use audit claim."

## Tasks
- T1 — S1-S4, S6 — Add one-use restricted SQL capability, role preparation and DB behavior tests — inline — commit: e1afe82
- T2 — S1-S4, S6 — Rebuild the operator installer with private secret input, explicit target confirmation, CLI tests and usage docs — inline — commit: pending
- T3 — S1-S5, S6 — Integrate migration 024 into exact release/build allowlists and make first-admin role preparation compatible with standalone bootstrap — inline — commit: pending
- T4 — S1-S5, S6 — Run the supported isolated PostgreSQL acceptance flow and independent high-risk review — inline — commit: pending

## Log
- L1: necesito crear un instalador con las bases de seguridad actual
- L2: Provisionador restringido de instalación — Un comando de operador crea la cuenta mediante una capacidad DB explícita, mínima y de un solo uso. Requiere diseñar y revisar esa capacidad sin debilitar RLS.
- L3: Sí, autorizar ese cambio — Autorizo diseñar e implementar una función/provisión dedicada y sus grants mínimos; sin ampliar permisos del runtime ni relajar RLS.
- L4: Activarlo al crear — La ejecución autorizada crea el primer administrador activo; falla si ya existe cualquier registro de plataforma.
- L5: Sí, incluir integración exacta — Actualizar allowlists, contratos y secuencia de instalación; mantener todos los gates y no desplegar.
- L6: "Keep the approval reference" (user-selected option to require and persist a non-secret owner-approval reference in the one-use audit claim).
- L7: Migration 024, runner/release integration, operator installer and operator guidance were implemented. Disposable PostgreSQL 16 tmpfs acceptance passed through migration 024; the first-admin integration passed 1/1, installer tests passed 4/4, and release/migrator/standalone/CI contracts passed.
- L8: Independent read-only review found that `scripts/standalone-bootstrap-db.sh` invokes `scripts/provision-first-platform-admin-roles.sql` through `psql -f`, while that SQL requires interactive target confirmation and `\password`; unattended execution cannot reach migration 024. Read-only exploration found no approved lifecycle for a separate provisioner secret in unattended bootstrap.
- L9: Work was paused pending the owner's choice: retain an explicitly operator-interactive standalone setup with TTY prompts, or define an approved secret source and secure delivery for unattended setup. No persistent database was provisioned and no deployment occurred.
- L10: "yo lo que quiero es el instalador para poder crear el superadministrador es eso"
- L11: The owner clarified the operator-interactive installer as the goal. A fresh independent review reported no findings and judged S1-S6 met on the inspected source and parent-observed disposable acceptance. The explicit port-zero fallback was fixed and covered by a regression test; all 37 focused tests, disposable migrations 001–024, first-admin integration, release, migrator, standalone and CI contracts passed. A full Compose/TTY run was not performed; no persistent database or deployment was touched.
- L12: Delivery strategy: local reviewable work-unit commits only; no push, PR or deployment without a separate owner decision. Slice 1 is commit e1afe82 (1,313 additions, 8 deletions): migration 024, role preparation, exact 024 attestations, manifest and DB integration test are kept together as one high-risk capability boundary. The inventory attestation is intentionally large and is not compressed. Remaining boundaries: (a) provisioner catalog and migration-runner integration with unit/ledger tests; (b) operator installer with CLI tests, command/docs and standalone loopback topology; (c) standalone TTY/bootstrap, acceptance harness and release/CI contracts. Subsequent slices should stay near 400 authored changed lines and include each behavior's tests/docs.
- L13: Slice 2 is commit 5420001 (398 additions, 29 deletions): migration provisioner ownership support, its tests, and this feature document's initial delivery boundary. Its pre-commit Vitest gate passed. The next slice is the narrow migration-runner and ledger-contract change with its test; the operator installer/docs and standalone/release/CI workflow remain separate boundaries.
