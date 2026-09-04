# Helper Device Authentication v1 — 결정과 구현 (2026-09-05)

**질문.** 로컬 도우미(reviewnary 도우미)가 판매자의 reviewnary 비밀번호를 `helper.env`(0600)에 저장하고 매 실행마다
`POST /api/auth/login`으로 세션을 사는 구조를, 비밀번호 저장 0 · 브라우저 세션으로 기기 승인 · scope 제한 ·
revocable · 재시작/업데이트 유지 · 설정에서 해제 가능으로 바꾸는 **가장 작은 방법**은 무엇인가.

**결정.** **B안 — 기존 auth 위의 최소 자체 device-flow seam** (RFC 8628의 모양, 라이브러리 0). 범위가 작아
같은 패키지에서 구현했고 라이브로 증명했다. Spring Authorization Server와 외부 auth provider는 **채택하지 않는다**
(§2). 기존 Google / NAVER / email 로그인은 **바이트 단위로 무변경**이다.

## 1. 현재 auth 구조 (감사, HEAD `7639c98e`)

| 층 | 무엇 | 어디 |
|---|---|---|
| 세션 | HS256 JWT, 12시간, claims `sub`(user) · `orgId` · `email`; **stateless** — 서버측 세션 표 없음, refresh 없음, 만료 전 revoke 불가 | `JwtTokenProvider`, `sellerops.jwt.*` |
| 검증 | `JwtAuthFilter`: bearer 파싱 + **org 존재 확인** | `JwtAuthFilter` |
| email/password | `POST /api/auth/login` → `AuthResponse{token,user}`; 브라우저는 `localStorage`에 보관 | `AuthService`, `apiClient.ts` |
| 소셜 | Spring `oauth2Login()`(Google OIDC · NAVER), 성공 시 **일회용 code**(SHA-256만 저장, TTL 120s, 원자적 consume) → `/api/auth/social/exchange` → 같은 JWT; identity는 `(provider, subject)` | `SocialLoginSuccessHandler`, `AuthHandoff`, `AuthCodes` |
| 이미 있던 capability seam | `CredentialHandoffCapabilityFilter` — **별도 헤더 · 경로 하나 · fallback 없음**, 메모리 저장 5분 단일 사용 | `collect/` |
| 도우미의 backend 세션 | `loadConfig()`가 env/`helper.env`에서 `SELLEROPS_EMAIL/PASSWORD` → `login()` **12 호출 지점**(resident helper 6 · ingest builder 2 · 운영자 CLI 4) | `collector/src/upload.ts` 외 |
| 도우미가 호출하는 backend 경로 | `/api/uploads` · `/api/channels` · `/api/item-analysis` · `/api/seller-accounts/{id}/…` · `/api/imports/reviews/launches/{ref}/{scope,ingest,session-readiness,discovered-range}` · `/api/agent/{review-locate-targets,review-handoff,review-acquisition-targets,reply-submission-targets}` (+ `credential-handoff`는 자기 capability) | `grep '/api/' collector/src` |
| 브라우저 ↔ 도우미 | loopback bridge pairing(네이티브 허용 창, bearer는 브라우저 localStorage, 도우미는 해시만) | `bridge-server.ts`, `pairing-store.ts` |

즉 **필요한 부품은 이미 다 있었다** — 무작위 일회용 code와 그 해시 저장(`AuthCodes`/`AuthHandoff`), 별도 credential을 별도
필터로 fallback 없이 받는 모양(`CredentialHandoffCapabilityFilter`), 그리고 브라우저와 도우미 사이의 신뢰 루트(pairing).
없던 것은 **도우미 자신의 revocable credential**과 그것을 판매자 세션으로 발급하는 흐름뿐이다.

## 2. 3안 비교

