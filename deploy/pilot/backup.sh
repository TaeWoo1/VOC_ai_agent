#!/usr/bin/env bash
# Daily logical backup — Pilot Host Provisioning v1 §4/§11, off-host copy per Pilot Provisioning
# Plan v1 §3 (blocker B5).
#   deploy/pilot/backup.sh            # writes /var/backups/sellerops/sellerops-YYYYmmdd-HHMM.dump (pg_dump -Fc)
#                                     # then, when SELLEROPS_BACKUP_S3_ENABLED=true, uploads it off-host
#   deploy/pilot/backup.sh --local-only   # the dump only; never touches object storage
#
# `--local-only` exists for exactly one caller: deploy.sh's pre-migration dump. What that dump is FOR
# is the rollback of the migration about to run, and that rollback is performed from this host — so
# making a deploy depend on object storage being reachable would block an urgent fix for a reason
# that has nothing to do with the deploy. The DAILY cron run is the one that owes both halves, and it
# is the one whose exit status says so.
# Install:  echo '17 3 * * * root /opt/sellerops/repo/deploy/pilot/backup.sh >> /var/log/sellerops-backup.log 2>&1' \
#           > /etc/cron.d/sellerops-backup
#
# The dump contains sealed credentials (vault ciphertext) and seller data: the directory is 0700 root.
# It contains NO env secret — the vault master key and JWT secret live only in /etc/sellerops/pilot.env,
# which is deliberately NOT part of the backup.
#
# THAT IS WHY THE KEY HAS ITS OWN CUSTODY. A dump restored under a different master key opens nothing,
# so an off-host copy of the dump is only half of "recoverable after losing the host": the other half
# is an off-host copy of SELLEROPS_VAULT_MASTER_KEY, kept somewhere OTHER than this bucket, by the
# operator. Nothing in this script can check that, so it is said here and asserted by rehearsal
# (Pilot Provisioning Plan v1 §6-B, B5-6/B5-7).
#
# Retention is split on purpose:
#   * local   — this script prunes, because it wrote them (PILOT_BACKUP_KEEP_DAYS).
#   * off-host — THE BUCKET'S LIFECYCLE POLICY prunes, and this script never deletes a remote object.
#     A script that knows how to delete is a script that can delete, and the uploader's credential is
#     deliberately PutObject-only so that a compromised host cannot erase its own history.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${PILOT_ENV_FILE:-/etc/sellerops/pilot.env}"
DIR="${PILOT_BACKUP_DIR:-/var/backups/sellerops}"
KEEP_DAYS="${PILOT_BACKUP_KEEP_DAYS:-14}"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$REPO/docker-compose.yml" -f "$REPO/deploy/pilot/docker-compose.pilot.yml")

# Sourced rather than grepped: the off-host settings below live in the same file, and one reader for
# the whole file is one place where quoting can be wrong. Values are never printed by this script.
[[ -f "$ENV_FILE" ]] || { printf 'backup FAILED: %s not found\n' "$ENV_FILE" >&2; exit 1; }
set -a; . "$ENV_FILE"; set +a

umask 077; mkdir -p "$DIR"; chmod 700 "$DIR"
out="$DIR/sellerops-$(date +%Y%m%d-%H%M).dump"

# ── 1. the dump ──────────────────────────────────────────────────────────────────────────────────
"${COMPOSE[@]}" exec -T postgres pg_dump -U "${POSTGRES_USER:-sellerops}" -d "${POSTGRES_DB:-sellerops}" -Fc > "$out.part"
mv "$out.part" "$out"
bytes="$(stat -c %s "$out" 2>/dev/null || stat -f %z "$out")"
find "$DIR" -name 'sellerops-*.dump' -mtime +"$KEEP_DAYS" -delete

# ── 2. off-host copy ─────────────────────────────────────────────────────────────────────────────
# A host-local backup does not survive the host, which is the only failure B5 exists for. So the
# script's exit status is about BOTH halves: a local dump that could not be copied off the host is
# reported as a FAILURE, loudly, rather than as a success with a warning nobody reads. The local
# dump is still written and still kept — losing it as well would help no one.
key="$(basename "$out")"
if [[ " $* " == *" --local-only "* ]]; then
  printf 'backup OK local-only at=%s file=%s bytes=%s offhost=skipped-by-caller\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$out" "$bytes"
  exit 0
