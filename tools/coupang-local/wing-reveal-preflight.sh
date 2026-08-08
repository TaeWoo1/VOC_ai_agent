#!/usr/bin/env bash
#
# Coupang WING issuance-form REVEAL preflight (browser-only: no backend, no DB, no frontend).
#
# Run AFTER wing-reveal-bootstrap.sh and BEFORE the live run. It proves the run is IMMEDIATELY EXECUTABLE
# (docs/sellerops_live_approval_contract.md §2), then prepares + displays the sanitized Approval Manifest. On any
# check failing it prints NO manifest and requests NO approval.
#
# This phase is NOT destructive and must never borrow the deletion harness's disclosure copy: the operator presses
# 발급, which is expected to open the API configuration step. What it displays instead — and what the manifest
# carries — is the pair of claims that matter: this press is not key creation, AND the runtime cannot prove no key
# was created (every sanitized signal is identical between an issued and a no-key surface).
#
# It launches NO browser, makes NO Coupang call, reads no credential value, and mutates nothing.
#
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
COLLECTOR_DIR="${SELLEROPS_COLLECTOR_DIR:-$REPO_ROOT/collector}"
RUN_ENV="${SELLEROPS_WING_REVEAL_RUN_ENV:-$HERE/.run/wing-reveal.env}"

FAILED=0
# shellcheck source=./wing-harness-common.sh
. "$HERE/wing-harness-common.sh"

MANIFEST_OUT="$(resolve_manifest_out coupang-wing-reveal)"
if [ -z "$MANIFEST_OUT" ]; then
  echo "PREFLIGHT FAIL — could not create a manifest path under ${TMPDIR:-/tmp}. No manifest prepared, no approval requested."
  exit 1
fi
# A real marketplace action, so the identity TTL matches the destructive harness rather than the read-only probe.
IDENTITY_TTL_SECONDS=3600

jget() { jget_from "$MANIFEST_OUT" "$1"; }

if [ ! -f "$RUN_ENV" ]; then
  echo "PREFLIGHT FAIL — no run env at $RUN_ENV. Run tools/coupang-local/wing-reveal-bootstrap.sh first."
  exit 1
fi
# Sourcing only OVERRIDES what the file names, so clear every variable that feeds the manifest first — an ambient
# value must never be able to describe this run as something it is not.
unset WALKTHROUGH_RUN_ID WALKTHROUGH_APPROVAL_ID WALKTHROUGH_GIT_COMMIT WING_REVEAL_BOOTSTRAP_EPOCH \
      SELLEROPS_APPROVAL_PHASE SELLEROPS_WING_PROBE_TARGETS SELLEROPS_WING_APPROVED_TARGETS \
      SELLEROPS_WING_APPROVED_PHASE SELLEROPS_APPROVAL_OPERATION SELLEROPS_APPROVAL_MAX \
      SELLEROPS_APPROVAL_ACCOUNT SELLEROPS_APPROVAL_SURFACE SELLEROPS_APPROVAL_CHANNEL
# shellcheck disable=SC1090
set -a; . "$RUN_ENV"; set +a

RUN_ID="${WALKTHROUGH_RUN_ID:-}"
APPROVAL_ID="${WALKTHROUGH_APPROVAL_ID:-}"
RUN_GIT="${WALKTHROUGH_GIT_COMMIT:-}"
BOOTSTRAP_EPOCH="${WING_REVEAL_BOOTSTRAP_EPOCH:-}"
PHASE="${SELLEROPS_APPROVAL_PHASE:-}"

echo "Coupang WING issuance-form REVEAL preflight — run=${RUN_ID:-?} git=${RUN_GIT:-?} phase=${PHASE:-?}"
echo "read-only local checks only — no browser, no Coupang call, no credential read"
echo

check_identity_bound "$RUN_ID" "$APPROVAL_ID" "$RUN_GIT"
check_identity_fresh "$BOOTSTRAP_EPOCH" "$IDENTITY_TTL_SECONDS"

# This harness prepares the reveal phase and no other. Preparing the destructive deletion phase from here would
# show reveal disclosure copy for an irreversible run; preparing a read-only probe would show operator-action copy
# for a run that presses nothing.
[ "$PHASE" = "COUPANG_WING_ISSUANCE_FORM_REVEAL" ] \
  && pass "phase is COUPANG_WING_ISSUANCE_FORM_REVEAL (agent READ_ONLY; the OPERATOR presses 발급)" \
  || fail "phase must be COUPANG_WING_ISSUANCE_FORM_REVEAL (got '${PHASE:-unset}') — this harness prepares no other phase"

check_no_code_drift "$RUN_GIT"
check_toolchain "$COLLECTOR_DIR" "src/cli/run-coupang-wing-reveal-live.ts" "reveal"
check_dedicated_profile "$COLLECTOR_DIR"
check_browser_launchable

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
M_CALIBRATED="$(jget selectorsCalibrated)" || FIELD_FAIL=1
M_ENTRY_TYPE="$(jget entrypointType)" || FIELD_FAIL=1
M_OPERATOR_ACTION="$(jget operatorActionSummary)" || FIELD_FAIL=1
if [ "$FIELD_FAIL" != "0" ]; then
  echo "PREFLIGHT FAIL — the prepared manifest is missing a field this display depends on; refusing to show a partial manifest."
  exit 1
