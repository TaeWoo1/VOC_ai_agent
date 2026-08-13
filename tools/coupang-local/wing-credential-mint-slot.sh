#!/usr/bin/env bash
#
# Coupang WING CREDENTIAL-HANDOFF account slot — names the account the handoff will store into, and proves it
# is empty before naming it.
#
#   tools/coupang-local/wing-credential-mint-slot.sh
#
# ## What it does, and why it is a script rather than a step in a checklist
#
# The handoff refuses without `SELLEROPS_ACCOUNT_SLOT`, deliberately: a run with no account named would have to
# guess which connection the seller's key belongs to, and the failure direction of that guess is a credential
# stored on the wrong account. Typing a slot by hand is the same guess with more steps, so the slot is READ
# from the backend that owns it — one authenticated GET, which mints on first use and returns the same slot
# every time after.
#
# The same read answers whether a credential is already stored. That matters here more than it looks: the
# handoff never overwrites, so a non-empty account turns into a refusal at the very end of a live sitting, with
# the seller's keys on screen and nothing to do about it. Better to fail closed now, before a manifest is even
# prepared.
#
# ## What it refuses
#
#   - the backend is not up, or the login fails
#   - the account cannot be found, or is not a Coupang account
#   - the account ALREADY has a credential stored (that is the renewal path, not this one)
#   - the returned slot is not the 24-hex shape the handoff accepts
#
# It performs NO Coupang call, reads no credential value, and stores nothing. It prints one export line.
#
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

BACKEND_ORIGIN="${SELLEROPS_BASE_URL:-http://localhost:18091}"
EMAIL="${SELLEROPS_EMAIL:-demo@sellerops.ai}"
PASSWORD="${SELLEROPS_PASSWORD:-demo1234}"
WANT_CHANNEL="COUPANG"

die() { echo "MINT FAIL-CLOSED: $*" >&2; exit 1; }

jq_free_get() { # $1=json $2=key  → the first "key":"value" string value, or empty
  printf '%s' "$1" | sed -n "s/.*\"$2\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -1
}

TOKEN="$(curl -s --max-time 8 -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" "$BACKEND_ORIGIN/api/auth/login" 2>/dev/null \
  | sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
[ -n "$TOKEN" ] || die "could not sign in to $BACKEND_ORIGIN as $EMAIL — is the backend up (wing-credential-arm-backend.sh)?"

ACCOUNTS="$(curl -s --max-time 8 -H "Authorization: Bearer $TOKEN" "$BACKEND_ORIGIN/api/seller-accounts" 2>/dev/null)"
[ -n "$ACCOUNTS" ] || die "the seller-account list came back empty at the transport level."

# The Coupang account, by channel code. `python3` is already a hard dependency of the preflight, and a JSON
# array is not something to parse with `sed` when picking WHICH account a credential lands on.
ACCOUNT_ID="$(printf '%s' "$ACCOUNTS" | python3 -c '
import json, sys
try:
    rows = json.load(sys.stdin)
except Exception:
    sys.exit(0)
want = "'"$WANT_CHANNEL"'"
ids = [r.get("id") for r in rows if isinstance(r, dict) and r.get("channelCode") == want]
# EXACTLY one, or nothing. Two Coupang accounts on a proof org means a human has to say which — picking the
# first would be this script guessing which connection the seller\x27s key belongs to.
print(ids[0] if len(ids) == 1 else "")
' 2>/dev/null)"

if [ -z "$ACCOUNT_ID" ]; then
  COUNT="$(printf '%s' "$ACCOUNTS" | python3 -c '
import json, sys
try:
    rows = json.load(sys.stdin)
except Exception:
    print("?"); sys.exit(0)
print(sum(1 for r in rows if isinstance(r, dict) and r.get("channelCode") == "'"$WANT_CHANNEL"'"))
' 2>/dev/null)"
  die "expected exactly ONE $WANT_CHANNEL seller account on this org, found ${COUNT:-?}. Create one in the UI, or remove the extras — this script will not choose which account a credential lands on."
fi

SLOT_JSON="$(curl -s --max-time 8 -H "Authorization: Bearer $TOKEN" \
  "$BACKEND_ORIGIN/api/seller-accounts/$ACCOUNT_ID/session-slot" 2>/dev/null)"
SLOT="$(jq_free_get "$SLOT_JSON" accountSlot)"
case "$SLOT" in
  [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
  *) die "the backend did not return a 24-hex account slot. Nothing to bind this run to." ;;
esac

case "$(printf '%s' "$SLOT_JSON" | tr -d ' ')" in
  *'"credentialPresent":true'*)
    die "this account ALREADY has a credential stored. The handoff never overwrites — use the renewal path, or pick an empty account. Refusing now rather than at the end of a live sitting." ;;
esac

echo "Coupang credential-handoff slot"
echo "  backend  : $BACKEND_ORIGIN"
echo "  channel  : $WANT_CHANNEL"
echo "  slot     : ${SLOT:0:8}…  (opaque; the seller-account id never leaves the backend)"
echo "  state    : EMPTY — no credential stored on this account"
echo
echo "  export it for the preflight and the run:"
echo "    export SELLEROPS_ACCOUNT_SLOT=$SLOT"
