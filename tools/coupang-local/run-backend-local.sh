#!/usr/bin/env bash
#
# Coupang live-proof local backend. Boots a DISPOSABLE backend on a FIXED port with the Coupang connector
# enabled, the collection scheduler OFF, the base URL pointed at the REAL Coupang gateway, and the backend
# live-call interlock ARMED with this run's approval id (from bootstrap.sh). The vault master key is loaded
# from the macOS Keychain, never the repo.
#
# This script performs NO Coupang API call, NO connection test, NO sync, and NO credential write. It only
# prepares the environment and boots the backend. Every live step (the operator entering the credential in
# the frontend, the connect test, the first sync, the idempotent re-sync) is a separate, operator-approved
# action taken AFTER preflight.sh displays the Approval Manifest and the operator answers "Seated and ready."
#
# Because the base URL is the real gateway, the live-call interlock is meaningful: with the approval id
# armed here, a deliberate operator action can reach Coupang; WITHOUT it (the default config) any call would
# fail closed (CoupangLiveApprovalRequiredException). Point the disposable DB at a throwaway database — NEVER
# the real sellerops instance.
#
# Keychain item this script reads (create it yourself; see .env.example):
#   service=sellerops-vault-master-key  account=<key-id, default coupang-proof-1>  -> base64 32-byte AES-256 key
#
set -euo pipefail

export SERVER_PORT="${SELLEROPS_COUPANG_BACKEND_PORT:-18091}"
export SPRING_DATASOURCE_URL="${SPRING_DATASOURCE_URL:-jdbc:postgresql://127.0.0.1:55432/coupang_proof}"
export SPRING_DATASOURCE_USERNAME="${SPRING_DATASOURCE_USERNAME:-sellerops}"
export SELLEROPS_VAULT_KEY_ID="${SELLEROPS_VAULT_KEY_ID:-coupang-proof-1}"
export SELLEROPS_CONNECTOR_COUPANG_ENABLED="true"
export SELLEROPS_COLLECT_SCHEDULER_ENABLED="false"
export SELLEROPS_SEED_ENABLED="${SELLEROPS_SEED_ENABLED:-true}"
# Real Coupang gateway (the whole point of a live proof). Overridable only for a deliberate offline dry-run.
export SELLEROPS_CONNECTOR_COUPANG_BASE_URL="${SELLEROPS_CONNECTOR_COUPANG_BASE_URL:-https://api-gateway.coupang.com}"
# The advertised calling IP(s) the operator registered in their Coupang app — surfaced by /setup so the
# operator can eyeball-match it. Informational only; the harness cannot verify the real OS egress IP.
export SELLEROPS_CONNECTOR_COUPANG_ADVERTISED_EGRESS_IPS="${SELLEROPS_CONNECTOR_COUPANG_ADVERTISED_EGRESS_IPS:-}"

KC_MASTER_SERVICE="${SELLEROPS_KC_MASTER_SERVICE:-sellerops-vault-master-key}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$HERE/../../backend" && pwd)"
RUN_ENV="$HERE/.run/current.env"

die() { echo "FAIL-CLOSED: $*" >&2; exit 1; }
kc() { security find-generic-password -s "$1" -a "$2" -w 2>/dev/null || true; }

# ---- run identity + approval id ------------------------------------------------
#
# Two callers, two run envs, and the difference is deliberate:
#
#   - the ORDER-ROUTINE proof (bootstrap.sh → current.env) arms the read-only live-call interlock;
#   - the CREDENTIAL HANDOFF (wing-credential-bootstrap.sh handoff → wing-credential-arm-backend.sh) arms the
#     credential interlock, and arms the live-call one with the SAME id, because the handoff's verification
#     leg is itself a read-only Coupang GET.
#
# When the credential arming is already exported, this script must NOT re-arm the live-call interlock from
# `current.env`: that would boot a backend whose two interlocks name different runs, and the operator's grant
# names one. It is detected rather than passed as a flag — the presence of a MINTED credential arming is the
# fact that matters, and a flag would be one more thing a hand can set.
if [ -n "${SELLEROPS_CREDENTIAL_HANDOFF_APPROVAL_ID:-}" ]; then
  [ -n "${SELLEROPS_CONNECTOR_COUPANG_LIVE_APPROVAL_ID:-}" ] \
    || die "credential arming present but the live-call interlock is unset — boot via wing-credential-arm-backend.sh."
  [ "$SELLEROPS_CONNECTOR_COUPANG_LIVE_APPROVAL_ID" = "$SELLEROPS_CREDENTIAL_HANDOFF_APPROVAL_ID" ] \
    || die "the two interlocks name different approvals. One run, one grant, one id."
  COUPANG_APPROVAL_ID="$SELLEROPS_CREDENTIAL_HANDOFF_APPROVAL_ID"
  COUPANG_RUN_ID="${SELLEROPS_CREDENTIAL_HANDOFF_RUN_ID:-}"
  ARMED_FOR="credential handoff + its read-only verification"
