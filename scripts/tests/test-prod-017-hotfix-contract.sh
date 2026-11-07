#!/bin/sh
# shellcheck disable=SC2016,SC2030,SC2031,SC2034,SC2329 # Literal snippets and dynamically evaluated gate tests are intentional.
set -eu

ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
WORKFLOW="$ROOT/.github/workflows/deploy-prod-017-hotfix.yml"
NORMAL_WORKFLOW="$ROOT/.github/workflows/deploy.yml"
DEPLOY_SCRIPT="$ROOT/scripts/deploy-pawtech-production.sh"
ADMISSION_SCRIPT="$ROOT/scripts/prod-017-hotfix-admission.mjs"
EVIDENCE_SCRIPT="$ROOT/scripts/validate-prod-017-hotfix.sh"
NODE_TEST="$ROOT/scripts/tests/prod-017-hotfix-admission.test.mjs"
RUNBOOK="$ROOT/docs/ops/prod-017-hotfix-admission.md"

fail() {
  printf '%s\n' "prod-017 hotfix contract failure: $1" >&2
  exit 1
}

for file in "$WORKFLOW" "$NORMAL_WORKFLOW" "$DEPLOY_SCRIPT" "$ADMISSION_SCRIPT" "$EVIDENCE_SCRIPT" "$NODE_TEST" "$RUNBOOK"; do
  [ -f "$file" ] || fail "required admission file is missing: ${file#"$ROOT"/}"
done

sh -n "$DEPLOY_SCRIPT" || fail 'production deploy script syntax is invalid'
sh -n "$EVIDENCE_SCRIPT" || fail 'evidence validation script syntax is invalid'
node --check "$ADMISSION_SCRIPT" || fail 'admission validator syntax is invalid'
node --check "$NODE_TEST" || fail 'admission tests syntax is invalid'
node --test "$NODE_TEST"

workflow_dispatch_block=$(sed -n '/^on:/,/^[^[:space:]]/p' "$WORKFLOW")
printf '%s\n' "$workflow_dispatch_block" | grep -Eq '^  workflow_dispatch:$' || fail 'hotfix workflow must be manual only'
printf '%s\n' "$workflow_dispatch_block" | grep -Fq '      admission_mode:' || fail 'hotfix workflow must require an explicit admission mode'
printf '%s\n' "$workflow_dispatch_block" | grep -Fq '          - gha' || fail 'hotfix workflow must preserve GHA admission mode'
printf '%s\n' "$workflow_dispatch_block" | grep -Fq '          - manual' || fail 'hotfix workflow must expose only the fixed manual authorization mode'
printf '%s\n' "$workflow_dispatch_block" | grep -Fq '      manual_attempt_id:' || fail 'manual path must receive its bound attempt ID'
printf '%s\n' "$workflow_dispatch_block" | grep -Fq '      authorization_comment_id:' || fail 'manual path must receive the exact authorization comment ID'
! printf '%s\n' "$workflow_dispatch_block" | grep -Eiq 'release_sha:|branch:|tag:|ci_run:|pull_request:|issue_number:' ||
  fail 'hotfix workflow must not expose caller-controlled release or evidence selectors'
grep -Fq "if: github.ref == 'refs/heads/main'" "$WORKFLOW" || fail 'hotfix jobs must execute only from main'
grep -Fq 'node-version: 22.22.3' "$WORKFLOW" || fail 'admission workflow must pin Node 22.22.3'
grep -Fq 'environment: production' "$WORKFLOW" || fail 'hotfix deploy must use the production approval Environment'
grep -Fq 'needs: validate-release' "$WORKFLOW" || fail 'production deployment must depend on completed validation'
grep -Fq 'group: deploy-production' "$WORKFLOW" || fail 'hotfix workflow must share official deploy concurrency'
grep -Fq 'cancel-in-progress: false' "$WORKFLOW" || fail 'hotfix deploy must not be cancelled by a newer deployment'
for permission in 'contents: read' 'actions: read' 'issues: read' 'pull-requests: read'; do
  grep -Fq "$permission" "$WORKFLOW" || fail "missing least-privilege GitHub permission: $permission"
