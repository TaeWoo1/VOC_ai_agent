#!/usr/bin/env bash
# Daily logical backup — Pilot Host Provisioning v1 §4/§11.
#   deploy/pilot/backup.sh            # writes /var/backups/sellerops/sellerops-YYYYmmdd-HHMM.dump (pg_dump -Fc)
# Install:  echo '17 3 * * * root /opt/sellerops/repo/deploy/pilot/backup.sh >> /var/log/sellerops-backup.log 2>&1' \
#           > /etc/cron.d/sellerops-backup
# The dump contains sealed credentials (vault ciphertext) and seller data: the directory is 0700 root.
# It contains NO env secret — the vault master key and JWT secret live only in /etc/sellerops/pilot.env,
# which is deliberately NOT part of the backup (restore needs the same key file, kept by the operator).
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${PILOT_ENV_FILE:-/etc/sellerops/pilot.env}"
DIR="${PILOT_BACKUP_DIR:-/var/backups/sellerops}"
KEEP_DAYS="${PILOT_BACKUP_KEEP_DAYS:-14}"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$REPO/docker-compose.yml" -f "$REPO/deploy/pilot/docker-compose.pilot.yml")
umask 077; mkdir -p "$DIR"; chmod 700 "$DIR"
db="$(grep -E '^POSTGRES_DB=' "$ENV_FILE" | cut -d= -f2-)"; user="$(grep -E '^POSTGRES_USER=' "$ENV_FILE" | cut -d= -f2-)"
out="$DIR/sellerops-$(date +%Y%m%d-%H%M).dump"
"${COMPOSE[@]}" exec -T postgres pg_dump -U "${user:-sellerops}" -d "${db:-sellerops}" -Fc > "$out.part"
mv "$out.part" "$out"
find "$DIR" -name 'sellerops-*.dump' -mtime +"$KEEP_DAYS" -delete
printf '%s %s bytes\n' "$out" "$(stat -c %s "$out" 2>/dev/null || stat -f %z "$out")"
