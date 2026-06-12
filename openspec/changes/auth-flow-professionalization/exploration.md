## Exploration: Auth Flow Professionalization

### Current State

The CocinaCore auth layer is functional for MVP but has significant gaps before production. The existing pieces are:

- **Login** (`/login`): Email/password + OAuth (Google, GitHub). No brute-force protection, no account lockout, generic error messages, no "remember me" persistence, and no CSRF token handling.
- **Signup** (`/signup`): Email/password + OAuth. Stores `terms_accepted_at` metadata. Has a client-side timeout (15s) but no server-side validation of terms. No email verification confirmation page/callback exists.
- **Middleware** (`middleware.ts`): Uses `@supabase/ssr` `createServerClient`, checks `getUser()`, and redirects unauthenticated users to `/login` with `next` param. Protects `/app`, `/owner`, `/members`, `/billing`, `/dashboard`, `/library`, `/meal-planner`, `/premium`, `/profile`, `/recipes`. Only checks session existence, not role/tenant. Public paths set includes `/login`, `/signup`, `/invite`, `/mfa`.
- **MFA page** (`/mfa`): A stub form with no real implementation. No enrollment flow, no TOTP setup, no verification logic. The `AuthService` has `requiresMfaEnrollment` and `getMfaAssuranceLevel` but no UI wiring.
- **Invitation flow** (`/members` + `/invite/[token]`): Owners/admins can create invitations via `tenant_invitations` table. Invitees accept via RPC `accept_tenant_invitation`. No email delivery — links are manual. Token is a simple concatenated string, not a cryptographically secure random token.
- **Onboarding** (`/onboarding`): Stores preferences in localStorage, then persists to `user_culinary_profiles` and `user_culinary_profile_terms`. Only redirects to `/onboarding` if `onboarding_completed === false`.
- **AuthService** (`services/authService.ts`): Thin wrapper around Supabase auth with invitation/trial helpers. Has unit tests covering sign-in, OAuth, MFA policy, and invitation expiry.
- **Rate limiting** (`lib/rate-limit.ts`): Redis-backed with in-memory fallback. Covers API routes (`recipe-generate`, `meal-plan`, etc.) but **no auth-specific rate limiting** (login, signup, invite, password reset).
- **RLS / DB**: Strong tenant isolation with `get_auth_tenant_id()`, `can_manage_tenant_members()`, `is_tenant_member()`, and per-table policies. Auth triggers (`handle_new_user`) normalize roles and create tenants.
- **No forgot/reset password flow**: The login page has a dead link (`<a href="#">¿Olvidaste tu contraseña?</a>`) with no actual page or Supabase `resetPasswordForEmail` call.
- **No auth callback route**: OAuth redirects to `/app` directly. No `/auth/callback` route to handle OAuth exchange, session establishment, or post-login redirects.
- **No centralized auth context/hook**: Every page calls `getSupabaseBrowserClient().auth.getUser()` independently. No `AuthProvider` or `useAuth()` hook.
- **No audit/security events**: No logging of sign-in attempts, password resets, invitation acceptances, or MFA enrollment.
- **Secret handling**: `serverLogger` strips secrets from logs. No `NEXT_PUBLIC` service role key exposure detected. Supabase service role key is used server-side in `/api/health`.
- **Password policy**: Only `minLength={8}` in the signup form. No complexity requirements, no breach-checking, no zxcvbn integration.
- **Session management**: No visible session list, no "sign out all devices", no session expiry UI.
- **Error copy**: Raw Supabase error messages exposed to users (`error.message`). No human-friendly mapping for common cases (invalid credentials, user not found, rate limited, email not confirmed).
- **Loading states**: Present but inconsistent. `oauthLoading` state exists but no disabled styling beyond opacity.
- **Form validation**: Manual `FormData` extraction and basic checks. No schema validation (Zod) on auth forms.
- **Invite token security**: Token format is `${tenantId}:${email}:${Date.now()}`. Predictable, not random, not hashed. Should be cryptographically secure.
- **MFA enforcement**: Business logic says owner/admin password users require MFA, but no UI enforcement or redirect to MFA enrollment after login.

