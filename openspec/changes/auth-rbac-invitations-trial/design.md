# Design: Auth RBAC Invitations Trial

## Technical Approach
Use Supabase Auth for sessions and MFA. Store tenant roles, invitations, and trial state in Supabase public schema with RLS. Next.js App Router routes should call typed server-side actions/API handlers for privileged mutations instead of trusting client state.

## Architecture Decisions
| Decision | Choice | Alternatives considered | Rationale |
|----------|--------|-------------------------|-----------|
| Identity | Supabase Auth email/password + Google | Custom auth | Existing Supabase schema already links `auth.users`. |
| RBAC | App tables + RLS helpers | Client-only role checks | Authorization must survive malicious clients. |
| Trial gating | Server/DB write gates | UI-only disabling | Soft block is a business rule and must be non-bypassable. |
| 2FA | Supabase MFA for email/password privileged roles | Universal in-app 2FA | Google OAuth already has provider security; user chose no extra in-app 2FA. |

## Data Flow
    Signup/Login -> Supabase Auth -> public.users membership
       Invite accept -> invitation check -> member insert
       Generate/Upload -> trial gate -> allowed mutation or soft-block error

## File Changes
| File | Action | Description |
|------|--------|-------------|
| `supabase/migrations/*_auth_rbac_trial.sql` | Create | Invitations, role constraints, trial fields, helper functions, RLS. |
| `frontend/src/app/(auth)/...` | Create | Login/signup/MFA/invite route groups. |
| `frontend/src/services/types.ts` | Modify | Auth, invitation, MFA, and trial DTOs. |
| `frontend/src/services/authService.ts` | Create | Typed wrapper around Supabase auth/session contracts. |

## Interfaces / Contracts
```ts
type AuthProvider = 'password' | 'google';
interface Invitation { tenantId: string; email: string; expiresAt: string; role: 'member'; }
interface TrialState { endsAt: string; canGenerate: boolean; canUploadPdf: boolean; }
```

## Testing Strategy
| Layer | What to Test | Approach |
|-------|-------------|----------|
| DB | Invitation expiry, role denial, trial gate | SQL/RLS fixtures. |
| Unit | Trial-state calculation | Date-controlled tests. |
| E2E | Signup, invite accept, expired-trial block | Browser smoke once test runner exists. |

## Migration / Rollout
Add tables/columns first, backfill `trial_ends_at = created_at + 14 days`, then wire UI. Roll back by disabling gates before removing schema.

## Open Questions
- [ ] Final email delivery provider for invitation links.
