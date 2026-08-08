#!/usr/bin/env bash
#
# Coupang WING open-API KEY-DELETION PREFLIGHT — the DESTRUCTIVE sibling of wing-probe-preflight.sh.
#
# Run AFTER wing-deletion-bootstrap.sh and BEFORE any live WING run. It proves the run is IMMEDIATELY
# EXECUTABLE (docs/sellerops_live_approval_contract.md §2), then prepares + displays the sanitized destructive
# Approval Manifest together with the irreversibility disclosure the operator must read before granting. On any
# check failing it prints NO manifest and requests NO approval.
#
# It launches NO browser, makes NO Coupang call, DELETES NOTHING, reads no credential/.env value, and mutates
# nothing at all — unlike the probe preflight it writes nothing back, because the destructive phase has no
# per-run scope to bind: channel / account / surface / operation / action budget are pinned in the phase spec.
#
# The manifest is NEVER hand-written here: the tested gate `collector/src/cli/approval-manifest-cli.ts` is its
# sole source, so the CLI/driver/actions/mode/descriptor the operator approves are exactly what the phase spec
# permits. That gate ALSO re-verifies HEAD + a clean tree itself (`collector/src/cli/repo-identity.ts`), as does
# the runtime CLI — so a hand-typed invocation that skips this script does not skip those checks. The shell
# copies here exist to give the operator an actionable message before the gate is reached.
#
# Run it in the SAME shell that will run the deletion — `PREPARED` means nothing more is asked of the operator.
#
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
COLLECTOR_DIR="${SELLEROPS_COLLECTOR_DIR:-$REPO_ROOT/collector}"
RUN_ENV="${SELLEROPS_WING_DELETION_RUN_ENV:-$HERE/.run/wing-deletion.env}"

FAILED=0
# shellcheck source=./wing-harness-common.sh
. "$HERE/wing-harness-common.sh"

MANIFEST_OUT="$(resolve_manifest_out coupang-wing-deletion)"
if [ -z "$MANIFEST_OUT" ]; then
  echo "PREFLIGHT FAIL — could not create a manifest path under ${TMPDIR:-/tmp}. No manifest prepared, no approval requested."
  exit 1
fi
# A bootstrapped identity authorizes preparation only for the session that minted it (contract §2:
# `expiresAt: process-lifetime`). One hour for a destructive run — deliberately tighter than the read-only
# probe's two, because the blast radius of acting on a stale identity here is an unrecoverable key.
IDENTITY_TTL_SECONDS=3600

# ---- 0. run identity (required; from wing-deletion-bootstrap.sh) --------------
if [ ! -f "$RUN_ENV" ]; then
  echo "PREFLIGHT FAIL — no run env at $RUN_ENV. Run tools/coupang-local/wing-deletion-bootstrap.sh first."
  exit 1
fi
# Sourcing only OVERRIDES what the file names, so a run env missing a key would let the caller's ambient value
# stand in for a bootstrapped one. Clear every variable that feeds the manifest first — including the free-text
# fields. For this phase the gate pins channel/account/surface/operation/maxActions and refuses a deviation
# (DESTRUCTIVE_SCOPE_MISMATCH), so an ambient value cannot change what is displayed; unsetting them anyway
# means the operator sees a refusal from their own stale shell rather than a confusing gate error.
unset WALKTHROUGH_RUN_ID WALKTHROUGH_APPROVAL_ID WALKTHROUGH_GIT_COMMIT WING_DELETION_BOOTSTRAP_EPOCH \
      SELLEROPS_WING_APPROVED_PHASE SELLEROPS_APPROVAL_PHASE SELLEROPS_WING_PROBE_TARGETS SELLEROPS_WING_APPROVED_TARGETS \
      SELLEROPS_APPROVAL_OPERATION SELLEROPS_APPROVAL_MAX SELLEROPS_APPROVAL_ACCOUNT \
      SELLEROPS_APPROVAL_SURFACE SELLEROPS_APPROVAL_CHANNEL
# shellcheck disable=SC1090
set -a; . "$RUN_ENV"; set +a

RUN_ID="${WALKTHROUGH_RUN_ID:-}"
APPROVAL_ID="${WALKTHROUGH_APPROVAL_ID:-}"
RUN_GIT="${WALKTHROUGH_GIT_COMMIT:-}"
BOOTSTRAP_EPOCH="${WING_DELETION_BOOTSTRAP_EPOCH:-}"
PHASE="${SELLEROPS_APPROVAL_PHASE:-}"