fi
if [ "$M_PHASE" != "COUPANG_WING_ISSUANCE_FORM_REVEAL" ]; then
  echo "PREFLIGHT FAIL — the prepared manifest is for phase $M_PHASE, not the issuance-form reveal. Refusing."
  exit 1
fi

# The reveal descriptor is the contract the operator grants against. The gate already enforces it field-by-field
# (REVEAL_ACTION_CONTRACT_MISMATCH); it is re-read HERE so a softened one can never be DISPLAYED for approval —
# and, unlike the destructive check, what must be verified is that it does not OVERSTATE safety.
REVEAL_OK="$(python3 - "$MANIFEST_OUT" <<'PY' 2>/dev/null
import json, sys
try:
    r = json.load(open(sys.argv[1])).get("operatorRevealAction") or {}
except Exception:
    print("no"); raise SystemExit
want = {
    "operation": "REVEAL_WING_ISSUANCE_CONFIGURATION",
    "forbiddenFollowOnAction": "COMPLETE_WING_KEY_ISSUANCE",
    "createsKeyMaterial": False,
    "keyCreationRuledOut": False,
    "irreversible": False,
    "agentPerformsAction": False,
    "explicitCheckpointRequired": True,
    "credentialValueReadBudget": 0,
    "expectedOutcome": "CONFIGURATION_SURFACE",
    "expectedOutcomeConfirmed": False,
    "autoAdvanceAfterReveal": False,
}
print("yes" if all(r.get(k) == v for k, v in want.items()) else "no")
PY
)"
if [ "$REVEAL_OK" != "yes" ]; then
  echo "PREFLIGHT FAIL — the reveal-action descriptor is missing or softened. Refusing to display it for approval."
  exit 1
fi
pass "reveal descriptor is exactly the canonical contract (not key creation · key creation NOT ruled out · agent performs nothing · checkpoint required · 0 value reads · no auto-advance)"

# The 발급 selector must be calibrated: this phase highlights a real control. The gate refuses
# SELECTORS_NOT_CALIBRATED before reaching here, so this can only be `true` — asserted anyway so a future change
# that let an uncalibrated highlight run reach a manifest is caught here rather than on a live page.
if [ "$M_CALIBRATED" != "true" ]; then
  echo "PREFLIGHT FAIL — the manifest reports selectorsCalibrated=$M_CALIBRATED. A highlight run requires a calibrated 발급 selector. Refusing."
  exit 1
fi
pass "발급 selector calibration stated by the manifest (selectorsCalibrated=true)"

# Bind the APPROVED PHASE into this run's env, from the MANIFEST (never from the run env it sourced). Without it
# the three `WALKTHROUGH_*` identity variables are the only thing between a run env and a CLI — and they are
# byte-identical across WING phases, so a grant given for one WING action would reach PREPARED in the other.
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
echo "  ── APPROVAL MANIFEST (sanitized · OPERATOR-PERFORMED WING ACTION) ──"
echo "  $M_CHANNEL · $M_OPERATION"
echo "  $M_MODE (agent) · run ${RUN_ID:0:8}… · approval ${APPROVAL_ID:0:8}… · max: $M_MAX"
echo "  phase: $M_PHASE · selectors calibrated: $M_CALIBRATED"
echo "  account: $M_ACCOUNT · host: $M_HOST · operator presence: required · expires: process-lifetime · git $CUR_GIT"
echo "  Standing Safety Contract + full scope: docs/sellerops_live_approval_contract.md"
echo
echo "  operator action ($M_ENTRY_TYPE):"
echo "    $M_OPERATOR_ACTION"
echo
echo "  WHAT THIS RUN IS, precisely:"
echo "    • SellerOps HIGHLIGHTS the 발급 control and RESTS. You press it. The agent clicks/types/submits nothing."
echo "    • The press is EXPECTED to open the API configuration step. That is NOT confirmed — an outcome"
echo "      SellerOps does not recognize STOPS the run rather than being reported as success."
echo "    • This press is NOT key creation. The final 확인 creates the key and has no tooling and no phase."
echo "    • SellerOps CANNOT prove no key was created: every sanitized signal is identical between an issued and"
echo "      a no-key surface. The record says so out loud (keyCreationRuledOut: false). Only you can see the screen."
echo "    • No 자체개발 selection, no 업체명/URL/IP input, no 확인, no credential value read, no connect-test, no sync."
echo
echo "  If this manifest is correct and displayed, the operator's entire single-use grant is one line:"
echo "    Seated and ready."
echo
echo "  On approval:"
# BOTH phase variables travel on the command, like the probe harness does with its scope variables: the CLI
# refuses unless they are present and both name this phase, so a run env from another WING action cannot
# authorize this entrypoint even if it is still exported in the shell.
echo "    cd $COLLECTOR_DIR && SELLEROPS_APPROVAL_PHASE=$M_PHASE SELLEROPS_WING_APPROVED_PHASE=$M_PHASE \\"
echo "      npx tsx $M_CLI -- --i-understand-this-opens-live-coupang-wing"
echo
echo "  (Re-bootstrap ⇒ new approval id ⇒ the old approval is dead. A code/branch/run/scope change ⇒ REVOKED.)"
exit 0
