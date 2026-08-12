#!/usr/bin/env bash
#
# Coupang WING READ-ONLY selector-probe BOOTSTRAP (browser-only: no backend, no DB, no frontend).
#
# The WING selector probe (`collector/src/cli/probe-wing-issuance-selectors.ts`) opens the seller's dedicated
# Chrome window and MEASURES fixed-label match counts on the page the seller navigated to themselves. It needs
# none of the backend/DB/frontend environment the order-routine proof needs, so it gets its own two-step
# harness: this bootstrap mints the run identity, and `wing-probe-preflight.sh` prepares + displays the
# sanitized Approval Manifest (docs/sellerops_live_approval_contract.md §2).
#
# The identity is written under the EXACT variable names the tested manifest gate
# (`collector/src/cli/approval-manifest-cli.ts`) reads — WALKTHROUGH_RUN_ID / WALKTHROUGH_APPROVAL_ID /
# WALKTHROUGH_GIT_COMMIT — so no hand-typed env mapping sits between bootstrap and the manifest and can drift.
#
# The per-run PROBE SCOPE is fixed here too, because scope is part of what the operator approves: a scope
# change is a §1.6 scope change ⇒ re-bootstrap ⇒ a new approval id ⇒ the old grant is dead. The default is the
# delete-selector calibration scope (`delete`), which is the one target the WING deletion path still needs.
#
# The PHASE is likewise fixed here, from a two-value allowlist:
#   COUPANG_WING_SELECTOR_PROBE  (default) — measure the SHIPPED fixed labels;
#   COUPANG_WING_LABEL_RECON               — sweep the CANDIDATE label sets for the unresolved targets.
#   COUPANG_WING_STAGE2_RECON              — sweep the STAGE-2 candidate sets on the purpose-selection screen
#                                            the OPERATOR reaches by pressing 발급 themselves, plus a
#                                            choice-control SHAPE census. Still read-only: no highlight, no
#                                            click, no selection, no 확인, no value read.
#   COUPANG_WING_ISSUANCE_FLOW_DISCOVERY   — the calibration's reads, taken at SEVERAL checkpoints while the
#                                            OPERATOR advances the real flow (발급 → select the purpose option →
#                                            conditionally 확인). The agent still clicks, selects and types
#                                            nothing; the 확인 step is offered only when the reading taken after
#                                            the selection shows the vendor form is not yet on screen.
#   COUPANG_WING_VENDOR_METHOD_DISCOVERY   — the discovery flow carried TWO checkpoints further, onto the screen
#                                            that follows `약관 동의 및 Key 발급받기`. That press was made twice on
#                                            live walks and the OPERATOR reported no key either time (SellerOps
#                                            cannot confirm it either way), which is what makes this a READ
#                                            phase. It ENDS with the operator looking at a
#                                            `확인` that ISSUES A REAL KEY and which no checkpoint may reach —
#                                            issuance is a separate manifest and a separate mode-WRITE grant.
#   COUPANG_WING_STAGE2_LABEL_CALIBRATION  — the same surface and the same operator flow, plus two further
#                                            read-only reads: a per-candidate CONTAINMENT probe and a
#                                            label-ASSOCIATION census (how each control is labelled, whether the
#                                            association resolves, which radio-name group it is in). Category
#                                            names and indices only — no page wording is recorded, and still no
#                                            highlight, click, selection, 확인, or value read.
# They are different work under the same CLI, so they are different manifests and different grants. The recon
# phase defaults its scope to the three unresolved targets rather than to `delete`, which it cannot sweep.
#
# Both ids are ENVIRONMENT identifiers, never a credential or auth token. NO browser is launched, NO Coupang
# call is made, and no credential/env secret is read here.
#
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
RUN_DIR="$HERE/.run"
RUN_ENV="$RUN_DIR/wing-probe.env"

# Git, with the ambient git environment stripped. GIT_DIR / GIT_WORK_TREE / GIT_CONFIG_* inherited from the
# caller would otherwise decide WHICH repository this identity describes — the same hardening the preflight
# applies to its drift check, so the two cannot be pointed at different repositories.
git_hardened() {
  env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY \
      -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_COMMON_DIR -u GIT_CEILING_DIRECTORIES \
      -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM \
      -u GIT_CONFIG_PARAMETERS \
      git -C "$REPO_ROOT" "$@"
}

