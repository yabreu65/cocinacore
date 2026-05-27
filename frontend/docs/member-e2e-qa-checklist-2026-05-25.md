# CocinaCore — Member E2E QA Checklist (2026-05-25)

## Scope

End-to-end smoke for the member journey after:
- member management hardening
- plan limits visibility/enforcement (Home/Professional)
- API structured observability logs

## Environment

- App URL: `http://localhost:3000`
- Supabase local stack running
- Local DB migrations applied

## Journey Checklist

1. Signup/Login
- [ ] Create account
- [ ] Login (password or Google)
- [ ] Session persists after refresh

2. Onboarding/Profile
- [ ] Complete onboarding
- [ ] Verify culinary profile saved

3. Inventory
- [ ] Add ingredient
- [ ] Update existing ingredient
- [ ] Confirm persisted after reload

4. Recipe Assistant
- [ ] Generate recipe in PDF mode
- [ ] Generate recipe in assistant-only mode
- [ ] Validate recipe appears in history
- [ ] Add feedback (Me gustó / No me gustó)

5. Library + Plan Limits
- [ ] Upload PDF under plan limit
- [ ] Verify count increases
- [ ] Home plan blocks upload at 5 PDFs
- [ ] Professional plan supports up to 15 PDFs
- [ ] Deletion permissions:
  - [ ] owner/admin can delete any PDF
  - [ ] member can delete only own uploads

6. Meal Planner
- [ ] Generate weekly plan
- [ ] Save plan
- [ ] Regenerate week/day
- [ ] Generate inventory suggestion from menu
- [ ] Replace previous saved plan (singleton)

7. Members / Invitations
- [ ] owner/admin can create invitation
- [ ] owner/admin can revoke pending invitation
- [ ] owner/admin can promote/demote member/admin
- [ ] owner/admin can remove member
- [ ] cannot remove owner
- [ ] cannot remove self
- [ ] invited user accepts via `/invite/[token]`

8. Premium Board
- [ ] Browse recommended recipes
- [ ] Open detail
- [ ] Like/dislike
- [ ] Save/unsave recipe
- [ ] Report recipe

9. Multi-tenant / RLS
- [ ] User A cannot read User B private records from another tenant
- [ ] Invitation/member actions only within same tenant

10. Observability
- [ ] `/api/embeddings` emits structured logs
- [ ] `/api/recipe-generate` emits structured logs
- [ ] `/api/meal-plan` emits structured logs
- [ ] `/api/meal-plan/inventory-suggestion` emits structured logs
- [ ] Logs include `event`, `requestId`, `durationMs` (when applicable)

## Automated Quality Gates

- [x] `npm run lint`
- [x] `npm run test`
- [x] `npm run build`

## Current Notes

- Plan enforcement for PDFs is defense-in-depth:
  1) UI pre-check (plan-aware)
  2) DB trigger `enforce_tenant_pdf_limit` (authoritative)
- Full manual E2E should be executed before production release.
