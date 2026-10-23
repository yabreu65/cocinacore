# Guardian Angel pre-commit review policy

## Purpose and scope

Routine Guardian Angel (GGA) reviews invoked by CocinaCore's existing native Git pre-commit hook are preauthorized for the expected files in an approved work unit, within that work unit's applicable attempt budget. This removes per-attempt permission prompts; it does not expand the approved work or replace any other gate.

## Attempt budgets and failure handling

- A commit/candidate is limited to four effective attempts through the existing hook: up to two Codex attempts followed by up to two configured OpenCode attempts.
- If the hook fails, stop that commit and record the failure. Never disable or modify the hook, use `--no-verify`, force approval, or otherwise bypass the gate.
- The owner-authorized M3.4 cap is 16 attempts total across exactly four candidates: R3, U5, PR #55, and readiness. At the time of the owner's decision, five attempts had already been consumed (1 + 1 + 2 + 1), leaving eleven; this cap cannot be reset implicitly. The policy document's own GGA gate is charged to the same cap and does not enlarge it. Check the current ODD attempt ledger before each new hook.
- For a future M milestone that the owner explicitly opens, propose a visible per-phase ceiling in its plan and record actual consumption. Do not infer unlimited authorization or reinterpret the M3.4 cap.

## Pre-hook scope and evidence

Before each GGA invocation:

1. Stage only the files allowed for the approved work unit.
2. Inspect the staged paths for accidental inclusions and secrets; confirm untracked artifacts are not staged.
3. Record the candidate/base and commit SHAs, provider, effective attempt count, result, and any failures in the applicable ODD record.
4. Preserve logs and other review evidence.

Do not alter `.git/hooks/pre-commit`, `.atl/skill-registry.md`, or provider configuration to avoid or weaken the gate. If the hook creates unrelated secondary files, preserve and resolve them safely, and report any findings rather than hiding them.

## Separate approvals remain in force

This GGA authorization grants no new native RDD reviewer runs or captures and does not change candidate-specific RDD scope, forecast, consent, or acknowledgement requirements. It also does not by itself authorize destructive or production tests, sensitive/production access, push, merge, deployment, or other delivery actions. Follow the applicable owner and repository gates for those actions.

Request fresh owner authorization only when the applicable attempt budget is exhausted, the candidate materially expands, sensitive/production access is required, or the provider requires a human decision.
