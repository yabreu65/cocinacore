#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
WORKFLOW="$ROOT/.github/workflows/deploy.yml"
CI="$ROOT/.github/workflows/ci.yml"
DEPLOY_SCRIPT="$ROOT/scripts/deploy-pawtech-production.sh"
BACKUP_HELPER="$ROOT/scripts/backup-pawtech-cocinacore-predeploy.sh"
DEPLOY_CONTRACT="$ROOT/scripts/tests/test-pawtech-production-deploy-contract.sh"
STEP4_CONTRACT="$ROOT/scripts/tests/test-pawtech-step4-contract.sh"
BOOTSTRAP_CONTRACT="$ROOT/scripts/tests/test-bootstrap-migrator-config.sh"
STEP5_CONTRACT="$ROOT/scripts/tests/test-pawtech-step5-workflow-contract.sh"
RUNBOOK="$ROOT/docs/production/runbook.md"
COMPOSE="$ROOT/docker-compose.prod.yml"

fail() {
  printf '%s\n' "pawtech Step 5 workflow contract failure: $1" >&2
  exit 1
}

for required_file in "$WORKFLOW" "$CI" "$DEPLOY_SCRIPT" "$BACKUP_HELPER" "$DEPLOY_CONTRACT" "$STEP4_CONTRACT" "$BOOTSTRAP_CONTRACT" "$STEP5_CONTRACT" "$RUNBOOK" "$COMPOSE"; do
  [ -f "$required_file" ] || fail "required static contract input is missing: ${required_file#"$ROOT"/}"
done

# This contract reads repository text only. It never executes workflows,
# Docker, SSH, backup, migration, or production commands.
workflow_triggers=$(sed -n '/^on:/,/^[^[:space:]]/p' "$WORKFLOW")
printf '%s\n' "$workflow_triggers" | grep -Eq '^  workflow_dispatch:$' || fail 'workflow_dispatch trigger is required'
[ "$(printf '%s\n' "$workflow_triggers" | grep -Ec '^  [A-Za-z0-9_-]+:$')" -eq 1 ] || fail 'workflow_dispatch must be the only workflow trigger'
grep -Eq '^[[:space:]]+sha:[[:space:]]*$' "$WORKFLOW" || fail 'manual dispatch must require a SHA input'
grep -Eq '^[[:space:]]+required:[[:space:]]*true[[:space:]]*$' "$WORKFLOW" || fail 'dispatch SHA input must be required'
grep -Eq '^[[:space:]]+type:[[:space:]]*string[[:space:]]*$' "$WORKFLOW" || fail 'dispatch SHA input must be a string'
grep -Fq '[0-9a-fA-F]{40}' "$WORKFLOW" || fail 'dispatch SHA must be validated as exactly 40 hexadecimal characters'
grep -Fq 'git merge-base --is-ancestor "$DEPLOY_SHA" origin/main' "$WORKFLOW" || fail 'requested SHA must be an ancestor of origin/main'
grep -Eq '^  group:[[:space:]]*deploy-production[[:space:]]*$' "$WORKFLOW" || fail 'production deploy concurrency group is missing'
grep -Eq '^  cancel-in-progress:[[:space:]]*false[[:space:]]*$' "$WORKFLOW" || fail 'production deploys must be serialized without cancellation'
grep -Eq '^[[:space:]]+environment:[[:space:]]*production[[:space:]]*$' "$WORKFLOW" || fail 'deploy job must target the production environment'
grep -Eq 'node-version:[[:space:]]*"?22\.22\.3"?[[:space:]]*$' "$WORKFLOW" || fail 'Node must be pinned to 22.22.3'

line_of() {
  grep -nF "$1" "$2" | head -n 1 | cut -d: -f1
}

