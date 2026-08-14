#!/usr/bin/env bash
#
# Coupang WING 상품평 LOCATE PREFLIGHT — prepares + displays the Approval Manifest for
# COUPANG_WING_REVIEW_LOCATE (READ_ONLY on the marketplace, and on SellerOps).
#
#   tools/coupang-local/wing-review-locate-preflight.sh
#
# Run AFTER wing-review-locate-bootstrap.sh and BEFORE the live run. It proves the run is IMMEDIATELY
# EXECUTABLE (docs/sellerops_live_approval_contract.md §2), then prepares + displays the sanitized Approval
# Manifest. On any check failing it prints NO manifest and requests NO approval.
#
# It checks TWO SellerOps surfaces where the acquisition preflight checks one, because the operator's action
# is not in a terminal: they press [쿠팡에서 보기] in the SellerOps 상품평 screen. A backend that is down
# would leave the press unable to mint a binding, and a frontend that is down would leave them with no button
# at all — both AFTER a live WING window had been opened for nothing.
#
# It launches NO browser, makes NO Coupang call, and reads nothing from any page.
#
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
COLLECTOR_DIR="${SELLEROPS_COLLECTOR_DIR:-$REPO_ROOT/collector}"

PHASE_EXPECTED="COUPANG_WING_REVIEW_LOCATE"
CLI_REL="src/cli/run-coupang-review-locate-live.ts"
RUN_ENV="${SELLEROPS_WING_REVIEW_LOCATE_RUN_ENV:-$HERE/.run/wing-review-locate.env}"

FAILED=0
# shellcheck source=./wing-harness-common.sh
. "$HERE/wing-harness-common.sh"

MANIFEST_OUT="$(resolve_manifest_out "coupang-wing-review-locate")"
if [ -z "$MANIFEST_OUT" ]; then
  echo "PREFLIGHT FAIL — could not create a manifest path under ${TMPDIR:-/tmp}. No manifest prepared, no approval requested."
  exit 1
fi
# A run on a live account, seated: the same single-sitting TTL the credential harness uses.
IDENTITY_TTL_SECONDS=3600

jget() { jget_from "$MANIFEST_OUT" "$1"; }

if [ ! -f "$RUN_ENV" ]; then
  echo "PREFLIGHT FAIL — no run env at $RUN_ENV. Run tools/coupang-local/wing-review-locate-bootstrap.sh first."
  exit 1
fi
# Sourcing only OVERRIDES what the file names, so clear every variable that feeds the manifest first — an
# ambient value must never be able to describe this run as something it is not.
unset WALKTHROUGH_RUN_ID WALKTHROUGH_APPROVAL_ID WALKTHROUGH_GIT_COMMIT WING_REVIEW_BOOTSTRAP_EPOCH \
      SELLEROPS_APPROVAL_PHASE SELLEROPS_WING_APPROVED_PHASE SELLEROPS_APPROVAL_OPERATION \
      SELLEROPS_APPROVAL_MAX SELLEROPS_APPROVAL_ACCOUNT SELLEROPS_APPROVAL_SURFACE SELLEROPS_APPROVAL_CHANNEL
# shellcheck disable=SC1090
set -a; . "$RUN_ENV"; set +a

RUN_ID="${WALKTHROUGH_RUN_ID:-}"
APPROVAL_ID="${WALKTHROUGH_APPROVAL_ID:-}"
RUN_GIT="${WALKTHROUGH_GIT_COMMIT:-}"
BOOTSTRAP_EPOCH="${WING_REVIEW_BOOTSTRAP_EPOCH:-}"
PHASE="${SELLEROPS_APPROVAL_PHASE:-}"
BACKEND_ORIGIN="${SELLEROPS_BASE_URL:-http://localhost:8080}"
FRONTEND_ORIGIN="${SELLEROPS_FRONTEND_URL:-http://localhost:5173}"

echo "Coupang WING 상품평 locate preflight — run=${RUN_ID:-?} git=${RUN_GIT:-?} phase=${PHASE:-?}"
echo "read-only local checks only — no browser, no Coupang call, no page read"
echo

check_identity_bound "$RUN_ID" "$APPROVAL_ID" "$RUN_GIT"
check_identity_fresh "$BOOTSTRAP_EPOCH" "$IDENTITY_TTL_SECONDS"

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
check_toolchain "$COLLECTOR_DIR" "$CLI_REL" "review-locate"
check_dedicated_profile "$COLLECTOR_DIR"
check_browser_launchable

