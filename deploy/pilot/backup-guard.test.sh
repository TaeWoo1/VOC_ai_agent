#!/usr/bin/env bash
# <b>Off-host backup is a precondition, not a preference (blocker B5).</b>
#   deploy/pilot/backup-guard.test.sh
#
# Three surfaces, one property: a pilot host that cannot copy its dumps off itself must not reach the
# point where it holds seller data. deploy.sh refuses to deploy one, preflight.sh scores it as a
# failure rather than a note, and install-backup-job.sh is what turns the nightly run from a line in
# a header comment into a file on the host.
#
# Like responsibility-guard.test.sh, the deploy cases are scored on what step 2 printed — `env: ok`
# (the last line of env validation, printed before anything is built) or the guard's own message —
# and the run is stopped at the first thing that would touch an image by a `docker` stub that refuses.
#
# PATH is built from scratch rather than prefixed. «aws is not installed» has to be true of the whole
# PATH for `command -v aws` to answer it, and a CI image that ships the AWS CLI would otherwise make
# the absence cases silently vacuous — they would pass for the wrong reason, which is the one kind of
# green this file must not produce.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
pass=0; fail=0
ok(){ printf '  ok   %s\n' "$1"; pass=$((pass+1)); }
no(){ printf '  FAIL %s\n     %s\n' "$1" "${2:-}"; fail=$((fail+1)); }

# ── a PATH with no aws on it, and everything these scripts actually call ─────────────────────────
mkdir -p "$WORK/pure" "$WORK/stub" "$WORK/awsbin"
for t in bash env git stat tr grep awk sed cmp install mktemp rm cat chmod chown uname dirname \
         basename head tail sort cut printf ls find date id du free ss; do
  p="$(command -v "$t" 2>/dev/null)" && ln -sf "$p" "$WORK/pure/$t"
done
# Refuses, rather than succeeds: a docker stub that exited 0 would let deploy.sh run on into the
# health loop and wait 300 seconds for a backend that does not exist. This file has no opinion about
# anything after step 2. The network stubs keep preflight's DNS/echo-IP probes off the wire entirely.
printf '#!/usr/bin/env bash\nexit 1\n'            > "$WORK/stub/docker"
printf '#!/usr/bin/env bash\nexit 1\n'            > "$WORK/stub/dig"
printf '#!/usr/bin/env bash\nexit 1\n'            > "$WORK/stub/curl"
printf '#!/usr/bin/env bash\nexit 1\n'            > "$WORK/stub/getent"
printf '#!/usr/bin/env bash\necho aws-cli/2.0.0\n' > "$WORK/awsbin/aws"
# systemd, faked just enough to be observed. The stub RECORDS its arguments, because «the installer
# enables the timer» is a claim about a call this test cannot otherwise see, and answers the two
# queries preflight asks. FAKE_TIMER_* let a case say «installed but disabled» without a real host.
cat > "$WORK/stub/systemctl" <<'SYSCTL'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${SYSTEMCTL_LOG:-/dev/null}"
case "$*" in
  "is-enabled sellerops-backup.timer")
    if [[ "${FAKE_TIMER_ENABLED:-1}" == 1 ]]; then echo enabled; exit 0; else echo disabled; exit 1; fi ;;
  "show sellerops-backup.timer -p LoadState --value")
    if [[ "${FAKE_TIMER_LOADED:-1}" == 1 ]]; then echo loaded; else echo not-found; fi; exit 0 ;;
