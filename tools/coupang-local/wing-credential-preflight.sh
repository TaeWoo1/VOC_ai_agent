#!/usr/bin/env bash
#
# Coupang WING CREDENTIAL preflight — prepares + displays the Approval Manifest for ONE of the two phases.
#
#   tools/coupang-local/wing-credential-preflight.sh calibration
#   tools/coupang-local/wing-credential-preflight.sh handoff
#
# Run AFTER wing-credential-bootstrap.sh and BEFORE the live run. It proves the run is IMMEDIATELY EXECUTABLE
# (docs/sellerops_live_approval_contract.md §2), then prepares + displays the sanitized Approval Manifest. On any
# check failing it prints NO manifest and requests NO approval.
#
# The HANDOFF adds three checks the calibration does not need, because it is the one run that reads a secret:
# the account slot is present and well-formed, the backend is up and its Coupang live-call interlock is armed
# with THIS run's approval id, and the account has no credential stored yet (the handoff never overwrites).
#
# It launches NO browser, makes NO Coupang call, reads no credential value, and mutates nothing.
#
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
COLLECTOR_DIR="${SELLEROPS_COLLECTOR_DIR:-$REPO_ROOT/collector}"

KIND="${1:-}"
case "$KIND" in
  calibration)
    PHASE_EXPECTED="COUPANG_WING_CREDENTIAL_CELL_CALIBRATION"
    CLI_REL="src/cli/calibrate-credential-cells.ts"
    ;;
  handoff)
    PHASE_EXPECTED="COUPANG_WING_CREDENTIAL_HANDOFF"
    CLI_REL="src/cli/run-coupang-credential-handoff-live.ts"
    ;;
  *)
    echo "PREFLIGHT FAIL — say which phase: 'calibration' or 'handoff'. There is no default."
    exit 1 ;;
esac
RUN_ENV="${SELLEROPS_WING_CREDENTIAL_RUN_ENV:-$HERE/.run/wing-credential-$KIND.env}"

FAILED=0
# shellcheck source=./wing-harness-common.sh
. "$HERE/wing-harness-common.sh"

MANIFEST_OUT="$(resolve_manifest_out "coupang-wing-credential-$KIND")"
if [ -z "$MANIFEST_OUT" ]; then
  echo "PREFLIGHT FAIL — could not create a manifest path under ${TMPDIR:-/tmp}. No manifest prepared, no approval requested."
  exit 1
fi
# A run on a live account with a real key on screen: the destructive harness's TTL, not the probe's.
IDENTITY_TTL_SECONDS=3600

jget() { jget_from "$MANIFEST_OUT" "$1"; }

if [ ! -f "$RUN_ENV" ]; then
  echo "PREFLIGHT FAIL — no run env at $RUN_ENV. Run tools/coupang-local/wing-credential-bootstrap.sh $KIND first."
  exit 1
fi
# Sourcing only OVERRIDES what the file names, so clear every variable that feeds the manifest first — an ambient
# value must never be able to describe this run as something it is not.
unset WALKTHROUGH_RUN_ID WALKTHROUGH_APPROVAL_ID WALKTHROUGH_GIT_COMMIT WING_CREDENTIAL_BOOTSTRAP_EPOCH \
      SELLEROPS_APPROVAL_PHASE SELLEROPS_WING_APPROVED_PHASE SELLEROPS_APPROVAL_OPERATION \
      SELLEROPS_APPROVAL_MAX SELLEROPS_APPROVAL_ACCOUNT SELLEROPS_APPROVAL_SURFACE SELLEROPS_APPROVAL_CHANNEL
# shellcheck disable=SC1090
set -a; . "$RUN_ENV"; set +a

RUN_ID="${WALKTHROUGH_RUN_ID:-}"
APPROVAL_ID="${WALKTHROUGH_APPROVAL_ID:-}"
RUN_GIT="${WALKTHROUGH_GIT_COMMIT:-}"
BOOTSTRAP_EPOCH="${WING_CREDENTIAL_BOOTSTRAP_EPOCH:-}"
PHASE="${SELLEROPS_APPROVAL_PHASE:-}"