echo "Coupang WING key-DELETION preflight — run=${RUN_ID:-?} git=${RUN_GIT:-?} phase=${PHASE:-?}"
echo "read-only local checks only — no browser, no Coupang call, no credential read, NOTHING deleted"
echo

check_identity_bound "$RUN_ID" "$APPROVAL_ID" "$RUN_GIT"
check_identity_fresh "$BOOTSTRAP_EPOCH" "$IDENTITY_TTL_SECONDS"

# The phase must be the DESTRUCTIVE deletion phase. This harness prepares that phase and no other — the
# read-only selector probe has its own harness, and preparing it from here would let a destructive bootstrap's
# disclosure copy be shown for a run that is not destructive (or, worse, the reverse).
[ "$PHASE" = "COUPANG_WING_KEY_DELETION" ] \
  && pass "phase is COUPANG_WING_KEY_DELETION (agent READ_ONLY; operator-performed irreversible delete)" \
  || fail "phase must be COUPANG_WING_KEY_DELETION (got '${PHASE:-unset}') — this harness prepares no other phase"

# The collector must be THIS repository's collector. Otherwise the drift check verifies one checkout while the
# manifest is produced by another (`approval-manifest-cli.ts` derives its own repo root from its file location),
# and the displayed `git <sha>` would describe a tree the gate never looked at. Not an escape — the TS side stays
# self-consistent — but a manifest whose provenance line is incoherent must not be shown for a destructive grant.
COLLECTOR_REAL="$(realpath_of "$COLLECTOR_DIR")"
EXPECTED_COLLECTOR="$(realpath_of "$REPO_ROOT/collector")"
if [ -n "$COLLECTOR_REAL" ] && [ -n "$EXPECTED_COLLECTOR" ] && [ "$COLLECTOR_REAL" = "$EXPECTED_COLLECTOR" ]; then
  pass "collector is this repository's collector (the verified tree is the one that builds the manifest)"
else
  fail "SELLEROPS_COLLECTOR_DIR points outside this repository — the drift check and the manifest would describe different checkouts. Unset it and re-run"
fi

check_no_code_drift "$RUN_GIT"
check_toolchain "$COLLECTOR_DIR" "src/cli/run-coupang-wing-deletion-live.ts" "deletion"
check_dedicated_profile "$COLLECTOR_DIR"
check_browser_launchable

# ---- Approval Manifest --------------------------------------------------------
# Prepared ONLY when every check above passed — a manifest is displayed only when the run is immediately
# executable (contract §2). The tested gate is the sole source; a non-zero exit prints its
# `PREFLIGHT FAIL: approval_prerequisite (<cause>)` / `repo_identity (<cause>)` and nothing else.
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

# Every display field is READ FROM the tested manifest — never re-typed here. A missing field aborts: a blank
# line under a PASS banner would be an unnoticed change in what the operator is approving. An assignment's exit
# status IS the command substitution's, so a missing field is caught at the assignment.
FIELD_FAIL=0
M_CHANNEL="$(jget_from "$MANIFEST_OUT" channel)" || FIELD_FAIL=1
M_OPERATION="$(jget_from "$MANIFEST_OUT" operation)" || FIELD_FAIL=1
M_MODE="$(jget_from "$MANIFEST_OUT" mode)" || FIELD_FAIL=1
M_ACCOUNT="$(jget_from "$MANIFEST_OUT" accountBinding)" || FIELD_FAIL=1
M_MAX="$(jget_from "$MANIFEST_OUT" maxActions)" || FIELD_FAIL=1
M_PHASE="$(jget_from "$MANIFEST_OUT" phase)" || FIELD_FAIL=1
M_CLI="$(jget_from "$MANIFEST_OUT" cli)" || FIELD_FAIL=1
M_HOST="$(jget_from "$MANIFEST_OUT" apiCenterHost)" || FIELD_FAIL=1
M_CALIBRATED="$(jget_from "$MANIFEST_OUT" selectorsCalibrated)" || FIELD_FAIL=1
M_ENTRY_TYPE="$(jget_from "$MANIFEST_OUT" entrypointType)" || FIELD_FAIL=1
M_OPERATOR_ACTION="$(jget_from "$MANIFEST_OUT" operatorActionSummary)" || FIELD_FAIL=1
if [ "$FIELD_FAIL" != "0" ]; then
  echo "PREFLIGHT FAIL — the prepared manifest is missing a field this display depends on; refusing to show a partial manifest."
  exit 1