done
! grep -Eiq 'contents:[[:space:]]*write|actions:[[:space:]]*write|issues:[[:space:]]*write|pull-requests:[[:space:]]*write' "$WORKFLOW" ||
  fail 'admission workflow may not grant GitHub write permissions'

grep -Fq 'd4a13a61cc0d24c4eda96a7baffaacfd0e47c191' "$WORKFLOW" || fail 'workflow is missing fixed candidate SHA'
grep -Fq 'ad99d502ff19d7bb154c04c24697d2a43c1b17e8' "$DEPLOY_SCRIPT" || fail 'server deploy script must pin the production baseline'
grep -Fq 'actions/runs/42310527377' "$EVIDENCE_SCRIPT" || fail 'workflow evidence script must pin the successful CI run'
grep -Fq 'issues/92' "$EVIDENCE_SCRIPT" || fail 'workflow evidence script must pin the risk issue'
grep -Fq 'pulls/93' "$EVIDENCE_SCRIPT" || fail 'workflow evidence script must pin the candidate PR'
grep -Fq 'environments/production"' "$EVIDENCE_SCRIPT" || fail 'evidence script must read production Environment protection metadata'
grep -Fq 'environments/production/deployment-branch-policies' "$EVIDENCE_SCRIPT" || fail 'evidence script must read production deployment branch policies'
grep -Fq 'validateEnvironmentConfiguration' "$ADMISSION_SCRIPT" || fail 'admission must validate Environment approvals and branch restrictions'
grep -Fq 'production Environment protection metadata is unavailable' "$EVIDENCE_SCRIPT" || fail 'inaccessible Environment metadata must fail closed'
grep -Fq 'production Environment branch policy metadata is unavailable' "$EVIDENCE_SCRIPT" || fail 'inaccessible branch policy metadata must fail closed'

grep -Fq 'issues/92' "$EVIDENCE_SCRIPT" || fail 'evidence script must read only the accepted advisory issue'
grep -Fq 'pulls/93' "$EVIDENCE_SCRIPT" || fail 'evidence script must read only the isolated candidate PR'
grep -Fq 'RELEASE_SHA: d4a13a61cc0d24c4eda96a7baffaacfd0e47c191' "$WORKFLOW" || fail 'workflow release constant differs from the reviewed SHA'
grep -Fq 'sha: "d4a13a61cc0d24c4eda96a7baffaacfd0e47c191"' "$ADMISSION_SCRIPT" || fail 'validator release constant differs from the reviewed SHA'
grep -Fq 'PROD_017_HOTFIX_SHA=d4a13a61cc0d24c4eda96a7baffaacfd0e47c191' "$DEPLOY_SCRIPT" || fail 'server-side release constant differs from the reviewed SHA'
grep -Fq 'PROD_017_HOTFIX_PARENT=ad99d502ff19d7bb154c04c24697d2a43c1b17e8' "$DEPLOY_SCRIPT" || fail 'server-side baseline constant differs from production SHA'
grep -Fq 'PROD_017_PARENT_IMAGE_ID=sha256:b72d20d7c9e6634584b562837e563355c87d02439c0c64bd44d870f0056a7204' "$DEPLOY_SCRIPT" || fail 'server baseline image digest differs from the verified production image'
grep -Fq 'validate_prod017_hotfix_candidate' "$DEPLOY_SCRIPT" || fail 'server deploy script must independently validate the fixed candidate'
grep -Fq 'frontend/e2e/specs/pdfjs-upload-compat.spec.ts' "$DEPLOY_SCRIPT" || fail 'server allowlist is missing the reviewed E2E path'
grep -Fq 'frontend/src/app/api/meal-plan/shopping-suggestions/route.test.ts' "$DEPLOY_SCRIPT" || fail 'server allowlist is missing the reviewed API test path'
grep -Fq "17|017|017_persistent_recipe_archive.sql" "$DEPLOY_SCRIPT" || fail 'server must enforce the exact schema-017 manifest'

