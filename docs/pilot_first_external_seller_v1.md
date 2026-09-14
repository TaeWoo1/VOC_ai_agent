# Pilot Runtime / First External Seller v1 — Coupang browser review lane

**2026-09-14.** Coupang Review Acquisition / Connection UX는 **pilot freeze**(`e01eea36` · `c5be3bd5`).
이 문서는 그 lane 하나로 첫 외부 판매자를 받기 위한 **배포 매니페스트**와 **온보딩 체크리스트**,
그리고 첫 판매자의 요청을 기록하는 **분류 규칙**이다. 기능·UX 변경은 여기 없다.

## 0. 이 파일럿이 무엇이고 무엇이 아닌가

**첫 판매자에게 켜는 것은 하나다 — 브라우저 상품평 수집.** 판매자의 쿠팡 로그인과 이 PC의 도우미로
돌아가고, **API 키도 상품 카탈로그도 필요하지 않다**(`docs/coupang_connection_ux_v2.md` §5–§6).

**따라서 이 파일럿의 전제가 아닌 것**, 그리고 그 이유:

| 아닌 것 | 왜 |
|---|---|
| **고정 공인 IPv4** | 호출 IP 등록은 **NAVER 커머스 API**의 요구다(`PilotConfigValidator`의 그 조건은 `naverEnabled` 하나에만 걸려 있다). 브라우저 lane은 우리 서버에서 쿠팡을 호출하지 않는다 — 읽는 것은 **판매자 자신의 브라우저**다. Elastic IP는 **NAVER를 추가할 때의** 전제이지 시작의 전제가 아니다. |
| 쿠팡 OpenAPI 커넥터 | 상품평에는 판매자 API가 없다. `SELLEROPS_CONNECTOR_COUPANG_ENABLED=false` 그대로. |
| `SELLEROPS_VAULT_MASTER_KEY` | 커넥터가 하나도 켜지지 않으므로 봉인할 자격이 없다(validator는 `anyConnector`에만 요구한다). **추가하는 첫 커넥터와 함께** 필요해진다. |
| Cafe24 앱 자격 / redirect URI | 이 파일럿에서 Cafe24는 꺼져 있다. |
| 마켓플레이스 WRITE / 답변 전송 | 이 lane은 READ 전용이고, 전송 lane은 각자의 승인 뒤에 있다. |

## 1. 배포 매니페스트 — Coupang review-only

### 1-1. product-owner 입력 (값은 저장소에 들어가지 않는다)

| 이름 | 무엇 |
|---|---|
| `PILOT_PUBLIC_HOST` | A 레코드가 이 호스트를 가리키는 **공개 HTTPS 호스트 이름**. scheme·path 없음. ACME가 발급할 수 있도록 :80·:443 도달 가능 |
| `PILOT_ACME_EMAIL` | 인증서 발급 통지 수신 |
| `POSTGRES_PASSWORD` · `SELLEROPS_JWT_SECRET` | 호스트에서 생성(`openssl rand`) |

호스트 자체는 **고정 IP가 없어도 된다** — 필요한 것은 **안정적인 이름**이다.

### 1-2. `/etc/sellerops/pilot.env` — 이 lane이 정하는 값

```
PILOT_PUBLIC_HOST=<이름>
PILOT_ACME_EMAIL=<메일>
POSTGRES_PASSWORD=<생성>
SELLEROPS_JWT_SECRET=<생성>

# 이 파일럿이 켜는 단 하나. 도우미의 loopback origin을 번들 CSP에 이름 짓는다.
PILOT_GUIDED_HELPER_ENABLED=true
PILOT_HELPER_BRIDGE_URL=http://127.0.0.1:47615

# 커넥터는 전부 꺼짐 — 그래서 vault 키도 egress IP도 앱 자격도 요구되지 않는다.
SELLEROPS_CONNECTOR_NAVER_ENABLED=false
SELLEROPS_CONNECTOR_COUPANG_ENABLED=false
SELLEROPS_CONNECTOR_CAFE24_ENABLED=false
SELLEROPS_CONNECTOR_MOCK_ENABLED=false
SELLEROPS_CONNECTOR_MOCK_FALLBACK_ENABLED=false

# 실제 판매자가 닿는 호스트에서 데모는 존재하지 않는다.
SELLEROPS_SEED_ENABLED=false
SELLEROPS_SEED_DEMO_CONTENT=false
SELLEROPS_SEED_DEMO_ENTRY=false
SELLEROPS_MAIL_MODE=off

# 별도 결정 전까지 꺼짐.
SELLEROPS_PROACTIVE_ENABLED=false
SELLEROPS_INQUIRY_PUBLISH_EXECUTION_ENABLED=false
```

