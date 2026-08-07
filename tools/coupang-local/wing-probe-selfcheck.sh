#!/usr/bin/env bash
#
# Regression self-tests for the Coupang WING selector-probe preflight. Proves the gate FAILS CLOSED on every
# way the run can be wrong, and prepares a manifest only when it is right.
#
# Unlike tools/naver-local/preflight-selfcheck.sh this is fully HERMETIC: the WING probe needs no backend, no
# DB and no frontend, so every case runs offline against fixture run-env files. It launches no browser, makes
# no Coupang call, and mutates no tracked file.
#
# Cases:
#   NO_RUN_ENV      → FAIL (bootstrap never ran)
#   UNBOUND_RUN     → FAIL (identity is "unknown" — contract §2 UNBOUND_IDENTITY)
#   STALE_IDENTITY  → FAIL (a run env left over from an earlier session must not re-authorize a new one)
#   WRONG_PHASE     → FAIL (this harness prepares the selector probe only, never the destructive deletion phase)
#   GIT_DRIFT       → FAIL (bootstrap commit != HEAD)
#   BAD_SCOPE       → FAIL (unknown probe target ⇒ WING_PROBE_TARGETS_MISMATCH from the tested gate)
#   MIXED_ORDER     → PASS, but the manifest shows the NORMALIZED canonical scope, never a widened one
#   EMPTY_SCOPE     → PASS with the FULL fixed target set — an empty scope means "all", not "none", and the
#                     manifest must say so out loud before the operator grants
#   DIRTY_TREE      → FAIL (uncommitted change ⇒ the manifest's gitSHA would not name the running code)
#   GIT_DIR_HIJACK  → FAIL (a decoy GIT_DIR/GIT_WORK_TREE must not redirect the drift check off this repo)
#   UNTRACKED_HIDE  → FAIL (GIT_CONFIG_* forcing status.showUntrackedFiles=no must not hide a dirty tree)
#   NORMAL          → PASS; delete-only READ_ONLY scope, no frontend URL, approved scope bound to the run
#
# NORMAL and the three dirty-tree cases are complementary: they need a clean tree, and print SKIP otherwise.
#
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
PREFLIGHT="$HERE/wing-probe-preflight.sh"
FIXTURES="$(mktemp -d)"
MANIFEST_OUT="$FIXTURES/manifest.json"
DIRT_FILE="$REPO_ROOT/.wing-probe-selfcheck-dirty.tmp"

# Remove any residue from a previous crashed run BEFORE reading the tree state — otherwise a leftover marker
# would report the tree as dirty forever and silently skip the PASS-path cases.
rm -f "$DIRT_FILE"
cleanup() { rm -rf "$FIXTURES"; rm -f "$DIRT_FILE"; }
trap cleanup EXIT INT TERM

CUR_GIT="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
TREE_DIRTY="$(git -C "$REPO_ROOT" status --porcelain 2>/dev/null | head -1)"
NOW="$(date +%s)"
FAILED=0

# Write a fixture run env. $1=file $2=git commit $3=phase $4=probe targets $5=run id $6=approval id $7=epoch
write_env() {
  cat > "$1" <<ENV
WALKTHROUGH_RUN_ID='$5'
WALKTHROUGH_APPROVAL_ID='$6'
WALKTHROUGH_GIT_COMMIT='$2'
WING_PROBE_BOOTSTRAP_EPOCH='${7:-$NOW}'
SELLEROPS_APPROVAL_PHASE='$3'
SELLEROPS_WING_PROBE_TARGETS='$4'
ENV
}

# $1=name $2=expected exit (0|nonzero) $3=required marker ("" to skip) $4=run env path; rest = extra env
run_case() {
  local name="$1" expect_exit="$2" marker="$3" run_env="$4"; shift 4
  local out rc ok="yes"
  out="$(env "$@" SELLEROPS_WING_PROBE_RUN_ENV="$run_env" SELLEROPS_MANIFEST_OUT="$MANIFEST_OUT" bash "$PREFLIGHT" 2>&1)"; rc=$?
  [ "$expect_exit" = "0" ] && [ "$rc" != "0" ] && ok="no"
  [ "$expect_exit" = "nonzero" ] && [ "$rc" = "0" ] && ok="no"
  [ -n "$marker" ] && ! grep -qF "$marker" <<<"$out" && ok="no"
  if [ "$ok" = "yes" ]; then
    echo "  PASS  $name (exit=$rc)"
  else
    echo "  FAIL  $name (exit=$rc, expected=$expect_exit, marker='$marker')"
    echo "$out" | tail -10 | sed 's/^/        | /'
    FAILED=1
  fi
}

