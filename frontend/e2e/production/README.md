# Manual production acceptance

This directory is reserved for manual, owner-authorized production acceptance only. The dedicated production Playwright config targets the explicitly allowlisted CocinaCore HTTPS origin; it does not start local services or configure database/Redis access.

Tests here must use the application UI and public application APIs only. Never use signup, direct SQL, Redis, database/Redis fixtures, or cleanup that writes outside the application. Before any future synthetic write, a test must validate that the authenticated user and active tenant match the explicitly supplied expected user and tenant IDs. Do not add production specs until the P4 gate is authorized.

Production auth credentials may be supplied only at runtime by an owner-approved secret manager/session mechanism: `E2E_PRODUCTION_USER_EMAIL`, `E2E_PRODUCTION_USER_PASSWORD`, `E2E_PRODUCTION_USER_ID`, and `E2E_PRODUCTION_TENANT_ID`. They are read into process memory for the caller only. Do not pass them as CLI arguments or place them in repository files, logs, tmux, GitHub plaintext, cookies, or storage state; never print, persist, serialize, or attach them to test output or artifacts.

The previously revealed password is invalid for use. Rotating it requires separate owner consent. Local identity must continue to use the existing local environment path and must never be mixed with production identity or credentials.
