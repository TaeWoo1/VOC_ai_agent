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

echo "starting frontend (walkthrough run=$WALKTHROUGH_RUN_ID, proxy → $WALKTHROUGH_BACKEND_ORIGIN)"
echo "open ONLY: $WALKTHROUGH_FRONTEND_ORIGIN/connect/naver?walkthroughRun=$WALKTHROUGH_RUN_ID"
cd "$FRONTEND_DIR"
exec env \
  VITE_WALKTHROUGH_MODE=true \
  VITE_WALKTHROUGH_RUN_ID="$WALKTHROUGH_RUN_ID" \
  SELLEROPS_BACKEND_ORIGIN="$WALKTHROUGH_BACKEND_ORIGIN" \
  npm run dev
