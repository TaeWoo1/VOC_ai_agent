#!/usr/bin/env bash
# Daily backup cron — Pilot Provisioning Plan v1 §2-E step 15, blocker B5 item B5-1.
#
#   deploy/pilot/install-backup-job.sh                       # repo = this checkout
#   deploy/pilot/install-backup-job.sh /opt/sellerops/repo   # repo = an explicit path
#   PILOT_ENV_FILE=/etc/sellerops/pilot.env deploy/pilot/install-backup-job.sh
#
# Writes exactly one file, /etc/cron.d/sellerops-backup, whose command is this repository's own
# backup.sh. Nothing else on the host is touched, no cloud resource is created, and no value from the
# env file is read, printed or copied — the cron line names the FILE, and backup.sh sources it at
# 03:17 as root, which is the only place those secrets ever need to be.
#
# WHY A SCRIPT AND NOT A README LINE. The line in backup.sh's header has been correct and uninstalled
# for as long as it has existed (`pilot_provisioning_plan_v1.md` §2-2 S4). Three things about it are
# easy to get subtly wrong by hand, and each one fails silently at 03:17 rather than loudly now:
#
#   * PATH. cron's default is /usr/bin:/bin. AWS CLI v2 installs its shim in **/usr/local/bin**, so a
#     hand-written cron line finds no `aws`, and every nightly run ends at `reason=aws-cli-not-installed`
#     with a local dump written and no off-host copy — which is the exact state B5 exists to forbid.
#   * The TIMEZONE. `17 3 * * *` is a time in whatever zone cron thinks is local, and nothing in this
#     repository sets the host's zone: host-bootstrap.sh does not touch it, no provisioning document
#     defines it, and an Ubuntu cloud image defaults to UTC. So the bare schedule would have run at
#     **12:17 in Seoul** — the middle of a Korean seller's working day — while five comments across
#     deploy/pilot/ describe it as «03:17» and rest their whole argument on nobody being awake for it.
#     The zone is pinned per job below; see the CRON_TZ block.
#   * The env file. backup.sh defaults to /etc/sellerops/pilot.env, but a host whose env lives
#     elsewhere needs PILOT_ENV_FILE ON THE CRON LINE; inherited shell state does not exist in cron.
#   * `%`. In a crontab, an unescaped % is turned into a newline and everything after it becomes stdin.
#     A repo path or env path containing one produces a cron entry that is not the command anyone read.
#
# WHAT THIS SCRIPT DOES NOT DO, deliberately:
#
#   * It never removes anything. There is no --uninstall, and no code path in this file deletes the
#     cron file, the dumps or a remote object. A script that knows how to remove a backup schedule is
#     a script that can remove one; `rm /etc/cron.d/sellerops-backup` is an operator's decision and
#     reads like one.
#   * It does not claim the off-host copy works. `backup.sh --local-only` would exit 0 here without
#     touching object storage, and calling that a verified off-host backup is precisely the failure
#     B5 is about. The first real proof is ONE manual `deploy/pilot/backup.sh` run once the bucket and
#     the PutObject-only credential exist (B5-2); this script only makes it run every day (B5-1).
set -euo pipefail

fail() { printf 'install-backup-job FAILED: %s\n' "$*" >&2; exit 1; }

SELF_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPO_IN="${1:-$SELF_REPO}"
ENV_FILE="${PILOT_ENV_FILE:-/etc/sellerops/pilot.env}"
BACKUP_DIR="${PILOT_BACKUP_DIR:-/var/backups/sellerops}"
# The cron directory is a seam for this script's own tests and for a distro that puts it elsewhere.
# The FILE name inside it is not a knob: one schedule, one name, so a second run replaces the first
# rather than adding a second nightly dump nobody remembers installing.
CRON_DIR="${PILOT_CRON_DIR:-/etc/cron.d}"
CRON_FILE="$CRON_DIR/sellerops-backup"
# Fixed on purpose: backup.sh's header documents this exact redirection, restore/runbook text quotes
# it, and a per-host log path is one more thing that can disagree with the document it came from.
LOG="/var/log/sellerops-backup.log"
SCHEDULE="17 3 * * *"
# Not a knob for the same reason SCHEDULE is not one: the hour above only means «the middle of the
# night» in this zone, and the two are one decision. See the CRON_TZ block below for the audit.
CRON_TIMEZONE="Asia/Seoul"

