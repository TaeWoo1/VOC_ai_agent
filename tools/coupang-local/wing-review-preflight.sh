#!/usr/bin/env bash
#
# Coupang WING 상품평 structure-discovery PREFLIGHT — prepares + displays the Approval Manifest for
# COUPANG_WING_REVIEW_STRUCTURE_DISCOVERY (READ_ONLY).
#
#   tools/coupang-local/wing-review-preflight.sh
#
# Run AFTER wing-review-bootstrap.sh and BEFORE the live run. It proves the run is IMMEDIATELY EXECUTABLE
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

PHASE_EXPECTED="COUPANG_WING_REVIEW_STRUCTURE_DISCOVERY"
CLI_REL="src/cli/calibrate-review-list.ts"
RUN_ENV="${SELLEROPS_WING_REVIEW_RUN_ENV:-$HERE/.run/wing-review-discovery.env}"

FAILED=0
# shellcheck source=./wing-harness-common.sh
. "$HERE/wing-harness-common.sh"

MANIFEST_OUT="$(resolve_manifest_out "coupang-wing-review-discovery")"
if [ -z "$MANIFEST_OUT" ]; then
  echo "PREFLIGHT FAIL — could not create a manifest path under ${TMPDIR:-/tmp}. No manifest prepared, no approval requested."
  exit 1
fi
# A run on a live account, seated: the same single-sitting TTL the credential harness uses.
IDENTITY_TTL_SECONDS=3600

jget() { jget_from "$MANIFEST_OUT" "$1"; }

if [ ! -f "$RUN_ENV" ]; then
  echo "PREFLIGHT FAIL — no run env at $RUN_ENV. Run tools/coupang-local/wing-review-bootstrap.sh first."
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
PRODUCT_IDS="${SELLEROPS_REVIEW_PRODUCT_IDS:-}"

echo "Coupang WING 상품평 discovery preflight — run=${RUN_ID:-?} git=${RUN_GIT:-?} phase=${PHASE:-?}"
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
check_toolchain "$COLLECTOR_DIR" "$CLI_REL" "review-discovery"
check_dedicated_profile "$COLLECTOR_DIR"
check_browser_launchable

# ── the OPTIONAL catalog-scope identifiers ────────────────────────────────────────────────────────────
#
# Optional, unlike every other WING calibration's, and the difference is the point: Coupang publishes no review
# API, so SellerOps holds no review id. A run that refused to start without an identifier could never measure
# the screen it exists to measure. What a product id buys is one extra question — whether the reviews on the
# screen belong to items we know about — and the run is honest without it.
#
# Checked HERE as well as in the CLI so a MALFORMED pair refuses before a manifest is displayed rather than
# after the operator has granted one. The count is shown; the identifiers are not — they are ours, but they are
# still account data.
if [ -z "$PRODUCT_IDS" ]; then
  pass "no product identifiers supplied — the structure and reply readings do not need one (catalog scope will report NOT_ESTABLISHED)"
else
  ID_COUNT="$(printf '%s' "$PRODUCT_IDS" | tr ',' '\n' | grep -cE '^[a-zA-Z][a-zA-Z0-9_]{0,32}:[0-9]{1,24}$' || true)"
  TOTAL_PAIRS="$(printf '%s' "$PRODUCT_IDS" | tr ',' '\n' | grep -c . || true)"
  if [ "${ID_COUNT:-0}" -gt 0 ] && [ "$ID_COUNT" = "$TOTAL_PAIRS" ]; then
    pass "$ID_COUNT product identifier(s) present and well-formed (id:digits; never printed here)"
  else
    fail "SELLEROPS_REVIEW_PRODUCT_IDS has a malformed pair — expected id:digits (e.g. productId:15411270785). The run would silently search for something other than what you named"
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

# Bind the APPROVED PHASE into this run's env, from the MANIFEST (never from the run env it sourced) — the
# three WALKTHROUGH_* identity variables are byte-identical across WING phases, so without this a grant given
# for one phase would reach PREPARED in another. The CLI refuses when it is absent, which is how this being
# missing was caught: the run stopped rather than starting under an unbound phase.
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
echo "    • You reach your own WING 상품평(리뷰) list. SellerOps opens the window and nothing else — no login,"
echo "      no navigation, no clicks."
echo "    • It starts from the column you found: **노출상품ID (옵션ID)**. It resolves that ONE column and reads"
echo "      it as counts — how many cells, how many print two numbers, how many DIFFERENT products and options"
echo "      are on screen. **The numbers themselves never come out.** Those cells are one-per-review, so they"
echo "      are also what tells SellerOps where a review row starts and ends — a far better anchor than field"
echo "      words, which on this screen all sit in one header cell."
echo "    • The one question it exists to answer: **could these reviews be COLLECTED and DE-DUPLICATED?**"
echo "      That needs a number that is on every review and DIFFERENT on each one. So for each digit length it"
echo "      counts two things — how many reviews carry one, and how many different values there are. Equal"
echo "      counts mean a usable key; many reviews sharing one value means a category code that would fold"
echo "      every review into a single row."
echo "    • It has NO review number to look for. Coupang publishes no review API, so SellerOps holds none —"
echo "      this screen is first contact. And a 상품ID is NOT a review id: many reviews share one product, so"
echo "      collecting on it would fold them together. The counts are what tell those apart."
echo "    • It also measures: which repeating unit Coupang's own words (평점 · 작성일 · 상품평 …) agree on, how"
echo "      many units carry a photo, a video, a rating widget or their own detail link, and which sort /"
echo "      period / paging controls exist — which is what decides whether collection could ever be"
echo "      incremental rather than a full re-read."
echo "    • **It does not look for a seller reply feature.** You established WING has none, so the question is"
echo "      closed and the words are not in the run at all — kept-but-unused measurements get used later."
echo "    • **What your customers wrote never leaves this window.** No review body, no buyer name and no"
echo "      product name is read into any result. Photos and videos are COUNTED — their addresses are never"
echo "      read. Dates come back as WHICH FORMAT matched and how many, never as a date. Review numbers come"
echo "      back as a LENGTH and a count of how many differ — never as a number."
echo "    • The page's text is compared, inside the page, against fixed Coupang words and date/rating shape"
echo "      patterns SellerOps supplied, and only the COUNT comes out. No link address and no class name is"
echo "      returned, logged, or written down anywhere."
echo "    • Nothing is clicked, typed, submitted, highlighted, or sent anywhere."
echo "    • Why this exists: without a stable identifier there is no dedupe key, and an acquisition designed"
echo "      before that is known would either duplicate every review or silently collapse them."
echo
echo "  If this manifest is correct and displayed, say the one line that tells the assistant to start it:"
echo "    Seated and ready."
echo
echo "  That line does NOT authorize the run. The run opens a 'SellerOps 확인' tab, shows you these same"
echo "  binding fields, and starts ONLY when you press the button on it yourself. No press, no run."
echo
echo "  On approval — the run env carries the identity, so it must be SOURCED, not just the phase vars:"
echo "    cd $COLLECTOR_DIR && set -a && . $RUN_ENV && set +a && \\"
echo "      SELLEROPS_REVIEW_PRODUCT_IDS=\$SELLEROPS_REVIEW_PRODUCT_IDS \\"
echo "      npx tsx $M_CLI -- --i-understand-this-opens-live-coupang-wing"
echo
echo "  (Re-bootstrap ⇒ new approval id ⇒ the old approval is dead. A code/branch/run/scope change ⇒ REVOKED.)"
exit 0
