#!/usr/bin/env bash
# Restore one dump into the running postgres container — Pilot Host Provisioning v1 §4.
#   deploy/pilot/restore.sh /var/backups/sellerops/sellerops-20260901-0317.dump
# Stops the backend and runtime first (no writers), drops and recreates the schema from the dump,
# then starts them again (Flyway then sees the restored version table and applies nothing or only
# what is newer). The vault master key must be the one that sealed the credentials in the dump —
# a different key opens nothing (KEY_MISMATCH by fingerprint, docs/demo_org_and_channel_knowledge_v1.md).
set -euo pipefail
[[ $# -eq 1 && -f "$1" ]] || { echo "usage: restore.sh <dump-file>"; exit 2; }
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${PILOT_ENV_FILE:-/etc/sellerops/pilot.env}"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$REPO/docker-compose.yml" -f "$REPO/deploy/pilot/docker-compose.pilot.yml")
db="$(grep -E '^POSTGRES_DB=' "$ENV_FILE" | cut -d= -f2-)"; user="$(grep -E '^POSTGRES_USER=' "$ENV_FILE" | cut -d= -f2-)"
read -r -p "Restore $1 into ${db:-sellerops}? This replaces the current data. Type RESTORE to continue: " ans
[[ "$ans" == "RESTORE" ]] || exit 1
"${COMPOSE[@]}" stop backend agent-runtime
"${COMPOSE[@]}" exec -T postgres psql -U "${user:-sellerops}" -d "${db:-sellerops}" -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
"${COMPOSE[@]}" exec -T postgres pg_restore -U "${user:-sellerops}" -d "${db:-sellerops}" --no-owner --no-privileges < "$1"
"${COMPOSE[@]}" start backend agent-runtime
echo "restored; run deploy/pilot/smoke.sh"
