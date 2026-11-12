#!/bin/sh
# Only the dedicated storage service; never use root keys in the application.
set -eu
[ "${1:-}" = --initialize ] && [ "$#" -eq 1 ] || { echo 'Explicit --initialize required' >&2; exit 1; }
[ "$S3_ACCESS_KEY_ID" = cocinacore-app ] && [ "$RUSTFS_ACCESS_KEY" = cocinacore-root ] || exit 1
for value in "$RUSTFS_SECRET_KEY" "$S3_SECRET_ACCESS_KEY"; do
  case "$value" in ''|*[!a-f0-9]*) exit 1;; esac
  [ "${#value}" -ge 64 ] || exit 1
done
[ "$RUSTFS_SECRET_KEY" != "$S3_SECRET_ACCESS_KEY" ] || exit 1
export RC_HOST_ccroot="http://${RUSTFS_ACCESS_KEY}:${RUSTFS_SECRET_KEY}@storage:9000"
export RC_HOST_ccapp="http://${S3_ACCESS_KEY_ID}:${S3_SECRET_ACCESS_KEY}@storage:9000"
# Inspect lists successfully before creating anything; never interpret an
# arbitrary failed request as proof that an identity is missing.
policies=$(rc admin policy ls --json ccroot)
users=$(rc admin user ls --json ccroot)
policy_exists=$(printf '%s\n' "$policies" | jq -er '.policies | if type=="array" then (index("cocinacore-documents-app") != null | tostring) else error("unexpected policies") end')
user_exists=$(printf '%s\n' "$users" | jq -er --arg key "$S3_ACCESS_KEY_ID" '.users | if type=="array" then (any(.[]; .accessKey==$key) | tostring) else error("unexpected users") end')
expected=$(jq -cS . /app/storage-policy.json)
if [ "$policy_exists" = true ]; then
  actual=$(rc admin policy info --json ccroot cocinacore-documents-app | jq -cS '.policy.policy')
  [ "$actual" = "$expected" ] || { echo 'Existing storage policy differs; manual review required' >&2; exit 1; }
else
  [ "$user_exists" = false ] || { echo 'Existing user without expected policy; manual review required' >&2; exit 1; }
  rc admin policy create ccroot cocinacore-documents-app /app/storage-policy.json >/dev/null
fi
if [ "$user_exists" = true ]; then
  info=$(rc admin user info --json ccroot "$S3_ACCESS_KEY_ID")
  printf '%s\n' "$info" | jq -e '.status=="enabled" and .policies==["cocinacore-documents-app"] and .memberOf==[]' >/dev/null || { echo 'Existing storage identity differs; manual review required' >&2; exit 1; }
fi
rc bucket create --ignore-existing ccroot/cocinacore-documents >/dev/null
if [ "$user_exists" = false ]; then
  rc admin user add ccroot "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" >/dev/null
  rc admin policy attach ccroot cocinacore-documents-app --user "$S3_ACCESS_KEY_ID" >/dev/null
fi
info=$(rc admin user info --json ccroot "$S3_ACCESS_KEY_ID")
printf '%s\n' "$info" | jq -e '.status=="enabled" and .policies==["cocinacore-documents-app"] and .memberOf==[]' >/dev/null
rc bucket list ccapp/cocinacore-documents/global-pdfs/ >/dev/null
printf '%s\n' 'Storage bucket and scoped identity ready.'