Agent(`SELLEROPS_AGENT_*`)와 knowledge retrieval 셋은 **이 파일럿의 범위 밖**이다 — §3-B2를 읽고 결정한다.

### 1-3. 실행

```
deploy/pilot/host-bootstrap.sh                     # docker + compose, 포트 80/443만
deploy/pilot/deploy.sh                             # env 검증 → build → up(Flyway) → health → smoke
REVIEWNARY_APP_URL=https://$HOST REVIEWNARY_BASE_URL=https://$HOST \
  tools/helper/build-macos.sh                      # 판매자 패키지를 이 사이트로 스탬프
```

`deploy.sh`는 `PILOT_GUIDED_HELPER_ENABLED=true`일 때 위 helper 빌드 명령을 **스스로 출력한다**.

### 1-4. 배포가 맞는지 확인하는 것 (`smoke.sh`, 자격 0 · WRITE 0)

- `https://$HOST/health` UP · 데모 입구 **OFF** · 익명 API 읽기 거절
- **raw 포트 비공개**(5432/8080/8787/5173이 공개 인터페이스에 없음)
- **서빙된 번들의 CSP가 판매자 도우미 origin을 이름 짓는다** — 이것이 「env는 guided-on인데 이미지는
  그 전에 빌드됨」을 밖에서 잡는 유일한 검사다
- CSP에 **loopback runtime이 없다**(`127.0.0.1:8787`이 남아 있으면 판매자 브라우저가 자기 PC를 가리킨다)

### 1-5. 판매자 패키지

`dist/reviewnary-helper-macos-<arch>/` — `BUILD.txt`의 `app_url`/`base_url`이 **파일럿 호스트**여야 한다.
서명·공증 없음 ⇒ **운영자 동반 설치**(Gatekeeper 우회 안내는 `읽어주세요.txt`).

## 2. 판매자 온보딩 체크리스트

**운영자가 먼저 (판매자 없이):** 배포 → smoke 통과 → 이 사이트용 도우미 패키지 빌드 → 빈 org로
로그인/가입 한 번 해 보고 첫 화면이 정상인지 확인.

**판매자와 함께 (한 자리에서):**

1. 가입 — 이메일·비밀번호 (소셜 로그인은 이 파일럿에서 꺼짐)
2. 도우미 설치 — 패키지 전달 → `설치.command` → 계정 비밀번호는 **설치 권한용**이고 reviewnary는 보지 않음
3. reviewnary에서 도우미 연결 — `연결 · 설정 › 채널 연결`의 도우미 카드 → [도우미 연결] → macOS 승인 창 → [이 기기 연결]
4. **쿠팡 계정 만들기 — §3-B1을 먼저 읽을 것** (오늘은 API 키 입력 화면을 지나야 한다)
5. 쿠팡 윙에 로그인 (도우미 브라우저 프로필에 유지됨 — 보통 1회)
6. `채널 연결 › 쿠팡` → **[리뷰 수집 연결하기]** → 스토어 확인 **1회** → 수집 → 완료
7. 이후 루틴: **[지금 가져오기] 한 번** (라이브 측정: 1440·1366·1152 전부 press 1)
8. 결과 확인: `리뷰` 화면에 수집된 상품평, `홈`에 리뷰 수

**판매자가 하지 않아도 되는 것**: API 키 발급 · 상품 등록 · 고정 IP · 기간 선택 · 페이지 넘기기.

## 3. 첫 판매자 전에 결정해야 하는 것 (freeze 준수 — 고치지 않고 보고)

### B1 · BLOCKING — 브라우저 수집만 원하는 판매자가 계정을 만들 방법이 없다

