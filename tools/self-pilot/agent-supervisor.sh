#!/usr/bin/env bash
#
# Self-Pilot Runtime v1 — persistent LOCAL AGENT supervisor (docs/self_pilot_runtime_v1.md §4).
#
# Keeps ONE routine READ carrier of the collector resident for days: restarts it on a crash (exit 9 from
# the agent's own crash handlers, or any other non-zero exit), backs off on a crash loop, logs one sanitized
# line per lifecycle event, and lets the operator SWITCH the hosted carrier without remembering flags —
# because the agent hosts exactly one carrier and every carrier binds the same bridge port (47615), the
# honest form of "multi-carrier routing" today is process-level: stop the resident carrier, start the one
# you need, come back. Nothing here opens a marketplace WRITE path; the reply-submission carrier is not a
# selectable carrier of this script on purpose.
#
# What it does NOT do (by design, see the ADR): it does not log in to a marketplace for you (the seller
# logs into the agent's Chrome themselves), it does not auto-approve pairing (the first pairing happens in
# the foreground so the code is on YOUR terminal; pairings persist in collector/.bridge/ across restarts),
# and it does not run under NODE_ENV=production (the import gate refuses production — the seated import
# carrier is a development-posture agent by contract).
#
# Usage:
#   agent-supervisor.sh start [naver-import|coupang-locate] [-d]   # default carrier: naver-import
#   agent-supervisor.sh stop
#   agent-supervisor.sh status
#   agent-supervisor.sh switch <naver-import|coupang-locate>        # stop + start, same env
#   agent-supervisor.sh logs                                         # tail the supervisor log
#
# Env: read from tools/self-pilot/.run/self-pilot.env (gitignored; NAMES in README.md — never printed here).
#      Required for every carrier: SELLEROPS_BASE_URL SELLEROPS_EMAIL SELLEROPS_PASSWORD (the self-pilot org).
#      naver-import: NAVER_REVIEW_URL.   coupang-locate: COUPANG_WING_URL (the walk ids are minted per start).
#
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
COLLECTOR_DIR="$REPO_ROOT/collector"
RUN_DIR="$HERE/.run"
ENV_FILE="$RUN_DIR/self-pilot.env"
STATUS_DIR="$COLLECTOR_DIR/.status"
PID_FILE="$STATUS_DIR/self-pilot-supervisor.pid"
CARRIER_FILE="$STATUS_DIR/self-pilot-carrier"
LOG_FILE="$STATUS_DIR/self-pilot-supervisor.log"
BRIDGE_PORT="${BRIDGE_PORT:-47615}"

mkdir -p "$RUN_DIR" "$STATUS_DIR"
chmod 700 "$RUN_DIR" "$STATUS_DIR" 2>/dev/null || true

log() { # one sanitized line: ts level event k=v… — no URL, no credential, no page content
  printf '%s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "${*:2}" | tee -a "$LOG_FILE" >&2
}

require_env_file() {
  [ -f "$ENV_FILE" ] || {
    echo "FAIL-CLOSED: no env at $ENV_FILE — copy tools/self-pilot/self-pilot.env.example there and fill it (values are yours; never commit)." >&2
    exit 2
  }
  # shellcheck disable=SC1090
  set -a; . "$ENV_FILE"; set +a
  for name in SELLEROPS_BASE_URL SELLEROPS_EMAIL SELLEROPS_PASSWORD; do
    [ -n "${!name:-}" ] || { echo "FAIL-CLOSED: $name is not set in $ENV_FILE." >&2; exit 2; }
  done
  case "$SELLEROPS_EMAIL" in
    demo@sellerops.ai) echo "REFUSED: SELLEROPS_EMAIL is the demo org — the self-pilot agent must run as the self-pilot org (runbook trap 6)." >&2; exit 2 ;;
  esac
}

# The carrier → exact command. Adding a carrier here is the ONLY place a new routine command lives.
carrier_command() {
  case "$1" in
    naver-import)
      [ -n "${NAVER_REVIEW_URL:-}" ] || { echo "FAIL-CLOSED: NAVER_REVIEW_URL is not set (naver-import carrier)." >&2; exit 2; }
      CMD=(npm run local-agent -- --action-window-initial-review-import --i-understand-this-opens-live-naver)
      ;;
    coupang-locate)
      [ -n "${COUPANG_WING_URL:-}" ] || { echo "FAIL-CLOSED: COUPANG_WING_URL is not set (coupang-locate carrier)." >&2; exit 2; }
      # READ_ONLY locate walk. The three walk ids are ENVIRONMENT-binding tokens (never credentials): the
      # standing self-pilot posture mints them per start so the operator does not run a bootstrap by hand.
      # The human press stays: the CLI still opens its in-browser grant tab and the seller presses it there.
      export SELLEROPS_APPROVAL_PHASE=COUPANG_WING_REVIEW_LOCATE
      export SELLEROPS_WING_APPROVED_PHASE=COUPANG_WING_REVIEW_LOCATE
      export WALKTHROUGH_RUN_ID="${WALKTHROUGH_RUN_ID:-sp-$(openssl rand -hex 6)}"
      export WALKTHROUGH_APPROVAL_ID="${WALKTHROUGH_APPROVAL_ID:-apr-$(openssl rand -hex 6)}"
      export WALKTHROUGH_GIT_COMMIT="${WALKTHROUGH_GIT_COMMIT:-$(git -C "$REPO_ROOT" rev-parse HEAD)}"
      CMD=(npx tsx src/cli/run-coupang-review-locate-live.ts -- --i-understand-this-opens-live-coupang-wing)
      ;;
    *)
      echo "unknown carrier '$1' — use naver-import or coupang-locate" >&2; exit 2 ;;
  esac
}

