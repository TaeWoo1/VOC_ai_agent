#!/usr/bin/env bash
#
# Regression self-tests for preflight.sh. Proves the gate FAILS on each way the environment can be wrong
# and PASSES only on a fully correct one — the guarantee that a green /health can no longer be mistaken for
# a working walkthrough. Integration-style: requires the disposable backend (:18090) and frontend
# (http://localhost:5173) to be up, exactly like a real preflight. Runs NO NAVER call and no DB mutation
# (the UI smoke logs into a throwaway browser context and discards it).
#
# Cases:
#   NORMAL         → PREFLIGHT PASS (exit 0), UI smoke ran with NAVER_CALLS=0
#   WRONG_HOST     → FAIL (frontend origin not the approved localhost:5173)
#   STALE_OVERRIDE → FAIL (a dev env file sets an absolute VITE_API_BASE_URL)
#   WRONG_PROXY    → FAIL (dev proxy target != backend origin)
#   BAD_LOGIN      → FAIL: browser_login (UI login fails — bad/absent demo user), even though /health is green
#
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFLIGHT="$HERE/preflight.sh"

# Correct baseline env for the NORMAL case (override per case below).
base_env() {
  echo "SELLEROPS_BACKEND_ORIGIN=http://127.0.0.1:18090"
  echo "SELLEROPS_FRONTEND_ORIGIN=http://localhost:5173"
  echo "SELLEROPS_COLLECT_SCHEDULER_ENABLED=false"
  echo "SELLEROPS_CONNECTOR_NAVER_ENABLED=true"
  echo "SPRING_DATASOURCE_URL=jdbc:postgresql://127.0.0.1:55432/naver_walkthrough"
  echo "PGPORT=55432"
  echo "PGDATABASE=naver_walkthrough"
}

FAILED=0
run_case() {
  local name="$1" expect_exit="$2" expect_marker="$3"; shift 3
  local out rc
  out="$(env $(base_env | tr '\n' ' ') "$@" bash "$PREFLIGHT" 2>&1)"; rc=$?
  local ok="yes"
  if [ "$expect_exit" = "0" ] && [ "$rc" != "0" ]; then ok="no"; fi
  if [ "$expect_exit" = "nonzero" ] && [ "$rc" = "0" ]; then ok="no"; fi
  if [ -n "$expect_marker" ] && ! grep -qF "$expect_marker" <<<"$out"; then ok="no"; fi
  if [ "$ok" = "yes" ]; then
    echo "  PASS  $name (exit=$rc, marker present: '${expect_marker:-—}')"
  else
    echo "  FAIL  $name (exit=$rc, expected=$expect_exit, marker='${expect_marker}')"
    echo "$out" | sed 's/^/        | /' | tail -8
    FAILED=1
  fi
}

echo "preflight self-check (requires backend :18090 + frontend http://localhost:5173 up)"
echo

# NORMAL — full PASS + smoke ran clean.
run_case "NORMAL → PREFLIGHT PASS" 0 "PREFLIGHT PASS"
run_case "NORMAL → UI smoke ran, 0 NAVER calls" 0 "NAVER_CALLS=0"

# WRONG_HOST — 127.0.0.1 is CORS-rejected; the approved origin is localhost:5173.
run_case "WRONG_HOST → FAIL" nonzero "frontend origin must be http://localhost:5173" \
  SELLEROPS_FRONTEND_ORIGIN=http://127.0.0.1:5173

# STALE_OVERRIDE — a dev env file with an absolute VITE_API_BASE_URL.
TMP_FE="$(mktemp -d)"; printf 'VITE_API_BASE_URL=http://127.0.0.1:9999\n' > "$TMP_FE/.env"
run_case "STALE_OVERRIDE → FAIL" nonzero "VITE_API_BASE_URL" \
  SELLEROPS_FRONTEND_DIR="$TMP_FE"
rm -rf "$TMP_FE"

# WRONG_PROXY — unset the proxy origin so the default diverges from the backend origin.
run_case "WRONG_PROXY → FAIL" nonzero "dev proxy target" \
  SELLEROPS_BACKEND_ORIGIN=

# BAD_LOGIN — /health is green but the UI login fails (absent/bad demo user) → browser_login gate.
run_case "BAD_LOGIN → FAIL: browser_login" nonzero "PREFLIGHT FAIL: browser_login" \
  SMOKE_EMAIL=nobody@example.invalid SMOKE_PASSWORD=wrong-not-a-secret

echo
if [ "$FAILED" = "0" ]; then echo "PREFLIGHT SELF-CHECK PASS — the gate fails closed on every wrong environment and passes only when correct."; exit 0
else echo "PREFLIGHT SELF-CHECK FAIL"; exit 1; fi
