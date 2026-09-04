#!/bin/bash
# reviewnary 도우미 제거 — 백그라운드 도우미 등록을 해제하고 프로그램을 지웁니다.
# 네이버 로그인 정보(브라우저 프로필)와 연결 기록은 남겨 둡니다: 다시 설치하면 그대로 이어집니다.
set -euo pipefail
HOME_DIR="$HOME/Library/Application Support/reviewnary-helper"
if [ -f "$HOME_DIR/app/service.mjs" ]; then
  "$HOME_DIR/app/bin/node" "$HOME_DIR/app/service.mjs" uninstall || true
fi
rm -rf "$HOME_DIR/app" "$HOME_DIR/browsers"
printf '\n도우미 프로그램을 제거했습니다. 로그인 정보까지 지우려면 이 폴더를 휴지통에 넣으세요: %s\n' "$HOME_DIR"
