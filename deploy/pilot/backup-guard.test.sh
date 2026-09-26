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

mkdir -p "$WORK/backups"
out="$(PILOT_BACKUP_DIR="$WORK/backups" preflight "$WITHAWS" "$WORK/off.env")"
has 'FAIL  SELLEROPS_BACKUP_S3_ENABLED is not true' "$out" && ok "S3 off → bad (was a note)" || no "S3 off → bad (was a note)" "not scored as a failure"
out="$(PILOT_BACKUP_DIR="$WORK/backups" preflight "$NOAWS" "$WORK/on.env")"
has 'FAIL  the aws cli is not installed' "$out" && ok "aws missing → bad" || no "aws missing → bad" "not scored as a failure"
out="$(PILOT_BACKUP_DIR="$WORK/backups" preflight "$WITHAWS" "$WORK/on.env")"
has 'aws cli present' "$out" && ok "aws present → ok" || no "aws present → ok" "not scored as a pass"
has 'FAIL  SELLEROPS_BACKUP_S3_ENABLED' "$out" && no "S3 on → no S3 failure line" "fired anyway" || ok "S3 on → no S3 failure line"
# The cron file is what makes the nightly run exist; this host has none, and that is a failure now.
has 'FAIL  daily backup cron is NOT installed' "$out" && ok "no cron → bad (was a note)" || no "no cron → bad (was a note)" "not scored as a failure"
has "$SECRET" "$out" && no "preflight prints no secret value" "the secret appeared" || ok "preflight prints no secret value"

echo
echo "C. install-backup-job.sh — the schedule, and nothing else"

ENVF="$WORK/cronenv/pilot.env"; mkdir -p "$WORK/cronenv" "$WORK/cron" "$WORK/bdir"
mkenv "$ENVF" "${S3_ON[@]}"
CRONF="$WORK/cron/sellerops-backup"
install_job() { # install_job <PATH> [args...]
  local p="$1"; shift
  PATH="$p" PILOT_ENV_FILE="$ENVF" PILOT_CRON_DIR="$WORK/cron" PILOT_BACKUP_DIR="$WORK/bdir" \
    "$HERE/install-backup-job.sh" "$@" 2>&1
}

out="$(install_job "$WITHAWS")"
[[ -f "$CRONF" ]] && ok "installs $CRONF" || no "installs $CRONF" "$out"
mode="$(stat -c '%a' "$CRONF" 2>/dev/null || stat -f '%Lp' "$CRONF" 2>/dev/null)"
[[ "$mode" == "644" ]] && ok "mode 0644 (cron ignores anything else in cron.d)" || no "mode 0644" "is $mode"
body="$(cat "$CRONF" 2>/dev/null)"
has "PATH=/usr/local/bin:/usr/bin:/bin" "$body" && ok "carries the PATH line (AWS CLI v2 lives in /usr/local/bin)" || no "carries the PATH line" "cron's default PATH would find no aws"
has "$REPO/deploy/pilot/backup.sh" "$body" && ok "command is the repository's canonical backup.sh" || no "command is the repository's canonical backup.sh" "$body"
has "PILOT_ENV_FILE=$ENVF" "$body" && ok "names the pilot env file outside the checkout" || no "names the pilot env file" "$body"
has ">> /var/log/sellerops-backup.log 2>&1" "$body" && ok "keeps backup.sh's documented log contract" || no "keeps the log contract" "$body"
# The timezone contract, literally. `17 3 * * *` on its own is a time in whatever zone the host booted
# with — UTC on the recommended image, i.e. 12:17 in Seoul — and this repository has no host-timezone
# contract to appeal to (audited 2026-09-26). CRON_TZ decides WHEN; TZ makes backup.sh's own `date`,
# which becomes the dump filename and the object key, agree with the hour it ran at.
has "CRON_TZ=Asia/Seoul" "$body" && ok "pins the SCHEDULE to Asia/Seoul (CRON_TZ)" || no "pins the schedule to Asia/Seoul" "$body"
has "TZ=Asia/Seoul" "$body" && ok "pins the JOB's own clock to Asia/Seoul (TZ) — the dump filename" || no "pins the job's clock to Asia/Seoul" "$body"
has "17 3 * * * root" "$body" && ok "schedule is 03:17, now in a named zone" || no "schedule is 03:17" "$body"
has "$SECRET" "$body$out" && no "no secret value in the cron file or the output" "the secret appeared" || ok "no secret value in the cron file or the output"