# ── the two SellerOps surfaces the operator's action needs ────────────────────────────────────────────
#
# The press mints a binding at the BACKEND and happens on the FRONTEND. Either being down turns the whole
# sitting into an opened WING window and nothing to do with it, so both are checked before a manifest exists.
if command -v curl >/dev/null 2>&1; then
  TOKEN="$(curl -s --max-time 8 -X POST -H 'Content-Type: application/json' \
    -d "{\"email\":\"${SELLEROPS_EMAIL:-}\",\"password\":\"${SELLEROPS_PASSWORD:-}\"}" \
    "$BACKEND_ORIGIN/api/auth/login" 2>/dev/null | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"
  if [ -z "$TOKEN" ]; then
    fail "could not sign in to the backend at $BACKEND_ORIGIN — the press would have nothing to mint a binding with"
  else
    pass "backend reachable and accepting the SellerOps login (the press can mint its binding)"
  fi
  if curl -s --max-time 8 -o /dev/null -w '%{http_code}' "$FRONTEND_ORIGIN" 2>/dev/null | grep -q '^2'; then
    pass "SellerOps frontend reachable (the operator has a [쿠팡에서 보기] to press)"
  else
    fail "SellerOps frontend is not answering at $FRONTEND_ORIGIN — the operator's action happens THERE, not in a terminal"
  fi
else
  fail "curl is not available — cannot verify the SellerOps surfaces this run depends on"
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
CUR_GIT="$(git_hardened rev-parse --short HEAD 2>/dev/null || echo unknown)"

# Bind the APPROVED PHASE into this run's env, from the MANIFEST (never from the run env it sourced) — the
# three WALKTHROUGH_* identity variables are byte-identical across WING phases, so without this a grant given
# for the ACQUISITION, a run that STORES what it reads, would reach PREPARED for this one, and vice versa.
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

echo "PREFLIGHT PASS"
echo "approval manifest (sanitized) → $MANIFEST_OUT"; sed 's/^/  /' "$MANIFEST_OUT"
echo
echo "  ── APPROVAL MANIFEST (sanitized) ──"
echo "  $M_CHANNEL · $M_OPERATION"
echo "  $M_MODE (agent) · run ${RUN_ID:0:8}… · approval ${APPROVAL_ID:0:8}… · max: $M_MAX"
echo "  phase: $M_PHASE"
echo "  account: $M_ACCOUNT · host: $M_HOST · operator presence: required · expires: process-lifetime · git $CUR_GIT"
echo "  Standing Safety Contract + full scope: docs/sellerops_live_approval_contract.md"
echo
echo "  operator action ($M_ENTRY_TYPE):"
echo "    $M_OPERATOR_ACTION"
echo
echo "  WHAT THIS RUN IS, precisely:"
echo "    • **This run KEEPS NOTHING.** The acquisition run reads these same rows and stores them; this one"
echo "      reads them, compares them to the ONE 상품평 you pressed, outlines that row, and forgets the rest."
echo "      There is no handoff on this path — no review is written to SellerOps by this run at all."
echo "    • What it compares: 노출상품ID, 옵션ID, 등록일, 별점, and a one-way fingerprint of the review body."
echo "      The review's own text never travels — the fingerprint is computed from what SellerOps already"
echo "      stored, and the live row's text is compared to it inside the page and then dropped."
echo "    • **Exactly one match, or nothing.** If no row on the page matches, nothing is outlined and you are"
echo "      told the 상품평 is not on this page. If TWO rows match on every field, nothing is outlined either —"
echo "      an outline around a coin-flip would be SellerOps telling you which of two buyers wrote what."
echo "    • **The buyer is not read.** The 구매자/작성자 column IS located — deliberately — so that it can be"
echo "      the column we do not read, and it is never part of the match. No page HTML, DOM or screenshot is"
echo "      kept anywhere."
echo "    • **You turn every page. SellerOps cannot.** When the 상품평 is not on the page in front of you, the"
echo "      run says so and keeps re-reading what is on screen while you page — so the outline appears when you"
echo "      arrive, without you coming back to SellerOps to press anything."
echo "    • **Where you act: the SellerOps 상품평 화면**, not this terminal. The window this run opens is the"
echo "      Coupang one; the button is in SellerOps."
echo "    • Nothing is clicked, typed, submitted, or sent on the Coupang screen. Zero marketplace actions."
echo
echo "  If this manifest is correct and displayed, say the one line that tells the assistant to start it:"
echo "    Seated and ready."
echo
echo "  That line does NOT authorize the run. The run opens a 'SellerOps 확인' tab, shows you these same"
echo "  binding fields, and starts ONLY when you press the button on it yourself. No press, no run."
echo
echo "  On approval — the run env carries the identity, so it must be SOURCED, not just the phase vars:"
echo "    cd $COLLECTOR_DIR && set -a && . $RUN_ENV && set +a && \\"
echo "      npx tsx $M_CLI -- --i-understand-this-opens-live-coupang-wing"
echo
echo "  (Re-bootstrap ⇒ new approval id ⇒ the old approval is dead. A code/branch/run/scope change ⇒ REVOKED.)"
exit 0
