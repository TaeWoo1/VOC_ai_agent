#!/usr/bin/env bash
#
# Regression self-tests for the Coupang WING issuance-form REVEAL preflight. Proves it FAILS CLOSED on every way
# the run can be wrong, and prepares + displays a reveal manifest only when it is right.
#
# The reveal harness was the only WING harness shipped WITHOUT one: 250+ lines carrying the entire operator-facing
# disclosure for a real marketplace action, verified once by hand. This closes that gap. It reuses
# `wing-harness-common.sh` (one of its seven callers) and adds no new checking logic of its own — every assertion below runs the real
# preflight, or the real shared descriptor verifier, against fixtures.
#
# Fully HERMETIC: no browser, no backend, no Coupang call, NOTHING pressed and NO key issued. The only tree
# mutation is a temporary untracked marker file used to produce a dirty tree, removed on exit. The cases that run
# the REAL bootstrap pass SELLEROPS_WING_REVEAL_RUN_DIR so they write to a temp dir — otherwise a regression in
# the dirty-tree guard (the thing BOOTSTRAP_DIRTY exists to catch) would mint a fresh approval id over the
# operator's live run env, killing a pending grant at the exact moment the case was doing its job.
#
# Exit codes: 0 = every case ran and passed · 1 = a case failed · 2 = PARTIAL, the clean-tree half was skipped.
#
# Cases:
#   NO_RUN_ENV        → FAIL (bootstrap never ran)
#   UNBOUND_RUN       → FAIL (identity is "unknown" — contract §2 UNBOUND_IDENTITY)
#   STALE_IDENTITY    → FAIL (a run env from an earlier session must not re-authorize a real WING press)
#   OCTAL_EPOCH       → FAIL (a malformed stamp must not abort the arithmetic and delete the freshness check)
#   AMBIENT_STAMP     → FAIL (the caller's shell cannot supply a key the run env omits)
#   WRONG_PHASE       → FAIL (neither the destructive deletion phase nor the read-only probe is approvable here)
#   HEAD_DRIFT        → FAIL (bootstrap commit != HEAD)
#   DIRTY_TREE        → FAIL (uncommitted/untracked change ⇒ the gitSHA would not name the running code)
#   GIT_DIR_HIJACK    → FAIL (a decoy GIT_DIR/GIT_WORK_TREE must not redirect the drift check)
#   COLLECTOR_ESCAPE  → FAIL (an out-of-repo collector would verify one tree and describe another)
#   GIT_STATUS_FAIL   → FAIL (an unreadable `git status` must never be read as "clean")
#   DESCRIPTOR        → the canonical descriptor is accepted; every SAFETY-OVERSTATING softening, a descriptor
#                       re-pointed at KEY ISSUANCE, one re-pointed at the DESTRUCTIVE DELETION, and an absent one
#                       are all refused — and the preflight ACTS on that verdict
#   NORMAL            → PASS; reveal manifest, calibrated, exact descriptor, full disclosure, approved-phase bound
#   NO_LEAK           → refusals carry no credential-shaped value, no ambient value, no FULL approval id
#   BOOTSTRAP_DIRTY   → FAIL (the bootstrap itself refuses to pin a SHA against a dirty tree)
#   BOOTSTRAP_CLEAN   → PASS (…and it does mint one on a clean tree — a bootstrap that refuses everything is not
#                       passing BOOTSTRAP_DIRTY, it is broken)
#   BOOTSTRAP_SHA     → FAIL (a HEAD that is not a hex commit writes no run env)
#   DEFAULT_OUT       → PASS twice in a row on the default temp path
#
# NORMAL and the dirty-tree cases are complementary: they need a clean tree. When it is dirty they are named and
# skipped AND the script exits 2 under a PARTIAL banner — naming them is not enough, because a green banner with
# exit 0 reads as coverage to whatever consumes the exit code.
#
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
PREFLIGHT="$HERE/wing-walk-preflight.sh"
BOOTSTRAP="$HERE/wing-walk-bootstrap.sh"
FIXTURES="$(mktemp -d)"
MANIFEST_OUT="$FIXTURES/manifest.json"
DIRT_FILE="$REPO_ROOT/.wing-walk-selfcheck-dirty.tmp"

# Remove any residue from a previous crashed run BEFORE reading the tree state — otherwise a leftover marker
# would report the tree as dirty forever and silently skip the PASS-path cases.
rm -f "$DIRT_FILE"
cleanup() { rm -rf "$FIXTURES"; rm -f "$DIRT_FILE"; }
trap cleanup EXIT INT TERM

NOW="$(date +%s)"
FAILED=0
SKIPPED=0
SKIP_REASON=""

# Sourced so the shared descriptor verifier can be exercised DIRECTLY against crafted manifests. The gate makes a
# softened descriptor unproducible through the CLI, so calling the function is the only way it is falsifiable.
# shellcheck source=./wing-harness-common.sh
. "$HERE/wing-harness-common.sh"

# AFTER the source, deliberately: `git_hardened` is defined there. An earlier version read HEAD before sourcing,
# so the function did not exist, `|| echo unknown` pinned every fixture to "unknown", and TREE_DIRTY came back
# EMPTY — which read as "clean" and ran the whole PASS path against a SHA that matches nothing. That is the exact
# fail-open shape this file exists to refuse, and it produced 22 confident PASS lines while proving nothing.
REALGIT_FOR_SHA="$(command -v git)"
CUR_GIT="$(git_hardened rev-parse --short HEAD 2>/dev/null || echo unknown)"
if [ "$CUR_GIT" = "unknown" ]; then
  echo "SELFCHECK ABORT — could not read HEAD. Every fixture would carry a SHA that matches nothing and the"
  echo "                  drift cases would pass for the wrong reason."
  exit 3
fi
# git_hardened, not bare git: an ambient GIT_DIR / core.excludesFile in the caller's shell would make this read a
# dirty tree as clean and silently take the PASS branch.
TREE_DIRTY="$(git_hardened status --porcelain 2>/dev/null | head -1)"

