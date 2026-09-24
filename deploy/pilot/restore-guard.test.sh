#!/usr/bin/env bash
# What restore.sh must never do — Pilot Provisioning Plan v1 §3, the restore.sh audit.
#   deploy/pilot/restore-guard.test.sh
#
# `DROP SCHEMA public CASCADE` is irreversible, and before the validation guard it ran before
# anything had established that the dump could be read. The property under test is therefore not
# "a good dump restores" but "a BAD dump drops nothing" — so every case below is scored on the
# RECORDED CALL SEQUENCE, not on the exit status alone. An exit code can be right while the damage
# has already been done.
#
# No database, no container, no network. `docker` is replaced on PATH by a stub that records every
# invocation and decides pg_restore's verdict from the bytes it is actually fed on stdin, so the
# control flow being asserted is restore.sh's own.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
pass=0; fail=0
ok(){ printf '  ok   %s\n' "$1"; pass=$((pass+1)); }
no(){ printf '  FAIL %s\n     %s\n' "$1" "${2:-}"; fail=$((fail+1)); }

# ── the stub ─────────────────────────────────────────────────────────────────────────────────────
# A custom-format archive that pg_restore can read all the way through starts with PGDMP and ends
# with its trailer; a truncated one has the header and no trailer, which is the real-world shape
# (a killed pg_dump, a full disk, a partial download). The stub reads stdin and applies exactly
# that rule, so "valid" and "truncated" are decided by the file, not by a flag we pass ourselves.
mkdir -p "$WORK/bin"
cat > "$WORK/bin/docker" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$STUB_LOG"
args="$*"
case "$args" in
  *"pg_restore --list"*)
    body="$(cat)"
    case "$body" in
      PGDMP*ENDOK) printf ';  1; 1234 TABLE public organizations\n'; exit 0 ;;
      *) echo "pg_restore: error: could not read from input file: end of file" >&2; exit 1 ;;
    esac ;;
  *pg_restore*)
    body="$(cat)"
    case "$body" in
      PGDMP*ENDOK) exit 0 ;;
      *) echo "pg_restore: error: could not read from input file: end of file" >&2; exit 1 ;;
    esac ;;
  *) exit 0 ;;
esac
STUB
chmod +x "$WORK/bin/docker"

printf 'POSTGRES_DB=sellerops\nPOSTGRES_USER=sellerops\n' > "$WORK/pilot.env"
printf 'PGDMP%s\nENDOK' "$(head -c 400 /dev/zero | tr '\0' 'x')" > "$WORK/valid.dump"
head -c 260 "$WORK/valid.dump" > "$WORK/truncated.dump"          # header, no trailer
printf 'this is not an archive at all\n'                > "$WORK/corrupt.dump"

printf 'RESTORE\n' > "$WORK/answer"
run(){ # run <dump-path> -> sets RC and LOG
  # stdin says RESTORE: the human in the failure this guards against DID confirm. Feeding /dev/null
  # here would stop the pre-guard script at its prompt and make every "DROP called 0 times"
  # assertion below pass against the defect itself.
  LOG="$WORK/log.$RANDOM"; : > "$LOG"
  STUB_LOG="$LOG" PILOT_ENV_FILE="$WORK/pilot.env" PATH="$WORK/bin:$PATH" \
    bash "$HERE/restore.sh" "$1" < "$WORK/answer" >"$LOG.out" 2>"$LOG.err"
  RC=$?
}
count(){ grep -c -- "$1" "$LOG" 2>/dev/null || true; }

echo "restore.sh dump-validation guard"

# ── 1. a valid dump still restores, and validation happens first ─────────────────────────────────
LOG="$WORK/log.valid"; : > "$LOG"
STUB_LOG="$LOG" PILOT_ENV_FILE="$WORK/pilot.env" PATH="$WORK/bin:$PATH" \
  bash "$HERE/restore.sh" "$WORK/valid.dump" < "$WORK/answer" >"$LOG.out" 2>"$LOG.err"; RC=$?
