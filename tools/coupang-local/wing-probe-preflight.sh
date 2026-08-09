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

FAILED=0
# The shared checks — identical hardening to the DESTRUCTIVE deletion harness, deliberately one copy:
# git_hardened / jget_from / identity / freshness / drift / toolchain / profile / browser / manifest path.
# shellcheck source=./wing-harness-common.sh
. "$HERE/wing-harness-common.sh"

MANIFEST_OUT="$(resolve_manifest_out coupang-wing-probe)"
if [ -z "$MANIFEST_OUT" ]; then
  echo "PREFLIGHT FAIL — could not create a manifest path under ${TMPDIR:-/tmp}. No manifest prepared, no approval requested."
  exit 1
fi
# A bootstrapped identity authorizes preparation only for the session that minted it (contract §2:
# `expiresAt: process-lifetime`). Two hours is the outer bound for one seated calibration session.
IDENTITY_TTL_SECONDS=7200

# The probe's manifest reader binds the shared helper to THIS run's manifest path.
jget() { jget_from "$MANIFEST_OUT" "$1"; }

# ---- 0. run identity (required; from wing-probe-bootstrap.sh) -----------------
if [ ! -f "$RUN_ENV" ]; then
  echo "PREFLIGHT FAIL — no run env at $RUN_ENV. Run tools/coupang-local/wing-probe-bootstrap.sh first."
  exit 1
fi
# Sourcing only OVERRIDES what the file names, so a run env missing a key would let the caller's ambient
# value stand in for a bootstrapped one. Clear every variable that feeds the manifest first.
#
# That includes the manifest's free-text fields. They change no enforced capability — phase, cli, driver,
# mode, allowedActions, probeTargets and selectorsCalibrated are all derived from the phase spec — but they
# ARE the prose the operator reads before saying "Seated and ready.", and an ambient
# SELLEROPS_APPROVAL_OPERATION could describe the run as something it is not. Everything displayed comes
# from the spec or from this run's env file; nothing from the surrounding shell.
unset WALKTHROUGH_RUN_ID WALKTHROUGH_APPROVAL_ID WALKTHROUGH_GIT_COMMIT WING_PROBE_BOOTSTRAP_EPOCH \
      SELLEROPS_APPROVAL_PHASE SELLEROPS_WING_PROBE_TARGETS SELLEROPS_WING_APPROVED_TARGETS \
      SELLEROPS_WING_STAGE2_TARGETS \
      SELLEROPS_WING_APPROVED_PHASE \
      SELLEROPS_APPROVAL_OPERATION SELLEROPS_APPROVAL_MAX SELLEROPS_APPROVAL_ACCOUNT \
      SELLEROPS_APPROVAL_SURFACE SELLEROPS_APPROVAL_CHANNEL
# shellcheck disable=SC1090
set -a; . "$RUN_ENV"; set +a

RUN_ID="${WALKTHROUGH_RUN_ID:-}"
APPROVAL_ID="${WALKTHROUGH_APPROVAL_ID:-}"
RUN_GIT="${WALKTHROUGH_GIT_COMMIT:-}"
BOOTSTRAP_EPOCH="${WING_PROBE_BOOTSTRAP_EPOCH:-}"
PHASE="${SELLEROPS_APPROVAL_PHASE:-}"
PROBE_TARGETS="${SELLEROPS_WING_PROBE_TARGETS:-}"

# Is this either of the two STAGE-2 phases? Both reach the same surface by the same operator flow and carry
# their scope in the same variable; they differ only in what is measured. One predicate, used by every branch
# below, so a third Stage-2 phase cannot be added to some of them and missed by the rest.
is_stage2_phase() {
  case "$1" in COUPANG_WING_STAGE2_RECON|COUPANG_WING_STAGE2_LABEL_CALIBRATION|COUPANG_WING_ISSUANCE_FLOW_DISCOVERY) return 0 ;; *) return 1 ;; esac
}