# Is the 발급 selector calibration currently live? Read from the SHIPPED constant, never assumed, because the
# correct behaviour of the manifest cases INVERTS with it: while the calibration is withdrawn the preflight must
# refuse with SELECTORS_NOT_CALIBRATED, and asserting PREFLIGHT PASS would be asserting a bug.
#
# Derived rather than hardcoded to either state. Hardcoding the refusal would silently delete the PASS-path
# coverage the moment a live probe restores the flag — which is precisely when that coverage matters again.
ISSUE_CALIBRATED=0
CALIB_SRC="$REPO_ROOT/collector/src/action-window/coupang-wing-issuance-driver.ts"
if [ ! -f "$CALIB_SRC" ]; then
  echo "SELFCHECK ABORT — cannot read the calibration constant at $CALIB_SRC. Refusing to guess which half to run."
  exit 3
fi
if grep -qE '^export const WING_ISSUE_SELECTOR_CALIBRATED = true as const;' "$CALIB_SRC"; then
  ISSUE_CALIBRATED=1
elif ! grep -qE '^export const WING_ISSUE_SELECTOR_CALIBRATED = false as const;' "$CALIB_SRC"; then
  echo "SELFCHECK ABORT — WING_ISSUE_SELECTOR_CALIBRATED is neither a literal true nor false. It gates whether a"
  echo "                  reveal run can reach a live page; a form this script cannot read is not a safe default."
  exit 3
fi

# Write a fixture run env. $1=file $2=git commit $3=phase $4=run id $5=approval id $6=epoch
write_env() {
  cat > "$1" <<ENV
WALKTHROUGH_RUN_ID='$4'
WALKTHROUGH_APPROVAL_ID='$5'
WALKTHROUGH_GIT_COMMIT='$2'
WING_WALK_BOOTSTRAP_EPOCH='${6:-$NOW}'
SELLEROPS_APPROVAL_PHASE='$3'
ENV
}

# $1=name $2=expected exit (0|nonzero) $3=required marker ("" to skip) $4=run env path; rest = extra env
run_case() {
  local name="$1" expect_exit="$2" marker="$3" run_env="$4"; shift 4
  local out rc ok="yes"
  out="$(env "$@" SELLEROPS_WING_WALK_RUN_ENV="$run_env" SELLEROPS_MANIFEST_OUT="$MANIFEST_OUT" bash "$PREFLIGHT" 2>&1)"; rc=$?
  [ "$expect_exit" = "0" ] && [ "$rc" != "0" ] && ok="no"
  [ "$expect_exit" = "nonzero" ] && [ "$rc" = "0" ] && ok="no"
  [ -n "$marker" ] && ! grep -qF "$marker" <<<"$out" && ok="no"
  if [ "$ok" = "yes" ]; then
    echo "  PASS  $name (exit=$rc)"
  else
    echo "  FAIL  $name (exit=$rc, expected=$expect_exit, marker='$marker')"
    echo "$out" | tail -12 | sed 's/^/        | /'
    FAILED=1
  fi
}

echo "WING issuance-form REVEAL preflight selfcheck — hermetic (no browser, no Coupang call, NOTHING pressed)"
echo "HEAD=$CUR_GIT  tree=$([ -z "$TREE_DIRTY" ] && echo clean || echo dirty)"
echo

# ── identity ───────────────────────────────────────────────────────────────────
run_case "NO_RUN_ENV      (bootstrap never ran)" nonzero "no run env at" "$FIXTURES/absent.env"

write_env "$FIXTURES/unbound.env" "unknown" "COUPANG_WING_GUIDED_ISSUANCE_WALK" "unknown" "unknown"
run_case "UNBOUND_RUN     (identity is \"unknown\")" nonzero "is empty or \"unknown\"" "$FIXTURES/unbound.env"

# A real marketplace press, so this harness uses the destructive 1h TTL rather than the read-only probe's.
write_env "$FIXTURES/stale.env" "$CUR_GIT" "COUPANG_WING_GUIDED_ISSUANCE_WALK" "wt-revchk01" "apr-revchk01" "$((NOW - 7200))"
run_case "STALE_IDENTITY  (2h-old env refused by the 1h TTL)" nonzero "run identity is stale" "$FIXTURES/stale.env"

write_env "$FIXTURES/octal.env" "$CUR_GIT" "COUPANG_WING_GUIDED_ISSUANCE_WALK" "wt-revchk02" "apr-revchk02" "0000000001999999999"
run_case "OCTAL_EPOCH     (malformed stamp cannot skip the check)" nonzero "bootstrap timestamp missing or malformed" "$FIXTURES/octal.env"

cat > "$FIXTURES/nostamp.env" <<ENV
WALKTHROUGH_RUN_ID='wt-revchk03'
WALKTHROUGH_APPROVAL_ID='apr-revchk03'
WALKTHROUGH_GIT_COMMIT='$CUR_GIT'
SELLEROPS_APPROVAL_PHASE='COUPANG_WING_GUIDED_ISSUANCE_WALK'
ENV
run_case "AMBIENT_STAMP   (caller's env cannot supply a missing key)" nonzero "bootstrap timestamp missing or malformed" \
  "$FIXTURES/nostamp.env" "WING_WALK_BOOTSTRAP_EPOCH=$NOW"

# ── phase containment ──────────────────────────────────────────────────────────
# The three `WALKTHROUGH_*` identity variables are byte-identical across WING phases, so the phase is the only
# thing separating this harness from the others. Preparing the DESTRUCTIVE deletion phase from here would show
# reveal disclosure copy ("not key creation · not irreversible") for an irreversible run — the exact
# cross-phase escalation the reveal CLI's phase binding closes on the runtime side.
for wrong in COUPANG_WING_KEY_DELETION COUPANG_WING_SELECTOR_PROBE COUPANG_WING_LABEL_RECON API_ISSUANCE_HIGHLIGHT_PROOF; do
  write_env "$FIXTURES/wrongphase.env" "$CUR_GIT" "$wrong" "wt-revchk04" "apr-revchk04"
  run_case "WRONG_PHASE     ($wrong refused here)" nonzero "phase must be COUPANG_WING_GUIDED_ISSUANCE_WALK" "$FIXTURES/wrongphase.env"