| | A. Spring Authorization Server device grant | **B. 기존 auth 위 최소 device-flow seam (채택)** | C. Auth0 / 외부 provider |
|---|---|---|---|
| 기존 user/session/social과의 연결 | SAS의 device verification 엔드포인트는 **Spring Security 세션(form login)** 을 전제로 한다; 이 서비스는 STATELESS JWT + SPA라 SAS용 로그인/consent 페이지·세션을 **새로 만들어야** 하고, resource server가 SAS JWT와 기존 HS256 JWT를 **둘 다** 검증해야 한다 | approve가 **기존 JWT 세션**으로 인증되는 평범한 엔드포인트 하나 — Google/NAVER/email 어느 로그인이든 그대로 승인 주체 | 사용자·소셜 identity·JWT 발급 전부 이전; 로그인 화면·onboarding·`AuthHandoff` 전부 대체 |
| DB/schema | `oauth2_registered_client` · `oauth2_authorization` · `oauth2_authorization_consent` 3표(SAS 스키마) + JWK 관리 | **표 1개** `helper_devices`(V97) | 벤더 측 + 로컬 매핑 |
| refresh/revoke | refresh token rotation 내장; revoke는 `oauth2_authorization` 행 삭제 | refresh **없음** — 토큰이 매 요청 DB lookup이라 revoke가 즉시이고 rotation은 두 번째 비밀만 더한다 | 벤더 API |
| helper.env에서 사라지는 secret | 동일(비밀번호) | `SELLEROPS_EMAIL` · `SELLEROPS_PASSWORD` — **키 목록 자체에서 제거** | 동일 |
| 구현 범위/리스크 | 의존성 추가 + 인증 아키텍처 두 개 병존; 파일럿 이득 0(제3자 클라이언트가 없다) | backend 8 파일 · collector 1 모듈 + 배선 · frontend 카드/설정 화면; 라이브러리 0; 기존 로그인 무변경 | 전체 auth 마이그레이션 — 도우미 문제와 무관한 이득을 위해 가장 큰 변경 |

**A·C를 기각한 이유는 하나다**: 도우미 문제를 푸는 데 필요한 것은 credential 하나와 승인 흐름 하나이고, 둘 다
기존 시스템을 바꾸지 않고 붙는다. 「전체를 외부 Auth로 옮기는 것은 도우미 문제 해결에 실제 이득이 클 때만」 —
이득은 없다.

## 3. 채택한 설계

```
도우미(공개 클라이언트, 비밀 0)                 backend                              브라우저(판매자 세션)
POST /api/auth/device/code {deviceName,helperVersion}
   ← {deviceCode, userCode, expiresAt, interval=3}      (pending grant, 메모리, 5분, 해시만)
   … bridge를 통해 userCode를 paired 브라우저에 전달 …
                                                   ← POST /api/helper-devices/approve {userCode}   [JWT]
POST /api/auth/device/token {deviceCode}  →  400 authorization_pending | expired_token | access_denied
                                          →  200 {token: "rvh_…", expiresAt}   (한 번만; 행 helper_devices, SHA-256만)
이후 모든 도우미 요청: Authorization: Bearer rvh_…  →  HelperDeviceAuthFilter (§4)
```

- **판매자는 아무것도 치지 않는다.** `userCode`는 브라우저가 **자기 paired 도우미**에게서 받아(`POST /bridge/device/link`,
  pairing bearer + origin allow-list) 자기 세션으로 승인한다. 표준 device flow의 「코드를 다른 기기에 입력」 단계가
  pairing으로 이미 증명된 같은 기계 안의 왕복으로 줄어든다. 타이핑 페이지는 만들지 않았다(§10).
- **토큰**: `rvh_` + 32바이트 base64url. 서버는 SHA-256만(`helper_devices.token_hash` unique), 도우미는
  `<home>/.auth/device.json`(디렉터리 0700 · 파일 0600, `{token, baseUrl, linkedAt, expiresAt}`). 수명 **180일**; 만료 ·
  해제 뒤의 다음 걸음은 비밀번호가 아니라 「이 기기 연결」 한 번이다.
- **origin 바인딩**: 저장된 토큰은 발급한 backend origin에만 제시된다(`sameOrigin`).
- **재시작/업데이트 유지**: 토큰 파일은 helper home에 있고 installer는 `app/`·`browsers/`만 교체한다(pairings.json과
  같은 규칙).
- **해제**: 설정 › 연결된 기기 `DELETE /api/helper-devices/{id}` → `revoked_at`; 도우미는 다음 요청에서 401,
  상태 확인(`GET /api/helper-devices/me`, 최대 10초 캐시)에서 401을 보면 파일을 지운다. 제거 스크립트는
  `DELETE /api/helper-devices/me`로 스스로 해제한 뒤 파일을 지운다(`unlink.mjs`).

## 4. 필터 — 도우미 토큰은 도우미의 경로만 연다

`HelperDeviceAuthFilter`는 `JwtAuthFilter` **앞**에 서고 prefix `rvh_`인 bearer를 전부 자기 것으로 끝낸다:

1. **prefix로 알아본다, 파싱하지 않는다** — device 토큰은 JWT 파서에 닿지 않고(`JwtAuthFilter`는 이미 인증된 요청을
   다시 파싱하지 않도록 한 줄 바뀌었다), JWT는 device 조회에 닿지 않는다(테스트 양방향).
