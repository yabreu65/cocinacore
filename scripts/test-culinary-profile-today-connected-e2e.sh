#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "$#" -ne 0 ]]; then
  printf 'culinary profile today connected E2E wrapper accepts no arguments.\n' >&2
  exit 2
fi

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
exec bash "$ROOT/scripts/test-culinary-profile-connected-e2e.sh" today