done

write_env "$FIXTURES/drift.env" "0000000" "COUPANG_WING_GUIDED_ISSUANCE_WALK" "wt-revchk05" "apr-revchk05"
run_case "HEAD_DRIFT      (commit moved since bootstrap)" nonzero "git commit changed" "$FIXTURES/drift.env"

# ── the descriptor: this phase's whole safety claim ────────────────────────────
# The DISPLAY-side check. Unlike the destructive descriptor — where the risk is understating danger — every
# softening here OVERSTATES safety, and the worst is `keyCreationRuledOut: true`: it would tell the operator
# SellerOps had confirmed no key was created, which nothing can (NO_DISCRIMINATING_SIGNAL).
CANON='{"guidedWalkBoundary":{"operation":"WALK_WING_GUIDED_ISSUANCE_TUTORIAL","forbiddenFollowOnAction":"COMPLETE_WING_KEY_ISSUANCE","restsBeforeControl":"약관 동의 및 Key 발급받기","createsKeyMaterial":false,"keyCreationRuledOut":false,"agentPerformsAction":false,"agentNavigations":1,"credentialValueReadBudget":0,"performsConnectOrSync":false,"highlightedControlCount":7,"textGuidedControlCount":0,"ringedInputControlCount":0,"autoAdvancingStepCount":4,"keyCreationAutoAdvances":false,"sellerConsentObserved":true}}'
printf '%s' "$CANON" > "$FIXTURES/desc-ok.json"
DESC_OK=1
verify_walk_descriptor "$FIXTURES/desc-ok.json" >/dev/null 2>&1 || { echo "  FAIL  DESCRIPTOR · canonical descriptor rejected"; DESC_OK=0; FAILED=1; }
for soft in \
  '"keyCreationRuledOut":true' \
  '"createsKeyMaterial":true' \
  '"agentPerformsAction":true' \
  '"agentNavigations":0' \
  '"keyCreationAutoAdvances":true' \
  '"credentialValueReadBudget":1' \
  '"performsConnectOrSync":true' \
  '"highlightedControlCount":6' \
  '"textGuidedControlCount":2' \
  '"ringedInputControlCount":1' \
  '"operation":"COMPLETE_WING_KEY_ISSUANCE"' \
  '"operation":"DELETE_WING_OPEN_API_KEY"' \
  '"forbiddenFollowOnAction":"NOTHING"' \
  '"restsBeforeControl":"확인"' \
  '"keyCreationRuledOut":"false"' \
  '"createsKeyMaterial":"false"' \
  '"agentPerformsAction":"false"' \
  '"performsConnectOrSync":"false"' \
  '"keyCreationAutoAdvances":"false"' \
  '"agentNavigations":"1"' \
  '"credentialValueReadBudget":"0"'
do
  # The fixture must be BUILT and must actually DIFFER from canonical. If the generator throws, no file is
  # written, the verifier fails on a missing path, and the loop reads that as "refused" — every softening
  # above, including keyCreationRuledOut:true, would report PASS while testing nothing.
  rm -f "$FIXTURES/desc-soft.json"
  if ! python3 -c 'import json,sys
d = json.loads(sys.argv[1]); k, v = json.loads("{" + sys.argv[2] + "}").popitem()
if k not in d["guidedWalkBoundary"]:
    sys.exit(7)
d["guidedWalkBoundary"][k] = v
open(sys.argv[3], "w").write(json.dumps(d, ensure_ascii=False))' "$CANON" "$soft" "$FIXTURES/desc-soft.json"; then
    echo "  FAIL  DESCRIPTOR · fixture generation FAILED for: $soft"; DESC_OK=0; FAILED=1
    continue
  fi
  if python3 -c 'import json,sys
sys.exit(0 if json.load(open(sys.argv[1])) == json.load(open(sys.argv[2])) else 1)' "$FIXTURES/desc-ok.json" "$FIXTURES/desc-soft.json"; then
    echo "  FAIL  DESCRIPTOR · fixture is identical to canonical, so it tests nothing: $soft"; DESC_OK=0; FAILED=1
    continue
  fi
  if verify_walk_descriptor "$FIXTURES/desc-soft.json" >/dev/null 2>&1; then
    echo "  FAIL  DESCRIPTOR · tampering accepted: $soft"; DESC_OK=0; FAILED=1
  fi
done
printf '%s' '{}' > "$FIXTURES/desc-absent.json"
if verify_walk_descriptor "$FIXTURES/desc-absent.json" >/dev/null 2>&1; then
  echo "  FAIL  DESCRIPTOR · absent descriptor accepted"; DESC_OK=0; FAILED=1
fi
# Neither sibling harness's descriptor may satisfy this one, and this one must not satisfy theirs: three
# phases, three shapes, and a run that accepted the wrong one would display the wrong safety claim.
printf '%s' '{"operatorDestructiveAction":{"operation":"DELETE_WING_OPEN_API_KEY","irreversible":true,"invalidatesExistingCredentialImmediately":true,"agentPerformsAction":false,"explicitCheckpointRequired":true,"credentialValueReadBudget":0}}' > "$FIXTURES/desc-destructive.json"
if verify_walk_descriptor "$FIXTURES/desc-destructive.json" >/dev/null 2>&1; then
  echo "  FAIL  DESCRIPTOR · a DESTRUCTIVE descriptor satisfied the guided-walk check"; DESC_OK=0; FAILED=1
fi
printf '%s' '{"operatorRevealAction":{"operation":"REVEAL_WING_ISSUANCE_CONFIGURATION","forbiddenFollowOnAction":"COMPLETE_WING_KEY_ISSUANCE","createsKeyMaterial":false,"keyCreationRuledOut":false,"irreversible":false,"agentPerformsAction":false,"explicitCheckpointRequired":true,"credentialValueReadBudget":0,"expectedOutcome":"CONFIGURATION_SURFACE","expectedOutcomeConfirmed":false,"autoAdvanceAfterReveal":false}}' > "$FIXTURES/desc-reveal.json"
if verify_walk_descriptor "$FIXTURES/desc-reveal.json" >/dev/null 2>&1; then
  echo "  FAIL  DESCRIPTOR · a REVEAL descriptor satisfied the guided-walk check"; DESC_OK=0; FAILED=1