[[ $RC -eq 0 ]] && ok "valid dump: exits 0" || no "valid dump: exits 0" "rc=$RC $(cat "$LOG.err")"
[[ $(count 'pg_restore --list') -eq 1 ]] && ok "valid dump: validated exactly once" || no "valid dump: validated exactly once" "$(count 'pg_restore --list')"
[[ $(count 'DROP SCHEMA') -eq 1 ]] && ok "valid dump: drops once" || no "valid dump: drops once"
[[ $(count 'pg_restore -U') -eq 1 ]] && ok "valid dump: restores once" || no "valid dump: restores once"
[[ $(count 'start backend') -eq 1 ]] && ok "valid dump: restarts services" || no "valid dump: restarts services"
v=$(grep -n 'pg_restore --list' "$LOG" | head -1 | cut -d: -f1); d=$(grep -n 'DROP SCHEMA' "$LOG" | head -1 | cut -d: -f1)
[[ -n "$v" && -n "$d" && "$v" -lt "$d" ]] && ok "valid dump: validation precedes the drop (line $v < $d)" || no "valid dump: validation precedes the drop" "validate=$v drop=$d"
grep -q 'restored; run' "$LOG.out" && ok "valid dump: reports success" || no "valid dump: reports success"

# ── 2. an unreadable dump drops nothing ──────────────────────────────────────────────────────────
for bad in truncated corrupt; do
  run "$WORK/$bad.dump"
  [[ $RC -ne 0 ]] && ok "$bad dump: non-zero exit (rc=$RC)" || no "$bad dump: non-zero exit" "rc=0"
  [[ $(count 'DROP SCHEMA') -eq 0 ]] && ok "$bad dump: DROP SCHEMA called 0 times" || no "$bad dump: DROP SCHEMA called 0 times" "$(count 'DROP SCHEMA')"
  [[ $(count 'CREATE SCHEMA') -eq 0 ]] && ok "$bad dump: CREATE SCHEMA called 0 times" || no "$bad dump: CREATE SCHEMA called 0 times"
  [[ $(count 'pg_restore -U') -eq 0 ]] && ok "$bad dump: no restore attempted" || no "$bad dump: no restore attempted"
  [[ $(count 'stop backend') -eq 0 ]] && ok "$bad dump: services never stopped" || no "$bad dump: services never stopped"
  grep -q 'nothing was dropped' "$LOG.err" && ok "$bad dump: says the database is untouched" || no "$bad dump: says the database is untouched" "$(cat "$LOG.err")"
done

# ── 3. a missing file fails as before, without reaching docker ───────────────────────────────────
LOG="$WORK/log.missing"; : > "$LOG"
STUB_LOG="$LOG" PILOT_ENV_FILE="$WORK/pilot.env" PATH="$WORK/bin:$PATH" \
  bash "$HERE/restore.sh" "$WORK/does-not-exist.dump" </dev/null >"$LOG.out" 2>"$LOG.err"; RC=$?
[[ $RC -eq 2 ]] && ok "missing file: keeps the original exit 2" || no "missing file: keeps the original exit 2" "rc=$RC"
[[ ! -s "$LOG" ]] && ok "missing file: docker never invoked" || no "missing file: docker never invoked" "$(cat "$LOG")"
LOG="$WORK/log.noargs"; : > "$LOG"
STUB_LOG="$LOG" PILOT_ENV_FILE="$WORK/pilot.env" PATH="$WORK/bin:$PATH" \
  bash "$HERE/restore.sh" </dev/null >/dev/null 2>&1; RC=$?
[[ $RC -eq 2 ]] && ok "no argument: keeps the original exit 2" || no "no argument: keeps the original exit 2" "rc=$RC"

# ── 4. the validation step itself mutates nothing ────────────────────────────────────────────────
# Two independent claims: the refusing run issues no statement that could change the database, and
# the validating command names no database to change.
run "$WORK/truncated.dump"
if grep -Eqi 'psql|DROP|CREATE|INSERT|UPDATE|DELETE|ALTER|TRUNCATE' "$LOG"; then
  no "validation: no mutating command is issued" "$(cat "$LOG")"
else ok "validation: no mutating command is issued"; fi
[[ $(wc -l < "$LOG") -eq 1 ]] && ok "validation: exactly one docker call, and it is the read" || no "validation: exactly one docker call" "$(cat "$LOG")"
if grep -q 'pg_restore --list' "$LOG" && ! grep -Eq 'pg_restore --list.*(-d|--dbname)' "$LOG"; then
  ok "validation: --list names no database (-d absent)"
else no "validation: --list names no database" "$(cat "$LOG")"; fi

echo; printf 'passed=%s failed=%s\n' "$pass" "$fail"
[[ $fail -eq 0 ]]
