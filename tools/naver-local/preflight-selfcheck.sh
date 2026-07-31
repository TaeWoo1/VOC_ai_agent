#!/usr/bin/env bash
#
# Regression self-tests for the walkthrough preflight + environment binding. Proves the gate fails closed
# on every way the environment can be wrong (including a tab bound to the wrong/absent run) and passes only
# when fully correct. Integration-style: requires bootstrap.sh + the disposable backend (:18090) + the
# walkthrough frontend (http://localhost:5173) to be up. Runs NO NAVER call and no DB mutation.
#
# Cases:
#   NORMAL              → PREFLIGHT PASS (incl. env-binding browser gate), 0 NAVER calls
#   WRONG_HOST          → FAIL (frontend origin not the approved localhost:5173)
#   STALE_OVERRIDE      → FAIL (a dev env file sets an absolute VITE_API_BASE_URL)
#   WRONG_PROXY         → FAIL (health-checked backend != the frontend's bootstrapped proxy target)
#   BAD_LOGIN           → FAIL: browser_login (health green but the UI login fails)
#   ENV_BINDING_WRONG   → env-binding smoke blocks a WRONG url run id (mismatch screen, 0 NAVER calls)
#   ENV_BINDING_MISSING → env-binding smoke blocks a MISSING url run id (mismatch screen, 0 NAVER calls)
#
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFLIGHT="$HERE/preflight.sh"

base_env() {
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
  [ "$expect_exit" = "0" ] && [ "$rc" != "0" ] && ok="no"
  [ "$expect_exit" = "nonzero" ] && [ "$rc" = "0" ] && ok="no"
  [ -n "$expect_marker" ] && ! grep -qF "$expect_marker" <<<"$out" && ok="no"
  if [ "$ok" = "yes" ]; then echo "  PASS  $name (exit=$rc)"; else
    echo "  FAIL  $name (exit=$rc, expected=$expect_exit, marker='$expect_marker')"; echo "$out" | tail -8 | sed 's/^/        | /'; FAILED=1
  fi
}
run_smoke() {
  local name="$1"; shift
  local out rc
  out="$("$@" node "$HERE/env-binding-smoke.mjs" 2>&1)"; rc=$?
  if [ "$rc" = "0" ]; then echo "  PASS  $name"; else echo "  FAIL  $name"; echo "$out" | tail -6 | sed 's/^/        | /'; FAILED=1; fi
}

echo "preflight + env-binding self-check (requires bootstrap + backend :18090 + frontend http://localhost:5173)"
echo

run_case "NORMAL → PREFLIGHT PASS" 0 "PREFLIGHT PASS"
run_case "NORMAL → env-binding ran, 0 NAVER calls" 0 "NAVER_CALLS=0"
run_case "WRONG_HOST → FAIL" nonzero "frontend origin must be http://localhost:5173" \
  SELLEROPS_FRONTEND_ORIGIN=http://127.0.0.1:5173

TMP_FE="$(mktemp -d)"; printf 'VITE_API_BASE_URL=http://127.0.0.1:9999\n' > "$TMP_FE/.env"
run_case "STALE_OVERRIDE → FAIL" nonzero "VITE_API_BASE_URL" SELLEROPS_FRONTEND_DIR="$TMP_FE"
rm -rf "$TMP_FE"

run_case "WRONG_PROXY → FAIL" nonzero "dev proxy target" SELLEROPS_BACKEND_ORIGIN=http://127.0.0.1:9999
run_case "BAD_LOGIN → FAIL: browser_login" nonzero "PREFLIGHT FAIL: browser_login" \
  SMOKE_EMAIL=nobody@example.invalid SMOKE_PASSWORD=wrong-not-a-secret

run_smoke "ENV_BINDING_WRONG → wrong run id blocked (mismatch)" \
  env SELLEROPS_FRONTEND_ORIGIN=http://localhost:5173 SMOKE_RUN_ID=wt-WRONG-run SMOKE_EXPECT=mismatch
run_smoke "ENV_BINDING_MISSING → missing run id blocked (mismatch)" \
  env SELLEROPS_FRONTEND_ORIGIN=http://localhost:5173 SMOKE_RUN_ID= SMOKE_EXPECT=mismatch

echo
if [ "$FAILED" = "0" ]; then echo "PREFLIGHT SELF-CHECK PASS — fails closed on every wrong environment / wrong-run tab, passes only when correct."; exit 0
else echo "PREFLIGHT SELF-CHECK FAIL"; exit 1; fi
