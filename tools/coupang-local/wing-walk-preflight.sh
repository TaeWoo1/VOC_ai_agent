#!/usr/bin/env bash
#
# Coupang WING GUIDED ISSUANCE WALK preflight (browser-only: no backend, no DB, no frontend).
#
# Run AFTER wing-walk-bootstrap.sh and BEFORE the live run. It proves the run is IMMEDIATELY EXECUTABLE
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
RUN_ENV="${SELLEROPS_WING_WALK_RUN_ENV:-$HERE/.run/wing-walk.env}"

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
  echo "PREFLIGHT FAIL — no run env at $RUN_ENV. Run tools/coupang-local/wing-walk-bootstrap.sh first."
  exit 1
fi
# Sourcing only OVERRIDES what the file names, so clear every variable that feeds the manifest first — an ambient
# value must never be able to describe this run as something it is not.
unset WALKTHROUGH_RUN_ID WALKTHROUGH_APPROVAL_ID WALKTHROUGH_GIT_COMMIT WING_WALK_BOOTSTRAP_EPOCH \
      SELLEROPS_APPROVAL_PHASE SELLEROPS_WING_PROBE_TARGETS SELLEROPS_WING_APPROVED_TARGETS \
      SELLEROPS_WING_APPROVED_PHASE SELLEROPS_APPROVAL_OPERATION SELLEROPS_APPROVAL_MAX \
      SELLEROPS_APPROVAL_ACCOUNT SELLEROPS_APPROVAL_SURFACE SELLEROPS_APPROVAL_CHANNEL
# shellcheck disable=SC1090
set -a; . "$RUN_ENV"; set +a

RUN_ID="${WALKTHROUGH_RUN_ID:-}"
APPROVAL_ID="${WALKTHROUGH_APPROVAL_ID:-}"
RUN_GIT="${WALKTHROUGH_GIT_COMMIT:-}"
BOOTSTRAP_EPOCH="${WING_WALK_BOOTSTRAP_EPOCH:-}"
PHASE="${SELLEROPS_APPROVAL_PHASE:-}"

echo "Coupang WING GUIDED ISSUANCE WALK preflight — run=${RUN_ID:-?} git=${RUN_GIT:-?} phase=${PHASE:-?}"
echo "read-only local checks only — no browser, no Coupang call, no credential read"
echo

check_identity_bound "$RUN_ID" "$APPROVAL_ID" "$RUN_GIT"
check_identity_fresh "$BOOTSTRAP_EPOCH" "$IDENTITY_TTL_SECONDS"

# This harness prepares the reveal phase and no other. Preparing the destructive deletion phase from here would
# show reveal disclosure copy for an irreversible run; preparing a read-only probe would show operator-action copy
# for a run that presses nothing.
[ "$PHASE" = "COUPANG_WING_GUIDED_ISSUANCE_WALK" ] \
  && pass "phase is COUPANG_WING_GUIDED_ISSUANCE_WALK (agent READ_ONLY; the OPERATOR presses 발급)" \
  || fail "phase must be COUPANG_WING_GUIDED_ISSUANCE_WALK (got '${PHASE:-unset}') — this harness prepares no other phase"

# The collector must be THIS repository's collector — the check the deletion preflight has and this one did not.
# Otherwise the drift check verifies one checkout while `approval-manifest-cli.ts` (which derives its own repo
# root from its file location) builds the manifest from another, and the displayed `git <sha>` describes a tree
# the gate never looked at. The selfcheck's COLLECTOR_ESCAPE case had been passing only because its fixture
# directory was empty, so `check_toolchain` failed on a missing tsx — not because anything checked containment.
COLLECTOR_REAL="$(realpath_of "$COLLECTOR_DIR")"
EXPECTED_COLLECTOR="$(realpath_of "$REPO_ROOT/collector")"
if [ -n "$COLLECTOR_REAL" ] && [ -n "$EXPECTED_COLLECTOR" ] && [ "$COLLECTOR_REAL" = "$EXPECTED_COLLECTOR" ]; then
  pass "collector is this repository's collector (the verified tree is the one that builds the manifest)"