fi
if verify_reveal_descriptor "$FIXTURES/desc-ok.json" >/dev/null 2>&1; then
  echo "  FAIL  DESCRIPTOR · a GUIDED-WALK descriptor satisfied the reveal check"; DESC_OK=0; FAILED=1
fi
if verify_destructive_descriptor "$FIXTURES/desc-ok.json" >/dev/null 2>&1; then
  echo "  FAIL  DESCRIPTOR · a GUIDED-WALK descriptor satisfied the destructive check"; DESC_OK=0; FAILED=1
fi
[ "$DESC_OK" = "1" ] && echo "  PASS  DESCRIPTOR    · canonical accepted; every safety-overstating softening (incl. STRING-typed booleans and a re-point of restsBeforeControl), the reveal and destructive shapes, and an absent descriptor all refused"

# …and the preflight must ACT on that verdict. The gate makes a softened descriptor unproducible through the
# CLI, so no end-to-end case can distinguish "checked and refused" from "checked and ignored".
# BLOCK-scoped, not two independent substrings. Both greps stay true if `exit 1` is deleted — execution then
# falls through to the PASS line, the full manifest dump and "Seated and ready.", so a descriptor carrying
# keyCreationRuledOut: true would be DISPLAYED for approval. That is the exact failure this function exists to
# prevent, so the guard has to read the refusal body, not just its first and last lines.
# The range END is /^fi/, not /^fi$/: a decorated `fi  # comment` does not close the strict form, so the range
# runs on to the NEXT bare fi and swallows another refusal's `exit 1`.
DESC_BLOCK="$(awk '/^if ! verify_walk_descriptor "\$MANIFEST_OUT"; then$/,/^fi/' "$PREFLIGHT")"
# The nested-`if` refusal is the part that scopes this. An INDENTED `fi` closes neither /^fi$/ nor /^fi/, so
# the range runs on to the next column-0 `fi` and picks up a LATER refusal's `exit 1` — and any such widened
# region necessarily swallowed an intervening column-0 `if`, which is the detectable signal. (A previous version
# checked for a bare `fi` in the block instead; that cannot detect it, because an over-long block contains bare
# `fi` lines by construction. Verified, not assumed.)
DESC_INNER="$(sed '1d;$d' <<<"$DESC_BLOCK")"
if [ -n "$DESC_BLOCK" ] && ! grep -qE '^if[[:space:]]' <<<"$DESC_INNER" \
   && grep -qF "Refusing to display it for approval" <<<"$DESC_BLOCK" && grep -qE '^ *exit 1$' <<<"$DESC_BLOCK"; then
  echo "  PASS  DESCRIPTOR    · the preflight EXITS on the verifier's verdict (not merely prints)"
else
  echo "  FAIL  DESCRIPTOR    · the descriptor refusal does not exit — a softened manifest would be displayed"; FAILED=1
fi

