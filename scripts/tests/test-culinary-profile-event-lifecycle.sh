#!/usr/bin/env bash
set -Eeuo pipefail
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
. "$ROOT/scripts/lib/connected-e2e-event-lifecycle.sh"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/culinary-event-lifecycle.XXXXXX")
cleanup_fixture() {
  [[ -z "${ACTIVE_PRODUCER:-}" ]] || kill -KILL "$ACTIVE_PRODUCER" 2>/dev/null || true
  [[ -z "${ACTIVE_SANITIZER:-}" ]] || kill -KILL "$ACTIVE_SANITIZER" 2>/dev/null || true
  rm -rf -- "$WORK"
}
fail() {
  printf 'event lifecycle fixture failure: %s\n' "$1" >&2
  cleanup_fixture
  exit 1
}

# The exact runner helper stops a live producer only after it has delivered its partial line;
# EOF makes the real Node sanitizer flush that line and exit zero.
mkfifo "$WORK/events.fifo" "$WORK/normal-control.fifo"
node "$ROOT/scripts/lib/redact-diagnostic-stream.mjs" --input-file "$WORK/events.fifo" > "$WORK/normal.log" &
sanitizer=$!
(
  trap - EXIT
  exec 3> "$WORK/events.fifo"
  exec 4<> "$WORK/normal-control.fifo"
  printf 'partial event password=fixture-lifecycle-secret' >&3
  : > "$WORK/normal-producer-ready"
  trap 'exec 3>&-; exec 4>&-; exit 0' TERM
  while :; do read -r -t 1 _ <&4 || true; done
) &
producer=$!
for attempt in $(seq 1 50); do [[ -f "$WORK/normal-producer-ready" ]] && break; sleep 0.1; done
[[ -f "$WORK/normal-producer-ready" ]] || fail 'normal producer did not write before lifecycle shutdown'
ACTIVE_PRODUCER=$producer
ACTIVE_SANITIZER=$sanitizer
if ! connected_e2e_event_lifecycle "$producer" "$sanitizer" 20 5 > "$WORK/normal-markers.log"; then
  while IFS= read -r marker; do printf 'graceful lifecycle marker: %s\n' "$marker" >&2; done < "$WORK/normal-markers.log"
  fail 'graceful TERM/EOF lifecycle must succeed'
fi
ACTIVE_PRODUCER=''
ACTIVE_SANITIZER=''
grep -q 'cause=owned-stop' "$WORK/normal-markers.log" && grep -q 'cause=normal' "$WORK/normal-markers.log" || fail 'normal producer/sanitizer causes must be recorded'
grep -q 'partial event password=\[REDACTED\]' "$WORK/normal.log" || fail 'sanitized partial event output must survive graceful EOF'
! grep -q 'fixture-lifecycle-secret' "$WORK/normal.log" || fail 'partial output must be redacted'

# Already-observed external TERM and KILL remain distinguishable and are reaped by the helper.
for signal in TERM KILL; do
  sleep 30 & producer=$!
  sleep 30 & sanitizer=$!
  ACTIVE_PRODUCER=$producer
  ACTIVE_SANITIZER=$sanitizer
  if [[ "$signal" == TERM ]]; then kill -TERM "$sanitizer"; else kill -KILL "$sanitizer"; fi
  for attempt in $(seq 1 20); do connected_e2e_process_terminated "$sanitizer" && break; sleep 0.1; done
  if connected_e2e_event_lifecycle "$producer" "$sanitizer" 20 5 > /dev/null; then
    fail "$signal sanitizer termination must fail lifecycle capture"
  fi
  ACTIVE_PRODUCER=''
  ACTIVE_SANITIZER=''
  if [[ "$signal" == TERM ]]; then
    [[ "$CONNECTED_E2E_EVENT_CAUSE" == external-term ]] || fail 'TERM must be recorded as external TERM/143'
  else
    [[ "$CONNECTED_E2E_EVENT_CAUSE" == external-kill ]] || fail 'KILL must be recorded as external KILL/137'
  fi