server_gate=$(sed -n '/^validate_prod017_hotfix_candidate()/,/^}/p' "$DEPLOY_SCRIPT")
[ -n "$server_gate" ] || fail 'server-side candidate validator function is missing'
(
  set -eu
  fail() { printf '%s\n' "$*" >&2; exit 1; }
  PROD_017_HOTFIX_SHA=d4a13a61cc0d24c4eda96a7baffaacfd0e47c191
  PROD_017_HOTFIX_PARENT=ad99d502ff19d7bb154c04c24697d2a43c1b17e8
  RELEASE_SHA=d4a13a61cc0d24c4eda96a7baffaacfd0e47c191
  eval "$server_gate"
  validate_prod017_hotfix_candidate
) || fail 'server-side validator rejected its exact fixed candidate'
if (
  set -eu
  fail() { exit 1; }
  PROD_017_HOTFIX_SHA=d4a13a61cc0d24c4eda96a7baffaacfd0e47c191
  PROD_017_HOTFIX_PARENT=ad99d502ff19d7bb154c04c24697d2a43c1b17e8
  RELEASE_SHA=refs/heads/another-release
  eval "$server_gate"
  validate_prod017_hotfix_candidate
) >/dev/null 2>&1; then
  fail 'server-side validator accepted a mutable ref instead of the fixed SHA'
fi

previous_app_gate=$(sed -n '/^check_previous_app_for_release()/,/^}/p' "$DEPLOY_SCRIPT")
[ -n "$previous_app_gate" ] || fail 'server-side exact previous-image validator is missing'
(
  set -eu
  PROD_017_HOTFIX_PARENT=ad99d502ff19d7bb154c04c24697d2a43c1b17e8
  MODE=prod-017-hotfix-preflight
  PREVIOUS_IMAGE=
  APP_CONTAINER=cocinacore-web
  PROD_017_PARENT_IMAGE_ID=sha256:b72d20d7c9e6634584b562837e563355c87d02439c0c64bd44d870f0056a7204
  check_previous_app() { PREVIOUS_IMAGE=$TEST_PREVIOUS_IMAGE; }
  docker() { printf '%s\n' "$TEST_PREVIOUS_DOCKER_IMAGE_ID"; }
  TEST_PREVIOUS_IMAGE="cocinacore:deploy-$PROD_017_HOTFIX_PARENT"
  TEST_PREVIOUS_DOCKER_IMAGE_ID=$PROD_017_PARENT_IMAGE_ID
  eval "$previous_app_gate"
  check_previous_app_for_release
) || fail 'server-side validator rejected the exact deployed production baseline image and digest'
if (
  set -eu
  PROD_017_HOTFIX_PARENT=ad99d502ff19d7bb154c04c24697d2a43c1b17e8
  MODE=prod-017-hotfix-deploy
  PREVIOUS_IMAGE=
  APP_CONTAINER=cocinacore-web
  PROD_017_PARENT_IMAGE_ID=sha256:b72d20d7c9e6634584b562837e563355c87d02439c0c64bd44d870f0056a7204
  check_previous_app() { PREVIOUS_IMAGE=$TEST_PREVIOUS_IMAGE; }
  docker() { printf '%s\n' "$TEST_PREVIOUS_DOCKER_IMAGE_ID"; }
  TEST_PREVIOUS_IMAGE='cocinacore:deploy-ffffffffffffffffffffffffffffffffffffffff'
  TEST_PREVIOUS_DOCKER_IMAGE_ID=$PROD_017_PARENT_IMAGE_ID
  eval "$previous_app_gate"
  check_previous_app_for_release
) >/dev/null 2>&1; then
  fail 'server-side validator accepted a production image different from the fixed parent'
