#!/bin/bash
#
# reviewnary 도우미 설치 — 더블클릭으로 실행됩니다. 명령을 입력할 필요가 없습니다.
#
# 하는 일: 이 폴더의 도우미를 내 계정의 애플리케이션 지원 폴더에 복사하고, 로그인할 때마다 자동으로 시작되는
# 백그라운드 도우미로 등록한 뒤 reviewnary 채널 연결 화면을 엽니다. 비밀번호를 묻지 않습니다 — 도우미는
# 브라우저에서 이미 로그인한 계정에 「이 기기 연결」로 연결됩니다 (Helper Device Authentication v1).
# 관리자 권한을 요구하지 않고, 시스템 설정을 바꾸지 않으며, 마켓플레이스에는 접속하지 않습니다.
set -euo pipefail
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOME_DIR="$HOME/Library/Application Support/reviewnary-helper"
APP_URL="${REVIEWNARY_APP_URL:-http://localhost:5173}"
BASE_URL="${REVIEWNARY_BASE_URL:-http://127.0.0.1:8080}"

say() { printf '\n%s\n' "$*"; }
say "reviewnary 도우미를 설치합니다."

[ "$(uname -s)" = "Darwin" ] || { say "이 설치 파일은 macOS 전용입니다."; exit 2; }
if [ "$(uname -m)" != "$(sed -n 's/^arch=//p' "$SRC/BUILD.txt")" ]; then
  say "이 도우미는 $(sed -n 's/^arch=//p' "$SRC/BUILD.txt") Mac용입니다. 이 Mac은 $(uname -m)입니다. 담당자에게 맞는 파일을 받아 주세요."; exit 2
fi

# 1. Stop a previous helper, replace the app, keep the state (profile · pairings · device link) untouched.
mkdir -p "$HOME_DIR"
if [ -f "$HOME_DIR/app/service.mjs" ]; then
  "$HOME_DIR/app/bin/node" "$HOME_DIR/app/service.mjs" uninstall >/dev/null 2>&1 || true
fi
rm -rf "$HOME_DIR/app" "$HOME_DIR/browsers"
cp -R "$SRC/app" "$HOME_DIR/app"
cp -R "$SRC/browsers" "$HOME_DIR/browsers"
cp "$SRC/BUILD.txt" "$HOME_DIR/BUILD.txt"
chmod 700 "$HOME_DIR"

# 2. A login file from the previous packaging (helper.env with SELLEROPS_PASSWORD) is retired: the helper no
#    longer reads a password from anywhere, so the file is removed rather than left as a dead secret.
if [ -f "$HOME_DIR/helper.env" ] && grep -q '^SELLEROPS_PASSWORD=' "$HOME_DIR/helper.env"; then
  rm -f "$HOME_DIR/helper.env"
fi

# 3. Register the background helper (launchd user agent, GUI session; approval dialogs are native).
#    Only paths and origins go here — never a credential (the service planner refuses one).
RUN_ENV="$HOME_DIR/service.env"
{
  printf 'REVIEWNARY_HELPER_HOME=%s\n' "$HOME_DIR"
  printf 'PLAYWRIGHT_BROWSERS_PATH=%s\n' "$HOME_DIR/browsers"
  printf 'BRIDGE_ALLOWED_ORIGINS=%s\n' "$APP_URL"
  printf 'SELLEROPS_BASE_URL=%s\n' "$BASE_URL"
  printf 'SELLEROPS_APP_URL=%s\n' "$APP_URL"
} > "$RUN_ENV"
chmod 600 "$RUN_ENV"
"$HOME_DIR/app/bin/node" "$HOME_DIR/app/service.mjs" install --run-env "$RUN_ENV" --home "$HOME_DIR" --entrypoint "$HOME_DIR/app/helper.mjs" -- --bridge-only \
  || { say "도우미를 시작하지 못했습니다. 담당자에게 알려 주세요 (로그: $HOME_DIR/.status/)."; exit 4; }

say "설치가 끝났습니다. reviewnary 채널 연결 화면을 엽니다 — 로그인한 뒤 [도우미 연결] → 이 Mac에 뜨는 창에서 [허용] → [이 기기 연결]을 누르면 끝입니다. 비밀번호를 도우미에 입력하지 않습니다."
open "$APP_URL/connect" || true
