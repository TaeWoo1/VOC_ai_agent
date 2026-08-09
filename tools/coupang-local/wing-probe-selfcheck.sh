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
#   WRONG_PHASE     → FAIL (this harness prepares the two READ_ONLY phases only, never destructive deletion)
#   RECON_BAD_SCOPE → FAIL (a target with no candidate set ⇒ WING_RECON_TARGETS_MISMATCH, before any manifest)
#   GIT_DRIFT       → FAIL (bootstrap commit != HEAD)
#   BAD_SCOPE       → FAIL (unknown probe target ⇒ WING_PROBE_TARGETS_MISMATCH from the tested gate)
#   MIXED_ORDER     → PASS, but the manifest shows the NORMALIZED canonical scope, never a widened one
#   EMPTY_SCOPE     → PASS with the FULL fixed target set — an empty scope means "all", not "none", and the
#                     manifest must say so out loud before the operator grants
#   DIRTY_TREE      → FAIL (uncommitted change ⇒ the manifest's gitSHA would not name the running code)
#   GIT_DIR_HIJACK  → FAIL (a decoy GIT_DIR/GIT_WORK_TREE must not redirect the drift check off this repo)
#   UNTRACKED_HIDE  → FAIL (GIT_CONFIG_* forcing status.showUntrackedFiles=no must not hide a dirty tree)
#   POSTDELETE      → PASS; the four post-delete FORM targets only (no credentials/delete), bound to the run
#   NORMAL          → PASS; delete-only READ_ONLY scope, no frontend URL, approved scope bound to the run
#   RECON_NORMAL    → PASS; the candidate-label recon phase, its three targets, and a run command that carries
#                     the PHASE (without it the recorder would run a baseline probe under a recon manifest)
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

