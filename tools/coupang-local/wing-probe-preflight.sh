#!/usr/bin/env bash
#
# Coupang WING READ-ONLY selector-probe PREFLIGHT (browser-only: no backend, no DB, no frontend).
#
# Run AFTER wing-probe-bootstrap.sh and BEFORE any live WING run. It proves the probe is IMMEDIATELY
# EXECUTABLE (docs/sellerops_live_approval_contract.md §2) and then prepares + displays the sanitized
# Approval Manifest. On any check failing it prints NO manifest and requests NO approval.
#
# It launches NO browser, makes NO Coupang call, reads no credential/.env value, and mutates nothing.
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
MANIFEST_OUT="${SELLEROPS_MANIFEST_OUT:-${TMPDIR:-/tmp}/coupang-wing-probe-manifest.json}"

FAILED=0
pass() { echo "  PASS  $*"; }
fail() { echo "  FAIL  $*"; FAILED=1; }
jget() { python3 -c "import json,sys;print(json.load(open('$MANIFEST_OUT'))$1)" 2>/dev/null; }

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

# 2. The phase must be the WING selector probe. This harness prepares that phase and no other — the
#    destructive deletion phase has its own gate and is not approvable from here.
[ "$PHASE" = "COUPANG_WING_SELECTOR_PROBE" ] \
  && pass "phase is COUPANG_WING_SELECTOR_PROBE (READ_ONLY)" \
  || fail "phase must be COUPANG_WING_SELECTOR_PROBE (got '${PHASE:-unset}') — this harness prepares no other phase"

# 3. No code drift since bootstrap. The manifest records a git SHA; if HEAD moved, or the working tree
#    carries uncommitted/untracked changes, the code that would run is NOT the code that SHA names —
#    the manifest would over-claim and the approval is REVOKED by contract §1.6.
CUR_GIT="$(git -C "$HERE" rev-parse --short HEAD 2>/dev/null || echo unknown)"
[ "$CUR_GIT" = "$RUN_GIT" ] && pass "git commit unchanged since bootstrap ($CUR_GIT)" \
  || fail "git commit changed ($RUN_GIT → $CUR_GIT) — re-bootstrap the run"
DIRT="$(git -C "$HERE" status --porcelain 2>/dev/null | head -5)"
if [ -z "$DIRT" ]; then
  pass "working tree clean — the running code IS commit $CUR_GIT"
else
  fail "working tree is dirty — commit or stash first, then re-bootstrap (the manifest's gitSHA must name the code that runs):"
  printf '%s\n' "$DIRT" | sed 's/^/        | /'
fi

# 4. The local toolchain must be able to start the probe with nothing more installed or asked.
[ -x "$COLLECTOR_DIR/node_modules/.bin/tsx" ] && pass "collector toolchain present (tsx resolvable)" \
  || fail "collector dependencies missing — run 'npm install' in $COLLECTOR_DIR"
PROBE_CLI="src/cli/probe-wing-issuance-selectors.ts"
[ -f "$COLLECTOR_DIR/$PROBE_CLI" ] && pass "probe entrypoint present ($PROBE_CLI)" \
  || fail "probe entrypoint missing: $COLLECTOR_DIR/$PROBE_CLI"

# 5. The dedicated Chrome profile must exist AND resolve inside the collector tree — the same boundary
#    collector/src/profile.ts enforces at launch. This is the check that catches a moved/relocated repo
#    whose COLLECTOR_PROFILE_DIR still points at the old location.
PROFILE_DIR_RAW="${COLLECTOR_PROFILE_DIR:-$COLLECTOR_DIR/.profile/naver}"
PROFILE_DIR="$(python3 -c "import os,sys;print(os.path.realpath(sys.argv[1]))" "$PROFILE_DIR_RAW" 2>/dev/null || echo "")"
COLLECTOR_REAL="$(python3 -c "import os,sys;print(os.path.realpath(sys.argv[1]))" "$COLLECTOR_DIR" 2>/dev/null || echo "")"
if [ -n "$PROFILE_DIR" ] && [ -n "$COLLECTOR_REAL" ] && [ "${PROFILE_DIR#$COLLECTOR_REAL/}" != "$PROFILE_DIR" ]; then
  [ -d "$PROFILE_DIR" ] && pass "dedicated Chrome profile present inside the collector tree" \
    || fail "dedicated Chrome profile directory does not exist: $PROFILE_DIR"
else
  fail "profile directory resolves OUTSIDE the collector tree ($PROFILE_DIR_RAW) — the launch path guard will refuse it"
fi

# 6. A browser must actually be launchable: the bundled Chromium (default) or the configured channel.
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

# Every display field is READ FROM the tested manifest — never re-typed here.
M_CHANNEL="$(jget "['channel']")"
M_OPERATION="$(jget "['operation']")"
M_MODE="$(jget "['mode']")"
M_ACCOUNT="$(jget "['accountBinding']")"
M_MAX="$(jget "['maxActions']")"
M_PHASE="$(jget "['phase']")"
M_CLI="$(jget "['cli']")"
M_HOST="$(jget "['apiCenterHost']")"
M_TARGETS="$(jget "['probeTargets']")"
M_CALIBRATED="$(jget "['selectorsCalibrated']")"
M_ENTRY_TYPE="$(jget "['entrypointType']")"
M_OPERATOR_ACTION="$(jget "['operatorActionSummary']")"

echo "PREFLIGHT PASS"
echo "approval manifest (sanitized) → $MANIFEST_OUT"; sed 's/^/  /' "$MANIFEST_OUT"
echo
echo "  ── APPROVAL MANIFEST (sanitized) ──"
echo "  $M_CHANNEL · $M_OPERATION"
echo "  $M_MODE · run ${RUN_ID:0:8}… · approval ${APPROVAL_ID:0:8}… · max: $M_MAX"
echo "  phase: $M_PHASE · probe targets: $M_TARGETS · selectors calibrated: $M_CALIBRATED"
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
echo "  On approval, run the probe in a shell bound to THIS run (the scope must match the manifest):"
echo "    set -a; . $RUN_ENV; set +a"
echo "    cd $COLLECTOR_DIR && npx tsx $M_CLI -- --i-understand-this-opens-live-coupang-wing"
echo
echo "  (Re-bootstrap ⇒ new approval id ⇒ the old approval is dead. A code/branch/run/scope change ⇒ REVOKED.)"
exit 0
