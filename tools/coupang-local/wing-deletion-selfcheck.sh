#!/usr/bin/env bash
#
# Regression self-tests for the DESTRUCTIVE Coupang WING key-deletion preflight. Proves it FAILS CLOSED on
# every way the run can be wrong, and prepares a destructive manifest only when it is right.
#
# Fully HERMETIC: no browser, no backend, no Coupang call, NOTHING DELETED. Every case runs offline against
# fixture run-env files. The only tree mutation is a temporary untracked marker file used to produce a dirty
# tree, removed on exit.
#
# Cases:
#   NO_RUN_ENV        → FAIL (bootstrap never ran)
#   UNBOUND_RUN       → FAIL (identity is "unknown" — contract §2 UNBOUND_IDENTITY)
#   STALE_IDENTITY    → FAIL (a run env from an earlier session must not re-authorize an irreversible delete)
#   OCTAL_EPOCH       → FAIL (a malformed stamp must not abort the arithmetic and delete the freshness check)
#   MULTILINE_STAMP   → FAIL (a newline must not slip past the shape check)
#   AMBIENT_STAMP     → FAIL (the caller's shell cannot supply a key the run env omits)
#   WRONG_PHASE       → FAIL (the READ-ONLY probe phase is not approvable from the destructive harness)
#   HEAD_DRIFT        → FAIL (bootstrap commit != HEAD)
#   DIRTY_TREE        → FAIL (uncommitted/untracked change ⇒ the gitSHA would not name the running code)
#   GIT_DIR_HIJACK    → FAIL (a decoy GIT_DIR/GIT_WORK_TREE must not redirect the drift check)
#   UNTRACKED_HIDE    → FAIL (GIT_CONFIG_* forcing status.showUntrackedFiles=no must not hide a dirty tree)
#   EXCLUDES_HIDE     → FAIL (GIT_CONFIG_PARAMETERS core.excludesFile must not hide a dirty tree)
#   SCOPE_OVERRIDE    → PASS, but the manifest shows the PINNED scope — ambient env cannot re-describe the run
#   NORMAL            → PASS; destructive manifest, calibrated, exact descriptor, full disclosure
#   DEFAULT_OUT       → PASS twice in a row on the default temp path
#   WITHDRAWN         → FAIL, and displays NOTHING approval-shaped (runs INSTEAD of NORMAL/SCOPE_OVERRIDE/
#                       DEFAULT_OUT while the 삭제 calibration is withdrawn — which half runs is DERIVED from
#                       the shipped constant, never hardcoded, so neither state can be asserted as a bug)
#   BOOTSTRAP_DIRTY   → FAIL (the bootstrap itself refuses to pin a SHA against a dirty tree)
#   GIT_STATUS_FAIL   → FAIL (an unreadable `git status` must never be read as "clean")
#   HOME_IGNORE_HIDE  → FAIL ($HOME/.config/git/ignore is a DEFAULT PATH no config pin suppresses)
#   HOME_CONFIG_HIDE  → FAIL (a hostile $HOME/.gitconfig core.excludesFile must not hide dirt)
#   ASSUME_UNCHANGED  → FAIL (an index-hidden path needs no env var, so env stripping never reaches it)
#   LSFILES_FAIL      → FAIL (an unreadable index must not read as "nothing is hidden")
#   COLLECTOR_ESCAPE  → FAIL (an out-of-repo collector would verify one tree and describe another)
#   DESCRIPTOR        → the canonical descriptor is accepted, every softening and an absent one refused, and
#                       the preflight ACTS on that verdict (fixture-driven: the gate makes a softened
#                       descriptor unproducible through the CLI, so end-to-end cannot reach this)
#
# NORMAL and the dirty-tree cases are complementary: they need a clean tree, and print SKIP otherwise — every
# skipped case is NAMED, because an unnamed skip under a "SELFCHECK PASS" banner reads as coverage. Naming is not
# enough on its own either: EITHER skip reason (a withdrawn calibration, or a dirty tree) exits 2
# (SELFCHECK PARTIAL), because a green banner and exit 0 read as coverage to anything consuming the exit code.
#
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
PREFLIGHT="$HERE/wing-deletion-preflight.sh"
BOOTSTRAP="$HERE/wing-deletion-bootstrap.sh"
FIXTURES="$(mktemp -d)"
MANIFEST_OUT="$FIXTURES/manifest.json"
DIRT_FILE="$REPO_ROOT/.wing-deletion-selfcheck-dirty.tmp"