2. **경로 allow-list** (`ALLOWED`, §1의 호출 목록 그대로 + `GET/DELETE /api/helper-devices/me`). 그 밖의 어떤 경로도
   — `/api/users/me`, `/api/helper-devices`(목록·approve·id 해제), 문의·리뷰·지식·설정 전부 — **401**. 판매자 세션은
   할 수 있고 판매자의 도우미는 못 한다. 도우미 토큰으로 **다른 도우미를 승인하거나 해제할 수 없다**.
3. **fallback 없음** — 미지·해제·만료 토큰은 401로 끝나고 JWT 필터로 흘러가지 않는다.
4. authority `ROLE_HELPER_DEVICE`; `last_used_at`은 분당 최대 1회 기록.

**pending grant는 메모리**(`HelperDeviceGrants`: TTL 5분, 배포당 최대 100건, `CredentialHandoffAuthorizations`와
같은 이유) — 파일럿 topology는 backend 1 프로세스이고 재기동 중 링크는 「이 기기 연결」 한 번 더. 두 번째 인스턴스가
생기면 이것을 표로 옮기는 것이 변경의 전부다. `userCode`는 8자 무모호 알파벳이지만 추측의 가치가 없다 — approve는
**추측자 자신의 세션**으로만 되므로 남의 pending 도우미를 자기 계정에 묶는 것이 최대 피해이고, 상한이 그 표면을
제한한다.

## 5. Schema

V97 `helper_devices(id, org_id→organizations, user_id→users, token_hash unique(64), device_name(80), helper_version(40),
created_at, updated_at, last_used_at, expires_at, revoked_at)` + `(org_id, created_at desc)` 인덱스. 다른 표 무변경.

## 6. Seller flow

**설치.command 더블클릭 → 브라우저에 reviewnary 열림 → 평소 로그인(이메일·Google·네이버) → 채널 연결의 도우미 카드
「다시 연결 필요 · [도우미 연결]」 → Mac 창 [허용] → 「기기 연결 필요 · [이 기기 연결]」 → 「연결 확인 중」 → 「연결됨」.**
비밀번호 입력/저장 0. 설정 › 계정 › **연결된 기기**에서 이름(`Mac (arm64)`) · 연결 시각 · 마지막 사용 · 도우미 버전과
[연결 해제] 하나.

카드의 단어는 `lib/helper/helperStatus.ts`가 정한다 — 기존 여섯에 **기기 연결 필요 · 연결 확인 중 · 서버 연결 확인 필요**
(도우미가 backend에 닿지 못한 경우 — 「어느 쪽이 안 되는가」를 말한다)가 더해졌고, 내부 단어(token·pairing·port…)는
여전히 0(테스트).

## 7. Migration / 보안 영향

- **helper.env**: 키 목록에서 `SELLEROPS_EMAIL`·`SELLEROPS_PASSWORD` 삭제 — 파일에 적혀 있어도 읽지 않는다(테스트).
  설치 스크립트는 이전 패키징의 비밀번호 파일을 **삭제**한다(죽은 비밀을 남기지 않는다). 남은 키는 URL·origin뿐이고
  installer는 그것을 `service.env`(plist env, 비밀 금지 규칙 그대로)에 쓴다. `first-run.mjs`(네이티브 로그인 대화상자) 삭제.
- **collector**: `backendBearer(cfg)` 하나가 12개 호출 지점의 유일한 세션 출처. `NODE_ENV=production`(패키지 도우미)에서는
  device 토큰 **아니면 없음** — 비밀번호 경로가 코드상 도달 불가(테스트). 개발 체크아웃은 링크가 없을 때만 예전 dev 로그인.
- **frontend**: `MIN_HELPER_VERSION` 0.1.0 → **0.2.0** — 비밀번호 모델의 옛 도우미는 「업데이트 필요」(연결됨으로 그리지
  않는다). 로그인 화면·소셜 버튼·JWT 보관 무변경.
- **backend**: 새 permitAll 경로는 `/api/auth/device/{code,token}` 둘(둘 다 무작위 code 없이는 아무것도 안 한다);
  `/api/helper-devices/*`는 인증 필요. 기존 필터·엔드포인트·JWT 무변경.
- **넓어진 노출 하나를 이름 붙인다**: 링크된 도우미는 이제 판매자 비밀번호 대신 **allow-list 범위의 토큰**을 든다 —
  전보다 좁다(전에는 JWT = 모든 org 경로). 새로 생긴 것은 `helper_devices` 행과 loopback의 `/bridge/device/*` 두 라우트뿐이며
  둘 다 pairing bearer 뒤에 있다.

