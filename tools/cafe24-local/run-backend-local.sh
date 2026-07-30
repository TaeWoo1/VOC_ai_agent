#!/usr/bin/env bash
#
# Cafe24 local backend bootstrap — loads secrets from the macOS Keychain (never
# from the repo), pins the disposable Cafe24 proof configuration, and refuses to
# boot unless the configured vault master key can actually decrypt the stored
# credential. This closes the exact gap behind the run-time failure
# "자격 증명 복호화에 실패했습니다": a backend started with a master key that does
# not match the key that sealed connector_credentials.encrypted_payload.
#
# NO secret value is ever printed. NO secret is stored in the repository.
# This script performs NO Cafe24 API call, NO /backfill, and NO credential write
# — it only prepares the environment and boots the backend fail-closed. Live
# collection remains a separate, operator-approved step.
#
# Keychain items this script reads (create them yourself; see .env.example):
#   service=sellerops-vault-master-key  account=<key-id, default local-dev-1>  -> base64 32-byte AES-256 master key
#   service=sellerops-cafe24-db         account=sellerops                      -> disposable DB password (optional under local trust auth)
#   service=sellerops-cafe24-oauth      account=client-id                      -> Cafe24 app client id
#   service=sellerops-cafe24-oauth      account=client-secret                  -> Cafe24 app client secret
#
set -euo pipefail

# ---- fixed disposable-proof configuration (do not point at real sellerops) ----
export SPRING_DATASOURCE_URL="jdbc:postgresql://127.0.0.1:55432/cafe24_phaseb"
export SPRING_DATASOURCE_USERNAME="sellerops"
export SELLEROPS_VAULT_KEY_ID="${SELLEROPS_VAULT_KEY_ID:-local-dev-1}"
export SELLEROPS_CONNECTOR_CAFE24_ENABLED="true"
export SELLEROPS_CONNECTOR_CAFE24_API_VERSION="2025-12-01"
export SELLEROPS_COLLECT_SCHEDULER_ENABLED="false"
export SELLEROPS_CONNECTOR_CAFE24_DIAGNOSTIC_BOARDS_ENABLED="false"

KC_MASTER_SERVICE="${SELLEROPS_KC_MASTER_SERVICE:-sellerops-vault-master-key}"
KC_DB_SERVICE="${SELLEROPS_KC_DB_SERVICE:-sellerops-cafe24-db}"
KC_OAUTH_SERVICE="${SELLEROPS_KC_OAUTH_SERVICE:-sellerops-cafe24-oauth}"

PG_HOST="127.0.0.1"; PG_PORT="55432"; PG_DB="cafe24_phaseb"; PG_USER="sellerops"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$HERE/../../backend" && pwd)"

die() { echo "FAIL-CLOSED: $*" >&2; exit 1; }
kc() { security find-generic-password -s "$1" -a "$2" -w 2>/dev/null || true; }

# ---- load master key from Keychain (fail closed if absent) --------------------
SELLEROPS_VAULT_MASTER_KEY="$(kc "$KC_MASTER_SERVICE" "$SELLEROPS_VAULT_KEY_ID")"
[ -n "$SELLEROPS_VAULT_MASTER_KEY" ] || die "vault master key not in Keychain (service=$KC_MASTER_SERVICE account=$SELLEROPS_VAULT_KEY_ID)."
export SELLEROPS_VAULT_MASTER_KEY

# ---- load DB password + Cafe24 client id/secret (env wins, else Keychain) -----
export SPRING_DATASOURCE_PASSWORD="${SPRING_DATASOURCE_PASSWORD:-$(kc "$KC_DB_SERVICE" sellerops)}"
export SELLEROPS_CONNECTOR_CAFE24_CLIENT_ID="${SELLEROPS_CONNECTOR_CAFE24_CLIENT_ID:-$(kc "$KC_OAUTH_SERVICE" client-id)}"
export SELLEROPS_CONNECTOR_CAFE24_CLIENT_SECRET="${SELLEROPS_CONNECTOR_CAFE24_CLIENT_SECRET:-$(kc "$KC_OAUTH_SERVICE" client-secret)}"
[ -n "$SELLEROPS_CONNECTOR_CAFE24_CLIENT_ID" ]     || die "Cafe24 client-id missing (env or Keychain service=$KC_OAUTH_SERVICE account=client-id)."
[ -n "$SELLEROPS_CONNECTOR_CAFE24_CLIENT_SECRET" ] || die "Cafe24 client-secret missing (env or Keychain service=$KC_OAUTH_SERVICE account=client-secret)."