echo "Coupang WING credential preflight ($KIND) — run=${RUN_ID:-?} git=${RUN_GIT:-?} phase=${PHASE:-?}"
echo "read-only local checks only — no browser, no Coupang call, no credential read"
echo

check_identity_bound "$RUN_ID" "$APPROVAL_ID" "$RUN_GIT"
check_identity_fresh "$BOOTSTRAP_EPOCH" "$IDENTITY_TTL_SECONDS"

# This invocation prepares ONE phase. Preparing the handoff from the calibration's run env would show
# "reads no value" disclosure copy for a run that reads three.
[ "$PHASE" = "$PHASE_EXPECTED" ] \
  && pass "phase is $PHASE_EXPECTED" \
  || fail "phase must be $PHASE_EXPECTED (got '${PHASE:-unset}') — this invocation prepares no other phase"

COLLECTOR_REAL="$(realpath_of "$COLLECTOR_DIR")"
EXPECTED_COLLECTOR="$(realpath_of "$REPO_ROOT/collector")"
if [ -n "$COLLECTOR_REAL" ] && [ -n "$EXPECTED_COLLECTOR" ] && [ "$COLLECTOR_REAL" = "$EXPECTED_COLLECTOR" ]; then
  pass "collector is this repository's collector (the verified tree is the one that builds the manifest)"
else
  fail "SELLEROPS_COLLECTOR_DIR points outside this repository — the drift check and the manifest would describe different checkouts. Unset it and re-run"
fi

check_no_code_drift "$RUN_GIT"
check_toolchain "$COLLECTOR_DIR" "$CLI_REL" "credential-$KIND"
check_dedicated_profile "$COLLECTOR_DIR"
check_browser_launchable

# ── the three checks that exist only for the run that reads a secret ──────────────────────────────────
if [ "$KIND" = "handoff" ]; then
  BACKEND_ORIGIN="${SELLEROPS_BASE_URL:-http://localhost:8080}"
  SLOT="${SELLEROPS_ACCOUNT_SLOT:-}"

  # 1. The account, as the opaque server-owned slot. Checked HERE and not only in the CLI so a missing binding
  #    refuses before a manifest is displayed rather than after the operator has granted one.
  if [ -z "$SLOT" ]; then
    fail "SELLEROPS_ACCOUNT_SLOT is not set — a handoff with no account named would have to guess which connection the key belongs to"
  else
    case "$SLOT" in
      *[!0-9a-f]*) fail "SELLEROPS_ACCOUNT_SLOT is not lowercase hex" ;;
      *) [ "${#SLOT}" = "24" ] \
           && pass "account slot present and well-formed (opaque; never a seller-account id)" \
           || fail "SELLEROPS_ACCOUNT_SLOT must be 24 hex characters (got ${#SLOT})" ;;
    esac
  fi

  # 2. The backend must be up AND its Coupang live-call interlock armed with THIS run's approval id — the
  #    verification leg is a real marketplace call, and `CoupangLiveCallGuard` refuses it otherwise. Without
  #    this check the run would store a credential and then fail its own verification for an environment reason.
  TOKEN="$(curl -s --max-time 8 -X POST -H 'Content-Type: application/json' \
    -d "{\"email\":\"${SELLEROPS_EMAIL:-demo@sellerops.ai}\",\"password\":\"${SELLEROPS_PASSWORD:-demo1234}\"}" \
    "$BACKEND_ORIGIN/api/auth/login" 2>/dev/null | sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  if [ -z "$TOKEN" ]; then
    fail "could not sign in to the backend at $BACKEND_ORIGIN — the run would read three secrets and have nowhere to put them"
  else
    pass "backend reachable and accepting the SellerOps login"
    SETUP="$(curl -s --max-time 8 -H "Authorization: Bearer $TOKEN" "$BACKEND_ORIGIN/api/connect/coupang/setup" 2>/dev/null)"
    EXPECTED_PREFIX="${APPROVAL_ID:0:12}"
    case "$SETUP" in
      *'"approvalArmed":true'*|*'"approvalArmed" : true'*) pass "backend live-call interlock is armed" ;;
      *) fail "backend live-call interlock NOT armed — run-backend-local.sh must arm this run's approval id, or the verification leg refuses" ;;
    esac
    case "$SETUP" in
      *"$EXPECTED_PREFIX"*) pass "armed approval id prefix matches this run ($EXPECTED_PREFIX)" ;;
      *) fail "the armed approval id is not this run's ($EXPECTED_PREFIX) — wrong or stale backend; re-bootstrap and re-arm" ;;
    esac
  fi