fi
if (
  set -eu
  PROD_017_HOTFIX_PARENT=ad99d502ff19d7bb154c04c24697d2a43c1b17e8
  MODE=prod-017-hotfix-deploy
  PREVIOUS_IMAGE=
  APP_CONTAINER=cocinacore-web
  PROD_017_PARENT_IMAGE_ID=sha256:b72d20d7c9e6634584b562837e563355c87d02439c0c64bd44d870f0056a7204
  check_previous_app() { PREVIOUS_IMAGE=$TEST_PREVIOUS_IMAGE; }
  docker() { printf '%s\n' "$TEST_PREVIOUS_DOCKER_IMAGE_ID"; }
  TEST_PREVIOUS_IMAGE="cocinacore:deploy-$PROD_017_HOTFIX_PARENT"
  TEST_PREVIOUS_DOCKER_IMAGE_ID=sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
  eval "$previous_app_gate"
  check_previous_app_for_release
) >/dev/null 2>&1; then
  fail 'server-side validator accepted a moved baseline image tag'
fi

for mode in prod-017-hotfix-preflight prod-017-hotfix-deploy; do
  grep -Fq "$mode" "$DEPLOY_SCRIPT" || fail "server script lacks fixed mode $mode"
done
grep -Fq 'git merge-base --is-ancestor "$RELEASE_SHA" origin/main' "$DEPLOY_SCRIPT" || fail 'ordinary deploy ancestry gate was removed'
grep -Fq 'git merge-base --is-ancestor "$TRUSTED_WORKFLOW_SHA" origin/main' "$WORKFLOW" || fail 'VPS must require trusted workflow source on main'
grep -Fq 'git show "$TRUSTED_WORKFLOW_SHA:scripts/deploy-pawtech-production.sh"' "$WORKFLOW" || fail 'VPS must execute the versioned trusted deploy script'
! grep -Fq 'git show "$RELEASE_SHA:scripts/deploy-pawtech-production.sh"' "$WORKFLOW" || fail 'hotfix must not execute deploy code from candidate source'
! grep -Fq 'git checkout --detach "$RELEASE_SHA"' "$WORKFLOW" || fail 'hotfix must not move the persistent VPS checkout to the candidate'
grep -Fq 'steps.deploy.outcome == '\''success'\'' && steps.public-smoke.outcome == '\''failure'\''' "$WORKFLOW" || fail 'public health failure must invoke recovery'
grep -Fq 'rollback "$ATTEMPT_ID"' "$WORKFLOW" || fail 'recovery must use the exact deployment attempt'
if ! grep -Fq 'PREVIOUS_ID' "$DEPLOY_SCRIPT" || ! grep -Fq 'PREVIOUS_IMAGE' "$DEPLOY_SCRIPT"; then
  fail 'exact container/image rollback identity was weakened'
fi
grep -Fq 'npm run db:migrate:verify' "$DEPLOY_SCRIPT" || fail 'read-only schema verification was removed'
! grep -Eq 'npm run db:migrate([[:space:]]|$)' "$DEPLOY_SCRIPT" || fail 'mutating migration command is forbidden'
grep -Fq 'verify-pawtech-cocinacore-daily-backup.sh' "$DEPLOY_SCRIPT" || fail 'official backup verification is missing'

# This route does not modify the ordinary workflow. Verify its independent
# main-only condition and ancestor gate rather than comparing against the
# production-017 candidate snapshot (main intentionally contains M5).
grep -Fq "if: github.ref == 'refs/heads/main'" "$NORMAL_WORKFLOW" || fail 'ordinary deployment workflow must remain main-only'
grep -Fq 'git merge-base --is-ancestor "$DEPLOY_SHA" origin/main' "$NORMAL_WORKFLOW" || fail 'normal workflow no longer requires main ancestry'
! grep -Fq 'PROD_017_HOTFIX' "$NORMAL_WORKFLOW" || fail 'fixed hotfix exception leaked into the ordinary workflow'

grep -Fq 'workflow must be present on the default branch' "$RUNBOOK" || fail 'runbook must require default-branch integration before dispatch'
grep -Fq 'protection_rules=[]' "$RUNBOOK" || fail 'runbook must record the verified missing production approval rules'
grep -Fq '**NO-GO**' "$RUNBOOK" || fail 'runbook must block use until Environment protection is configured and verified'
grep -Fq 'fails closed' "$RUNBOOK" || fail 'runbook must require rejection when Environment APIs are unavailable'
grep -Fq 'exactly one custom branch policy' "$RUNBOOK" || fail 'runbook must document exact main-only branch policy'

