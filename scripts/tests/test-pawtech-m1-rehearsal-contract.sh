#!/usr/bin/env bash
set -euo pipefail

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
HARNESS="$ROOT/scripts/rehearse-pawtech-m1.sh"
PRODUCTION_DEPLOY="$ROOT/scripts/deploy-pawtech-production.sh"
DOCKERFILE="$ROOT/Dockerfile"

fail() {
  printf '%s\n' "Pawtech M1 rehearsal contract failure: $1" >&2
  exit 1
}

[ -f "$HARNESS" ] || fail 'scripts/rehearse-pawtech-m1.sh is missing'
[ -f "$PRODUCTION_DEPLOY" ] || fail 'production deploy script is missing; cannot verify the no-restore boundary'
[ -f "$DOCKERFILE" ] || fail 'root Dockerfile is missing; cannot verify the pinned Node base'

require_text() {
  local pattern=$1 message=$2
  grep -Eiq -- "$pattern" "$HARNESS" || fail "$message"
}

forbid_harness_text() {
  local pattern=$1 message=$2
  if grep -Eiq -- "$pattern" "$HARNESS"; then fail "$message"; fi
}

# Text-only contract: never source, execute, or invoke Docker from this test.
require_text '^\[\[ \$# -eq 2 && \( \$1 == --run-local-only \|\| \$1 == --cleanup-local-only \) \]\]' 'the CLI must accept exactly the run and cleanup local-only modes'
if grep -Eiq 'inspect-local-only|inspect_local_only|docker_readonly' "$HARNESS"; then
  fail 'one-off inspection mode and its fixed run/time logic must be absent'
fi
require_text 'REDIS_VOLUME="\$\{RUN_ID\}-redisdata"' 'normal rehearsal must create an explicit run-specific Redis volume'
require_text 'volume create --label "\$OWNER_LABEL=\$RUN_ID" "\$REDIS_VOLUME"' 'Redis volume must carry the exact owner label'
require_text '"\$REDIS_VOLUME:/data"' 'Redis must attach the owned volume at /data'
require_text 'no anonymous|anonymous.*volume|unlabelled.*volume' 'normal rehearsal contract must prohibit anonymous Redis data volumes'
# This contract remains static: the test never invokes the harness or Docker.
require_text 'cleanup-local-only' 'the explicit cleanup-only CLI mode is required'
require_text 'cleanup-only.*does not build|CLEANUP_ONLY|cleanup_local_only' 'cleanup-only mode must be isolated from rehearsal setup and builds'
require_text 'cocinacore-m1-rehearsal-' 'run IDs must use the rehearsal namespace'
require_text '\$run_id =~ \^\[a-zA-Z0-9\]\[a-zA-Z0-9._-\][{]0,96[}]\$' 'run IDs must be safe and bounded to 97 characters'
require_text '\$run_id != \*\.\.\*' 'run IDs must reject traversal-like dot sequences'
require_text 'EXPECTED_BRANCH=.fix/pawtech-production-deploy.' 'the fixed rehearsal branch guard is missing'
require_text 'a1e008c392c76b6d586a1b1e9cf10ef0df56b7f0' 'the fixed HEAD/origin/main guard is missing'
forbid_harness_text 'git[[:space:]].*(fetch|checkout|update-ref|symbolic-ref|reset)' 'fetch, checkout, and ref edits are forbidden'
require_text 'DOCKER_HOST' 'DOCKER_HOST must be checked'
require_text 'docker[[:space:]]+context[[:space:]]+(show|inspect)' 'the active Docker context must be rechecked'
require_text 'unix://' 'only a local Unix Docker endpoint is permitted'
require_text 'assert_local_docker' 'cleanup-only mutations must be gated by the local Docker endpoint check'
require_text 'remote' 'remote endpoints must be rejected'
require_text 'unknown' 'unknown endpoints must be rejected'
require_text 'assert_local_docker' 'Docker mutations must revalidate the active context'
require_text 'docker[[:space:]]+"\$@"' 'the gated Docker invocation is missing'

