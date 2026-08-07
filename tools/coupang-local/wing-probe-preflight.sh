#!/usr/bin/env bash
#
# Coupang WING READ-ONLY selector-probe PREFLIGHT (browser-only: no backend, no DB, no frontend).
#
# Run AFTER wing-probe-bootstrap.sh and BEFORE any live WING run. It proves the probe is IMMEDIATELY
# EXECUTABLE (docs/sellerops_live_approval_contract.md §2) and then prepares + displays the sanitized
# Approval Manifest. On any check failing it prints NO manifest and requests NO approval.
#
# It launches NO browser, makes NO Coupang call, reads no credential/.env value, and mutates nothing except
# writing the APPROVED probe scope back into this run's own env file (so the run cannot silently widen it).
#
# The manifest itself is NEVER hand-written here: the tested gate `collector/src/cli/approval-manifest-cli.ts`
# is its sole source (as in tools/naver-local/preflight.sh), so the CLI/driver/actions/mode/probe-scope the
# operator approves are exactly the ones the phase spec permits. This script only proves the surrounding
# prerequisites the gate cannot see (identity freshness, code drift, local toolchain, dedicated profile).
#
# Run it in the SAME shell that will run the probe — `PREPARED` means nothing more is asked of the operator.
#
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
COLLECTOR_DIR="${SELLEROPS_COLLECTOR_DIR:-$REPO_ROOT/collector}"
RUN_ENV="${SELLEROPS_WING_PROBE_RUN_ENV:-$HERE/.run/wing-probe.env}"
MANIFEST_OUT="${SELLEROPS_MANIFEST_OUT:-$(mktemp "${TMPDIR:-/tmp}/coupang-wing-probe-manifest.XXXXXX.json")}"
# A bootstrapped identity authorizes preparation only for the session that minted it (contract §2:
# `expiresAt: process-lifetime`). Two hours is the outer bound for one seated calibration session.
IDENTITY_TTL_SECONDS=7200

FAILED=0
pass() { echo "  PASS  $*"; }
fail() { echo "  FAIL  $*"; FAILED=1; }

# Git, with the ambient git environment stripped and untracked-file reporting forced on. Without this,
# GIT_DIR / GIT_WORK_TREE can point the drift check at a clean decoy repository, and
# GIT_CONFIG_COUNT/KEY_n/VALUE_n (or a repo-level status.showUntrackedFiles=no) can hide a dirty tree —
# either of which turns "the running code IS this commit" into a false claim.
git_hardened() {
  env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY \
      -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_COMMON_DIR -u GIT_CEILING_DIRECTORIES \
      -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM \
      git -C "$REPO_ROOT" -c status.showUntrackedFiles=normal "$@"
}

# Read one field from the prepared manifest. Fails LOUDLY: a renamed/missing key must never render as a blank
# line under a PREFLIGHT PASS banner. The path is passed via argv, never interpolated into the program.
jget() {
  python3 -c 'import json,sys
d = json.load(open(sys.argv[1]))
k = sys.argv[2]
if k not in d:
    sys.exit(1)
v = d[k]
if isinstance(v, list):
    v = ",".join(v)
if v is None or v == "":
    sys.exit(1)
print(v)' "$MANIFEST_OUT" "$1"
}

# ---- 0. run identity (required; from wing-probe-bootstrap.sh) -----------------
if [ ! -f "$RUN_ENV" ]; then
  echo "PREFLIGHT FAIL — no run env at $RUN_ENV. Run tools/coupang-local/wing-probe-bootstrap.sh first."
  exit 1
fi
# shellcheck disable=SC1090
set -a; . "$RUN_ENV"; set +a

RUN_ID="${WALKTHROUGH_RUN_ID:-}"
APPROVAL_ID="${WALKTHROUGH_APPROVAL_ID:-}"
RUN_GIT="${WALKTHROUGH_GIT_COMMIT:-}"
BOOTSTRAP_EPOCH="${WING_PROBE_BOOTSTRAP_EPOCH:-}"
PHASE="${SELLEROPS_APPROVAL_PHASE:-}"
PROBE_TARGETS="${SELLEROPS_WING_PROBE_TARGETS:-}"

echo "Coupang WING selector-probe preflight — run=${RUN_ID:-?} git=${RUN_GIT:-?} phase=${PHASE:-?} targets=${PROBE_TARGETS:-?}"
echo "read-only local checks only — no browser, no Coupang call, no credential read"
echo

