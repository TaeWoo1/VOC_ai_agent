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
#   NO_RUN_ENV     → FAIL (bootstrap never ran)
#   UNBOUND_RUN    → FAIL (identity is "unknown" — contract §2 UNBOUND_IDENTITY)
#   WRONG_PHASE    → FAIL (this harness prepares the selector probe only, never the destructive deletion phase)
#   GIT_DRIFT      → FAIL (bootstrap commit != HEAD)
#   BAD_SCOPE      → FAIL (unknown probe target ⇒ WING_PROBE_TARGETS_MISMATCH from the tested gate)
#   MIXED_ORDER    → PASS, but the manifest shows the NORMALIZED canonical scope, never a widened one
#   EMPTY_SCOPE    → PASS with the FULL fixed target set — an empty scope means "all", not "none", and the
#                    manifest must say so out loud before the operator grants
#   DIRTY_TREE     → FAIL (uncommitted change ⇒ the manifest's gitSHA would not name the running code)
#   NORMAL         → PASS, manifest shows the delete-only READ_ONLY scope and NO frontend URL
#
# NORMAL and DIRTY_TREE are complementary: exactly one of them is runnable, decided by whether the working
# tree is currently clean. Each prints SKIP with the reason when it is not the applicable one.
#
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFLIGHT="$HERE/wing-probe-preflight.sh"
FIXTURES="$(mktemp -d)"
MANIFEST_OUT="$FIXTURES/manifest.json"
CUR_GIT="$(git -C "$HERE" rev-parse --short HEAD 2>/dev/null || echo unknown)"
TREE_DIRTY="$(git -C "$HERE" status --porcelain 2>/dev/null | head -1)"
DIRT_FILE="$(cd "$HERE/../.." && pwd)/.wing-probe-selfcheck-dirty.tmp"

cleanup() { rm -rf "$FIXTURES"; rm -f "$DIRT_FILE"; }
trap cleanup EXIT INT TERM

FAILED=0

# Write a fixture run env. $1=file, $2=git commit, $3=phase, $4=probe targets, $5=run id, $6=approval id
write_env() {
  cat > "$1" <<ENV
WALKTHROUGH_RUN_ID=$5
WALKTHROUGH_APPROVAL_ID=$6
WALKTHROUGH_GIT_COMMIT=$2
SELLEROPS_APPROVAL_PHASE=$3
SELLEROPS_WING_PROBE_TARGETS=$4
ENV
}

