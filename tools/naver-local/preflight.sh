#!/usr/bin/env bash
#
# NAVER guided-connection walkthrough PREFLIGHT. Run this BEFORE opening the browser. It verifies — and
# FAILS CLOSED on — every environment precondition so a walkthrough never starts against a stale port, the
# real database, a running scheduler, a non-pristine baseline, or a login that only LOOKS reachable.
#
# It reads only local state and performs NO NAVER API call, enters NO credential, and runs NO sync. The
# final, MANDATORY gate is a real browser UI login on the one approved origin — health + proxy alone are
# NOT enough to declare PASS (that gap once made the operator the product-path integration test: the
# backend answered /health while the browser login failed on a cross-origin CORS 403).
#
# Single-run contract (enforced below): frontend origin = http://localhost:5173 (the ONLY CORS-allowed
# origin), backend origin = http://127.0.0.1:18090, same-origin /api Vite proxy only, VITE_API_BASE_URL
# forbidden in every dev env file, fixed ports for the whole run.
#
# Checks (all must PASS; browser login is the final gate):
#   0. Frontend origin is the approved http://localhost:5173 (never 127.0.0.1 — the backend CORS rejects it).
#   1. Backend /health UP.
#   2. Frontend /api reachable via the proxy.
#   3. Single base URL: no absolute VITE_API_BASE_URL in any dev env file; proxy target == backend origin.
#   4. Disposable DB (never :5432/sellerops).
#   5. Collection scheduler OFF.
#   6. NAVER connector flag ON.
#   7. Pristine baseline (credentials / sync_jobs / channel_orders / NAVER accounts all 0).
#   8. BROWSER UI LOGIN SMOKE (mandatory) — clean-context UI login → authenticated shell → NAVER 연결하기,
#      with 0 NAVER API calls. On failure the script exits `PREFLIGHT FAIL: browser_login`.
#
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_ORIGIN="${SELLEROPS_BACKEND_ORIGIN:-http://127.0.0.1:18090}"
# The ONE approved frontend origin. It must be localhost (the backend's sole CORS-allowed origin); mixing
# 127.0.0.1 is the exact host split behind the repeated login failure.
FRONTEND_ORIGIN="${SELLEROPS_FRONTEND_ORIGIN:-http://localhost:5173}"
FRONTEND_DIR="${SELLEROPS_FRONTEND_DIR:-$(cd "$HERE/../../frontend" && pwd)}"
FRONTEND_ENV_FILES=("$FRONTEND_DIR/.env" "$FRONTEND_DIR/.env.local" "$FRONTEND_DIR/.env.development" "$FRONTEND_DIR/.env.development.local")
MANIFEST_OUT="${SELLEROPS_MANIFEST_OUT:-${TMPDIR:-/tmp}/naver-runtime-manifest.json}"

PGHOST="${PGHOST:-127.0.0.1}"; PGPORT="${PGPORT:-55432}"; PGDATABASE="${PGDATABASE:-naver_walkthrough}"; PGUSER="${PGUSER:-sellerops}"
export PGHOST PGPORT PGDATABASE PGUSER
[ -n "${PGPASSWORD:-}" ] && export PGPASSWORD
PSQL="$(command -v psql || echo /opt/homebrew/opt/postgresql@15/bin/psql)"