fi

# The gate re-derives the phase itself; a manifest for any other phase must never be displayed by this harness.
if [ "$M_PHASE" != "COUPANG_WING_KEY_DELETION" ]; then
  echo "PREFLIGHT FAIL — the prepared manifest is for phase $M_PHASE, not the destructive key deletion. Refusing."
  exit 1
fi

# The destructive descriptor is the contract the operator is granting against. The gate already enforces it
# field-by-field (DESTRUCTIVE_ACTION_CONTRACT_MISMATCH); it is re-read HERE so a softened descriptor can never
# be DISPLAYED as if it were the canonical one. Compared against the exact literals, not merely printed.
if ! verify_destructive_descriptor "$MANIFEST_OUT"; then
  echo "PREFLIGHT FAIL — the destructive-action descriptor is missing or softened. Refusing to display it for approval."
  exit 1
fi
pass "destructive descriptor is exactly the canonical contract (irreversible · agent performs nothing · checkpoint required · 0 value reads)"

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

# The 삭제 selector must be calibrated. The gate refuses SELECTORS_NOT_CALIBRATED before reaching here, so this
# can only be `true` — it is asserted anyway so a future change that lets an uncalibrated destructive manifest
# through is caught at the display, not by the operator.
if [ "$M_CALIBRATED" != "true" ]; then
  echo "PREFLIGHT FAIL — the manifest reports selectorsCalibrated=$M_CALIBRATED. A destructive highlight run requires a calibrated 삭제 selector. Refusing."
  exit 1
fi

echo
echo "PREFLIGHT PASS"
echo "approval manifest (sanitized) → $MANIFEST_OUT"; sed 's/^/  /' "$MANIFEST_OUT"
echo
echo "  ── APPROVAL MANIFEST (sanitized · DESTRUCTIVE) ──"
echo "  $M_CHANNEL · $M_OPERATION"
echo "  agent mode: $M_MODE · run ${RUN_ID:0:8}… · approval ${APPROVAL_ID:0:8}… · max: $M_MAX"
echo "  phase: $M_PHASE · selectors calibrated: $M_CALIBRATED"
echo "  account: $M_ACCOUNT · host: $M_HOST · operator presence: required · expires: process-lifetime · git $CUR_GIT"
echo "  Standing Safety Contract + full scope: docs/sellerops_live_approval_contract.md"
echo
echo "  ⚠⚠  READ THIS BEFORE GRANTING — THIS RUN LEADS TO AN IRREVERSIBLE DELETION  ⚠⚠"
echo
echo "    1. Deleting the key is PERMANENT. It cannot be undone."
echo "    2. Your EXISTING Access Key / Secret Key stop working IMMEDIATELY. Every signed Coupang call"
echo "       from SellerOps — and from anything else using that key — fails from that moment."
echo "    3. RECOVERY IS NOT AN UNDO: you must issue a BRAND-NEW key in WING and then REPLACE the"
echo "       credential in SellerOps. Until you do both, the Coupang connection is down."
echo "    4. SellerOps DOES NOT DELETE. The agent highlights the 삭제 control, shows an irreversible-warning"
echo "       checkpoint, and stops. Its click / type / submit budget on the marketplace is ZERO."
echo "    5. YOU press 삭제 yourself, on the WING page, after reading that checkpoint."
echo
echo "  operator action ($M_ENTRY_TYPE):"
echo "    $M_OPERATOR_ACTION"
echo
echo "  If this manifest is correct and you accept 1–5 above, the single-use grant is one line:"
echo "    Seated and ready."
echo
echo "  On approval, run the deletion entrypoint in THIS shell (it re-verifies HEAD + a clean tree itself):"
# BOTH phase variables travel on the command, like the probe harness does with its scope variables: the CLI
# refuses unless they are present and both name this phase, so a run env from another WING action cannot
# authorize this entrypoint even if it is still exported in the shell.
echo "    cd $COLLECTOR_DIR && SELLEROPS_APPROVAL_PHASE=$M_PHASE SELLEROPS_WING_APPROVED_PHASE=$M_PHASE \\"
echo "      npx tsx $M_CLI -- --i-understand-this-opens-live-coupang-wing"
echo
echo "  (Re-bootstrap ⇒ new approval id ⇒ the old approval is dead. A code/branch/run/scope change ⇒ REVOKED.)"
exit 0
