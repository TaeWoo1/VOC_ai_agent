#!/usr/bin/env bash
#
# NAVER guided-connection walkthrough PREFLIGHT. Run this AFTER bootstrap.sh + the backend + frontend, and
# BEFORE opening the browser. Health + proxy alone can NEVER pass — the gate ends in a real clean-context
# browser run that proves the operator's tab is bound to THIS bootstrapped run (URL run id == frontend run
# id == backend /context run id, matching origin, matching git commit), plus that a page load writes NOTHING
# and makes no NAVER call. This closes the gap where a green /health looked like a working walkthrough while
# the operator's tab was actually a stale/different environment.
#
# It reads only local state + logs into the disposable demo account; it enters NO NAVER credential and runs
# NO NAVER call. On the browser gate failing it exits `PREFLIGHT FAIL: browser_login`.
#
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_ENV="$HERE/.run/current.env"
MANIFEST_OUT="${SELLEROPS_MANIFEST_OUT:-${TMPDIR:-/tmp}/naver-runtime-manifest.json}"
SMOKE_EMAIL="${SMOKE_EMAIL:-demo@sellerops.ai}"
SMOKE_PASSWORD="${SMOKE_PASSWORD:-demo1234}"

FAILED=0
BROWSER_LOGIN_FAILED=0
SMOKE_RESULT="not_run"
pass() { echo "  PASS  $*"; }
fail() { echo "  FAIL  $*"; FAILED=1; }
http_status() { curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$@" 2>/dev/null || echo "000"; }

# ---- run identity (required; from bootstrap.sh) -------------------------------
if [ ! -f "$RUN_ENV" ]; then
  echo "PREFLIGHT FAIL — no run env at $RUN_ENV. Run tools/naver-local/bootstrap.sh first."
  exit 1
fi
# shellcheck disable=SC1090
set -a; . "$RUN_ENV"; set +a
RUN_ID="$WALKTHROUGH_RUN_ID"
RUN_GIT="$WALKTHROUGH_GIT_COMMIT"
BACKEND_ORIGIN="${SELLEROPS_BACKEND_ORIGIN:-$WALKTHROUGH_BACKEND_ORIGIN}"
FRONTEND_ORIGIN="${SELLEROPS_FRONTEND_ORIGIN:-$WALKTHROUGH_FRONTEND_ORIGIN}"
DB_ALIAS="$WALKTHROUGH_DB_ALIAS"
FRONTEND_DIR="${SELLEROPS_FRONTEND_DIR:-$(cd "$HERE/../../frontend" && pwd)}"
FRONTEND_ENV_FILES=("$FRONTEND_DIR/.env" "$FRONTEND_DIR/.env.local" "$FRONTEND_DIR/.env.development" "$FRONTEND_DIR/.env.development.local")

PGHOST="${PGHOST:-127.0.0.1}"; PGPORT="${PGPORT:-55432}"; PGDATABASE="${PGDATABASE:-naver_walkthrough}"; PGUSER="${PGUSER:-sellerops}"
export PGHOST PGPORT PGDATABASE PGUSER
[ -n "${PGPASSWORD:-}" ] && export PGPASSWORD
PSQL="$(command -v psql || echo /opt/homebrew/opt/postgresql@15/bin/psql)"
q() { "$PSQL" -tAc "$1" 2>/dev/null | tr -d '[:space:]'; }
naver_accts() { q "select count(*) from seller_accounts sa join channels c on c.id=sa.channel_id where c.code='NAVER'"; }

echo "NAVER walkthrough preflight — run=$RUN_ID git=$RUN_GIT db=$DB_ALIAS@$PGHOST:$PGPORT"
echo "backend=$BACKEND_ORIGIN frontend=$FRONTEND_ORIGIN — read-only checks + a clean-context env-binding browser run"
echo

# 0. Approved frontend origin (must be localhost:5173 — the sole CORS-allowed origin).
[ "$FRONTEND_ORIGIN" = "http://localhost:5173" ] && pass "frontend origin is the approved http://localhost:5173" \
  || fail "frontend origin must be http://localhost:5173 (got $FRONTEND_ORIGIN) — 127.0.0.1 is CORS-rejected"

# 1. Backend health.
[ "$(http_status "$BACKEND_ORIGIN/health")" = "200" ] && pass "backend /health UP" || fail "backend /health not UP at $BACKEND_ORIGIN"

# 2. Frontend /api reachable via proxy.
FE_API_STATUS="$(http_status -X POST -H 'Content-Type: application/json' -d '{}' "$FRONTEND_ORIGIN/api/auth/login")"
[ "$FE_API_STATUS" != "000" ] && pass "frontend /api reachable (HTTP $FE_API_STATUS via proxy)" || fail "frontend /api unreachable at $FRONTEND_ORIGIN"

# 3. Single base URL + proxy target.
STALE_BASE=""
for f in "${FRONTEND_ENV_FILES[@]}"; do
  if [ -f "$f" ] && grep -qE '^[[:space:]]*VITE_API_BASE_URL=[^[:space:]]' "$f"; then
    fail "$f sets an absolute VITE_API_BASE_URL — remove it and use the same-origin /api proxy"; STALE_BASE="1"
  fi
done
[ -z "$STALE_BASE" ] && pass "frontend uses same-origin /api proxy (no absolute VITE_API_BASE_URL)"
# The frontend proxies to the bootstrapped backend (WALKTHROUGH_BACKEND_ORIGIN); it must equal the backend
# we are health-checking. An operator override that diverges (health-check a different backend than the
# frontend actually talks to) FAILs — no silent mid-run divergence.
PROXY_TARGET="$WALKTHROUGH_BACKEND_ORIGIN"
[ "$PROXY_TARGET" = "$BACKEND_ORIGIN" ] && pass "dev proxy target matches backend origin ($BACKEND_ORIGIN)" \
  || fail "dev proxy target ($PROXY_TARGET) != checked backend origin ($BACKEND_ORIGIN)"

# 4-6. Disposable DB / scheduler off / NAVER flag on.
case "${SPRING_DATASOURCE_URL:-jdbc:postgresql://$PGHOST:$PGPORT/$PGDATABASE}" in
  *:5432/*sellerops*) fail "datasource looks like the REAL sellerops DB" ;;
  *) pass "datasource is disposable ($DB_ALIAS@$PGHOST:$PGPORT)" ;;
esac
[ "${SELLEROPS_COLLECT_SCHEDULER_ENABLED:-false}" = "false" ] && pass "collection scheduler OFF" || fail "scheduler must be OFF"
[ "${SELLEROPS_CONNECTOR_NAVER_ENABLED:-false}" = "true" ] && pass "NAVER connector flag ON" || fail "NAVER connector flag must be ON"

# 7. Pristine baseline.
CREDS="$(q 'select count(*) from connector_credentials')"; SYNCS="$(q 'select count(*) from sync_jobs')"
ORDERS="$(q 'select count(*) from channel_orders')"; NAVER_ACCTS="$(naver_accts)"
if [ -z "$CREDS$SYNCS$ORDERS$NAVER_ACCTS" ]; then
  fail "could not query the disposable DB ($PGHOST:$PGPORT/$PGDATABASE)"; CREDS="?"; SYNCS="?"; ORDERS="?"; NAVER_ACCTS="?"
else
  echo "  baseline: credentials=$CREDS sync_jobs=$SYNCS channel_orders=$ORDERS naver_accounts=$NAVER_ACCTS"
  { [ "$CREDS" = 0 ] && [ "$SYNCS" = 0 ] && [ "$ORDERS" = 0 ] && [ "$NAVER_ACCTS" = 0 ]; } \
    && pass "pristine baseline (all zero)" || fail "baseline not pristine — reset the disposable DB"
fi

# 8. Git drift — the working tree must still be the commit this run was bootstrapped at.
CUR_GIT="$(git -C "$HERE" rev-parse --short HEAD 2>/dev/null || echo unknown)"
[ "$CUR_GIT" = "$RUN_GIT" ] && pass "git commit unchanged since bootstrap ($CUR_GIT)" \
  || fail "git commit changed ($RUN_GIT → $CUR_GIT) — re-bootstrap the run"

# 9. Backend /context run-id + git match (login → token → read-only context).
TOKEN="$(curl -s --max-time 8 -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"$SMOKE_EMAIL\",\"password\":\"$SMOKE_PASSWORD\"}" "$FRONTEND_ORIGIN/api/auth/login" \
  | python3 -c "import json,sys;print(json.load(sys.stdin).get('token',''))" 2>/dev/null)"
if [ -z "$TOKEN" ]; then
  fail "could not log in to read /context (demo login failed)"
else
  CTX="$(curl -s --max-time 8 -H "Authorization: Bearer $TOKEN" "$FRONTEND_ORIGIN/api/walkthrough/context" 2>/dev/null)"
  CTX_RUN="$(printf '%s' "$CTX" | python3 -c "import json,sys;print(json.load(sys.stdin).get('walkthroughRunId',''))" 2>/dev/null || echo)"
  CTX_GIT="$(printf '%s' "$CTX" | python3 -c "import json,sys;print(json.load(sys.stdin).get('gitCommit',''))" 2>/dev/null || echo)"
  [ "$CTX_RUN" = "$RUN_ID" ] && pass "backend /context run id matches bootstrap ($RUN_ID)" \
    || fail "backend /context run id ('$CTX_RUN') != bootstrap ('$RUN_ID') — wrong backend / stale run"
  [ "$CTX_GIT" = "$RUN_GIT" ] && pass "backend /context git commit matches bootstrap ($RUN_GIT)" \
    || fail "backend /context git ('$CTX_GIT') != bootstrap ('$RUN_GIT')"
fi

# 10. MANDATORY env-binding browser run — clean context, exact URL, banner run id, gate matched, 0 NAVER calls.
echo "  running env-binding browser smoke (clean context, exact URL)…"
if SELLEROPS_FRONTEND_ORIGIN="$FRONTEND_ORIGIN" SMOKE_RUN_ID="$RUN_ID" SMOKE_EXPECT="matched" \
   SMOKE_EMAIL="$SMOKE_EMAIL" SMOKE_PASSWORD="$SMOKE_PASSWORD" \
   node "$HERE/env-binding-smoke.mjs" 2>&1 | sed 's/^/    /'; then
  SMOKE_RESULT="pass"; pass "env-binding browser run (banner run id + wizard reachable, 0 NAVER calls)"
else
  SMOKE_RESULT="fail"; BROWSER_LOGIN_FAILED=1; fail "env-binding browser run FAILED"
fi

# 11. Page-load wrote NOTHING — the smoke opened /connect/naver; the FULL baseline must be unchanged
# (accounts + credentials + sync jobs + orders). Only meaningful if the step-7 baseline actually queried.
NAVER_ACCTS_AFTER="$(naver_accts)"; CREDS_AFTER="$(q 'select count(*) from connector_credentials')"
SYNCS_AFTER="$(q 'select count(*) from sync_jobs')"; ORDERS_AFTER="$(q 'select count(*) from channel_orders')"
if [ "$NAVER_ACCTS" = "?" ] || [ -z "$NAVER_ACCTS_AFTER" ]; then
  fail "cannot verify page-load 0-write (baseline query unavailable)"
elif [ "$NAVER_ACCTS_AFTER" = "$NAVER_ACCTS" ] && [ "$CREDS_AFTER" = "$CREDS" ] \
     && [ "$SYNCS_AFTER" = "$SYNCS" ] && [ "$ORDERS_AFTER" = "$ORDERS" ]; then
  pass "page load created 0 DB writes (accounts/credentials/sync_jobs/orders all unchanged)"
else
  fail "page load mutated the DB (accts $NAVER_ACCTS→$NAVER_ACCTS_AFTER, creds $CREDS→$CREDS_AFTER, syncs $SYNCS→$SYNCS_AFTER, orders $ORDERS→$ORDERS_AFTER)"
fi

# ---- sanitized runtime manifest ----------------------------------------------
cat > "$MANIFEST_OUT" <<JSON
{
  "walkthroughRunId": "$RUN_ID",
  "gitCommit": "$CUR_GIT",
  "frontendOrigin": "$FRONTEND_ORIGIN",
  "backendOrigin": "$BACKEND_ORIGIN",
  "dbAlias": "$DB_ALIAS@$PGHOST:$PGPORT",
  "scheduler": "${SELLEROPS_COLLECT_SCHEDULER_ENABLED:-false}",
  "naverFlag": "${SELLEROPS_CONNECTOR_NAVER_ENABLED:-false}",
  "baseline": { "credentials": "$CREDS", "syncJobs": "$SYNCS", "channelOrders": "$ORDERS", "naverAccounts": "$NAVER_ACCTS" },
  "envBindingSmoke": "$SMOKE_RESULT"
}
JSON
echo
echo "runtime manifest (sanitized) → $MANIFEST_OUT"; cat "$MANIFEST_OUT" | sed 's/^/  /'

echo
if [ "$FAILED" = "0" ]; then
  echo "PREFLIGHT PASS"
  echo "  operator URL   : $FRONTEND_ORIGIN/connect/naver?walkthroughRun=$RUN_ID"
  echo "  expected run   : ${RUN_ID:0:8}…"
  echo "  expected git   : $CUR_GIT"
  echo "  expected db    : $DB_ALIAS"
  echo "  Open EXACTLY that URL in a fresh window. Live credential entry / test / sync still require a fresh, single-use, in-turn approval."
  exit 0
elif [ "$BROWSER_LOGIN_FAILED" = "1" ]; then
  echo "PREFLIGHT FAIL: browser_login — the env-binding browser run did not pass. Do NOT open the browser."
  exit 1
else
  echo "PREFLIGHT FAIL — do NOT open the browser until every check passes."
  exit 1
fi