# Canonical WING probe targets live in collector/src/cli/coupang-wing-classifier.ts
# (WING_PROBE_TARGET_NAMES). This script does NOT decide which are valid — the manifest gate fails closed with
# WING_PROBE_TARGETS_MISMATCH on anything that is not a canonical subset. It DOES enforce the character shape,
# because this value is written into a file the preflight later sources: an unvalidated `$(…)` would execute.
#    `case` rather than `grep -E`: grep matches LINE-wise, so an embedded newline would slip past an anchored
#    pattern and inject a second assignment into the file below.
PHASE="${SELLEROPS_APPROVAL_PHASE:-COUPANG_WING_SELECTOR_PROBE}"
case "$PHASE" in
  COUPANG_WING_SELECTOR_PROBE|COUPANG_WING_LABEL_RECON|COUPANG_WING_STAGE2_RECON|COUPANG_WING_STAGE2_LABEL_CALIBRATION|COUPANG_WING_ISSUANCE_FLOW_DISCOVERY|COUPANG_WING_VENDOR_METHOD_DISCOVERY) ;;
  *)
    echo "BOOTSTRAP FAIL — SELLEROPS_APPROVAL_PHASE must be COUPANG_WING_SELECTOR_PROBE, COUPANG_WING_LABEL_RECON, COUPANG_WING_STAGE2_RECON, COUPANG_WING_STAGE2_LABEL_CALIBRATION, COUPANG_WING_ISSUANCE_FLOW_DISCOVERY, or COUPANG_WING_VENDOR_METHOD_DISCOVERY."
    echo "                 (The DESTRUCTIVE deletion phase has its own harness and is not approvable from here.)"
    exit 1 ;;
esac

# Per-phase scope default. Recon cannot sweep `delete`/`issue`/`credentials` — they have no candidate sets — and
# the manifest gate refuses such a scope, so defaulting to `delete` under the recon phase would only produce a
# bootstrap that cannot reach a manifest.
# Is this either of the two STAGE-2 phases? One predicate, used by every branch below — the WING phase list
# already learned what happens when a new phase is added to some of the `if`s and not others.
is_stage2_phase() {
  case "$1" in COUPANG_WING_STAGE2_RECON|COUPANG_WING_STAGE2_LABEL_CALIBRATION|COUPANG_WING_ISSUANCE_FLOW_DISCOVERY|COUPANG_WING_VENDOR_METHOD_DISCOVERY) return 0 ;; *) return 1 ;; esac
}

# Does this phase run a multi-checkpoint FLOW? The two discovery phases. Their scope has to cover the screen
# markers and the vendor-form candidates or the run halts part-way through a real sitting, so they do NOT get
# the six-target default the single-reading phases use — see `wingDiscoveryRequiredTargets`.
is_flow_phase() {
  case "$1" in COUPANG_WING_ISSUANCE_FLOW_DISCOVERY|COUPANG_WING_VENDOR_METHOD_DISCOVERY) return 0 ;; *) return 1 ;; esac
}

if [ "$PHASE" = "COUPANG_WING_LABEL_RECON" ]; then
  DEFAULT_TARGETS="self_dev,vendor_info,call_ip"
elif is_stage2_phase "$PHASE"; then
  # A Stage-2 run measures NO shipped locator, so it has no probe scope. Defaulting to `delete` wrote a
  # meaningless scope into the run env and printed "probe targets: delete" for a run that probes none of them.
  DEFAULT_TARGETS=""
else
  DEFAULT_TARGETS="delete"
fi
PROBE_TARGETS="${SELLEROPS_WING_PROBE_TARGETS:-$DEFAULT_TARGETS}"
case "$PROBE_TARGETS" in
  "") is_stage2_phase "$PHASE" || { echo "BOOTSTRAP FAIL — SELLEROPS_WING_PROBE_TARGETS must not be empty."; exit 1; } ;;
  *[!a-z_,]*|,*|*,|*,,*)
    echo "BOOTSTRAP FAIL — SELLEROPS_WING_PROBE_TARGETS must be a comma-separated list of lowercase target names."
    exit 1 ;;
esac

# The STAGE-2 scope is a SEPARATE variable over a SEPARATE namespace (purpose / vendor_url / confirm are not
# canonical probe targets and never become them). It is only written for the Stage-2 phase, so a probe run
# cannot carry one and a Stage-2 run cannot be narrowed by a probe scope.
STAGE2_TARGETS=""
if is_stage2_phase "$PHASE"; then
  if is_flow_phase "$PHASE"; then
    # The FULL canonical set. A flow run narrowed to the six below cannot identify its own screen and is refused
    # before Chrome launches — which is correct, and is a refusal the default should not be walking into.
    STAGE2_DEFAULT="purpose,self_dev,vendor_info,vendor_url,call_ip,confirm,terms_heading,terms_api_agree,terms_category_agree,terms_cancel,terms_issue_final,purpose_open_api,vendor_method_heading,vendor_method_prompt,vendor_partner,vendor_self_dev"
  else
    STAGE2_DEFAULT="purpose,self_dev,vendor_info,vendor_url,call_ip,confirm"
  fi
  STAGE2_TARGETS="${SELLEROPS_WING_STAGE2_TARGETS:-$STAGE2_DEFAULT}"
  case "$STAGE2_TARGETS" in
    ""|*[!a-z_0-9,]*|,*|*,|*,,*)
      echo "BOOTSTRAP FAIL — SELLEROPS_WING_STAGE2_TARGETS must be a comma-separated list of lowercase target names."
      exit 1 ;;
  esac
fi

