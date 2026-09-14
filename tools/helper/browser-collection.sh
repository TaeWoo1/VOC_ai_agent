#!/usr/bin/env bash
#
# Turn browser collection on (or off) for an INSTALLED reviewnary 도우미 — operator only.
#
# Why this exists and why it is not in the package: the pilot decision is that a seller never chooses an
# execution provider and never sees one named (docs/execution_strategy_v1.md §5). Browser collection is
# therefore provisioned for them, by whoever is standing up their pilot, and this is that step — two
# declared keys in the helper's own closed-key config file, plus a restart.
#
#   tools/helper/browser-collection.sh on   [--aside-cli /abs/path/to/aside]
#   tools/helper/browser-collection.sh off      # rollback to LOCAL_HELPER
#   tools/helper/browser-collection.sh show
#
# It writes NO credential: `helper.env`'s key list cannot carry one (collector/src/config.ts), and the
# launchd plist refuses secret-ish keys outright. `off` removes the two keys rather than writing a
# different provider, so the default — LOCAL_HELPER — is what answers, from one place.
set -euo pipefail
HOME_DIR="${REVIEWNARY_HELPER_HOME:-$HOME/Library/Application Support/reviewnary-helper}"
ENV_FILE="$HOME_DIR/helper.env"
LABEL="ai.sellerops.local-agent"
MODE="${1:-show}"
shift || true
ASIDE_CLI=""
while [ $# -gt 0 ]; do
  case "$1" in
    --aside-cli) ASIDE_CLI="${2:-}"; shift 2;;
    *) echo "unknown option: $1" >&2; exit 2;;
  esac
done

[ -d "$HOME_DIR" ] || { echo "no helper installed at: $HOME_DIR" >&2; exit 2; }

restart() {
  launchctl stop "$LABEL" 2>/dev/null || true
  sleep 3
  launchctl start "$LABEL" 2>/dev/null || true
  sleep 5
}

# Everything except the two keys this script owns — so rewriting them never drops an operator's other line.
without_ours() {
  [ -f "$ENV_FILE" ] || return 0
  grep -vE '^(REVIEWNARY_EXECUTION_PROVIDER|ASIDE_CLI)=' "$ENV_FILE" || true
}

case "$MODE" in
  on)
    if [ -z "$ASIDE_CLI" ]; then
      ASIDE_CLI="$(command -v aside || true)"
    fi
    # A launchd agent inherits almost no PATH, so a bare name would resolve in this shell and nowhere
    # else. Refuse rather than write a setting that only works where it was typed.
    [ -n "$ASIDE_CLI" ] || { echo "pass --aside-cli /abs/path (not on PATH here)" >&2; exit 2; }
    case "$ASIDE_CLI" in /*) ;; *) echo "--aside-cli must be an absolute path" >&2; exit 2;; esac
    [ -x "$ASIDE_CLI" ] || { echo "not executable: $ASIDE_CLI" >&2; exit 2; }
    { without_ours; printf 'REVIEWNARY_EXECUTION_PROVIDER=ASIDE\n'; printf 'ASIDE_CLI=%s\n' "$ASIDE_CLI"; } > "$ENV_FILE.tmp"
    mv "$ENV_FILE.tmp" "$ENV_FILE"; chmod 600 "$ENV_FILE"
    restart
    ;;
  off)
    if [ -f "$ENV_FILE" ]; then
      without_ours > "$ENV_FILE.tmp"
      if [ -s "$ENV_FILE.tmp" ]; then mv "$ENV_FILE.tmp" "$ENV_FILE"; chmod 600 "$ENV_FILE"; else rm -f "$ENV_FILE.tmp" "$ENV_FILE"; fi
    fi
    restart
    ;;
  show) ;;
  *) echo "usage: $0 on|off|show [--aside-cli /abs/path]" >&2; exit 2;;
esac

# One safe line back: version, site, and whether browser collection is configured. No secret, no personal
# data, no marketplace content — the same line an operator asks a stuck seller for.
"$HOME_DIR/app/bin/node" "$HOME_DIR/app/service.mjs" status
