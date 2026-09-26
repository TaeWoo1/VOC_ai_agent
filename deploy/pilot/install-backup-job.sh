#!/usr/bin/env bash
# Daily backup schedule — Pilot Provisioning Plan v1 §2-E step 15, blocker B5 item B5-1.
#
#   deploy/pilot/install-backup-job.sh                       # repo = this checkout
#   deploy/pilot/install-backup-job.sh /opt/sellerops/repo   # repo = an explicit path
#   PILOT_ENV_FILE=/etc/sellerops/pilot.env deploy/pilot/install-backup-job.sh
#
# Installs two unit files — sellerops-backup.service and sellerops-backup.timer — and enables the
# timer. Nothing else on the host is touched, no cloud resource is created, and no value from the env
# file is read, printed or copied: the unit names the FILE, and backup.sh sources it as root at 03:17,
# which is the only place those secrets ever need to be.
#
# ── WHY systemd AND NOT cron (2026-09-26, external verification) ─────────────────────────────────
# The first version of this script wrote /etc/cron.d/sellerops-backup with `CRON_TZ=Asia/Seoul`.
# That is withdrawn: **per-job timezone scheduling cannot be relied on in Ubuntu 24.04's default
# cron.** The failure mode is the bad kind — the file parses, the job runs, and it runs at the wrong
# hour, which is indistinguishable from working until someone compares a dump's name with the clock.
#
# systemd's timer has the zone in the calendar expression itself: systemd.time(7) documents that a
# calendar specification may carry a timezone in IANA form, and that this applies to `OnCalendar=` in
# timer units. **The version that introduced it is deliberately not asserted here** — a first draft of
# this comment claimed «since v252», and checking v252's own NEWS showed no such entry, which is the
# same shape of unverified confidence that put the cron version of this file on the host. So nothing
# downstream rests on a version claim: `systemd-analyze calendar` resolves the expression on THIS host
# before anything is installed, and a host that cannot parse it stops the install. The requirement was
# never «use cron» — it was «run at 03:17 in Seoul on a host whose own zone this repository does not
# set», and this is the mechanism that can state that in one line and prove it parses.
#
# `Persistent=true` adds what cron never had: a run missed because the host was off fires once at the
# next boot, rather than being silently skipped on exactly the days a host had trouble.
#
# ── WHAT IS EASY TO GET WRONG BY HAND, and why this is a script ──────────────────────────────────
#   * PATH. A systemd service starts with a minimal environment. AWS CLI v2 installs its shim in
#     **/usr/local/bin**, so without the PATH below every nightly run ends at
#     `reason=aws-cli-not-installed` with a local dump written and no off-host copy — the exact state
#     B5 exists to forbid.
#   * The env file. backup.sh defaults to /etc/sellerops/pilot.env; a host whose env lives elsewhere
#     needs PILOT_ENV_FILE **in the unit**, because a unit inherits nothing from a login shell.
#   * TZ. The calendar decides WHEN; `TZ=Asia/Seoul` in the service decides what `date +%Y%m%d-%H%M`
#     inside backup.sh prints — and that string becomes the dump's filename and the object key. With
#     only the first, a 03:17 KST run names its file 1817 of the previous day on a UTC host, and
#     «which day is this backup from» has two answers.
#
# ── WHAT THIS SCRIPT DOES NOT DO, deliberately ───────────────────────────────────────────────────
#   * It never removes anything. There is no --uninstall, and no code path here deletes a unit, a
#     cron file, a dump or a remote object — including the legacy cron file this script's own earlier
#     version wrote. That one is REFUSED rather than removed: see the duplicate-schedule check below.
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
# Seams for this script's own tests and for a host that puts units elsewhere. The unit NAMES are not
# knobs: one schedule, one name, so a second run replaces the first rather than adding a second
# nightly dump nobody remembers installing.
UNIT_DIR="${PILOT_SYSTEMD_DIR:-/etc/systemd/system}"
LEGACY_CRON="${PILOT_CRON_DIR:-/etc/cron.d}/sellerops-backup"
SERVICE="$UNIT_DIR/sellerops-backup.service"
TIMER="$UNIT_DIR/sellerops-backup.timer"
# Fixed on purpose: backup.sh's header documents this exact log path and the runbook quotes it.
LOG="/var/log/sellerops-backup.log"
ON_CALENDAR="*-*-* 03:17:00 Asia/Seoul"
TIMEZONE="Asia/Seoul"