fi

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

FIELD_FAIL=0
M_CHANNEL="$(jget channel)" || FIELD_FAIL=1
M_OPERATION="$(jget operation)" || FIELD_FAIL=1
M_MODE="$(jget mode)" || FIELD_FAIL=1
M_ACCOUNT="$(jget accountBinding)" || FIELD_FAIL=1
M_MAX="$(jget maxActions)" || FIELD_FAIL=1
M_PHASE="$(jget phase)" || FIELD_FAIL=1
M_CLI="$(jget cli)" || FIELD_FAIL=1
M_HOST="$(jget apiCenterHost)" || FIELD_FAIL=1
M_ENTRY_TYPE="$(jget entrypointType)" || FIELD_FAIL=1
M_OPERATOR_ACTION="$(jget operatorActionSummary)" || FIELD_FAIL=1
if [ "$FIELD_FAIL" != "0" ]; then
  echo "PREFLIGHT FAIL — the prepared manifest is missing a field this display depends on; refusing to show a partial manifest."
  exit 1
fi
if [ "$M_PHASE" != "$PHASE_EXPECTED" ]; then
  echo "PREFLIGHT FAIL — the prepared manifest is for phase $M_PHASE, not $PHASE_EXPECTED. Refusing."
  exit 1
fi

# The MODE is the one field that says whether this run holds a secret, so it is checked against the phase rather
# than merely displayed. A calibration manifest that came back CREDENTIAL_READ, or a handoff manifest that came
# back READ_ONLY, is a manifest describing the other run.
EXPECTED_MODE="READ_ONLY"; [ "$KIND" = "handoff" ] && EXPECTED_MODE="CREDENTIAL_READ"
if [ "$M_MODE" != "$EXPECTED_MODE" ]; then
  echo "PREFLIGHT FAIL — the manifest's mode is $M_MODE, expected $EXPECTED_MODE for the $KIND phase. Refusing."
  exit 1
fi
pass "manifest mode is $M_MODE (agent posture toward the seller's values)"

# Bind the APPROVED PHASE into this run's env, from the MANIFEST (never from the run env it sourced) — the three
# WALKTHROUGH_* identity variables are byte-identical across WING phases, so without this a grant given for the
# calibration would reach PREPARED in the handoff.
if ! python3 -c 'import os, sys, tempfile
path, phase = sys.argv[1], sys.argv[2]
lines = [l for l in open(path).read().splitlines() if not l.startswith("SELLEROPS_WING_APPROVED_PHASE=")]
q = "'"'"'"
lines.append("SELLEROPS_WING_APPROVED_PHASE=" + q + phase.replace(q, q + chr(34) + q + chr(34) + q) + q)
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(os.path.abspath(path)))
try:
    with os.fdopen(fd, "w") as f:
        f.write("\n".join(lines) + "\n")
    os.replace(tmp, path)
except BaseException:
    if os.path.exists(tmp):
        os.unlink(tmp)
    raise' "$RUN_ENV" "$M_PHASE" 2>/dev/null; then
  echo "PREFLIGHT FAIL — could not bind the approved phase to $RUN_ENV; refusing to present a manifest the run may not honor."
  exit 1
fi
pass "approved PHASE bound to the run env ($M_PHASE)"

