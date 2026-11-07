#!/bin/sh
set -eu

ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
ADMISSION="$ROOT/scripts/prod-017-hotfix-admission.mjs"
RELEASE_REPOSITORY=${1:-}

fail() {
  printf '%s\n' "prod-017 hotfix admission failed: $1" >&2
  exit 1
}

[ "$#" -eq 1 ] || fail 'candidate checkout path is required'
[ -e "$RELEASE_REPOSITORY/.git" ] || fail 'candidate checkout must be a Git repository'
command -v gh >/dev/null 2>&1 || fail 'GitHub CLI is required for evidence validation'
command -v node >/dev/null 2>&1 || fail 'Node.js is required for admission validation'
[ -n "${GH_TOKEN:-}" ] || fail 'GitHub read token is unavailable'
[ -n "${GITHUB_REPOSITORY:-}" ] || fail 'repository identity is unavailable'

tmp_root=${RUNNER_TEMP:-${TMPDIR:-/tmp}}
tmp_dir=$(mktemp -d "$tmp_root/prod-017-hotfix-evidence.XXXXXXXX") || fail 'temporary evidence directory could not be created'
trap 'rm -rf "$tmp_dir"' EXIT HUP INT TERM

# These are fixed read-only API endpoints; no workflow input selects an issue,
# PR, run, Environment, branch, tag, or release SHA. Failure to read the
# Environment contract is a hard rejection, not an approval fallback.
gh api "repos/$GITHUB_REPOSITORY/actions/runs/42310527377" > "$tmp_dir/ci.json" || fail 'pinned CI evidence could not be read'
gh api "repos/$GITHUB_REPOSITORY/issues/92" > "$tmp_dir/issue.json" || fail 'pinned issue evidence could not be read'
gh api "repos/$GITHUB_REPOSITORY/pulls/93" > "$tmp_dir/pull-request.json" || fail 'pinned PR evidence could not be read'
gh api "repos/$GITHUB_REPOSITORY/environments/production" > "$tmp_dir/environment.json" || fail 'production Environment protection metadata is unavailable'
gh api "repos/$GITHUB_REPOSITORY/environments/production/deployment-branch-policies" > "$tmp_dir/branch-policies.json" || fail 'production Environment branch policy metadata is unavailable'

node "$ADMISSION" git "$RELEASE_REPOSITORY"
node "$ADMISSION" evidence "$tmp_dir/ci.json" "$tmp_dir/issue.json" "$tmp_dir/pull-request.json" "$tmp_dir/environment.json" "$tmp_dir/branch-policies.json"
