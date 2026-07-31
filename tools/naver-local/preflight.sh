#!/usr/bin/env bash
#
# NAVER guided-connection walkthrough PREFLIGHT. Run this BEFORE opening the browser. It verifies — and
# FAILS CLOSED on — every environment precondition so a walkthrough never starts against a stale port, the
# real database, a running scheduler, or a non-pristine baseline. It performs NO NAVER API call, enters NO
# credential, and runs NO sync; it only reads local state.
#
# Checks (all must PASS):
#   1. Backend health          — GET ${BACKEND_ORIGIN}/health is UP.
#   2. Frontend API reachable  — GET ${FRONTEND_ORIGIN}/api/auth/login answers (proxy forwards to backend).
#   3. Base-URL is single      — the frontend uses the same-origin /api proxy (no absolute VITE_API_BASE_URL
#                                pointing somewhere else), and the dev proxy targets the SAME backend origin.
#                                A backend/frontend origin mismatch FAILS (no mid-run port divergence).
#   4. Disposable DB           — SPRING_DATASOURCE_URL is a throwaway DB, never :5432/sellerops.
#   5. Scheduler OFF           — SELLEROPS_COLLECT_SCHEDULER_ENABLED=false.
#   6. NAVER flag ON           — SELLEROPS_CONNECTOR_NAVER_ENABLED=true.
#   7. Pristine baseline       — connector_credentials, sync_jobs, channel_orders, and NAVER seller
#                                accounts are all 0 (a clean disposable start).
#
set -uo pipefail

BACKEND_ORIGIN="${SELLEROPS_BACKEND_ORIGIN:-http://127.0.0.1:18090}"
FRONTEND_ORIGIN="${SELLEROPS_FRONTEND_ORIGIN:-http://127.0.0.1:5173}"
FRONTEND_ENV_FILE="${SELLEROPS_FRONTEND_ENV_FILE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../frontend" && pwd)/.env.local}"

# DB baseline (must match run-backend-local.sh's disposable target).
PGHOST="${PGHOST:-127.0.0.1}"; PGPORT="${PGPORT:-55432}"; PGDATABASE="${PGDATABASE:-naver_walkthrough}"; PGUSER="${PGUSER:-sellerops}"
export PGHOST PGPORT PGDATABASE PGUSER
[ -n "${PGPASSWORD:-}" ] && export PGPASSWORD
PSQL="$(command -v psql || echo /opt/homebrew/opt/postgresql@15/bin/psql)"

FAILED=0
pass() { echo "  PASS  $*"; }
fail() { echo "  FAIL  $*"; FAILED=1; }

http_status() { curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$@" 2>/dev/null || echo "000"; }

echo "NAVER walkthrough preflight (backend=$BACKEND_ORIGIN frontend=$FRONTEND_ORIGIN db=$PGDATABASE@$PGHOST:$PGPORT)"
echo "no NAVER API call · no credential entry · no sync — read-only checks"
echo

# 1. Backend health.
if [ "$(http_status "$BACKEND_ORIGIN/health")" = "200" ]; then pass "backend /health UP"; else fail "backend /health not UP at $BACKEND_ORIGIN"; fi

# 2. Frontend API reachability through the /api proxy (any HTTP answer = reachable; 000 = not).
FE_API_STATUS="$(http_status -X POST -H 'Content-Type: application/json' -d '{}' "$FRONTEND_ORIGIN/api/auth/login")"
if [ "$FE_API_STATUS" != "000" ]; then pass "frontend /api reachable (HTTP $FE_API_STATUS via proxy)"; else fail "frontend /api unreachable at $FRONTEND_ORIGIN (dev proxy / server down?)"; fi

# 3. Single base URL: no absolute VITE_API_BASE_URL that diverges from the proxy origin.
if [ -f "$FRONTEND_ENV_FILE" ] && grep -qE '^[[:space:]]*VITE_API_BASE_URL=[^[:space:]]' "$FRONTEND_ENV_FILE"; then
  ABS="$(grep -E '^[[:space:]]*VITE_API_BASE_URL=' "$FRONTEND_ENV_FILE" | tail -1 | cut -d= -f2-)"
  fail "frontend $FRONTEND_ENV_FILE sets VITE_API_BASE_URL=$ABS — remove it and use the /api proxy (stale-port risk)"
else
  pass "frontend uses same-origin /api proxy (no absolute VITE_API_BASE_URL)"
fi
# Proxy target must equal the backend origin (no mid-run divergence).
PROXY_TARGET="${SELLEROPS_BACKEND_ORIGIN:-http://127.0.0.1:8080}"
if [ "$PROXY_TARGET" = "$BACKEND_ORIGIN" ]; then pass "dev proxy target matches backend origin ($BACKEND_ORIGIN)"; else fail "dev proxy target ($PROXY_TARGET) != backend origin ($BACKEND_ORIGIN) — export SELLEROPS_BACKEND_ORIGIN=$BACKEND_ORIGIN for the frontend"; fi

# 4. Disposable DB guard.
case "${SPRING_DATASOURCE_URL:-jdbc:postgresql://$PGHOST:$PGPORT/$PGDATABASE}" in
  *:5432/*sellerops*) fail "datasource looks like the REAL sellerops DB" ;;
  *) pass "datasource is disposable ($PGDATABASE@$PGHOST:$PGPORT)" ;;
esac

# 5 + 6. Scheduler off, NAVER flag on.
[ "${SELLEROPS_COLLECT_SCHEDULER_ENABLED:-false}" = "false" ] && pass "collection scheduler OFF" || fail "SELLEROPS_COLLECT_SCHEDULER_ENABLED must be false"
[ "${SELLEROPS_CONNECTOR_NAVER_ENABLED:-false}" = "true" ] && pass "NAVER connector flag ON" || fail "SELLEROPS_CONNECTOR_NAVER_ENABLED must be true"

# 7. Pristine baseline (0 credentials / sync jobs / orders / NAVER accounts).
q() { "$PSQL" -tAc "$1" 2>/dev/null | tr -d '[:space:]'; }
CREDS="$(q 'select count(*) from connector_credentials')"
SYNCS="$(q 'select count(*) from sync_jobs')"
ORDERS="$(q 'select count(*) from channel_orders')"
NAVER_ACCTS="$(q "select count(*) from seller_accounts sa join channels c on c.id=sa.channel_id where c.code='NAVER'")"
if [ -z "$CREDS$SYNCS$ORDERS$NAVER_ACCTS" ]; then
  fail "could not query the disposable DB (is it up at $PGHOST:$PGPORT/$PGDATABASE?)"
else
  echo "  baseline: credentials=$CREDS sync_jobs=$SYNCS channel_orders=$ORDERS naver_accounts=$NAVER_ACCTS"
  [ "$CREDS" = "0" ] && [ "$SYNCS" = "0" ] && [ "$ORDERS" = "0" ] && [ "$NAVER_ACCTS" = "0" ] \
    && pass "pristine baseline (all zero)" \
    || fail "baseline not pristine — reset the disposable DB before a walkthrough"
fi

echo
if [ "$FAILED" = "0" ]; then
  echo "PREFLIGHT PASS — safe to open the browser. Live credential entry / test / sync still require a fresh, single-use, in-turn operator approval."
  exit 0
else
  echo "PREFLIGHT FAIL — do NOT open the browser until every check passes."
  exit 1
fi