out="$(install_job "$WITHAWS")"
has 'unchanged' "$out" && ok "second run is idempotent (says unchanged)" || no "second run is idempotent" "$out"
[[ "$(cat "$CRONF")" == "$body" ]] && ok "second run leaves the file byte-identical" || no "second run leaves the file byte-identical" "content moved"

# There is no uninstall. An unknown flag is read as a repo path and refused, and the schedule survives.
out="$(install_job "$WITHAWS" --uninstall)"; rc=$?
[[ $rc -ne 0 ]] && [[ -f "$CRONF" ]] && ok "--uninstall is not a feature and removes nothing" || no "--uninstall is not a feature and removes nothing" "rc=$rc file=$( [[ -f $CRONF ]] && echo kept || echo GONE)"

out="$(install_job "$NOAWS")"
has 'aws cli is not installed' "$out" && ok "aws missing → refuses to install a job that cannot upload" || no "aws missing → refuses" "$out"

out="$(install_job "$WITHAWS" "$WORK/not-a-repo")"
has 'not a directory' "$out" && ok "bad repo path → refused" || no "bad repo path → refused" "$out"

out="$(install_job "$WITHAWS" "$WORK")"
has 'not found' "$out" && ok "a directory that is not this checkout → refused" || no "a directory that is not this checkout → refused" "$out"

missing="$WORK/nope.env"
out="$(PATH="$WITHAWS" PILOT_ENV_FILE="$missing" PILOT_CRON_DIR="$WORK/cron" PILOT_BACKUP_DIR="$WORK/bdir" "$HERE/install-backup-job.sh" 2>&1)"
has 'not found' "$out" && ok "missing env file → refused" || no "missing env file → refused" "$out"

inside="$REPO/.pilot-env-inside-checkout.tmp"; mkenv "$inside" "${S3_ON[@]}"
out="$(PATH="$WITHAWS" PILOT_ENV_FILE="$inside" PILOT_CRON_DIR="$WORK/cron" PILOT_BACKUP_DIR="$WORK/bdir" "$HERE/install-backup-job.sh" 2>&1)"
rm -f "$inside"
has 'inside the repository' "$out" && ok "env inside the checkout → refused (one git add away)" || no "env inside the checkout → refused" "$out"

loose="$WORK/cronenv/loose.env"; mkenv "$loose" "${S3_ON[@]}"; chmod 644 "$loose"
out="$(PATH="$WITHAWS" PILOT_ENV_FILE="$loose" PILOT_CRON_DIR="$WORK/cron" PILOT_BACKUP_DIR="$WORK/bdir" "$HERE/install-backup-job.sh" 2>&1)"
has 'must be mode 0600' "$out" && ok "world-readable env → refused" || no "world-readable env → refused" "$out"

# In a crontab an unescaped % becomes a newline: everything after it stops being the command.
pcdir="$WORK/pct%dir"; mkdir -p "$pcdir"; pcenv="$pcdir/pilot.env"; mkenv "$pcenv" "${S3_ON[@]}"
out="$(PATH="$WITHAWS" PILOT_ENV_FILE="$pcenv" PILOT_CRON_DIR="$WORK/cron" PILOT_BACKUP_DIR="$WORK/bdir" "$HERE/install-backup-job.sh" 2>&1)"
has "contains '%'" "$out" && ok "a % in a path → refused (cron would turn it into a newline)" || no "a % in a path → refused" "$out"

out="$(PATH="$WITHAWS" PILOT_ENV_FILE="$ENVF" PILOT_CRON_DIR="$WORK/no-such-cron-dir" PILOT_BACKUP_DIR="$WORK/bdir" "$HERE/install-backup-job.sh" 2>&1)"
has 'does not exist' "$out" && ok "no cron directory → refused" || no "no cron directory → refused" "$out"

out="$(PATH="$WITHAWS" PILOT_ENV_FILE="$ENVF" PILOT_CRON_DIR="$WORK/cron" PILOT_BACKUP_DIR="$WORK/no-such-backup-dir" "$HERE/install-backup-job.sh" 2>&1)"
has 'backup directory' "$out" && ok "no backup directory → refused" || no "no backup directory → refused" "$out"

# The claim this script is careful NOT to make.
grep -q -- '--local-only' "$HERE/install-backup-job.sh" && \
  { grep -q 'would exit 0 here without' "$HERE/install-backup-job.sh" && ok "never runs backup.sh to claim a verified off-host copy" || no "never runs backup.sh to claim a verified off-host copy" "--local-only appears outside the explanation"; } \
  || no "never runs backup.sh to claim a verified off-host copy" "the explanation went missing"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]