[[ -d "$REPO_IN" ]] || fail "repo path is not a directory: $REPO_IN"
REPO="$(cd "$REPO_IN" && pwd)"
BACKUP="$REPO/deploy/pilot/backup.sh"
[[ -f "$BACKUP" ]] || fail "$BACKUP not found — is $REPO this repository's checkout?"
[[ -x "$BACKUP" ]] || fail "$BACKUP is not executable (chmod +x) — cron would log a permission error every night"

[[ -f "$ENV_FILE" ]] || fail "$ENV_FILE not found (copy deploy/pilot/pilot.env.example, mode 0600) — cron cannot source a file that is not there"
# The same rule deploy.sh enforces, for the same reason: a pilot secret must never be one `git add`
# away, and a cron line pointing INTO the checkout would survive a `git clean` only by luck.
case "$ENV_FILE" in "$REPO"/*) fail "$ENV_FILE is inside the repository — keep the pilot env outside the checkout";; esac
perm="$(stat -c '%a' "$ENV_FILE" 2>/dev/null || stat -f '%Lp' "$ENV_FILE")"
[[ "$perm" == "600" || "$perm" == "400" ]] || fail "$ENV_FILE must be mode 0600 (is $perm) — it holds the S3 credential this cron job will use"

# Neither path may contain a character that changes what cron executes. Checked rather than escaped:
# an escaped path would still be legal and still be surprising, and there is no reason for a pilot
# host's repo or env file to live at a path with a percent sign or a space in it.
for p in "$REPO" "$ENV_FILE"; do
  case "$p" in
    *%*)              fail "path contains '%', which cron turns into a newline: $p" ;;
    *[[:space:]]*)    fail "path contains whitespace, which cron reads as a field separator: $p" ;;
  esac
done

command -v aws >/dev/null 2>&1 || fail "the aws cli is not installed — the nightly run would write a local dump and fail the off-host upload (deploy/pilot/host-bootstrap.sh installs AWS CLI v2)"
[[ -d "$BACKUP_DIR" ]] || fail "backup directory $BACKUP_DIR does not exist (deploy/pilot/host-bootstrap.sh creates it 0700)"
[[ -d "$(dirname "$LOG")" ]] || fail "$(dirname "$LOG") does not exist — cron cannot append the backup log"
[[ -d "$CRON_DIR" ]] || fail "$CRON_DIR does not exist — is cron installed on this host?"
[[ -w "$CRON_DIR" ]] || fail "$CRON_DIR is not writable (run as root)"

# The PATH line is the load-bearing part of this file; see the header. /usr/local/bin first because
# that is where AWS CLI v2's shim lives, then the two directories cron would have given us anyway
# (docker, pg_dump's client wrapper and the coreutils backup.sh uses are in /usr/bin).
#
# ── The timezone, pinned PER JOB and nowhere else ────────────────────────────────────────────────
# Audited 2026-09-26: this repository has NO host-timezone contract. `host-bootstrap.sh` never calls
# timedatectl and installs no tzdata policy, and no provisioning document states a zone — so the only
# answer to «when does 17 3 * * * run» was «whatever the image happened to boot with», which for the
# recommended Ubuntu EC2 host is UTC, i.e. 12:17 in Seoul.
#
# What the repository DOES have a contract about is the day itself: `Asia/Seoul`, in 41 backend files
# (`ResponsibilityWindows.ZONE`, the KST day keys the Home reads) and stated in
# `pilot_launch_readiness_v1.md` — «The date is Asia/Seoul and the server decides it». That contract is
# application-level and deliberately independent of the host clock (every one of those call sites names
# the zone explicitly), which is why a UTC host runs the product correctly and why this schedule was
# free to disagree with it unnoticed.
#
# So the job is pinned, and only the job: `timedatectl set-timezone` would move the whole host — its
# logs, its `date`, every container that inherits /etc/localtime — to make one cron line land at the
# right hour, which is a large change bought for a small reason.
#
# BOTH names are set on purpose. `CRON_TZ` is what Vixie-derived cron (Ubuntu's `cron` package, which
# host-bootstrap.sh targets) reads to decide WHEN to run; `TZ` is exported into the job's own
# environment, so `backup.sh`'s `date +%Y%m%d-%H%M` — which becomes the dump's filename and therefore
# the object key — agrees with the hour it ran at. With only the first, a 03:17 KST run would name its
# file 1817 of the previous day, and «which day is this backup from» would have two answers.
#
# Asia/Seoul has no daylight saving (`ResponsibilityWindows` relies on the same fact), so 03:17 is
# 03:17 every day of the year — there is no skipped or doubled run to reason about.
tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
cat > "$tmp" <<CRON
# reviewnary pilot — daily logical backup + off-host copy (blocker B5).
# Managed by deploy/pilot/install-backup-job.sh. Edit that script and re-run it, not this file.
# Contains no secret: it names the env FILE, and backup.sh sources it as root at run time.
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin
CRON_TZ=$CRON_TIMEZONE
TZ=$CRON_TIMEZONE
$SCHEDULE root PILOT_ENV_FILE=$ENV_FILE $BACKUP >> $LOG 2>&1
CRON

if [[ -f "$CRON_FILE" ]] && cmp -s "$tmp" "$CRON_FILE"; then
  printf 'unchanged: %s\n' "$CRON_FILE"
else
  # 0644 because cron refuses a file in /etc/cron.d that is group- or world-writable, and 0600 would
  # hide it from nothing — there is no secret in it to hide.
  install -m 0644 "$tmp" "$CRON_FILE"
  if [[ $EUID -eq 0 ]]; then chown root:root "$CRON_FILE"; fi
  printf 'installed: %s\n' "$CRON_FILE"
fi
rm -f "$tmp"; trap - EXIT

mode="$(stat -c '%a' "$CRON_FILE" 2>/dev/null || stat -f '%Lp' "$CRON_FILE")"
[[ "$mode" == "644" ]] || fail "$CRON_FILE is mode $mode — cron ignores a cron.d file that is not 0644"
grep -qF "PATH=/usr/local/bin:/usr/bin:/bin" "$CRON_FILE" || fail "$CRON_FILE lost its PATH line — cron would not find the aws cli"
grep -qF "CRON_TZ=$CRON_TIMEZONE" "$CRON_FILE" || fail "$CRON_FILE lost its CRON_TZ line — the schedule would run in the host's zone (UTC on the recommended image), i.e. midday in Seoul"
grep -qF "TZ=$CRON_TIMEZONE" "$CRON_FILE" || fail "$CRON_FILE lost its TZ line — the dump's filename would disagree with the hour it ran at"
grep -qF " root PILOT_ENV_FILE=$ENV_FILE $BACKUP " "$CRON_FILE" || fail "$CRON_FILE does not name the expected command"

printf '\ncron file (mode %s) — it names paths only, so it is printed in full:\n' "$mode"
sed 's/^/  /' "$CRON_FILE"
printf '\nschedule: %s %s — cron decides the hour from CRON_TZ; that it HONOURS it is a property of the
      host\x27s cron (Ubuntu\x27s vixie-derived package does) and is only observable on the first night.\n' \
  "$SCHEDULE" "$CRON_TIMEZONE"
printf '\nnext: nothing here proves an upload succeeds. Run deploy/pilot/backup.sh ONCE by hand after the
      bucket and the PutObject-only credential exist, and read its last line: `offhost=uploaded` with
      an etag is B5-2. Two consecutive nights of objects is B5-1. This script installed the schedule.\n'
