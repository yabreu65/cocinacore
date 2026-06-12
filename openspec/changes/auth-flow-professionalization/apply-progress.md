# Apply Progress: Auth Flow Professionalization

## Mode

Standard Mode. Chained PRs approved with `stacked-to-main` strategy.

## Current PR Boundary

PR 1 slice: password reset, OAuth callback, and safe auth error mapping. This batch intentionally does not implement MFA, audit logging, Resend delivery, or invitation token migration.

## Completed Tasks

- [x] 1.3 Add auth rate-limit configs to `frontend/src/lib/rate-limit.ts`.
- [x] 2.1 Create forgot-password page with validation and neutral success.
- [x] 2.2 Create reset-password page with recovery-session update and expired-link path.
- [x] 2.3 Create auth callback route with OAuth code exchange and safe redirect.
- [x] 2.5 Add safe auth error mapping to login/signup pages.

## Partial / Deferred

- [ ] 2.4 Server auth handlers are partially started for password reset only. Login/signup server-controlled handlers remain for the guard/rate-limit slice.

## Files Changed

- `frontend/src/app/(auth)/forgot-password/page.tsx` — new recovery request UI.
- `frontend/src/app/(auth)/reset-password/page.tsx` — new password update UI.
- `frontend/src/app/auth/callback/route.ts` — new OAuth callback route.
- `frontend/src/app/api/auth/password-reset/request/route.ts` — reset email route with rate limit.
- `frontend/src/app/api/auth/password-reset/update/route.ts` — password update route with rate limit.
- `frontend/src/lib/auth/errors.ts` — safe auth error mapping.
- `frontend/src/lib/auth/safeRedirect.ts` — open-redirect-safe path helper.
- `frontend/src/lib/auth/schemas.ts` — Zod auth schemas.
- `frontend/src/lib/rate-limit.ts` — auth route configs.
- `frontend/src/app/(auth)/login/page.tsx` — forgot link, safe errors, OAuth callback redirect.
- `frontend/src/app/(auth)/signup/page.tsx` — safe errors and OAuth callback redirect.

## Validation

- `npm run lint` — passed.
- `npm run test` — passed (18 files, 139 tests).
- `npm run build` — passed; routes now include `/forgot-password`, `/reset-password`, `/auth/callback`, and password-reset API routes.

## Review

Fresh-context review approved PR 1. Warnings to carry forward: Supabase Auth can still be called directly with anon key, recovery PKCE is same-browser/device sensitive, and login/signup app-level rate limiting remains deferred to PR 2.

## PR 2 Progress

### Current PR Boundary

PR 2 slice: auth state, server-controlled login/signup handlers, guard helpers, and middleware role/MFA gates. This batch intentionally does not implement MFA enrollment UI, audit logging, Resend delivery, or invitation token migration.

### Completed Tasks

- [x] 1.2 Define shared auth types in `frontend/src/lib/auth/types.ts`.
- [x] 2.4 Create server-controlled auth routes for login/signup plus password-reset routes from PR 1.
- [x] 3.1 Create `frontend/src/context/AuthContext.tsx` and wrap the root layout.
- [x] 3.2 Create `frontend/src/lib/auth/guards.ts` with safe redirects, role and MFA policy helpers.
- [ ] 3.3 Modify `frontend/middleware.ts` to enforce owner/admin role and password-provider MFA gates.

### Partial / Deferred

- [x] Middleware now enforces platform-owner access for `/owner` and tenant owner/admin access for `/members`.
- [ ] MFA redirect enforcement is deferred to PR 3 because `/mfa` cannot yet enroll or verify factors.

### Files Changed

- `frontend/src/app/api/auth/login/route.ts` — server-controlled login with rate limiting before Supabase.
- `frontend/src/app/api/auth/signup/route.ts` — server-controlled signup with rate limiting before Supabase.
- `frontend/src/app/(auth)/login/page.tsx` — submits password login through app API route.
- `frontend/src/app/(auth)/signup/page.tsx` — submits password signup through app API route.
- `frontend/src/context/AuthContext.tsx` — shared auth state provider/hook.
- `frontend/src/app/layout.tsx` — wraps app in `AuthProvider`.
- `frontend/src/lib/auth/types.ts` — shared auth state/guard types.
- `frontend/src/lib/auth/guards.ts` — route guard helpers.
- `frontend/src/lib/auth/schemas.ts` — login/signup validation schemas.
- `frontend/middleware.ts` — owner/admin role gate and MFA redirect gate.

### Validation

- `npm run lint` — passed after narrowing middleware profile data from unknown.
- `npm run test` — passed (18 files, 139 tests).
- `npm run build` — passed; routes now include `/api/auth/login` and `/api/auth/signup`.
- `git diff --check` — passed.

### Review

Fresh-context review approved PR 2 after security fixes. Resolved blockers: MFA redirect deferred until PR 3, `/owner` uses platform-owner authority, `/members` uses tenant owner/admin boundaries, OAuth terms cannot silently bypass through app UI/callback, self-provisioning via Supabase metadata is blocked, direct tenant entitlement updates are blocked for non-reviewed platform owners, role changes/removals use controlled RPCs, SQL RLS tests were aligned with RLS visibility semantics, and platform-owner bootstrap is documented.

### Carry Forward

- [ ] PR 3 must implement MFA enrollment/verification before enabling `AUTH_ENFORCE_MFA=true`.
- [ ] PR 4 must harden invitation tokens and move invitation acceptance behind a server-controlled rate-limit boundary.
- [ ] Add explicit SQL regression for service/no-auth entitlement updates if the Supabase test harness supports it.