# The header must name the scope this RUN actually has. On a Stage-2 run there is no probe scope at all, and
# printing `targets=delete` (the old default) described a measurement the run does not make.
if is_stage2_phase "$PHASE"; then
  HEADER_TARGETS="${SELLEROPS_WING_STAGE2_TARGETS:-?} (stage-2)"
else
  HEADER_TARGETS="${PROBE_TARGETS:-?}"
fi
echo "Coupang WING selector-probe preflight — run=${RUN_ID:-?} git=${RUN_GIT:-?} phase=${PHASE:-?} targets=${HEADER_TARGETS}"
echo "read-only local checks only — no browser, no Coupang call, no credential read"
echo

# 1–2. The identity must be a real bootstrapped value, and FRESH (a run env left behind by an earlier session
#      must not silently re-authorize a new one). Shared with the destructive harness.
check_identity_bound "$RUN_ID" "$APPROVAL_ID" "$RUN_GIT"
check_identity_fresh "$BOOTSTRAP_EPOCH" "$IDENTITY_TTL_SECONDS"

# 3. The phase must be one of the two READ_ONLY WING recorder phases — the shipped-label selector probe, or the
#    candidate-label recon. This harness prepares those and no others; the destructive deletion phase has its
#    own gate and is not approvable from here.
case "$PHASE" in
  COUPANG_WING_SELECTOR_PROBE|COUPANG_WING_LABEL_RECON|COUPANG_WING_STAGE2_RECON|COUPANG_WING_STAGE2_LABEL_CALIBRATION|COUPANG_WING_ISSUANCE_FLOW_DISCOVERY)
    pass "phase is $PHASE (READ_ONLY)" ;;
  *)
    fail "phase must be COUPANG_WING_SELECTOR_PROBE, COUPANG_WING_LABEL_RECON, COUPANG_WING_STAGE2_RECON, COUPANG_WING_STAGE2_LABEL_CALIBRATION, or COUPANG_WING_ISSUANCE_FLOW_DISCOVERY (got '${PHASE:-unset}') — this harness prepares no other phase" ;;
esac

# 4. No code drift since bootstrap. The manifest records a git SHA; if HEAD moved, or the working tree
#    carries uncommitted/untracked changes, the code that would run is NOT the code that SHA names —
#    the manifest would over-claim and the approval is REVOKED by contract §1.6. Sets CUR_GIT.
check_no_code_drift "$RUN_GIT"

# 5–7. The local toolchain must be able to start the probe with nothing more installed or asked; the dedicated
#      Chrome profile must resolve inside the collector tree; a browser must be launchable.
check_toolchain "$COLLECTOR_DIR" "src/cli/probe-wing-issuance-selectors.ts" "probe"
check_dedicated_profile "$COLLECTOR_DIR"
check_browser_launchable

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
if is_stage2_phase "$PHASE"; then
  # A Stage-2 manifest carries its scope in its OWN field. Reading `probeTargets` here would either fail or —
  # worse, if a future manifest ever emitted both — display a probe scope for a run that sweeps Stage-2 names.
  M_TARGETS="$(jget stage2Targets)" || FIELD_FAIL=1
else
  M_TARGETS="$(jget probeTargets)" || FIELD_FAIL=1
fi
# The central caveat of every WING phase: no WING selector has been live-calibrated yet. It belongs on the
# line the operator actually reads before granting, not only in the JSON dump.
M_CALIBRATED="$(jget selectorsCalibrated)" || FIELD_FAIL=1
M_ENTRY_TYPE="$(jget entrypointType)" || FIELD_FAIL=1
M_OPERATOR_ACTION="$(jget operatorActionSummary)" || FIELD_FAIL=1
if [ "$FIELD_FAIL" != "0" ]; then
  echo "PREFLIGHT FAIL — the prepared manifest is missing a field this display depends on; refusing to show a partial manifest."
  exit 1
