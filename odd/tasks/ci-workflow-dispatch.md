# CI workflow_dispatch support — tasks

1. [x] **Confirm the missing-checks baseline** — PR #28 is open at exact SHA `222ab230245ac29884c9417179840c63a287af55`; no Actions run/check-runs exist for that SHA. The prior successful run #39145144621 is for merged PR #27 at `bd6a5f46...`.
2. [x] **Verify GitHub manual-dispatch constraints** — At the baseline inspected for this task, the CI workflow had no `workflow_dispatch`; the implementation commit adds it. Official GitHub documentation says the workflow must be on the default branch to receive manual dispatch; REST `ref` accepts a branch or tag, not an arbitrary commit SHA. A run uses the event's associated ref/commit; verify `head_sha` rather than infer exact-SHA coverage. Do not claim that an unmerged configuration PR validates PR #28's SHA.
3. [x] **Add the minimal manual CI trigger** — Commit `d575b6e3a87317347c1ef23e1f041eb854e28495` adds only `workflow_dispatch:` under `.github/workflows/ci.yml` top-level `on:`; existing `pull_request` and `push` triggers remain intact.
4. [x] **Validate and review the isolated change** — Ruby Psych parsed the workflow; trigger assertions and `git diff --check` passed; Guardian passed. Native review approved the exact two-path candidate at high risk with all four lenses, and its acknowledgement completed. Lineage: `review-d303b9453b0b767f`; target: `sha256:112b5468af4400f21e203d83fca35bea6da430c9234be56bac547f515c2417b7`.
5. [x] **Commit and open a separate PR** — Pushed `ci/workflow-dispatch-20261018` and opened [PR #29](https://github.com/yabreu65/cocinacore/pull/29), linked to approved issue #21 with exactly one available type label, `type:feature`. No merge.
6. [ ] **Verify latest PR heads and CI evidence** — At PR creation, #29 was open at `cd10e9c35e6da4a12fde7f78a80c49da78f82056` with CI run #77 in progress; PR #28 remained open at `222ab230245ac29884c9417179840c63a287af55` with no exact-head run/status/checks. The ODD update changes #29's head; re-query its exact checks and report without claiming #28 validated. — in progress.

## Scope and safety

- Feature branch: `ci/workflow-dispatch-20261018`
- Isolated worktree: `/Users/yoryiabreu/proyectos/cocinacore-worktrees/ci-workflow-dispatch-20261018`
- Base: fetched `origin/main` at `838a19131dcddb7caf6a5e3d11b2381585cbbfbe`
- Only implementation edit surface: `.github/workflows/ci.yml`
- Preserve the existing M3.1 closure worktree and its `.atl`, `.codegraph`, and ODD changes.
- No changes to Deploy/Migrate, CocinaCore runtime, production, or M3.2; no merge or deployment.

## GitHub dispatch evidence

- At base SHA `838a19131dcddb7caf6a5e3d11b2381585cbbfbe`, `.github/workflows/ci.yml` had `pull_request` to `main` and `push` to `main`, with no `workflow_dispatch`; the implementation commit adds only that event.
- GitHub Actions docs: [workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onworkflow_dispatch), [manual runs](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow), [workflow REST API](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event).
- A manual dispatch requires the workflow definition on the default branch. The REST `ref` is a branch or tag name, not an arbitrary SHA; inspect the resulting run's exact `head_sha` before making any SHA-specific claim.
- Since this PR must not be merged, its addition alone cannot make manual dispatch available on default branch or prove a run for PR #28's exact head.

## Delivery evidence

- Implementation commit: `d575b6e3a87317347c1ef23e1f041eb854e28495` (`ci(workflows): enable manual CI dispatch`).
- Native review: approved at high risk with four lenses; exact acknowledgement completed for the candidate above.
- Dedicated PR: [#29](https://github.com/yabreu65/cocinacore/pull/29), OPEN, base `main`, linked issue #21, label `type:feature`.
- At PR creation, head was `cd10e9c35e6da4a12fde7f78a80c49da78f82056`; CI run #77 (`pull_request`) was in progress. Recheck after this ODD record update changes the PR head.
- PR #28 remains OPEN at exact SHA `222ab230245ac29884c9417179840c63a287af55`; no exact-head Actions run/check-run was found. It is not CI-validated.
