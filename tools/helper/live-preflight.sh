#!/usr/bin/env bash
#
# **Refuse to spend a marketplace read on a helper that cannot do the thing.**
#
# Written after a live sitting burned an approval for nothing: the installed packaged helper was an hour
# older than the feature under test, so the bootstrap route it needed did not exist in the bundle, the
# confirmation card could never appear, and a harness with no retry cap pressed 「확인 완료」 twenty-eight
# times — each press another identity observation the manifest had capped at two.
#
# An Approval Manifest's PREPARED means "immediately executable, nothing more asked". These are the checks
# that claim was resting on, made explicit and run BEFORE the manifest is shown.
#
#   tools/helper/live-preflight.sh [--expect-device linked|unlinked]
#
# Exits non-zero with one line naming what is wrong. Touches no marketplace.
set -euo pipefail
HOME_DIR="${REVIEWNARY_HELPER_HOME:-$HOME/Library/Application Support/reviewnary-helper}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EXPECT_DEVICE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --expect-device) EXPECT_DEVICE="${2:-}"; shift 2;;
    *) echo "unknown option: $1" >&2; exit 2;;
  esac
done
fail() { echo "PREFLIGHT FAIL: $*" >&2; exit 3; }

[ -d "$HOME_DIR" ] || fail "no helper installed at $HOME_DIR"
[ -f "$HOME_DIR/app/helper.mjs" ] || fail "installed helper has no bundle"

# 1. The installed bundle must be the CURRENT source, not an older build of it. Compare the newest source
#    file the helper is built from against the bundle's own mtime — a bundle older than its sources is the
#    exact failure this script exists to catch.
NEWEST_SRC="$(find "$REPO_ROOT/collector/src" -name '*.ts' -newer "$HOME_DIR/app/helper.mjs" -print -quit 2>/dev/null || true)"
[ -z "$NEWEST_SRC" ] || fail "installed helper is older than collector/src (e.g. ${NEWEST_SRC#"$REPO_ROOT/"}) — rebuild and reinstall"

# 2. The route the bootstrap flow needs must be IN the bundle. Version numbers do not move on a rebuild, so
#    the only honest check is the capability itself.
grep -q 'store-identity/bootstrap' "$HOME_DIR/app/helper.mjs" || fail "bundle has no store-identity/bootstrap route"

# 3./4. Provider and device state, from the helper's own diagnostic line.
STATUS="$("$HOME_DIR/app/bin/node" "$HOME_DIR/app/service.mjs" status 2>/dev/null)" || fail "helper did not answer status"
echo "$STATUS"
printf '%s' "$STATUS" | grep -q '"healthy":true' || fail "helper is not healthy"
printf '%s' "$STATUS" | grep -q '"browserCollection":"CONFIGURED"' || fail "browser collection is not provisioned (tools/helper/browser-collection.sh on)"
printf '%s' "$STATUS" | grep -q '"executorPathSet":true' || fail "no executor path — a launchd agent cannot resolve a bare name"

if [ -n "$EXPECT_DEVICE" ]; then
  LINKED="$(curl -s -m 5 -H "Origin: $(printf '%s' "$STATUS" | sed -n 's/.*"appUrl":"\([^"]*\)".*/\1/p')" \
    http://127.0.0.1:47615/bridge/health >/dev/null 2>&1 && echo reachable || echo unreachable)"
  [ "$LINKED" = "reachable" ] || fail "bridge not reachable on loopback"
  echo "device expectation to confirm in the browser: $EXPECT_DEVICE"
fi

echo "PREFLIGHT OK — safe to show a manifest"