fi
# The gate re-derives the phase itself; a manifest for any other phase must never be displayed by this harness,
# AND it must be the same phase this run bootstrapped — a manifest for the OTHER read-only phase describes
# different work (shipped labels vs candidate hypotheses) and must not be presented under this run's identity.
case "$M_PHASE" in
  COUPANG_WING_SELECTOR_PROBE|COUPANG_WING_LABEL_RECON|COUPANG_WING_STAGE2_RECON|COUPANG_WING_STAGE2_LABEL_CALIBRATION|COUPANG_WING_ISSUANCE_FLOW_DISCOVERY) ;;
  *)
    echo "PREFLIGHT FAIL — the prepared manifest is for phase $M_PHASE, not a READ_ONLY WING recorder phase. Refusing."
    exit 1 ;;
esac
# UNEXERCISED by the selfcheck, and said so deliberately: the manifest CLI derives its phase from the same
# SELLEROPS_APPROVAL_PHASE this script sourced from the run env, so the two agree by construction and no
# fixture can make them differ. What this still catches is the gate ECHOING BACK a different phase than it was
# given — a narrow property, kept because it costs nothing, but do not read it as a tested guarantee.
if [ "$M_PHASE" != "$PHASE" ]; then
  echo "PREFLIGHT FAIL — the prepared manifest is for phase $M_PHASE but this run bootstrapped $PHASE. Refusing."
  exit 1
fi

# Bind the APPROVED scope to the run: rewrite this run's env with the RESOLVED target list from the manifest,
# so sourcing it can only reproduce what was displayed. (The gate normalizes order and de-duplicates, and an
# empty request means ALL targets — writing the resolved value back removes that asymmetry from the run.)
# Written atomically via a temp file + os.replace, and shell-quoted properly — a truncating in-place write
# could leave a half-written run env, and %r is Python repr, not shell quoting.
if ! python3 -c 'import os, sys, tempfile
path, resolved = sys.argv[1], sys.argv[2]
drop = ("SELLEROPS_WING_PROBE_TARGETS=", "SELLEROPS_WING_APPROVED_TARGETS=", "SELLEROPS_WING_APPROVED_PHASE=",
        "SELLEROPS_WING_STAGE2_TARGETS=")
lines = [l for l in open(path).read().splitlines() if not l.startswith(drop)]
# Always single-quoted, matching what bootstrap writes: shlex.quote would leave a bare word unquoted, so the
# file style would depend on the value. The escape below is the POSIX one and is correct for any content.
def shquote(v):
    return "'\''" + v.replace("'\''", "'\''\"'\''\"'\''") + "'\''"
quoted = shquote(resolved)
# TWO variables, deliberately: the run scope and the APPROVED scope. The live probe requires both and refuses
# unless they are equal, so a run that measures something other than the displayed manifest cannot start.
# On a STAGE-2 run the resolved scope belongs to the Stage-2 namespace, and the probe-scope pair must NOT be
# written at all: those names would be read as a baseline scope, and the run measures no shipped locator.
# WHICH namespace is decided by the shell, via the one `is_stage2_phase` predicate every other branch uses, and
# arrives here as a yes/no. It used to be a phase list duplicated inside this script — in the single
# highest-consequence Stage-2 branch in the harness, the one deciding whether the run env gets a Stage-2 scope
# or a probe scope. A third Stage-2 phase added to the predicate would have been missed here alone.
if sys.argv[4] == "yes":
    lines.append("SELLEROPS_WING_STAGE2_TARGETS=" + quoted)
else:
    lines.append("SELLEROPS_WING_PROBE_TARGETS=" + quoted)
    lines.append("SELLEROPS_WING_APPROVED_TARGETS=" + quoted)
# The approved PHASE, bound the same way and for the same reason as the approved scope: with only one phase
# variable, a stale export from an earlier shell arms a candidate sweep under a manifest granted for the
# shipped labels, and a forgotten phase silently downgrades an approved sweep to a baseline probe.
lines.append("SELLEROPS_WING_APPROVED_PHASE=" + shquote(sys.argv[3]))
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(os.path.abspath(path)))
try:
    with os.fdopen(fd, "w") as f:
        f.write("\n".join(lines) + "\n")
    os.replace(tmp, path)
