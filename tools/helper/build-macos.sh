#!/usr/bin/env bash
#
# Build the macOS pilot bundle of the reviewnary 도우미 (Local Helper Pilot Packaging v1, 2026-09-05).
#
# What it produces: dist/reviewnary-helper-macos-<arch>/
#   app/helper.mjs        the resident helper (collector/src/cli/local-agent.ts, one ESM bundle)
#   app/service.mjs       the launchd install/status/uninstall CLI
#   app/unlink.mjs        uninstall companion: revokes this helper's device token on the server, then forgets it
#   app/bin/node          the node binary of the BUILD machine (same arch only — no cross-build is claimed)
#   app/node_modules/     playwright + playwright-core (kept external: Playwright locates its driver by package path)
#   app/package.json      the version the helper announces (`helperVersion()` reads it next to the bundle)
#   browsers/             the Playwright Chromium the helper drives (PLAYWRIGHT_BROWSERS_PATH points here)
#   reviewnary 도우미 설치.command / 제거.command / 읽어주세요.txt
#
# What it does NOT do: sign or notarize anything (the pilot is operator-assisted — see 읽어주세요.txt), build
# for another OS or arch, or bundle a credential. The helper holds NO seller password: it is linked to the
# seller's account from a browser session (Helper Device Authentication v1) and keeps only a revocable device token.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
COLLECTOR="$REPO_ROOT/collector"
ARCH="$(uname -m)"
VERSION="$(node -p "require('$COLLECTOR/package.json').version")"
OUT="${1:-$REPO_ROOT/dist/reviewnary-helper-macos-$ARCH}"
PW_VERSION="$(node -p "require('$COLLECTOR/node_modules/playwright/package.json').version")"

[ "$(uname -s)" = "Darwin" ] || { echo "macOS only: the pilot supports the platform its launchd adapter supports." >&2; exit 2; }
[ -x "$COLLECTOR/node_modules/.bin/esbuild" ] || { echo "run npm install in collector/ first" >&2; exit 2; }

# The app half is rebuilt every time; the browser half (≈550 MB) is kept when it is already there.
rm -rf "$OUT/app"; mkdir -p "$OUT/app/bin" "$OUT/app/node_modules" "$OUT/browsers"
# `ws` is CommonJS; an ESM bundle needs a real `require` in scope for it (esbuild's dynamic-require shim throws).
BANNER='import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);'

cd "$COLLECTOR"
node_modules/.bin/esbuild src/cli/bundle/helper-entry.ts --bundle --platform=node --format=esm --target=node20 \
  --banner:js="$BANNER" --external:playwright --external:playwright-core --log-level=error --outfile="$OUT/app/helper.mjs"
node_modules/.bin/esbuild src/cli/bundle/service-entry.ts --bundle --platform=node --format=esm --target=node20 \
  --banner:js="$BANNER" --external:playwright --external:playwright-core --log-level=error --outfile="$OUT/app/service.mjs"
cp "$HERE/payload/unlink.mjs" "$OUT/app/unlink.mjs"
printf '{ "name": "reviewnary-helper", "version": "%s", "type": "module", "private": true }\n' "$VERSION" > "$OUT/app/package.json"
cp "$(command -v node)" "$OUT/app/bin/node"
cp -R node_modules/playwright "$OUT/app/node_modules/playwright"
cp -R node_modules/playwright-core "$OUT/app/node_modules/playwright-core"

# The browser: install into the bundle's own browsers/ so the seller's machine needs no download step.
if ! ls "$OUT/browsers" 2>/dev/null | grep -q '^chromium-'; then
  PLAYWRIGHT_BROWSERS_PATH="$OUT/browsers" node node_modules/playwright/cli.js install chromium >/dev/null
fi

cp "$HERE/payload/install.command" "$OUT/reviewnary 도우미 설치.command"
cp "$HERE/payload/uninstall.command" "$OUT/reviewnary 도우미 제거.command"
cp "$HERE/payload/README.txt" "$OUT/읽어주세요.txt"
chmod +x "$OUT/reviewnary 도우미 설치.command" "$OUT/reviewnary 도우미 제거.command" "$OUT/app/bin/node"
# The site this package is FOR. A helper installed with the wrong site talks to a backend that is not
# there and accepts pairing from an origin nobody uses, and the seller cannot tell: the card just says
# 「서버 연결 확인 필요」. Defaults stay local for a developer build; a pilot build is produced by
# exporting REVIEWNARY_APP_URL / REVIEWNARY_BASE_URL, and the installer reads them back from here.
PKG_APP_URL="${REVIEWNARY_APP_URL:-http://localhost:5173}"
PKG_BASE_URL="${REVIEWNARY_BASE_URL:-http://127.0.0.1:8080}"
printf 'version=%s\narch=%s\nplaywright=%s\nbuilt=%s\napp_url=%s\nbase_url=%s\n' \
  "$VERSION" "$ARCH" "$PW_VERSION" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$PKG_APP_URL" "$PKG_BASE_URL" > "$OUT/BUILD.txt"

echo "built $OUT"
du -sh "$OUT" | cut -f1