# Remove any residue from a previous crashed run BEFORE reading the tree state — otherwise a leftover marker
# would report the tree as dirty forever and silently skip the PASS-path cases.
rm -f "$DIRT_FILE"
# The assume-unchanged case marks a tracked file; clearing it in the trap means an interrupted run cannot
# leave the repository in a state where a later real preflight refuses for a reason nobody remembers.
cleanup() {
  rm -rf "$FIXTURES"; rm -f "$DIRT_FILE"
  git -C "$REPO_ROOT" update-index --no-assume-unchanged tools/coupang-local/README.md 2>/dev/null || true
}
trap cleanup EXIT INT TERM

CUR_GIT="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
TREE_DIRTY="$(git -C "$REPO_ROOT" status --porcelain 2>/dev/null | head -1)"
NOW="$(date +%s)"
FAILED=0
SKIPPED=0
SKIP_REASON=""

# Is the 삭제 selector calibration currently live? Read from the SHIPPED constant, never assumed, because the
# correct behaviour of the manifest cases INVERTS with it: while the calibration is withdrawn the preflight must
# refuse with SELECTORS_NOT_CALIBRATED, and asserting PREFLIGHT PASS would be asserting a bug.
#
# Derived rather than hardcoded to either state — hardcoding the refusal would silently delete the PASS-path
# coverage the moment a live probe restores the flag, which is precisely when that coverage matters again. Same
# derivation the reveal harness uses; the two must not drift.
DEL_CALIBRATED=0
CALIB_SRC="$REPO_ROOT/collector/src/action-window/coupang-wing-issuance-driver.ts"
if [ ! -f "$CALIB_SRC" ]; then
  echo "SELFCHECK ABORT — cannot read the calibration constant at $CALIB_SRC. Refusing to guess which half to run."
  exit 3
fi
if grep -qE '^export const WING_DELETION_SELECTORS_CALIBRATED = true;' "$CALIB_SRC"; then
  DEL_CALIBRATED=1
elif ! grep -qE '^export const WING_DELETION_SELECTORS_CALIBRATED = false;' "$CALIB_SRC"; then
  echo "SELFCHECK ABORT — WING_DELETION_SELECTORS_CALIBRATED is neither a literal true nor false. It gates whether"
  echo "                  an IRREVERSIBLE deletion run can reach a live page; a form this script cannot read is"
  echo "                  not a safe default."
  exit 3
fi

# Sourced so the descriptor verifier can be exercised DIRECTLY against crafted manifests. The gate makes a
# softened descriptor unproducible through the CLI, so testing that check end-to-end is impossible; calling the
# function is the only way it is falsifiable at all.
# shellcheck source=./wing-harness-common.sh
. "$HERE/wing-harness-common.sh"

# Write a fixture run env. $1=file $2=git commit $3=phase $4=run id $5=approval id $6=epoch
write_env() {
  cat > "$1" <<ENV
WALKTHROUGH_RUN_ID='$4'
WALKTHROUGH_APPROVAL_ID='$5'
WALKTHROUGH_GIT_COMMIT='$2'
WING_DELETION_BOOTSTRAP_EPOCH='${6:-$NOW}'
SELLEROPS_APPROVAL_PHASE='$3'
ENV
}

