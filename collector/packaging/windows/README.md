# SellerOps 로컬 도우미 — Windows 설치·업데이트·제거 런북

> Pilot-Ready Local Agent Runtime v1. 이 문서는 **패키지 빌드 → 설치 → 업데이트 → 제거 → 진단** 절차를 담습니다.
> 스크립트는 `collector/src/runtime/packaging-plan.ts`의 테스트된 경로 규칙을 그대로 반영합니다. PowerShell 스크립트
> 자체는 대상 Windows 기기에서 검증합니다(그 기기 검증이 마지막 사람 단계입니다).

## 경로 구조 (핵심 안전 규칙)

| 역할 | 경로 | 업데이트 시 |
|---|---|---|
| **설치 루트(코드)** | `%LOCALAPPDATA%\SellerOps\app` | **통째로 교체** |
| **데이터 루트(로그인·페어링·설정)** | `%LOCALAPPDATA%\SellerOps\Agent` | **절대 건드리지 않음** |

두 폴더는 형제 관계라 업데이트가 로그인/설정을 지우지 않습니다. `update.ps1`은 실행 전에 이 불변식
(데이터 루트가 설치 루트 하위에 있지 않음)을 **검증하고, 어긋나면 중단**합니다.

- 프로필(쿠키)은 `Agent\profiles\<channel>-agent-<hash>` 아래, 계정 슬롯별로 격리됩니다 → 계정이 섞이지 않습니다.
- 페어링은 `Agent\run\pairings.json`에 남아 재시작/업데이트 후에도 유지됩니다 → 다시 페어링하지 않습니다.
- 관리자 권한이 필요 없습니다. Windows 서비스가 아니라 **로그인 시 자동 실행(Startup 폴더 바로가기)** 입니다
  (판매자가 로그인하는 헤드 Chrome은 사용자 세션에서 떠야 하기 때문).

## 1. 패키지(payload) 빌드 — 빌드 담당자/CI

