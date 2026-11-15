# Small work units — development protocol

Applies to CocinaCore changes made by humans and coding agents (including Codex and GS). The owner approves product scope; the implementer is responsible for correctness. The existing Guardian review policy and native gates remain mandatory.

## 1. Define before implementing

Record the unit's goal, base commit, allowed paths/responsibilities, acceptance cases, explicit exclusions and review budget in the applicable ODD record. Prefer one observable behavior per unit. Reuse approved modules; do not rebuild them. Avoid incidental formatting, new abstractions, schema changes or dependencies unless required by the contract.

## 2. Verify the smallest complete change

Run focused regression tests, TypeScript, ESLint, the applicable full unit suite and build. Add integration evidence when persistence, authorization or transactions change. Inspect the exact staged diff, including scope, secrets and unexpected files. Run the existing native commit hook within the recorded budget; never weaken or bypass any gate.

## 3. Triage review findings

| Finding | Required action |
| --- | --- |
| Security, tenant isolation or data integrity defect | Treat as a blocker; fix in a scoped unit. Never deliver unsafe behavior. |
| Regression or failed acceptance case | Correct within the unit and add a regression test. |
| Pre-existing non-critical defect unrelated to the unit | Record evidence, impact and a separate follow-up; do not expand automatically. |
| Optional improvement or architectural preference | Record only if useful; no implementation without an agreed need. |
| New capability | Separate product decision and work unit. |

Triage guides implementation, not admission: a failed native review remains failed. An unrelated finding is not permission to ignore the hook, force a pass, hide code, or merge. If a blocker requires additional responsibilities, preserve the candidate, stop the unit and obtain the required owner decision. Keep previous approved commits unchanged.

## 4. Close with evidence

Record exact commit/tree, tests, Guardian attempts and outcome, remaining risks and deferred work. Close only after all applicable gates pass. Do not repeat reviews past the authorized limit. No implicit authorization for push, merge, production, destructive tests or additional review systems.

## Inventory V2 B2 pilot

- Preserve approved B1, B2.1 and B2.3.
- Unit S: hard culinary exclusions (profile + request, plural forms and dietary categories; safe rejection of ambiguous content). No quantities or UI changes.
- Unit D: preserve exact recipe data through extraction, import, history and warmup. No navigation or new recipe generation workflows.
- Unit U: use existing B1/B2.1 math in complete recipe screens; keep invalid/unknown quantities explicit. No new inventory confirmation, shopping, consumption or Today redesign.
- Defer direct generation from Today and RAG fallback to B5; retain the existing workflow. B3/B4 remain separate.
- At most two Codex attempts per unit, no transfer of unused attempts, and stop on exhausted budget. A policy documentation commit uses its own native gate, without relaxing rules.
