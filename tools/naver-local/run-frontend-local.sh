#!/usr/bin/env bash
#
# NAVER walkthrough FRONTEND launcher. Reads the shared run env written by bootstrap.sh and starts Vite in
# walkthrough mode bound to THIS run: it injects the run id into the frontend build (VITE_WALKTHROUGH_RUN_ID)
# and pins the same-origin /api proxy to the bootstrapped backend. It does NOT touch .env.local.
#
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_ENV="$HERE/.run/current.env"
FRONTEND_DIR="$(cd "$HERE/../../frontend" && pwd)"

[ -f "$RUN_ENV" ] || { echo "FAIL-CLOSED: no run env at $RUN_ENV — run tools/naver-local/bootstrap.sh first."; exit 1; }
# shellcheck disable=SC1090
set -a; . "$RUN_ENV"; set +a

# Local Agent (화면 안내) path — OFF by default so the agent is NEVER a requirement. The order connection,
# credential entry, the connection test, the first sync, and the TEXT issuance path all work with the bridge
# disabled; only the guided-agent issuance surface needs it. Opt in with SELLEROPS_WALK_ENABLE_AGENT_BRIDGE=true
# (then launch tools/naver-local/run-agent-local.sh in another terminal). Enabling it only OFFERS the pairing
# UI — a seller can still ignore it and use the text path.
EXTRA_ENV=""
if [ "${SELLEROPS_WALK_ENABLE_AGENT_BRIDGE:-false}" = "true" ]; then
  EXTRA_ENV="VITE_ENABLE_AGENT_BRIDGE=true"
  echo "agent bridge: ENABLED (offers the 화면 안내 pairing UI) — run tools/naver-local/run-agent-local.sh separately"
else
  echo "agent bridge: disabled (default) — guided-agent path inert; text issuance path always available"
fi

echo "starting frontend (walkthrough run=$WALKTHROUGH_RUN_ID, proxy → $WALKTHROUGH_BACKEND_ORIGIN)"
echo "open ONLY: $WALKTHROUGH_FRONTEND_ORIGIN/connect/naver?walkthroughRun=$WALKTHROUGH_RUN_ID"
cd "$FRONTEND_DIR"
# shellcheck disable=SC2086 # EXTRA_ENV is either empty (drops out) or a single VAR=value word — intentional.
exec env \
  VITE_WALKTHROUGH_MODE=true \
  VITE_WALKTHROUGH_RUN_ID="$WALKTHROUGH_RUN_ID" \
  SELLEROPS_BACKEND_ORIGIN="$WALKTHROUGH_BACKEND_ORIGIN" \
  ${EXTRA_ENV} \
  npm run dev
