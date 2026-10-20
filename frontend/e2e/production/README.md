# Manual production acceptance

This directory is reserved for manual, owner-authorized production acceptance only. The dedicated production Playwright config requires production configuration before test collection, targets the explicitly allowlisted CocinaCore HTTPS origin, and does not start local services or configure database/Redis access. P4 read-only and synthetic lifecycle specs use only Playwright `request` and public application APIs; they do not use browser UI, shared local fixtures, signup, direct SQL, Redis, or database/Redis fixtures. P4/P5 are implementation only: no production execution has been performed.

The read-only list check authenticates first and requests at most ten active recipes. The synthetic U5 lifecycle is skipped unless `E2E_PRODUCTION_SYNTHETIC_WRITES=approved` exactly, in addition to the P2 auth gates; it verifies the expected user and tenant before creating a unique marked recipe. Cleanup is archive-only: there is no DELETE route. Residual synthetic recipes may remain archived pending the U6/product decision. Do not claim U5 PASS or U6 closure based on local implementation.

P6 verification remains pending and is a mandatory boundary before any production execution. The manual workflow is preparation only and must not be run as part of local verification.

Production auth credentials may be supplied only at runtime by an owner-approved secret manager/session mechanism: `E2E_PRODUCTION_USER_EMAIL`, `E2E_PRODUCTION_USER_PASSWORD`, `E2E_PRODUCTION_USER_ID`, and `E2E_PRODUCTION_TENANT_ID`. They are read into process memory for the caller only. Do not pass them as CLI arguments or place them in repository files, logs, tmux, GitHub plaintext, cookies, or storage state; never print, persist, serialize, or attach them to test output or artifacts.

The previously revealed password is invalid for use. Rotating it requires separate owner consent. Local identity must continue to use the existing local environment path and must never be mixed with production identity or credentials.