echo "WING selector-probe preflight selfcheck — hermetic (no browser, no backend, no Coupang call)"
echo "HEAD=$CUR_GIT  tree=$([ -z "$TREE_DIRTY" ] && echo clean || echo dirty)"
echo

# ── identity ───────────────────────────────────────────────────────────────────
run_case "NO_RUN_ENV     (bootstrap never ran)" nonzero "no run env at" "$FIXTURES/absent.env"

write_env "$FIXTURES/unbound.env" "unknown" "COUPANG_WING_SELECTOR_PROBE" "delete" "unknown" "unknown"
run_case "UNBOUND_RUN    (identity is \"unknown\")" nonzero "PREFLIGHT FAIL" "$FIXTURES/unbound.env"

write_env "$FIXTURES/stale.env" "$CUR_GIT" "COUPANG_WING_SELECTOR_PROBE" "delete" "wt-selfcheck07" "apr-selfcheck07" "$((NOW - 86400))"
run_case "STALE_IDENTITY (a day-old run env)" nonzero "run identity is stale" "$FIXTURES/stale.env"

write_env "$FIXTURES/wrongphase.env" "$CUR_GIT" "COUPANG_WING_KEY_DELETION" "delete" "wt-selfcheck01" "apr-selfcheck01"
run_case "WRONG_PHASE    (destructive phase refused here)" nonzero "phase must be COUPANG_WING_SELECTOR_PROBE" "$FIXTURES/wrongphase.env"

write_env "$FIXTURES/drift.env" "0000000" "COUPANG_WING_SELECTOR_PROBE" "delete" "wt-selfcheck02" "apr-selfcheck02"
run_case "GIT_DRIFT      (commit moved since bootstrap)" nonzero "git commit changed" "$FIXTURES/drift.env"

# ── scope ──────────────────────────────────────────────────────────────────────
write_env "$FIXTURES/badscope.env" "$CUR_GIT" "COUPANG_WING_SELECTOR_PROBE" "nope" "wt-selfcheck03" "apr-selfcheck03"
# The operator's env string is NORMALIZED by resolveWingProbeScope (canonical order + de-duplicated) so the
# manifest and the recorder measure exactly the same set. What must never happen is a scope that WIDENS past
# what was requested, or a run that silently disagrees with what was displayed.
write_env "$FIXTURES/mixedorder.env" "$CUR_GIT" "COUPANG_WING_SELECTOR_PROBE" "issue,self_dev,issue" "wt-selfcheck04" "apr-selfcheck04"
write_env "$FIXTURES/emptyscope.env" "$CUR_GIT" "COUPANG_WING_SELECTOR_PROBE" "" "wt-selfcheck06" "apr-selfcheck06"
if [ -z "$TREE_DIRTY" ]; then
  run_case "BAD_SCOPE      (unknown probe target)" nonzero "WING_PROBE_TARGETS_MISMATCH" "$FIXTURES/badscope.env"
  run_case "MIXED_ORDER    (scope normalized, not widened)" 0 "probe targets: self_dev,issue" "$FIXTURES/mixedorder.env"
  out="$(SELLEROPS_WING_PROBE_RUN_ENV="$FIXTURES/mixedorder.env" SELLEROPS_MANIFEST_OUT="$MANIFEST_OUT" bash "$PREFLIGHT" 2>&1)"
  if grep -qF '"delete"' <<<"$out" || grep -qF '"credentials"' <<<"$out"; then
    echo "  FAIL  MIXED_ORDER    · scope widened past the requested targets"; FAILED=1
  else
    echo "  PASS  MIXED_ORDER    · no unrequested target in the manifest"
  fi
  # An empty scope is "all targets", not "no targets" — the manifest must display the full set so the
  # operator can see the widening before granting.
  run_case "EMPTY_SCOPE    (empty ⇒ FULL fixed set, displayed)" 0 "self_dev,vendor_info,call_ip,issue,credentials,delete" "$FIXTURES/emptyscope.env"
else
  run_case "BAD_SCOPE      (unknown probe target)" nonzero "PREFLIGHT FAIL" "$FIXTURES/badscope.env"
  echo "  SKIP  MIXED_ORDER / EMPTY_SCOPE — dirty tree fails before the manifest gate"
fi