# ── the clean/dirty pair ────────────────────────────────────────────────────────
write_env "$FIXTURES/normal.env" "$CUR_GIT" "COUPANG_WING_GUIDED_ISSUANCE_WALK" "wt-revchk06" "apr-revchk06"
if [ -z "$TREE_DIRTY" ]; then
  # The manifest cases require a LIVE calibration. With it withdrawn the preflight must refuse, so the two halves
  # below are alternatives, not a pass/skip: exactly one of them is the correct behaviour at any given commit.
  if [ "$ISSUE_CALIBRATED" = "1" ]; then
  run_case "NORMAL          (reveal manifest prepared)" 0 "PREFLIGHT PASS" "$FIXTURES/normal.env"
  run_case "NORMAL          · manifest phase" 0 "COUPANG_WING_GUIDED_ISSUANCE_WALK" "$FIXTURES/normal.env"
  run_case "NORMAL          · agent mode stays READ_ONLY" 0 "READ_ONLY (agent)" "$FIXTURES/normal.env"
  run_case "NORMAL          · 발급 selector calibration disclosed" 0 "selectors calibrated: true" "$FIXTURES/normal.env"
  run_case "NORMAL          · descriptor verdict shown" 0 "guided-walk boundary is exactly the canonical contract" "$FIXTURES/normal.env"
  run_case "NORMAL          · one-line grant offered" 0 "Seated and ready." "$FIXTURES/normal.env"
  # The product path INSTALLS the agent as a service; it never tells the operator to run it. The old case
  # asserted "local-agent.ts", which the installer command also contains as its ProgramArguments target — so it
  # would have kept passing after a regression back to a hand-run agent. Assert the install verb instead, plus
  # the two sentences that make the run terminal-free.
  run_case "NORMAL          · run command INSTALLS the agent service" 0 "local-agent-service.ts install" "$FIXTURES/normal.env"
  run_case "NORMAL          · no terminal after the install" 0 "then no terminal for the rest of the run" "$FIXTURES/normal.env"
  run_case "NORMAL          · pairing code comes from macOS, not a console" 0 "macOS shows the approval dialog with the code" "$FIXTURES/normal.env"
  run_case "NORMAL          · operator starts in the product UI" 0 "/connect/coupang" "$FIXTURES/normal.env"
  run_case "NORMAL          · teardown is disclosed with the grant" 0 "uninstall" "$FIXTURES/normal.env"

  out="$(env SELLEROPS_WING_WALK_RUN_ENV="$FIXTURES/normal.env" SELLEROPS_MANIFEST_OUT="$MANIFEST_OUT" bash "$PREFLIGHT" 2>&1)"

  # The operator-facing disclosure is the reason this harness exists rather than reusing the deletion preflight's.
  # Each fact the operator must carry into a real WING press has to be ON SCREEN, not implied.
  DISCLOSE_OK=1
  for phrase in \
    "EVERY marketplace action is YOURS" \
    "강조 표시는 체크박스나 라디오 버튼 위에 뜨지 않습니다" \
    "어느 박스가 어느 동의인지 안다고 말하지 않습니다" \
    "every screen after that is one YOU navigate to" \
    "SEVEN controls are highlighted" \
    "NO ring sits on a checkbox or a radio" \
    "measured structural pairing" \
    "'OPEN API' is the DEFAULT purpose option" \
    "You read the two consent texts and decide" \
    "That control CREATES THE KEY" \
    "DO NOT PRESS IT in this run" \
    "separate phase, with its own manifest and its own grant" \
    "no connect-test, no sync, no upload"
  do
    grep -qF "$phrase" <<<"$out" || { echo "  FAIL  NORMAL          · disclosure missing: $phrase"; DISCLOSE_OK=0; FAILED=1; }
  done
  # The KOREAN operator summary is the line that binds, and it went stale while the English disclosure beside
  # it was updated — it still told the operator that the purpose step and the checkboxes carry no highlight, on
  # the very run that had just promoted them. That is the manifest-honesty defect in the sentence rather than
  # the data, in the half the operator actually reads.
  for stale_ko in "사용 목적/확인 단계와 체크박스에는 강조 표시가 없습니다" "selector로 승격되지 않았기 때문"; do
    if grep -qF "$stale_ko" <<<"$out"; then
      echo "  FAIL  NORMAL          · retired Korean claim still shown: $stale_ko"; DISCLOSE_OK=0; FAILED=1
    fi
  done
  [ "$DISCLOSE_OK" = "1" ] && echo "  PASS  NORMAL          · full guided-walk disclosure shown before the grant line"

  # The KOREAN on-page copy of the LAST step, COMPLETE. What stops the operator mid-flow is what will be on the
  # WING page when the key-creating button is in front of them — so the preflight reproduces every sentence of
  # it and this asserts each is printed. One fragment per sentence, none spanning a wrapped output line.
  KOREAN_OK=1
  for phrase in \
    "여기서 실제로 키가 생성됩니다." \
    "'약관 동의 및 Key 발급받기' 버튼을 직접 누르세요" \
    "SellerOps는 이" \
    "버튼을 절대 누르지 않고, 자동으로 넘어가지도 않습니다."
  do
    grep -qF "$phrase" <<<"$out" || { echo "  FAIL  NORMAL          · Korean on-screen warning missing: $phrase"; KOREAN_OK=0; FAILED=1; }
  done
  [ "$KOREAN_OK" = "1" ] && echo "  PASS  NORMAL          · the COMPLETE Korean copy of the key-creation step is shown before the grant line"

  # The approved PHASE is bound into the run env FROM THE MANIFEST — the runtime half of the cross-phase
  # escalation fix. Without it the reveal CLI has only the `WALKTHROUGH_*` triple, which every WING phase shares.
  if grep -qE "^SELLEROPS_WING_APPROVED_PHASE='COUPANG_WING_GUIDED_ISSUANCE_WALK'$" "$FIXTURES/normal.env"; then
    echo "  PASS  NORMAL          · approved PHASE bound to the run env"
  else
    echo "  FAIL  NORMAL          · approved PHASE not bound to the run env"; FAILED=1
  fi
  # Re-running must not accumulate duplicate bindings (the later one would silently win on source).
  if [ "$(grep -cE "^SELLEROPS_WING_APPROVED_PHASE=" "$FIXTURES/normal.env")" = "1" ]; then
    echo "  PASS  NORMAL          · the binding is rewritten, not appended"
  else
    echo "  FAIL  NORMAL          · duplicate SELLEROPS_WING_APPROVED_PHASE lines in the run env"; FAILED=1
  fi
  # The phase bindings must NOT be exported on the install command line. A launchd job inherits nothing from
  # the installing shell, so a variable set there would reach the installer and never reach the agent — the
  # binding travels in the run-env file, which the installer reads and writes into the service's environment.
  if grep -qF "SELLEROPS_WING_APPROVED_PHASE=" <<<"$out"; then
    echo "  FAIL  NORMAL          · the install command exports a phase variable the launchd job cannot inherit"; FAILED=1
  else
    echo "  PASS  NORMAL          · phase bindings travel in the run env, not on the install command line"
  fi
  run_case "NORMAL          · the install command passes the run env" 0 "install --run-env" "$FIXTURES/normal.env"

  # A calibration/action phase must NEVER hand the operator a BOUND frontend URL — the historical defect was
  # printing /connect/naver?walkthroughRun=<id> as the operator action for every phase, which claims a run/tab
  # binding this run does not have. A bare product route is the opposite: it is where the seller starts, and
  # withholding it is what forced the terminal path. Absolute URLs and run tokens stay refused.
  if grep -qF "localhost:5173" <<<"$out" || grep -qF "walkthroughRun=" <<<"$out" || grep -qF "/connect/naver" <<<"$out"; then
    echo "  FAIL  NORMAL          · a BOUND frontend URL was emitted (run token or absolute origin)"; FAILED=1
  else
    echo "  PASS  NORMAL          · no bound frontend URL emitted (bare product route only)"
  fi
  # The descriptor must reach the operator in full, not just as a PASS line — and both claims must be visible.
  if grep -qF '"WALK_WING_GUIDED_ISSUANCE_TUTORIAL"' <<<"$out" \
     && grep -qF '"createsKeyMaterial": false' <<<"$out" \
     && grep -qF '"keyCreationRuledOut": false' <<<"$out" \
     && grep -qF '"agentNavigations": 1' <<<"$out" \
     && grep -qF '"performsConnectOrSync": false' <<<"$out" \
     && grep -qF '약관 동의 및 Key 발급받기' <<<"$out" \
     && grep -qF '"COMPLETE_WING_KEY_ISSUANCE"' <<<"$out"; then
    echo "  PASS  NORMAL          · manifest names the control it rests before, both key claims, ONE navigation and no connect/sync"
  else
    echo "  FAIL  NORMAL          · guided-walk boundary incomplete in the displayed manifest"; FAILED=1
  fi
  # This harness prepares a NON-destructive run — it must never emit the destructive descriptor or a probe scope.
  if grep -qF '"operatorDestructiveAction"' <<<"$out" || grep -qF '"probeTargets"' <<<"$out"; then
    echo "  FAIL  NORMAL          · the reveal manifest carries another phase's contract"; FAILED=1
  else
    echo "  PASS  NORMAL          · no destructive descriptor and no probe scope on the reveal manifest"
  fi

  else
  # ── the calibration is WITHDRAWN: the manifest path must be closed ────────────
  # Refuted live on 2026-08-09 (an invisible 발급 highlight). Until a read-only probe re-confirms the corrected
  # spec, reaching PREPARED here would be the defect — so this half asserts the refusal AND that nothing
  # approval-shaped is displayed alongside it. A refusal that still printed the manifest and the grant line would
  # pass a bare exit-code check while inviting the operator to grant against a run that cannot honour it.
  run_case "WITHDRAWN       (uncalibrated 발급 selector refused)" nonzero "SELECTORS_NOT_CALIBRATED" "$FIXTURES/normal.env"
  run_case "WITHDRAWN       · no manifest prepared" nonzero "no manifest prepared, no approval requested" "$FIXTURES/normal.env"

  out="$(env SELLEROPS_WING_WALK_RUN_ENV="$FIXTURES/normal.env" SELLEROPS_MANIFEST_OUT="$MANIFEST_OUT" bash "$PREFLIGHT" 2>&1)"
  WITHDRAWN_OK=1
  for forbidden in "Seated and ready." "APPROVAL MANIFEST" "PREFLIGHT PASS" '"operatorRevealAction"' "selectors calibrated: true"; do
    grep -qF "$forbidden" <<<"$out" \
      && { echo "  FAIL  WITHDRAWN       · a refusal still displayed: $forbidden"; WITHDRAWN_OK=0; FAILED=1; }
  done
  [ "$WITHDRAWN_OK" = "1" ] \
    && echo "  PASS  WITHDRAWN       · no manifest, no descriptor, and no grant line reach the operator"
  # The remedy must be the one that cannot repeat the mistake: a live measurement, not an edit.
  if grep -qF "READ-ONLY" <<<"$out"; then
    echo "  PASS  WITHDRAWN       · the refusal names a READ-ONLY probe as the way back"
  else
    echo "  FAIL  WITHDRAWN       · the refusal does not say how to restore the calibration"; FAILED=1
  fi
  fi

  # ── refusals must not leak ────────────────────────────────────────────────────
  # A refusal is printed at the moment things are going wrong, which is exactly when a diagnostic dump is
  # tempting. The run env below carries a decoy that looks like a credential; the preflight must never read or
  # echo it, and the caller's ambient env must not reach the output either.
  #
  # What is NOT asserted, deliberately: the run id. The header line prints it in full BY DESIGN — it is a
  # locally-minted environment identifier, not a secret, the bootstrap prints it, and the operator needs it to
  # tell which run a refusal belongs to. The approval id IS asserted: it is what the single-use grant binds to,
  # and on the refusal path it has no reason to appear at all.
  cat > "$FIXTURES/leaky.env" <<ENV
