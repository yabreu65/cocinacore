# Proposal: Engineering Standards

## Intent
Lock in strict engineering standards for the MVP, especially TypeScript safety, repeatable validation, and security-focused testing.

## Scope
### In Scope
- Make `@typescript-eslint/no-explicit-any` an error with no unsafe `any` accepted.
- Prefer `unknown`, schemas, generated DB types, domain DTOs, typed API responses, and typed external clients.
- Require strict environment validation and prevent server secrets in client bundles.
- Establish lint/typecheck/build/test gates and RLS tests.

### Out of Scope
- Full CI provider setup if repository hosting is not ready.
- Large refactors unrelated to safety gates.
- Formatter debate beyond documented default.

## Capabilities
### New Capabilities
- `engineering-standards`: Type safety, validation gates, secret handling, generated types, and RLS test requirements.

### Modified Capabilities
- None

## Approach
Update lint/config/docs and create test scaffolding standards before feature implementation. Fix existing `any` blockers through typed boundaries, not suppression.

## Affected Areas
| Area | Impact | Description |
|------|--------|-------------|
| `frontend/eslint.config.mjs` | Modified | Enforce no explicit/unsafe any. |
| `frontend/src/services/` | Modified | Replace existing `any` with safe types. |
| `supabase/` | Modified | Add RLS testing convention. |
| `README.md` | Modified | Document required gates. |

## Risks
| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Slower initial delivery | Med | Avoid false speed; safety prevents tenant leaks. |
| Missing test runner | Med | Add minimal deterministic scaffolding first. |

## Rollback Plan
Temporarily downgrade new lint rules only with maintainer approval; never merge unsafe `any` into MVP code.

## Dependencies
- Project decision on test runner/CI provider during implementation.

## Success Criteria
- [ ] Lint fails on explicit or unsafe `any`.
- [ ] Existing 5 `any` issues are removed without type suppression.
- [ ] Gates documented: lint, typecheck, build, tests, RLS proof.
