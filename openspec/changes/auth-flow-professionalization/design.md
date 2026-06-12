# Design: Auth Flow Professionalization

## Technical Approach

Professionalize auth as a thin server-controlled layer around Supabase Auth while preserving the current App Router routes and premium UI shell. Client pages keep UX responsibilities; route handlers, middleware, RPCs, and RLS own trust boundaries: reset/OAuth exchange, rate limits, MFA gates, audit writes, and invitation acceptance. This maps to the password-reset, oauth-callback, auth-guard-layer, mfa-enrollment, auth-audit-logging, and invitation-security specs.

## Architecture Decisions

| Option | Tradeoff | Decision |
|---|---|---|
| Call Supabase Auth directly from auth pages | Fast, but cannot enforce auth-specific rate limits before provider calls | Add server route handlers for login/signup/reset/invite acceptance; keep browser client for session UI only |
| Use middleware only for guards | Good early redirects, but expensive/limited DB reads at edge | Middleware enforces session and safe `next`; shared guard helpers load role/tenant/MFA in server/client contexts |
| Store raw invite/backup tokens | Simple, but exposes reusable secrets | Store hashes only; display raw invite/backup codes once |
| Audit from client inserts | Easy, but spoofable | Write audit events through `security definer` RPCs and route handlers with safe metadata |

## Data Flow

```text
Auth form -> /api/auth/* route -> checkRateLimit -> Supabase/Auth RPC
       -> map safe errors -> AuthProvider updates -> middleware/guards redirect

Owner/admin route -> middleware session check -> guard loads users row
       -> password-provider + owner/admin + aal1 => /mfa?next=...

Invite create -> RPC creates hashed token -> email provider or owner-only manual link
Invite accept -> /api/auth/invitations/accept -> rate limit -> RPC validates hash/email/expiry/single-use
```

## File Changes

| File | Action | Description |
|---|---|---|
| `frontend/src/app/(auth)/forgot-password/page.tsx` | Create | Forgot-password UI with neutral success copy and Zod email validation |
| `frontend/src/app/(auth)/reset-password/page.tsx` | Create | Recovery-session password update UI and invalid-link recovery path |
| `frontend/src/app/auth/callback/route.ts` | Create | Supabase OAuth code exchange, safe `next` redirect, error mapping |
| `frontend/src/app/api/auth/*/route.ts` | Create | Server-controlled login, signup, reset, MFA backup, and invite acceptance boundaries |
| `frontend/src/app/(auth)/login/page.tsx` | Modify | Use validation, safe messages, forgot link, callback redirect target |
| `frontend/src/app/(auth)/signup/page.tsx` | Modify | Use validation, safe messages, callback redirect target |
| `frontend/src/app/(auth)/mfa/page.tsx` | Modify | Replace stub with TOTP enrollment, verification, backup code, and recovery UX |
| `frontend/src/app/(auth)/invite/[token]/page.tsx` | Modify | Stop displaying token; call server acceptance route |
| `frontend/src/app/members/page.tsx` | Modify | Replace predictable token creation with server RPC/service and email/manual fallback |
| `frontend/src/context/AuthContext.tsx` | Create | AuthProvider/useAuth exposing session, user, tenant, role, provider, MFA/loading state |
| `frontend/src/lib/auth/guards.ts` | Create | Shared auth, role, tenant, safe-redirect, and MFA policy helpers |
| `frontend/middleware.ts` | Modify | Add safe next handling, owner/admin role gate, MFA redirect gate, public auth callback |
| `frontend/src/services/authService.ts` | Modify | Add reset, OAuth callback helpers, MFA methods, audit/invitation contracts |
| `frontend/src/lib/rate-limit.ts` | Modify | Add auth route configs keyed by IP plus normalized email/token hash where applicable |
| `supabase/migrations/*_auth_audit_and_invite_hardening.sql` | Create | Audit table/RPC/RLS, hashed invite tokens, backup-code hashes, compatibility migration |
| `frontend/src/services/__tests__/authService.test.ts`, `frontend/src/lib/rate-limit.test.ts` | Modify | Cover new auth service contracts and auth limits |

## Interfaces / Contracts

```ts
interface AuthState {
  user: AuthUser | null;
  tenant: TenantContext | null;
  provider: AuthProvider | null;
  mfa: { assuranceLevel: MfaAssuranceLevel; required: boolean; verified: boolean };
  loading: boolean;
}
```

RPCs: `record_auth_audit_event(event_type, tenant_id, actor_id, metadata jsonb)`, `create_tenant_invitation(email)`, `accept_tenant_invitation_v2(token)`, `verify_mfa_backup_code(code)`.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | AuthService reset/OAuth/MFA/invite contracts, safe redirect, error mapping | Vitest stubs, strict typed fixtures |
| Unit | Auth rate limits per IP/email/token | Extend `frontend/src/lib/rate-limit.test.ts` |
| Integration | RPC expiry, single-use tokens, audit RLS, backup code invalidation | Supabase SQL tests/manual migration verification |
| E2E | Forgot/reset, OAuth callback error, MFA gate, invite fallback | Playwright after implementation |

## Migration / Rollout

Use chained PRs: (1) reset/OAuth/error mapping, (2) AuthProvider/guards/rate limits, (3) MFA/backup codes, (4) audit/invite hardening/email fallback. Migration is additive: create audit/backup tables and new token-hash columns; keep legacy invitation tokens readable only during transition, then stop writing them. No destructive resets.

## Open Questions

- [ ] Which email provider should send invitations if Supabase Auth email is not enough?
- [ ] Should legacy predictable invitation tokens remain accepted for a short transition window or be revoked immediately?