WALKTHROUGH_RUN_ID='wt-LEAKCANARY-RUNID'
WALKTHROUGH_APPROVAL_ID='apr-LEAKCANARY-APPROVAL'
WALKTHROUGH_GIT_COMMIT='0000000'
WING_WALK_BOOTSTRAP_EPOCH='$NOW'
SELLEROPS_APPROVAL_PHASE='COUPANG_WING_GUIDED_ISSUANCE_WALK'
COUPANG_ACCESS_KEY='LEAKCANARY-SECRET-VALUE'
ENV
  out="$(env SELLEROPS_APPROVAL_ACCOUNT="LEAKCANARY-AMBIENT-ACCOUNT" \
             SELLEROPS_APPROVAL_OPERATION="LEAKCANARY-AMBIENT-OPERATION" \
             SELLEROPS_WING_WALK_RUN_ENV="$FIXTURES/leaky.env" SELLEROPS_MANIFEST_OUT="$MANIFEST_OUT" \
             bash "$PREFLIGHT" 2>&1)"; rc=$?
  LEAK_OK=1
  [ "$rc" = "0" ] && { echo "  FAIL  NO_LEAK         · the drifted-HEAD fixture was not refused"; LEAK_OK=0; FAILED=1; }
  grep -qF "LEAKCANARY-SECRET-VALUE" <<<"$out" && { echo "  FAIL  NO_LEAK         · a run-env credential-shaped value reached the output"; LEAK_OK=0; FAILED=1; }
  grep -qF "LEAKCANARY-AMBIENT" <<<"$out" && { echo "  FAIL  NO_LEAK         · an ambient env value reached the output"; LEAK_OK=0; FAILED=1; }
  # The approval id appears TRUNCATED in the identity PASS line by design (the operator matches it against
  # the manifest). What must never appear is the whole thing.
  grep -qF "apr-LEAKCANARY-APPROVAL" <<<"$out" && { echo "  FAIL  NO_LEAK         · a FULL approval id reached a refusal"; LEAK_OK=0; FAILED=1; }
  # …and the run env is never echoed wholesale. A dump of the file would carry every key at once, including the
  # ones no check above thought to name.
  grep -qF "WALKTHROUGH_APPROVAL_ID='" <<<"$out" && { echo "  FAIL  NO_LEAK         · the run env file was echoed verbatim"; LEAK_OK=0; FAILED=1; }
  [ "$LEAK_OK" = "1" ] && echo "  PASS  NO_LEAK         · refusal carries no credential-shaped value, no ambient value, no FULL approval id, no run-env dump"

  # ── the demonstrated git-environment bypasses ────────────────────────────────
  : > "$DIRT_FILE"
  run_case "DIRTY_TREE      (uncommitted change refused)" nonzero "working tree is dirty" "$FIXTURES/normal.env"
  DECOY="$FIXTURES/decoy"; mkdir -p "$DECOY"
  ( cd "$DECOY" && git init -q . && git -c user.email=s@e -c user.name=s commit -q --allow-empty -m decoy ) >/dev/null 2>&1
  run_case "GIT_DIR_HIJACK  (decoy repo ignored)" nonzero "working tree is dirty" "$FIXTURES/normal.env" \
    "GIT_DIR=$DECOY/.git" "GIT_WORK_TREE=$DECOY"

  # The BOOTSTRAP must refuse a dirty tree too: pinning a SHA that already does not describe the tree just defers
  # a guaranteed refusal, and leaves behind a run env that looks valid.
  # SELLEROPS_WING_REVEAL_RUN_DIR keeps the REAL bootstrap away from the operator's live run env. Without it,
  # a regression in the very guard this case tests would mint a fresh approval id over a pending grant.
  out="$(env SELLEROPS_WING_REVEAL_RUN_DIR="$FIXTURES/run" bash "$BOOTSTRAP" 2>&1)"; rc=$?
  # The EFFECT, not just the exit code: the reason this case exists is that a refusal AFTER the run env is
  # written still leaves a fresh approval id on disk, killing a pending grant. Moving the dirty check below the
  # heredoc keeps rc=1 and the word "dirty" — BOOTSTRAP_SHA already asserts its effect this way.
  if [ "$rc" != "0" ] && grep -qiF "dirty" <<<"$out" && [ ! -f "$FIXTURES/run/wing-walk.env" ]; then
    echo "  PASS  BOOTSTRAP_DIRTY · refuses a dirty tree AND writes no run env (no grant is killed)"
  else
    echo "  FAIL  BOOTSTRAP_DIRTY · bootstrap minted an identity on a dirty tree (exit=$rc)"; FAILED=1
  fi
  rm -f "$DIRT_FILE"

  # …and on a clean tree it must SUCCEED, into the temp dir and nowhere near the operator's run env. A bootstrap
  # that refuses everything would satisfy the case above while being useless.
  out="$(env SELLEROPS_WING_REVEAL_RUN_DIR="$FIXTURES/run" bash "$BOOTSTRAP" 2>&1)"; rc=$?
  if [ "$rc" = "0" ] && [ -f "$FIXTURES/run/wing-walk.env" ] \
     && grep -qE "^SELLEROPS_APPROVAL_PHASE='COUPANG_WING_GUIDED_ISSUANCE_WALK'$" "$FIXTURES/run/wing-walk.env"; then
    echo "  PASS  BOOTSTRAP_CLEAN · mints a reveal identity on a clean tree, into the run dir it was given"
  else
    echo "  FAIL  BOOTSTRAP_CLEAN · bootstrap did not mint an identity on a clean tree (exit=$rc)"; FAILED=1
  fi

  # **The bootstrap's own DISCLOSURE, which nothing checked.** It is the first description of the run the
  # operator reads, and it had drifted to the pre-change behaviour — "the agent never navigates", "the two
  # live-calibrated controls" — while the descriptor the preflight prints and the gate verifies said
  # agentNavigations:1 / highlightedControlCount:7 / textGuidedControlCount:0 / autoAdvancingStepCount:4 /
  # sellerConsentObserved:true. Only the preflight output was grepped, so this half could say anything.
  #
  # Asserted BOTH ways: the current claims must be present, and the retired ones must be gone — a disclosure
  # that gained a line while keeping its contradiction is not fixed.
  BOOT_OK=1
  for claim in "ONE" "never navigates again" "SEVEN live-calibrated" "NONE of the rings sits on an input" "FOUR steps advance" "consent boxes are ticked" "RESTS in front of" "약관 동의 및 Key 발급받기" "never ticks a box"; do
    grep -qF "$claim" <<<"$out" || { echo "  FAIL  BOOTSTRAP_DISCLOSE · missing claim: $claim"; BOOT_OK=0; FAILED=1; }
  done
  # Retired claims. The last three were true and are no longer: the count moved 2 → 3 → 7 as controls were
  # measured, and a disclosure that keeps stating a smaller run than the one that executes is the exact
  # manifest-honesty defect this workstream keeps having to unpick — in the sentence, not the data.
  for stale in "the agent never navigates" "0 gotos" "ONLY the two live-calibrated" "THREE live-calibrated" "TEXT-GUIDED"; do
    if grep -qF "$stale" <<<"$out"; then
      echo "  FAIL  BOOTSTRAP_DISCLOSE · retired claim still shown: $stale"; BOOT_OK=0; FAILED=1
    fi
  done
  [ "$BOOT_OK" = "1" ] && echo "  PASS  BOOTSTRAP_DISCLOSE · the bootstrap's disclosure matches the descriptor the gate verifies"

  # An unreadable HEAD, and a HEAD that reads as something which is not a commit, must both refuse rather than
  # pin an identity nothing can verify. No healthy checkout produces either, so a `git` earlier on PATH does.
  SHABIN="$FIXTURES/shabin"; mkdir -p "$SHABIN"
  cat > "$SHABIN/git" <<FAKE
