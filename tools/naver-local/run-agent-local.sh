#!/usr/bin/env bash
#
# NAVER walkthrough LOCAL AGENT launcher — the 화면 안내 (guided) path ONLY.
#
# Brings up the Local Agent's API-issuance GUIDANCE carrier (`--dev-action-window-issuance`) on the loopback
# bridge that the frontend's bridge client connects to (127.0.0.1:47615), with THIS run's frontend origin on
# the bridge's allow-list. That carrier is a FIXTURE driver: it opens NO browser, makes NO NAVER call, and
# reads NO credential — so this is safe to run without a live-marketplace approval. Use it to VALIDATE the
# guided-agent bridge configuration (port · origin allow-list · approval presenter · carrier=apiIssuance) in
# the same disposable environment as the backend + frontend.
#
# ── Browser-free boot is TRANSIENT (a collector design fact, not a bug) ──────────────────────────────────
# The collector keeps the bridge RESIDENT only while at least one browser connection is held for a
# WAITING/HUMAN handoff (local-agent.ts §"managedConnectionIds().length === 0" → clean exit). A browser-free
# connections set has nothing to hold, so the agent boots the bridge, reports the carrier, and exits. That is
# enough to prove the bridge listens and is configured correctly, but it will NOT stay up for pairing. Holding
# a pair-able guided session requires a resident connection, i.e. the collector's APPROVED live issuance path
# (which opens a marketplace browser) — intentionally outside this local, NAVER-free tool. Do not add a
# browser connection here to force persistence; that would be a live run needing its own approval.
#
# ── "Same run" is the same ENVIRONMENT, not a shared id ──────────────────────────────────────────────────
# The agent mints its OWN opaque carrier id (`run_<hex>`) and ANNOUNCES it per connection; the frontend adopts
# it. There is no way — by env or flag — to bind the agent to the walkthrough run id (`wt-<hex>`), and no
# agent↔walkthrough run linkage exists anywhere today. So this launcher binds the agent to the same loopback
# bridge + the same frontend origin as this run; it never guesses or injects a run id. (Confirmed against
# collector/src/cli/local-agent.ts.)
#
# The Local Agent is OPTIONAL: run-frontend-local.sh keeps VITE_ENABLE_AGENT_BRIDGE off by default, and the
# text issuance path works without this. Launch this only to exercise the guided-agent surface.
#
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_ENV="$HERE/.run/current.env"
COLLECTOR_DIR="$(cd "$HERE/../../collector" && pwd)"

[ -f "$RUN_ENV" ] || { echo "FAIL-CLOSED: no run env at $RUN_ENV — run tools/naver-local/bootstrap.sh first."; exit 1; }
# shellcheck disable=SC1090
set -a; . "$RUN_ENV"; set +a

# HARD FENCE. This launcher hosts ONLY the browser-free issuance guidance carrier. Refuse any flag that would
# open a real NAVER browser or a different live carrier — a live marketplace run needs its own approved path,
# never this local tool. Fail closed on the first offending argument.
for arg in "$@"; do
  case "$arg" in
    --i-understand-this-opens-live-naver|--i-understand-this-launches-local-agent-chrome|\
    --action-window-initial-review-import|--dev-action-window-reply|--dev-action-window-ingest-local)
      echo "REFUSED: run-agent-local.sh hosts only the browser-free issuance guidance carrier — '$arg' is not allowed here." >&2
      exit 1 ;;
  esac
done

CONNECTIONS="${AGENT_CONNECTIONS:-$HERE/agent-connections.example.json}"
[ -f "$CONNECTIONS" ] || { echo "FAIL-CLOSED: no connections file at $CONNECTIONS (set AGENT_CONNECTIONS or keep the example)."; exit 1; }

BRIDGE_PORT="${BRIDGE_PORT:-47615}"
FE_ORIGIN="${WALKTHROUGH_FRONTEND_ORIGIN:-http://localhost:5173}"
# Allow BOTH host spellings of the frontend origin so the :5173 localhost/127.0.0.1 gotcha never rejects the
# socket. Derived purely from this run's origin — no external input.
PORT_SUFFIX="${FE_ORIGIN##*:}"
ORIGINS="http://localhost:${PORT_SUFFIX} http://127.0.0.1:${PORT_SUFFIX}"

# Pairing confirmation: default to the real dev handshake (the agent prints a code to ITS terminal; the
# operator matches it in the frontend and clicks 허용). Set AGENT_AUTO_APPROVE=true only for an unattended
# smoke/verify — it bypasses that confirmation and is honored solely because NODE_ENV is non-production.
APPROVE_FLAG=()
if [ "${AGENT_AUTO_APPROVE:-false}" = "true" ]; then
  APPROVE_FLAG=(--dev-insecure-auto-approve)
  echo "pairing: AUTO-APPROVE (unattended) — the pairing confirmation handshake is BYPASSED"
else
  echo "pairing: interactive — confirm the code shown in THIS terminal inside the frontend, then click 허용"
fi

echo "starting Local Agent — issuance GUIDANCE carrier (browser-free, NAVER-free) on bridge :$BRIDGE_PORT"
echo "  frontend origin allow-list : $ORIGINS"
echo "  connections (browser-free) : $CONNECTIONS"
echo "  walkthrough run (env)      : $WALKTHROUGH_RUN_ID  (NOTE: the agent announces its OWN run_<hex>; not this id)"
echo "  NOTE: a browser-free boot is TRANSIENT — the bridge listens, reports the carrier, then exits (nothing"
echo "        resident to hold it). It validates configuration; it does NOT stay up for pairing. A persistent"
echo "        pair-able session needs the collector's approved live issuance path (opens a marketplace browser)."
cd "$COLLECTOR_DIR"
exec env \
  NODE_ENV=development \
  BRIDGE_PORT="$BRIDGE_PORT" \
  BRIDGE_ALLOWED_ORIGINS="$ORIGINS" \
  npm run local-agent -- --connections "$CONNECTIONS" --dev-action-window-issuance ${APPROVE_FLAG[@]+"${APPROVE_FLAG[@]}"}
