## Legacy Supabase artifacts

This directory is preserved only as historical reference from the pre-migration architecture.

Current runtime status:

- CocinaCore no longer depends on Supabase for app runtime.
- Active PostgreSQL migrations live in `/Users/yoryiabreu/proyectos/cocinacore/db/migrations`.
- Active auth is application-managed in `/Users/yoryiabreu/proyectos/cocinacore/frontend/src/lib/auth`.
- Active local stack uses `/Users/yoryiabreu/proyectos/cocinacore/docker-compose.local.yml`.

What still lives here:

- `migrations/` and `migrations-legacy/` — historical SQL from the old Supabase/RLS stage
- `tests/` — historical security/RLS evidence from that stage
- `config.toml` / `seed.sql` — legacy CLI-era artifacts kept for auditability only

Rules:

- Do not add new runtime dependencies on Supabase here.
- Do not point local development back to `supabase start`.
- If these artifacts are ever removed, do it as a separate archival decision with explicit review.