is_running() { [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; }

bridge_pid() { lsof -nP -iTCP:"$BRIDGE_PORT" -sTCP:LISTEN -t 2>/dev/null | head -1 || true; }

do_stop() {
  local stopped=0
  if is_running; then
    local sup; sup="$(cat "$PID_FILE")"
    log info supervisor_stop pid="$sup"
    kill -TERM "$sup" 2>/dev/null || true
    stopped=1
  fi
  local bp; bp="$(bridge_pid)"
  if [ -n "$bp" ]; then
    kill -TERM "$bp" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$bp" 2>/dev/null || break; sleep 1; done
    kill -0 "$bp" 2>/dev/null && kill -KILL "$bp" 2>/dev/null || true
    stopped=1
  fi
  rm -f "$PID_FILE"
  [ "$stopped" = 1 ] && log info agent_stopped || echo "nothing was running"
}

# The resident loop. Restart on any non-zero exit with bounded backoff; a clean exit (0) ends the loop —
# the agent chose to stop, so restarting it would fight a deliberate shutdown.
supervise() {
  local carrier="$1"; carrier_command "$carrier"
  echo "$carrier" > "$CARRIER_FILE"
  echo $$ > "$PID_FILE"
  local backoff=5 crashes=0 window_start; window_start=$(date +%s)
  trap 'log info supervisor_signal; bp="$(bridge_pid)"; [ -n "$bp" ] && kill -TERM "$bp" 2>/dev/null; rm -f "$PID_FILE"; exit 0' INT TERM
  log info supervisor_start carrier="$carrier" bridge_port="$BRIDGE_PORT"
  while true; do
    if [ -n "$(bridge_pid)" ]; then
      log error bridge_port_held port="$BRIDGE_PORT" hint="another agent owns the port; run: agent-supervisor.sh stop"
      exit 3
    fi
    log info agent_launch carrier="$carrier"
    set +e
    ( cd "$COLLECTOR_DIR" && NODE_ENV=development BRIDGE_PORT="$BRIDGE_PORT" "${CMD[@]}" )
    local code=$?
    set -e
    if [ "$code" -eq 0 ]; then log info agent_exit_clean carrier="$carrier"; rm -f "$PID_FILE"; exit 0; fi
    log warn agent_exit code="$code" carrier="$carrier"
    # Boot refusals (2..8) are configuration, not crashes: retrying them in a loop only spams the log.
    if [ "$code" -ge 2 ] && [ "$code" -le 8 ]; then
      log error agent_refused code="$code" hint="fix the configuration and start again"; rm -f "$PID_FILE"; exit "$code"
    fi
    local now; now=$(date +%s)
    if [ $((now - window_start)) -gt 120 ]; then crashes=0; window_start=$now; backoff=5; fi
    crashes=$((crashes + 1))
    if [ "$crashes" -ge 5 ]; then log warn crash_loop pause_s=60; sleep 60; crashes=0; window_start=$(date +%s); backoff=5; continue; fi
    log info agent_restart_in seconds="$backoff"
    sleep "$backoff"; backoff=$(( backoff * 2 > 60 ? 60 : backoff * 2 ))
  done
}

case "${1:-}" in
  start)
    require_env_file
    carrier="${2:-naver-import}"; detach=0
    for a in "${@:2}"; do [ "$a" = "-d" ] && detach=1; done
    [ "$carrier" = "-d" ] && carrier=naver-import
    if is_running; then echo "already running (pid $(cat "$PID_FILE"), carrier $(cat "$CARRIER_FILE" 2>/dev/null))"; exit 0; fi
    if [ "$detach" = 1 ]; then
      if [ ! -s "$COLLECTOR_DIR/.bridge/pairings.json" ]; then
        echo "REFUSED: no pairing on disk yet — run the first start in the FOREGROUND so the pairing code reaches your terminal; -d is for later restarts." >&2
        exit 2
      fi
      nohup "$0" start "$carrier" >>"$LOG_FILE" 2>&1 &
      echo "started in background (carrier $carrier); logs: $LOG_FILE"
    else
      supervise "$carrier"
    fi
    ;;
  stop) do_stop ;;
  switch)
    [ -n "${2:-}" ] || { echo "usage: $0 switch <naver-import|coupang-locate>" >&2; exit 2; }
    do_stop; exec "$0" start "$2"
    ;;
  status)
    if is_running; then echo "supervisor: running (pid $(cat "$PID_FILE"), carrier $(cat "$CARRIER_FILE" 2>/dev/null))"; else echo "supervisor: not running"; fi
    bp="$(bridge_pid)"; [ -n "$bp" ] && echo "bridge :$BRIDGE_PORT held by pid $bp" || echo "bridge :$BRIDGE_PORT free"
    curl -fsS "http://127.0.0.1:$BRIDGE_PORT/bridge/health" 2>/dev/null && echo || echo "bridge health: unreachable"
    ;;
  logs) tail -n 50 -f "$LOG_FILE" ;;
  *) sed -n 2,28p "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