#!/usr/bin/env bash
prev=""
for a in "\$@"; do
  [ "\$prev" = "rev-parse" ] && [ "\$a" = "--short" ] && { echo "not-a-sha!!"; exit 0; }
  prev="\$a"
done
exec "$REALGIT_FOR_SHA" "\$@"
FAKE
  chmod +x "$SHABIN/git"
  out="$(env PATH="$SHABIN:$PATH" SELLEROPS_WING_REVEAL_RUN_DIR="$FIXTURES/run2" bash "$BOOTSTRAP" 2>&1)"; rc=$?
  if [ "$rc" != "0" ] && [ ! -f "$FIXTURES/run2/wing-walk.env" ]; then
    echo "  PASS  BOOTSTRAP_SHA   · a HEAD that is not a hex commit refuses, and writes no run env"
  else
    echo "  FAIL  BOOTSTRAP_SHA   · a non-hex HEAD produced a run env (exit=$rc)"; FAILED=1
  fi

  # The collector must be THIS repository's collector, or the drift check verifies one checkout while the
  # manifest is built from another, and the displayed provenance describes a tree nothing looked at.
  # POPULATED, deliberately. An empty fixture made this case pass on a missing `tsx` — `check_toolchain` — while
  # its comment claimed it proved containment. With the toolchain and entrypoint present, the only thing that can
  # refuse it is the containment check itself, and the marker names that check rather than "PREFLIGHT FAIL".
  OTHER_COLLECTOR="$FIXTURES/other/collector"
  mkdir -p "$OTHER_COLLECTOR/node_modules/.bin" "$OTHER_COLLECTOR/src/cli"
  : > "$OTHER_COLLECTOR/node_modules/.bin/tsx"; chmod +x "$OTHER_COLLECTOR/node_modules/.bin/tsx"
  : > "$OTHER_COLLECTOR/src/cli/run-coupang-wing-issuance-live.ts"
  run_case "COLLECTOR_ESCAPE (out-of-repo collector refused ON CONTAINMENT)" nonzero \
    "points outside this repository" "$FIXTURES/normal.env" "SELLEROPS_COLLECTOR_DIR=$OTHER_COLLECTOR"

  # A git that FAILS must never be read as "clean". A healthy checkout never errors, so it is injected: a `git`
  # earlier on PATH forwarding everything except `status`, which exits 128.
  FAKEBIN="$FIXTURES/fakebin"; mkdir -p "$FAKEBIN"
  REALGIT="$(command -v git)"
  cat > "$FAKEBIN/git" <<FAKE