[[ -d "$REPO_IN" ]] || fail "repo path is not a directory: $REPO_IN"
REPO="$(cd "$REPO_IN" && pwd)"
BACKUP="$REPO/deploy/pilot/backup.sh"
[[ -f "$BACKUP" ]] || fail "$BACKUP not found — is $REPO this repository's checkout?"
[[ -x "$BACKUP" ]] || fail "$BACKUP is not executable (chmod +x) — the unit would fail to start every night"

[[ -f "$ENV_FILE" ]] || fail "$ENV_FILE not found (copy deploy/pilot/pilot.env.example, mode 0600) — the unit cannot source a file that is not there"
# The same rule deploy.sh enforces, for the same reason: a pilot secret must never be one `git add`
# away, and a unit pointing INTO the checkout would survive a `git clean` only by luck.
case "$ENV_FILE" in "$REPO"/*) fail "$ENV_FILE is inside the repository — keep the pilot env outside the checkout";; esac
perm="$(stat -c '%a' "$ENV_FILE" 2>/dev/null || stat -f '%Lp' "$ENV_FILE")"
[[ "$perm" == "600" || "$perm" == "400" ]] || fail "$ENV_FILE must be mode 0600 (is $perm) — it holds the S3 credential this job will use"

command -v aws >/dev/null 2>&1 || fail "the aws cli is not installed — the nightly run would write a local dump and fail the off-host upload (deploy/pilot/host-bootstrap.sh installs AWS CLI v2)"
[[ -d "$BACKUP_DIR" ]] || fail "backup directory $BACKUP_DIR does not exist (deploy/pilot/host-bootstrap.sh creates it 0700)"
[[ -d "$(dirname "$LOG")" ]] || fail "$(dirname "$LOG") does not exist — the unit cannot append the backup log"
command -v systemctl >/dev/null 2>&1 || fail "systemctl not found — the pilot host contract is Ubuntu 24.04 with systemd (docs/pilot_host_provisioning_v1.md §3)"
[[ -d "$UNIT_DIR" ]] || fail "$UNIT_DIR does not exist"
[[ -w "$UNIT_DIR" ]] || fail "$UNIT_DIR is not writable (run as root)"

# ── duplicate schedule: refuse, never remove ─────────────────────────────────────────────────────
# An earlier version of this script installed /etc/cron.d/sellerops-backup. Leaving it in place while
# enabling the timer gives the host TWO nightly dumps of the same database — and the cron one runs at
# the wrong hour, which is why it is being replaced. Deleting it automatically is the other way to be
# wrong: this file has no delete path by design, that path would have to special-case «a file we
# recognise» from «a file an operator wrote», and a script that can remove a backup schedule is a
# script that can remove a backup schedule. So it stops here and names the one command to run.
if [[ -e "$LEGACY_CRON" ]]; then fail "$LEGACY_CRON still exists — installing the timer beside it would schedule TWO nightly dumps of the same database. Remove that ONE file yourself (rm $LEGACY_CRON) and run this again; this script does not delete anything."
fi

# ── the calendar expression is validated before it is installed ──────────────────────────────────
# `systemd-analyze calendar` resolves the expression, zone included, and prints the next elapse. This
# is the check that replaces knowing a version number: a systemd too old for a timezone suffix says so
# HERE, rather than accepting a timer that never fires at the hour it claims.
if command -v systemd-analyze >/dev/null 2>&1; then
  systemd-analyze calendar "$ON_CALENDAR" >/dev/null 2>&1 \
    || fail "this host's systemd cannot parse '$ON_CALENDAR' — its version does not support a timezone in a calendar expression, and a schedule that silently falls back to the host's own zone is the defect this replaced"
  printf 'calendar: %s parses on this host\n' "$ON_CALENDAR"
else
  printf 'calendar: systemd-analyze not available — %s is installed unvalidated\n' "$ON_CALENDAR"
fi

for p in "$REPO" "$ENV_FILE"; do
  case "$p" in *[[:space:]]*) fail "path contains whitespace, which a unit's Environment= line reads as a separator: $p" ;; esac
done

svc_tmp="$(mktemp)"; tmr_tmp="$(mktemp)"; trap 'rm -f "$svc_tmp" "$tmr_tmp"' EXIT
# WorkingDirectory is the repo because `docker compose -f <abs>` derives its PROJECT NAME from the
# project directory, and a unit started from / could resolve a different project than the stack
# deploy.sh brought up — `exec -T postgres` would then fail against a project that has no containers.
# backup.sh itself needs no particular cwd (it resolves everything from BASH_SOURCE), so this pins a
# behaviour of docker compose rather than one of ours.
cat > "$svc_tmp" <<UNIT
# reviewnary pilot — daily logical backup + off-host copy (blocker B5).
# Managed by deploy/pilot/install-backup-job.sh. Edit that script and re-run it, not this file.
# Contains no secret: it names the env FILE, and backup.sh sources it as root at run time.
[Unit]
Description=Reviewnary PostgreSQL off-host backup

[Service]
Type=oneshot
Environment=TZ=$TIMEZONE
Environment=PILOT_ENV_FILE=$ENV_FILE
Environment=PATH=/usr/local/bin:/usr/bin:/bin
WorkingDirectory=$REPO
ExecStart=$BACKUP
StandardOutput=append:$LOG
StandardError=append:$LOG
UNIT

cat > "$tmr_tmp" <<UNIT
# reviewnary pilot — 03:17 Asia/Seoul, whatever this host's own timezone is.
# Managed by deploy/pilot/install-backup-job.sh. Edit that script and re-run it, not this file.
[Unit]
Description=Reviewnary PostgreSQL off-host backup timer

[Timer]
OnCalendar=$ON_CALENDAR
Persistent=true

[Install]
WantedBy=timers.target
UNIT

changed=0
for pair in "$svc_tmp:$SERVICE" "$tmr_tmp:$TIMER"; do
  src="${pair%%:*}"; dst="${pair#*:}"
  if [[ -f "$dst" ]] && cmp -s "$src" "$dst"; then
    printf 'unchanged: %s\n' "$dst"
  else
    # install(1) writes to a temporary name and renames, so a reader never sees a half-written unit.
    install -m 0644 "$src" "$dst"
    if [[ $EUID -eq 0 ]]; then chown root:root "$dst"; fi
    printf 'installed: %s\n' "$dst"
    changed=1
  fi
done
rm -f "$svc_tmp" "$tmr_tmp"; trap - EXIT

for f in "$SERVICE" "$TIMER"; do
  mode="$(stat -c '%a' "$f" 2>/dev/null || stat -f '%Lp' "$f")"
  [[ "$mode" == "644" ]] || fail "$f is mode $mode — a unit file must be world-readable and not writable by anyone else"
done
grep -qF "OnCalendar=$ON_CALENDAR" "$TIMER" || fail "$TIMER lost its OnCalendar line"
grep -qF "Persistent=true" "$TIMER"          || fail "$TIMER lost Persistent=true — a run missed while the host was off would be skipped silently"
grep -qF "Environment=TZ=$TIMEZONE" "$SERVICE" || fail "$SERVICE lost TZ — the dump's filename would disagree with the hour it ran at"
grep -qF "Environment=PATH=/usr/local/bin:" "$SERVICE" || fail "$SERVICE lost its PATH — the unit would not find the aws cli"
grep -qF "ExecStart=$BACKUP" "$SERVICE"      || fail "$SERVICE does not start the expected script"

# Both are idempotent, so they run whether or not a file moved: a host whose units were already
# correct but whose timer was never enabled is exactly the state this is here to end.
systemctl daemon-reload
systemctl enable --now sellerops-backup.timer

printf '\nunits (mode 0644) — they name paths only, so they are printed in full:\n'
sed 's/^/  /' "$SERVICE"; printf '\n'; sed 's/^/  /' "$TIMER"
printf '\nschedule: %s. Observe the next firing with:  systemctl list-timers sellerops-backup.timer\n' "$ON_CALENDAR"
[[ "$changed" -eq 1 ]] || printf 'nothing moved: the units were already exactly this.\n'
printf '\nnext: nothing here proves an upload succeeds. Run deploy/pilot/backup.sh ONCE by hand after the
      bucket and the PutObject-only credential exist, and read its last line: `offhost=uploaded` with
      an etag is B5-2. Two consecutive nights of objects is B5-1. This script installed the schedule.\n'