# Rehearsal must be self-contained and must not touch fixed production resources.
forbidden_production='(/opt/pawtech|pawtech-postgres|pawtech-redis|pawtech_internal|pawtech_public|/etc/pawtech)'
forbid_harness_text "$forbidden_production" 'production paths or fixed production resources are forbidden'
forbid_harness_text 'docker[[:space:]]+compose|docker-compose' 'Docker Compose is forbidden'
forbid_harness_text 'docker[[:space:]]+(system|volume|network|image|container)?[[:space:]]*prune' 'all Docker prune commands are forbidden'
forbid_harness_text 'docker[[:space:]]+rm[[:space:]]+-f[[:space:]]+\$\((docker ps|docker container ls)' 'broad container deletion is forbidden'
forbid_harness_text 'docker[[:space:]]+(network|volume|image)[[:space:]]+rm[[:space:]]+-f' 'broad Docker resource deletion is forbidden'
require_text 'docker ps -aq' 'pre-mutation container inventory is required'
require_text 'docker network ls -q' 'pre-mutation network inventory is required'
require_text 'docker volume ls -q' 'pre-mutation volume inventory is required'
require_text 'collision|collisions' 'pre-existing resource collision detection is required'
require_text 'LC_ALL=C sort.*shasum -a 256' 'resource identifier hashes are required'
require_text 'awk .NF' 'resource identifier counts are required'
require_text 'CLEANUP_VERIFIED|CLEANUP_FAILED' 'cleanup must affect the rehearsal pass/fail result'
require_text 'ZERO_REHEARSAL_GARBAGE=YES' 'successful cleanup must explicitly report zero rehearsal garbage'
require_text 'POST_INVENTORY_MATCH=YES' 'successful cleanup must explicitly report that post inventory matches pre inventory'
awk '
  /^cleanup\(\) \{/ { in_cleanup=1 }
  in_cleanup && /if (containers|networks|volumes|images|post_containers|post_networks|post_volumes|post_images)=\$\(docker / {
    query=$0
    if (query !~ /--filter "\$OWNER_FILTER"/) exit 1
    if (query !~ /if / || query !~ /then/) exit 1
    if (query ~ /if containers=/) initial_containers=1
    if (query ~ /if networks=/) initial_networks=1
    if (query ~ /if volumes=/) initial_volumes=1
    if (query ~ /if images=/) initial_images=1
    if (query ~ /if post_containers=/) final_containers=1
    if (query ~ /if post_networks=/) final_networks=1
    if (query ~ /if post_volumes=/) final_volumes=1
    if (query ~ /if post_images=/) final_images=1
    seen++
  }
  in_cleanup && /\[\[ -z \$post_(containers|networks|volumes|images) \]\]/ { empty_checks++ }
  in_cleanup && /else cleanup_rc=1; cleanup_query_failures\+=/ { query_failures++ }
  in_cleanup && /for id in \$\(docker / { exit 1 }
  in_cleanup && /CLEANUP_FAILURE_DETAILS/ { details=NR }
  in_cleanup && details && /exit 1/ && !failure_exit { failure_exit=NR }
  in_cleanup && /ZERO_REHEARSAL_GARBAGE=YES/ { zero_marker=NR }
  in_cleanup && /POST_INVENTORY_MATCH=YES/ { inventory_marker=NR }
  in_cleanup && /\[\[ ! -e \$TEMP_DIR && ! -L \$TEMP_DIR \]\]/ { temp_check=NR }
  in_cleanup && /post_inventory == "\$PRE_INVENTORY"/ { equality_check=NR }
  in_cleanup && /^}/ {
    if (seen != 8 || query_failures != 8 || empty_checks != 4 || !initial_containers || !initial_networks || !initial_volumes || !initial_images || !final_containers || !final_networks || !final_volumes || !final_images || !details || !failure_exit || !zero_marker || !inventory_marker || !temp_check || !equality_check) exit 1
    if (!(details < failure_exit && failure_exit < zero_marker && failure_exit < inventory_marker && temp_check < zero_marker && equality_check < zero_marker)) exit 1
    exit
  }
' "$HARNESS" || fail 'cleanup must fail closed on every initial/final owner query and gate both success markers behind verified cleanup'

# Pinned images and private networks; DB and Redis are never published to host ports.
for image in 'pgvector/pgvector:pg16' 'redis:7-alpine'; do
  require_text "$image" "required pinned image is missing: $image"
  image_lines=$(grep -Fn "$image" "$HARNESS" || true)
  [ -n "$image_lines" ] || fail "required image tag is missing: $image"
  printf '%s\n' "$image_lines" | grep -Eiq 'docker_mutate[[:space:]]+run|image|--image' || fail "pinned image is not used: $image"
done
forbid_harness_text '(^|[^[:alnum:]_.-])[^[:space:]]*:latest([^[:alnum:]_.-]|$)|(^|[[:space:]])latest([[:space:]]|$)' 'floating latest tags are forbidden'
forbid_harness_text '(^|[[:space:]])-p([[:space:]]|$)|--publish([=[:space:]]|$)|0\.0\.0\.0:' 'DB/Redis host publishing is forbidden'
require_text 'network create --internal' 'both isolated networks must use --internal'
require_text 'POSTGRES_DB=postgres' 'source DB must be created separately as a fresh DB'
require_text 'cocinacore_db_restore' 'restore must use a separate fresh database'
require_text 'cocinacore_user' 'application operations must use the non-superuser account'
require_text 'POSTGRES_PASSWORD' 'synthetic database credentials are required'
require_text 'chmod 0600.*ENV_FILE|chmod 0600.*ENV_FILE' 'synthetic env files must be private'
require_text 'chmod 0700.*TEMP_DIR' 'the exact run temporary directory must be private'
for fake in 'AUTH_SECRET' 'GEMINI_API_KEY' 'S3_ENDPOINT' 'S3_BUCKET' 'S3_ACCESS_KEY_ID' 'S3_SECRET_ACCESS_KEY' 'APP_PUBLIC_URL' 'SESSION_DAYS=30'; do
  require_text "$fake" "synthetic application setting missing: $fake"
done
forbid_harness_text '(source|cat|head|tail|grep|sed)[[:space:]]+[^[:space:]]*\.env' 'real .env files must never be read or sourced'
require_text '--exclude=.\.env\*' 'candidate build context must exclude all .env files'
require_text 'exclude\)\.env\*' 'HEAD archive must exclude .env files'
require_text "exclude='node_modules'" 'candidate snapshot must exclude root node_modules'
require_text "exclude='\\*\\*/node_modules'" 'candidate snapshot must exclude nested node_modules'
require_text "exclude='\\*\\*/.next'" 'candidate snapshot must exclude nested Next.js build output'
require_text "exclude='\\*\\*/coverage'" 'candidate snapshot must exclude nested coverage output'
for ignored in out playwright-report test-results; do
  require_text "--exclude='${ignored}'" "candidate snapshot must exclude Docker-ignored ${ignored} output"
done
require_text "exclude='\\*.tsbuildinfo'" 'candidate snapshot must exclude TypeScript build metadata'
require_text "exclude='\\*.log'" 'candidate snapshot must exclude Docker-ignored logs'
require_text "exclude='\\*.md'" 'candidate snapshot must exclude Docker-ignored Markdown files'
require_text "exclude='npm-debug.log'" 'candidate snapshot must exclude npm debug logs'
require_text "exclude='.DS_Store'" 'candidate snapshot must exclude macOS metadata'
require_text "exclude='.github'" 'candidate snapshot must exclude GitHub metadata'
require_text 'UPLOADS_DIR' 'uploads must be mounted from the private run directory'

# Custom-format single-database dump, checksum, stdin archive listing and isolated restore.
require_text 'pg_dump.*-U cocinacore_user.*-d cocinacore_db.*-Fc.*--no-owner.*--no-acl' 'the exact custom-format source dump contract is required'
require_text 'shasum -a 256' 'macOS-compatible host digest generation is required'
require_text 'sha256sum -c' 'PostgreSQL-container checksum validation is required'
require_text 'docker_mutate cp' 'dump and checksum sidecar must be copied into the owned PostgreSQL container'
require_text 'CANDIDATE_BUILD_LOG=.*TEMP_DIR.*candidate-build\.log' 'candidate build log must stay in the run-private temp directory'
require_text 'PREVIOUS_BUILD_LOG=.*TEMP_DIR.*previous-build\.log' 'previous build log must stay in the run-private temp directory'
require_text 'docker_mutate_capture.*CANDIDATE_BUILD_LOG.*build --progress=plain' 'candidate build output must be captured through the gated plain-progress wrapper'
require_text 'docker_mutate_capture.*PREVIOUS_BUILD_LOG.*build --progress=plain' 'previous build output must be captured through the gated plain-progress wrapper'
require_text 'chmod 0600 "\$CANDIDATE_BUILD_LOG"' 'candidate build log must be mode 0600'
require_text 'chmod 0600 "\$PREVIOUS_BUILD_LOG"' 'previous build log must be mode 0600'
require_text 'BUILDER_BUILD_LOG=.*TEMP_DIR.*builder-build\.log' 'builder build log must stay in the run-private temp directory'
require_text 'chmod 0600 "\$BUILDER_BUILD_LOG"' 'builder build log must be mode 0600'
require_text 'SECURITY_CANDIDATE_LOG=.*TEMP_DIR.*security-candidate\.log' 'candidate inspection log must stay private in TEMP_DIR'
require_text 'SECURITY_BUILDER_LOG=.*TEMP_DIR.*security-builder\.log' 'builder inspection log must stay private in TEMP_DIR'
require_text 'chmod 0600 "\$SECURITY_CANDIDATE_LOG" "\$SECURITY_BUILDER_LOG"' 'inspection logs must be mode 0600'
require_text 'report_build_diagnostics "\$CANDIDATE_BUILD_LOG"' 'candidate failure must emit filtered diagnostics before its generic stage failure'
require_text 'report_build_diagnostics "\$PREVIOUS_BUILD_LOG"' 'previous failure must emit filtered diagnostics before its generic stage failure'
require_text 'grep -Ei.*ERROR.*failed to solve.*npm.*code' 'build diagnostics must select only narrow BuildKit or npm error lines'
require_text '://.*REDACTED' 'build diagnostics must redact URL userinfo'
require_text 'token|password|passwd|secret|authorization|api.*key' 'build diagnostics must redact sensitive labeled values'
require_text 'match\(lower, assignment\)' 'build diagnostics must redact all environment-style assignment values'
require_text 'BUILD_DIAGNOSTIC' 'diagnostics must be explicitly labeled as filtered output'
require_text 'NR <= 3|diagnostic_count < 3' 'build diagnostics must be capped to a few lines'
forbid_harness_text '(cat|head|tail|less|tee|printf|echo)[[:space:]].*(CANDIDATE|PREVIOUS)_BUILD_LOG' 'raw build logs must never be printed'
if grep -Ei 'sha256sum' "$HARNESS" | grep -Eiv 'docker_mutate(_capture)? .*exec'; then
  fail 'sha256sum may only be invoked inside the owned PostgreSQL container'
fi
require_text 'pg_restore[[:space:]]+--list[[:space:]]+<' 'archive listing must consume stdin without a positional dash'
forbid_harness_text 'pg_restore[[:space:]]+--list[[:space:]]+-([[:space:]]|$)' 'pg_restore --list must not use a positional dash filename'
require_text 'pg_restore --no-owner --no-acl -U postgres -d cocinacore_db_restore <' 'actual restore must target only the distinct restore DB'
forbid_harness_text 'pg_restore[^\n]*(--clean|--create)' 'destructive restore flags are forbidden'
require_text 'invalid.*archive|not-a-postgres-archive' 'invalid checksummed archive listing failure must be tested'
require_text 'corrupt.*checksum|corrupt-checksum' 'corrupt checksum rejection must be tested'
if grep -Eiq 'pg_restore[[:space:]]+(-U|--username|-d|--dbname|--clean|--create|--no-owner|--no-acl|--jobs)([[:space:]]|$)' "$PRODUCTION_DEPLOY"; then
  fail 'production deploy script must not invoke pg_restore for database restoration'
fi

# Migration, fixture, app health, rollback, and failure-matrix coverage.
for coverage in \
  '001-012|ledger' \
  'tenant_memberships' \
  'recipe_inventory_items' \
  'inventory_movements' \
  'user_meal_plans' \
  'consumption_payload' \
  'shopping_list_items' \
  'example\.invalid' \
  'canonical' \
  'jsonb' \
  'pg_constraint|foreign-key' \
  'db:migrate:verify' \
  '013_future' \
  'pending' \
  'health' \
  'MANUAL_INTERVENTION_REQUIRED' \
  'POST_CUTOVER_FAILURE_PREVIOUS_RESTORED' \
  'FAILURE_MATRIX' \
  'HARNESS_SIMULATION_ONLY_NOT_PRODUCTION_DEPLOY'; do
  require_text "$coverage" "missing rehearsal acceptance coverage: $coverage"
done
require_text 'pg_isready' 'PostgreSQL readiness must use pg_isready'
require_text 'redis-cli ping' 'Redis readiness must use redis-cli ping'
require_text '--alias active' 'cutover must be simulated with an internal active alias'
require_text 'CANDIDATE_SOURCE_CURRENT_DIRTY_WORKTREE_SNAPSHOT_EXCLUDING_ENV_FILES' 'candidate must represent the current uncommitted worktree without reading env files'
require_text 'PREVIOUS_IS_FIXED_HEAD_ARCHIVE_BASELINE_NOT_LIVE_PRODUCTION' 'previous image must be the fixed HEAD baseline, not production'
require_text 'COCINACORE_SEPARATED_DB_LANES_ENABLED=false' 'separated migration lanes must remain disabled'
require_text 'EXPECTED_LEDGER=' 'exact ordered ledger filenames must be asserted'
require_text 'ALTER TABLE public.schema_migrations OWNER TO cocinacore_user' 'schema migration RLS must be readable by the non-superuser'
require_text 'column_default = chr\(39\).*::jsonb' '012 JSONB default must be checked exactly'
require_text 'row_json|to_jsonb' 'fixture row content must participate in fingerprints'
require_text 'to_jsonb\(m\)::text.*ORDER BY filename' 'fingerprint must include every ordered migration ledger row'
require_text 'checksum.*public.digest|public.digest.*checksum' 'ledger row checksums must include complete row content and any checksum column'
require_text "c.relkind IN \\('r','p'\\)" 'fingerprint must cover every public base and partitioned table'
require_text 'pg_catalog.pg_class.*pg_catalog.pg_namespace' 'public table inventory must come from pg_catalog'
require_text 'pg_namespace.*nspname IN \('\''public'\'','\''internal'\''\)' 'fingerprint schema lookup must tolerate an absent internal schema'
awk '/^fingerprint\(\)/,/^SQL$/ { if ($0 ~ /\047(public|internal)\047::regnamespace/) exit 1 }' "$HARNESS" || fail 'fingerprint must not cast absent schema names to regnamespace'
require_text 'c.relname ~ .\^\[a-z_\]\[a-z0-9_\]\*' 'catalog table identifiers must be validated before dynamic SQL'
require_text 'format\(.*%I.%I' 'dynamic table identifiers must be quoted with PostgreSQL format %I'
require_text 'string_agg\(to_jsonb\(t\)::text.*ORDER BY to_jsonb\(t\)::text' 'every table must hash deterministic row content without exposing rows'
require_text 'source_fingerprint=\$\(fingerprint cocinacore_db\)' 'source fingerprint must be captured before the dump'
require_text 'restore_fingerprint=\$\(fingerprint cocinacore_db_restore\)' 'restored database must be fingerprinted after restore checks'
require_text '\[\[ \$restore_fingerprint == "\$source_fingerprint" \]\]' 'restore contents must match source contents before read-only checks'
require_text 'verify_before=\$restore_fingerprint' 'restored source-matching fingerprint must be the unchanged baseline'
require_text 'candidate health scenario changed restore fingerprint' 'candidate health must preserve the restore fingerprint'
require_text 'bad-DB health scenario changed restore fingerprint' 'bad-DB health must preserve the restore fingerprint'
require_text 'Read-only verification fingerprints use local admin' 'fingerprints must use local admin to bypass RLS'
require_text '^docker_mutate_capture_stderr\(\)' 'stderr capture must use its own direct Docker helper'
grep -Fq '  docker "$@" 2>"$stderr_file"' "$HARNESS" || fail 'direct stderr helper must invoke Docker with stderr redirected to its file'
awk '/^docker_mutate_capture_stderr\(\)/,/^}/ { if ($0 ~ /assert_local_docker/) gate=1; if ($0 ~ /\/dev\/null/) null_redirect=1 } END { if (!gate || null_redirect) exit 1 }' "$HARNESS" || fail 'direct stderr helper must gate the local endpoint and avoid /dev/null'
awk '/^fingerprint\(\)/,/^}/ { if ($0 ~ /docker_mutate_capture_stderr.*psql/) direct=1; if ($0 ~ /pg_admin/) admin=1 } END { if (!direct || admin) exit 1 }' "$HARNESS" || fail 'fingerprint must call the direct stderr helper, not pg_admin'
require_text 'FINGERPRINT_LOG=.*TEMP_DIR.*fingerprint-.*stderr\.log' 'each fingerprint execution must retain stderr in a per-database private log'
require_text 'chmod 0600 "\$FINGERPRINT_LOG"' 'fingerprint stderr log must be mode 0600'
require_text 'docker_mutate_capture_stderr "\$FINGERPRINT_LOG" exec -i.*psql' 'fingerprint psql must use direct stderr capture while preserving stdout'
require_text 'report_fingerprint_diagnostics "\$FINGERPRINT_LOG"' 'fingerprint failure must emit a filtered diagnostic before the generic failure'
require_text 'FINGERPRINT_DIAGNOSTIC' 'fingerprint diagnostic must be explicitly labeled'
require_text 'NR <= 3|diagnostic_count < 3' 'fingerprint diagnostics must be capped to a few lines'
require_text 'length\(line\)>240|substr\(line,1,240\)' 'fingerprint diagnostic lines must be truncated'
require_text 'REDACTED' 'fingerprint diagnostics must redact credential-shaped values'
require_text 'dependencies\?\.database\?\.status|dependencies.*database.*status' 'health must check the database dependency response'
require_text 'dependencies\?\.redis\?\.status|dependencies.*redis.*status' 'health must check the Redis dependency response'
require_text '503\|unavailable\|unavailable\|ok' 'bad-DB case must require exact 503/unavailable/database and Redis-ok signal'
require_text '^readonly BAD_DB_HEALTH_TIMEOUT_MS=60000$' 'bad-DB readiness must have a hard 60-second maximum'
require_text 'wait_bad_db_health' 'bad-DB readiness must use its dedicated bounded helper'
require_text 'process\.hrtime\.bigint\(\)' 'bad-DB readiness must use a monotonic deadline'
require_text 'Math\.min\(5000, remainingMs\)' 'each bad-DB fetch timeout must be capped by the remaining deadline'
require_text 'Math\.min\(1000, remainingMs\)' 'bad-DB readiness polling must be capped by the remaining deadline'
require_text 'response\.status.*payload\?\.status.*dependencies\?\.database\?\.status.*dependencies\?\.redis\?\.status' 'bad-DB readiness must recognize all required structured health fields'
require_text 'if \(!structured\).*continue' 'transport and unstructured bad-DB responses must be retried'
require_text 'return signal' 'a structured bad-DB response must return immediately for exact comparison'
require_text 'bad_db_signal=\$\(wait_bad_db_health' 'only the bad-DB case must use the bounded readiness helper'
for baseline in \
  'pre_cutover_previous_id=' \
  'pre_cutover_previous_image_id=' \
  'pre_cutover_previous_state=' \
  'pre_cutover_previous_network_ids=' \
  'pre_cutover_previous_snapshot=' \
  'pre_cutover_restore_fingerprint=' \
  'pre_cutover_previous_health='; do
  require_text "$baseline" "pre-cutover previous-untouched baseline is missing: $baseline"
done
for proof in \
  'pre_cutover_previous_id=\$\(docker inspect.*\.Id' \
  'pre_cutover_previous_image_id=\$\(docker inspect.*\.Image' \
  'pre_cutover_previous_state=\$\(docker inspect.*State\.Status' \
  'pre_cutover_previous_network_ids=\$\(network_ids' \
  'pre_cutover_previous_snapshot=\$\(identity_snapshot' \
  'pre_cutover_restore_fingerprint=\$\(fingerprint cocinacore_db_restore' \
  'pre_cutover_previous_health=\$\(probe_health'; do
  require_text "$proof" "pre-cutover baseline must capture the actual datum: $proof"
done
require_text 'docker inspect --format .\{\{\.Id\}\}. "\$PREVIOUS_NAME" 2>/dev/null\) == "\$pre_cutover_previous_id"' 'post-bad-DB proof must compare previous container ID'
require_text 'docker inspect --format .\{\{\.Image\}\}. "\$PREVIOUS_NAME" 2>/dev/null\) == "\$pre_cutover_previous_image_id"' 'post-bad-DB proof must compare previous image ID'
require_text 'docker inspect --format .\{\{\.State\.Status\}\}. "\$PREVIOUS_NAME" 2>/dev/null\) == "\$pre_cutover_previous_state"' 'post-bad-DB proof must compare previous running state'
require_text 'network_ids "\$PREVIOUS_NAME"\) == "\$pre_cutover_previous_network_ids"' 'post-bad-DB proof must compare previous network IDs'
require_text 'identity_snapshot "\$PREVIOUS_NAME"\) == "\$pre_cutover_previous_snapshot"' 'post-bad-DB proof must compare previous identity snapshot'
require_text 'pre_cutover_restore_fingerprint' 'post-bad-DB proof must compare the restore DB fingerprint baseline'
require_text 'previous_health_after=.*probe_health' 'post-bad-DB proof must capture the previous exact health response'
require_text 'previous_health_after == .200\|ok\|ok\|ok.' 'post-bad-DB proof must require previous exact healthy response'
require_text 'previous_health_after == "\$pre_cutover_previous_health"' 'post-bad-DB proof must compare previous health to its baseline'
require_text 'PRE_CUTOVER_CANDIDATE_FAILURE_PREVIOUS_UNTOUCHED' 'bad-DB proof must emit its explicit previous-untouched success marker'
require_text 'candidate_pre_cutover_failure=verified' 'failure matrix must report the pre-cutover candidate failure proof'
awk '
  /pre_cutover_previous_id=/ { id=NR }
  /pre_cutover_previous_image_id=/ { image=NR }
  /pre_cutover_previous_state=/ { state=NR }
  /pre_cutover_previous_network_ids=/ { networks=NR }
  /pre_cutover_previous_snapshot=/ { snapshot=NR }
  /pre_cutover_restore_fingerprint=/ { db=NR }
  /pre_cutover_previous_health=/ { health=NR }
  /docker_mutate run -d --name "\$\{RUN_ID\}-bad-db"/ { launch=NR }
  /bad_db_signal=\$\(wait_bad_db_health/ { response=NR }
  /== "\$pre_cutover_previous_id"/ { id_check=NR }
  /== "\$pre_cutover_previous_image_id"/ { image_check=NR }
  /== "\$pre_cutover_previous_state"/ { state_check=NR }
  /== "\$pre_cutover_previous_network_ids"/ { network_check=NR }
  /== "\$pre_cutover_previous_snapshot"/ { snapshot_check=NR }
  /post_bad_db_restore_fingerprint == "\$pre_cutover_restore_fingerprint"/ { db_check=NR }
  /previous_health_after=/ { health_check=NR }
  /PRE_CUTOVER_CANDIDATE_FAILURE_PREVIOUS_UNTOUCHED/ { marker=NR }
  /candidate_pre_cutover_failure=verified/ { matrix=NR }
  /docker_mutate run -d --name "\$\{RUN_ID\}-bad-db"/ { bad_launches++ }
  END {
    if (!(id && image && state && networks && snapshot && db && health && launch && response && id_check && image_check && state_check && network_check && snapshot_check && db_check && health_check && marker && matrix && bad_launches == 1)) exit 1
    if (!(id < launch && image < launch && state < launch && networks < launch && snapshot < launch && db < launch && health < launch && launch < response && response < id_check && response < image_check && response < state_check && response < network_check && response < snapshot_check && response < db_check && response < health_check && health_check < marker && marker < matrix)) exit 1
  }
' "$HARNESS" || fail 'previous-untouched baselines must precede bad-DB launch and proof markers must follow its exact response'
if grep -Eiq 'BAD_DB_HEALTH|wait_bad_db_health' "$PRODUCTION_DEPLOY"; then
  fail 'bad-DB readiness helper/constants must remain confined to the rehearsal harness'
fi
require_text '^readonly ROLLBACK_HEALTH_TIMEOUT_MS=60000$' 'rollback readiness must have a hard 60-second maximum'
require_text 'wait_rollback_health' 'rollback readiness must use its dedicated bounded helper'
require_text 'process\.hrtime\.bigint\(\)' 'rollback readiness must use a monotonic deadline'
require_text 'Math\.min\(5000, remainingMs\)' 'each rollback fetch timeout must be capped by the remaining deadline'
require_text 'Math\.min\(1000, remainingMs\)' 'rollback readiness polling must be capped by the remaining deadline'
require_text 'rollback_health_signal=\$\(wait_rollback_health' 'guarded rollback must wait for readiness before assertions'
require_text '\[\[ \$rollback_health_signal == .200\|ok\|ok\|ok. \]\]' 'rollback readiness must require the exact healthy response'
if grep -Eiq 'ROLLBACK_HEALTH|wait_rollback_health' "$PRODUCTION_DEPLOY"; then
  fail 'rollback readiness helper/constants must remain confined to the rehearsal harness'
fi
production_sha=$(shasum -a 256 "$PRODUCTION_DEPLOY" | awk '{print $1}')
[[ $production_sha == 259f473e336e6204276d655da1a384dd9caf7e8fee36b900ec230890d17abb2c ]] || fail 'production deploy script SHA changed'
forbid_harness_text 'previous_network_before' 'stale post-rollback network baseline identifier is forbidden'
awk '
  /rollback_previous "\$previous_id"/ { rollback=NR }
  rollback && /previous rollback network changed/ { network_check=NR; if ($0 !~ /\$pre_cutover_previous_network_ids/) exit 1 }
  rollback && /rollback changed database fingerprint/ { db_check=NR }
  rollback && /POST_CUTOVER_FAILURE_PREVIOUS_RESTORED/ { restored=NR }
  rollback && /FAILURE_MATRIX/ { matrix=NR }
  END {
    if (!(rollback && network_check && db_check && restored && matrix)) exit 1
    if (!(rollback < network_check && network_check < db_check && db_check < restored && restored < matrix)) exit 1
  }
' "$HARNESS" || fail 'post-rollback assertions must use the pre-cutover network baseline and precede the restored marker and final failure matrix'
awk '
  /rollback_previous "\$previous_id"/ { rollback=NR }
  /rollback_health_signal=\$\(wait_rollback_health/ { readiness=NR }
  /previous rollback identity changed/ { id_check=NR }
  /previous rollback image changed/ { image_check=NR }
  /previous rollback network changed/ { network_check=NR }
  /rollback changed database fingerprint/ { db_check=NR }
  END { if (!(rollback && readiness && id_check && image_check && network_check && db_check && rollback < readiness && readiness < id_check && readiness < image_check && readiness < network_check && readiness < db_check)) exit 1 }
' "$HARNESS" || fail 'rollback assertions must follow exact healthy readiness after the guarded rollback'
require_text 'Pending migration: 013_future.sql' 'pending migration case must match the exact failure signal'
require_text 'grep -Fq .Pending migration: 013_future.sql.' 'pending failure output must actually be matched'
require_text 'pg_restore: error: input file does not appear to be a valid archive' 'invalid archive listing failure must be matched exactly'
require_text 'corrupt-checksum.dump: FAILED' 'corrupt checksum failure must be matched exactly'
require_text 'CANDIDATE_TAG="cocinacore:rehearsal-candidate-\$\{RUN_ID\}"' 'candidate image tag must be run-specific'
require_text 'PREVIOUS_TAG="cocinacore:rehearsal-previous-\$\{RUN_ID\}"' 'previous image tag must be run-specific'
require_text 'BUILDER_TAG="cocinacore:rehearsal-builder-\$\{RUN_ID\}"' 'builder image tag must be run-specific'
require_text 'docker image inspect.*BUILDER_TAG|BUILDER_TAG.*docker image inspect' 'builder tag collision must be checked exactly'
require_text 'docker_mutate_capture.*BUILDER_BUILD_LOG.*build --progress=plain --target builder --label "\$OWNER_LABEL=\$RUN_ID" -t "\$BUILDER_TAG" "\$CANDIDATE_CONTEXT"' 'builder must be built from the exact candidate context with the exact owner label'
require_text 'docker_mutate_capture.*run --rm --read-only --network none --label "\$OWNER_LABEL=\$RUN_ID".*--entrypoint sh' 'inspectors must run read-only, offline, and owner-labeled without mounts or env files'
require_text 'docker_mutate_capture "\$SECURITY_CANDIDATE_LOG" run --rm --read-only --network none --label "\$OWNER_LABEL=\$RUN_ID"' 'candidate inspector must be read-only, offline, and owner-labeled'
require_text 'docker_mutate_capture "\$SECURITY_BUILDER_LOG" run --rm --read-only --network none --label "\$OWNER_LABEL=\$RUN_ID"' 'builder inspector must be read-only, offline, and owner-labeled'
require_text 'npm ls --omit=dev braces --all --offline' 'candidate inspector must check the offline production braces tree'
require_text 'node_modules/braces' 'candidate inspector must report exact braces directory presence'
require_text '\.next/standalone/node_modules' 'builder inspector must inspect the traced standalone node_modules tree'
require_text 'SECURITY_BUILDER_GRAPH_.*(TRACED|COUNT|PATH)' 'builder graph must report traced status, counts, and bounded paths'
require_text 'find "\$standalone_nm" -type d -path "\*/node_modules/\$package"' 'builder package matching must use exact literal traced paths'
require_text 'SECURITY_BUNDLE_SCAN=incomplete' 'bundle scan must distinguish incomplete scans from zero matches'
require_text 'grep -Fq -- "\$group"' 'bundle token detection must be literal'
require_text 'braces micromatch fast-glob @next/eslint-plugin-next eslint-config-next' 'builder graph and bundle scan must cover all five advisory-chain packages'
require_text 'server\.js' 'candidate bundle scan must inspect server.js'
require_text '\.next/server' 'candidate bundle scan must inspect emitted server JavaScript'
require_text 'grep -F' 'bundle matching must use literal package tokens'
require_text 'exclude-dir=__tests__' 'production source imports must exclude __tests__ directories'
require_text "exclude='\*\.test\.\*'" 'production source imports must exclude test files'
require_text "exclude='\*\.spec\.\*'" 'production source imports must exclude spec files'
require_text 'SECURITY_SOURCE_.*COUNT' 'source import search must report package counts'
require_text 'frontend/src' 'production source imports must be checked in frontend/src'
require_text 'n\+\+ < 10|LIMIT=10' 'security inspection path output must be bounded to at most 10 paths'
require_text 'SECURITY_.*(present|empty|nonempty|unknown|count|files|standalone|graph)' 'security inspection must report whitelisted summary keys'
require_text 'grep -Fq "\(empty\)"' 'explicit empty production tree must be recognized independent of npm ls status'
require_text 'elif \[ "\$npm_rc" -eq 0 \] && grep -Eq.*tree=nonempty' 'nonempty production braces classification must require successful npm ls'
require_text 'SECURITY_NPM_LS_EXIT=%s' 'observed npm ls exit status must be reported'
require_text 'SECURITY_NPM_PRODUCTION_BRACES=%s' 'production tree classification must be reported'
forbid_harness_text 'SECURITY_(CANDIDATE|BUILDER)_LOG.*(--env-file|[[:space:]]-v[[:space:]]|--mount)' 'security inspectors must not receive host mounts or env files'
awk '
  /docker_mutate_capture.*CANDIDATE_BUILD_LOG.*build --progress=plain/ { candidate=NR }
  /docker_mutate_capture.*BUILDER_BUILD_LOG.*build --progress=plain --target builder/ { builder=NR }
  /docker_mutate_capture.*SECURITY_CANDIDATE_LOG.*run --rm --read-only --network none/ { candidate_inspection=NR }
  /docker_mutate_capture.*SECURITY_BUILDER_LOG.*run --rm --read-only --network none/ { builder_inspection=NR }
  /docker_mutate network create|docker_mutate volume create|docker_mutate run -d/ { if (!first_mutation) first_mutation=NR }
  END { if (!(candidate && builder && candidate_inspection && builder_inspection && first_mutation && candidate < candidate_inspection && builder < builder_inspection && candidate_inspection < first_mutation && builder_inspection < first_mutation)) exit 1 }
' "$HARNESS" || fail 'both read-only inspectors must run after their relevant builds and before first resource mutation'
require_text 'trap .exit 130. INT|trap .exit 143. TERM' 'INT/TERM must exit through EXIT cleanup'
forbid_harness_text 'docker image ls[^\n]*Labels' 'image inventory must not rely on unsupported Labels formatting'
require_text 'docker image ls -q --filter.*OWNER_FILTER' 'image labels must be checked using a supported label filter'
require_text 'OWNER_FILTER="label=\$\{OWNER_LABEL\}=\$\{RUN_ID\}"' 'cleanup-only deletion must use the exact owner label and validated run ID'
require_text 'containers=\$\(docker ps -aq --filter "\$OWNER_FILTER"' 'cleanup-only container deletion source must use the exact owner filter'
require_text 'networks=\$\(docker network ls -q --filter "\$OWNER_FILTER"' 'cleanup-only network deletion source must use the exact owner filter'
require_text 'volumes=\$\(docker volume ls -q --filter "\$OWNER_FILTER"' 'cleanup-only volume deletion source must use the exact owner filter'
require_text 'TEMP_DIR == .*RUN_ID.*-work' 'cleanup-only must use the guarded exact run temp path'
require_text 'FINAL_RESOURCE_COUNTS_HASHES' 'cleanup-only must emit final resource inventory without inferred baseline comparison'
require_text 'docker image inspect.*CANDIDATE_TAG|CANDIDATE_TAG.*docker image inspect' 'candidate tag collision must be checked exactly'
require_text 'docker image inspect.*PREVIOUS_TAG|PREVIOUS_TAG.*docker image inspect' 'previous tag collision must be checked exactly'
forbid_harness_text 'j\.app|j\.database|j\.redis' 'health assertions must use the mapped dependencies response schema'
forbid_harness_text 'network connect "\$TEST_NETWORK" "\$PG_NAME"|network connect "\$TEST_NETWORK" "\$REDIS_NAME"' 'backend containers must remain off the test network'
require_text 'git.*archive.*HEAD' 'previous app must be built from git archive HEAD'
require_text 'candidate_node == v22\.22\.3' 'candidate runtime must reject Node versions other than v22.22.3'
require_text 'versions=\$\(docker_mutate run --rm --read-only --network none --label "\$OWNER_LABEL=\$RUN_ID" --entrypoint sh' 'candidate Node/npm probe must be read-only and offline'
require_text 'CANDIDATE_NODE_NPM node=%s npm=%s' 'candidate runtime must report the observed Node and npm versions'
has_exact_node22_base_contract() {
  local node22_lines
  node22_lines=$(grep -Ei '^[[:space:]]*FROM[[:space:]]+node:22' "$1" || true)
  [[ "$node22_lines" == 'FROM node:22.22.3-alpine AS base' ]]
}

NODE_BASE_REGRESSION_FIXTURE=$(printf '%s\n' \
  'FROM node:22.22.3-alpine AS base' \
  ' from node:22.22-alpine AS floating')
if has_exact_node22_base_contract <(printf '%s\n' "$NODE_BASE_REGRESSION_FIXTURE"); then
  fail 'additional floating Node 22 base fixture line must be rejected'
fi

if ! has_exact_node22_base_contract "$DOCKERFILE"; then
  fail 'root Dockerfile must contain exactly one Node 22 base: FROM node:22.22.3-alpine AS base'
fi

# Safe cleanup exception: removal IDs may originate only from the exact invocation owner filter.
require_text 'OWNER_FILTER="label=\$\{OWNER_LABEL\}=\$\{RUN_ID\}"' 'cleanup filter must bind the exact owner label to validated run ID'
require_text 'docker ps -aq --filter "\$OWNER_FILTER"' 'owned container IDs must be label-filtered'
require_text 'docker network ls -q --filter "\$OWNER_FILTER"' 'owned network IDs must be label-filtered'
require_text 'docker volume ls -q --filter "\$OWNER_FILTER"' 'owned volume IDs must be label-filtered'
require_text 'docker image ls -q --filter "\$OWNER_FILTER"' 'owned image IDs must be label-filtered'
require_text 'while IFS= read -r id; do .*docker_mutate network rm "\$id".*done <<< "\$networks"' 'network removal must iterate only successfully queried owner-filter IDs'
require_text 'while IFS= read -r id; do .*docker_mutate volume rm "\$id".*done <<< "\$volumes"' 'volume removal must iterate only successfully queried owner-filter IDs'
require_text 'while IFS= read -r id; do .*docker_mutate rm -f "\$id".*done <<< "\$containers"' 'container removal must iterate only successfully queried owner-filter IDs'
require_text 'while IFS= read -r id; do .*docker_mutate image rm "\$id"' 'image removal must iterate only successfully queried owner-filter IDs'
awk '
  /(network|volume|image)[[:space:]]+rm|docker[^[:space:]]*[[:space:]]+rm([[:space:]]|$)/ {
    network_volume_ok = $0 ~ /for id in \$\(docker (network ls -q|volume ls -q) --filter "\$OWNER_FILTER".*\); do .* (network|volume) rm "\$id"/ || $0 ~ /while IFS= read -r id; do .*docker_mutate (network|volume) rm "\$id"/
    container_ok = $0 ~ /for id in \$\(docker ps -aq --filter "\$OWNER_FILTER".*\); do .*rm( -f)? "\$id"/ || $0 ~ /while IFS= read -r id; do .*docker_mutate rm -f "\$id"/
    image_ok = $0 ~ /for id in \$\(docker image ls -q --filter "\$OWNER_FILTER".*\); do .*image rm "\$id"/ || $0 ~ /while IFS= read -r id; do .*docker_mutate image rm "\$id"/
    if (!network_volume_ok && !container_ok && !image_ok) exit 1
  }
' "$HARNESS" || fail 'a resource removal is not scoped to the exact owner-filter ID loop'
require_text 'trap[[:space:]]+[^[:space:]]+.*(EXIT|INT|TERM)' 'cleanup must be registered on exit and interruption'
require_text 'rm -rf -- "\$TEMP_DIR"' 'temporary directory cleanup must be explicit and guarded'
require_text 'TEMP_PARENT=/tmp' 'temporary files and deletion must stay under the fixed local /tmp directory'
forbid_harness_text 'TMPDIR' 'arbitrary TMPDIR must not control secret or cleanup paths'
require_text 'TEMP_DIR.*RUN_ID' 'temporary deletion path must be validated against this run ID'
require_text '\[\[ ! -e \$TEMP_DIR && ! -L \$TEMP_DIR \]\] \|\| fail .run temporary directory already exists.' 'run collision gate must reject existing paths and dangling symlinks'
require_text 'find.*-name.*\.env.*-print -quit' 'candidate snapshot filenames must be checked without opening contents'
require_text 'CANDIDATE_SNAPSHOT_FILES=.*PATHS_DIGEST' 'candidate dirty-worktree snapshot inventory must report sanitized count and digest'
require_text 'candidate_snapshot_file_count=.*find' 'candidate snapshot file count must be captured'
require_text 'candidate_snapshot_path_digest=.*find.*shasum -a 256' 'candidate snapshot filename inventory must be digested without printing paths'
require_text 'post_inventory == "\$PRE_INVENTORY"' 'pre/post container, network, and volume inventory must match'
require_text '\[\[ ! -e \$TEMP_DIR && ! -L \$TEMP_DIR \]\]' 'the exact run temporary directory and dangling symlinks must be absent after cleanup'
require_text 'docker image ls -q --filter "\$OWNER_FILTER"' 'cleanup must confirm owned image labels are gone'

# Keep the constraints fingerprint's catalog fields explicit and cast the internal char before text concatenation.
awk '
  /SELECT '\''CONSTRAINTS:'\''/ {
    constraints=$0
    if (constraints !~ /contype::text/ || constraints !~ /conrelid::regclass/ || constraints !~ /conname/ || constraints !~ /pg_get_constraintdef/) exit 1
    found=1
  }
  END { if (!found) exit 1 }
' "$HARNESS" || fail 'constraints fingerprint must cast contype to text and preserve its existing fingerprint fields'

# Execute only extracted fingerprint functions with a synthetic helper; never invoke Docker.
DIAGNOSTIC_TMP=$(mktemp -d)
chmod 0700 "$DIAGNOSTIC_TMP"
trap 'rm -rf -- "$DIAGNOSTIC_TMP"' EXIT
FINGERPRINT_FUNCTIONS="$DIAGNOSTIC_TMP/fingerprint-functions.sh"
awk '
  /^report_fingerprint_diagnostics\(\) \{$/ || /^fingerprint\(\) \{$/ { capture=1 }
  capture { print }
  capture && /^}$/ { capture=0; print "" }
' "$HARNESS" > "$FINGERPRINT_FUNCTIONS"
chmod 0600 "$FINGERPRINT_FUNCTIONS"
[ -s "$FINGERPRINT_FUNCTIONS" ] || fail 'fingerprint functions could not be extracted'
. "$FINGERPRINT_FUNCTIONS"
TEMP_DIR=$DIAGNOSTIC_TMP
pg_password=synthetic-password
PG_NAME=synthetic-postgres
FINGERPRINT_MODE=success
docker_mutate_capture_stderr() {
  local stderr_file=$1
  shift
  if [[ $FINGERPRINT_MODE == success ]]; then
    printf '%s\n' 'synthetic fingerprint payload'
    return 0
  fi
  printf '%s\n' 'psql: error: password=FINGERPRINT_CHANNEL_CANARY' > "$stderr_file"
  return 1
}
: > "$DIAGNOSTIC_TMP/success.stderr"
success_digest=$(fingerprint synthetic-db 2>"$DIAGNOSTIC_TMP/success.stderr") || fail 'synthetic successful fingerprint must return success'
[[ $success_digest =~ ^[[:xdigit:]]{64}$ ]] || fail 'successful fingerprint stdout must contain exactly a 64-hex digest'
[ ! -s "$DIAGNOSTIC_TMP/success.stderr" ] || fail 'successful fingerprint must not write stderr'
FINGERPRINT_MODE=failure
if captured=$(fingerprint synthetic-db 2>"$DIAGNOSTIC_TMP/failure.stderr"); then
  fail 'synthetic failed fingerprint must return nonzero'
else
  fingerprint_rc=$?
fi
[ "$fingerprint_rc" -ne 0 ] || fail 'synthetic failed fingerprint must preserve nonzero status'
[ -z "$captured" ] || fail 'failed fingerprint stdout must be empty under command substitution'
grep -Fq 'FINGERPRINT_DIAGNOSTIC' "$DIAGNOSTIC_TMP/failure.stderr" || fail 'failed fingerprint must route the labeled diagnostic to stderr'
grep -Fq '[REDACTED]' "$DIAGNOSTIC_TMP/failure.stderr" || fail 'failed fingerprint stderr must redact the canary'
if grep -Fq 'FINGERPRINT_CHANNEL_CANARY' "$DIAGNOSTIC_TMP/failure.stderr"; then fail 'failed fingerprint stderr leaked the canary'; fi
awk '/^fingerprint\(\)/,/^}/ { if ($0 ~ /report_fingerprint_diagnostics "\$FINGERPRINT_LOG" >&2/) routed=1 } END { if (!routed) exit 1 }' "$HARNESS" || fail 'fingerprint failure reporter must explicitly route diagnostics to stderr'
require_text 'report_fingerprint_diagnostics "\$FINGERPRINT_LOG" >&2' 'fingerprint failure reporter must explicitly route diagnostics to stderr'

printf '%s\n' \
  'psql: error: connection refused at synthetic-host' \
  'ERROR: synthetic catalog failure' \
  'FATAL: synthetic database unavailable' \
  > "$DIAGNOSTIC_TMP/recognized.stderr"
printf '%s\n' 'psql: error: password=FINGERPRINT_CANARY_7f91' > "$DIAGNOSTIC_TMP/sensitive.stderr"
printf '%s\n' 'synthetic informational message only' > "$DIAGNOSTIC_TMP/unrelated.stderr"
: > "$DIAGNOSTIC_TMP/empty.stderr"
printf '%s\n' \
  "ERROR: $(printf '%0250d' 0)" \
  'ERROR: first synthetic error' \
  'FATAL: second synthetic error' \
  'ERROR: third synthetic error' \
  'ERROR: fourth synthetic error' \
  > "$DIAGNOSTIC_TMP/bounded.stderr"
recognized_output=$(report_fingerprint_diagnostics "$DIAGNOSTIC_TMP/recognized.stderr")
printf '%s\n' "$recognized_output" | grep -Fq 'connection refused' || fail 'psql: error: stderr must produce useful diagnostics'
printf '%s\n' "$recognized_output" | grep -Fq 'synthetic catalog failure' || fail 'ERROR: stderr must produce useful diagnostics'
printf '%s\n' "$recognized_output" | grep -Fq 'synthetic database unavailable' || fail 'FATAL: stderr must produce useful diagnostics'
sensitive_output=$(report_fingerprint_diagnostics "$DIAGNOSTIC_TMP/sensitive.stderr")
printf '%s\n' "$sensitive_output" | grep -Fq 'FINGERPRINT_DIAGNOSTIC' || fail 'sensitive recognized stderr must be labeled'
if printf '%s\n' "$sensitive_output" | grep -Fq 'FINGERPRINT_CANARY_7f91'; then fail 'fingerprint diagnostic leaked the credential canary'; fi
printf '%s\n' "$sensitive_output" | grep -Fq '[REDACTED]' || fail 'sensitive labeled stderr must be redacted'
unrelated_output=$(report_fingerprint_diagnostics "$DIAGNOSTIC_TMP/unrelated.stderr")
empty_output=$(report_fingerprint_diagnostics "$DIAGNOSTIC_TMP/empty.stderr")
[ "$unrelated_output" = 'rehearsal: FINGERPRINT_DIAGNOSTIC stderr contained no recognized error details' ] || fail 'unrecognized stderr must use the fixed safe fallback'
[ "$empty_output" = 'rehearsal: FINGERPRINT_DIAGNOSTIC stderr contained no recognized error details' ] || fail 'empty stderr must use the fixed safe fallback'
bounded_output=$(report_fingerprint_diagnostics "$DIAGNOSTIC_TMP/bounded.stderr")
[ "$(printf '%s\n' "$bounded_output" | grep -c '^rehearsal: FINGERPRINT_DIAGNOSTIC ')" -eq 3 ] || fail 'fingerprint diagnostics must be capped at three lines'
printf '%s\n' "$bounded_output" | grep -Fq '[TRUNCATED]' || fail 'overlong fingerprint diagnostic must be marked as truncated'
if printf '%s\n' "$bounded_output" | awk 'length($0) > 290 { exit 1 }'; then :; else fail 'fingerprint diagnostic output line exceeded its bound'; fi
printf '%s\n' 'Pawtech M1 rehearsal static safety contract passed'