# Cafe24 OAuth redirect URI — MUST byte-for-byte equal the callback registered on
# the Cafe24 app, or /connect/cafe24/start mints a consent URL Cafe24 rejects. The
# app here is registered against a public tunnel (ngrok) callback, so the default
# http://localhost:8080/... is wrong. Volatile per tunnel, so it is NOT hardcoded:
# env overrides, else Keychain (service=$KC_OAUTH_SERVICE account=redirect-uri).
# Only exported when provided — a plain backfill boot does not need it.
REDIRECT_URI="${SELLEROPS_CONNECTOR_CAFE24_REDIRECT_URI:-$(kc "$KC_OAUTH_SERVICE" redirect-uri)}"
[ -n "$REDIRECT_URI" ] && export SELLEROPS_CONNECTOR_CAFE24_REDIRECT_URI="$REDIRECT_URI"

export PGHOST="$PG_HOST" PGPORT="$PG_PORT" PGDATABASE="$PG_DB" PGUSER="$PG_USER"
[ -n "${SPRING_DATASOURCE_PASSWORD:-}" ] && export PGPASSWORD="$SPRING_DATASOURCE_PASSWORD"
PSQL="$(command -v psql || echo /opt/homebrew/opt/postgresql@15/bin/psql)"

# ---- assert the configured key-id matches the stored credential's key-id ------
STORED_KEY_ID="$("$PSQL" -tAc "select coalesce(encryption_key_id,'') from connector_credentials limit 1;" 2>/dev/null | tr -d '[:space:]')"
[ -n "$STORED_KEY_ID" ] || die "no stored credential found in $PG_DB (cannot verify key-id)."
[ "$STORED_KEY_ID" = "$SELLEROPS_VAULT_KEY_ID" ] || die "key-id mismatch: stored='$STORED_KEY_ID' configured='$SELLEROPS_VAULT_KEY_ID'."

# ---- pre-boot decryptability gate (boolean only; no secret printed) -----------
# Recovery bypass: when the correct existing master key cannot be recovered, the
# fix is a Cafe24 OAuth reconnect that re-stores the credential under the current
# key — but that needs a running backend, which the gate would otherwise block.
# SELLEROPS_BOOTSTRAP_ALLOW_REKEY=true boots WITHOUT the gate for exactly that
# recovery (still pins config; still no live call until an approved backfill).
# Leave it unset for every normal boot so a key mismatch fails closed.
if [ "${SELLEROPS_BOOTSTRAP_ALLOW_REKEY:-false}" = "true" ]; then
  echo "pre-boot gate: BYPASSED (SELLEROPS_BOOTSTRAP_ALLOW_REKEY=true) — re-key/OAuth-reconnect recovery boot; existing credential decryptability NOT asserted."
else
  PAYLOAD_HEX="$("$PSQL" -tAc "select encode(encrypted_payload,'hex') from connector_credentials limit 1;" 2>/dev/null | tr -d '[:space:]')"
  [ -n "$PAYLOAD_HEX" ] || die "stored credential has no encrypted payload."
  if printf '%s' "$PAYLOAD_HEX" | python3 "$HERE/check_credential_decryptable.py"; then
    echo "pre-boot gate: credential decryptable with configured master key (key-id=$SELLEROPS_VAULT_KEY_ID)."
  else
    die "configured master key cannot decrypt the stored credential (key-id=$SELLEROPS_VAULT_KEY_ID). Recover the correct key into the Keychain, or boot once with SELLEROPS_BOOTSTRAP_ALLOW_REKEY=true and re-run Cafe24 OAuth to re-store the credential (never hand-edit encrypted_payload). NOT booting."
  fi
  unset PAYLOAD_HEX
fi
unset PGPASSWORD

# ---- boot (still no live channel call until an operator-approved backfill) ----
echo "starting backend on :8080 (JDBC=$SPRING_DATASOURCE_URL, cafe24 api-version=$SELLEROPS_CONNECTOR_CAFE24_API_VERSION, scheduler=$SELLEROPS_COLLECT_SCHEDULER_ENABLED, diagnostic-boards=$SELLEROPS_CONNECTOR_CAFE24_DIAGNOSTIC_BOARDS_ENABLED)"
cd "$BACKEND_DIR"
exec ./gradlew bootRun
