#!/usr/bin/env bash
#
# NAVER local backend bootstrap for the guided-connection walkthrough. Boots a DISPOSABLE backend on a
# FIXED port, with the NAVER connector enabled and the collection scheduler OFF, loading the vault master
# key from the macOS Keychain (never from the repo). NAVER uses callback-less client credentials entered by
# the operator IN THE UI, so — unlike Cafe24 — there is NO OAuth redirect and NO client id/secret env here.
#
# This script performs NO NAVER API call, NO connection test, NO sync, and NO credential write. It only
# prepares the environment and boots the backend fail-closed. Every live step (credential entry, test,
# sync) is a separate, operator-approved action in the browser.
#
# The backend PORT is fixed here and MUST NOT be changed mid-run (the frontend dev proxy is pinned to the
# same origin via SELLEROPS_BACKEND_ORIGIN; see preflight.sh). Point the disposable DB at a throwaway
# database — NEVER the real sellerops instance.
#
# Keychain item this script reads (create it yourself; see .env.example):
#   service=sellerops-vault-master-key  account=<key-id, default naver-walk-1>  -> base64 32-byte AES-256 key
#
set -euo pipefail

# ---- fixed disposable-proof configuration (do NOT point at real sellerops) ----
export SERVER_PORT="${SELLEROPS_NAVER_BACKEND_PORT:-18090}"
export SPRING_DATASOURCE_URL="${SPRING_DATASOURCE_URL:-jdbc:postgresql://127.0.0.1:55432/naver_walkthrough}"
export SPRING_DATASOURCE_USERNAME="${SPRING_DATASOURCE_USERNAME:-sellerops}"
export SELLEROPS_VAULT_KEY_ID="${SELLEROPS_VAULT_KEY_ID:-naver-walk-1}"
export SELLEROPS_CONNECTOR_NAVER_ENABLED="true"
export SELLEROPS_COLLECT_SCHEDULER_ENABLED="false"
export SELLEROPS_SEED_ENABLED="${SELLEROPS_SEED_ENABLED:-true}"

KC_MASTER_SERVICE="${SELLEROPS_KC_MASTER_SERVICE:-sellerops-vault-master-key}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$HERE/../../backend" && pwd)"
RUN_ENV="$HERE/.run/current.env"

die() { echo "FAIL-CLOSED: $*" >&2; exit 1; }
kc() { security find-generic-password -s "$1" -a "$2" -w 2>/dev/null || true; }

# ---- walkthrough environment identity (from bootstrap.sh; required) -----------
[ -f "$RUN_ENV" ] || die "no run env at $RUN_ENV — run tools/naver-local/bootstrap.sh first."
# shellcheck disable=SC1090
set -a; . "$RUN_ENV"; set +a
export SELLEROPS_WALKTHROUGH_MODE="true"
export SELLEROPS_WALKTHROUGH_RUN_ID="$WALKTHROUGH_RUN_ID"
export SELLEROPS_WALKTHROUGH_GIT_COMMIT="$WALKTHROUGH_GIT_COMMIT"
export SELLEROPS_WALKTHROUGH_DB_ALIAS="$WALKTHROUGH_DB_ALIAS"
export SELLEROPS_WALKTHROUGH_FRONTEND_ORIGIN="$WALKTHROUGH_FRONTEND_ORIGIN"
export SELLEROPS_WALKTHROUGH_BACKEND_ORIGIN="$WALKTHROUGH_BACKEND_ORIGIN"

# ---- refuse to boot against the real sellerops DB -----------------------------
case "$SPRING_DATASOURCE_URL" in
  *:5432/*sellerops*) die "SPRING_DATASOURCE_URL looks like the REAL sellerops DB. Use a disposable database." ;;
esac

# ---- load master key from Keychain (fail closed if absent) --------------------
SELLEROPS_VAULT_MASTER_KEY="$(kc "$KC_MASTER_SERVICE" "$SELLEROPS_VAULT_KEY_ID")"
[ -n "$SELLEROPS_VAULT_MASTER_KEY" ] || die "vault master key not in Keychain (service=$KC_MASTER_SERVICE account=$SELLEROPS_VAULT_KEY_ID)."
export SELLEROPS_VAULT_MASTER_KEY

export SPRING_DATASOURCE_PASSWORD="${SPRING_DATASOURCE_PASSWORD:-}"

# ---- boot (still no live NAVER call until an operator-approved step) ----------
echo "starting NAVER-walkthrough backend on :${SERVER_PORT} (JDBC=$SPRING_DATASOURCE_URL, naver.enabled=true, scheduler=$SELLEROPS_COLLECT_SCHEDULER_ENABLED, key-id=$SELLEROPS_VAULT_KEY_ID, walkthroughRun=$SELLEROPS_WALKTHROUGH_RUN_ID)"
echo "reminder: start the frontend with SELLEROPS_BACKEND_ORIGIN=http://127.0.0.1:${SERVER_PORT} npm run dev  (and leave VITE_API_BASE_URL UNSET)"
cd "$BACKEND_DIR"
exec ./gradlew bootRun