done

# Non-signal sanitizer failures stay distinct from owned timeout and external signals.
sleep 30 & producer=$!
bash -c 'exit 7' & sanitizer=$!
ACTIVE_PRODUCER=$producer
ACTIVE_SANITIZER=$sanitizer
if connected_e2e_event_lifecycle "$producer" "$sanitizer" 20 5 > "$WORK/error.log"; then
  fail 'nonzero sanitizer exit must fail lifecycle capture'
fi
ACTIVE_PRODUCER=''
ACTIVE_SANITIZER=''
grep -q 'exit=7 signal=NONE cause=sanitizer-error' "$WORK/error.log" || fail 'sanitizer error must be recorded distinctly'

# The active timeout pipeline writes already-redacted partial output before the sanitizer hangs;
# the runner's post-lifecycle copy must retain those exact safe bytes.
mkfifo "$WORK/timeout.fifo" "$WORK/timeout-control.fifo"
node -e 'const fs = require("node:fs"); let input = ""; process.on("SIGTERM", () => {}); fs.createReadStream(process.argv[1]).on("data", (chunk) => { input += chunk.toString(); }).on("end", () => { process.stdout.write(input.replace(/password=[^\s]+/g, "password=[REDACTED]")); setInterval(() => {}, 1000); });' "$WORK/timeout.fifo" > "$WORK/timeout.log" & sanitizer=$!
(
  trap - EXIT
  exec 3> "$WORK/timeout.fifo"
  exec 4<> "$WORK/timeout-control.fifo"
  printf 'safe partial output password=fixture-timeout-secret\n' >&3
  : > "$WORK/timeout-producer-ready"
  trap 'exec 3>&-; exec 4>&-; exit 0' TERM
  while :; do read -r -t 1 _ <&4 || true; done
) & producer=$!
for attempt in $(seq 1 50); do [[ -f "$WORK/timeout-producer-ready" ]] && break; sleep 0.1; done
[[ -f "$WORK/timeout-producer-ready" ]] || fail 'timeout producer did not write before lifecycle shutdown'
ACTIVE_PRODUCER=$producer
ACTIVE_SANITIZER=$sanitizer
if connected_e2e_event_lifecycle "$producer" "$sanitizer" 2 2 > "$WORK/timeout-markers.log"; then
  fail 'unresponsive sanitizer timeout must be reported as unsuccessful capture'
fi
cp "$WORK/timeout.log" "$WORK/owned-events.log"
ACTIVE_PRODUCER=''
ACTIVE_SANITIZER=''
grep -q 'stage=timeout .*cause=owned-timeout' "$WORK/timeout-markers.log" || fail 'timeout must be recorded before escalation'
grep -q 'stage=kill-escalation .*exit=137 signal=KILL cause=owned-timeout-kill' "$WORK/timeout-markers.log" || fail 'timeout KILL escalation must report exact outcome'
grep -q '^safe partial output password=\[REDACTED\]$' "$WORK/owned-events.log" || fail 'timeout handling must preserve and copy already-produced sanitized output'
! grep -q 'fixture-timeout-secret' "$WORK/owned-events.log" || fail 'timeout partial output must remain sanitized'

# Verify Docker event key/value redaction through the production sanitizer subprocess.
printf 'docker event password=fixture-docker-event-password\n' | node "$ROOT/scripts/lib/redact-diagnostic-stream.mjs" > "$WORK/event.log"
grep -q 'password=\[REDACTED\]' "$WORK/event.log" || fail 'Docker event password label must be redacted'
! grep -q 'fixture-docker-event-password' "$WORK/event.log" || fail 'Docker event secret must not survive'
cleanup_fixture
printf 'event lifecycle fixtures passed (normal EOF, TERM, KILL, timeout escalation, partial output, redaction)\n'