echo
echo "PREFLIGHT PASS"
echo "approval manifest (sanitized) → $MANIFEST_OUT"; sed 's/^/  /' "$MANIFEST_OUT"
echo
echo "  ── APPROVAL MANIFEST (sanitized) ──"
echo "  $M_CHANNEL · $M_OPERATION"
echo "  $M_MODE (agent) · run ${RUN_ID:0:8}… · approval ${APPROVAL_ID:0:8}… · max: $M_MAX"
echo "  phase: $M_PHASE"
echo "  account: $M_ACCOUNT · host: $M_HOST · operator presence: required · expires: process-lifetime · git $CUR_GIT"
echo "  Standing Safety Contract + full scope: docs/sellerops_live_approval_contract.md"
echo "  Credential contract: docs/coupang_credential_handoff_v1.md"
echo
echo "  operator action ($M_ENTRY_TYPE):"
echo "    $M_OPERATOR_ACTION"
echo
if [ "$KIND" = "calibration" ]; then
  echo "  WHAT THIS RUN IS, precisely:"
  echo "    • You reach the WING screen where your issued keys are shown. SellerOps opens the window and nothing else."
  echo "    • It then measures WHICH CELL each of 업체코드 / Access Key / Secret Key is attached to — the association,"
  echo "      the cell's tag, how many candidates resolved, and how many fields the cell holds."
  echo "    • It reads NO VALUE. The one thing it derives from a key is whether its cell is non-empty (yes/no),"
  echo "      because a locator that resolves to an empty cell has not found the key."
  echo "    • Nothing is clicked, typed, submitted, issued, deleted, highlighted, or sent anywhere."
  echo "    • Why this exists: where the values sit has never been measured, and a locator written from a guess"
  echo "      would be a guess about where a secret is."
else
  echo "  ⚠ WHAT THIS RUN IS — AND IT IS NOT LIKE THE OTHERS:"
  echo "    • SellerOps will READ your 업체코드 · Access Key · Secret Key. Once. This is the first run that does."
  echo "    • It happens ONLY after you press [실행 허용] on a SellerOps tab, at the moment it is about to happen."
  echo "      That press discloses the whole chain: read → send to the SellerOps vault → read-only verification."
  echo "    • The values go to your own SellerOps backend, encrypted, and NOWHERE else. Not to the screen, not to"
  echo "      the log, not to a file, not to the clipboard, and not into any assistant's context."
  echo "    • SellerOps does not press 발급 or 확인, types nothing, and creates or deletes no key. You issued it."
  echo "    • If the screen does not resolve unambiguously, it refuses and reads nothing — enter the keys yourself."
  echo "    • It will NOT overwrite a credential you already have stored; that is the separate renewal path."
fi
echo
echo "  If this manifest is correct and displayed, say the one line that tells the assistant to start it:"
echo "    Seated and ready."
echo
echo "  That line does NOT authorize the run. The run opens a 'SellerOps 확인' tab, shows you these same"
echo "  binding fields, and starts ONLY when you press the button on it yourself. No press, no run."
echo
echo "  On approval:"
if [ "$KIND" = "handoff" ]; then
  echo "    cd $COLLECTOR_DIR && SELLEROPS_APPROVAL_PHASE=$M_PHASE SELLEROPS_WING_APPROVED_PHASE=$M_PHASE \\"
  echo "      SELLEROPS_ACCOUNT_SLOT=\$SELLEROPS_ACCOUNT_SLOT \\"
  echo "      npx tsx $M_CLI -- --i-understand-this-opens-live-coupang-wing"
else
  echo "    cd $COLLECTOR_DIR && SELLEROPS_APPROVAL_PHASE=$M_PHASE SELLEROPS_WING_APPROVED_PHASE=$M_PHASE \\"
  echo "      npx tsx $M_CLI -- --i-understand-this-opens-live-coupang-wing"
fi
echo
echo "  (Re-bootstrap ⇒ new approval id ⇒ the old approval is dead. A code/branch/run/scope change ⇒ REVOKED.)"
exit 0