esac
exit 0
SYSCTL
# Accepts the calendar this repository writes and rejects anything else, which is what a systemd too
# old for a timezone suffix would do.
cat > "$WORK/stub/systemd-analyze" <<'ANALYZE'
#!/usr/bin/env bash
[[ "$1" == calendar ]] || exit 0
[[ "$2" == "*-*-* 03:17:00 Asia/Seoul" ]] || exit 1
echo "Next elapse: Sat 2026-09-26 03:17:00 KST"
ANALYZE
chmod +x "$WORK"/stub/* "$WORK"/awsbin/*
NOAWS="$WORK/stub:$WORK/pure"
WITHAWS="$WORK/awsbin:$NOAWS"

SECRET='s3-secret-value-that-must-never-be-printed'
# A pilot env that passes every OTHER check, so a case varies only what it means to vary.
mkenv() { # mkenv <file> <extra lines...>
  local f="$1"; shift
  cat > "$f" <<ENV
PILOT_PUBLIC_HOST=pilot.example.com
PILOT_ACME_EMAIL=ops@example.com
POSTGRES_PASSWORD=not-a-real-password
SELLEROPS_JWT_SECRET=0123456789abcdef0123456789abcdef0123
SELLEROPS_AGENT_ACCESS_SCOPE=CONNECTED_SELLERS
$(printf '%s\n' "$@")
ENV
  chmod 600 "$f"
}
S3_ON=(
  'SELLEROPS_BACKUP_S3_ENABLED=true'
  'SELLEROPS_BACKUP_S3_BUCKET=reviewnary-pilot-backups'
  'SELLEROPS_BACKUP_S3_REGION=ap-northeast-2'
  'SELLEROPS_BACKUP_S3_ACCESS_KEY_ID=AKIAEXAMPLEEXAMPLE'
  "SELLEROPS_BACKUP_S3_SECRET_ACCESS_KEY=$SECRET"
)

deploy() { # deploy <PATH> <env-file>
  PATH="$1" PILOT_ENV_FILE="$2" "$HERE/deploy.sh" --no-pull --no-backup 2>&1
}
preflight() { # preflight <PATH> <env-file>
  PATH="$1" PILOT_ENV_FILE="$2" "$HERE/preflight.sh" 2>&1
}
has()    { case "$2" in *"$1"*) return 0;; *) return 1;; esac; }

echo "A. deploy.sh — a host without an off-host copy is not deployed"

# A1. The blocker itself. This used to print a note and deploy.
mkenv "$WORK/off.env"
out="$(deploy "$WITHAWS" "$WORK/off.env")"
has 'SELLEROPS_BACKUP_S3_ENABLED is not true' "$out" && ok "S3 off → refused" || no "S3 off → refused" "guard message absent"
has 'env: ok' "$out" && no "S3 off → stops IN step 2" "env validation reported ok" || ok "S3 off → stops IN step 2"

# A2. The posture a pilot host is supposed to be in.
mkenv "$WORK/on.env" "${S3_ON[@]}"
out="$(deploy "$WITHAWS" "$WORK/on.env")"
has 'env: ok' "$out" && ok "S3 on + four names + aws → passes env validation" || no "S3 on + four names + aws → passes env validation" "$(printf '%s' "$out" | tail -2)"
has 'off-host backup: enabled' "$out" && ok "S3 on → says so without printing a value" || no "S3 on → says so without printing a value" "confirmation line absent"

# A3. The uploader. Same failure as A1, one layer down and one night later.
out="$(deploy "$NOAWS" "$WORK/on.env")"
has 'aws cli is not installed' "$out" && ok "aws missing → refused" || no "aws missing → refused" "guard message absent"
has 'env: ok' "$out" && no "aws missing → stops IN step 2" "env validation reported ok" || ok "aws missing → stops IN step 2"

# A4. Half-configured is not configured — and the report names the NAME.
mkenv "$WORK/partial.env" 'SELLEROPS_BACKUP_S3_ENABLED=true' 'SELLEROPS_BACKUP_S3_BUCKET=b' 'SELLEROPS_BACKUP_S3_REGION=r'
out="$(deploy "$WITHAWS" "$WORK/partial.env")"
has 'SELLEROPS_BACKUP_S3_ACCESS_KEY_ID' "$out" && has 'SELLEROPS_BACKUP_S3_SECRET_ACCESS_KEY' "$out" \
  && ok "S3 on with blanks → refused, naming the blank names" || no "S3 on with blanks → refused, naming the blank names" "names absent"

# A5. A plain-HTTP endpoint carries sealed credentials and seller data over the wire.
mkenv "$WORK/http.env" "${S3_ON[@]}" 'SELLEROPS_BACKUP_S3_ENDPOINT=http://minio.example.com'
out="$(deploy "$WITHAWS" "$WORK/http.env")"
has 'must be an absolute HTTPS URL' "$out" && ok "non-HTTPS endpoint → refused" || no "non-HTTPS endpoint → refused" "guard message absent"

# A6. The rule every script in this directory keeps: names, never values.
out="$(deploy "$WITHAWS" "$WORK/on.env"; deploy "$WITHAWS" "$WORK/partial.env")"
has "$SECRET" "$out" && no "no secret value is ever printed" "the secret appeared in deploy output" || ok "no secret value is ever printed"

echo
echo "B. preflight.sh — the same facts, scored as failures"

mkdir -p "$WORK/backups" "$WORK/units-empty" "$WORK/cron"
out="$(PILOT_BACKUP_DIR="$WORK/backups" PILOT_SYSTEMD_DIR="$WORK/units-empty" PILOT_CRON_DIR="$WORK/cron" preflight "$WITHAWS" "$WORK/off.env")"
has 'FAIL  SELLEROPS_BACKUP_S3_ENABLED is not true' "$out" && ok "S3 off → bad (was a note)" || no "S3 off → bad (was a note)" "not scored as a failure"
out="$(PILOT_BACKUP_DIR="$WORK/backups" PILOT_SYSTEMD_DIR="$WORK/units-empty" PILOT_CRON_DIR="$WORK/cron" preflight "$NOAWS" "$WORK/on.env")"
has 'FAIL  the aws cli is not installed' "$out" && ok "aws missing → bad" || no "aws missing → bad" "not scored as a failure"
out="$(PILOT_BACKUP_DIR="$WORK/backups" PILOT_SYSTEMD_DIR="$WORK/units-empty" PILOT_CRON_DIR="$WORK/cron" preflight "$WITHAWS" "$WORK/on.env")"
has 'aws cli present' "$out" && ok "aws present → ok" || no "aws present → ok" "not scored as a pass"
has 'FAIL  SELLEROPS_BACKUP_S3_ENABLED' "$out" && no "S3 on → no S3 failure line" "fired anyway" || ok "S3 on → no S3 failure line"
# The schedule is what makes the nightly run exist; this host has no units, and that is a failure.
has 'FAIL  sellerops-backup.service/.timer are NOT installed' "$out" && ok "no timer units → bad" || no "no timer units → bad" "not scored as a failure"
has "$SECRET" "$out" && no "preflight prints no secret value" "the secret appeared" || ok "preflight prints no secret value"

echo
echo "C. install-backup-job.sh — the schedule, and nothing else"

ENVF="$WORK/cronenv/pilot.env"; mkdir -p "$WORK/cronenv" "$WORK/units" "$WORK/bdir" "$WORK/legacy"
mkenv "$ENVF" "${S3_ON[@]}"
SVC="$WORK/units/sellerops-backup.service"
TMR="$WORK/units/sellerops-backup.timer"
SYSLOG="$WORK/systemctl.log"
install_job() { # install_job <PATH> [args...]
  local p="$1"; shift
  PATH="$p" PILOT_ENV_FILE="$ENVF" PILOT_SYSTEMD_DIR="$WORK/units" PILOT_CRON_DIR="$WORK/legacy" \
    PILOT_BACKUP_DIR="$WORK/bdir" SYSTEMCTL_LOG="$SYSLOG" \
    "$HERE/install-backup-job.sh" "$@" 2>&1
}

: > "$SYSLOG"
out="$(install_job "$WITHAWS")"
[[ -f "$SVC" && -f "$TMR" ]] && ok "installs both units" || no "installs both units" "$out"
for f in "$SVC" "$TMR"; do
  mode="$(stat -c '%a' "$f" 2>/dev/null || stat -f '%Lp' "$f" 2>/dev/null)"
  [[ "$mode" == "644" ]] && ok "$(basename "$f") is mode 0644" || no "$(basename "$f") is mode 0644" "is $mode"
done
svc="$(cat "$SVC" 2>/dev/null)"; tmr="$(cat "$TMR" 2>/dev/null)"

# The whole reason this is a timer and not a cron file: the zone is IN the calendar, so the hour does
# not depend on what the host booted with. Ubuntu 24.04's default cron cannot be relied on for this.
has 'OnCalendar=*-*-* 03:17:00 Asia/Seoul' "$tmr" && ok "timer fires at 03:17 Asia/Seoul, zone named in the unit" || no "timer OnCalendar is the KST contract" "$tmr"
has 'Persistent=true' "$tmr" && ok "Persistent=true — a night the host was off is made up, not skipped" || no "Persistent=true" "$tmr"
has 'WantedBy=timers.target' "$tmr" && ok "timer is installable into timers.target" || no "timer is installable" "$tmr"
# TZ decides what backup.sh's own `date` prints, and that string becomes the dump filename and the
# object key. Without it a 03:17 KST run names its file 1817 of the previous day on a UTC host.
has 'Environment=TZ=Asia/Seoul' "$svc" && ok "service clock is Asia/Seoul (the dump filename)" || no "service TZ" "$svc"
has 'Environment=PATH=/usr/local/bin:/usr/bin:/bin' "$svc" && ok "service PATH carries /usr/local/bin (AWS CLI v2's shim)" || no "service PATH" "$svc"
has "Environment=PILOT_ENV_FILE=$ENVF" "$svc" && ok "service names the env FILE, outside the checkout" || no "service names the env file" "$svc"
has "ExecStart=$REPO/deploy/pilot/backup.sh" "$svc" && ok "ExecStart is the repository's canonical backup.sh" || no "ExecStart is canonical backup.sh" "$svc"
has "WorkingDirectory=$REPO" "$svc" && ok "runs in the checkout (docker compose derives its project name from it)" || no "WorkingDirectory is the checkout" "$svc"
has "append:/var/log/sellerops-backup.log" "$svc" && ok "keeps backup.sh's documented log path" || no "keeps the log contract" "$svc"
has "$SECRET" "$svc$tmr$out" && no "no secret value in the units or the output" "the secret appeared" || ok "no secret value in the units or the output"
# «Installed» is not «scheduled»: a unit nothing enables never fires.
has 'daemon-reload' "$(cat "$SYSLOG")" && ok "runs systemctl daemon-reload" || no "runs systemctl daemon-reload" "$(cat "$SYSLOG")"
has 'enable --now sellerops-backup.timer' "$(cat "$SYSLOG")" && ok "runs systemctl enable --now on the timer" || no "runs systemctl enable --now" "$(cat "$SYSLOG")"
has 'parses on this host' "$out" && ok "validates the calendar with systemd-analyze before installing" || no "validates the calendar before installing" "$out"

: > "$SYSLOG"
out="$(install_job "$WITHAWS")"
has 'unchanged' "$out" && ok "second run is idempotent (says unchanged)" || no "second run is idempotent" "$out"
[[ "$(cat "$SVC")" == "$svc" && "$(cat "$TMR")" == "$tmr" ]] && ok "second run leaves both units byte-identical" || no "second run leaves both units byte-identical" "content moved"
has 'enable --now sellerops-backup.timer' "$(cat "$SYSLOG")" && ok "second run still enables (an installed-but-disabled timer is the state this ends)" || no "second run still enables" "$(cat "$SYSLOG")"

# A host that ran the cron version of this script would otherwise get TWO nightly dumps of the same
# database — and the cron one at the wrong hour, which is why it is being replaced.
printf 'x\n' > "$WORK/legacy/sellerops-backup"
out="$(install_job "$WITHAWS")"; rc=$?
[[ $rc -ne 0 ]] && has 'still exists' "$out" && ok "legacy cron file present → refuses to add a second schedule" || no "legacy cron file present → refuses" "rc=$rc $out"
[[ -f "$WORK/legacy/sellerops-backup" ]] && ok "and does not delete it — that is the operator's one command" || no "and does not delete it" "the script removed a file"
rm -f "$WORK/legacy/sellerops-backup"

# There is no uninstall. An unknown flag is read as a repo path and refused, and the schedule survives.
out="$(install_job "$WITHAWS" --uninstall)"; rc=$?
[[ $rc -ne 0 ]] && [[ -f "$TMR" ]] && ok "--uninstall is not a feature and removes nothing" || no "--uninstall is not a feature and removes nothing" "rc=$rc"

out="$(install_job "$NOAWS")"
has 'aws cli is not installed' "$out" && ok "aws missing → refuses to install a job that cannot upload" || no "aws missing → refuses" "$out"

out="$(install_job "$WITHAWS" "$WORK/not-a-repo")"
has 'not a directory' "$out" && ok "bad repo path → refused" || no "bad repo path → refused" "$out"

out="$(install_job "$WITHAWS" "$WORK")"
has 'not found' "$out" && ok "a directory that is not this checkout → refused" || no "a directory that is not this checkout → refused" "$out"

base=(PATH="$WITHAWS" PILOT_SYSTEMD_DIR="$WORK/units" PILOT_CRON_DIR="$WORK/legacy" PILOT_BACKUP_DIR="$WORK/bdir")
out="$(env "${base[@]}" PILOT_ENV_FILE="$WORK/nope.env" "$HERE/install-backup-job.sh" 2>&1)"
has 'not found' "$out" && ok "missing env file → refused" || no "missing env file → refused" "$out"

inside="$REPO/.pilot-env-inside-checkout.tmp"; mkenv "$inside" "${S3_ON[@]}"
out="$(env "${base[@]}" PILOT_ENV_FILE="$inside" "$HERE/install-backup-job.sh" 2>&1)"; rm -f "$inside"
has 'inside the repository' "$out" && ok "env inside the checkout → refused (one git add away)" || no "env inside the checkout → refused" "$out"

loose="$WORK/cronenv/loose.env"; mkenv "$loose" "${S3_ON[@]}"; chmod 644 "$loose"
out="$(env "${base[@]}" PILOT_ENV_FILE="$loose" "$HERE/install-backup-job.sh" 2>&1)"
has 'must be mode 0600' "$out" && ok "world-readable env → refused" || no "world-readable env → refused" "$out"

out="$(env "${base[@]}" PILOT_ENV_FILE="$ENVF" PILOT_SYSTEMD_DIR="$WORK/no-such-unit-dir" "$HERE/install-backup-job.sh" 2>&1)"
has 'does not exist' "$out" && ok "no unit directory → refused" || no "no unit directory → refused" "$out"

out="$(env "${base[@]}" PILOT_ENV_FILE="$ENVF" PILOT_BACKUP_DIR="$WORK/no-such-backup-dir" "$HERE/install-backup-job.sh" 2>&1)"
has 'backup directory' "$out" && ok "no backup directory → refused" || no "no backup directory → refused" "$out"

out="$(PATH="$WORK/awsbin:$WORK/pure" PILOT_ENV_FILE="$ENVF" PILOT_SYSTEMD_DIR="$WORK/units" PILOT_CRON_DIR="$WORK/legacy" PILOT_BACKUP_DIR="$WORK/bdir" "$HERE/install-backup-job.sh" 2>&1)"
has 'systemctl not found' "$out" && ok "no systemd → refused (the pilot host contract is Ubuntu 24.04)" || no "no systemd → refused" "$out"

# The claim this script is careful NOT to make.
grep -q -- '--local-only' "$HERE/install-backup-job.sh" && \
  { grep -q 'would exit 0 here without' "$HERE/install-backup-job.sh" && ok "never runs backup.sh to claim a verified off-host copy" || no "never runs backup.sh to claim a verified off-host copy" "--local-only appears outside the explanation"; } \
  || no "never runs backup.sh to claim a verified off-host copy" "the explanation went missing"
# And the mechanism it is no longer allowed to USE. CRON_TZ still appears in this file — in the
# paragraph explaining why it was withdrawn — so the assertion is about code, not about the word: no
# line that is not a comment may mention it. A guard that fires on its own explanation is a guard
# somebody deletes.
[[ -z "$(grep -n 'CRON_TZ' "$HERE/install-backup-job.sh" | grep -v '^[0-9]*:#')" ]] \
  && ok "CRON_TZ survives only as the note explaining why it was withdrawn" \
  || no "CRON_TZ survives only as a note" "a non-comment line still schedules with CRON_TZ"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]