except BaseException:
    if os.path.exists(tmp):
        os.unlink(tmp)
    raise' "$RUN_ENV" "$M_TARGETS" "$M_PHASE" "$(is_stage2_phase "$PHASE" && echo yes || echo no)" 2>/dev/null; then
  # This is the binding, not a convenience: without it, sourcing the run env can still reproduce a wider
  # scope than the one displayed. Refuse rather than pass with the binding silently skipped.
  echo "PREFLIGHT FAIL — could not bind the approved scope/phase to $RUN_ENV; refusing to present a manifest the run may not honor."
  exit 1
fi
pass "approved scope + phase bound to the run env ($M_TARGETS · $M_PHASE)"

echo
echo "PREFLIGHT PASS"
echo "approval manifest (sanitized) → $MANIFEST_OUT"; sed 's/^/  /' "$MANIFEST_OUT"
echo
echo "  ── APPROVAL MANIFEST (sanitized) ──"
echo "  $M_CHANNEL · $M_OPERATION"
echo "  $M_MODE · run ${RUN_ID:0:8}… · approval ${APPROVAL_ID:0:8}… · max: $M_MAX"
if is_stage2_phase "$PHASE"; then
  echo "  phase: $M_PHASE · stage-2 targets: $M_TARGETS · selectors calibrated: $M_CALIBRATED"
else
  echo "  phase: $M_PHASE · probe targets: $M_TARGETS · selectors calibrated: $M_CALIBRATED"
fi
echo "  account: $M_ACCOUNT · host: $M_HOST · operator presence: required · expires: process-lifetime · git $CUR_GIT"
echo "  Standing Safety Contract + full scope: docs/sellerops_live_approval_contract.md"
echo
echo "  operator action ($M_ENTRY_TYPE):"
echo "    $M_OPERATOR_ACTION"
echo
if [ "$PHASE" = "COUPANG_WING_ISSUANCE_FLOW_DISCOVERY" ]; then
  echo "  ⚠ THIS RUN ADVANCES THE REAL FLOW, and every step of it is YOURS. SellerOps clicks, selects and types"
  echo "  NOTHING — it has no code path that could. You press 'API Key 발급 받기', you select 'OPEN API', and you"
  echo "  press '확인' — but only if SellerOps' own reading says you may."
  echo "  FOUR checkpoints, each waiting for your signal, each instruction printed only when it is that step's"
  echo "  turn:"
  echo "    1) 발급 press → STOP on the purpose screen, select nothing → ready"
  echo "    2) select 'OPEN API' → do NOT press 확인 → ready"
  echo "    3) offered ONLY IF the step-2 reading shows the 업체명/URL/IP fields are NOT yet on screen"
  echo "    4) the TERMS screen: tick the two consent boxes yourself → ready. THIS IS THE END."
  echo "  ⚠ WHY step 3 is conditional: nobody has ever pressed '확인', and no run has measured what it does. The"
  echo "  product owner's account of the flow puts it AFTER the vendor fields, which would make it the control"
  echo "  that CREATES THE KEY. So SellerOps reads, at step 2, whether those fields are already visible. If they"
  echo "  are, '확인' is a submission and the run HALTS — the instruction to press it is never printed. This is"
  echo "  a fail-closed gate: an unreadable page, any probe fault, or a missing candidate also halts."
  echo "  If step 3 does run, you press '확인' and STOP at whatever opens — the TERMS screen."
  echo "  ⚠ THE RUN ENDS THERE, and the reason is the button below those checkboxes:"
  echo "    '약관 동의 및 Key 발급받기' is the KEY-CREATION control. This run measures where it is and NEVER"
  echo "    presses it, and there is no fifth checkpoint that could ask you to — the code refuses to accept one."
  echo "    Key issuance is a SEPARATE phase with its own manifest and its own single-use grant."
  echo "  You read the terms and decide. SellerOps does not read them, evaluate them, agree to them, or advise"
  echo "  on them — it reads only whether each checkbox's label matches a string you transcribed yourself."
  echo "  At each checkpoint SellerOps reads the same read-only things it has read all along: match counts,"
  echo "  visible-vs-hidden, how each control is labelled, group ordinals, length bands, candidate INDICES. No"
  echo "  page wording, no field value, no credential. Nothing measured here promotes a selector."