### Affected Areas
- `frontend/src/app/(auth)/login/page.tsx` — missing security, UX, and recovery features
- `frontend/src/app/(auth)/signup/page.tsx` — missing validation, confirmation, and callback handling
- `frontend/src/app/(auth)/mfa/page.tsx` — stub, needs full implementation
- `frontend/src/app/(auth)/invite/[token]/page.tsx` — works but needs email delivery and token hardening
- `frontend/src/middleware.ts` — only session check, no role/tenant enforcement, no MFA gate
- `frontend/src/services/authService.ts` — good foundation, needs extension for password reset, audit, session mgmt
- `frontend/src/lib/rate-limit.ts` — missing auth route coverage
- `frontend/src/lib/supabaseClient.ts` — basic browser client, no SSR wrapper for auth pages
- `supabase/migrations/20260522143000_auth_rbac_trial.sql` — invitation token generation is weak
- `supabase/migrations/20260522120000_security_tenancy.sql` — strong RLS but no auth event logging

### Approaches

1. **Minimal Patch (MVP Hardening)** — Add only the missing critical flows without architectural changes
   - Add `/forgot-password` and `/reset-password` pages using Supabase built-in
   - Add `/auth/callback` for OAuth
   - Add rate limiting to login/signup/reset endpoints
   - Improve error copy mapping
   - Add `zxcvbn` or simple password strength indicator
   - Replace invitation token with `crypto.randomUUID()`
   - Pros: Fastest to implement, low risk, closes biggest security gaps
   - Cons: Still no centralized auth state, no MFA UI, no audit log
   - Effort: Low

2. **Professional Auth Layer** — Create a proper auth subsystem
   - Add `AuthContext` + `useAuth()` hook with session, user, tenant, role, and MFA state
   - Refactor middleware to use `getUser()` + role/tenant assertions for `/owner` and `/admin` routes
   - Build MFA enrollment and verification UI (TOTP QR, backup codes)
   - Implement full forgot/reset password with email templates
   - Add `/auth/callback` with session exchange and `next` redirect
   - Add auth-specific rate limiting and brute-force protection
   - Add audit log table + RPCs for auth events (login, logout, MFA, invite, reset)
   - Add password strength meter with real-time feedback
   - Add server-side form validation with Zod for all auth forms
   - Add "Remember me" / session persistence control
   - Add invitation email delivery (via Supabase Edge Functions or external service)
   - Pros: Production-ready, scalable, good UX, strong security posture
   - Cons: Larger change, more files, requires testing, may exceed 400-line PR budget
   - Effort: Medium-High

3. **Enterprise Auth** — Full SSO + security operations center features
   - SAML/OIDC support, SCIM provisioning, admin dashboard for security events
   - This is overkill for current MVP stage
   - Pros: Future-proof
   - Cons: Massive scope, not justified by current requirements
   - Effort: High

### Recommendation

**Approach 2 (Professional Auth Layer)** — but delivered in chained PRs to respect the 400-line review budget.

Reasoning:
- The app already has strong DB-level RLS and tenant isolation. The frontend auth layer is the weak link.
- Missing password reset, MFA UI, and proper callback handling are blockers for production readiness.
- The current "every page calls getUser()" pattern is brittle and will cause bugs as the app grows.
- Security skill requirements (brute force, audit, input validation, token hardening) are non-negotiable for a multi-tenant SaaS.

### Risks
- **OAuth redirect without callback**: If Supabase OAuth fails mid-flow, the user lands on `/app` without a session and gets a confusing blank/error state.
- **Predictable invitation tokens**: A malicious user could guess pending invitation tokens and join a tenant they weren't invited to (if email validation is bypassed or guessed).
- **No brute-force protection**: Login endpoint can be hammered indefinitely, enabling credential stuffing.
- **Raw Supabase errors**: Exposing internal error messages can leak user existence (e.g., "User not found" vs "Invalid credentials").
- **MFA stub**: The presence of an `/mfa` route suggests MFA is available, but it's non-functional. This is a liability if users expect it.
- **No audit trail**: If a tenant member is removed or an invitation is accepted, there's no log of who did it and when. Critical for SaaS trust.
- **Middleware does not enforce role-based access**: `/owner` routes are protected by session only; role checks are deferred to the page. A member with a valid session could navigate to `/owner` and see the page shell before client-side checks reject them.
- **Password reset link is a dead anchor**: Creates a UX trap and signals an unfinished product.

### Ready for Proposal

**Yes**, with a note to the user that the auth layer has solid DB foundations but the frontend needs professionalization. The key gaps are:
1. Password reset flow (missing entirely)
2. OAuth callback handling (missing entirely)
3. MFA enrollment & enforcement (stub only)
4. Brute-force / rate-limit protection on auth routes
5. Centralized auth state and role-based route guards
6. Audit logging for security events
7. Invitation token hardening and email delivery

The next phase should be **sdd-propose** to define the scope, then **sdd-spec** to detail each flow with Given/When/Then, then **sdd-tasks** to plan chained PRs.