else
  fail "SELLEROPS_COLLECTOR_DIR points outside this repository — the drift check and the manifest would describe different checkouts. Unset it and re-run"
fi

check_no_code_drift "$RUN_GIT"
# The entrypoint THIS phase runs, not an adjacent one. It used to name the reveal CLI — so the check passed on a
# tree where the walk's own entrypoint had been renamed or deleted, which is the failure it exists to catch.
check_toolchain "$COLLECTOR_DIR" "src/cli/local-agent-service.ts" "guided-walk service installer"
[ -f "$COLLECTOR_DIR/src/cli/local-agent.ts" ] \
  && pass "hosted agent present (src/cli/local-agent.ts — the service's ProgramArguments target)" \
  || fail "hosted agent missing: $COLLECTOR_DIR/src/cli/local-agent.ts — the installed service would crash-loop"
check_dedicated_profile "$COLLECTOR_DIR"
check_browser_launchable

# The product path runs the agent as a launchd user agent. On any other OS the service adapter refuses
# (UNSUPPORTED_PLATFORM), so an operator would grant against a manifest describing a run that cannot start.
[ "$(uname -s)" = "Darwin" ] \
  && pass "host is macOS (the launchd service adapter and the native approval dialog both exist here)" \
  || fail "the guided walk's product path needs macOS — launchd autostart and the native pairing dialog have no adapter on $(uname -s)"

# The agent boot needs a connections file; without one it exits before hosting the carrier, and the frontend
# would sit at "unreachable" with nothing explaining why.
WALK_CONNECTIONS="${SELLEROPS_WALK_CONNECTIONS:-$COLLECTOR_DIR/.connections/coupang-walk.json}"
[ -f "$WALK_CONNECTIONS" ] \
  && pass "walk connections file present (the agent boot has a connection set to load)" \
  || fail "no connections file at $WALK_CONNECTIONS — the agent exits at boot without one"

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
if [ "$M_PHASE" != "COUPANG_WING_GUIDED_ISSUANCE_WALK" ]; then
  echo "PREFLIGHT FAIL — the prepared manifest is for phase $M_PHASE, not the issuance-form reveal. Refusing."
  exit 1
fi

# The reveal descriptor is the contract the operator grants against. The gate already enforces it field-by-field
# (REVEAL_ACTION_CONTRACT_MISMATCH); it is re-read HERE so a softened one can never be DISPLAYED for approval —
# and, unlike the destructive check, what must be verified is that it does not OVERSTATE safety.
#
# The check lives in wing-harness-common.sh as a function over a FILE, for the reason the destructive one does:
# the gate makes a softened descriptor unproducible through the CLI, so inline here it would be unfalsifiable —
# no end-to-end case could distinguish "checked" from "checked and ignored". As a function, the selfcheck calls
# it directly against crafted manifests, including ones re-pointed at key issuance and at the deletion action.
if ! verify_walk_descriptor "$MANIFEST_OUT"; then
  echo "PREFLIGHT FAIL — the guided-walk boundary descriptor is missing, softened, or names a different operation. Refusing to display it for approval."
  exit 1
