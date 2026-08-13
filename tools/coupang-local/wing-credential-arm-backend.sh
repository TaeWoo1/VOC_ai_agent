#!/usr/bin/env bash
#
# Coupang WING CREDENTIAL-HANDOFF backend arming — boots the disposable backend with the credential interlock
# armed to EXACTLY the identity wing-credential-bootstrap.sh minted.
#
#   tools/coupang-local/wing-credential-arm-backend.sh
#
# ## Why this exists as its own script
#
# `run-backend-local.sh` arms `SELLEROPS_CONNECTOR_COUPANG_LIVE_APPROVAL_ID` from `bootstrap.sh`'s own run env.
# That is the right identity for what it protects — a read-only marketplace GET — and the WRONG one for the
# credential handoff, whose approval is minted by a DIFFERENT bootstrap for a DIFFERENT phase. There was no
# tooling path between the two, and the only ways to bridge it by hand were to edit `current.env` or to export
# the approval id directly. Both defeat the property the harness exists to enforce: that the armed identity is
# MINTED, and that the backend the operator grants against is the one their grant names.
#
# So this script reads the credential run env, checks it, and arms the backend from it. It never accepts an
# approval id, a run id or a commit as an argument or from the ambient environment — there is nothing to pass,
# which is what makes "arm it with a value I typed" impossible rather than discouraged.
#
# ## What it refuses
#
#   - no credential run env (bootstrap first)
#   - a run env for the CALIBRATION phase (that grant is for a run that reads no value)
#   - an identity older than the arming TTL (the grant is single-sitting)
#   - a git commit that is not this checkout's HEAD, or a dirty tree (the approval names the code that runs)
#   - a malformed id of any shape (the backend refuses these too; refusing here means no backend is even booted)
#
# It performs NO Coupang call, reads no credential, and stores nothing. It boots a backend and nothing else.
#
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"

RUN_ENV="${SELLEROPS_WING_CREDENTIAL_RUN_ENV:-$HERE/.run/wing-credential-handoff.env}"

# The one phase whose grant may arm this. Mirrors CredentialHandoffArming.PHASE_CREDENTIAL_HANDOFF; a
# cross-check test pins the two together.
EXPECTED_PHASE="COUPANG_WING_CREDENTIAL_HANDOFF"
# Mirrors CredentialHandoffArming.ARMING_TTL. Refusing here as well means a stale identity never boots a
# backend at all, rather than booting one that will refuse at the moment the operator is waiting on it.
ARMING_TTL_SECONDS=3600

# shellcheck source=./wing-harness-common.sh
. "$HERE/wing-harness-common.sh"

die() { echo "ARM FAIL-CLOSED: $*" >&2; exit 1; }

[ -f "$RUN_ENV" ] || die "no credential run env at $RUN_ENV — run wing-credential-bootstrap.sh handoff first."

# Clear before sourcing: an ambient value must never be able to describe this arming as something it is not.
unset WALKTHROUGH_RUN_ID WALKTHROUGH_APPROVAL_ID WALKTHROUGH_GIT_COMMIT WING_CREDENTIAL_BOOTSTRAP_EPOCH \
      SELLEROPS_APPROVAL_PHASE
# shellcheck disable=SC1090
set -a; . "$RUN_ENV"; set +a

APPROVAL_ID="${WALKTHROUGH_APPROVAL_ID:-}"
RUN_ID="${WALKTHROUGH_RUN_ID:-}"
RUN_GIT="${WALKTHROUGH_GIT_COMMIT:-}"
BOOTSTRAP_EPOCH="${WING_CREDENTIAL_BOOTSTRAP_EPOCH:-}"
PHASE="${SELLEROPS_APPROVAL_PHASE:-}"

# ---- shape: exactly what the bootstrap mints, and nothing a hand could plausibly type ----------------------
case "$APPROVAL_ID" in apr-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
  *) die "approval id is not the shape wing-credential-bootstrap.sh mints (apr-<12 hex>)." ;; esac
case "$RUN_ID" in wt-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
  *) die "run id is not the shape wing-credential-bootstrap.sh mints (wt-<12 hex>)." ;; esac
case "$RUN_GIT" in ""|*[!0-9a-f]*) die "git commit in the run env is not a hex sha." ;; esac

# ---- phase: a calibration grant is a grant for a run that reads NO value -----------------------------------
[ "$PHASE" = "$EXPECTED_PHASE" ] \
  || die "run env is for phase '${PHASE:-unset}', not $EXPECTED_PHASE. A grant for one phase is never a grant for the other."

# ---- freshness: the operator's grant is single-sitting ------------------------------------------------------
case "$BOOTSTRAP_EPOCH" in ""|*[!0-9]*) die "run env carries no usable bootstrap epoch." ;; esac
NOW="$(date +%s)"
AGE=$(( NOW - BOOTSTRAP_EPOCH ))
[ "$AGE" -ge 0 ] || die "the run env is stamped in the future — refusing rather than reasoning about a skewed clock."
[ "$AGE" -le "$ARMING_TTL_SECONDS" ] \
  || die "identity is ${AGE}s old (limit ${ARMING_TTL_SECONDS}s). Re-bootstrap: the grant is for one sitting."

# ---- the code the approval names must be the code that runs -------------------------------------------------
CUR_GIT="$(git_hardened rev-parse --short HEAD 2>/dev/null || echo "")"
[ -n "$CUR_GIT" ] || die "could not read HEAD. Refusing to arm a backend whose code cannot be identified."
[ "$CUR_GIT" = "$RUN_GIT" ] \
  || die "HEAD is $CUR_GIT but the approval names $RUN_GIT. Re-bootstrap at the commit you intend to run."
if ! DIRT="$(git_hardened status --porcelain 2>/dev/null)"; then
  die "could not read git status. Refusing rather than assuming a clean tree."
fi
[ -z "$DIRT" ] || die "working tree is dirty — the approval must name the code that will run."

echo "Coupang WING credential-handoff backend arming"
echo "  approval : ${APPROVAL_ID:0:12}…   run: ${RUN_ID:0:12}…   git: $CUR_GIT"
echo "  phase    : $PHASE"
echo "  one-shot : the backend spends this arming when a credential is STORED; a restart un-arms it entirely."
echo

# The credential interlock, armed from the run env and from nowhere else. Exported for the backend process only.
export SELLEROPS_CREDENTIAL_HANDOFF_APPROVAL_ID="$APPROVAL_ID"
export SELLEROPS_CREDENTIAL_HANDOFF_RUN_ID="$RUN_ID"
export SELLEROPS_CREDENTIAL_HANDOFF_GIT_COMMIT="$RUN_GIT"
export SELLEROPS_CREDENTIAL_HANDOFF_PHASE="$PHASE"
export SELLEROPS_CREDENTIAL_HANDOFF_ARMED_AT="$BOOTSTRAP_EPOCH"

# The read-only live-call interlock is armed with the SAME id, because the handoff's own verification leg is a
# real read-only Coupang GET and `CoupangLiveCallGuard` refuses it otherwise. Same run, same grant, same id —
# which is the honest arrangement: one approval, both gates it actually covers.
export SELLEROPS_CONNECTOR_COUPANG_LIVE_APPROVAL_ID="$APPROVAL_ID"

# ONE boot path, not two. `run-backend-local.sh` owns every disposable-backend setting (port, throwaway DB,
# scheduler off, real gateway, Keychain master key) and detects the credential arming above rather than
# re-arming the live-call interlock from its own run env. A second boot script here would be a second place
# that can configure a live backend wrongly.
exec "$HERE/run-backend-local.sh"
