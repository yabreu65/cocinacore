# Proposal: Auth Flow Professionalization

## Intent

CocinaCore's frontend auth is MVP-level. Missing production features: password reset, OAuth callback, MFA UI, brute-force protection, centralized auth state, role guards, audit logging, and secure invitations. This change professionalizes the auth subsystem for multi-tenant SaaS.

## Scope

### In Scope
- Password reset (forgot / reset)
- OAuth callback
- MFA enrollment/verification
- Auth rate limiting
- Centralized auth state + guards
- Audit logging
- Secure invitations
- Error mapping + Zod validation

### Out of Scope
- SSO/SAML or enterprise identity providers
- Session management UI
- Password breach checking

## Capabilities

### New Capabilities
- `password-reset`: Forgot and reset password flows via Supabase
- `oauth-callback`: OAuth handler with session exchange and redirect
- `mfa-enrollment`: TOTP setup, backup codes, and enforcement for owner/admin
- `auth-guard-layer`: AuthProvider, useAuth, role/tenant middleware guards, and auth rate limiting
- `auth-audit-logging`: Audit table and RPCs for auth events
- `invitation-security`: Secure tokens and invitation email delivery

### Modified Capabilities
None.

## Approach

Deliver in chained PRs to stay under the 400-line review budget.
- PR 1: Password reset + OAuth callback + error mapping
- PR 2: Auth context + middleware guards + rate limiting
- PR 3: MFA enrollment + verification
- PR 4: Audit logging + invitation token hardening + email delivery

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `app/(auth)/forgot-password` | New | Forgot password form |
| `app/(auth)/reset-password` | New | Reset password form |
| `app/auth/callback` | New | OAuth exchange route |
| `app/(auth)/mfa` | Modified | TOTP enrollment/verification |
| `context/AuthContext.tsx` | New | AuthProvider + useAuth |
| `middleware.ts` | Modified | Role/tenant/MFA guards |
| `services/authService.ts` | Modified | Reset, audit, MFA |
| `lib/rate-limit.ts` | Modified | Auth coverage |
| `supabase/migrations/` | Modified | Audit table, token hardening |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| OAuth mid-flow failure | Med | Error state |
| Credential stuffing | Med | Rate limiting |
| Predictable invite tokens | Low | `crypto.randomUUID()` |
| Raw error leakage | Med | Human-friendly errors |
| MFA stub liability | Low | Implement fully or remove |

## Rollback Plan

Revert PR branch. New routes additive; guards feature-flagged. If middleware breaks, revert to session-only checks.

## Dependencies

- Supabase email templates for reset and invite
- Existing Redis or in-memory rate-limit backend

## Success Criteria

- [ ] Password reset works
- [ ] OAuth callback works
- [ ] MFA enforced for owner/admin
- [ ] Auth endpoints rate-limited
- [ ] Middleware rejects mismatches
- [ ] Audit log populated
- [ ] Secure invite tokens
