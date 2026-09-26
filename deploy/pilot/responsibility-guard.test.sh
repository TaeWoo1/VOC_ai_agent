#!/usr/bin/env bash
# <b>고객 운영 관리: the job is open for a seller, but nothing runs it.</b>
#   deploy/pilot/responsibility-guard.test.sh
#
# The gap this pins is not a crash and not a missing value — every switch involved is doing exactly
# what it was set to do. RESPONSIBILITY_RUNTIME_ORG_IDS makes the job visible and startable for an
# organisation; SELLEROPS_RESPONSIBILITY_SCHEDULER_ENABLED is the only thing that ever works one of
# its windows. Set the first without the second and the seller presses 「자동 확인 시작」, reads
# 「자동 확인 중」, and waits for a check that no code path will ever run.
#
# The property under test is the ENV VALIDATION STEP of deploy.sh, so every case is scored on what
# step 2 printed: `env: ok` (the last line of the step, printed before anything is built) or the
# guard's own message. Nothing is deployed, and the run is stopped on purpose at the first thing that
# would touch an image: `docker` is a stub on PATH that refuses, so step 4's `build --pull` ends the
# script under `set -e` a line after the verdict we are reading. --no-pull and --no-backup keep git
# and the database out of it too.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
pass=0; fail=0
ok(){ printf '  ok   %s\n' "$1"; pass=$((pass+1)); }
no(){ printf '  FAIL %s\n     %s\n' "$1" "${2:-}"; fail=$((fail+1)); }

# The env file must live OUTSIDE the checkout — deploy.sh refuses one inside it, and that refusal is
# itself a rule worth not tripping over here. mktemp is outside by construction.
mkdir -p "$WORK/bin"
# Exits 1, not 0: a stub that SUCCEEDS would let the script run on into the health loop, which waits
# 300 seconds for a backend that does not exist. Refusing is both faster and more honest — this test
# has no opinion about anything after step 2.
printf '#!/usr/bin/env bash\nexit 1\n' > "$WORK/bin/docker"; chmod +x "$WORK/bin/docker"
# The off-host backup uploader (blocker B5). deploy.sh refuses a pilot host that cannot perform the
# upload, so a fixture without it would stop at that guard and never reach the pair under test here.
# A stub rather than the host's own aws: whether this machine happens to have the AWS CLI installed is
# not allowed to decide what this test measures.
printf '#!/usr/bin/env bash\necho aws-cli/2.0.0\n' > "$WORK/bin/aws"; chmod +x "$WORK/bin/aws"
export PATH="$WORK/bin:$PATH"

GUARD='RESPONSIBILITY_RUNTIME_ORG_IDS names an organisation'
ORG='87f57576-7ce7-460d-b93a-579382819fc1'

# A pilot env that passes every OTHER check in step 2, so the only thing a case varies is the pair.
# The four off-host backup names are part of «every other check» since B5 became fail-closed: they are
# the shipped pilot posture, not a variation. deploy/pilot/backup-guard.test.sh owns what happens when
# they are absent; nothing about the assertions below changed.
run() {  # run <rollout-value> <scheduler-value>
  local env_file="$WORK/pilot.env"
  cat > "$env_file" <<ENV
PILOT_PUBLIC_HOST=pilot.example.com
PILOT_ACME_EMAIL=ops@example.com
POSTGRES_PASSWORD=not-a-real-password
SELLEROPS_JWT_SECRET=0123456789abcdef0123456789abcdef0123
SELLEROPS_AGENT_ACCESS_SCOPE=CONNECTED_SELLERS
SELLEROPS_BACKUP_S3_ENABLED=true
SELLEROPS_BACKUP_S3_BUCKET=reviewnary-pilot-backups
SELLEROPS_BACKUP_S3_REGION=ap-northeast-2
SELLEROPS_BACKUP_S3_ACCESS_KEY_ID=AKIAEXAMPLEEXAMPLE
SELLEROPS_BACKUP_S3_SECRET_ACCESS_KEY=not-a-real-secret
RESPONSIBILITY_RUNTIME_ORG_IDS="$1"
SELLEROPS_RESPONSIBILITY_SCHEDULER_ENABLED=$2
ENV
  chmod 600 "$env_file"
  PILOT_ENV_FILE="$env_file" "$HERE/deploy.sh" --no-pull --no-backup 2>&1
}

echo "responsibility rollout × scheduler — the pair deploy.sh refuses to split"

# 1. The gap itself: a named organisation with nothing to work its windows.
out="$(run "$ORG" false)"
case "$out" in
  *"$GUARD"*) ok "rollout named + scheduler false → refused" ;;
  *) no "rollout named + scheduler false → refused" "guard message absent" ;;
esac
case "$out" in
  *"env: ok"*) no "rollout named + scheduler false → stops IN step 2" "env validation reported ok" ;;
  *) ok "rollout named + scheduler false → stops IN step 2" ;;
esac

# 2. The working pilot posture: both halves on.
out="$(run "$ORG" true)"
case "$out" in
  *"env: ok"*) ok "rollout named + scheduler true → passes" ;;
  *) no "rollout named + scheduler true → passes" "env validation did not report ok" ;;
esac
case "$out" in *"$GUARD"*) no "rollout named + scheduler true → no guard message" "guard fired anyway" ;; *) ok "rollout named + scheduler true → no guard message" ;; esac

# 3. Nobody is offered the job, so nothing is owed a scheduler. This is the SHIPPED pilot posture
#    (pilot.env.example: scheduler false, rollout blank) and it has to keep deploying.
out="$(run "" false)"
case "$out" in
  *"env: ok"*) ok "rollout blank + scheduler false → passes (the shipped posture)" ;;
  *) no "rollout blank + scheduler false → passes (the shipped posture)" "env validation did not report ok" ;;
esac
case "$out" in *"$GUARD"*) no "rollout blank + scheduler false → no guard message" "guard fired on an empty rollout" ;; *) ok "rollout blank + scheduler false → no guard message" ;; esac

# 4. Blank is blank however it is spelled. `ResponsibilityRollout.parse` trims each segment and drops
#    the empty ones, so separators and padding name nobody — and a guard that read them as «named»
#    would refuse a deployment the backend itself considers empty.
out="$(run " , " false)"
case "$out" in
  *"env: ok"*) ok "rollout of separators only → treated as blank" ;;
  *) no "rollout of separators only → treated as blank" "guard read whitespace/commas as an organisation" ;;
esac

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]