쿠팡 `seller_account` 행을 만드는 코드는 **하나뿐**이고(`ConnectCoupang.onSubmitCredentials` →
`ensureAccountId` → `createApiChannelAccount`), 그것은 판매자가 **Access Key·Secret Key·업체코드를
제출하는 순간**에만 돈다. 그래서 새 판매자의 경로는 `/connect` → 쿠팡 → 「연결하기」 →
**`/connect/coupang`(OpenAPI 키 발급 안내)** 이고, 키를 넣기 전에는 `/connect/channels/{account}`가
존재하지 않는다 — 그 화면의 「리뷰 수집」 카드가 **「API 키는 필요하지 않습니다」**라고 말하는데도.

**결정 필요**: 자격 없이 계정 행을 만드는 최소 진입(예: 쿠팡 행의 「상품평만 먼저 가져오기」)을 만들 것인가,
아니면 첫 판매자에 한해 **운영자가 계정을 만들어 주고** 시작할 것인가.

### B2 · BLOCKING(범위에 따라) — 브라우저 전용 판매자는 `CONNECTED`가 되지 않는다

`connectionStatus=CONNECTED`는 **OAuth 동의나 자격 입력**으로만 도달한다
(`SellerAccountRepository.findOrgIdsWithConnectedApiAccount`의 정의). 브라우저 수집만 하는 판매자는
영원히 `PENDING`이고, 따라서 `SELLEROPS_AGENT_ACCESS_SCOPE=CONNECTED_SELLERS`는 **그를 admit하지
않는다** — Agent 대화 lane이 그에게는 꺼져 있다(정기 수집 스케줄이 안 잡히는 것은 이 lane이 판매자
주도이므로 의도된 결과다).

**결정 필요**: 첫 파일럿에 Agent를 포함할 것인가. 포함한다면 그 org UUID를 각 capability의
`*_ORG_IDS`에 **이름으로** 넣는 방식이 오늘 가능한 유일한 길이다.

### B3 · BLOCKING — 첫 화면(채널 목록)이 이 lane을 「미완성 API 연결」로 설명한다

실측(상품평 9건을 수집한 QA 계정, `/connect`):

> 쿠팡 · **연결 중** · **수집 이력 없음** · 상품평 9개 보기 · **[연결 계속하기]**

세 가지가 동시에 틀렸다 — 진행 중인 것이 없고, 20분 전에 9건을 수집했고, primary는 판매자를 다시 API 키
화면으로 보낸다. 원인은 하나다: 허브 행은 **`connectionStatus`와 API lane의 `lastSyncedAt`만** 읽고,
브라우저 lane은 그 둘 중 무엇도 쓰지 않는다. 바로 옆의 「상품평 9개 보기」가 같은 행을 반박한다.

**결정 필요**: 허브 행이 채널의 **어느 capability라도** 살아 있으면 그렇게 말하도록 할 것인가.

### N1 · NICE_TO_HAVE

- `AUTH_REQUIRED` 뒤의 [로그인했습니다] press 1회 (자동 감지는 판매자 세션으로 마켓플레이스를 반복해 여는 비용)
- 완료 화면 헤더가 capability 설명을 한 번 더 말함
- 도우미 패키지 미서명 ⇒ 운영자 동반 설치

## 4. 첫 판매자 피드백 분류

한 명의 말로 범위를 넓히지 않기 위해, 요청·막힘을 **세 칸**으로만 기록한다.

| 분류 | 기준 | 대응 |
|---|---|---|
| **BLOCKING** | 판매자가 이 lane을 **끝까지 쓸 수 없다** | 즉시 고친다. 원인과 라이브 증명을 evidence에 남긴다 |
| **REPEATED** | **서로 다른 판매자 2명 이상**이 같은 것을 말했다 | 다음 패키지 후보. 한 명이 두 번 말한 것은 REPEATED가 아니다 |
| **NICE_TO_HAVE** | 있으면 좋지만 없어도 끝난다 | 기록만. 파일럿 중 구현하지 않는다 |

각 항목은 **누가·언제·무엇을 하려다·어디서 멈췄는가**로 적는다. 해석은 적지 않는다.