FAILED=0
BROWSER_LOGIN_FAILED=0
SMOKE_RESULT="not_run"
pass() { echo "  PASS  $*"; }
fail() { echo "  FAIL  $*"; FAILED=1; }
http_status() { curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$@" 2>/dev/null || echo "000"; }

echo "NAVER walkthrough preflight (backend=$BACKEND_ORIGIN frontend=$FRONTEND_ORIGIN db=$PGDATABASE@$PGHOST:$PGPORT)"
echo "no NAVER API call · no credential entry · no sync — read-only checks + a clean-context UI login"
echo

# 0. Approved frontend origin (must be localhost:5173 — the sole CORS-allowed origin).
if [ "$FRONTEND_ORIGIN" = "http://localhost:5173" ]; then
  pass "frontend origin is the approved http://localhost:5173"
else
  fail "frontend origin must be http://localhost:5173 (got $FRONTEND_ORIGIN) — 127.0.0.1 is CORS-rejected"
fi

# 1. Backend health.
if [ "$(http_status "$BACKEND_ORIGIN/health")" = "200" ]; then pass "backend /health UP"; else fail "backend /health not UP at $BACKEND_ORIGIN"; fi

# 2. Frontend API reachability through the /api proxy (any HTTP answer = reachable; 000 = not).
FE_API_STATUS="$(http_status -X POST -H 'Content-Type: application/json' -d '{}' "$FRONTEND_ORIGIN/api/auth/login")"
if [ "$FE_API_STATUS" != "000" ]; then pass "frontend /api reachable (HTTP $FE_API_STATUS via proxy)"; else fail "frontend /api unreachable at $FRONTEND_ORIGIN (dev proxy / server down?)"; fi

# 3. Single base URL: NO dev env file sets an absolute VITE_API_BASE_URL (would bypass the /api proxy).
STALE_BASE=""
for f in "${FRONTEND_ENV_FILES[@]}"; do
  if [ -f "$f" ] && grep -qE '^[[:space:]]*VITE_API_BASE_URL=[^[:space:]]' "$f"; then
    ABS="$(grep -E '^[[:space:]]*VITE_API_BASE_URL=' "$f" | tail -1 | cut -d= -f2-)"
    fail "$f sets VITE_API_BASE_URL=$ABS — remove it and use the same-origin /api proxy (stale-port risk)"
    STALE_BASE="1"
  fi
done
[ -z "$STALE_BASE" ] && pass "frontend uses same-origin /api proxy (no absolute VITE_API_BASE_URL in any dev env file)"
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
  CREDS="?"; SYNCS="?"; ORDERS="?"; NAVER_ACCTS="?"
else
  echo "  baseline: credentials=$CREDS sync_jobs=$SYNCS channel_orders=$ORDERS naver_accounts=$NAVER_ACCTS"
  [ "$CREDS" = "0" ] && [ "$SYNCS" = "0" ] && [ "$ORDERS" = "0" ] && [ "$NAVER_ACCTS" = "0" ] \
    && pass "pristine baseline (all zero)" \
    || fail "baseline not pristine — reset the disposable DB before a walkthrough"
fi

# 8. MANDATORY browser UI login smoke — the real product path (health + proxy are NOT sufficient).
# Skips only the earlier checks that already failed hard; the smoke itself always runs unless disabled.
if [ "${SELLEROPS_SKIP_UI_SMOKE:-0}" = "1" ]; then
  fail "UI login smoke is MANDATORY and cannot be skipped for a walkthrough (SELLEROPS_SKIP_UI_SMOKE ignored)"
fi
echo "  running browser UI login smoke (clean context)…"
if SELLEROPS_FRONTEND_ORIGIN="$FRONTEND_ORIGIN" node "$HERE/ui-login-smoke.mjs" 2>&1 | sed 's/^/    /'; then
  SMOKE_RESULT="pass"; pass "browser UI login smoke (login → authenticated shell → NAVER 연결하기, 0 NAVER calls)"
else
  SMOKE_RESULT="fail"; BROWSER_LOGIN_FAILED=1; fail "browser UI login smoke FAILED — the real login path does not work"
fi

# Sanitized runtime manifest (no secret / token / credential / NAVER value).
GIT_COMMIT="$(git -C "$HERE" rev-parse --short HEAD 2>/dev/null || echo unknown)"
cat > "$MANIFEST_OUT" <<JSON
{
  "git_commit": "$GIT_COMMIT",
  "frontend_origin": "$FRONTEND_ORIGIN",
  "backend_origin": "$BACKEND_ORIGIN",
  "disposable_db": "$PGDATABASE@$PGHOST:$PGPORT",
  "scheduler": "${SELLEROPS_COLLECT_SCHEDULER_ENABLED:-false}",
  "naver_flag": "${SELLEROPS_CONNECTOR_NAVER_ENABLED:-false}",
  "baseline": { "credentials": "$CREDS", "sync_jobs": "$SYNCS", "channel_orders": "$ORDERS", "naver_accounts": "$NAVER_ACCTS" },
  "browser_login_smoke": "$SMOKE_RESULT"
}
JSON
echo
echo "runtime manifest (sanitized) → $MANIFEST_OUT"
cat "$MANIFEST_OUT" | sed 's/^/  /'

echo
if [ "$FAILED" = "0" ]; then
  echo "PREFLIGHT PASS — safe to open the browser at $FRONTEND_ORIGIN. Live credential entry / test / sync still require a fresh, single-use, in-turn operator approval."
  exit 0
elif [ "$BROWSER_LOGIN_FAILED" = "1" ]; then
  echo "PREFLIGHT FAIL: browser_login — the UI login smoke did not pass. Do NOT open the browser or declare readiness."
  exit 1
else
  echo "PREFLIGHT FAIL — do NOT open the browser until every check passes."
  exit 1
fi