# 1. The identity must be a real bootstrapped value. The manifest gate refuses "unknown" too
#    (UNBOUND_IDENTITY); catching it here gives the operator the actionable message instead.
IDENTITY_OK=1
for pair in "run id:$RUN_ID" "approval id:$APPROVAL_ID" "git commit:$RUN_GIT"; do
  name="${pair%%:*}"; value="${pair#*:}"
  if [ -z "$value" ] || [ "$value" = "unknown" ]; then
    fail "$name is empty or \"unknown\" — re-run wing-probe-bootstrap.sh"; IDENTITY_OK=0
  fi
done
[ "$IDENTITY_OK" = "1" ] && pass "run identity bound (run ${RUN_ID:0:8}… · approval ${APPROVAL_ID:0:8}…)"

# 2. The identity must be FRESH. A grant is single-use and process-lifetime (contract §1.5/§2): a run env
#    left behind by an earlier session must not silently re-authorize a new one.
if ! printf '%s' "$BOOTSTRAP_EPOCH" | grep -qE '^[0-9]+$'; then
  fail "no bootstrap timestamp in the run env — re-run wing-probe-bootstrap.sh"
else
  AGE=$(( $(date +%s) - BOOTSTRAP_EPOCH ))
  if [ "$AGE" -lt 0 ] || [ "$AGE" -gt "$IDENTITY_TTL_SECONDS" ]; then
    fail "run identity is stale (${AGE}s old, max ${IDENTITY_TTL_SECONDS}s) — re-bootstrap for a fresh approval id"
  else
    pass "run identity is fresh (${AGE}s old)"
  fi
fi

# 3. The phase must be the WING selector probe. This harness prepares that phase and no other — the
#    destructive deletion phase has its own gate and is not approvable from here.
[ "$PHASE" = "COUPANG_WING_SELECTOR_PROBE" ] \
  && pass "phase is COUPANG_WING_SELECTOR_PROBE (READ_ONLY)" \
  || fail "phase must be COUPANG_WING_SELECTOR_PROBE (got '${PHASE:-unset}') — this harness prepares no other phase"

# 4. No code drift since bootstrap. The manifest records a git SHA; if HEAD moved, or the working tree
#    carries uncommitted/untracked changes, the code that would run is NOT the code that SHA names —
#    the manifest would over-claim and the approval is REVOKED by contract §1.6.
TOPLEVEL="$(git_hardened rev-parse --show-toplevel 2>/dev/null || echo "")"
TOPLEVEL_REAL="$(python3 -c "import os,sys;print(os.path.realpath(sys.argv[1]) if sys.argv[1] else '')" "$TOPLEVEL" 2>/dev/null || echo "")"
REPO_REAL="$(python3 -c "import os,sys;print(os.path.realpath(sys.argv[1]))" "$REPO_ROOT" 2>/dev/null || echo "")"
if [ -n "$TOPLEVEL_REAL" ] && [ "$TOPLEVEL_REAL" = "$REPO_REAL" ]; then
  pass "git checks are reading this repository ($REPO_REAL)"
else
  fail "git is not reading this repository (got '${TOPLEVEL:-none}', expected $REPO_REAL) — refusing"
fi

CUR_GIT="$(git_hardened rev-parse --short HEAD 2>/dev/null || echo unknown)"
[ "$CUR_GIT" != "unknown" ] && [ "$CUR_GIT" = "$RUN_GIT" ] && pass "git commit unchanged since bootstrap ($CUR_GIT)" \
  || fail "git commit changed or unreadable ($RUN_GIT → $CUR_GIT) — re-bootstrap the run"

DIRT="$(git_hardened status --porcelain 2>/dev/null)"; DIRT_RC=$?
if [ "$DIRT_RC" != "0" ]; then
  # An unreadable status must never render as "clean" — that is the fail-open shape this guards.
  fail "could not read git status (exit $DIRT_RC) — refusing rather than assuming a clean tree"
elif [ -z "$DIRT" ]; then
  pass "working tree clean — the running code IS commit $CUR_GIT"
else
  fail "working tree is dirty — commit or stash first, then re-bootstrap (the manifest's gitSHA must name the code that runs):"
  printf '%s\n' "$DIRT" | head -5 | sed 's/^/        | /'
fi

# 5. The local toolchain must be able to start the probe with nothing more installed or asked.
[ -x "$COLLECTOR_DIR/node_modules/.bin/tsx" ] && pass "collector toolchain present (tsx resolvable)" \
  || fail "collector dependencies missing — run 'npm install' in $COLLECTOR_DIR"