for manual_expected in \
  'COCINACORE-PROD-017-MANUAL-AUTHORIZATION-V1' \
  'author_association !== "OWNER"' \
  'yabreu65' \
  'manual-api' \
  'issues/comments/${commentId}' \
  'manual-auth-${ATTEMPT_ID}' \
  'manual authorization attempt was already reserved' \
  'manual authorization attempt was already consumed' \
  'manual rollback authorization identity mismatch' \
  'MANUAL_AUTH_STATUS=CONSUMED'; do
  if ! grep -Fq "$manual_expected" "$ADMISSION_SCRIPT" "$DEPLOY_SCRIPT"; then
    grep -Fq "$manual_expected" "$WORKFLOW" || fail "manual authorization contract is missing: $manual_expected"
  fi
done
grep -Fq 'prod-017-manual-preflight' "$DEPLOY_SCRIPT" || fail 'manual preflight mode is missing'
grep -Fq 'prod-017-manual-deploy' "$DEPLOY_SCRIPT" || fail 'manual deploy mode is missing'
grep -Fq 'unset GH_TOKEN' "$WORKFLOW" || fail 'manual token must be unset immediately after server-side validation'
grep -Fq 'source /dev/stdin' "$WORKFLOW" || fail 'SSH bootstrap must keep the token out of exported environment and command arguments'
remote_payload=$(sed -n "/cat <<'REMOTE_SCRIPT'/,/^[[:space:]]*REMOTE_SCRIPT/p" "$WORKFLOW")
if printf '%s\n' "$remote_payload" | grep -Eq '^[[:space:]]*IFS= read -r (GH_TOKEN|RELEASE_SHA|TRUSTED_WORKFLOW_SHA|PRODUCTION_URL|ATTEMPT_ID|ADMISSION_MODE|AUTHORIZATION_COMMENT_ID|REMOTE_PHASE)'; then
  fail 'remote payload must not consume SSH protocol headers after the bootstrap has already read them'
fi
grep -Fq 'GH_TOKEN="$GH_TOKEN" sh -s --' "$WORKFLOW" || fail 'manual token must be delivered only to the verifier invocation over SSH stdin'
! grep -Fq 'export GH_TOKEN' "$WORKFLOW" || fail 'manual GitHub token must not be exported to the deploy shell environment'
if ! grep -Fq 'run_remote manual-preflight' "$WORKFLOW" ||
  ! grep -Fq 'run_remote manual-deploy' "$WORKFLOW"; then
  fail 'manual preflight and deployment must use separate one-use SSH token streams'
fi
ssh_invocation=$(grep -F ' -i ~/.ssh/cocinacore_deploy_key "$VPS_USER@$VPS_HOST"' "$WORKFLOW" | head -n 1)
! printf '%s\n' "$ssh_invocation" | grep -Fq '$GH_TOKEN' || fail 'manual GitHub token must not appear in SSH argv'
grep -Fq 'The owner authorization is not an independent human review' "$RUNBOOK" ||
  grep -Fq 'not an independent human review' "$RUNBOOK" || fail 'runbook must not claim independent review for the owner path'

# Exercise the actual workflow deployment shell and remote bootstrap with fake SSH.
# The fake validates the header, rejects a token in SSH argv, then replays the
# actual bootstrap with a harmless payload instead of contacting a server.
ssh_test_root=$(mktemp -d "${TMPDIR:-/tmp}/prod-017-fake-ssh.XXXXXXXX") || fail 'fake SSH test temp directory unavailable'
trap 'rm -rf "$ssh_test_root"' EXIT HUP INT TERM
mkdir "$ssh_test_root/bin"
cat > "$ssh_test_root/bin/ssh" <<'EOF'
#!/bin/sh
remote_command=
for arg in "$@"; do
  remote_command=$arg
  case "$arg" in
    *"${EXPECTED_GH_TOKEN:-}"*)
      [ -n "${EXPECTED_GH_TOKEN:-}" ] || continue
      printf '%s\n' 'token value leaked into fake SSH argv' >&2
      exit 91
      ;;
  esac
