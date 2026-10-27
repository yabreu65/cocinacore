#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
IMAGE="cocinacore:docker-route-contract-${GITHUB_SHA:-local}"
CONTAINER="cocinacore-docker-route-contract-$$"
PORT=${DOCKER_ROUTE_CONTRACT_PORT:-18080}

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  docker image rm "$IMAGE" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

fail() {
  printf '%s\n' "docker image route contract failure: $1" >&2
  exit 1
}

docker build --file "$ROOT/Dockerfile" --tag "$IMAGE" "$ROOT"

for route in \
  'api/meal-plan/coverage/route.js' \
  'api/waste-prevention/route.js' \
  'api/meal-plan/adaptive-proposal/route.js' \
  'api/meal-plan/shopping-suggestions/route.js'; do
  docker run --rm "$IMAGE" sh -c "test -f /app/.next/server/app/$route" ||
    fail "route is absent from the production image: $route"
done

docker run --detach --name "$CONTAINER" --publish "127.0.0.1:${PORT}:3000" "$IMAGE" >/dev/null

status='000'
for _ in $(seq 1 30); do
  status=$(curl --silent --output /dev/null --write-out '%{http_code}' \
    --max-time 2 "http://127.0.0.1:${PORT}/api/meal-plan/coverage?horizonDays=7" || true)
  [ "$status" != '000' ] && break
  sleep 1
done

[ "$status" = '401' ] || fail "anonymous coverage request returned $status, expected 401"
printf '%s\n' 'docker image route contract: PASS'
