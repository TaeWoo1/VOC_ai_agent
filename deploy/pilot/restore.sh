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

# ── validate the dump BEFORE anything destructive ────────────────────────────────────────────────
# `DROP SCHEMA public CASCADE` used to be the first thing that ran. A dump that pg_restore cannot
# read all the way through — truncated by a full disk, by a killed pg_dump, by a partial download
# out of object storage — would therefore destroy the schema and THEN fail, leaving a host with
# neither its old data nor its new data. That is the one outcome a restore script must not have.
#
# `--list` reads the archive's table of contents and prints it. It is READ-ONLY: it opens the file,
# not the database, and writes nothing. -d is deliberately absent so there is no question about
# which database it could touch. A truncated custom-format archive fails here ("unexpected end of
# file"), which is exactly the dump we must refuse.
#
# This runs before the confirmation prompt on purpose. "Type RESTORE to continue" is a promise that
# typing it restores; asking for that word when the file cannot be read is asking a human to
# authorise something that cannot happen.
if ! toc="$("${COMPOSE[@]}" exec -T postgres pg_restore --list < "$1" 2>&1 >/dev/null)"; then
  printf 'restore REFUSED: %s is not a readable pg_dump archive — nothing was dropped.\n' "$1" >&2
  printf '  pg_restore --list said: %s\n' "${toc//$'\n'/ }" >&2
  printf '  the database is untouched. Check the dump (size, transfer, `pg_restore --list` locally) and retry.\n' >&2
  exit 3
fi

read -r -p "Restore $1 into ${db:-sellerops}? This replaces the current data. Type RESTORE to continue: " ans
[[ "$ans" == "RESTORE" ]] || exit 1
"${COMPOSE[@]}" stop backend agent-runtime
"${COMPOSE[@]}" exec -T postgres psql -U "${user:-sellerops}" -d "${db:-sellerops}" -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
"${COMPOSE[@]}" exec -T postgres pg_restore -U "${user:-sellerops}" -d "${db:-sellerops}" --no-owner --no-privileges < "$1"
"${COMPOSE[@]}" start backend agent-runtime
echo "restored; run deploy/pilot/smoke.sh"