else
  [ -f "$RUN_ENV" ] || die "no run env at $RUN_ENV — run tools/coupang-local/bootstrap.sh first."
  # shellcheck disable=SC1090
  set -a; . "$RUN_ENV"; set +a
  [ -n "${COUPANG_APPROVAL_ID:-}" ] || die "COUPANG_APPROVAL_ID missing from run env — re-run bootstrap.sh."
  # Arm the backend live-call interlock with THIS run's approval id. preflight.sh verifies the running backend
  # reports this id's prefix via /setup before any live action is taken.
  export SELLEROPS_CONNECTOR_COUPANG_LIVE_APPROVAL_ID="$COUPANG_APPROVAL_ID"
  ARMED_FOR="read-only order routine"
fi

# ---- refuse to boot against the real sellerops DB -----------------------------
# Catch both the default prod port (:5432/…sellerops…) AND a 'sellerops' database name reached on any
# port / with the default port omitted (…/sellerops or …/sellerops?params). The disposable DB is
# coupang_proof, which matches none of these.
case "$SPRING_DATASOURCE_URL" in
  *:5432/*sellerops*|*/sellerops|*/sellerops\?*)
    die "SPRING_DATASOURCE_URL looks like the REAL sellerops DB. Use a disposable database (e.g. coupang_proof)." ;;
esac

# ---- load master key from Keychain (fail closed if absent) --------------------
SELLEROPS_VAULT_MASTER_KEY="$(kc "$KC_MASTER_SERVICE" "$SELLEROPS_VAULT_KEY_ID")"
[ -n "$SELLEROPS_VAULT_MASTER_KEY" ] || die "vault master key not in Keychain (service=$KC_MASTER_SERVICE account=$SELLEROPS_VAULT_KEY_ID)."
export SELLEROPS_VAULT_MASTER_KEY

export SPRING_DATASOURCE_PASSWORD="${SPRING_DATASOURCE_PASSWORD:-}"

echo "starting Coupang live-proof backend on :${SERVER_PORT}"
echo "  JDBC        : $SPRING_DATASOURCE_URL"
echo "  coupang     : enabled=true  base-url=$SELLEROPS_CONNECTOR_COUPANG_BASE_URL  scheduler=$SELLEROPS_COLLECT_SCHEDULER_ENABLED"
echo "  interlock   : armed with approval ${COUPANG_APPROVAL_ID:0:12}…  (run ${COUPANG_RUN_ID:-?})"
echo "  armed for   : $ARMED_FOR"
if [ -n "${SELLEROPS_CREDENTIAL_HANDOFF_APPROVAL_ID:-}" ]; then
  echo "  credential  : interlock ARMED — one handoff, spent at the store, gone on restart"
  echo "                phase ${SELLEROPS_CREDENTIAL_HANDOFF_PHASE:-?}  commit ${SELLEROPS_CREDENTIAL_HANDOFF_GIT_COMMIT:-?}"
else
  echo "  credential  : interlock UNARMED — a credential handoff is refused before the vault is touched"
fi
echo "  advertised  : ${SELLEROPS_CONNECTOR_COUPANG_ADVERTISED_EGRESS_IPS:-<none set>}"
echo "reminder: NO Coupang call happens until the operator enters a credential + triggers test/sync AFTER preflight."
cd "$BACKEND_DIR"
exec ./gradlew bootRun