#!/usr/bin/env bash
for a in "\$@"; do [ "\$a" = "status" ] && exit 128; done
exec "$REALGIT" "\$@"
FAKE
  chmod +x "$FAKEBIN/git"
  run_case "GIT_STATUS_FAIL (unreadable status is not \"clean\")" nonzero "refusing rather than assuming a clean tree" \
    "$FIXTURES/normal.env" "PATH=$FAKEBIN:$PATH"

  # EVERY case above overrides SELLEROPS_MANIFEST_OUT, so the DEFAULT temp path would otherwise have no coverage
  # — which is exactly where a broken mktemp template hid on the probe harness until a real run. Needs a PREPARED
  # manifest, so it runs only while the calibration is live; it is named in the PARTIAL summary when it is not.
  if [ "$ISSUE_CALIBRATED" = "1" ]; then
  DEFAULT_OK=1
  for attempt in 1 2; do
    out="$(env SELLEROPS_WING_WALK_RUN_ENV="$FIXTURES/normal.env" bash "$PREFLIGHT" 2>&1)" || DEFAULT_OK=0
    grep -qF "PREFLIGHT PASS" <<<"$out" || DEFAULT_OK=0
    grep -qF "Traceback" <<<"$out" && DEFAULT_OK=0
    grep -qiF "mktemp" <<<"$out" && DEFAULT_OK=0
  done
  if [ "$DEFAULT_OK" = "1" ]; then
    echo "  PASS  DEFAULT_OUT     · default manifest path works, and works twice in a row"
  else
    echo "  FAIL  DEFAULT_OUT     · default manifest path is broken"; echo "$out" | tail -6 | sed 's/^/        | /'; FAILED=1
  fi
  fi

  # The manifest half is skipped whenever the calibration is withdrawn, so it is accounted for exactly like the
  # dirty-tree skip: named, counted, and PARTIAL. Without this the withdrawn run would print a wall of green and
  # exit 0 while the entire PASS path — manifest, disclosure, descriptor display, grant line — went unexercised.
  if [ "$ISSUE_CALIBRATED" != "1" ]; then
    WITHDRAWN_ONLY_CASES=(NORMAL DEFAULT_OUT)
    SKIPPED=${#WITHDRAWN_ONLY_CASES[@]}
    SKIP_REASON="발급 calibration withdrawn"
    echo "  SKIP  ${WITHDRAWN_ONLY_CASES[*]} — WING_ISSUE_SELECTOR_CALIBRATED is false, so the"
    echo "        preflight refuses by design and no manifest is produced to assert against."
    echo "        Restore it from a live READ-ONLY probe, then re-run to exercise the PASS path."
  fi
else
  run_case "DIRTY_TREE      (uncommitted change refused)" nonzero "working tree is dirty" "$FIXTURES/normal.env"
  # The COUNT is derived from the list, so it cannot drift from it. The LIST is still hand-maintained: a
  # clean-only case added below without a matching entry here would under-report. Stated rather than implied,
  # because the previous comment claimed the failure mode was closed and it is not.
  CLEAN_ONLY_CASES=(NORMAL NO_LEAK GIT_DIR_HIJACK BOOTSTRAP_DIRTY BOOTSTRAP_CLEAN BOOTSTRAP_SHA COLLECTOR_ESCAPE GIT_STATUS_FAIL DEFAULT_OUT)
  SKIPPED=${#CLEAN_ONLY_CASES[@]}
  SKIP_REASON="dirty tree"
  echo "  SKIP  ${CLEAN_ONLY_CASES[*]} — the working tree is dirty, which the"
  echo "        preflight refuses by design."
  echo "        Commit or stash, then re-run to exercise the PASS path."
fi

echo
if [ "$FAILED" != "0" ]; then
  echo "SELFCHECK FAIL"
  exit 1
fi
if [ "$SKIPPED" != "0" ]; then
  # NOT "PASS". Naming the skipped cases is not enough: a green banner and exit 0 read as coverage to anything
  # that consumes the exit code, and a dirty tree is the normal state while editing this harness — exactly when
  # someone would run it. A distinct code says "the fail-closed half ran; the PASS half did not".
  echo "SELFCHECK PARTIAL — $SKIPPED case(s) skipped ($SKIP_REASON). The PASS path was NOT exercised."
  exit 2
fi
echo "SELFCHECK PASS"
exit 0