배포 폴더에는 스크립트와 함께 `payload\` 폴더가 있어야 합니다. `payload\`에는 **번들 Node 런타임 + collector 앱 +
node_modules(tsx·Playwright 포함)** 가 들어갑니다.

```
# Windows 빌드 머신에서 (예시)
mkdir payload
copy <node-v20-win-x64>\node.exe payload\node.exe          # 번들 Node 런타임
robocopy <repo>\collector payload\ /E /XD node_modules .profile .status .bridge downloads .git
cd payload
npm ci                                                     # tsx + ws + langgraph 등
npx playwright install chromium                            # 폴백용(설치 Chrome 없을 때); 기본은 설치 Chrome 채널
```

- 실제 운영은 설치된 Chrome 채널(`COLLECTOR_BROWSER_CHANNEL=chrome`)을 사용합니다(ADR: 번들 Chromium 아님).
  대상 PC에 Chrome이 없으면 설치하거나, 폴백으로 번들 Chromium을 포함하세요.
- `payload\packaging\windows\`에 이 스크립트들이 포함돼야 자동 시작 바로가기가 런처를 찾습니다.

## 2. 설치 — 판매자 PC (관리자 권한 불필요)

```powershell
# 압축을 푼 폴더에서
.\install.ps1
```

`install.ps1`가 하는 일:
1. 데이터 루트/설치 루트 생성, payload 복사.
2. **과거 리뷰 가져오기 동의**를 1회 묻고 `Agent\config\import-consent.json`에 기록(개발용 CLI 플래그 대체).
   - 동의해도 자동 로그인·자동 클릭은 없습니다. 판매자가 직접 로그인하고 내보내기/다운로드를 누릅니다.
3. `Agent\config\agent.env.json` 생성(템플릿). **여기에 URL/오리진을 채워야 합니다**:
   - `SELLEROPS_BASE_URL`, `SELLEROPS_APP_URL`, `BRIDGE_ALLOWED_ORIGINS`, `NAVER_REVIEW_URL`.
4. Startup 폴더에 **자동 시작 바로가기** 생성.

설치 후 값을 채웠다면 지금 실행:

```powershell
wscript "$env:LOCALAPPDATA\SellerOps\app\packaging\windows\run-agent.vbs"
```

## 3. 첫 사용 흐름 (판매자 화면)

1. 도우미가 백그라운드로 실행되고, SellerOps 웹앱을 엽니다.
2. 웹앱에서 **연결(페어링)** 을 누르면, 화면에 **연결 승인 코드**가 뜹니다(Windows 알림창).
   그 코드를 웹앱의 **연결 확인** 화면에 입력하면 연결됩니다.
3. **과거 리뷰 가져오기** 진입 → 판매자센터 창이 열리면 **직접 NAVER 로그인** → 도우미가 **리뷰 검색** 화면을
   안내 → 판매자가 **내보내기/다운로드**를 직접 누름 → 도우미가 파일을 감지·검증·업로드.

## 4. 반복 사용 — 재시작/재부팅

- **도우미만 재시작**: 로그인 세션(쿠키)은 프로필에 남아 있어 **다시 로그인하지 않아도** 수집됩니다.
- **PC 재부팅**: 로그인 시 자동 시작 → 웹앱은 저장된 페어링 토큰으로 자동 재연결 → 세션 재사용.
- **세션 만료**: 화면이 "로그인이 필요해요"를 안내 → 판매자가 로그인 → **다시 확인** → 같은 작업 재개.
- **같은 기간/파일 재처리**: 중복은 백엔드에서 걸러져 **새 리뷰가 쌓이지 않습니다**(멱등).

## 5. 업데이트

```powershell
.\update.ps1        # 새 payload 폴더가 옆에 있어야 함
```

- 설치 루트만 교체, 데이터 루트는 보존 → **로그인·페어링·설정 유지**.
- 실행 중이면 창을 닫아 주세요. (이름으로 프로세스를 죽이지 않습니다 — 도우미의 단일 인스턴스 락이
  다음 시작에서 낡은 락을 인계합니다.)

## 6. 제거

```powershell
.\uninstall.ps1                 # 코드 + 자동 시작 제거, 로그인/설정은 보존
.\uninstall.ps1 -RemoveData     # 로그인/설정까지 완전 삭제(되돌릴 수 없음)
```

## 7. 진단 내보내기

문제가 있을 때, 민감 정보 없는 진단 파일을 만들어 지원팀에 보냅니다:

```powershell
$app = "$env:LOCALAPPDATA\SellerOps\app"
& "$app\node.exe" "$app\node_modules\tsx\dist\cli.mjs" "$app\src\cli\local-agent.ts" --export-diagnostics
```

- self-check 결과 + 정제된(민감정보 제거) 로그 꼬리 + 에이전트 버전만 담깁니다.
- 쿠키·토큰·URL·경로·계정은 담기지 않습니다(빌더가 URL/경로/긴 토큰 형태를 한 번 더 마스킹).
- 파일 위치는 `Agent\diagnostics\diagnostics-<시각>.json`.

## 8. 문제 해결 (자동 self-check가 알려주는 것)

부팅 시 self-check가 다음을 검사하고, 각 항목에 **한 가지 복구 행동**을 로그로 남깁니다:

| 증상(sanitized enum) | 뜻 | 복구 |
|---|---|---|
| `BACKEND_UNREACHABLE` | 백엔드에 닿지 않음 | 백엔드/네트워크 확인(`START_BACKEND`) |
| `BRIDGE_ORIGINS_EMPTY` / `APP_ORIGIN_NOT_ALLOWED` | 웹앱 오리진 허용 안 됨 | `agent.env.json`의 `BRIDGE_ALLOWED_ORIGINS` 정렬 |
| `AGENT_VERSION_UNSUPPORTED` | 구버전 | 업데이트 |
| `APPROVAL_CHANNEL_UNAVAILABLE` | 승인 알림창 불가 | 업데이트/지원 문의 |
| `REVIEW_URL_MISSING` | 리뷰 페이지 URL 없음 | `NAVER_REVIEW_URL` 설정 |
| `BROWSER_UNAVAILABLE` | Chrome 없음 | Chrome 설치 |
| `PROFILE_DIR_UNWRITABLE` | 데이터 폴더 쓰기 불가 | 폴더 권한 확인 |