## 8. 라이브 증명 (2026-09-05, 로컬 스택, 마켓플레이스 호출 0 · WRITE 0)

**backend (curl, 실제 DB, V97 적용됨)**: `code` 200(userCode 8자 · interval 3) → `token` 400 `authorization_pending` →
demo 세션 `approve` 200(소문자 code 허용) → 같은 code 재승인 **404** → `token` 200 `rvh_…`(만료 2027-03-03) → 재상환 400
`expired_token` → 도우미 토큰으로 `/api/helper-devices/me` 200 `Mac (arm64)` · `/api/channels` 200 · **`/api/users/me` 401 ·
`/api/helper-devices` 401 · `/api/inquiries` 401** → 판매자 목록 1행(`lastUsedAt` 기록됨) → `DELETE` 200 → 도우미 토큰
`/api/channels` **401** · `/me` **401** → 목록 0 → 재해제 200(멱등).

**설치(실제 launchd)**: 0.2.0 번들 빌드(630 MB) → `설치.command` → 이전 `helper.env`(비밀번호 줄 1) **삭제됨**, `service.env`에
PASSWORD 0, `healthy:true, agentVersion 0.2.0, approvalPresenter macos_native`, `launchctl` running, 실제 home에 `.auth` 없음,
`/bridge/device/status`는 pairing 없이는 **401**.

**브라우저(Playwright 1440, 실제 frontend·backend·bridge 코드)**: 설치된 도우미의 pairing 승인은 이 Mac 앞의 **사람이
누르는 네이티브 창**이라 이 세션이 대신 누를 수 없다 ⇒ 같은 포트에 **개발 도우미**(`--bridge-only --dev-insecure-auto-approve`,
production에서 거부되는 dev 전용 플래그, 별도 scratch home)를 잠시 세우고 실제 backend에 대해 돌렸다:
「다시 연결 필요」→[도우미 연결]→**1.8 s** 「기기 연결 필요」→[이 기기 연결]→「연결 확인 중」→**3.7 s** 「연결됨」(컨트롤 0) →
`/settings/devices` 행 `Mac (arm64) · 방금 전 연결 · 아직 사용 안 함 · 도우미 0.2.0` → [연결 해제]→[해제 확인] → 빈 상태 →
`/connect`가 **10.1 s** 안에 「기기 연결 필요」로 되돌아감(도우미 로그 `device_link_revoked`, scratch home의 `device.json`
0600 생성 후 삭제). 렌더된 문서에 token·bridge·pairing·47615·rvh_·password **0**. 끝난 뒤 개발 도우미를 내리고 설치된
0.2.0 도우미를 launchd로 복구했다.

이 라이브가 결함 하나를 찾아 고쳤다: 카드가 「연결됨」이 된 뒤 폴링을 멈춰 설정에서 해제해도 새로고침 전에는 그대로였다 ⇒
연결된 상태에서도 10 s마다 조용히 다시 읽고, 도우미의 검증 캐시는 30 → 10 s.

## 9. 검증

backend **3,874** · collector **9,443**(152 skipped) · frontend **2,752** · 실패 0. 새 테스트: `HelperDeviceGrantsTest` ·
`HelperDeviceServiceTest` · `HelperDeviceAuthFilterTest`(실제 `SecurityConfig`) · `HelperDeviceRoutePolicyTest` ·
`helper-session.test.ts` · `bridge-device-link.test.ts` · `helperStatus`/`HelperStatusCard`/`HelperDevices` 테스트.
마이그레이션 1(V97) · 마켓플레이스 호출 0 · WRITE 0 · 모델 호출 0 ⇒ evidence 행 없음.

## 10. 하지 않은 것 / 남는 것

- 설치된 production 도우미의 pairing 허용과 첫 「이 기기 연결」은 **이 Mac 앞의 사람**이 누른다(그것이 정확히 seller flow다).
- `userCode`를 손으로 치는 페이지 없음 — bridge가 닿지 않는 경우는 곧 도우미가 없는 경우라 필요가 관측되지 않았다.
- pending grant는 메모리(backend 1 프로세스 전제) · approve 실패 횟수 제한 없음(추측 이득이 없다는 §4의 논거에 기댄다).
- 토큰 rotation 없음(설계 결정, §3) · 만료 180일 뒤는 재연결.
- 운영자 CLI(`upload-file` 등)는 개발 체크아웃에서 dev 로그인을 계속 쓴다 — 판매자 기기에는 없다.
- pairing 전환 중 브라우저 콘솔에 404 1건이 관측됐고(자원 미상), 세 화면 재로드에서는 4xx 0 — 이 패키지의 경로가 아니다.
