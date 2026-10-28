#!/usr/bin/env bash
set -euo pipefail

version=1.7.12
case "$(uname -s):$(uname -m)" in
  Linux:x86_64) asset=linux_amd64; expected_sha256=8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8 ;;
  Darwin:arm64) asset=darwin_arm64; expected_sha256=aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f ;;
  Darwin:x86_64) asset=darwin_amd64; expected_sha256=5b44c3bc2255115c9b69e30efc0fecdf498fdb63c5d58e17084fd5f16324c644 ;;
  *) echo "Unsupported actionlint platform" >&2; exit 1 ;;
esac
archive="actionlint_${version}_${asset}.tar.gz"
root_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
work_dir=${RUNNER_TEMP:-${TMPDIR:-/tmp}}/actionlint-${version}
mkdir -p "$work_dir"
curl --fail --silent --show-error --location --retry 3 \
  "https://github.com/rhysd/actionlint/releases/download/v${version}/${archive}" \
  --output "$work_dir/$archive"
if sha256sum --help 2>&1 | grep -q -- "--check"; then
  actual_sha256=$(sha256sum "$work_dir/$archive" | awk '{print $1}')
else
  actual_sha256=$(shasum -a 256 "$work_dir/$archive" | awk '{print $1}')
fi
test "$actual_sha256" = "$expected_sha256"
tar --extract --file "$work_dir/$archive" --directory "$work_dir"
test -x "$work_dir/actionlint"
"$work_dir/actionlint" -ignore 'SC2034' -format '{{json .}}' "$root_dir/.github/workflows"/*.yml
