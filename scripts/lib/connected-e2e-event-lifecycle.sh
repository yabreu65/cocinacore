#!/usr/bin/env bash
# Bash 3-compatible bounded shutdown for the owned Docker-events producer and
# its stdin sanitizer. Source this file; stdout contains status-only markers.
connected_e2e_process_terminated() {
  local pid=$1 state
  if ! kill -0 "$pid" 2>/dev/null; then return 0; fi
  state=$(ps -o stat= -p "$pid" 2>/dev/null) || return 1
  [[ "$state" == Z* || "$state" == *' Z'* ]]
}

connected_e2e_wait_bounded() {
  local pid=$1 attempts=$2 attempt
  for attempt in $(seq 1 "$attempts"); do
    connected_e2e_process_terminated "$pid" && return 0
    sleep 0.1
  done
  connected_e2e_process_terminated "$pid"
}

connected_e2e_reap() {
  local pid=$1
  CONNECTED_E2E_REAP_STATUS=0
  wait "$pid" 2>/dev/null || CONNECTED_E2E_REAP_STATUS=$?
}

connected_e2e_signal_name() {
  case "$1" in
    0) printf NONE ;; 129) printf HUP ;; 130) printf INT ;; 131) printf QUIT ;;
    137) printf KILL ;; 139) printf SEGV ;; 141) printf PIPE ;; 143) printf TERM ;;
    *) if [[ "$1" -gt 128 ]]; then printf 'SIGNAL_%s' "$(( $1 - 128 ))"; else printf NONE; fi ;;
  esac
}

connected_e2e_event_lifecycle() {
  local producer_pid=$1 sanitizer_pid=$2 drain_attempts=${3:-20} escalation_attempts=${4:-10}
  local producer_status=0 sanitizer_status=0 timeout=NO signal_name cause stage
  CONNECTED_E2E_EVENT_CAUSE=unknown
  if [[ "$producer_pid" =~ ^[0-9]+$ ]]; then
    if ! connected_e2e_process_terminated "$producer_pid"; then
      kill -TERM "$producer_pid" 2>/dev/null || true
      if ! connected_e2e_wait_bounded "$producer_pid" "$drain_attempts"; then
        kill -KILL "$producer_pid" 2>/dev/null || true
        connected_e2e_wait_bounded "$producer_pid" "$escalation_attempts" || return 1
      fi
    fi
    connected_e2e_reap "$producer_pid"
    producer_status=$CONNECTED_E2E_REAP_STATUS
    signal_name=$(connected_e2e_signal_name "$producer_status")
    cause=owned-stop
    [[ "$producer_status" == 137 ]] && cause=owned-kill
    printf 'EVENT_LIFECYCLE stage=producer-stop pid=%s exit=%s signal=%s cause=%s\n' "$producer_pid" "$producer_status" "$signal_name" "$cause"
  fi

  if [[ "$sanitizer_pid" =~ ^[0-9]+$ ]]; then
    if connected_e2e_wait_bounded "$sanitizer_pid" "$drain_attempts"; then
      stage=graceful-drain
    else
      timeout=YES
      stage=timeout
      printf 'EVENT_LIFECYCLE stage=timeout pid=%s exit=unknown signal=NONE cause=owned-timeout\n' "$sanitizer_pid"
      kill -TERM "$sanitizer_pid" 2>/dev/null || true
      if connected_e2e_wait_bounded "$sanitizer_pid" "$escalation_attempts"; then
        stage=term-escalation
      else
        kill -KILL "$sanitizer_pid" 2>/dev/null || true
        connected_e2e_wait_bounded "$sanitizer_pid" "$escalation_attempts" || return 1
        stage=kill-escalation
      fi
    fi
    connected_e2e_reap "$sanitizer_pid"
    sanitizer_status=$CONNECTED_E2E_REAP_STATUS
    signal_name=$(connected_e2e_signal_name "$sanitizer_status")
    if [[ "$sanitizer_status" == 0 ]]; then
      cause=normal
    elif [[ "$timeout" == YES && "$sanitizer_status" == 143 ]]; then
      cause=owned-timeout-term
    elif [[ "$timeout" == YES && "$sanitizer_status" == 137 ]]; then
      cause=owned-timeout-kill
    elif [[ "$sanitizer_status" == 143 ]]; then
      cause=external-term
    elif [[ "$sanitizer_status" == 137 ]]; then
      cause=external-kill
    else
      cause=sanitizer-error
    fi
    CONNECTED_E2E_EVENT_CAUSE=$cause
    printf 'EVENT_LIFECYCLE stage=%s pid=%s exit=%s signal=%s cause=%s\n' "$stage" "$sanitizer_pid" "$sanitizer_status" "$signal_name" "$cause"
    [[ "$sanitizer_status" == 0 ]]
  fi
}