fi
pass "guided-walk boundary is exactly the canonical contract (rests before the key-creating control · never presses it · agent performs nothing and navigates nothing · 0 value reads · no connect/sync · 2 highlighted + 4 text-guided)"

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
echo "    • EVERY marketplace action is YOURS. You log in, you reach the page, you press each control. The"
echo "      agent clicks, types, submits and NAVIGATES nothing — it does not even open the page for you."
echo "    • Only TWO steps are highlighted: 'API Key 발급 받기' and the Access Key region. Both have a"
echo "      live-calibrated locator."
echo "    • '확인' and the two consent checkboxes are TEXT-GUIDED. They were measured but"
echo "      NOT promoted to selectors, so SellerOps does not claim to know where they are and draws no ring at"
echo "      them. If a step's panel has no highlight, that is the design, not a failure."
echo "    • 'OPEN API' is the DEFAULT purpose option, so the purpose screen is ONE step: check it, press 확인."
echo "    • FOUR steps advance by themselves when WING's own screen changes. The key-creating step never does."
echo "    • You read the two consent texts and decide. SellerOps does not read them, evaluate them, agree to"
echo "      them, or advise on them, and it never ticks a box. It DOES check whether both are ticked, so the"
echo "      walk can move on without you pressing anything — that reading is a yes/no computed in the page and"
echo "      is never stored, sent, or logged."
echo
echo "  ⚠ WHERE THIS RUN STOPS, and why:"
echo "    • The walk RESTS in front of '약관 동의 및 Key 발급받기'. That control CREATES THE KEY."
echo "    • DO NOT PRESS IT in this run. There is no step after it here, and the walk has no tooling that could"
echo "      press it. Actual key issuance is a separate phase, with its own manifest and its own grant."
echo "    • No credential value is read, no connect-test, no sync, no upload. SellerOps cannot tell whether a"
echo "      key exists either way — every sanitized signal is identical on an issued and a no-key surface."
echo
# The terminal disclosure above is what the OPERATOR grants against; the copy that stops them mid-flow is what
# will be on the WING page. Reproduced COMPLETE, so nothing on screen is a surprise.
echo "  WHAT THE LAST STEP SAYS ON THE WING PAGE (complete, Korean — this is what binds):"
# CHECKPOINT-COPY-BEGIN
echo "    ⚠ 여기서 실제로 키가 생성됩니다. '약관 동의 및 Key 발급받기' 버튼을 직접 누르세요 — SellerOps는 이"
echo "    버튼을 절대 누르지 않습니다. 발급이 끝나면 아래 버튼을 누르세요."
# CHECKPOINT-COPY-END
echo
echo "  ⚠ THIS PROOF STOPS BEFORE THAT PRESS. The copy above is the tutorial's own product text, shown here so"
echo "    you can see it before granting — in THIS run you read it and stop."
echo
echo "  If this manifest is correct and displayed, the operator's entire single-use grant is one line:"
echo "    Seated and ready."
echo
echo "  On approval — ONE command, then no terminal for the rest of the run:"
# The phase variables are NOT exported on this command line. They travel in the run-env file, which the installer
# reads and writes into the service's own environment — so the binding survives into a launchd job that inherits
# nothing from this shell. A variable exported here would reach the installer and never reach the agent.
echo "    cd $COLLECTOR_DIR && npx tsx $M_CLI install --run-env $RUN_ENV \\"
# ABSOLUTE, not relative: a relative path would resolve only because launchd honours WorkingDirectory, and a
# connections file that silently fails to load looks exactly like an agent that refuses for a different reason.
echo "      -- --connections $WALK_CONNECTIONS --action-window-coupang-issuance-live"
echo
echo "  Then, with no terminal involved:"
echo "    1. open SellerOps and go to /connect/coupang (the frontend finds the agent on loopback by itself)"
echo "    2. start the guidance — SellerOps requests pairing"
echo "    3. macOS shows the approval dialog with the code; confirm it, and confirm in the SellerOps screen"
echo "    4. the dedicated WING window opens THEN — at the run's first call, not at agent boot"
echo
echo "  The service is bound to THIS approval: its environment carries run=$RUN_ID approval=$APPROVAL_ID"
echo "  git=$RUN_GIT, and the agent refuses to host the carrier if any of them stops matching the tree."
echo "  When the run is over: cd $COLLECTOR_DIR && npx tsx $M_CLI uninstall"
echo
echo "  (Re-bootstrap ⇒ new approval id ⇒ the old approval is dead. A code/branch/run/scope change ⇒ REVOKED.)"
exit 0