elif is_stage2_phase "$PHASE"; then
  echo "  ⚠ YOU take a real WING action in this run, and SellerOps does not: you press 'API Key 발급 받기'"
  echo "  YOURSELF to open the purpose-selection screen, then STOP there. Choose no purpose, type nothing into"
  echo "  업체명/URL/IP, and NEVER press '확인' — that is the control that creates the key, and this run has no"
  echo "  tooling for it. SellerOps then reads, once and read-only: how many choice controls are visible, what"
  echo "  CATEGORY each is (tag / input type / ARIA role, from a fixed vocabulary), and how many times each"
  echo "  pre-written candidate label matches. It highlights nothing, clicks nothing, selects nothing, reads no"
  echo "  text, no field value, and no credential. Every candidate that resolves is EVIDENCE ONLY — this run"
  echo "  changes no shipped selector, and the guided tutorial is not redesigned from it."
  if [ "$PHASE" = "COUPANG_WING_STAGE2_LABEL_CALIBRATION" ]; then
    echo "  This phase reads ONE thing more than the recon: HOW each choice control is labelled — the derivation"
    echo "  (aria-label / label[for] / wrapping label / title / none), whether that association actually resolves,"
    echo "  which radio-name group it belongs to (a NUMBER, never the name), a coarse length band, and whether the"
    echo "  derived name matches a pre-written candidate (an INDEX, never the wording). The screen's own text is"
    echo "  never recorded, and no option is selected — the point is to learn what the options ARE first."
  fi
elif [ "$PHASE" = "COUPANG_WING_LABEL_RECON" ]; then
  echo "  This run sweeps CANDIDATE labels for the targets above — several unvalidated hypotheses each — and"
  echo "  measures match counts only: no highlight, no click, no input, no value read, no 발급/재발급/삭제, and it"
  echo "  never navigates the window (the seller does). A candidate that resolves uniquely is recorded as"
  echo "  EVIDENCE ONLY — this run changes no shipped selector. Promotion is a later offline edit with tests."
else
  echo "  The probe measures fixed-label match counts only — no highlight, no click, no input, no value read,"
  echo "  no 발급/재발급/삭제, and it never navigates the window (the seller does)."
fi
echo
echo "  If this manifest is correct and displayed, the operator's entire single-use grant is one line:"
echo "    Seated and ready."
echo
echo "  On approval, run the probe with the APPROVED scope inline. The probe refuses unless BOTH variables"
echo "  are set and equal — an unset scope can no longer widen the run to every target:"
# BOTH phase variables travel with the run command, mirroring the two scope variables. The recorder derives
# recon mode from them and refuses unless they agree, so neither a phase left over from an earlier shell nor a
# forgotten phase on an approved recon command can make the run measure something the manifest did not describe.
if is_stage2_phase "$PHASE"; then
  # A Stage-2 run carries NO probe scope: it measures no shipped locator, so there is nothing to scope. The two
  # phase variables plus the Stage-2 scope are the whole authorization surface.
  echo "    cd $COLLECTOR_DIR && SELLEROPS_APPROVAL_PHASE=$M_PHASE SELLEROPS_WING_APPROVED_PHASE=$M_PHASE \\"
  echo "      SELLEROPS_WING_STAGE2_TARGETS=$M_TARGETS \\"
  echo "      npx tsx $M_CLI -- --i-understand-this-opens-live-coupang-wing"
else
  echo "    cd $COLLECTOR_DIR && SELLEROPS_APPROVAL_PHASE=$M_PHASE SELLEROPS_WING_APPROVED_PHASE=$M_PHASE \\"
  echo "      SELLEROPS_WING_PROBE_TARGETS=$M_TARGETS SELLEROPS_WING_APPROVED_TARGETS=$M_TARGETS \\"
  echo "      npx tsx $M_CLI -- --i-understand-this-opens-live-coupang-wing"
fi
echo
echo "  (Re-bootstrap ⇒ new approval id ⇒ the old approval is dead. A code/branch/run/scope change ⇒ REVOKED.)"
exit 0