PROBE_CLI="src/cli/probe-wing-issuance-selectors.ts"
[ -f "$COLLECTOR_DIR/$PROBE_CLI" ] && pass "probe entrypoint present ($PROBE_CLI)" \
  || fail "probe entrypoint missing: $COLLECTOR_DIR/$PROBE_CLI"

# 6. The dedicated Chrome profile must exist AND resolve inside the collector tree — the boundary
#    collector/src/profile.ts enforces at launch, applied here through realpath (so an in-tree path that
#    symlinks out, which the launch guard's purely lexical check would accept, is refused).
#
#    LIMIT, stated honestly: this checks the EFFECTIVE value only when it comes from the environment or the
#    default. The probe's documented invocation sources `collector/.env` first, and this preflight never reads
#    .env values. So if .env sets COLLECTOR_PROFILE_DIR at all, the check below would be validating a
#    different path than the run uses — and it refuses instead of reassuring. Only the KEY is looked for; no
#    .env value is ever read, printed, or logged.
if [ -f "$COLLECTOR_DIR/.env" ] && grep -qE '^[[:space:]]*(export[[:space:]]+)?COLLECTOR_PROFILE_DIR=' "$COLLECTOR_DIR/.env"; then
  fail "collector/.env sets COLLECTOR_PROFILE_DIR — this preflight cannot verify a path it must not read. Unset it there (or export it in this shell) and re-run"