ci_install=$(line_of 'npm ci' "$WORKFLOW")
ci_lint=$(line_of 'npm run lint' "$WORKFLOW")
ci_coverage=$(line_of 'npm run test:coverage' "$WORKFLOW")
ci_typecheck=$(line_of 'npx tsc --noEmit' "$WORKFLOW")
ci_build=$(line_of 'npm run build' "$WORKFLOW")
deploy_contract=$(line_of 'test-pawtech-production-deploy-contract.sh' "$WORKFLOW")
step4_contract=$(line_of 'test-pawtech-step4-contract.sh' "$WORKFLOW")
bootstrap_contract=$(line_of 'test-bootstrap-migrator-config.sh' "$WORKFLOW")
step5_contract=$(line_of 'test-pawtech-step5-workflow-contract.sh' "$WORKFLOW")
ssh_step=$(line_of 'Configure SSH' "$WORKFLOW")
[ -n "$ci_install" ] && [ -n "$ci_lint" ] && [ -n "$ci_coverage" ] && [ -n "$ci_typecheck" ] &&
  [ -n "$ci_build" ] && [ -n "$deploy_contract" ] && [ -n "$step4_contract" ] &&
  [ -n "$bootstrap_contract" ] && [ -n "$step5_contract" ] && [ -n "$ssh_step" ] ||
  fail 'install, quality checks, all four static contracts, and SSH steps are required'
[ "$ci_install" -lt "$ci_lint" ] && [ "$ci_lint" -lt "$ci_coverage" ] &&
  [ "$ci_coverage" -lt "$ci_typecheck" ] && [ "$ci_typecheck" -lt "$ci_build" ] &&
  [ "$ci_build" -lt "$deploy_contract" ] && [ "$deploy_contract" -lt "$step4_contract" ] &&
  [ "$step4_contract" -lt "$bootstrap_contract" ] && [ "$bootstrap_contract" -lt "$step5_contract" ] &&
  [ "$step5_contract" -lt "$ssh_step" ] ||
  fail 'npm ci, lint, coverage, typecheck, build, all static contracts must precede SSH'
for static_contract in test-pawtech-production-deploy-contract.sh test-pawtech-step4-contract.sh test-bootstrap-migrator-config.sh test-pawtech-step5-workflow-contract.sh; do
  grep -Fq "run: sh scripts/tests/$static_contract" "$WORKFLOW" || fail "deploy workflow does not invoke $static_contract"
done

! grep -Eq '\.env\.production|\.env\.migration|docker compose -f docker-compose\.prod\.yml' "$WORKFLOW" ||
  fail 'workflow must not use production/migration env files or standalone Compose'
! grep -Eq 'secrets\.(DATABASE_URL|REDIS_URL|AUTH_SECRET|GEMINI_API_KEY|RESEND_API_KEY|EMAIL_FROM|S3_[A-Z0-9_]+)' "$WORKFLOW" ||
  fail 'application runtime secrets must remain VPS-side'
