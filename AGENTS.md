# Code Review Rules

## TypeScript
- Use strict typing and avoid `any`.
- Prefer explicit interfaces/types for API payloads.
- Keep lint, test, and build green.

## React / Next.js
- Use functional components and hooks.
- Avoid breaking existing routes and runtime behavior.
- Preserve premium UX consistency across screens.

## Supabase / DB
- Respect RLS and multi-tenant boundaries.
- No destructive migrations or data resets.
- Do not expose secrets in client code.
