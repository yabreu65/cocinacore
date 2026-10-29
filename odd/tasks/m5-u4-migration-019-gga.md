# M5 U4 — Migration 019 GGA Ledger

## Current authorized cycle

- Candidate: `feat/m5-u4`, base HEAD `b574cc3139fe83a94c457cae4abfd61f2500fbbc`
- Provider: Codex only
- Model: `gpt-5.6-luna`
- Reasoning: `medium` via the worktree-local Codex shim
- Provider timeout: 300 seconds; parent Guardian timeout: 600 seconds
- Authorized budget: one additional Codex attempt
- OpenCode: excluded; no invocation is permitted
- Commit gate: pending final normal-hook execution

The attempt result is recorded by `.githooks/gga-codex-pre-commit` in the worktree-local ledger returned by `git rev-parse --git-path gga-codex-attempts.log`. The wrapper preserves timestamp, provider, attempt number, result, HEAD, and branch without writing secrets or business data.

## Historical evidence

- Earlier migration-019 review cycle: two Codex attempts; the first identified a repeatability defect in the disposable fixture test and the second passed after correction.
- Earlier candidates may contain historical OpenCode provider failures. They are preserved as historical evidence only and are not part of the current provider path.
- No historical attempt is deleted, reset, or replayed by this cycle.
