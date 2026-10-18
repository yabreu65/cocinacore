# CI workflow_dispatch support — tasks

1. [x] **Confirm the missing-checks baseline** — PR #28 is open at exact SHA `222ab230245ac29884c9417179840c63a287af55`; no Actions run/check-runs exist for that SHA. The prior successful run #39145144621 is for merged PR #27 at `bd6a5f46...`.
2. [x] **Verify GitHub manual-dispatch constraints** — The current CI workflow has no `workflow_dispatch`. Official GitHub documentation says the workflow must be on the default branch to receive manual dispatch; REST `ref` accepts a branch or tag, not an arbitrary commit SHA. A run uses the event's associated ref/commit; verify `head_sha` rather than infer exact-SHA coverage. Do not claim that an unmerged configuration PR validates PR #28's SHA.
3. [ ] **Add the minimal manual CI trigger** — Implementation is present in the isolated worktree and static checks passed; the work-unit commit and Guardian review are pending.
4. [ ] **Validate and review the isolated change** — Ruby Psych parsed the workflow; assertions confirmed `workflow_dispatch`, `pull_request.branches == [main]`, and `push.branches == [main]`; `git diff --check` passed. Guardian/native review and exact-path commit review remain pending.
5. [ ] **Commit and open a separate PR** — Link approved issue #21, apply exactly one appropriate type label, and report the GitHub default-branch/ref limitation. Do not merge. Do not claim CI validated SHA `222ab230...` unless a run's `head_sha` exactly matches.

## Scope and safety

- Feature branch: `ci/workflow-dispatch-20261018`
- Isolated worktree: `/Users/yoryiabreu/proyectos/cocinacore-worktrees/ci-workflow-dispatch-20261018`
- Base: fetched `origin/main` at `838a19131dcddb7caf6a5e3d11b2381585cbbfbe`
- Only implementation edit surface: `.github/workflows/ci.yml`
- Preserve the existing M3.1 closure worktree and its `.atl`, `.codegraph`, and ODD changes.
- No changes to Deploy/Migrate, CocinaCore runtime, production, or M3.2; no merge or deployment.

## GitHub dispatch evidence

- `.github/workflows/ci.yml` currently has `pull_request` to `main` and `push` to `main`, with no `workflow_dispatch`.
- GitHub Actions docs: [workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onworkflow_dispatch), [manual runs](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow), [workflow REST API](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event).
- A manual dispatch requires the workflow definition on the default branch. The REST `ref` is a branch or tag name, not an arbitrary SHA; inspect the resulting run's exact `head_sha` before making any SHA-specific claim.
- Since this PR must not be merged, its addition alone cannot make manual dispatch available on default branch or prove a run for PR #28's exact head.

## Delivery evidence

- Implementation commit: pending.
- Dedicated PR and CI evidence: pending.
