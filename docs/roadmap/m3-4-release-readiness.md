# M3.4 Release Readiness

**Current state (2026-10-25):** M3.4 product PRs #53–#56, correction PR #58, U5 PR #61, and GGA policy PR #59 are merged to `main` with ancestry-preserving merge commits. Main CI is green through U5; post-PR59 main CI is still running on `bdfb97a64c5ad37cef6c2442efc4ff894233276e` and must pass before PR #60 is merged. Production deployment, production migrations, and production acceptance remain **not performed** and are separately gated; this document does not authorize them.

## Merged implementation and CI evidence

| PR | Scope | Merged commit | Main CI run | Result |
| --- | --- | --- | --- | --- |
| #53 | U1 — quantitative Today availability | `a10871706a702f1169ca8acc398ba30e823088ee` | [40150104612](https://github.com/yabreu65/cocinacore/actions/runs/40150104612) | SUCCESS |
| #54 | U2 — explicit Today servings | `081bb88b7cfcce072bb35ff39128b92007d44484` | [40151001796](https://github.com/yabreu65/cocinacore/actions/runs/40151001796) | SUCCESS |
| #55 | U3 — verified structured recipe quantities | `27409d113607a21e9f267f85efe95149c23ec1d9` | [40151927284](https://github.com/yabreu65/cocinacore/actions/runs/40151927284) | SUCCESS |
| #56 | U4 — migration-free inventory confirmation | `c2f9a00833bc97eea66ce8acd726a875e0f82ed0` | [40152744480](https://github.com/yabreu65/cocinacore/actions/runs/40152744480) | SUCCESS |
| #58 | R3 — inventory/portion correction | `a38f6dfb05fb7794218d2fdc2de187f86eaa923a` | [40153707725](https://github.com/yabreu65/cocinacore/actions/runs/40153707725) | SUCCESS |
| #61 | U5 — hosted connected Today proof and test correction | `40d40a8bc58cac10f6a53912d9e4d2344a8ee748` | [40214765776](https://github.com/yabreu65/cocinacore/actions/runs/40214765776) | SUCCESS |
| #59 | GGA review policy | `bdfb97a64c5ad37cef6c2442efc4ff894233276e` | [40215516582](https://github.com/yabreu65/cocinacore/actions/runs/40215516582) | IN PROGRESS — verify and record its final result before merging #60 |

The exact main-run heads are the merge commits shown above. The run IDs are recorded once; do not dispatch replacement runs. PR #60 is the remaining readiness-document PR.

## U5 verification and native review

- Connected Today workflow-dispatch run [40204398689](https://github.com/yabreu65/cocinacore/actions/runs/40204398689) completed **SUCCESS** on head `1233324ee757cd724e888c3e7ec89b1c2905cc52`; the connected Today Playwright journey ran and passed. This is distinct from the post-merge main CI, where the manual connected journey is skipped.
- Standard PR CI [40204324702](https://github.com/yabreu65/cocinacore/actions/runs/40204324702) also completed **SUCCESS** on that exact U5 head.
- Native RDD lineage `review-a65f7ae25849dd30`, target `sha256:c0e4dddf23ab06e15dfc5834e125cb715436d48abf5e7659d3e05bac90cca509`: the provider-frozen risk, readability, and reliability lenses were admitted once each; review closed **APPROVED** and the exact acknowledgement was completed/burned at revision `sha256:dbedca6b9c7f888644bd45d0924de2c1d5c7817443d804c1eebcdee4a7cc87c0`.
- PR #59 was assessed on its actual tested base `a38f6dfb05fb7794218d2fdc2de187f86eaa923a`: `risk=medium`, `nativeRisk=medium`, `reviewDue=false`. Exact-head CI [40214453804](https://github.com/yabreu65/cocinacore/actions/runs/40214453804) passed both `frontend-quality` and `E2E Tests`; the PR was merged preserving ancestry. Its post-merge main CI is listed above and remains in progress as of this document update.

## Supporting CI repair and duplicate PR disposition

- PR #62 fixed the hosted E2E runner compatibility issue and merged as `1eee89dffd630bb069f8be2fb440be8128063bef`; main CI [40148014808](https://github.com/yabreu65/cocinacore/actions/runs/40148014808) succeeded on that merge commit.
- PR #57 was the duplicate PDF.js fix and is **CLOSED**; it was superseded by merged PR #62 (`1eee89dffd630bb069f8be2fb440be8128063bef`). PR #58 is the separate R3 inventory/portion correction, merged as `a38f6dfb05fb7794218d2fdc2de187f86eaa923a`.

## Earlier local verification

The merged U1–U4 work units had focused/full tests, TypeScript, lint/build, and GGA evidence recorded during implementation. The bounded U5 test correction also passed its local connected Today Playwright journey against disposable test services before publication. Those historical local checks are supplemental; hosted exact-head and main-run results above are the current integration evidence.

## Production status and release gates

**Production remains untouched:** no M3.4 deployment, migration 016/017, production acceptance workflow, or production write has been run. No claim is made here that the current production migration ledger, backup, snapshot rollback, secrets, or application rollback have been verified.

Release planning and non-destructive preflight verification are authorized as part of this closeout. Before any production deployment or migration, record evidence for all of the following against the final `main` SHA:

1. Confirm the exact deployment/migration scope and satisfy the production runbook's applicable approval gate. This closeout authorizes planning and non-destructive preflight checks; it does not by itself prove production prerequisites are met.
2. A current, recoverable CocinaCore backup and a verified snapshot/restore rollback path; validate without modifying other projects on the shared VPS.
3. Exact migration-ledger correlation proving which M3.4 migrations (including 016/017, if applicable) are required and safe; do not invoke migrations without that evidence.
4. Independent validation that required production secrets are present and correctly scoped, without exposing secret values.
5. Required production acceptance checks and operational/cleanup steps from the runbook, with evidence tied to the same final SHA.

Do not invoke production deploy or migration workflows unless these gates are evidenced and the production runbook's approval condition is satisfied. Passing CI and merging PR #60 do not prove backup, rollback, migration-ledger, secrets, or acceptance readiness.

## Remaining closeout sequence

1. Record the final SUCCESS (or failure) for post-PR59 main CI #40215516582 on exact merge commit `bdfb97a64c5ad37cef6c2442efc4ff894233276e`.
2. Run documentation-focused checks and the normal GGA pre-commit hook for this readiness update; commit through that hook and push the existing PR #60 branch without force-pushing.
3. Validate PR #60 exact-head CI, run passive native ASSESS for the committed documentation candidate, and merge with an exact-head guard only after all applicable gates pass.
4. Complete the final-SHA non-destructive production preflight evidence above; stop if backup/restore, migration correlation, secret validation, or required acceptance proof is missing. No deployment or migration occurs as part of this documentation closeout.
