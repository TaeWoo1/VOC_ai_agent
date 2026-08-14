#!/usr/bin/env bash
#
# Coupang WING 고객문의 list-calibration PREFLIGHT — prepares + displays the Approval Manifest for
# COUPANG_WING_INQUIRY_LIST_CALIBRATION (READ_ONLY).
#
#   tools/coupang-local/wing-inquiry-preflight.sh
#
# Run AFTER wing-inquiry-bootstrap.sh and BEFORE the live run. It proves the run is IMMEDIATELY EXECUTABLE
# (docs/sellerops_live_approval_contract.md §2), then prepares + displays the sanitized Approval Manifest. On
# any check failing it prints NO manifest and requests NO approval.
#
# It launches NO browser, makes NO Coupang call, reads nothing from any page, and mutates nothing. There is no
# backend check here because this run has no backend leg: it opens a window, counts, and prints integers.
#
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
COLLECTOR_DIR="${SELLEROPS_COLLECTOR_DIR:-$REPO_ROOT/collector}"

PHASE_EXPECTED="COUPANG_WING_INQUIRY_LIST_CALIBRATION"
CLI_REL="src/cli/calibrate-inquiry-list.ts"
RUN_ENV="${SELLEROPS_WING_INQUIRY_RUN_ENV:-$HERE/.run/wing-inquiry-calibration.env}"

FAILED=0
# shellcheck source=./wing-harness-common.sh
. "$HERE/wing-harness-common.sh"

MANIFEST_OUT="$(resolve_manifest_out "coupang-wing-inquiry-calibration")"
if [ -z "$MANIFEST_OUT" ]; then
  echo "PREFLIGHT FAIL — could not create a manifest path under ${TMPDIR:-/tmp}. No manifest prepared, no approval requested."
  exit 1
fi
# A run on a live account, seated: the same single-sitting TTL the credential harness uses.
IDENTITY_TTL_SECONDS=3600

jget() { jget_from "$MANIFEST_OUT" "$1"; }

if [ ! -f "$RUN_ENV" ]; then
  echo "PREFLIGHT FAIL — no run env at $RUN_ENV. Run tools/coupang-local/wing-inquiry-bootstrap.sh first."
  exit 1
fi
# Sourcing only OVERRIDES what the file names, so clear every variable that feeds the manifest first — an
# ambient value must never be able to describe this run as something it is not.
unset WALKTHROUGH_RUN_ID WALKTHROUGH_APPROVAL_ID WALKTHROUGH_GIT_COMMIT WING_INQUIRY_BOOTSTRAP_EPOCH \
      SELLEROPS_APPROVAL_PHASE SELLEROPS_WING_APPROVED_PHASE SELLEROPS_APPROVAL_OPERATION \
      SELLEROPS_APPROVAL_MAX SELLEROPS_APPROVAL_ACCOUNT SELLEROPS_APPROVAL_SURFACE SELLEROPS_APPROVAL_CHANNEL
# shellcheck disable=SC1090
set -a; . "$RUN_ENV"; set +a

RUN_ID="${WALKTHROUGH_RUN_ID:-}"
APPROVAL_ID="${WALKTHROUGH_APPROVAL_ID:-}"
RUN_GIT="${WALKTHROUGH_GIT_COMMIT:-}"
BOOTSTRAP_EPOCH="${WING_INQUIRY_BOOTSTRAP_EPOCH:-}"
PHASE="${SELLEROPS_APPROVAL_PHASE:-}"
TARGETS="${SELLEROPS_INQUIRY_TARGET_IDS:-}"

echo "Coupang WING 고객문의 calibration preflight — run=${RUN_ID:-?} git=${RUN_GIT:-?} phase=${PHASE:-?}"
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
check_toolchain "$COLLECTOR_DIR" "$CLI_REL" "inquiry-calibration"
check_dedicated_profile "$COLLECTOR_DIR"
check_browser_launchable

# ── the identifiers this run will look for ────────────────────────────────────────────────────────────
#
# Checked HERE and not only in the CLI so a missing or malformed target refuses before a manifest is displayed
# rather than after the operator has granted one. The manifest says how many identifiers the run carries; it
# does NOT print them — they are ours, but they are still account data, and a count is what the operator needs.
if [ -z "$TARGETS" ]; then
  fail "SELLEROPS_INQUIRY_TARGET_IDS is unset — with no identifier to look for there is nothing to measure"
else
  TARGET_COUNT="$(printf '%s' "$TARGETS" | tr ',' '\n' | grep -cE '^[a-zA-Z][a-zA-Z0-9_]{0,32}:[0-9]{1,24}$' || true)"
  TOTAL_PAIRS="$(printf '%s' "$TARGETS" | tr ',' '\n' | grep -c . || true)"
  if [ "${TARGET_COUNT:-0}" -gt 0 ] && [ "$TARGET_COUNT" = "$TOTAL_PAIRS" ]; then
    pass "$TARGET_COUNT target identifier(s) present and well-formed (id:digits; never printed here)"
  else
    fail "SELLEROPS_INQUIRY_TARGET_IDS has a malformed pair — expected id:digits (e.g. inquiryId:158421449). The run would silently search for something other than what you named"
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
CUR_GIT="$(git_hardened rev-parse --short HEAD 2>/dev/null || echo unknown)"

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
echo "    • You reach your own WING 고객문의 list. SellerOps opens the window and nothing else — no login, no"
echo "      navigation, no clicks."
echo "    • It then COUNTS: how the rows are arranged, how many there are, how many carry a number at all, how"
echo "      many offer a way into a detail view, and how many say 답변완료 / 미답변."
echo "    • It asks the page whether any row carries an identifier SellerOps ALREADY HOLDS — the identifiers go"
echo "      IN, and a count comes back. 0 and 2 are both refusals; only exactly 1 is a target."
echo "    • **It does not read what your customers wrote.** There is no code path in this phase that returns"
echo "      row text — not behind a flag, not after a confirmation. Only integers leave the page."
echo "    • Nothing is clicked, typed, submitted, replied to, highlighted, or sent anywhere."
echo "    • Why this exists: nothing about that screen has ever been measured, and a locator written from a"
echo "      guess would point a seller at the wrong customer's question."
echo
echo "  If this manifest is correct and displayed, say the one line that tells the assistant to start it:"
echo "    Seated and ready."
echo
echo "  That line does NOT authorize the run. The run opens a 'SellerOps 확인' tab, shows you these same"
echo "  binding fields, and starts ONLY when you press the button on it yourself. No press, no run."
echo
echo "  On approval — the run env carries the identity, so it must be SOURCED, not just the phase vars:"
echo "    cd $COLLECTOR_DIR && set -a && . $RUN_ENV && set +a && \\"
echo "      SELLEROPS_INQUIRY_TARGET_IDS=\$SELLEROPS_INQUIRY_TARGET_IDS \\"
echo "      npx tsx $M_CLI -- --i-understand-this-opens-live-coupang-wing"
echo
echo "  (Re-bootstrap ⇒ new approval id ⇒ the old approval is dead. A code/branch/run/scope change ⇒ REVOKED.)"
exit 0
