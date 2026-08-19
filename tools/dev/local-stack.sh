#!/usr/bin/env bash
#
# The LOCAL DEVELOPMENT STACK — backend, agent-runtime, frontend — started together and stopped together.
#
# ## Why this exists
#
# `/agent` is a shipped route with a menu entry's worth of product behind it (goal routing, four compiled
# LangGraph state machines, a human checkpoint with real `interrupt`/resume, and now a real model behind the
# draft seam). It talks to `agent-runtime` on 8787. Nothing in the local workflow started that service: it is
# a docker-compose service, and the ordinary loop is `./gradlew bootRun` + `npm run dev` — so the honest
# outcome of opening `/agent` locally was "에이전트 서비스에 연결하지 못했습니다", every time, on a correctly
# built checkout. Three processes that must be up together should be started together.
#
# ## What it does NOT do
#
# It touches no marketplace, holds no credential, and starts no local agent. The SellerOps 도우미 is the
# SELLER's resident process and has its own supervisor (`tools/self-pilot/agent-supervisor.sh start`), which
# is deliberately separate: this script is a developer convenience, and a dev script that could raise a
# browser on someone's seller center is not one.
#
# ## Usage
#
#   tools/dev/local-stack.sh up      # start all three, wait for health, print the URLs
#   tools/dev/local-stack.sh down    # stop everything this script started
#   tools/dev/local-stack.sh status  # what is up
#   tools/dev/local-stack.sh logs    # tail all three logs
#
# Logs and pids live under tools/dev/.run/ (gitignored). Each service keeps whatever env it already reads
# (backend/.env.local, frontend/.env.local, agent-runtime/.env) — this script sets none of them.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
RUN_DIR="$HERE/.run"
mkdir -p "$RUN_DIR"

# **`localhost`, not `127.0.0.1`.** The backend's CORS origin defaults to http://localhost:5173
# (`sellerops.cors.origin`), and a browser that reaches the frontend on 127.0.0.1 fails login with a 403 that
# looks exactly like a broken password. `frontend/vite.config.ts` names this same hazard.
FRONTEND_URL="http://localhost:5173"
BACKEND_URL="http://127.0.0.1:8080"
AGENT_RUNTIME_URL="http://127.0.0.1:8787"

SERVICES=(backend agent-runtime frontend)

pid_file() { echo "$RUN_DIR/$1.pid"; }
log_file() { echo "$RUN_DIR/$1.log"; }

is_running() {
  local pid_path
  pid_path="$(pid_file "$1")"
  [ -f "$pid_path" ] && kill -0 "$(cat "$pid_path")" 2>/dev/null
}

start_one() {
  local name="$1" dir="$2"
  shift 2
  if is_running "$name"; then
    echo "$name: already running (pid $(cat "$(pid_file "$name")"))"
    return 0
  fi
  echo "$name: starting…"
  # `setsid`-less on purpose: these are foreground dev servers whose children must die with them, and the
  # process group is what `down` kills. macOS has no setsid, so the pid we record is the group leader.
  #
  # **`.env.local` is sourced, because otherwise this script silently starts a DIFFERENT deployment.**
  # Spring does not read a dotenv file; the house convention is `set -a; . ./.env.local; set +a` before
  # `bootRun` (docs/demo_runbook_v1.md), and a stack that skipped it would come up with every connector,
  # the self-pilot, the OAuth providers and the AI capabilities off — looking healthy while being a
  # deployment nobody configured. Absent is fine and silent: a checkout without one is the default posture.
  # The file is gitignored and never printed; only the fact that it was loaded is.
  (
    cd "$REPO_ROOT/$dir"
    if [ -f .env.local ]; then
      set -a
      # shellcheck disable=SC1091
      . ./.env.local
      set +a
    fi
    exec "$@"
  ) >"$(log_file "$name")" 2>&1 &
  echo $! > "$(pid_file "$name")"
  [ -f "$REPO_ROOT/$dir/.env.local" ] && echo "$name: loaded $dir/.env.local"
  return 0
}

wait_for() {
  local name="$1" url="$2" tries="${3:-90}"
  local i=0
  while [ "$i" -lt "$tries" ]; do
    if curl -fsS -o /dev/null --max-time 2 "$url" 2>/dev/null; then
      echo "$name: healthy"
      return 0
    fi
    # A dead process is reported as dead rather than waited out: the log has the reason, and ninety seconds
    # of silence for a service that exited on line one is the worst possible feedback.
    if ! is_running "$name"; then
      echo "$name: FAILED to start — see $(log_file "$name")" >&2
      return 1
    fi
    i=$((i + 1))
    sleep 1
  done
  echo "$name: did not become healthy in ${tries}s — see $(log_file "$name")" >&2
  return 1
}

cmd_up() {
  start_one backend backend ./gradlew bootRun
  # The runtime FAILS CLOSED at boot under APP_ENV=production on a file/memory store, and its spring store
  # needs the backend up — so it waits for backend health rather than racing it.
  wait_for backend "$BACKEND_URL/health" 180
  start_one agent-runtime agent-runtime npm run serve
  wait_for agent-runtime "$AGENT_RUNTIME_URL/health" 60 || true
  start_one frontend frontend npm run dev
  wait_for frontend "$FRONTEND_URL" 60
  echo
  echo "  SellerOps        $FRONTEND_URL     ← open this one (NOT 127.0.0.1 — see the note above)"
  echo "  backend          $BACKEND_URL"
  echo "  agent runtime    $AGENT_RUNTIME_URL   (/agent)"
  echo
  echo "  seller helper    tools/self-pilot/agent-supervisor.sh start   (separate, and the seller's own)"
}

cmd_down() {
  for name in "${SERVICES[@]}"; do
    local pid_path
    pid_path="$(pid_file "$name")"
    if is_running "$name"; then
      local pid
      pid="$(cat "$pid_path")"
      echo "$name: stopping (pid $pid)"
      # The whole group: `gradlew bootRun` and `vite` both fork, and killing only the launcher leaves a
      # server holding the port — which then looks like "the port is busy" on the next `up`.
      kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    fi
    rm -f "$pid_path"
  done
}

cmd_status() {
  for name in "${SERVICES[@]}"; do
    if is_running "$name"; then
      echo "$name: running (pid $(cat "$(pid_file "$name")"))"
    else
      echo "$name: not running"
    fi
  done
}

cmd_logs() {
  local files=()
  for name in "${SERVICES[@]}"; do
    [ -f "$(log_file "$name")" ] && files+=("$(log_file "$name")")
  done
  [ "${#files[@]}" -gt 0 ] || { echo "no logs yet"; return 0; }
  tail -n 40 -f "${files[@]}"
}

case "${1:-up}" in
  up) cmd_up ;;
  down) cmd_down ;;
  status) cmd_status ;;
  logs) cmd_logs ;;
  *) echo "usage: $0 <up|down|status|logs>" >&2; exit 2 ;;
esac
