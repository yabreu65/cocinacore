# Tasks: Auth Flow Professionalization

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 900–1500 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 → PR 4 |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Password reset + OAuth + error mapping | PR 1 | base = feature/tracker branch |
| 2 | AuthProvider + guards + rate limiting | PR 2 | base = PR 1 branch |
| 3 | MFA enrollment + backup codes | PR 3 | base = PR 2 branch |
| 4 | Audit + invite hardening + email | PR 4 | base = PR 3 branch |

## Phase 1: Foundation

- [ ] 1.1 Create migration `*_auth_audit_and_invite_hardening.sql` — audit table/RPCs/RLS, hashed tokens, legacy compat
- [x] 1.2 Define shared types in `frontend/src/lib/auth/types.ts` — AuthState, SafeErrorMap, GuardResult
- [x] 1.3 Add auth rate-limit configs to `frontend/src/lib/rate-limit.ts` — per IP + email hash for login/signup/reset/invite

## Phase 2: PR 1 — Reset, OAuth, Error Mapping

- [x] 2.1 Create `forgot-password/page.tsx` — Zod email form, Supabase reset, neutral success
- [x] 2.2 Create `reset-password/page.tsx` — recovery session update, expired-link re-request
- [x] 2.3 Create `auth/callback/route.ts` — OAuth code exchange, safe next redirect, error map
- [x] 2.4 Create `api/auth/*/route.ts` — server handlers with rate-limit before Supabase calls
- [x] 2.5 Add safe error mapping to login/signup pages — replace raw `error.message`

## Phase 3: PR 2 — Auth State, Guards, Rate Limits

- [x] 3.1 Create `context/AuthContext.tsx` — AuthProvider + useAuth with session/user/tenant/role/MFA
- [x] 3.2 Create `lib/auth/guards.ts` — requireAuth, requireRole, requireMfa, safeRedirect
- [ ] 3.3 Modify `middleware.ts` — integrate guards, owner/admin role gate, MFA redirect gate

## Phase 4: PR 3 — MFA Enrollment

- [ ] 4.1 Rewrite `mfa/page.tsx` — TOTP enrollment QR/secret, verification, factor activation
- [ ] 4.2 Add backup-code display after enrollment — show once, store hash only
- [ ] 4.3 Add backup-code verification — single-use invalidation
- [ ] 4.4 Add MFA recovery UX — backup-code path guidance

## Phase 5: PR 4 — Audit, Invitations, Email

- [ ] 5.1 Wire audit RPCs into auth flows — login/logout/reset/MFA/invite events
- [ ] 5.2 Modify `invite/[token]/page.tsx` — call server acceptance via RPC, hide raw token
- [ ] 5.3 Modify `members/page.tsx` — RPC token creation, Resend email or manual fallback
- [ ] 5.4 Extend `services/authService.ts` — reset, OAuth, MFA, audit, invite contracts
- [ ] 5.5 Revoke legacy predictable tokens — stop writing during migration

## Phase 6: Testing

- [ ] 6.1 Extend auth service tests — cover reset, OAuth, MFA, invite contracts
- [ ] 6.2 Extend rate-limit tests — cover auth-specific configs per IP + email
- [ ] 6.3 Write integration tests for migration RPCs — expiry, single-use, audit RLS
- [ ] 6.4 Write E2E scenarios — forgot/reset, OAuth error, MFA gate, invite accept

## Phase 7: Cleanup

- [ ] 7.1 Remove legacy predictable token generation code from members page
- [ ] 7.2 Update docs for new auth flows and Resend config
