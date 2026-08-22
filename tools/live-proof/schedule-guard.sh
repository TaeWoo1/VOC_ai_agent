#!/usr/bin/env bash
# Enabled-schedule guard for a live proof — report, pause, restore.
#
# WHY THIS EXISTS
# On 2026-08-22 a Cafe24 re-consent produced four live marketplace reads within a minute, while the
# operator had been asked to stop before any collection. Nothing was bypassed: the account's three
# schedules had been auth-paused, the reconnect resumed them by design, and the collect tick ran them.
# The approval boundary was crossed by a mechanism nobody had checked.
#
# The existing per-channel preflights check `SELLEROPS_COLLECT_SCHEDULER_ENABLED` in THEIR OWN SHELL.
# That is not the running backend's answer — the backend is started separately, often from a
# `.env.local` the preflight never reads, which is exactly how a preflight can pass while the deployment
# it is vouching for has the scheduler armed. This asks the backend instead, per account, and treats
# whatever it says as the truth.
#
# Usage:
#   schedule-guard.sh report  <accountId>
#   schedule-guard.sh pause   <accountId>   # disables every enabled schedule, records what it disabled
#   schedule-guard.sh restore <accountId>   # re-enables exactly what THIS tool paused, nothing else
#
# Env: BACKEND_ORIGIN (default http://127.0.0.1:8080), SELLEROPS_EMAIL, SELLEROPS_PASSWORD.
# Reads and writes schedules only. Never touches a credential, never calls a marketplace.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_ORIGIN="${BACKEND_ORIGIN:-http://127.0.0.1:8080}"
EMAIL="${SELLEROPS_EMAIL:-demo@sellerops.ai}"
PASSWORD="${SELLEROPS_PASSWORD:-demo1234}"
STATE_DIR="$HERE/.run"
mkdir -p "$STATE_DIR"

CMD="${1:-}"
ACCOUNT="${2:-}"
[ -n "$CMD" ] && [ -n "$ACCOUNT" ] || { echo "usage: schedule-guard.sh <report|pause|restore> <accountId>" >&2; exit 2; }
STATE_FILE="$STATE_DIR/paused-$ACCOUNT.json"

# A safety tool must fail legibly. A backend that is still booting answers with an error page, not
# JSON, and a raw traceback there reads like the guard itself is broken — which invites skipping it.
token() {
  curl -s --max-time 8 -X POST -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" "$BACKEND_ORIGIN/api/auth/login" \
    | python3 -c 'import sys,json
try:
    print(json.load(sys.stdin).get("token",""))
except Exception:
    print("")'
}

TOKEN="$(token)"
[ -n "$TOKEN" ] || { echo "FAIL: could not log in to $BACKEND_ORIGIN" >&2; exit 1; }

schedules() {
  curl -s --max-time 8 -H "Authorization: Bearer $TOKEN" \
    "$BACKEND_ORIGIN/api/seller-accounts/$ACCOUNT/schedule"
}

put() { # dataType intervalMinutes enabled
  curl -s --max-time 8 -X PUT -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"dataType\":\"$1\",\"intervalMinutes\":$2,\"enabled\":$3}" \
    "$BACKEND_ORIGIN/api/seller-accounts/$ACCOUNT/schedule" > /dev/null
}

GUARD_PY="$HERE/schedule_guard.py"

case "$CMD" in
  report)
    schedules | python3 "$GUARD_PY" report
    ;;
  pause)
    # Record BEFORE changing anything, so a crash mid-way still leaves a restorable record.
    schedules | python3 "$GUARD_PY" record "$STATE_FILE"
    python3 "$GUARD_PY" list "$STATE_FILE" | while read -r dt interval; do
      put "$dt" "$interval" false
      echo "  paused $dt"
    done
    ;;
  restore)
    [ -f "$STATE_FILE" ] || { echo "nothing recorded for $ACCOUNT — refusing to guess which schedules to enable" >&2; exit 1; }
    # Restores ONLY what this tool paused, at the interval it found. An operator who turned something
    # off for their own reasons stays off.
    python3 "$GUARD_PY" list "$STATE_FILE" | while read -r dt interval; do
      put "$dt" "$interval" true
      echo "  restored $dt (every ${interval}m)"
    done
    rm -f "$STATE_FILE"
    ;;
  *)
    echo "usage: schedule-guard.sh <report|pause|restore> <accountId>" >&2; exit 2 ;;
esac