grep -Fq 'VPS_APP_DIR=/opt/pawtech/' "$WORKFLOW" || fail 'deploy app directory must be pinned to the known PawTech location'
! grep -Fq 'secrets.VPS_APP_DIR' "$WORKFLOW" || fail 'deploy app directory must not be caller-controlled'
grep -Fq 'VPS_SSH_KEY: ${{ secrets.VPS_SSH_KEY }}' "$WORKFLOW" || fail 'SSH key must be passed through step environment'
grep -Fq 'VPS_HOST: ${{ secrets.VPS_HOST }}' "$WORKFLOW" || fail 'VPS host must be passed through step environment'
grep -Fq 'PRODUCTION_URL: ${{ secrets.PRODUCTION_URL }}' "$WORKFLOW" || fail 'production URL must be passed through step environment'
! grep -Fq '"${{ secrets.VPS_SSH_KEY }}"' "$WORKFLOW" || fail 'SSH key must not be interpolated into run shell code'
! grep -Fq '"${{ secrets.VPS_HOST }}"' "$WORKFLOW" || fail 'VPS host must not be interpolated into run shell code'
! grep -Fq '"${{ secrets.PRODUCTION_URL }}/api/health"' "$WORKFLOW" || fail 'public URL must not be interpolated into smoke shell code'
grep -Fq "printf -v remote_args '%q ' \"\$RELEASE_SHA\" \"\$PRODUCTION_URL\"" "$WORKFLOW" || fail 'remote arguments must be safely shell-quoted'
grep -Fq '"bash -s -- $remote_args"' "$WORKFLOW" || fail 'SSH must use the quoted remote argument vector'
grep -Fq 'ATTEMPT_ID: gha-${{ github.run_id }}-${{ github.run_attempt }}' "$WORKFLOW" || fail 'deploy attempt must be deterministic from GitHub run identity'
grep -Fq "grep -Eq '^gha-[0-9]{1,20}-[0-9]{1,6}$'" "$DEPLOY_SCRIPT" || fail 'deploy script must validate a bounded attempt ID'
grep -Fq 'id: deploy' "$WORKFLOW" || fail 'remote deploy step needs an outcome id'
grep -Fq 'id: public-smoke' "$WORKFLOW" || fail 'independent public smoke needs an outcome id'
grep -Fq 'failure() && steps.deploy.outcome == '\''success'\'' && steps.public-smoke.outcome == '\''failure'\''' "$WORKFLOW" || fail 'recovery must run only after deploy success and independent smoke failure'
grep -Fq 'rollback' "$WORKFLOW" || fail 'workflow must invoke the rollback-only route after failed public smoke'
! grep -Fq '"${{ secrets.PRODUCTION_URL }}/api/health"' "$WORKFLOW" || fail 'public URL must not be interpolated into smoke-check shell code'
fetch_remote=$(grep -nF 'git fetch --all --prune' "$WORKFLOW" | tail -n 1 | cut -d: -f1)
remote_object=$(grep -nF 'git cat-file -e "${RELEASE_SHA}^{commit}"' "$WORKFLOW" | tail -n 1 | cut -d: -f1)
remote_ancestor=$(grep -nF 'git merge-base --is-ancestor "$RELEASE_SHA" origin/main' "$WORKFLOW" | tail -n 1 | cut -d: -f1)
remote_clean=$(grep -nF 'git diff --quiet || ! git diff --cached --quiet' "$WORKFLOW" | tail -n 1 | cut -d: -f1)
preflight=$(grep -nF 'git show "$RELEASE_SHA:scripts/deploy-pawtech-production.sh" | sh -s -- "$RELEASE_SHA" "$RUNTIME_ENV_FILE" "$PRODUCTION_URL" preflight "$ATTEMPT_ID"' "$WORKFLOW" | cut -d: -f1)
remote_checkout=$(grep -nF 'git checkout --detach "$RELEASE_SHA"' "$WORKFLOW" | cut -d: -f1)
deploy_mode=$(grep -nF 'scripts/deploy-pawtech-production.sh "$RELEASE_SHA" "$RUNTIME_ENV_FILE" "$PRODUCTION_URL" deploy "$ATTEMPT_ID"' "$WORKFLOW" | cut -d: -f1)
grep -Fq '"$RUNTIME_ENV_FILE" "$PRODUCTION_URL" deploy "$ATTEMPT_ID"' "$WORKFLOW" || fail 'deploy mode must receive the validated deterministic attempt'
grep -Fq '"$RELEASE_SHA" "$RUNTIME_ENV_FILE" "$PRODUCTION_URL" rollback "$ATTEMPT_ID"' "$WORKFLOW" || fail 'failure recovery must receive the same deterministic attempt'
grep -Fq 'git show "$RELEASE_SHA:scripts/deploy-pawtech-production.sh" | sh -s -- "$RELEASE_SHA" "$RUNTIME_ENV_FILE" "$PRODUCTION_URL" "$MODE" "$ATTEMPT_ID"' "$WORKFLOW" || fail 'recovery must execute exact release source in rollback-only mode'
recovery_block=$(sed -n '/name: Recover application after public smoke failure/,$p' "$WORKFLOW")
! printf '%s\n' "$recovery_block" | grep -Eq 'docker build|npm run db:migrate|backup-pawtech-cocinacore-predeploy|git checkout| deploy "\$ATTEMPT_ID"' || fail 'workflow recovery continuation must not redeploy, migrate, back up, or checkout'
[ -n "$fetch_remote" ] && [ -n "$remote_object" ] && [ -n "$remote_ancestor" ] && [ -n "$remote_clean" ] && [ -n "$preflight" ] && [ -n "$remote_checkout" ] && [ -n "$deploy_mode" ] ||
  fail 'remote fetch, SHA checks, tracked clean check, object preflight, checkout, and deploy mode are required'