done
IFS= read -r received_token || exit 92
[ "$received_token" = "${EXPECTED_GH_TOKEN:-}" ] || exit 93
IFS= read -r received_release_sha || exit 92
IFS= read -r received_workflow_sha || exit 92
IFS= read -r received_production_url || exit 92
IFS= read -r received_attempt_id || exit 92
IFS= read -r received_mode || exit 92
IFS= read -r received_comment_id || exit 92
IFS= read -r received_phase || exit 92
cat >/dev/null
printf 'ssh-call\n' >> "$SSH_CALLS"
{
  printf '%s\n' "$received_token" "$received_release_sha" "$received_workflow_sha" "$received_production_url" "$received_attempt_id" "$received_mode" "$received_comment_id" "$received_phase"
  cat <<'REMOTE_TEST_PAYLOAD'
set -euo pipefail
check_value() {
  [ "$2" = "$3" ] || { printf 'remote bootstrap fixture mismatch: %s expected=<%s> actual=<%s>\n' "$1" "$2" "$3" >&2; exit 1; }
}
check_value release-sha d4a13a61cc0d24c4eda96a7baffaacfd0e47c191 "$RELEASE_SHA"
check_value workflow-sha aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa "$TRUSTED_WORKFLOW_SHA"
check_value mode "${EXPECTED_ADMISSION_MODE:?}" "$ADMISSION_MODE"
if [ "${EXPECTED_REMOTE_PHASE:?}" = manual ]; then
  case "$REMOTE_PHASE" in
    manual-preflight|manual-deploy) ;;
    *) printf 'remote bootstrap fixture mismatch: phase <%s>\n' "$REMOTE_PHASE" >&2; exit 1 ;;
  esac
else
  check_value phase "$EXPECTED_REMOTE_PHASE" "$REMOTE_PHASE"
fi
check_value attempt "${EXPECTED_ATTEMPT_ID:?}" "$ATTEMPT_ID"
check_value comment-id "${EXPECTED_COMMENT_ID-}" "$AUTHORIZATION_COMMENT_ID"
if [ "$ADMISSION_MODE" = manual ]; then
  [ "$GH_TOKEN" = fixture_read_token ]
else
  [ -z "$GH_TOKEN" ]
fi
printf '%s\n' "$REMOTE_PHASE" >> "$REMOTE_BOOTSTRAP_TRACE"
REMOTE_TEST_PAYLOAD
} | bash -x -c "$remote_command" 2>"${SSH_DEBUG:?}" || {
  cat "$SSH_DEBUG" >&2
  exit 94
}
EOF
chmod 700 "$ssh_test_root/bin/ssh"
ruby -ryaml -e 'd=YAML.load_file(ARGV[0]); s=d.fetch("jobs").fetch("deploy-production").fetch("steps").find{|x| x["id"]=="deploy"}; print s.fetch("run")' "$WORKFLOW" > "$ssh_test_root/deploy-step.sh" || fail 'could not extract workflow deployment shell'
PATH="$ssh_test_root/bin:$PATH" EXPECTED_GH_TOKEN='fixture_read_token' EXPECTED_ADMISSION_MODE=manual EXPECTED_REMOTE_PHASE=manual \
  EXPECTED_ATTEMPT_ID=manual-20261107T020000Z-a1b2c3d4e5f60718 EXPECTED_COMMENT_ID=987654321 REMOTE_BOOTSTRAP_TRACE="$ssh_test_root/manual.bootstrap" \
  SSH_DEBUG="$ssh_test_root/remote-bootstrap.debug" SSH_CALLS="$ssh_test_root/manual.calls" \
  GH_TOKEN=fixture_read_token RELEASE_SHA=d4a13a61cc0d24c4eda96a7baffaacfd0e47c191 TRUSTED_WORKFLOW_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  PRODUCTION_URL=https://example.invalid VPS_HOST=example.invalid VPS_USER=deploy HOME="$ssh_test_root" \
  ADMISSION_MODE=manual MANUAL_ATTEMPT_ID=manual-20261107T020000Z-a1b2c3d4e5f60718 AUTHORIZATION_COMMENT_ID=987654321 \
  GITHUB_RUN_ID=123 GITHUB_RUN_ATTEMPT=1 bash "$ssh_test_root/deploy-step.sh" || fail 'manual workflow did not complete both fake SSH stages'