fi
if [[ "${SELLEROPS_BACKUP_S3_ENABLED:-false}" != "true" ]]; then
  printf 'backup OK local-only at=%s file=%s bytes=%s offhost=disabled\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$out" "$bytes"
  exit 0
fi

missing=()
for n in SELLEROPS_BACKUP_S3_BUCKET SELLEROPS_BACKUP_S3_ACCESS_KEY_ID SELLEROPS_BACKUP_S3_SECRET_ACCESS_KEY; do
  [[ -n "${!n:-}" ]] || missing+=("$n")
done
# Region is required by the AWS SigV4 signer. A third-party S3-compatible endpoint that does not use
# regions still needs SOMETHING to sign with, so this is required rather than defaulted — a silent
# default here is a signature mismatch discovered at 03:17 by nobody.
[[ -n "${SELLEROPS_BACKUP_S3_REGION:-}" ]] || missing+=("SELLEROPS_BACKUP_S3_REGION")
if [[ ${#missing[@]} -gt 0 ]]; then
  printf 'backup FAILED off-host at=%s file=%s bytes=%s reason=config-incomplete missing=%s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$out" "$bytes" "${missing[*]}" >&2
  exit 1
fi
command -v aws >/dev/null 2>&1 || {
  printf 'backup FAILED off-host at=%s file=%s bytes=%s reason=aws-cli-not-installed\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$out" "$bytes" >&2
  exit 1
}

# `s3api put-object` is ONE PutObject call. This is not a stylistic choice over `s3 cp`:
#   * `s3 cp` switches to a multipart upload above a threshold, and multipart needs
#     CreateMultipartUpload / UploadPart / CompleteMultipartUpload — and AbortMultipartUpload to clean
#     up after itself. That is a strictly wider permission set than the one this pilot grants.
#   * `s3 sync --delete` can remove remote objects. It is not used, and retention stays with the
#     bucket, so the credential never needs DeleteObject at all.
# The PutObject response IS the receipt: with a PutObject-only credential we cannot read the object
# back (HeadObject needs GetObject), so the returned ETag is the strongest confirmation available —
# and saying that plainly is better than a verification step that would require widening the grant.
s3=(aws s3api put-object --bucket "$SELLEROPS_BACKUP_S3_BUCKET" --key "$key" --body "$out" --region "$SELLEROPS_BACKUP_S3_REGION")
[[ -n "${SELLEROPS_BACKUP_S3_ENDPOINT:-}" ]] && s3+=(--endpoint-url "$SELLEROPS_BACKUP_S3_ENDPOINT")

# Credentials reach the AWS CLI through its own environment and are never written to a profile, a
# command line (visible in `ps`), or this script's output.
if etag="$(AWS_ACCESS_KEY_ID="$SELLEROPS_BACKUP_S3_ACCESS_KEY_ID" \
           AWS_SECRET_ACCESS_KEY="$SELLEROPS_BACKUP_S3_SECRET_ACCESS_KEY" \
           AWS_EC2_METADATA_DISABLED=true \
           "${s3[@]}" --output text --query ETag 2>&1)"; then
  printf 'backup OK at=%s file=%s bytes=%s offhost=uploaded bucket=%s key=%s etag=%s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$out" "$bytes" "$SELLEROPS_BACKUP_S3_BUCKET" "$key" "$etag"
else
  # The uploader's own message can carry the endpoint and the key, but never the secret — it is not
  # on the command line and not in the environment the CLI echoes back.
  printf 'backup FAILED off-host at=%s file=%s bytes=%s bucket=%s key=%s reason=upload-failed detail=%s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$out" "$bytes" "$SELLEROPS_BACKUP_S3_BUCKET" "$key" "${etag//$'\n'/ }" >&2
  exit 1
fi