else
  PROFILE_DIR_RAW="${COLLECTOR_PROFILE_DIR:-$COLLECTOR_DIR/.profile/naver}"
  PROFILE_DIR="$(python3 -c "import os,sys;print(os.path.realpath(sys.argv[1]))" "$PROFILE_DIR_RAW" 2>/dev/null || echo "")"
  COLLECTOR_REAL="$(python3 -c "import os,sys;print(os.path.realpath(sys.argv[1]))" "$COLLECTOR_DIR" 2>/dev/null || echo "")"
  case "$PROFILE_DIR" in
    "$COLLECTOR_REAL"/*)
      [ -d "$PROFILE_DIR" ] && pass "dedicated Chrome profile present inside the collector tree" \
        || fail "dedicated Chrome profile directory does not exist: $PROFILE_DIR" ;;
    *)
      fail "profile directory resolves OUTSIDE the collector tree ($PROFILE_DIR_RAW) — the launch path guard will refuse it" ;;
  esac
fi

# 7. A browser must actually be launchable: the bundled Chromium (default) or the configured channel.
CHANNEL="${COLLECTOR_BROWSER_CHANNEL:-}"
if [ -z "$CHANNEL" ]; then
  PW_CACHE="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/Library/Caches/ms-playwright}"
  ls -d "$PW_CACHE"/chromium-* >/dev/null 2>&1 && pass "bundled Chromium installed (Playwright cache)" \
    || fail "no bundled Chromium in $PW_CACHE — run 'npx playwright install chromium' in $COLLECTOR_DIR"
elif [ "$CHANNEL" = "chrome" ]; then
  [ -d "/Applications/Google Chrome.app" ] && pass "browser channel 'chrome' installed" \
    || fail "COLLECTOR_BROWSER_CHANNEL=chrome but Google Chrome is not installed"
else
  pass "browser channel '$CHANNEL' configured (installation not verifiable here)"
fi

# ---- Approval Manifest --------------------------------------------------------
# Prepared ONLY when every check above passed — a manifest is displayed only when the run is immediately
# executable (contract §2). The tested gate is the sole source; a non-zero exit prints its
# `PREFLIGHT FAIL: approval_prerequisite (<cause>)` and nothing else.
echo
if [ "$FAILED" != "0" ]; then
  echo "PREFLIGHT FAIL — no manifest prepared, no approval requested. Do NOT open a live WING window."
  exit 1
fi

if ! ( cd "$COLLECTOR_DIR" && npx --no-install tsx src/cli/approval-manifest-cli.ts ) > "$MANIFEST_OUT" 2> "$MANIFEST_OUT.err"; then
  cat "$MANIFEST_OUT.err" >&2 2>/dev/null || true
  rm -f "$MANIFEST_OUT" "$MANIFEST_OUT.err"
  echo "PREFLIGHT FAIL — approval prerequisites not met; no manifest prepared, no approval requested."
  exit 1
fi
rm -f "$MANIFEST_OUT.err"

# Every display field is READ FROM the tested manifest — never re-typed here. A missing field aborts:
# a blank line under a PASS banner would be an unnoticed change in what the operator is approving.
# An assignment's exit status IS the command substitution's, so a missing field is caught here — a helper
# that set a flag inside `$( )` could not, because the flag would be lost with the subshell.
FIELD_FAIL=0
M_CHANNEL="$(jget channel)" || FIELD_FAIL=1
M_OPERATION="$(jget operation)" || FIELD_FAIL=1
M_MODE="$(jget mode)" || FIELD_FAIL=1
M_ACCOUNT="$(jget accountBinding)" || FIELD_FAIL=1
M_MAX="$(jget maxActions)" || FIELD_FAIL=1
M_PHASE="$(jget phase)" || FIELD_FAIL=1
M_CLI="$(jget cli)" || FIELD_FAIL=1
M_HOST="$(jget apiCenterHost)" || FIELD_FAIL=1
M_TARGETS="$(jget probeTargets)" || FIELD_FAIL=1
M_ENTRY_TYPE="$(jget entrypointType)" || FIELD_FAIL=1
M_OPERATOR_ACTION="$(jget operatorActionSummary)" || FIELD_FAIL=1
if [ "$FIELD_FAIL" != "0" ]; then
  echo "PREFLIGHT FAIL — the prepared manifest is missing a field this display depends on; refusing to show a partial manifest."
  exit 1
fi
# The gate re-derives the phase itself; a manifest for any other phase must never be displayed by this harness.
if [ "$M_PHASE" != "COUPANG_WING_SELECTOR_PROBE" ]; then
  echo "PREFLIGHT FAIL — the prepared manifest is for phase $M_PHASE, not the READ_ONLY selector probe. Refusing."
  exit 1
fi

# Bind the APPROVED scope to the run: rewrite this run's env with the RESOLVED target list from the manifest,
# so sourcing it can only reproduce what was displayed. (The gate normalizes order and de-duplicates, and an
# empty request means ALL targets — writing the resolved value back removes that asymmetry from the run.)
python3 -c 'import sys
path, resolved = sys.argv[1], sys.argv[2]
lines = [l for l in open(path).read().splitlines() if not l.startswith("SELLEROPS_WING_PROBE_TARGETS=")]
lines.append("SELLEROPS_WING_PROBE_TARGETS=%r" % resolved)
open(path, "w").write("\n".join(lines) + "\n")' "$RUN_ENV" "$M_TARGETS" \
  && pass "approved scope written back to the run env ($M_TARGETS)" \
  || echo "  WARN  could not write the approved scope back to $RUN_ENV — pass it inline on the run command below"

echo
echo "PREFLIGHT PASS"
echo "approval manifest (sanitized) → $MANIFEST_OUT"; sed 's/^/  /' "$MANIFEST_OUT"
echo
echo "  ── APPROVAL MANIFEST (sanitized) ──"
echo "  $M_CHANNEL · $M_OPERATION"
echo "  $M_MODE · run ${RUN_ID:0:8}… · approval ${APPROVAL_ID:0:8}… · max: $M_MAX"
echo "  phase: $M_PHASE · probe targets: $M_TARGETS"
echo "  account: $M_ACCOUNT · host: $M_HOST · operator presence: required · expires: process-lifetime · git $CUR_GIT"
echo "  Standing Safety Contract + full scope: docs/sellerops_live_approval_contract.md"
echo
echo "  operator action ($M_ENTRY_TYPE):"
echo "    $M_OPERATOR_ACTION"
echo
echo "  The probe measures fixed-label match counts only — no highlight, no click, no input, no value read,"
echo "  no 발급/재발급/삭제, and it never navigates the window (the seller does)."
echo
echo "  If this manifest is correct and displayed, the operator's entire single-use grant is one line:"
echo "    Seated and ready."
echo
echo "  On approval, run the probe with the APPROVED scope inline (it must match the manifest):"
echo "    cd $COLLECTOR_DIR && SELLEROPS_WING_PROBE_TARGETS=$M_TARGETS \\"
echo "      npx tsx $M_CLI -- --i-understand-this-opens-live-coupang-wing"
echo
echo "  (Re-bootstrap ⇒ new approval id ⇒ the old approval is dead. A code/branch/run/scope change ⇒ REVOKED.)"
exit 0
