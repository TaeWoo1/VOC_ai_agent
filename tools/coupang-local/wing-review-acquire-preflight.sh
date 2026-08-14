#!/usr/bin/env bash
#
# Coupang WING 상품평 ACQUISITION PREFLIGHT — prepares + displays the Approval Manifest for
# COUPANG_WING_REVIEW_ACQUISITION (READ_ONLY on the marketplace).
#
#   tools/coupang-local/wing-review-acquire-preflight.sh
#
# Run AFTER wing-review-acquire-bootstrap.sh and BEFORE the live run. It proves the run is IMMEDIATELY
# EXECUTABLE (docs/sellerops_live_approval_contract.md §2), then prepares + displays the sanitized Approval
# Manifest. On any check failing it prints NO manifest and requests NO approval.
#
# Unlike the structure-discovery preflight next door, this one DOES check a backend: the run reads reviews and
# hands them to SellerOps, so a backend that is down would leave a sitting having read a page of what customers
# wrote with nowhere to put it. It launches NO browser, makes NO Coupang call, and reads nothing from any page.
#
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
COLLECTOR_DIR="${SELLEROPS_COLLECTOR_DIR:-$REPO_ROOT/collector}"

PHASE_EXPECTED="COUPANG_WING_REVIEW_ACQUISITION"
CLI_REL="src/cli/acquire-coupang-reviews.ts"
RUN_ENV="${SELLEROPS_WING_REVIEW_ACQUIRE_RUN_ENV:-$HERE/.run/wing-review-acquisition.env}"

FAILED=0
# shellcheck source=./wing-harness-common.sh
. "$HERE/wing-harness-common.sh"

MANIFEST_OUT="$(resolve_manifest_out "coupang-wing-review-acquisition")"
if [ -z "$MANIFEST_OUT" ]; then
  echo "PREFLIGHT FAIL — could not create a manifest path under ${TMPDIR:-/tmp}. No manifest prepared, no approval requested."
  exit 1
fi
# A run on a live account, seated: the same single-sitting TTL the credential harness uses.
IDENTITY_TTL_SECONDS=3600

jget() { jget_from "$MANIFEST_OUT" "$1"; }

if [ ! -f "$RUN_ENV" ]; then
  echo "PREFLIGHT FAIL — no run env at $RUN_ENV. Run tools/coupang-local/wing-review-acquire-bootstrap.sh first."
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
SLOT="${SELLEROPS_REVIEW_ACCOUNT_SLOT:-}"
BACKEND_ORIGIN="${SELLEROPS_BASE_URL:-http://localhost:8080}"

echo "Coupang WING 상품평 acquisition preflight — run=${RUN_ID:-?} git=${RUN_GIT:-?} phase=${PHASE:-?}"
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
check_toolchain "$COLLECTOR_DIR" "$CLI_REL" "review-acquisition"
check_dedicated_profile "$COLLECTOR_DIR"
check_browser_launchable

# ── the account these reviews belong to ───────────────────────────────────────────────────────────────
#
# REQUIRED, unlike the structure discovery's optional product ids, and the difference is what the run does with
# it. That run measured a screen and stored nothing, so it needed no connection. This one stores reviews, and a
# collection with no account named would have to guess which connection they belong to — on an org with two
# Coupang accounts, a guess is somebody else's reviews in somebody's list.
#
# Checked HERE as well as in the CLI so a missing binding refuses before a manifest is displayed rather than
# after the operator has granted one. The slot is opaque and never a seller-account id; it is not printed.
if [ -z "$SLOT" ]; then
  fail "SELLEROPS_REVIEW_ACCOUNT_SLOT is not set — a collection with no account named cannot say whose reviews these are"
else
  case "$SLOT" in
    *[!0-9a-f]*) fail "SELLEROPS_REVIEW_ACCOUNT_SLOT is not lowercase hex" ;;
    *) [ "${#SLOT}" = "24" ] \
         && pass "account slot present and well-formed (opaque; never a seller-account id, never printed)" \
         || fail "SELLEROPS_REVIEW_ACCOUNT_SLOT must be 24 hex characters (got ${#SLOT})" ;;
  esac