[ "$fetch_remote" -lt "$remote_object" ] && [ "$remote_object" -lt "$remote_ancestor" ] && [ "$remote_ancestor" -lt "$remote_clean" ] && [ "$remote_clean" -lt "$preflight" ] && [ "$preflight" -lt "$remote_checkout" ] && [ "$remote_checkout" -lt "$deploy_mode" ] ||
  fail 'read-only release-object preflight must follow remote validation and precede checkout/deploy'

backup_call=$(grep -nF '"$RELEASE_DIR/scripts/backup-pawtech-cocinacore-predeploy.sh" "$RELEASE_SHA"' "$DEPLOY_SCRIPT" | head -n 1 | cut -d: -f1)
backup_dump=$(grep -nF 'pg_dump -U cocinacore_user -d "$DATABASE_NAME" -Fc --no-owner --no-acl' "$BACKUP_HELPER" | head -n 1 | cut -d: -f1)
backup_checksum=$(grep -nF 'sha256sum -c' "$BACKUP_HELPER" | head -n 1 | cut -d: -f1)
backup_list=$(grep -nF 'pg_restore --list <"$dump_file"' "$BACKUP_HELPER" | head -n 1 | cut -d: -f1)
verify=$(grep -nF 'npm run db:migrate:verify' "$DEPLOY_SCRIPT" | head -n 1 | cut -d: -f1)
changed_no=$(grep -nF "log 'DATABASE_CHANGED=NO'" "$DEPLOY_SCRIPT" | head -n 1 | cut -d: -f1)
[ -n "$backup_call" ] && [ -n "$backup_dump" ] && [ -n "$backup_checksum" ] && [ -n "$backup_list" ] && [ -n "$verify" ] && [ -n "$changed_no" ] ||
  fail 'exact-SHA release-tree backup helper, dump integrity checks, and read-only verify are required'
[ "$backup_call" -lt "$verify" ] && [ "$backup_dump" -lt "$backup_checksum" ] && [ "$backup_checksum" -lt "$backup_list" ] && [ "$backup_list" -lt "$verify" ] && [ "$verify" -lt "$changed_no" ] ||
  fail 'backup dump, checksum verification, archive listing, migration verification, and unchanged-database order is invalid'
