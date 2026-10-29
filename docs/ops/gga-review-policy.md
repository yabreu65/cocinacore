# Guardian Angel pre-commit review policy

## Provider and execution model

CocinaCore uses **Codex-only** for its Guardian Angel (GGA) review path. OpenCode is not an allowed provider for CocinaCore commits.

The active worktree path is:

1. `.githooks/pre-commit`
2. `scripts/cocina-quality-gate.mjs` (mandatory Vitest gate)
3. `.githooks/gga-codex-pre-commit` (mandatory Codex review)

The worktree-local `core.hooksPath=.githooks` keeps this policy scoped to the CocinaCore worktree being committed. The shared default hook and global Git hooks are not used by this path and are not modified.

The Codex wrapper prepends `.githooks/bin` only for the GGA child process. Its local `codex` shim invokes the authenticated Codex executable with model `gpt-5.6-luna` and `model_reasoning_effort="medium"`. It does not change the user's global Codex configuration or authentication.

## Attempt budgets and failure handling

- Each candidate has an explicit budget of **one or two Codex attempts**. The wrapper accepts only `GGA_CODEX_ATTEMPTS=1` or `2`; there is no unlimited mode.
- The CocinaCore wrapper defaults to `GGA_TIMEOUT=300` seconds and rejects values above 300 seconds. The GGA provider timeout is therefore 300 seconds, below the 600-second `scripts/cocina-quality-gate.mjs` Guardian child-process limit.
- The current M5 U4 migration candidate is authorized for exactly **one additional Codex attempt**.
- Each attempt runs `gga run --no-cache` with `GGA_PROVIDER=codex`.
- A nonzero result, timeout, missing provider response, invalid budget, or ledger failure blocks the commit.
- The wrapper records timestamp, provider, attempt number, result, HEAD, and branch in the worktree-local GGA ledger returned by `git rev-parse --git-path gga-codex-attempts.log`.
- Never use `--no-verify`, force approval, disable the wrapper, or bypass the Vitest gate.

## Mandatory quality gates

1. The quality gate validates the repository `.nvmrc` and executes Vitest with a fresh JSON report and isolated temporary cache.
2. The quality gate adds `--experimental-require-module` to `NODE_OPTIONS` when needed for the installed Node/Vitest ESM boundary.
3. Guardian review starts only after a valid, non-empty, fully passing Vitest report.
4. The Codex wrapper must be present, executable, and distinct from `.githooks/pre-commit`.
5. Any failed or unavailable gate exits nonzero and prevents the commit.

## Scope and history

The worktree-specific hook configuration affects only this CocinaCore worktree. Other repositories and global hooks are outside this policy. Other CocinaCore worktrees retain their own Git worktree configuration and are not changed by this candidate.

Historical GGA records, including earlier OpenCode attempts from older candidates, remain historical evidence and are not deleted or replayed. They do not authorize OpenCode in the current CocinaCore flow.

Before each candidate, stage only the approved files, inspect staged paths for accidental inclusions and secrets, and preserve the wrapper ledger and review output. A new candidate or material post-review change requires a new explicitly authorized Codex budget.