fi

# ── the backend leg ───────────────────────────────────────────────────────────────────────────────────
#
# The run establishes its backend session BEFORE the operator is asked for anything, precisely so a sitting
# cannot read a page and then discover it has nowhere to put it. This check is the same fact, one step earlier:
# it refuses to display a manifest for a run whose destination is not there.
if command -v curl >/dev/null 2>&1; then
  TOKEN="$(curl -s --max-time 8 -X POST -H 'Content-Type: application/json' \
    -d "{\"email\":\"${SELLEROPS_EMAIL:-}\",\"password\":\"${SELLEROPS_PASSWORD:-}\"}" \
    "$BACKEND_ORIGIN/api/auth/login" 2>/dev/null | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"
  if [ -z "$TOKEN" ]; then
    fail "could not sign in to the backend at $BACKEND_ORIGIN — the run would read reviews and have nowhere to put them"
  else
    pass "backend reachable and accepting the SellerOps login (the reviews have somewhere to go)"
  fi
else
  fail "curl is not available — cannot verify the backend this run hands reviews to"
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
# for the structure DISCOVERY, a run that returns no text, would reach PREPARED for this one, which returns
# review bodies.
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
echo "    • This run COLLECTS. Every earlier 상품평 run counted and printed integers; this one reads what your"
echo "      customers wrote and stores it in SellerOps. That is the whole difference, and it is why this is a"
echo "      separate approval rather than a flag on the last one."
echo "    • What is stored, per review: the review text where there is any, the 별점, the 등록일, the"
echo "      노출상품ID (옵션ID), and how"
echo "      many photos/videos the review itself carries. Each column is found by the header word Coupang"
echo "      itself printed — not by position, so a moved column stops the run instead of reading the wrong one."
echo "    • **The buyer is not collected, and that is structural rather than a promise.** The 구매자/작성자"
echo "      column IS located — deliberately — so that it can be the column we do not read. There is no field"
echo "      for a name on the wire, none in the stored record, and no column in the database. A photo is"
echo "      COUNTED; its address is never read. No page HTML, no DOM, no screenshot is kept anywhere."
echo "    • **You turn every page. SellerOps cannot.** One press per page: bring a page up, press [현재 화면"
echo "      확인], and it reads that page. Press again after you turn the page. The second button ends the"
echo "      collection whenever you choose."
echo "    • **Re-reading is free.** The same review read twice is stored once — it is recognised by its own"
echo "      content, because Coupang's screen carries no review number to recognise it by. So a re-run, an"
echo "      accidental double press, and a re-collection next week all cost nothing."
echo "    • **'Collected everything' is a reading, not a guess.** The run looks at the page numbers on your"
echo "      screen and says the list is finished only when they say the last page is showing. If it cannot"
echo "      read them, it stops and reports that it did NOT finish — it never assumes."
echo "    • It also walks every page on a RE-collection, not just the new ones. Stopping early at a page of"
echo "      familiar reviews would only be safe if this list were sorted newest-first, and that has never been"
echo "      proven on the real screen."
echo "    • **A 별점 with nothing written under it IS stored** — a score with no words is still a customer"
echo "      telling you something. Coupang prints '등록된 내용이 없습니다.' in that cell, and that sentence is"
echo "      never kept as if a person had written it: the review is stored with no text at all. Such a review"
echo "      is told apart by the 옵션 it was left on, so two options stay two reviews — but two of them on the"
echo "      SAME option, the same day, at the same 별점 cannot be told apart and become one. That is a known"
echo "      limit of this version, accepted rather than fixed by recording a buyer name or a row position."
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
echo "      SELLEROPS_REVIEW_ACCOUNT_SLOT=\$SELLEROPS_REVIEW_ACCOUNT_SLOT \\"
echo "      npx tsx $M_CLI -- --i-understand-this-opens-live-coupang-wing"
echo
echo "  (Re-bootstrap ⇒ new approval id ⇒ the old approval is dead. A code/branch/run/scope change ⇒ REVOKED.)"
exit 0