# $1=name $2=expected exit (0|nonzero) $3=required marker ("" to skip) $4=run env path
run_case() {
  local name="$1" expect_exit="$2" marker="$3" run_env="$4"
  local out rc ok="yes"
  out="$(SELLEROPS_WING_PROBE_RUN_ENV="$run_env" SELLEROPS_MANIFEST_OUT="$MANIFEST_OUT" bash "$PREFLIGHT" 2>&1)"; rc=$?
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

# ── failure cases ──────────────────────────────────────────────────────────────
run_case "NO_RUN_ENV    (bootstrap never ran)" nonzero "no run env at" "$FIXTURES/absent.env"

write_env "$FIXTURES/unbound.env" "unknown" "COUPANG_WING_SELECTOR_PROBE" "delete" "unknown" "unknown"
run_case "UNBOUND_RUN   (identity is \"unknown\")" nonzero "PREFLIGHT FAIL" "$FIXTURES/unbound.env"

write_env "$FIXTURES/wrongphase.env" "$CUR_GIT" "COUPANG_WING_KEY_DELETION" "delete" "wt-selfcheck01" "apr-selfcheck01"
run_case "WRONG_PHASE   (destructive phase refused here)" nonzero "phase must be COUPANG_WING_SELECTOR_PROBE" "$FIXTURES/wrongphase.env"

write_env "$FIXTURES/drift.env" "0000000" "COUPANG_WING_SELECTOR_PROBE" "delete" "wt-selfcheck02" "apr-selfcheck02"
run_case "GIT_DRIFT     (commit moved since bootstrap)" nonzero "git commit changed" "$FIXTURES/drift.env"

write_env "$FIXTURES/badscope.env" "$CUR_GIT" "COUPANG_WING_SELECTOR_PROBE" "nope" "wt-selfcheck03" "apr-selfcheck03"
# The operator's env string is NORMALIZED by resolveWingProbeScope (canonical order + de-duplicated) so the
# manifest and the recorder measure exactly the same set. What must never happen is a scope that WIDENS past
# the canonical set or silently disagrees with what was displayed — that is what these two cases pin.
write_env "$FIXTURES/mixedorder.env" "$CUR_GIT" "COUPANG_WING_SELECTOR_PROBE" "issue,self_dev,issue" "wt-selfcheck04" "apr-selfcheck04"
write_env "$FIXTURES/emptyscope.env" "$CUR_GIT" "COUPANG_WING_SELECTOR_PROBE" "" "wt-selfcheck06" "apr-selfcheck06"
if [ -z "$TREE_DIRTY" ]; then
  run_case "BAD_SCOPE     (unknown probe target)" nonzero "WING_PROBE_TARGETS_MISMATCH" "$FIXTURES/badscope.env"
  # Requested "issue,self_dev,issue" ⇒ displayed "['self_dev', 'issue']": canonical order, de-duplicated,
  # and no target the operator did not ask for.
  run_case "MIXED_ORDER   (scope normalized, not widened)" 0 "['self_dev', 'issue']" "$FIXTURES/mixedorder.env"
  out="$(SELLEROPS_WING_PROBE_RUN_ENV="$FIXTURES/mixedorder.env" SELLEROPS_MANIFEST_OUT="$MANIFEST_OUT" bash "$PREFLIGHT" 2>&1)"
  if grep -qF '"delete"' <<<"$out" || grep -qF '"credentials"' <<<"$out"; then
    echo "  FAIL  MIXED_ORDER   · scope widened past the requested targets"; FAILED=1
  else
    echo "  PASS  MIXED_ORDER   · no unrequested target in the manifest"
  fi
  # An empty scope is "all targets", not "no targets" — the manifest must display the full set so the
  # operator can see the widening before granting.
  run_case "EMPTY_SCOPE   (empty ⇒ FULL fixed set, displayed)" 0 "'self_dev', 'vendor_info', 'call_ip', 'issue', 'credentials', 'delete'" "$FIXTURES/emptyscope.env"
else
  # A dirty tree fails earlier (check 3), so the scope cases cannot reach the manifest gate. The scope
  # resolution itself is the gate's own tested behaviour (collector/test/cli/approval-manifest.test.ts).
  run_case "BAD_SCOPE     (unknown probe target)" nonzero "PREFLIGHT FAIL" "$FIXTURES/badscope.env"
  echo "  SKIP  MIXED_ORDER / EMPTY_SCOPE — dirty tree fails before the manifest gate"
fi

# ── the clean/dirty pair ───────────────────────────────────────────────────────
write_env "$FIXTURES/normal.env" "$CUR_GIT" "COUPANG_WING_SELECTOR_PROBE" "delete" "wt-selfcheck05" "apr-selfcheck05"
if [ -z "$TREE_DIRTY" ]; then
  run_case "NORMAL        (delete-only READ_ONLY scope)" 0 "PREFLIGHT PASS" "$FIXTURES/normal.env"
  run_case "NORMAL        · manifest phase" 0 "COUPANG_WING_SELECTOR_PROBE" "$FIXTURES/normal.env"
  run_case "NORMAL        · READ_ONLY mode" 0 "READ_ONLY" "$FIXTURES/normal.env"
  run_case "NORMAL        · one-line grant offered" 0 "Seated and ready." "$FIXTURES/normal.env"
  # The historical defect this guards: a calibration phase must NEVER hand the operator a frontend URL.
  out="$(SELLEROPS_WING_PROBE_RUN_ENV="$FIXTURES/normal.env" SELLEROPS_MANIFEST_OUT="$MANIFEST_OUT" bash "$PREFLIGHT" 2>&1)"
  if grep -qF "localhost:5173" <<<"$out" || grep -qF "/connect/" <<<"$out"; then
    echo "  FAIL  NORMAL        · no frontend URL (a CLI phase must not emit one)"; FAILED=1
  else
    echo "  PASS  NORMAL        · no frontend URL emitted"
  fi
  # And the delete-only scope must be what the manifest carries.
  if grep -qF '"probeTargets"' <<<"$out" && grep -qF '"delete"' <<<"$out"; then
    echo "  PASS  NORMAL        · manifest probeTargets = [delete]"
  else
    echo "  FAIL  NORMAL        · manifest probeTargets missing the delete-only scope"; FAILED=1
  fi

  : > "$DIRT_FILE"
  run_case "DIRTY_TREE    (uncommitted change refused)" nonzero "working tree is dirty" "$FIXTURES/normal.env"
  rm -f "$DIRT_FILE"
else
  run_case "DIRTY_TREE    (uncommitted change refused)" nonzero "working tree is dirty" "$FIXTURES/normal.env"
  echo "  SKIP  NORMAL — the working tree is dirty, which the preflight refuses by design."
  echo "        Commit or stash, then re-run this selfcheck to exercise the PASS path."
fi

echo
if [ "$FAILED" = "0" ]; then echo "SELFCHECK PASS"; exit 0; else echo "SELFCHECK FAIL"; exit 1; fi
