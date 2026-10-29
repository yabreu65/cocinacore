# Guardian Angel pre-commit review policy

## Provider and execution model

CocinaCore uses **Codex-only** for its Guardian Angel (GGA) review path. OpenCode is not an allowed provider for CocinaCore commits.

The active worktree path is:

1. `.githooks/pre-commit`
2. `scripts/cocina-quality-gate.mjs` (mandatory Vitest gate)
3. `.githooks/gga-codex-pre-commit` (mandatory Codex review)

The worktree-local `core.hooksPath=.githooks` keeps this policy scoped to the CocinaCore worktree being committed. The shared default hook and global Git hooks are not used by this path and are not modified.

The GGA invocation does not set a model or reasoning override. GGA calls the authenticated `codex exec` CLI directly, so model and reasoning inherit the effective Codex CLI configuration. OpenCode is not an allowed fallback.

## Attempt budgets and failure handling

- Each candidate has an explicit budget of **one Codex attempt**. The wrapper defaults to and accepts only `GGA_CODEX_ATTEMPTS=1`; any other value is rejected.
- The wrapper requires an unused append-only ledger authorization matching the current HEAD, branch, staged tree, provider, timeout, and one-attempt budget before invoking GGA. A consumed or missing authorization blocks the commit.
- The global GGA timeout is `600` seconds. The CocinaCore wrapper defaults to and caps `GGA_TIMEOUT=600` seconds. The Node quality gate allows 660 seconds for the Guardian child process, leaving a finite parent grace period for cleanup and result propagation.
- The current M5 U4 administrative candidate is authorized for exactly **one additional Codex attempt**.
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