# ── the clean/dirty pair, and the two demonstrated git-environment bypasses ─────
write_env "$FIXTURES/normal.env" "$CUR_GIT" "COUPANG_WING_SELECTOR_PROBE" "delete" "wt-selfcheck05" "apr-selfcheck05"
if [ -z "$TREE_DIRTY" ]; then
  run_case "NORMAL         (delete-only READ_ONLY scope)" 0 "PREFLIGHT PASS" "$FIXTURES/normal.env"
  run_case "NORMAL         · manifest phase" 0 "COUPANG_WING_SELECTOR_PROBE" "$FIXTURES/normal.env"
  run_case "NORMAL         · READ_ONLY mode" 0 "READ_ONLY" "$FIXTURES/normal.env"
  run_case "NORMAL         · one-line grant offered" 0 "Seated and ready." "$FIXTURES/normal.env"
  run_case "NORMAL         · run command carries the approved scope" 0 "SELLEROPS_WING_PROBE_TARGETS=delete" "$FIXTURES/normal.env"
  out="$(SELLEROPS_WING_PROBE_RUN_ENV="$FIXTURES/normal.env" SELLEROPS_MANIFEST_OUT="$MANIFEST_OUT" bash "$PREFLIGHT" 2>&1)"
  # The historical defect this guards: a calibration phase must NEVER hand the operator a frontend URL.
  if grep -qF "localhost:5173" <<<"$out" || grep -qF "/connect/" <<<"$out"; then
    echo "  FAIL  NORMAL         · no frontend URL (a CLI phase must not emit one)"; FAILED=1
  else
    echo "  PASS  NORMAL         · no frontend URL emitted"
  fi
  if grep -qF '"probeTargets"' <<<"$out" && grep -qF '"delete"' <<<"$out"; then
    echo "  PASS  NORMAL         · manifest probeTargets = [delete]"
  else
    echo "  FAIL  NORMAL         · manifest probeTargets missing the delete-only scope"; FAILED=1
  fi
  # The approved scope must be bound to the run env, so sourcing it cannot reproduce a wider set.
  if grep -qE "^SELLEROPS_WING_PROBE_TARGETS='delete'$" "$FIXTURES/normal.env"; then
    echo "  PASS  NORMAL         · approved scope written back to the run env"
  else
    echo "  FAIL  NORMAL         · approved scope not bound to the run env"; FAILED=1
  fi
  # …and an empty request must be bound as the RESOLVED full set, not left empty for the run to re-widen.
  if grep -qE "^SELLEROPS_WING_PROBE_TARGETS='self_dev,vendor_info,call_ip,issue,credentials,delete'$" "$FIXTURES/emptyscope.env"; then
    echo "  PASS  EMPTY_SCOPE    · resolved full set bound to the run env"
  else
    echo "  FAIL  EMPTY_SCOPE    · empty scope left unbound in the run env"; FAILED=1
  fi

  : > "$DIRT_FILE"
  run_case "DIRTY_TREE     (uncommitted change refused)" nonzero "working tree is dirty" "$FIXTURES/normal.env"
  # A decoy repository must not become the thing the drift check reads.
  DECOY="$FIXTURES/decoy"; mkdir -p "$DECOY"
  ( cd "$DECOY" && git init -q . && git -c user.email=s@e -c user.name=s commit -q --allow-empty -m decoy ) >/dev/null 2>&1
  run_case "GIT_DIR_HIJACK (decoy repo ignored)" nonzero "working tree is dirty" "$FIXTURES/normal.env" \
    "GIT_DIR=$DECOY/.git" "GIT_WORK_TREE=$DECOY"
  # A config injection must not hide untracked files.
  run_case "UNTRACKED_HIDE (status config override ignored)" nonzero "working tree is dirty" "$FIXTURES/normal.env" \
    "GIT_CONFIG_COUNT=1" "GIT_CONFIG_KEY_0=status.showUntrackedFiles" "GIT_CONFIG_VALUE_0=no"
  rm -f "$DIRT_FILE"
else
  run_case "DIRTY_TREE     (uncommitted change refused)" nonzero "working tree is dirty" "$FIXTURES/normal.env"
  echo "  SKIP  NORMAL / GIT_DIR_HIJACK / UNTRACKED_HIDE — the working tree is dirty, which the preflight"
  echo "        refuses by design. Commit or stash, then re-run to exercise the PASS path."
fi

echo
if [ "$FAILED" = "0" ]; then echo "SELFCHECK PASS"; exit 0; else echo "SELFCHECK FAIL"; exit 1; fi