grep -Fq 'pg_restore --list <"$dump_file"' "$BACKUP_HELPER" || fail 'backup archive must be listed from stdin without a positional filename'
! grep -Fq 'pg_restore --list -' "$BACKUP_HELPER" || fail 'backup archive listing must not use a positional filename'
grep -Fq 'pg_dump -U cocinacore_user -d "$DATABASE_NAME" -Fc --no-owner --no-acl' "$BACKUP_HELPER" || fail 'backup must use the documented runtime role without credential extraction'
grep -Fq 'git ls-tree "$RELEASE_SHA" -- scripts/backup-pawtech-cocinacore-predeploy.sh' "$DEPLOY_SCRIPT" || fail 'preflight must inspect the release-tree helper mode'
grep -Fq '[ "$helper_mode" = 100755 ]' "$DEPLOY_SCRIPT" || fail 'preflight must require helper mode 100755'
grep -Fq 'check_previous_app || fail' "$DEPLOY_SCRIPT" || fail 'preflight must prove a valid prior application rollback target'
grep -Fq 'container_networks_exact "$APP_CONTAINER"' "$DEPLOY_SCRIPT" || fail 'preflight must enforce exact previous-app networks'
grep -Fq 'command -v pg_dump' "$DEPLOY_SCRIPT" && grep -Fq 'command -v pg_restore' "$DEPLOY_SCRIPT" || fail 'preflight must confirm snapshot tools inside PostgreSQL'
grep -Fq '[ "$attached_networks" = "$expected_networks" ]' "$DEPLOY_SCRIPT" || fail 'rollback must reject networks beyond the exact required set'
grep -Fq "x.status!=='ok'||x.dependencies?.database?.status!=='ok'||x.dependencies?.redis?.status!=='ok'" "$DEPLOY_SCRIPT" || fail 'public health must validate app/database/redis JSON health'
grep -Fq '/opt/pawtech/backups/postgres/cocinacore_db/manual' "$BACKUP_HELPER" || fail 'established manual backup hierarchy is missing'
grep -Fq 'DATABASE_NAME=cocinacore_db' "$BACKUP_HELPER" || fail 'backup database must be fixed to cocinacore_db'
grep -Fq 'POSTGRES_CONTAINER=pawtech-postgres' "$BACKUP_HELPER" || fail 'backup container must be fixed to pawtech-postgres'
grep -Fq 'umask 077' "$BACKUP_HELPER" || fail 'backup helper must use a private umask'
grep -Fq 'mktemp -d' "$BACKUP_HELPER" && grep -Fq 'date' "$BACKUP_HELPER" || fail 'backup artifact path must be timestamped and unique under the manual hierarchy'
grep -Eq 'chmod 700|install -d -m 700|mktemp -d' "$BACKUP_HELPER" || fail 'backup run directory must be private'
grep -Fq 'chmod 600' "$BACKUP_HELPER" && grep -Fq '.sha256' "$BACKUP_HELPER" || fail 'dump and checksum sidecar must be mode 0600'
grep -Fq 'sha256sum' "$BACKUP_HELPER" || fail 'backup checksum generation is missing'
grep -Fq 'sha256sum -c' "$BACKUP_HELPER" || fail 'backup checksum verification is missing'
[ "$(grep -c 'pg_dump' "$BACKUP_HELPER")" -eq 1 ] || fail 'helper must dump only its single CocinaCore database'
! grep -Eiq 'backup-postgres\.sh|retention|rclone|pawtech_db|postgres_db|template1' "$BACKUP_HELPER" ||
  fail 'backup helper contains shared backup, offsite, or other-database behavior'
! grep -Eiq 'pg_restore.*--(dbname|clean|create)|psql.*(--dbname| -d )' "$BACKUP_HELPER" ||
  fail 'backup helper must never restore a database'
! grep -Eiq 'cat[^[:cntrl:]]*\.(dump|sql)|tee[^[:cntrl:]]*\.(dump|sql)|printenv|^[[:space:]]*env([[:space:]]|$)|\.Config\.Env|(echo|printf|log)[^[:cntrl:]]*(PASSWORD|DATABASE_URL)' "$BACKUP_HELPER" ||
  fail 'backup helper may not log database contents or credentials'
! grep -Eq 'npm run db:migrate([[:space:]]|$)' "$DEPLOY_SCRIPT" || fail 'mutating db:migrate command is forbidden'
grep -Fq 'npm run db:migrate:verify' "$DEPLOY_SCRIPT" || fail 'read-only migration verification is missing'
grep -Fq 'MIGRATION_EXPECTATION=NO_OP' "$DEPLOY_SCRIPT" || fail 'no-op migration expectation must be emitted'
grep -Fq 'DATABASE_CHANGED=NO' "$DEPLOY_SCRIPT" || fail 'database must remain unchanged'
grep -Fq 'git archive --format=tar "$RELEASE_SHA"' "$DEPLOY_SCRIPT" || fail 'deployment must archive the exact validated SHA'

candidate=$(grep -nF "log 'CANDIDATE health=ok'" "$DEPLOY_SCRIPT" | cut -d: -f1)
cutover=$(grep -nF 'docker rename "$APP_CONTAINER" "$PREVIOUS"' "$DEPLOY_SCRIPT" | tail -n 1 | cut -d: -f1)
public_smoke=$(grep -nF 'public_ok=1' "$DEPLOY_SCRIPT" | head -n 1 | cut -d: -f1)
github_smoke=$(line_of 'Production smoke check' "$WORKFLOW")
deploy_call=$(grep -nE '^[[:space:]]+scripts/deploy-pawtech-production\.sh' "$WORKFLOW" | tail -n 1 | cut -d: -f1)
[ -n "$candidate" ] && [ -n "$cutover" ] && [ -n "$public_smoke" ] && [ -n "$github_smoke" ] && [ -n "$deploy_call" ] ||
  fail 'candidate health, cutover, deploy-script public smoke, and independent GitHub smoke are required'
