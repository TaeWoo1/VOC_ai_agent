#!/bin/bash
#
# reviewnary 도우미 설치 — 더블클릭으로 실행됩니다. 명령을 입력할 필요가 없습니다.
#
# 하는 일: 이 폴더의 도우미를 내 계정의 애플리케이션 지원 폴더에 복사하고, 로그인 창을 한 번 띄운 뒤,
# 로그인할 때마다 자동으로 시작되는 백그라운드 도우미로 등록합니다. 그다음 reviewnary 채널 연결 화면을 엽니다.
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

# 1. Stop a previous helper, replace the app, keep the state (profile · pairings · login) untouched.
mkdir -p "$HOME_DIR"
if [ -f "$HOME_DIR/app/service.mjs" ]; then
  "$HOME_DIR/app/bin/node" "$HOME_DIR/app/service.mjs" uninstall >/dev/null 2>&1 || true
fi
rm -rf "$HOME_DIR/app" "$HOME_DIR/browsers"
cp -R "$SRC/app" "$HOME_DIR/app"
cp -R "$SRC/browsers" "$HOME_DIR/browsers"
cp "$SRC/BUILD.txt" "$HOME_DIR/BUILD.txt"
chmod 700 "$HOME_DIR"

# 2. First run: the seller's reviewnary login, asked in a Mac dialog, verified against the server, kept 0600.
if [ ! -f "$HOME_DIR/helper.env" ]; then
  REVIEWNARY_HELPER_HOME="$HOME_DIR" REVIEWNARY_BASE_URL="$BASE_URL" REVIEWNARY_APP_URL="$APP_URL" \
    "$HOME_DIR/app/bin/node" "$HOME_DIR/app/first-run.mjs" || { say "로그인을 확인하지 못해 설치를 멈췄습니다. 다시 실행해 주세요."; exit 3; }
fi

# 3. Register the background helper (launchd user agent, GUI session; approval dialogs are native).
RUN_ENV="$HOME_DIR/service.env"
{
  printf 'REVIEWNARY_HELPER_HOME=%s\n' "$HOME_DIR"
  printf 'PLAYWRIGHT_BROWSERS_PATH=%s\n' "$HOME_DIR/browsers"
  printf 'BRIDGE_ALLOWED_ORIGINS=%s\n' "$APP_URL"
} > "$RUN_ENV"
chmod 600 "$RUN_ENV"
"$HOME_DIR/app/bin/node" "$HOME_DIR/app/service.mjs" install --run-env "$RUN_ENV" --home "$HOME_DIR" --entrypoint "$HOME_DIR/app/helper.mjs" -- --bridge-only \
  || { say "도우미를 시작하지 못했습니다. 담당자에게 알려 주세요 (로그: $HOME_DIR/.status/)."; exit 4; }

say "설치가 끝났습니다. reviewnary 채널 연결 화면을 엽니다 — 거기서 [도우미 연결]을 누르고, 이 Mac에 뜨는 창에서 [허용]을 눌러 주세요."
open "$APP_URL/connect" || true