# The per-run checkpoint PLAN (discovery only). A PREFIX of the flow, validated in TS; the shape check here is
# the same one every other value written to this file gets, because the preflight sources it.
FLOW_CHECKPOINTS=""
if is_flow_phase "$PHASE"; then
  FLOW_CHECKPOINTS="${SELLEROPS_WING_FLOW_CHECKPOINTS:-}"
  case "$FLOW_CHECKPOINTS" in
    "") ;;
    *[!A-Z_,]*|,*|*,|*,,*)
      echo "BOOTSTRAP FAIL — SELLEROPS_WING_FLOW_CHECKPOINTS must be a comma-separated list of UPPERCASE checkpoint names."
      exit 1 ;;
  esac
fi

RUN_ID="wt-$(openssl rand -hex 6)"
APPROVAL_ID="apr-$(openssl rand -hex 6)"
GIT_COMMIT="$(git_hardened rev-parse --short HEAD 2>/dev/null || echo unknown)"
# Freshness stamp. A prepared manifest is valid for the process/session that prepared it (contract §2
# `expiresAt: process-lifetime`); the preflight refuses an identity older than its TTL so a run env left over
# from a previous session cannot silently re-authorize a new one.
BOOTSTRAP_EPOCH="$(date +%s)"

mkdir -p "$RUN_DIR"
# Every value is single-quoted: the preflight sources this file, and the shapes above (hex ids, a short SHA,
# digits, a fixed phase, a validated target list) contain no quote character, so nothing here can expand.
cat > "$RUN_ENV" <<ENV
# Generated by tools/coupang-local/wing-probe-bootstrap.sh — run identity for the WING read-only selector
# probe. Read by wing-probe-preflight.sh and sourced into the probe run itself. Do NOT commit.
WALKTHROUGH_RUN_ID='$RUN_ID'
WALKTHROUGH_APPROVAL_ID='$APPROVAL_ID'
WALKTHROUGH_GIT_COMMIT='$GIT_COMMIT'
WING_PROBE_BOOTSTRAP_EPOCH='$BOOTSTRAP_EPOCH'
SELLEROPS_APPROVAL_PHASE='$PHASE'
ENV
if [ -n "$PROBE_TARGETS" ]; then
  printf "SELLEROPS_WING_PROBE_TARGETS='%s'\n" "$PROBE_TARGETS" >> "$RUN_ENV"
fi
if [ -n "$STAGE2_TARGETS" ]; then
  printf "SELLEROPS_WING_STAGE2_TARGETS='%s'\n" "$STAGE2_TARGETS" >> "$RUN_ENV"
fi
if [ -n "$FLOW_CHECKPOINTS" ]; then
  printf "SELLEROPS_WING_FLOW_CHECKPOINTS='%s'\n" "$FLOW_CHECKPOINTS" >> "$RUN_ENV"
fi

echo "coupang WING selector-probe bootstrap complete → $RUN_ENV"
echo
echo "  run id       : $RUN_ID"
echo "  approval id  : $APPROVAL_ID  (binds the operator's single-use grant)"
echo "  git commit   : $GIT_COMMIT"
echo "  phase        : $PHASE (READ_ONLY)"
if [ -n "$PROBE_TARGETS" ]; then
  echo "  probe targets: $PROBE_TARGETS"
fi
if [ -n "$FLOW_CHECKPOINTS" ]; then
  echo "  checkpoints  : $FLOW_CHECKPOINTS  (a PREFIX of the flow — the run ends after the last one)"
fi
if [ -n "$STAGE2_TARGETS" ]; then
  echo "  stage-2 scope: $STAGE2_TARGETS"
  if [ "$PHASE" = "COUPANG_WING_VENDOR_METHOD_DISCOVERY" ]; then
    echo "  NOTE         : YOU advance the whole flow, one checkpoint at a time, and TWO steps further than the"
    echo "                 discovery phase: you also press '약관 동의 및 Key 발급받기' (pressed twice on live"
    echo "                 walks, operator-reported to issue no key — SellerOps cannot confirm that) and then"
    echo "                 select an input method on the screen it opens."
    echo "                 ⚠ THAT SCREEN'S '확인' ISSUES A REAL KEY. It is not in this approval and no checkpoint"
    echo "                 of this phase can reach it. SellerOps clicks, selects and types nothing at any point."
  elif [ "$PHASE" = "COUPANG_WING_ISSUANCE_FLOW_DISCOVERY" ]; then
    # Discovery ASKS for the two things the shared note forbids. Printing the shared copy here would tell the
    # operator the opposite of the manifest the very next command prints — and the bootstrap is read first.
    echo "  NOTE         : YOU advance the flow (발급 → select 'OPEN API' → 확인), one checkpoint at a time."
    echo "                 Each step is offered ONLY if SellerOps' reading says the flow is on the screen that"
    echo "                 step assumes; otherwise the run halts and never prints the instruction."
    echo "                 SellerOps clicks, selects and types nothing at any point."
  else
    echo "  NOTE         : you press 'API Key 발급 받기' YOURSELF, stop on the purpose screen, choose nothing,"
    echo "                 and never press '확인'. SellerOps only counts and categorises what is on screen."
  fi
fi
echo
echo "next: tools/coupang-local/wing-probe-preflight.sh  (prepares + displays the Approval Manifest; no browser)"
echo "note: re-running this bootstrap mints a NEW approval id — the previous grant is dead."
