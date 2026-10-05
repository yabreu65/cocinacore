# Production Reality First — Pawtech M1

This versioned artifact defines the production decision discipline for CocinaCore. Production is a
real shared system, not a lab: assumptions about ownership, topology, backups, or recoverability are
not evidence. Preserve existing infrastructure and tenant boundaries; do not create new secrets,
services, networks, volumes, or database identities to make a release convenient. Future capabilities
are not current requirements.

## Mandatory sequence

Every production change follows:

**DISCOVER → DEMONSTRATE → COMPARE → DESIGN → TEST → REHEARSAL → APPROVE → DEPLOY → VERIFY**

1. **DISCOVER** the actual deployed source, configuration locations, runtime identities, service
   topology, ownership, health, and applicable operational controls. Do not print secret values.
2. **DEMONSTRATE** each material claim with direct, read-only evidence. Distinguish observed facts,
   inherited assertions, and unknowns; absence of evidence is not evidence of safety.
3. **COMPARE** current reality with the requested outcome and the repository contract. Identify
   drift, compatibility implications, blast radius, rollback boundaries, and uncertainties.
4. **DESIGN** the smallest reversible application change that fits existing infrastructure. Do not
   assume database restoration, shared service recreation, or infrastructure mutation is safe.
5. **TEST** source and workflow contracts before operational activity. Test only what is authorized;
   never convert a static test into a production preflight.
6. **REHEARSAL** uses a separately approved representative environment. A rehearsal is not a
   production write and does not establish production safety unless its limits are stated.
7. **APPROVE** requires the mandatory PM checkpoint before production deployment. The PM confirms
   the exact release SHA, evidence, impact, compatibility, recovery boundaries, and go/no-go; the
   technical operator does not infer approval from a merge or green CI.
8. **DEPLOY** follows the exact approved sequence and target. Stop on unexpected state; no automatic
   retry and no unapproved destructive action.
9. **VERIFY** application, dependencies, externally observable health, and release identity. Record
   evidence and unresolved risks without exposing secrets.

## Change classification and safety

Classify each change before approval: application-only; configuration-only; database/schema or data;
shared infrastructure; security/identity; or recovery. A change can belong to multiple classes.
Database/data, shared-infrastructure, identity, and recovery changes require explicit ownership and
impact review. Never infer that a database rollback is available because an application rollback is
available. Never assume backups are restorable without a separately authorized restore drill.

No new secret is introduced by M1. Runtime secrets remain on the VPS. No production environment
file is copied into the repository, image, workflow output, or logs. Optional capabilities—including
transactional email—must not become accidental release gates when the current product contract says
they are optional.

## Canonical Pawtech M1 release path

1. A human manually supplies the exact 40-hex SHA already integrated into `origin/main`. The
   workflow validates ancestry and checks out that exact SHA.
2. Node `22.22.3`, `npm ci`, lint, coverage tests, typecheck, build, and the four maintained static
   contracts complete before SSH setup.
3. SSH pins the application directory to `/opt/pawtech/apps/cocinacore`, validates its canonical
   realpath, and invokes the strictly read-only production preflight before deploy mode.
4. The deploy validates `/opt/pawtech/env/cocinacore.env`, target identity, shared network/service
   health, uploads path, source ancestry, URL, and required commands without creating files or
   acquiring the deploy lock.
5. `git archive "$RELEASE_SHA"` supplies all release build input; untracked VPS files are excluded.
   Build the exact-SHA image before backup.
6. Run the versioned repository CocinaCore-only backup helper from that extracted release. It writes
   a private dump and verified SHA-256 sidecar in the existing manual backup hierarchy. Validate
   ownership, permissions, checksum, and custom archive structure before proceeding.
7. Run only read-only `npm run db:migrate:verify`; require `MIGRATION_EXPECTATION=NO_OP` and
   `DATABASE_CHANGED=NO`. No provisioning, DDL, automatic restore, or database rollback.
8. Start an internal-network-only candidate and verify app/database/Redis health before cutover.
   Perform application-only cutover, verify internal and public health, then have GitHub perform an
   independent public `/api/health` smoke check.

### Recovery boundary

If GitHub's independent public smoke fails, the workflow makes one failure-only, application-only
rollback attempt using the recorded deployment attempt and prior-container identity. It restores the
prior application image/container; it never restores the database or changes shared PostgreSQL,
Redis, or infrastructure. During restoration it may reconnect only the application container to an
existing required network; it never creates or deletes networks. The rollback verifies container
ownership and state before replacement, then checks the restored app and public health URL. If that URL is invalid or restored
health cannot be proven, it reports manual intervention and stops; it does not retry deployment or
claim recovery succeeded. This recovery attempt is not automatic approval to continue release.

The release runs in the existing Pawtech topology: app `cocinacore-web`; PostgreSQL
`pawtech-postgres` / `cocinacore_db` / `cocinacore_user`; Redis `pawtech-redis:6379`; networks
`pawtech_internal` and `pawtech_public`; shared Pawtech Traefik; uploads bind
`/opt/pawtech/data/cocinacore/uploads:/app/uploads`. Email is optional, legacy sessions remain 30
days, and separated database lanes remain disabled. No `.env.production`, `.env.migration`,
`migration_admin`, `db:provision`, standalone Compose live deployment, global infrastructure
mutation, or automatic database restore is part of M1.
