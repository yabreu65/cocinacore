# Manual production acceptance

This directory is reserved for manual, owner-authorized production acceptance only. The dedicated production Playwright config targets the explicitly allowlisted CocinaCore HTTPS origin; it does not start local services or configure database/Redis access.

Tests here must use the application UI and public application APIs only. Never use signup, direct SQL, Redis, database/Redis fixtures, or cleanup that writes outside the application. Before any future synthetic write, a test must validate that the authenticated user and active tenant match the explicitly supplied expected user and tenant IDs. Do not add production specs until the P4 gate is authorized.

Production credentials must be rotated and injected securely at runtime. Never commit, document, print, persist, or attach credentials, cookies, or authenticated storage state to test output or artifacts.
