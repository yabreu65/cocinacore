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

## Production VPS access (CocinaCore)
- The shared PawTech/Contabo production VPS SSH alias on the owner's Mac is **`pawtech`**.
- Use `ssh pawtech` (or `ssh -o BatchMode=yes pawtech` for non-interactive checks).
- This is SSH access to the shared VPS hosting multiple projects, **not** a database name or a CocinaCore-only host.
- Do **not** use or invent the alias `cocinacore-prod` for this deployment.
- Restrict operational actions to CocinaCore resources; never modify other hosted projects.
- Before production migrations/deploy: validate VPS state, current recoverable backup, migration ledger and approval. Never put SSH keys/passwords/secrets into docs or logs.

## GGA pre-commit checks

For routine Guardian Angel pre-commit reviews, follow [docs/ops/gga-review-policy.md](docs/ops/gga-review-policy.md). This policy does not waive candidate-specific review, delivery, or production gates.