[ "$candidate" -lt "$cutover" ] || fail 'candidate health must pass before cutover'
[ "$cutover" -lt "$public_smoke" ] || fail 'deploy-script public smoke must follow cutover'
[ "$deploy_call" -lt "$github_smoke" ] || fail 'independent GitHub smoke must follow the deploy script'
recovery_step=$(grep -nF 'name: Recover application after public smoke failure' "$WORKFLOW" | cut -d: -f1)
[ -n "$recovery_step" ] && [ "$github_smoke" -lt "$recovery_step" ] || fail 'failure-only rollback continuation must follow independent smoke'
grep -Fq 'api/health' "$WORKFLOW" || fail 'independent GitHub public health smoke is missing'
grep -Fq 'curl -fsS "${PRODUCTION_URL%/}/api/health"' "$WORKFLOW" || fail 'second smoke must require public HTTP success'
grep -Fq "x.status!=='ok'||x.dependencies?.database?.status!=='ok'||x.dependencies?.redis?.status!=='ok'" "$WORKFLOW" || fail 'second smoke must validate app/database/redis JSON health'
! grep -Fq 'continue-on-error: true' "$WORKFLOW" || fail 'second smoke failure must remain a workflow failure'
grep -Fq 'REMOTE_DEPLOY_READY' "$DEPLOY_SCRIPT" || fail 'remote deploy must not claim final workflow success'
! grep -Fq 'DEPLOY_OK' "$DEPLOY_SCRIPT" || fail 'remote script must not claim final deployment success'
grep -Fq 'DEPLOY_STATE_ATTEMPT=$ATTEMPT_ID' "$DEPLOY_SCRIPT" || fail 'pre-cutover state record must bind the deterministic attempt'
grep -Fq 'DEPLOY_STATE_FILE' "$DEPLOY_SCRIPT" || fail 'pre-cutover state record path is missing'
grep -Fq "printf 'PREVIOUS_CONTAINER=%s\\n' \"\$PREVIOUS\"" "$DEPLOY_SCRIPT" || fail 'state must serialize a validated previous container, never a none fallback'
for state_field in RELEASE_SHA IMAGE PREVIOUS_CONTAINER PREVIOUS_ID PREVIOUS_IMAGE BACKUP_ARTIFACT DATABASE_CHANGED DEPLOY_STATE_ATTEMPT; do
  grep -Fq "printf '$state_field=%s\\n'" "$DEPLOY_SCRIPT" || fail "pre-cutover state record is missing $state_field"