[ "$(wc -l < "$ssh_test_root/manual.calls" | tr -d ' ')" = 2 ] || fail 'manual workflow must open separate fake SSH sessions for preflight and deploy'
PATH="$ssh_test_root/bin:$PATH" EXPECTED_GH_TOKEN='' EXPECTED_ADMISSION_MODE=gha EXPECTED_REMOTE_PHASE=gha \
  EXPECTED_ATTEMPT_ID=gha-123-1 EXPECTED_COMMENT_ID='' REMOTE_BOOTSTRAP_TRACE="$ssh_test_root/gha.bootstrap" \
  SSH_DEBUG="$ssh_test_root/remote-bootstrap.debug" SSH_CALLS="$ssh_test_root/gha.calls" \
  GH_TOKEN=fixture_read_token RELEASE_SHA=d4a13a61cc0d24c4eda96a7baffaacfd0e47c191 TRUSTED_WORKFLOW_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  PRODUCTION_URL=https://example.invalid VPS_HOST=example.invalid VPS_USER=deploy HOME="$ssh_test_root" \
  ADMISSION_MODE=gha MANUAL_ATTEMPT_ID='' AUTHORIZATION_COMMENT_ID='' GITHUB_RUN_ID=123 GITHUB_RUN_ATTEMPT=1 \
  bash "$ssh_test_root/deploy-step.sh" || fail 'GHA workflow did not complete its fake SSH session'
[ "$(wc -l < "$ssh_test_root/gha.calls" | tr -d ' ')" = 1 ] || fail 'GHA mode must preserve its single SSH deployment session'
[ "$(wc -l < "$ssh_test_root/manual.bootstrap" | tr -d ' ')" = 2 ] || {
  printf 'manual bootstrap trace: <%s>\n' "$(cat "$ssh_test_root/manual.bootstrap" 2>/dev/null || true)" >&2
  fail 'manual remote bootstrap did not execute both safe payloads'
}
[ "$(cat "$ssh_test_root/manual.bootstrap")" = "manual-preflight
manual-deploy" ] || fail 'manual remote bootstrap received incorrect phase values'
[ "$(cat "$ssh_test_root/gha.bootstrap")" = gha ] || fail 'GHA remote bootstrap received incorrect phase value'
if PATH="$ssh_test_root/bin:$PATH" EXPECTED_GH_TOKEN='fixture_read_token' SSH_CALLS="$ssh_test_root/newline.calls" \
  GH_TOKEN=fixture_read_token RELEASE_SHA=d4a13a61cc0d24c4eda96a7baffaacfd0e47c191 TRUSTED_WORKFLOW_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  PRODUCTION_URL="$(printf 'https://example.invalid\nbroken')" VPS_HOST=example.invalid VPS_USER=deploy HOME="$ssh_test_root" \
  ADMISSION_MODE=manual MANUAL_ATTEMPT_ID=manual-20261107T020000Z-a1b2c3d4e5f60718 AUTHORIZATION_COMMENT_ID=987654321 \
  GITHUB_RUN_ID=123 GITHUB_RUN_ATTEMPT=1 bash "$ssh_test_root/deploy-step.sh" >/dev/null 2>&1; then
  fail 'line-broken production URL reached fake SSH'
fi
[ ! -e "$ssh_test_root/newline.calls" ] || fail 'newline in production URL entered the SSH line protocol'

printf '%s\n' 'PROD_017_HOTFIX_CONTRACT_OK'