# A STAGE-2 run env: NO probe scope (the run measures no shipped locator) and its own scope variable, exactly
# what wing-probe-bootstrap.sh writes for that phase.
write_stage2_env() {
  cat > "$1" <<ENV
WALKTHROUGH_RUN_ID='$4'
WALKTHROUGH_APPROVAL_ID='$5'
WALKTHROUGH_GIT_COMMIT='$2'
WING_PROBE_BOOTSTRAP_EPOCH='$NOW'
SELLEROPS_APPROVAL_PHASE='COUPANG_WING_STAGE2_RECON'
SELLEROPS_WING_STAGE2_TARGETS='$3'
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

# A stamp that passes a loose ^[0-9]+$ but is an invalid OCTAL literal used to abort the arithmetic, unwind
# the enclosing `if`, and delete the freshness check entirely — reaching PREFLIGHT PASS with no verdict.
write_env "$FIXTURES/octal.env" "$CUR_GIT" "COUPANG_WING_SELECTOR_PROBE" "delete" "wt-selfcheck08" "apr-selfcheck08" "0000000001999999999"
run_case "OCTAL_EPOCH    (malformed stamp cannot skip the check)" nonzero "bootstrap timestamp missing or malformed" "$FIXTURES/octal.env"

# The run env must be the ONLY source of identity: a key it omits must not fall through to the caller's shell.
cat > "$FIXTURES/nostamp.env" <<'ENV'
WALKTHROUGH_RUN_ID='wt-selfcheck09'
WALKTHROUGH_APPROVAL_ID='apr-selfcheck09'
WALKTHROUGH_GIT_COMMIT='PLACEHOLDER'
SELLEROPS_APPROVAL_PHASE='COUPANG_WING_SELECTOR_PROBE'
SELLEROPS_WING_PROBE_TARGETS='delete'
ENV
sed -i '' "s/PLACEHOLDER/$CUR_GIT/" "$FIXTURES/nostamp.env" 2>/dev/null || sed -i "s/PLACEHOLDER/$CUR_GIT/" "$FIXTURES/nostamp.env"
run_case "AMBIENT_STAMP  (caller's env cannot supply a missing key)" nonzero "bootstrap timestamp missing or malformed" \
  "$FIXTURES/nostamp.env" "WING_PROBE_BOOTSTRAP_EPOCH=$NOW"

# A line-wise `grep` guard would accept this (its SECOND line is a valid epoch) and then abort the arithmetic,
# unwinding the enclosing `if` and deleting the freshness check with no verdict printed.
cat > "$FIXTURES/multiline.env" <<ENV
WALKTHROUGH_RUN_ID='wt-selfcheck10'
WALKTHROUGH_APPROVAL_ID='apr-selfcheck10'
WALKTHROUGH_GIT_COMMIT='$CUR_GIT'
WING_PROBE_BOOTSTRAP_EPOCH='junk
$NOW'
SELLEROPS_APPROVAL_PHASE='COUPANG_WING_SELECTOR_PROBE'
SELLEROPS_WING_PROBE_TARGETS='delete'
ENV
run_case "MULTILINE_STAMP (newline cannot slip past the shape check)" nonzero "bootstrap timestamp missing or malformed" "$FIXTURES/multiline.env"

write_env "$FIXTURES/wrongphase.env" "$CUR_GIT" "COUPANG_WING_KEY_DELETION" "delete" "wt-selfcheck01" "apr-selfcheck01"
run_case "WRONG_PHASE    (destructive phase refused here)" nonzero "phase must be COUPANG_WING_SELECTOR_PROBE" "$FIXTURES/wrongphase.env"

# The recon phase refuses a target it has no candidates for. This must fail at PREPARATION, not at the live
# gate: a displayed manifest the run would reject invites widening the scope until something starts.
write_env "$FIXTURES/reconbadscope.env" "$CUR_GIT" "COUPANG_WING_LABEL_RECON" "delete" "wt-selfcheck12" "apr-selfcheck12"
if [ -z "$TREE_DIRTY" ]; then
  run_case "RECON_BAD_SCOPE (delete has no candidate set)" nonzero "WING_RECON_TARGETS_MISMATCH" "$FIXTURES/reconbadscope.env"
else
  run_case "RECON_BAD_SCOPE (delete has no candidate set)" nonzero "PREFLIGHT FAIL" "$FIXTURES/reconbadscope.env"
fi

write_env "$FIXTURES/drift.env" "0000000" "COUPANG_WING_SELECTOR_PROBE" "delete" "wt-selfcheck02" "apr-selfcheck02"
run_case "GIT_DRIFT      (commit moved since bootstrap)" nonzero "git commit changed" "$FIXTURES/drift.env"

# ── scope ──────────────────────────────────────────────────────────────────────
write_env "$FIXTURES/badscope.env" "$CUR_GIT" "COUPANG_WING_SELECTOR_PROBE" "nope" "wt-selfcheck03" "apr-selfcheck03"
# The operator's env string is NORMALIZED by resolveWingProbeScope (canonical order + de-duplicated) so the
# manifest and the recorder measure exactly the same set. What must never happen is a scope that WIDENS past
# what was requested, or a run that silently disagrees with what was displayed.
write_env "$FIXTURES/mixedorder.env" "$CUR_GIT" "COUPANG_WING_SELECTOR_PROBE" "issue,self_dev,issue" "wt-selfcheck04" "apr-selfcheck04"
write_env "$FIXTURES/emptyscope.env" "$CUR_GIT" "COUPANG_WING_SELECTOR_PROBE" "" "wt-selfcheck06" "apr-selfcheck06"
# The POST-DELETE issuance-form scope: the four form targets, and deliberately NOT `credentials` or `delete`.
# After a real deletion there is no credential region to measure and no 삭제 control to find, so including them
# would guarantee two non-unique candidates and muddy the calibration signal.
write_env "$FIXTURES/postdelete.env" "$CUR_GIT" "COUPANG_WING_SELECTOR_PROBE" "self_dev,vendor_info,call_ip,issue" "wt-selfcheck11" "apr-selfcheck11"
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
  # The scope the post-delete form calibration will actually request.
  run_case "POSTDELETE     (form-only scope prepares + displays)" 0 "probe targets: self_dev,vendor_info,call_ip,issue" "$FIXTURES/postdelete.env"
  out="$(SELLEROPS_WING_PROBE_RUN_ENV="$FIXTURES/postdelete.env" SELLEROPS_MANIFEST_OUT="$MANIFEST_OUT" bash "$PREFLIGHT" 2>&1)"
  if grep -qF '"credentials"' <<<"$out" || grep -qF '"delete"' <<<"$out"; then
    echo "  FAIL  POSTDELETE     · form-only scope leaked credentials/delete into the manifest"; FAILED=1
  else
    echo "  PASS  POSTDELETE     · manifest carries the four form targets only"
  fi
  if grep -qE "^SELLEROPS_WING_APPROVED_TARGETS='self_dev,vendor_info,call_ip,issue'$" "$FIXTURES/postdelete.env"; then
    echo "  PASS  POSTDELETE     · approved scope bound to the run env"
  else
    echo "  FAIL  POSTDELETE     · form-only scope not bound to the run env"; FAILED=1
  fi
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
  # Trailing space matters: a bare substring would also match a widened `…=delete,issue`.
  run_case "NORMAL         · run command carries the approved scope" 0 "SELLEROPS_WING_PROBE_TARGETS=delete " "$FIXTURES/normal.env"
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
  # The approved scope must be bound to the run env, so sourcing it cannot reproduce a wider set — as BOTH
  # the run scope and the independent approval binding the live probe compares it against.
  if grep -qE "^SELLEROPS_WING_PROBE_TARGETS='delete'$" "$FIXTURES/normal.env" \
     && grep -qE "^SELLEROPS_WING_APPROVED_TARGETS='delete'$" "$FIXTURES/normal.env"; then
    echo "  PASS  NORMAL         · approved scope bound to the run env (run + approval)"
  else
    echo "  FAIL  NORMAL         · approved scope not bound to the run env as both variables"; FAILED=1
  fi
  # ── the candidate-label recon phase ────────────────────────────────────────
  write_env "$FIXTURES/recon.env" "$CUR_GIT" "COUPANG_WING_LABEL_RECON" "self_dev,vendor_info,call_ip" "wt-selfcheck13" "apr-selfcheck13"
  run_case "RECON_NORMAL   (candidate-label sweep scope)" 0 "PREFLIGHT PASS" "$FIXTURES/recon.env"
  run_case "RECON_NORMAL   · manifest phase" 0 "COUPANG_WING_LABEL_RECON" "$FIXTURES/recon.env"
  run_case "RECON_NORMAL   · READ_ONLY mode" 0 "READ_ONLY" "$FIXTURES/recon.env"
  # Without the PHASE on the command line the recorder derives no recon mode and quietly measures the shipped
  # baselines instead — a run that reports a different measurement than the manifest the operator approved.
  run_case "RECON_NORMAL   · run command carries the phase" 0 "SELLEROPS_APPROVAL_PHASE=COUPANG_WING_LABEL_RECON" "$FIXTURES/recon.env"
  run_case "RECON_NORMAL   · operator told nothing is promoted" 0 "changes no shipped selector" "$FIXTURES/recon.env"
  if grep -qE "^SELLEROPS_WING_APPROVED_TARGETS='self_dev,vendor_info,call_ip'$" "$FIXTURES/recon.env"; then
    echo "  PASS  RECON_NORMAL   · approved recon scope bound to the run env"
  else
    echo "  FAIL  RECON_NORMAL   · approved recon scope not bound to the run env"; FAILED=1
  fi
  # The approved PHASE is bound from the MANIFEST, independently of the phase the run env already carried.
  # Without it a phase left over in the operator shell is indistinguishable from an approved one.
  if grep -qE "^SELLEROPS_WING_APPROVED_PHASE='COUPANG_WING_LABEL_RECON'$" "$FIXTURES/recon.env"; then
    echo "  PASS  RECON_NORMAL   · approved PHASE bound to the run env"
  else
    echo "  FAIL  RECON_NORMAL   · approved PHASE not bound to the run env"; FAILED=1
  fi
  run_case "RECON_NORMAL   · run command carries BOTH phase variables" 0 "SELLEROPS_WING_APPROVED_PHASE=COUPANG_WING_LABEL_RECON" "$FIXTURES/recon.env"

  # ── the STAGE-2 recon phase ────────────────────────────────────────────────
  # This block exists because the phase shipped with ZERO harness coverage, and the first thing an end-to-end
  # case caught was that the manifest described the run to the operator as an "API issuance highlight proof".
  write_stage2_env "$FIXTURES/stage2.env" "$CUR_GIT" "purpose,self_dev,vendor_info,vendor_url,call_ip,confirm" "wt-selfcheck20" "apr-selfcheck20"
  run_case "STAGE2_NORMAL  (purpose-selection recon scope)" 0 "PREFLIGHT PASS" "$FIXTURES/stage2.env"
  run_case "STAGE2_NORMAL  · manifest phase" 0 "COUPANG_WING_STAGE2_RECON" "$FIXTURES/stage2.env"
  run_case "STAGE2_NORMAL  · READ_ONLY mode" 0 "READ_ONLY" "$FIXTURES/stage2.env"
  # The operation line is what the operator reads FIRST. It described a read-only recon as a highlight proof.
  run_case "STAGE2_NORMAL  · operation names the Stage-2 recon" 0 "WING Stage-2 read-only recon" "$FIXTURES/stage2.env"
  run_case "STAGE2_NORMAL  · max actions names the operator press" 0 "1 operator-performed 발급 press + 1 read-only Stage-2 recon session" "$FIXTURES/stage2.env"
  # The three things the operator must NOT do, on the screen they are being sent to.
  run_case "STAGE2_NORMAL  · operator told to press 발급 themselves" 0 "YOURSELF" "$FIXTURES/stage2.env"
  run_case "STAGE2_NORMAL  · operator told never to press 확인" 0 "NEVER press '확인'" "$FIXTURES/stage2.env"
  run_case "STAGE2_NORMAL  · operator told nothing is promoted" 0 "changes no shipped selector" "$FIXTURES/stage2.env"
  run_case "STAGE2_NORMAL  · run command carries BOTH phase variables" 0 "SELLEROPS_WING_APPROVED_PHASE=COUPANG_WING_STAGE2_RECON" "$FIXTURES/stage2.env"
  run_case "STAGE2_NORMAL  · run command carries the Stage-2 scope" 0 "SELLEROPS_WING_STAGE2_TARGETS=" "$FIXTURES/stage2.env"
  # A Stage-2 run has no probe scope. If the command carried one it would describe a measurement it never makes.
  if bash "$PREFLIGHT" >/dev/null 2>&1 <<<"" ; then :; fi
  OUT_S2="$(env SELLEROPS_WING_PROBE_RUN_ENV="$FIXTURES/stage2.env" SELLEROPS_MANIFEST_OUT="$MANIFEST_OUT" bash "$PREFLIGHT" 2>&1 || true)"
  if grep -q "SELLEROPS_WING_PROBE_TARGETS=" <<<"$OUT_S2"; then
    echo "  FAIL  STAGE2_NORMAL  · run command must NOT carry a probe scope"; FAILED=1
  else
    echo "  PASS  STAGE2_NORMAL  · run command carries no probe scope"
  fi
  if grep -qE "^SELLEROPS_WING_APPROVED_PHASE='COUPANG_WING_STAGE2_RECON'$" "$FIXTURES/stage2.env" \
     && grep -qE "^SELLEROPS_WING_STAGE2_TARGETS='" "$FIXTURES/stage2.env" \
     && ! grep -q "^SELLEROPS_WING_PROBE_TARGETS=" "$FIXTURES/stage2.env"; then
    echo "  PASS  STAGE2_NORMAL  · Stage-2 scope + phase bound, probe scope absent"
  else
    echo "  FAIL  STAGE2_NORMAL  · Stage-2 run env binding is wrong"; FAILED=1
  fi
  # NARROWING must survive the round trip. It did not: the manifest CLI never read the Stage-2 scope variable,
  # so a one-target request came back as all six in the manifest, the run env, and the printed command.
  write_stage2_env "$FIXTURES/stage2-narrow.env" "$CUR_GIT" "purpose" "wt-selfcheck21" "apr-selfcheck21"
  OUT_NARROW="$(env SELLEROPS_WING_PROBE_RUN_ENV="$FIXTURES/stage2-narrow.env" SELLEROPS_MANIFEST_OUT="$MANIFEST_OUT" bash "$PREFLIGHT" 2>&1 || true)"
  # The printed command wraps, so the scope is followed by a trailing " \" — anchoring on end-of-line would
  # fail for the wrong reason and read as "narrowing was widened" when it was not.
  NARROW_LINE="$(grep 'SELLEROPS_WING_STAGE2_TARGETS=' <<<"$OUT_NARROW" | head -1)"
  if grep -qE "SELLEROPS_WING_STAGE2_TARGETS=purpose( |$)" <<<"$NARROW_LINE" \
     && ! grep -q "confirm" <<<"$NARROW_LINE" \
     && grep -q "stage-2 targets: purpose " <<<"$OUT_NARROW"; then
    echo "  PASS  STAGE2_NARROW  · a narrowed scope survives into the printed run command"
  else
    echo "  FAIL  STAGE2_NARROW  · narrowing was silently widened"; FAILED=1
  fi
  # Re-running must not accumulate duplicate phase assignments either.
  bash "$PREFLIGHT" >/dev/null 2>&1 <<<"" || true
  SELLEROPS_WING_PROBE_RUN_ENV="$FIXTURES/recon.env" SELLEROPS_MANIFEST_OUT="$MANIFEST_OUT" bash "$PREFLIGHT" >/dev/null 2>&1 || true
  if [ "$(grep -cE "^SELLEROPS_WING_APPROVED_PHASE=" "$FIXTURES/recon.env")" = "1" ]; then
    echo "  PASS  RECON_NORMAL   · phase binding is idempotent across re-runs"
  else
    echo "  FAIL  RECON_NORMAL   · phase binding accumulated duplicates"; FAILED=1
  fi

  # The BASELINE phase gets the same binding — otherwise a recon phase left in the shell would ride along on a
  # probe run and the recorder, seeing no approved phase, could only guess which side was stale.
  if grep -qE "^SELLEROPS_WING_APPROVED_PHASE='COUPANG_WING_SELECTOR_PROBE'$" "$FIXTURES/normal.env"; then
    echo "  PASS  NORMAL         · approved PHASE bound for the baseline phase too"
  else
    echo "  FAIL  NORMAL         · approved PHASE not bound for the baseline phase"; FAILED=1
  fi

  # Re-running must not accumulate duplicate assignments of either variable.
  DUPES="$(grep -cE "^SELLEROPS_WING_(PROBE|APPROVED)_TARGETS=" "$FIXTURES/normal.env")"
  if [ "$DUPES" = "2" ]; then
    echo "  PASS  NORMAL         · scope binding is idempotent across re-runs"
  else
    echo "  FAIL  NORMAL         · expected exactly 2 scope assignments, found $DUPES"; FAILED=1
  fi
  run_case "NORMAL         · run command carries the approval binding" 0 "SELLEROPS_WING_APPROVED_TARGETS=delete " "$FIXTURES/normal.env"
  # …and an empty request must be bound as the RESOLVED full set, not left empty for the run to re-widen.
  if grep -qE "^SELLEROPS_WING_PROBE_TARGETS='self_dev,vendor_info,call_ip,issue,credentials,delete'$" "$FIXTURES/emptyscope.env" \
     && grep -qE "^SELLEROPS_WING_APPROVED_TARGETS='self_dev,vendor_info,call_ip,issue,credentials,delete'$" "$FIXTURES/emptyscope.env"; then
    echo "  PASS  EMPTY_SCOPE    · resolved full set bound to the run env (run + approval)"
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
  # `-c status.showUntrackedFiles=normal` does NOT counter an excludes file injected via GIT_CONFIG_PARAMETERS,
  # so that variable has to be stripped too.
  printf '%s\n' ".wing-probe-selfcheck-dirty.tmp" > "$FIXTURES/excludes"
  run_case "EXCLUDES_HIDE  (GIT_CONFIG_PARAMETERS ignored)" nonzero "working tree is dirty" "$FIXTURES/normal.env" \
    "GIT_CONFIG_PARAMETERS='core.excludesFile=$FIXTURES/excludes'"
  rm -f "$DIRT_FILE"

  # The scope binding is a hard requirement, not a convenience: if it cannot be written, no manifest is shown.
  cp "$FIXTURES/normal.env" "$FIXTURES/readonly.env"
  RO_DIR="$FIXTURES/ro"; mkdir -p "$RO_DIR"; cp "$FIXTURES/normal.env" "$RO_DIR/run.env"; chmod 500 "$RO_DIR"
  run_case "SCOPE_BIND_FAIL (unwritable run env refused)" nonzero "could not bind the approved scope" "$RO_DIR/run.env"
  chmod 700 "$RO_DIR"

  # The one caveat the operator most needs before granting must be on the summary line, not only in the JSON.
  run_case "NORMAL         · selectorsCalibrated disclosed" 0 "selectors calibrated: false" "$FIXTURES/normal.env"

  # EVERY case above overrides SELLEROPS_MANIFEST_OUT, so the DEFAULT manifest path had no coverage at all —
  # and that is exactly where a broken mktemp template hid until the first real operator run. Exercise it,
  # twice, so a template that collides with its own previous output is caught here instead of at the gate.
  DEFAULT_OK=1
  for attempt in 1 2; do
    out="$(env SELLEROPS_WING_PROBE_RUN_ENV="$FIXTURES/normal.env" bash "$PREFLIGHT" 2>&1)" || DEFAULT_OK=0
    grep -qF "PREFLIGHT PASS" <<<"$out" || DEFAULT_OK=0
    grep -qF "probe targets: delete" <<<"$out" || DEFAULT_OK=0
    # A failed temp-path creation used to surface as python tracebacks under a broken run.
    grep -qF "Traceback" <<<"$out" && DEFAULT_OK=0
    grep -qiF "mktemp" <<<"$out" && DEFAULT_OK=0
  done
  if [ "$DEFAULT_OK" = "1" ]; then
    echo "  PASS  DEFAULT_OUT    · default manifest path works, and works twice in a row"
  else
    echo "  FAIL  DEFAULT_OUT    · default manifest path is broken"; echo "$out" | tail -6 | sed 's/^/        | /'; FAILED=1
  fi

  # The prose the operator reads must come from the phase spec, never from the surrounding shell — an ambient
  # override changes no enforced capability, but it can describe the run as something it is not.
  out="$(env SELLEROPS_APPROVAL_OPERATION="AMBIENT-PROSE-MUST-NOT-APPEAR" \
             SELLEROPS_APPROVAL_MAX="AMBIENT-MAX-MUST-NOT-APPEAR" \
             SELLEROPS_APPROVAL_ACCOUNT="AMBIENT-ACCOUNT-MUST-NOT-APPEAR" \
             SELLEROPS_WING_PROBE_RUN_ENV="$FIXTURES/normal.env" SELLEROPS_MANIFEST_OUT="$MANIFEST_OUT" \
             bash "$PREFLIGHT" 2>&1)"
  if grep -qF "MUST-NOT-APPEAR" <<<"$out"; then
    echo "  FAIL  AMBIENT_PROSE  · shell env reached the displayed manifest"; FAILED=1
  else
    echo "  PASS  AMBIENT_PROSE  · manifest prose comes from the phase spec, not the shell"
  fi
else
  run_case "DIRTY_TREE     (uncommitted change refused)" nonzero "working tree is dirty" "$FIXTURES/normal.env"
  echo "  SKIP  NORMAL / RECON_NORMAL / STAGE2_NORMAL / GIT_DIR_HIJACK / UNTRACKED_HIDE — the working tree is"
  echo "        dirty, which the preflight refuses by design. Commit or stash, then re-run to exercise the"
  echo "        PASS path."
  SKIPPED=1
fi

echo
# A skipped half is NOT a pass. This harness printed "SELFCHECK PASS" and exited 0 while every PASS-path case —
# including the whole Stage-2 block — never ran, which is precisely how a green selfcheck comes to certify
# coverage that did not execute. The reveal and deletion harnesses already report PARTIAL/2 for their own skips;
# this one was the last holdout, and adding cases to it made the gap load-bearing.
if [ "$FAILED" != "0" ]; then
  echo "SELFCHECK FAIL"; exit 1
elif [ "${SKIPPED:-0}" != "0" ]; then
  echo "SELFCHECK PARTIAL — the PASS path was NOT exercised (dirty tree). Commit or stash, then re-run."; exit 2
else
  echo "SELFCHECK PASS"; exit 0
fi
