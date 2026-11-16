# CocinaCore code review policy — GGA retired

Owner decision, 2026-11-16: remove GGA from the mandatory CocinaCore workflow. Historical Guardian results and ODD evidence are preserved. This supersedes earlier GGA attempt budgets and mandatory approval rules for future CocinaCore candidates; it is not a retroactive approval of any rejected candidate.

## Required controls

- Review the exact staged diff against the owner-approved scope, including security, tenant isolation, persistence, compatibility and unintended changes.
- Keep the project-native pre-commit Vitest gate active, including the pinned Node version, fresh report validation, nonzero-test requirement and fail-closed behavior.
- Run focused tests, full unit tests, lint, typecheck, build and applicable integration/E2E tests before delivery. CI and repository merge controls remain mandatory.
- Treat confirmed security, data-integrity and functional regressions as blockers. Document false positives and defer unrelated noncritical improvements explicitly.
- Record candidate tree/commit, review evidence, tests, risks and approvals in ODD. Optional external AI review is advisory, never an admission gate.

Do not use --no-verify, falsify results, disable tests, change branch protection or weaken CI. The project-local hook does not invoke the shared Guardian hook. No global hook, other repository or provider configuration is changed. Production, sensitive access and destructive operations remain separately controlled. Merge only the reviewed candidate after its required checks pass and owner authorization is recorded.