done
grep -Fq 'chmod 600 "$DEPLOY_STATE_FILE"' "$DEPLOY_SCRIPT" || fail 'pre-cutover state record must be mode 0600'
grep -Fq 'find "$MANUAL_BACKUP_ROOT" -name "deploy-state-${ATTEMPT_ID}.state"' "$DEPLOY_SCRIPT" || fail 'rollback must find state only in the manual CocinaCore hierarchy'
grep -Fq 'state_count' "$DEPLOY_SCRIPT" || fail 'rollback must require exactly one matching state record'
grep -Fq '[ "$state_mode" = 600 ] && [ "$state_owner" = "$deploy_uid" ] && [ "$state_dir_mode" = 700 ] && [ "$state_dir_owner" = "$deploy_uid" ]' "$DEPLOY_SCRIPT" || fail 'rollback must validate state and private-directory ownership/modes'
grep -Fq '[ "$previous_id" = "$STATE_PREVIOUS_ID" ] && [ "$previous_image" = "$STATE_PREVIOUS_IMAGE" ]' "$DEPLOY_SCRIPT" || fail 'rollback must validate retained previous container identity'
grep -Fq '[ "$current_image" = "$STATE_IMAGE" ] && [ "$current_attempt" = "$ATTEMPT_ID" ]' "$DEPLOY_SCRIPT" || fail 'rollback must validate current app ownership before removal'
grep -Fq 'rollback_mode()' "$DEPLOY_SCRIPT" || fail 'rollback-only mode implementation is missing'
rollback_block=$(sed -n '/^rollback_mode()/,/^}/p' "$DEPLOY_SCRIPT")
! printf '%s\n' "$rollback_block" | grep -Eq 'docker build|npm run db:migrate|backup-pawtech-cocinacore-predeploy|git archive|pg_restore[^[:cntrl:]]*--(dbname|clean|create)' || fail 'rollback mode must not build, migrate, back up, archive, or restore a database'
grep -Fq 'DATABASE_CHANGED=NO' "$DEPLOY_SCRIPT" || fail 'state and recovery must preserve no-database-change evidence'
grep -Fq 'APP_ROLLBACK_SAFE' "$DEPLOY_SCRIPT" && grep -Fq 'MANUAL_INTERVENTION_REQUIRED' "$DEPLOY_SCRIPT" || fail 'rollback must prove recovery or fail for manual intervention'
grep -Fq 'second public health smoke fails' "$RUNBOOK" || fail 'runbook must document application recovery after the independent smoke fails'
! grep -Eq 'pg_restore[^[:cntrl:]]*--(dbname|clean|create)|psql[^[:cntrl:]]*(--dbname| -d )' "$DEPLOY_SCRIPT" || fail 'automatic database restore is forbidden'
! grep -Eiq 'docker (volume|network) (create|rm|prune)|redis-cli[^[:cntrl:]]*(flush|del)|shared[^[:cntrl:]]*(database|cache)[^[:cntrl:]]*(mutat|flush|clear)' "$DEPLOY_SCRIPT" ||
  fail 'deploy path must not mutate shared database or cache infrastructure'
! grep -Eiq 'docker (volume|network) (create|rm|prune)|redis-cli[^[:cntrl:]]*(flush|del)' "$WORKFLOW" ||
  fail 'workflow must not mutate shared Docker or cache infrastructure'
! grep -Eiq 'pg_restore[^[:cntrl:]]*--(dbname|clean|create)|psql[^[:cntrl:]]*(--dbname| -d )' "$BACKUP_HELPER" ||
  fail 'backup helper must not perform a database restore'

for static_contract in test-pawtech-production-deploy-contract.sh test-pawtech-step4-contract.sh test-bootstrap-migrator-config.sh test-pawtech-step5-workflow-contract.sh; do
  grep -Fq "$static_contract" "$CI" || fail "CI is missing static contract $static_contract"
  grep -Fq "run: sh ../scripts/tests/$static_contract" "$CI" || fail "CI does not invoke static contract $static_contract"
done
! grep -Eiq 'Configure SSH|ssh[[:space:]]|environment:[[:space:]]*production|secrets\.(VPS_|PRODUCTION_URL)' "$CI" ||
  fail 'CI must not configure SSH or target production'
grep -Fq '/opt/pawtech/env/cocinacore.env' "$RUNBOOK" || fail 'runbook runtime environment path is missing'
grep -Fq 'npm run db:migrate:verify' "$RUNBOOK" || fail 'runbook must retain the read-only migration verification policy'
grep -Fq 'Never run `pg_restore --clean` or restore automatically' "$RUNBOOK" || fail 'runbook must forbid automatic database restore'
grep -Fq 'RESEND_API_KEY: ${RESEND_API_KEY:-}' "$COMPOSE" || fail 'Compose must permit absent optional email API key'
grep -Fq 'EMAIL_FROM: ${EMAIL_FROM:-}' "$COMPOSE" || fail 'Compose must permit absent optional sender address'
grep -Fq 'AUTH_SECRET: ${AUTH_SECRET:?AUTH_SECRET is required}' "$COMPOSE" || fail 'Compose must keep AUTH_SECRET required'
! grep -Eq '\.env\.production|\.env\.migration|docker compose -f docker-compose\.prod\.yml' "$WORKFLOW" || fail 'workflow must not use standalone Compose or alternate env files'

printf '%s\n' 'pawtech Step 5 workflow contract passed'