# $1=name $2=expected exit (0|nonzero) $3=required marker ("" to skip) $4=run env path; rest = extra env
run_case() {
  local name="$1" expect_exit="$2" marker="$3" run_env="$4"; shift 4
  local out rc ok="yes"
  out="$(env "$@" SELLEROPS_WING_DELETION_RUN_ENV="$run_env" SELLEROPS_MANIFEST_OUT="$MANIFEST_OUT" bash "$PREFLIGHT" 2>&1)"; rc=$?
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

echo "WING key-DELETION preflight selfcheck — hermetic (no browser, no Coupang call, NOTHING deleted)"
echo "HEAD=$CUR_GIT  tree=$([ -z "$TREE_DIRTY" ] && echo clean || echo dirty)"
echo

# ── identity ───────────────────────────────────────────────────────────────────
run_case "NO_RUN_ENV      (bootstrap never ran)" nonzero "no run env at" "$FIXTURES/absent.env"

write_env "$FIXTURES/unbound.env" "unknown" "COUPANG_WING_KEY_DELETION" "unknown" "unknown"
run_case "UNBOUND_RUN     (identity is \"unknown\")" nonzero "PREFLIGHT FAIL" "$FIXTURES/unbound.env"

# A destructive grant is single-use and process-lifetime. An identity from an earlier session re-authorizing an
# IRREVERSIBLE deletion is the worst version of the stale-approval failure, so the TTL here is tighter (1h).
write_env "$FIXTURES/stale.env" "$CUR_GIT" "COUPANG_WING_KEY_DELETION" "wt-selfchk01" "apr-selfchk01" "$((NOW - 7200))"
run_case "STALE_IDENTITY  (2h-old env refused by the 1h destructive TTL)" nonzero "run identity is stale" "$FIXTURES/stale.env"

write_env "$FIXTURES/octal.env" "$CUR_GIT" "COUPANG_WING_KEY_DELETION" "wt-selfchk02" "apr-selfchk02" "0000000001999999999"
run_case "OCTAL_EPOCH     (malformed stamp cannot skip the check)" nonzero "bootstrap timestamp missing or malformed" "$FIXTURES/octal.env"

# A line-wise `grep` guard would accept this (its SECOND line is a valid epoch) and then abort the arithmetic.
cat > "$FIXTURES/multiline.env" <<ENV
WALKTHROUGH_RUN_ID='wt-selfchk03'
WALKTHROUGH_APPROVAL_ID='apr-selfchk03'
WALKTHROUGH_GIT_COMMIT='$CUR_GIT'
WING_DELETION_BOOTSTRAP_EPOCH='junk
$NOW'
SELLEROPS_APPROVAL_PHASE='COUPANG_WING_KEY_DELETION'
ENV
run_case "MULTILINE_STAMP (newline cannot slip past the shape check)" nonzero "bootstrap timestamp missing or malformed" "$FIXTURES/multiline.env"

# The run env must be the ONLY source of identity: a key it omits must not fall through to the caller's shell.
cat > "$FIXTURES/nostamp.env" <<ENV
WALKTHROUGH_RUN_ID='wt-selfchk04'
WALKTHROUGH_APPROVAL_ID='apr-selfchk04'
WALKTHROUGH_GIT_COMMIT='$CUR_GIT'
SELLEROPS_APPROVAL_PHASE='COUPANG_WING_KEY_DELETION'
ENV
run_case "AMBIENT_STAMP   (caller's env cannot supply a missing key)" nonzero "bootstrap timestamp missing or malformed" \
  "$FIXTURES/nostamp.env" "WING_DELETION_BOOTSTRAP_EPOCH=$NOW"

# ── phase containment ──────────────────────────────────────────────────────────
# The mirror of the probe harness's WRONG_PHASE: neither harness may prepare the other's phase. This one
# matters more — the destructive disclosure copy must never be shown for a read-only run, and a destructive run
# must never be prepared by a harness that shows no disclosure at all.
for wrong in COUPANG_WING_SELECTOR_PROBE API_CENTER_STRUCTURE_OBSERVATION API_ISSUANCE_HIGHLIGHT_PROOF; do
  write_env "$FIXTURES/wrongphase.env" "$CUR_GIT" "$wrong" "wt-selfchk05" "apr-selfchk05"
  run_case "WRONG_PHASE     ($wrong refused here)" nonzero "phase must be COUPANG_WING_KEY_DELETION" "$FIXTURES/wrongphase.env"
done

write_env "$FIXTURES/drift.env" "0000000" "COUPANG_WING_KEY_DELETION" "wt-selfchk06" "apr-selfchk06"
run_case "HEAD_DRIFT      (commit moved since bootstrap)" nonzero "git commit changed" "$FIXTURES/drift.env"

# The DISPLAY-side descriptor check. The gate makes a softened descriptor unproducible through the CLI, so
# this is exercised directly against crafted manifests — otherwise the check is unfalsifiable and could be
# deleted without any test noticing.
CANON='{"operatorDestructiveAction":{"operation":"DELETE_WING_OPEN_API_KEY","irreversible":true,"invalidatesExistingCredentialImmediately":true,"agentPerformsAction":false,"explicitCheckpointRequired":true,"credentialValueReadBudget":0}}'
printf '%s' "$CANON" > "$FIXTURES/desc-ok.json"
DESC_OK=1
verify_destructive_descriptor "$FIXTURES/desc-ok.json" >/dev/null 2>&1 || { echo "  FAIL  DESCRIPTOR · canonical descriptor rejected"; DESC_OK=0; FAILED=1; }
# Each softening must be refused — the agent claiming to perform it, denied irreversibility, a dropped
# checkpoint, an opened value-read budget, a renamed operation, and an absent descriptor entirely.
for soft in \
  '"agentPerformsAction":true' \
  '"irreversible":false' \
  '"invalidatesExistingCredentialImmediately":false' \
  '"explicitCheckpointRequired":false' \
  '"credentialValueReadBudget":1' \
  '"operation":"DELETE_SOMETHING_ELSE"' \
  '"irreversible":"true"' \
  '"invalidatesExistingCredentialImmediately":"true"' \
  '"agentPerformsAction":"false"' \
  '"credentialValueReadBudget":"0"'
do
  # A generator that throws writes no file; the verifier then fails on a missing path and the loop reads that as
  # "softening refused" — every case would PASS while testing nothing. Mirrors the reveal selfcheck's guard.
  rm -f "$FIXTURES/desc-soft.json"
  if ! python3 -c 'import json,sys
d = json.loads(sys.argv[1]); k, v = json.loads("{" + sys.argv[2] + "}").popitem()
if k not in d["operatorDestructiveAction"]:
    sys.exit(7)
d["operatorDestructiveAction"][k] = v
open(sys.argv[3], "w").write(json.dumps(d))' "$CANON" "$soft" "$FIXTURES/desc-soft.json"; then
    echo "  FAIL  DESCRIPTOR · fixture generation FAILED for: $soft"; DESC_OK=0; FAILED=1
    continue
  fi
  # Parsed, not byte-compared: desc-ok is compact `printf` output and desc-soft is `json.dumps` with ", " / ": "
  # separators, so a byte compare can NEVER match and the branch was dead.
  if python3 -c 'import json,sys
sys.exit(0 if json.load(open(sys.argv[1])) == json.load(open(sys.argv[2])) else 1)' "$FIXTURES/desc-ok.json" "$FIXTURES/desc-soft.json"; then
    echo "  FAIL  DESCRIPTOR · fixture is identical to canonical, so it tests nothing: $soft"; DESC_OK=0; FAILED=1
    continue
  fi
  if verify_destructive_descriptor "$FIXTURES/desc-soft.json" >/dev/null 2>&1; then
    echo "  FAIL  DESCRIPTOR · softening accepted: $soft"; DESC_OK=0; FAILED=1
  fi
done
printf '%s' '{}' > "$FIXTURES/desc-absent.json"
if verify_destructive_descriptor "$FIXTURES/desc-absent.json" >/dev/null 2>&1; then
  echo "  FAIL  DESCRIPTOR · absent descriptor accepted"; DESC_OK=0; FAILED=1
fi
[ "$DESC_OK" = "1" ] && echo "  PASS  DESCRIPTOR    · canonical accepted; every softening (incl. STRING-typed booleans) and an absent descriptor refused"

# …and the preflight must ACT on that verdict. The gate makes a softened descriptor unproducible through the
# CLI, so no end-to-end case can distinguish "checked and refused" from "checked and ignored" — the wiring is
# therefore asserted on the source. Without this, deleting the `if !` would break nothing observable.
# BLOCK-scoped: both substrings stay true if `exit 1` is deleted, and execution then falls through to the PASS
# line and the manifest dump — a softened DESTRUCTIVE descriptor displayed under a grant line.
# The range END is /^fi/, not /^fi$/: a decorated `fi  # comment` does not close the strict form, so the range
# runs on to the NEXT bare fi and swallows another refusal's `exit 1`.
DESC_BLOCK="$(awk '/^if ! verify_destructive_descriptor "\$MANIFEST_OUT"; then$/,/^fi/' "$PREFLIGHT")"
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

# ── the clean/dirty pair, and the demonstrated git-environment bypasses ─────────
write_env "$FIXTURES/normal.env" "$CUR_GIT" "COUPANG_WING_KEY_DELETION" "wt-selfchk07" "apr-selfchk07"
if [ -z "$TREE_DIRTY" ]; then
  # The manifest cases require a LIVE calibration. With it withdrawn the preflight must refuse, so the two halves
  # below are alternatives, not a pass/skip: exactly one of them is the correct behaviour at any given commit.
  if [ "$DEL_CALIBRATED" = "1" ]; then
  run_case "NORMAL          (destructive manifest prepared)" 0 "PREFLIGHT PASS" "$FIXTURES/normal.env"
  run_case "NORMAL          · manifest phase" 0 "COUPANG_WING_KEY_DELETION" "$FIXTURES/normal.env"
  run_case "NORMAL          · agent mode stays READ_ONLY" 0 "agent mode: READ_ONLY" "$FIXTURES/normal.env"
  run_case "NORMAL          · selector calibration disclosed" 0 "selectors calibrated: true" "$FIXTURES/normal.env"
  run_case "NORMAL          · descriptor verified before display" 0 "destructive descriptor is exactly the canonical contract" "$FIXTURES/normal.env"
  run_case "NORMAL          · one-line grant offered" 0 "Seated and ready." "$FIXTURES/normal.env"
  run_case "NORMAL          · run command is the DELETION entrypoint" 0 "run-coupang-wing-deletion-live.ts" "$FIXTURES/normal.env"

  # The disclosure is the reason this harness exists rather than reusing the probe's. Each of the four facts
  # the operator must carry into an irreversible decision has to be on screen, not implied.
  out="$(env SELLEROPS_WING_DELETION_RUN_ENV="$FIXTURES/normal.env" SELLEROPS_MANIFEST_OUT="$MANIFEST_OUT" bash "$PREFLIGHT" 2>&1)"
  DISCLOSE_OK=1
  for phrase in \
    "IRREVERSIBLE DELETION" \
    "stop working IMMEDIATELY" \
    "RECOVERY IS NOT AN UNDO" \
    "issue a BRAND-NEW key" \
    "REPLACE the" \
    "SellerOps DOES NOT DELETE" \
    "budget on the marketplace is ZERO" \
    "YOU press 삭제 yourself"
  do
    grep -qF "$phrase" <<<"$out" || { echo "  FAIL  NORMAL          · disclosure missing: $phrase"; DISCLOSE_OK=0; FAILED=1; }
  done
  [ "$DISCLOSE_OK" = "1" ] && echo "  PASS  NORMAL          · full irreversibility disclosure shown before the grant line"

  # A calibration phase must NEVER hand the operator a frontend URL (the historical defect).
  if grep -qF "localhost:5173" <<<"$out" || grep -qF "/connect/" <<<"$out"; then
    echo "  FAIL  NORMAL          · no frontend URL (a CLI phase must not emit one)"; FAILED=1
  else
    echo "  PASS  NORMAL          · no frontend URL emitted"
  fi
  # The destructive descriptor must reach the operator in full, not just as a PASS line.
  if grep -qF '"DELETE_WING_OPEN_API_KEY"' <<<"$out" && grep -qF '"agentPerformsAction": false' <<<"$out" \
     && grep -qF '"credentialValueReadBudget": 0' <<<"$out"; then
    echo "  PASS  NORMAL          · manifest carries the immutable destructive descriptor"
  else
    echo "  FAIL  NORMAL          · destructive descriptor missing from the displayed manifest"; FAILED=1
  fi
  # This harness prepares a DESTRUCTIVE run — it must never emit a probe scope, which belongs to the other one.
  if grep -qF '"probeTargets"' <<<"$out"; then
    echo "  FAIL  NORMAL          · destructive manifest carries a probe scope"; FAILED=1
  else
    echo "  PASS  NORMAL          · no probe scope on the destructive manifest"
  fi

  # The pinned scope: ambient env must not be able to re-describe the run the grant binds to. The gate refuses
  # a deviation (DESTRUCTIVE_SCOPE_MISMATCH) and the CLI feeds pinned values — so this must PASS with the
  # pinned wording, never fail and never show the ambient string.
  out="$(env SELLEROPS_APPROVAL_CHANNEL="NAVER" \
             SELLEROPS_APPROVAL_ACCOUNT="AMBIENT-ACCOUNT-MUST-NOT-APPEAR" \
             SELLEROPS_APPROVAL_SURFACE="AMBIENT-SURFACE-MUST-NOT-APPEAR" \
             SELLEROPS_APPROVAL_OPERATION="AMBIENT-PROSE-MUST-NOT-APPEAR" \
             SELLEROPS_APPROVAL_MAX="AMBIENT-MAX-MUST-NOT-APPEAR" \
             SELLEROPS_WING_DELETION_RUN_ENV="$FIXTURES/normal.env" SELLEROPS_MANIFEST_OUT="$MANIFEST_OUT" \
             bash "$PREFLIGHT" 2>&1)"; rc=$?
  if [ "$rc" = "0" ] && ! grep -qF "MUST-NOT-APPEAR" <<<"$out" && ! grep -qF "NAVER" <<<"$out" \
     && grep -qF "COUPANG · WING open-API key deletion" <<<"$out"; then
    echo "  PASS  SCOPE_OVERRIDE  · pinned scope displayed; ambient env never reaches the manifest"
  else
    echo "  FAIL  SCOPE_OVERRIDE  · ambient env changed or blocked the destructive manifest (exit=$rc)"
    echo "$out" | tail -8 | sed 's/^/        | /'; FAILED=1
  fi

  else
  # ── the calibration is WITHDRAWN: the destructive manifest path must be closed ─
  # Withdrawn 2026-08-09. The 2026-08-07 capture was taken before the locator could tell a painting element from
  # a hidden one, so `matchCount: 1` no longer supports "one visible 삭제 control". Until a read-only probe
  # re-measures it, reaching PREPARED here would be the defect — and on an IRREVERSIBLE action, a refusal that
  # still printed the manifest and the grant line would invite an operator to grant against a run that cannot be
  # honoured. So this half asserts the refusal AND that nothing approval-shaped is displayed beside it.
  run_case "WITHDRAWN       (uncalibrated 삭제 selector refused)" nonzero "SELECTORS_NOT_CALIBRATED" "$FIXTURES/normal.env"

  out="$(env SELLEROPS_WING_DELETION_RUN_ENV="$FIXTURES/normal.env" SELLEROPS_MANIFEST_OUT="$MANIFEST_OUT" bash "$PREFLIGHT" 2>&1)"
  WITHDRAWN_OK=1
  for forbidden in "Seated and ready." "APPROVAL MANIFEST" "PREFLIGHT PASS" '"operatorDestructiveAction"' "selectors calibrated: true"; do
    grep -qF "$forbidden" <<<"$out" \
      && { echo "  FAIL  WITHDRAWN       · a refusal still displayed: $forbidden"; WITHDRAWN_OK=0; FAILED=1; }
  done
  [ "$WITHDRAWN_OK" = "1" ] \
    && echo "  PASS  WITHDRAWN       · no destructive manifest, no descriptor, and no grant line reach the operator"
  # The remedy must be the one that cannot repeat the mistake: a live measurement, not an edit.
  if grep -qF "READ-ONLY" <<<"$out"; then
    echo "  PASS  WITHDRAWN       · the refusal names a READ-ONLY probe as the way back"
  else
    echo "  FAIL  WITHDRAWN       · the refusal does not say how to restore the calibration"; FAILED=1
  fi
  fi

  : > "$DIRT_FILE"
  run_case "DIRTY_TREE      (uncommitted change refused)" nonzero "working tree is dirty" "$FIXTURES/normal.env"
  # A decoy repository must not become the thing the drift check reads.
  DECOY="$FIXTURES/decoy"; mkdir -p "$DECOY"
  ( cd "$DECOY" && git init -q . && git -c user.email=s@e -c user.name=s commit -q --allow-empty -m decoy ) >/dev/null 2>&1
  run_case "GIT_DIR_HIJACK  (decoy repo ignored)" nonzero "working tree is dirty" "$FIXTURES/normal.env" \
    "GIT_DIR=$DECOY/.git" "GIT_WORK_TREE=$DECOY"
  run_case "UNTRACKED_HIDE  (status config override ignored)" nonzero "working tree is dirty" "$FIXTURES/normal.env" \
    "GIT_CONFIG_COUNT=1" "GIT_CONFIG_KEY_0=status.showUntrackedFiles" "GIT_CONFIG_VALUE_0=no"
  printf '%s\n' ".wing-deletion-selfcheck-dirty.tmp" > "$FIXTURES/excludes"
  run_case "EXCLUDES_HIDE   (GIT_CONFIG_PARAMETERS ignored)" nonzero "working tree is dirty" "$FIXTURES/normal.env" \
    "GIT_CONFIG_PARAMETERS='core.excludesFile=$FIXTURES/excludes'"

  # The BOOTSTRAP must refuse a dirty tree too: pinning a SHA that already does not describe the tree just
  # defers a guaranteed refusal, and leaves a run env that looks valid.
  out="$(bash "$BOOTSTRAP" 2>&1)"; rc=$?
  if [ "$rc" != "0" ] && grep -qF "working tree is dirty" <<<"$out"; then
    echo "  PASS  BOOTSTRAP_DIRTY · bootstrap refuses to pin a SHA against a dirty tree"
  else
    echo "  FAIL  BOOTSTRAP_DIRTY · bootstrap minted an identity on a dirty tree (exit=$rc)"; FAILED=1
  fi
  rm -f "$DIRT_FILE"

  # $HOME/.config/git/ignore is read from a DEFAULT PATH, not through core.excludesFile — so pinning the config
  # files does NOT close it and a prepared HOME hides untracked files with no config involved. (Review
  # demonstrated exactly this surviving the config pin.) Only the `-c core.excludesFile=/dev/null` closes it.
  : > "$DIRT_FILE"
  HOSTILE_HOME="$FIXTURES/hostile-home"; mkdir -p "$HOSTILE_HOME/.config/git"
  printf '%s\n' ".wing-deletion-selfcheck-dirty.tmp" > "$HOSTILE_HOME/.config/git/ignore"
  run_case "HOME_IGNORE_HIDE (\$HOME/.config/git/ignore ignored)" nonzero "working tree is dirty" "$FIXTURES/normal.env" \
    "HOME=$HOSTILE_HOME"
  # …and the same via a hostile global gitconfig, which the config pin is what closes.
  printf '[core]\n\texcludesFile = %s/ex\n' "$HOSTILE_HOME" > "$HOSTILE_HOME/.gitconfig"
  printf '%s\n' ".wing-deletion-selfcheck-dirty.tmp" > "$HOSTILE_HOME/ex"
  run_case "HOME_CONFIG_HIDE (\$HOME/.gitconfig excludesFile ignored)" nonzero "working tree is dirty" "$FIXTURES/normal.env" \
    "HOME=$HOSTILE_HOME"
  rm -f "$DIRT_FILE"

  # `--assume-unchanged` needs NO environment variable, so stripping the git env never reaches it: a modified
  # tracked file simply stops appearing in `status --porcelain`. Marked on a file the run does not depend on,
  # and cleared immediately afterwards whether the case passes or fails.
  MARKED_PATH="tools/coupang-local/README.md"
  git -C "$REPO_ROOT" update-index --assume-unchanged "$MARKED_PATH" 2>/dev/null
  run_case "ASSUME_UNCHANGED (index-hidden path refused)" nonzero "invisible to git status" "$FIXTURES/normal.env"
  git -C "$REPO_ROOT" --no-optional-locks update-index --no-assume-unchanged "$MARKED_PATH" 2>/dev/null

  # An unreadable INDEX must not read as "nothing is hidden" — the same fail-open shape as a failing `status`.
  # Piping `ls-files -v` straight into `grep -c` prints 0 on error and would render as "working tree clean".
  LSBIN="$FIXTURES/lsbin"; mkdir -p "$LSBIN"
  cat > "$LSBIN/git" <<FAKE
#!/usr/bin/env bash
for a in "\$@"; do [ "\$a" = "ls-files" ] && exit 128; done
exec "$(command -v git)" "\$@"
FAKE
  chmod +x "$LSBIN/git"
  run_case "LSFILES_FAIL    (unreadable index is not \"nothing hidden\")" nonzero "could not read the git index" \
    "$FIXTURES/normal.env" "PATH=$LSBIN:$PATH"

  # The collector must be THIS repository's collector, or the drift check verifies one checkout while the
  # manifest is built from another and the displayed provenance line describes a tree nothing looked at.
  OTHER_COLLECTOR="$FIXTURES/other/collector"; mkdir -p "$OTHER_COLLECTOR"
  run_case "COLLECTOR_ESCAPE (out-of-repo collector refused)" nonzero "points outside this repository" \
    "$FIXTURES/normal.env" "SELLEROPS_COLLECTOR_DIR=$OTHER_COLLECTOR"

  # A git that FAILS must never be read as "clean". No other case produces this, because a healthy checkout
  # never errors — so it is injected: a `git` earlier on PATH that forwards everything except `status`, which
  # exits 128. Without the guard the empty stdout looks exactly like a clean tree.
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

  # EVERY case above overrides SELLEROPS_MANIFEST_OUT, so the DEFAULT temp path would otherwise have no
  # coverage — which is exactly where a broken mktemp template hid on the probe harness until a real run.
  if [ "$DEL_CALIBRATED" = "1" ]; then
  DEFAULT_OK=1
  for attempt in 1 2; do
    out="$(env SELLEROPS_WING_DELETION_RUN_ENV="$FIXTURES/normal.env" bash "$PREFLIGHT" 2>&1)" || DEFAULT_OK=0
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

  # The manifest half is skipped whenever the calibration is withdrawn, and it is NAMED and COUNTED rather than
  # silently absent. Without this the withdrawn run prints a wall of green and exits 0 while the entire PASS path
  # — manifest, irreversibility disclosure, descriptor display, pinned scope, grant line — goes unexercised.
  if [ "$DEL_CALIBRATED" != "1" ]; then
    WITHDRAWN_ONLY_CASES=(NORMAL SCOPE_OVERRIDE DEFAULT_OUT)
    SKIPPED=${#WITHDRAWN_ONLY_CASES[@]}
    SKIP_REASON="삭제 calibration withdrawn"
    echo "  SKIP  ${WITHDRAWN_ONLY_CASES[*]} — WING_DELETION_SELECTORS_CALIBRATED is false, so"
    echo "        the preflight refuses by design and no destructive manifest is produced to assert against."
    echo "        Restore it from a live READ-ONLY delete probe, then re-run to exercise the PASS path."
  fi
else
  run_case "DIRTY_TREE      (uncommitted change refused)" nonzero "working tree is dirty" "$FIXTURES/normal.env"
  # The COUNT is derived from the list, so it cannot drift from it. The LIST is hand-maintained: a clean-only
  # case added above without an entry here under-reports. WITHDRAWN belongs on it — it is the only end-to-end
  # check that the destructive path is closed, and a dirty tree is the normal state while editing this harness.
  CLEAN_ONLY_CASES=(NORMAL WITHDRAWN SCOPE_OVERRIDE GIT_DIR_HIJACK UNTRACKED_HIDE EXCLUDES_HIDE BOOTSTRAP_DIRTY
                    GIT_STATUS_FAIL HOME_IGNORE_HIDE HOME_CONFIG_HIDE ASSUME_UNCHANGED LSFILES_FAIL
                    COLLECTOR_ESCAPE DEFAULT_OUT)
  SKIPPED=${#CLEAN_ONLY_CASES[@]}
  SKIP_REASON="dirty tree"
  echo "  SKIP  ${CLEAN_ONLY_CASES[*]} — the working tree is dirty, which the"
  echo "        preflight refuses by design."
  echo "        Commit or stash, then re-run to exercise the PASS path."
fi

echo
if [ "$FAILED" != "0" ]; then echo "SELFCHECK FAIL"; exit 1; fi
if [ "$SKIPPED" != "0" ]; then
  # NOT "PASS". Naming the skipped cases is not enough: a green banner and exit 0 read as coverage to anything
  # that consumes the exit code. A distinct code says "the fail-closed half ran; the PASS half did not".
  #
  # Covers BOTH skip reasons — the withdrawn calibration and a dirty tree. An earlier draft deferred the
  # dirty-tree half as "shared debt with wing-probe-selfcheck.sh"; review showed that was wrong. The reveal
  # harness already closed it, and this file says elsewhere the two must not drift, so it was drift, not debt.
  echo "SELFCHECK PARTIAL — $SKIPPED case(s) skipped ($SKIP_REASON). The PASS path was NOT exercised."
  exit 2
fi
echo "SELFCHECK PASS"
exit 0
