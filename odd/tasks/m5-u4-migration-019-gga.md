# M5 U4 — Migration 019 GGA Ledger

## Current administrative cycle

- Candidate: `feat/m5-u4`, base HEAD `e0512b830a757b3998e212e54ef82895007a23ce`
- Scope: six Codex-only GGA hook, policy, quality-gate, test, and ledger-documentation files
- Provider: Codex only
- Model: inherited from the effective Codex CLI configuration
- Reasoning: inherited from the effective Codex CLI configuration
- Provider timeout: 600 seconds; parent Guardian timeout: 660 seconds
- Authorized budget: exactly one additional Codex attempt
- OpenCode: excluded; no invocation is permitted
- Commit gate: pending final normal-hook execution with a matching unused ledger authorization

The attempt result is recorded by `.githooks/gga-codex-pre-commit` in the worktree-local ledger returned by `git rev-parse --git-path gga-codex-attempts.log`. The wrapper requires an unused authorization matching HEAD, branch, staged tree, provider, timeout, and budget, then preserves timestamp, provider, attempt number, result, HEAD, and branch without writing secrets or business data. Missing or consumed authorization fails closed.

## Historical evidence

- Earlier migration-019 review cycle: two Codex attempts; the first identified a repeatability defect in the disposable fixture test and the second passed after correction.
- Earlier candidates may contain historical OpenCode provider failures. They are preserved as historical evidence only and are not part of the current provider path.
- No historical attempt is deleted, reset, or replayed by this cycle.
- The previous administrative candidate was rejected because the wrapper defaulted to two attempts despite a one-attempt authorization; that failure remains historical evidence.
