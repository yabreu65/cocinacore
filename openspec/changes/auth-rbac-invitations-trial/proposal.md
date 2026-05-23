# Proposal: Auth RBAC Invitations Trial

## Intent
Define MVP authentication, tenant RBAC, invitations, and trial soft-block behavior with security-first defaults.

## Scope
### In Scope
- Email/password and Google OAuth authentication.
- Owner/Admin/Member authorization and invited-member lifecycle.
- Mandatory 2FA for Owner/Admin email-password users; optional for Members.
- 14-day trial soft block after expiry.

### Out of Scope
- Billing, payments, invoices, and plan upgrades.
- Extra in-app 2FA for Google OAuth.
- Enterprise SSO.

## Capabilities
### New Capabilities
- `auth-rbac-trial`: Auth methods, role rules, invitations, membership transition, and trial gating.

### Modified Capabilities
- None

## Approach
Use Supabase Auth as identity provider, store application RBAC and invitation state in public tables protected by RLS, and gate write-heavy premium actions through server-side trial checks.

## Affected Areas
| Area | Impact | Description |
|------|--------|-------------|
| `supabase/migrations/` | Modified | Add invitations, memberships, 2FA flags, trial timestamps. |
| `frontend/src/app/` | Modified | Login, onboarding, invitation acceptance flows. |
| `frontend/src/services/` | Modified | Auth/session and authorization contracts. |

## Risks
| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Privilege escalation | High | Server-side role checks and RLS. |
| Trial bypass | Med | Gate recipe generation/PDF upload in DB/server paths. |

## Rollback Plan
Disable new UI routes and revert additive auth/trial migration. Existing user records remain readable while gates are relaxed.

## Dependencies
- Supabase Auth email/password, OAuth, MFA APIs.

## Success Criteria
- [ ] Owner/Admin email-password users cannot proceed without 2FA.
- [ ] Invitations expire after 30 days and accepted users become Members.
- [ ] Expired trial users can view data but cannot generate recipes or upload PDFs.
