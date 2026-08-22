# Production-like Demo Org + Channel Knowledge v1

**작성 2026-08-22 · 브랜치 `feat/demo-org-channel-knowledge` · 기준 커밋 `9db0d96c`**

이 문서가 소유하는 것: **canonical Demo Org의 provenance 계약**, **vault key 진단 계약**, 그리고
**Channel Knowledge v1의 구조와 권위 관계**. 그 밖의 것은 소유하지 않고 가리킨다.

## 0. 권위 관계 (다른 문서와의 경계)

| 무엇 | 정본 | 이 문서의 역할 |
|---|---|---|
| channel × DataType capability 상태 | `docs/multi-channel-connector-roadmap.md` §4.1 | **읽기만** 한다. 어떤 칸도 옮기지 않는다. |
| AI Operator 실행 구조 / 계획 계약 | `docs/sellerops_operator_graph_v2.md` | Channel Knowledge tool 3개를 **추가**할 뿐, planner 계약은 그대로. |
| 취득 경로 선언 | `AcquisitionPathRegistry` (code) | recurrence 축을 추가하고 NAVER EXPORT를 등재. |
| 라이브 증거 | `docs/evidence/INDEX.md` | §4에 감사 행 1개. |
| 문의 lifecycle | `docs/inquiry_operational_truth_v1.md` | provenance 축은 그 위에 **직교**한다. |

**과거 proof를 현재 Demo Org proof로 덮어쓰지 않는다.** Coupang의 2026-08-06/08-14/08-15 라이브
증명은 전부 유효하며, 전부 **일회용 DB**에서 났다. 이 문서는 그 사실을 지우지 않고 기록한다.

## 1. Canonical Demo Org

`7146c50f-ff6d-4c83-ae96-18c930e6d8e0` ("데모 제조사")를 **일회용 proof DB가 아니라 유지되는
pre-production tenant**로 취급한다. 앞으로 capability가 live-proven 되었다고 주장하려면 가능한 경우
canonical Demo Org에 실제 데이터가 있고, provenance가 REAL이고, 현재 연결에서 다시 읽을 수 있어야 한다.

### 1.1 Provenance 계약

모든 운영 데이터 행은 `data_origin ∈ {REAL, DEMO_SEED, VERIFY_FIXTURE}`를 갖는다
(`com.sellerops.common.DataOrigin`). 기본 읽기는 REAL만 본다 — Hibernate `@FilterDef(autoEnabled=true)`
`realDataOnly`가 자동으로 켜지므로, **화면이 제외를 잊어서 합성 데이터를 집는 일이 구조적으로 불가능**하다.
가시성은 `sellerops.seed.demo-content` 한 플래그가 결정한다: 데모 콘텐츠를 **쓰는** 배포가 그것을 **보는**
배포다.

**삭제하지 않는다.** 데모 org는 테스트 코퍼스이기도 하고, Coupang inquiry ingest를 증명한
`VERIFY-11618-*` 픽스처는 증거다. 세지 않을 뿐 존재는 유지한다 — V51의 `operational_state`와 같은 모양.

분류 규칙은 **구조적**이며 문자열 대조가 아니다 (V54~V56):

| 대상 | 규칙 | 근거 |
|---|---|---|
| reviews · inquiries | `external_id IS NULL AND content_hash IS NULL` | ingest 경로는 **언제나** content hash를 계산한다. 둘 다 없는 행은 ingest에서 올 수 없다. 매칭 결과가 seeder 루프 수(44 · 16)와 **정확히 일치** — 독립 신호 2개가 같은 행 집합을 가리킴. |
| order_daily_summaries | `sales_amount = order_count × (12900 + 3000k)` | seeder 자체 산술. NAVER 실데이터 34개 단가 중 32개가 비정수배. 날짜 범위 규칙이었다면 틀렸을 것 — seeded NAVER 3일이 실제 sync로 덮여 있었다. |
| item_analyses · customer_memory_entries | source 행의 분류를 상속 | 소스는 거르고 파생 판정은 남기면 부정직함이 한 테이블 옆으로 옮겨갈 뿐. |
| channel_products · products | **증거 기반** — REAL review/inquiry가 하나라도 뒷받침할 때만 REAL | 파생 리스팅은 "셀러가 어디서 파는가"에 대한 주장이다. seeder SKU 패턴으로 골랐다면 아무 표식 없는 NAVER 3건을 놓쳤을 것. |

### 1.2 분류 결과 (2026-08-22 측정)

| 테이블 | REAL | DEMO_SEED | VERIFY_FIXTURE |
|---|---|---|---|
| reviews | 3,872 (NAVER 3,858 · GMARKET 11 · CAFE24 3) | 44 (COUPANG 22 · NAVER 22) | 0 |
| inquiries | 3,201 (CAFE24) | 16 (COUPANG 8 · NAVER 8) | 3 (COUPANG) |
| order_daily_summaries | 32 (NAVER) | 25 (COUPANG 14 · NAVER 11) | 0 |
| item_analyses | 7,073 | 60 | 3 |
| customer_memory_entries | 7,073 | 60 | 3 |
| channel_products | 52 (NAVER 44 · GMARKET 8) | 6 (COUPANG 3 · NAVER 3) | 0 |
| products | 56 | 8 | 0 |

**홈 화면 before → after:** 미답변 문의 **9 → 1**, 부정 리뷰 **25 → 14**. 두 숫자 모두 이전에도
산술적으로 옳았고 아무것도 참이 아니었다.

## 2. Vault key 진단 계약

### 2.1 무엇이 틀려 있었나

`connector_credentials.encryption_key_id`는 첫 릴리스부터 기록되었고 **읽힌 적이 없다**.
`CredentialVault.open()`은 런타임이 오늘 설정한 키 하나로 모든 credential을 열었다. 그래서 키를 바꾸면
저장된 모든 credential이 조용히 고아가 되고, 증상은 GCM 실패 한 줄 — 키 부재·키 불일치·값 손상이
**전부 같은 문장**이었다: `자격 증명 복호화에 실패했습니다`.

데모 org의 실제 모습이 그 대가를 보여준다. 4개 credential 전부 `local-dev-1`로 봉인되어 있고,
그 이름의 Keychain 항목이 같은 기계에 실재하며, **그 항목은 이 중 어느 것도 열지 못한다.**

### 2.2 무엇을 고쳤나

- **credential은 그것을 봉인한 키로 연다.** 은퇴한 키는 읽기 전용 key-ring(`sellerops.vault.key-ring`,
  `id:base64,...`)에 실려, 키 회전이 더 이상 전 셀러 재연결을 뜻하지 않는다.
- **모든 행이 non-secret 키 지문을 갖는다** (V53). 마스터 키의 단방향 HMAC이라 키를 식별하되 키를
  담지 않는다. 지문 비교는 복호화를 시도하지 않고 "같은 키인가"를 확정하므로, `KEY_MISMATCH`는
  추론이 아니라 **증명**이다.
- **`CredentialKeyStatus` 7단계**: `OK · NO_CREDENTIAL · NO_KEY_CONFIGURED · KEY_NOT_AVAILABLE ·
  KEY_MISMATCH · KEY_UNVERIFIABLE · INVALID_CREDENTIAL`. 각각이 **다른 사람의 다른 작업**을 뜻한다.
- `GET /api/seller-accounts/{id}/credential-diagnosis` — 비밀 재료를 읽지 않고 채널을 호출하지 않는다.
- 연결 화면은 **누가 고칠 수 있는가**로 나눠 보여준다. 서버 문제면 "판매자가 다시 연결해도 해결되지
  않습니다"라고 명시한다.
- 잘못된 형식의 마스터 키는 **부팅을 멈춘다**(이전엔 첫 사용 시점). 설정 오타를 새벽 스케줄이 발견하는
  일이 없도록. 키 **미설정**은 여전히 정상 부팅 — 그것은 의도된 구성이다.

### 2.3 현재 진단 결과 (2026-08-22, 라이브)

| 계정 | 라벨 | 진단 | 뜻 |
|---|---|---|---|
| Cafe24 `78da0eb3` | `local-dev-1` | **`OK`** | 마켓 접촉 0회로 **복구됨**. key-ring에 등재. |
| FILE_IMPORT `f74f070f` | `local-dev-1` | **`OK`** | 복구됨. |
| NAVER `bdccb7a7` | `local-dev-1` | **`KEY_UNVERIFIABLE`** | 4개 후보 전부 실패. **키 재료 소실** ⇒ 셀러 재입력 필요. |
| Coupang | — | `NO_CREDENTIAL` | credential 행 자체가 없음. |

키 id → Keychain 계정 매핑은 `tools/vault/keyring-from-keychain.sh`가 소유한다. `local-dev-1`을
봉인한 키는 Keychain 계정 `taewookang`에 있으며, **`local-dev-1`이라는 이름의 Keychain 항목은 다른
키다.** 이름이 맞도록 "고치지" 말 것.

## 3. 취득 경로 semantics

"모든 DataType은 자동 hourly sync여야 COMPLETE"는 **완료 기준이 아니다.** 채널 정책상 export나
Action Window가 정식 방식이면 그것이 정직한 COMPLETE다.

`AcquisitionPath`에 `recurrence` 축을 추가했다:

| 값 | 뜻 |
|---|---|
| `SCHEDULED` | 무인 반복. 사람이 없어도 새 데이터가 들어온다. |
| `SELLER_REPEATED` | 셀러가 반복하는 같은 행위. 새 데이터가 **들어올 수 있으나** 저절로는 아니다. |
| `ONE_OFF` | 과거를 한 번 가져오고 끝. sync가 아니라 마이그레이션. |

등록된 경로 (전부 `SELLER_REPEATED`, 그리고 그것이 정직하다):

- **COUPANG / REVIEW** — `ACTION_WINDOW · LIVE_PROVEN` (2026-08-15)
- **NAVER / REVIEW** — `EXPORT · LIVE_PROVEN` (2026-07-25) — **2026-08-22 신규 등재**

NAVER export 경로가 등재되지 않은 채였다는 사실이 이 축의 존재 이유다. 시스템에서 리뷰 데이터가 가장
많은 채널(실데이터 3,858건이 전부 이 경로로 들어왔다)에 대해, **취득 방식을 말하는 유일한 화면이
아무 말도 하지 않았다.** 스케줄도 자동 갱신도 없는 코퍼스가 둘 다 있는 것처럼 읽혔다.

`ChannelApiGapRegistry`에 **NAVER `REVIEW_API`**도 등재했다. Coupang과 같은 이유 — 커넥터가 꺼져 있어도
채널의 사실은 남아야 한다.

## 4. Channel Knowledge v1

### 4.1 세 지식 축의 경계

| 축 | 답하는 질문 | 범위 |
|---|---|---|
| Product Knowledge | 무엇을 파는가 | 이 셀러 |
| Customer Operations Memory | 고객이 무엇을 말해왔는가 | 이 셀러 |
| **Channel Knowledge** | **이 채널은 어떻게 작동하고 판매자는 어떻게 운영하는가** | **플랫폼 공통** |

Channel Knowledge는 **seller-specific policy를 담지 않는다** — 배송 정책, 교환/환불 규정, CS tone,
브랜드 규칙, 상품별 예외. 그것들은 셀러마다 다르고 이 패키지가 만들지 않는 별도 시스템에 속한다.
경계를 지키는 구체적 이유: 한 셀러의 배송 규칙이 다른 셀러의 Agent 답변이 되는 일을 막는다.
`ChannelKnowledgeConsistencyTest.noEntryCarriesSellerSpecificPolicy()`가 이 경계를 지킨다.

### 4.2 구조

giant system prompt가 아니라 **versioned · source-grounded pack + retrieval**이다. 프롬프트는 버전이
없고 출처가 없고 전부 있거나 전부 없다. 항목은 필요할 때 검색되고, 각각 자기 출처와 마지막 확인
날짜를 갖는다.

- 리소스: `backend/src/main/resources/channel-knowledge/{naver,coupang,cafe24}.yaml` — **채널당 18개
  항목, 8개 지식 영역 전부**, 총 54개.
- 영역: `CAPABILITY · WORKFLOW · STATUS_SEMANTICS · CONNECTION · NAVIGATION · TROUBLESHOOTING ·
  GLOSSARY · OPERATIONS`.
- 출처 등급: `LIVE_OBSERVATION · SELLEROPS_EVIDENCE · VENDOR_DOC · PRODUCT_DECISION · UNVERIFIED`.
  **UNVERIFIED 항목은 자기 문장 안에서 hedge해야 한다** (테스트가 강제). Agent가 그대로 인용하기 때문.
- 검색: lexical. 코퍼스가 작고, 셀러/Agent가 이미 쓰는 어휘이며, 저장소에 함께 실린다. 한국어
  조사 때문에 word-boundary가 아니라 substring 매칭을 쓴다.
- API: `/api/channel-knowledge/search`, `/channels/{ch}/capabilities/{type}`, `/channels/{ch}/connection`.
- 부팅 시 fail-closed: 중복 id나 깨진 pack이면 부팅하지 않는다. 절반만 로드된 지식 베이스는 없는 것보다
  나쁘다 — Agent가 살아남은 절반으로 자신 있게 답한다.

### 4.3 drift 방지 — capability 답은 **합성**된다

`/channels/{ch}/capabilities/{type}`의 `supported`·`verificationStatus`·`acquisitionPaths`·`apiGaps`는
**코드 레지스트리에서 계산**되며 YAML에 다시 쓰이지 않는다. pack은 코드가 표현할 수 없는 것만 더한다 —
왜 그런지, 셀러가 무엇을 해야 하는지.

**하나의 사실에 표현이 둘이면 어긋난다. 표현이 하나고 설명이 붙어 있으면 어긋나지 않는다.**

이건 가설이 아니다. Cafe24 OAuth 스코프 목록이 저장소에 **세 곳**에 있었다:

1. `Cafe24OnboardingConfiguration`의 `@Value` 기본값 — 3개 + "새 연결은 셋 다 한 번에 동의한다"는 주석
2. `application.yml` — **2개**. `@Value` 기본값은 property가 **부재할 때만** 적용되고 이 줄은 항상
   값을 줬으므로, **이쪽이 이겼다**
3. `frontend/src/pages/Cafe24Tutorial.tsx` — 또 다른 2개

**모든 Cafe24 연결이 틀린 집합에 동의해 왔다.** 재동의를 해도 상품 읽기는 계속 실패했을 것이고 셀러를
두 번 부르게 됐을 것이다. 셋 다 수정했고, `ChannelKnowledgeConsistencyTest`가 셋을 함께 고정한다 —
그리고 그 테스트가 **실제로 이 회귀에서 실패하는지 확인했다.**

### 4.4 Agent 통합

Operator tool 3개, 전부 READ:

| tool | 답하는 것 |
|---|---|
| `search_channel_knowledge` | 채널이 어떻게 작동하는지 (필터: channel · topic · capability) |
| `get_channel_capability` | 이 데이터가 이 채널에서 실제로 어떻게 들어오는지 + recurrence |
| `get_connection_guidance` | 연결에 무엇이 필요하고 안 될 때 무엇부터 볼지 |

- **WRITE = 0 유지**, privileged plane 도달 불가 — 추가 후 재확인 (`channelKnowledgeTools.test.ts`).
- 세 tool 모두 **org·product·inquiry를 인자로 받지 않는다.** 플랫폼 사실은 셀러 데이터가 아니며,
  그런 인자를 받는 순간 Channel Knowledge가 seller-specific policy가 쌓이는 곳이 되기 시작한다.
- **매 질문마다 주입하지 않는다.** planner가 목표에 따라 고른다 — 카탈로그 설명에 필요한 정보로
  `CHANNEL_KNOWLEDGE`를 선언하므로, 채널 자체에 대한 목표만 여기로 라우팅된다.
- LLM-first planning invariant는 그대로다. planner가 계획을 세울 수 없으면 run은 실패한다.

## 4a. 라이브 검증 기록 (2026-08-22)

세 번의 승인된 라이브 run과 그 결과. 행 단위 기록은 `docs/evidence/INDEX.md` §1.

| 무엇 | 결과 |
|---|---|
| **OAuth 재동의** | 기존 account 재사용(중복 0) · credential `OK` · **granted scope 3종 확인** — 요청이 아니라 몰이 부여한 값 |
| **PRODUCT 1회 read** | 144 listings · 이름/가격/판매상태 100% · **URL·옵션·카테고리 0** (목록 리소스 미제공) |
| **INQUIRY routine 창** | primary가 `o113` → `s2026-08-08:e2026-08-22:r1` · backfill 불변 · 0건이 정상 |
| **첫 automatic cycle** | ORDER 7 · INQUIRY 0 · REVIEW 수신1/저장0/skip1 · 재관측 proof · ERROR 0 |

**타임스탬프 계약 (V58·V59).** `observedAt` = SellerOps가 읽은 시각(모든 채널 동일).
`sourceUpdatedAt` = 채널이 말하는 최종 변경 시각, 없으면 **null**. freshness는 전자로만 판정한다.
셋이 한 컬럼이었을 때 2.1초 만에 읽은 144건이 전부 `STALE`로 보고됐다 — 상품의 나이와 읽기의 신선도를
혼동한 것이다. 기존 행 보정은 관측 시각이 **기록된 경우에만**(run이 자기 행을 만든 `created_at`) 수행했다.

**Product 귀속 계약.** 리뷰는 **카탈로그를 통해서만** 상품에 연결된다(`channel_products.external_product_id`).
resolve-or-create는 금지 — `product_no`를 SKU로 삼아 만들면 이름이 자기 번호인 상품("24", "181")이 생기고
Product Knowledge가 그것을 판매 중인 상품으로 센다. 카탈로그가 모르는 `product_no`는 **unresolved로 남긴다**;
article이 `product_no`를 보존하므로 다음 카탈로그 read가 무료로 relink한다.

## 4b. NAVER 조립 — 마켓플레이스 접촉 0회 준비 (2026-08-22)

Cafe24가 production-like routine으로 돌기 시작한 뒤 NAVER로 넘어갔다. 이 절의 작업 중
**NAVER 호출은 0회**다 — 실패가 전부 vault 안에서 끝나기 때문이다(`NaverApiConnector.fetch`의
"Fail closed before any HTTP").

### 무엇이 잘못돼 있었나

| 발견 | 실제 상태 |
|---|---|
| **51회 연속 실패가 셀러에게 보이지 않았다** | credential이 `local-dev-1`로 봉인됐고 그 키가 이 배포에 없다 → vault에서 실패 → 채널이 401을 말할 기회가 없다 → auth 분류기가 한 번도 안 걸림. 계정은 계속 `CONNECTED` |
| **연결 확인이 500이었다** | test-connection이 vault 예외를 그대로 던져, 화면에는 "일시적인 채널 응답 오류" — 재시도해도 절대 안 되는 조건 |
| **연결 완료와 첫 수집이 한 동작이었다** | credential 제출 → test → `manualSync(ORDER_SUMMARY)` 자동 연쇄. 셀러가 누른 적 없는 주문 read |
| **교체 경로가 막혀 있었다** | `replaceCredential`이 롤백용으로 옛 값을 먼저 열어야 해서, **열 수 없는 credential은 교체할 수 없었다** |
| **API 호출 IP가 비어 있었다** | `advertisedEgressIps: []` → 튜토리얼의 IP 등록 단계가 "담당자에게 문의" |

### 계약 — 첫 수집은 셀러가 푼다

`first_order_sync`는 **released 상태로 도착하지 않는다**(`syncRequested: false`, `USER_REQUIRED`).
`SYNC_START`만이 그것을 푼다. 검증된 credential은 "연결 정보가 맞다"만 증명하며, "이 판매자의 주문을
읽어도 된다"는 별개의 사실이다. 실패한 수집은 released를 유지한다(재시도는 같은 허락을 두 번 묻지
않는다); 새로고침은 의도를 복원하지 않는다.

### 계약 — 누가 고칠 수 있는가는 한 곳에서 정한다

`CredentialKeyStatus.sellerActionable()`. `KEY_UNVERIFIABLE`·`INVALID_CREDENTIAL`은 셀러가 재입력하면
해결된다(재입력이 active key로 다시 봉인한다). `NO_KEY_CONFIGURED`·`KEY_NOT_AVAILABLE`·`KEY_MISMATCH`는
**서버 문제이고, 다시 연결해도 해결되지 않는다** — 이 구분이 틀리면 셀러는 고칠 수 없는 것을 고치러
마켓플레이스에 간다. 수집 분류기, 연결 확인, 진단 패널이 모두 이 하나를 읽는다.

`CREDENTIAL_UNREADABLE`은 서버측 사유의 연결-확인 응답이다. 채널을 부르지 않았으므로 채널을 탓하지
않고, 재시도를 권하지도 않는다.

### schedule 상태 (복구 가능하게 기록)

canonical Demo Org의 **NAVER `ORDER_SUMMARY` schedule만** 임시 pause했다 — Cafe24 3종은 손대지 않았고
`enabled=t`로 계속 돈다.

| 항목 | 값 |
|---|---|
| seller account | `bdccb7a7` (데모 제조사 · NAVER · 1개, 재사용) |
| dataType / cadence | `ORDER_SUMMARY` / `INTERVAL` 60분 |
| pause 방식 | `tools/live-proof/schedule-guard.sh pause bdccb7a7-…` |
| `paused_reason` | **NULL** — 운영자 pause다 |
| restore | `schedule-guard.sh restore bdccb7a7-…` (state file은 `tools/live-proof/.run/`, gitignore) |

`paused_reason`이 NULL인 것이 중요하다. `SellerAccountReauthService.onReconnected`는
**`paused_reason != null`인 schedule만** 재개하므로, credential 재입력·연결 확인 성공이
이 schedule을 자동으로 켜지 않는다. Cafe24에서 승인 없는 read 4건을 만든 것이 바로 그 재개 경로였다.

### 남은 것 — 셀러/운영자 행위

- **NAVER credential 재입력** (client id + secret). 복구 불가: `local-dev-1`이라는 이름의 키는 링에
  있지만 이 행을 봉인한 키가 아니다(지문 대조로 확인). 마켓플레이스 접촉 없이 되돌릴 방법이 없다.
- **API 호출 IP 확인**. 개발 배포의 egress = 개발망 공인 IPv4이며 network가 바뀌면 수동 갱신이다
  (`docs/sellerops_local_to_pilot_connectivity_decision.md` §3). 값은 `backend/.env.local`의
  `SELLEROPS_CONNECTOR_NAVER_ADVERTISED_EGRESS_IPS`에만 있다 — **git·정본 문서·메모리에 기록하지 않는다.**

## 4c. NAVER 라이브 검증 (2026-08-22) — ① 연결 · ② PRODUCT · ③ 최근 14일 주문

승인된 매니페스트 1건, 세 단계, **요청 21건 · 401/403/429 0 · WARN/ERROR 0 · WRITE 0**.
행 단위 기록은 `docs/evidence/INDEX.md` §1.

### ① 연결 검증

요청 3건(verify 토큰 · probe 토큰 · 주문접근 probe GET). `RECONNECT_REQUIRED` → **`PREPARING`**.
test 단독으로는 CONNECTED가 되지 않는다 — 자격 증명이 맞다는 것과 주문이 실제로 흐른다는 것은
별개의 사실이고, 두 번째는 ③이 증명한다.

### ② PRODUCT — 목록 리소스가 실제로 돌려주는 것

69 리스팅, 2페이지, 1.6초, 오류 0.

| 필드 | 커버리지 |
|---|---|
| 채널상품번호 · 이름 · 판매가 · 통화 · 판매상태 · 최종수정일 · 카테고리 | **69/69** |
| 브랜드 · 제조사 | **44/69** |
| **상품 URL · 옵션조합 · 상세설명 · 판매자관리코드** | **0/69** |

매퍼는 네 가지를 **전부 읽는다**(`storeKeepingUrl`·`optionCombinations`·`detailContent`·
`sellerManagementCode`). 비어서 온 것이다 — 매핑 누락이 아니라 **목록 리소스의 범위**다. 커넥터
설명이 "url · option combinations"를 읽는다고 말하고 있었으므로 관측에 맞춰 고쳤다. 이걸 얻으려면
목록 페이지를 넓히는 게 아니라 **상품별 별도 read**가 필요하다.

판매자관리코드가 0건이라 SKU는 채널상품번호로 채워진다. 이 계정에서 그렇다는 관측이며 규칙이 아니다.

**Reconcile — 기존 DERIVED 47개.** 리뷰 export ingest가 만든 파생 리스팅 47개는 이름이 빈 값이었다.

- **39개가 제자리에서 승격** — 같은 `external_product_id` 행이 `DERIVED:INGEST` →
  `NAVER:PRODUCT_API:v1`이 되고 빈 이름이 실제 상품명으로 채워짐
- **사라진 행 0**
- 남은 **8개는 전부 합성**(`MLD-*` · `SKU-000*` · `SKU-SYN-*`) — 실제 NAVER 상품번호는 **전부** 매칭됐다
- 신규 리스팅 30개, 신규 상품 30개, **전원 실제 상품명**
- **기존 상품의 이름·SKU·provenance 변경 0건, 삭제 0건**

**가짜 상품 0건.** 이름이 숫자뿐인 상품은 저장소에 6건 있고 전부 오늘 14:40–14:41의 Cafe24
placeholder(170·91·94)다 — 이 run은 **한 건도 만들지 않았다.** §4a의 귀속 계약대로 리뷰는 카탈로그를
통해서만 연결되고, resolve-or-create는 여전히 금지다.

### ③ ORDER_SUMMARY — bounded 최근 창

`2026-08-09 ~ 2026-08-22`, 24시간 창 14개, 요청 16건(창 14 + 주문이 있던 두 창의 상세 조회 2), 15.3초.

- **27건 주문** — 2026-08-21 13건 170,900원 · **2026-08-22 14건 117,400원(당일)**
- 나머지 12개 창은 0건. 이 창들도 실제로 조회됐다 — 데이터가 없었을 뿐이다
- **primary cursor `2026-06-14T13:49:51.595+09:00` 불변** (`updated_at`도 2026-06-14 그대로)
- `backfill` lane에 **이번 run만** 기록: `bounds{from:2026-08-09, toExclusive:2026-08-22T21:34:52.803+09:00}`
- **기존 43일치 일별 합계는 43행 전부 바이트 동일** — 추가된 건 2행뿐이고, `updated_at`조차 변하지 않았다
- **2026-08-09 이전 날짜는 한 건도 기록되지 않았다** (emission floor)
- 계정 `PREPARING` → **`CONNECTED`** — 수집된 주문이 2-signal 게이트의 나머지 절반이다

**70일 historical recovery는 이 매니페스트에서 제외**했고, 별도 backfill 계획으로 둔다. primary
cursor가 2026-06-14에 그대로 있으므로 그 계획은 지금도 온전히 가능하다.

### 끝난 뒤의 상태

NAVER schedule **여전히 0개 enabled**(운영자 pause 유지, `paused_reason` NULL). PRODUCT schedule
미생성. Cafe24 3종은 §6a routine으로 계속 돈다.

## 4d. NAVER routine semantics 감사 (2026-08-22) — 마켓플레이스 접촉 0회

라이브 증명은 **한 번 읽는 것**을 증명했다. schedule은 **계속 읽는 것**이고, 그 둘은 같은 계약이
아니다. 이 절은 schedule을 켜기 전에 코드에서 확인한 것과, 확인 결과 고친 것을 기록한다.
schedule은 **아직 만들지 않았다**.

### 불변식

| # | 불변식 |
|---|---|
| 1 | routine = 현재/최근 운영 취득 |
| 2 | historical recovery = bounded backfill |
| 3 | routine이 historical backlog 때문에 freshness를 잃지 않는다 |
| 4 | source 상태 변경 재관측에 필요한 overlap은 유지된다 |
| 5 | primary와 backfill progress는 독립이다 |
| 6 | 기존 history는 자동으로 소급 복구되지 않는다 |

### ORDER — 발견한 것

primary cursor는 `2026-06-14T13:49:51.595+09:00`에서 멈춰 있고, 최근 14일 proof는 `backfill`
lane에서만 수행됐다(§4c). **지금 schedule을 켰다면 routine은 그 커서를 그대로 재개했다.**

측정 가능한 결과: `isCaughtUp(now)`가 거짓이므로 창은 2026-06-14에서 열리고, `hasMore`는 "now에
닿을 때까지" 참이므로 **한 번의 run이 24시간 창 69개를 연속으로 걷는다**. 그 사이 지나가는 모든
날짜에 일별 합계가 기록된다. 불변식 3과 6이 동시에 깨진다 — 오늘 들어온 주문을 보려면 10주를
먼저 지나가야 하고, 아무도 승인하지 않은 소급 복구가 부수효과로 일어난다.

### ORDER — 고친 것

`NaverOrdersClient#ROUTINE_MAX_LAG = 14일`. routine cursor의 `windowFrom`이 그보다 뒤처지면
**재개하지 않고 최근 14일 지점에서 재시작**한다(`NaverOrdersCursor#routineRestart`).

- **14일**은 이 저장소가 이미 "최근 운영 구간"으로 쓰는 값이다 — Cafe24 주문 lookback,
  Cafe24 routine board window, 그리고 §4c의 운영자 창까지 같은 값이다.
- 재시작 지점은 **KST 자정에 정렬**한다. 하루 중간에서 열린 창은 그 날짜를 일부만 세고,
  ingestion은 (channel, date)로 **덮어쓰므로** 완전한 합계가 부분 합계로 교체된다.
- 같은 시작 날짜가 **emission floor**가 된다. 2일 carry가 그 앞으로 넘어가지 못하게 한다 —
  §4c의 bounded run이 쓴 것과 정확히 같은 장치다.
- **14일 이내의 지연은 그대로 이어서 따라잡는다.** 그 연속성이 이미 수집한 주문의 상태 변화를
  다시 보는 유일한 방법이므로(불변식 4), 여기서 잘라내면 안 된다.
- backfill cursor는 **절대 재시작하지 않는다.** 운영자가 승인한 범위이고, "now보다 뒤처져 있음"이
  그 lane의 정상 상태다(불변식 5).
- 건너뛴 구간은 조용히 사라지지 않는다 — run 로그가 며칠을 건너뛰었는지 WARN으로 남기고, 복구는
  운영자의 bounded backfill로 넘긴다(불변식 2·6).

lane 구분은 추측이 아니라 커서 자체가 말한다: `bounds.toExclusive`가 있으면 backfill, 없으면
routine이다.

### PRODUCT — 발견한 것

**같은 결함이 두 채널에 있었다.** 커서는 페이지 번호이고, sweep이 끝난 뒤 돌려주는 값이
`page + 1`이었다. 런타임은 그 값을 그대로 저장한다.

| 채널 | 저장된 커서 | 카탈로그 | 결과 |
|---|---|---|---|
| NAVER | `3` | 2페이지(69 리스팅) | 다음 주기는 3페이지를 요청 → 0건 |
| CAFE24 | `144` | 144 리스팅 | 다음 주기는 offset 144를 요청 → 0건 |

즉 **한 번 읽은 상품의 가격·판매상태·상품명 변경을 다시는 관측할 수 없는 구조**였다. schedule이
없어서 드러나지 않았을 뿐이다.

### PRODUCT — 고친 것

sweep이 끝나면 커서는 **카탈로그의 시작**을 가리킨다(NAVER `1`, Cafe24 offset `0`). sweep 중간에는
그대로 전진하므로 rate-limit으로 끊긴 run은 재개한다.

전체 재관측을 고른 이유: `/external/v1/products/search`의 요청 바디는 **page와 size뿐**이다. NAVER가
문서에 기간 필터를 두고 있지만 이 커넥터는 보내지 않았고 관측한 적도 없다 — 관측하지 않은 필터를
"changed-since 계약"이라 부르는 것이 바로 이 저장소가 금지하는 종류의 주장이다. 69 리스팅 2페이지는
매 주기 전부 다시 읽어도 요청 2건이다. `ProductKnowledgeWriter`는 (channel, external id)로 해석해
upsert하므로 재읽기는 idempotent다.

### 테스트로 고정한 것

| 계약 | 테스트 |
|---|---|
| ORDER schedule이 2026-06 primary history를 재개하지 않음 | `NaverOrdersClientTest#aRoutineCursorTenWeeksBehindRestartsAtTheRecentHorizonInsteadOfWalkingHistory` |
| 14일 이내 지연은 이어서 따라잡음 (overlap 유지) | `…#aRoutineCursorInsideTheRecencyHorizonIsResumedContiguouslyNotRestarted` |
| 재시작이 자기 시작일 이전 날짜를 쓰지 않음 | `…#aRestartedRoutineCursorWritesNoDailyTotalBeforeItsOwnStartDate` |
| 운영자 bounded 창은 절대 재시작되지 않음 | `…#anOperatorsBoundedWindowIsNeverRestartedNoMatterHowFarBackItReaches` |
| 재시작된 routine이 고정 종료점을 얻지 않음 | `…#aRestartedRoutineCursorKeepsWalkingToNowAndNeverStopsAtAFixedEnd` |
| PRODUCT sweep 종료가 1페이지로 되돌아감 | `NaverProductsClientTest#aFinishedSweepRestartsAtPageOneSoTheNextCycleReObservesTheCatalogue` |
| 끝을 지나 멈춘 커서가 스스로 회복 | `…#aCursorLeftPastTheEndOfTheCatalogueHealsInsteadOfStayingBlind` |
| 목록에 없는 필드는 없는 채로 도착 (URL·옵션·상세·판매자코드) | `…#fieldsTheListResourceDoesNotSendArriveAbsentRatherThanInvented` |
| Cafe24도 같은 계약 | `Cafe24ApiConnectorTest#aFinishedCatalogueSweepResetsTheOffsetSoTheNextCycleReObservesIt` |
| 2주기가 기존 리스팅을 제자리 갱신 | `ProductRecurrenceContractTest#aSecondCycleUpdatesTheSameListingRatherThanCreatingAnother` |
| **합성 DERIVED 8개가 operational truth로 승격되지 않음** | `…#aListingAbsentFromTheReadKeepsItsOwnProvenance` |
| REAL provenance 유지 | `…#reObservationKeepsDataOrigin` |
| **WRITE 0 — 도달 가능한 NAVER 엔드포인트 전부가 read** | `NaverReadOnlyFenceTest` (3개) |

`NaverReadOnlyFenceTest`는 "POST 금지"가 아니라 **엔드포인트 목록 자체**를 잠근다. 토큰 발급과 주문
상세 조회는 둘 다 POST이고 둘 다 read이므로 "POST 금지"는 틀린 울타리다. Agent 쪽
`OperatorToolRegistry`의 WRITE-tool 부재와 대칭이다.

### schedule을 켤 수 있는가

**켤 수 있다.** 다만 아직 만들지 않았다 — 생성은 별도 결정이다.

| lane | 권장 주기 | 주기당 요청 | 첫 run의 예외 |
|---|---|---|---|
| ORDER_SUMMARY | **60분** (Cafe24 3종과 동일) | 창 1개 + 상세 배치 | 재시작으로 15개 창 ≈ 20–30초, 1회뿐 |
| PRODUCT | **1440분(1일)** | 2건 (2페이지) | 커서 `3` 자해 회복에 빈 페이지 1건 |

주기 하한은 15분(`CollectControlService#MIN_INTERVAL_MINUTES`), 상한은 없다. 빈 run은 `SUCCESS`로
기록되므로 조용한 시간대가 실패 streak를 만들지 않는다. NAVER pacer는 요청 간 최소 1초를 유지한다.

## 4f. NAVER routine schedule 최초 활성화 (2026-08-22) — 첫 cycle이 찾아낸 것

§4d는 코드를 읽고 고쳤다. 이 절은 **실제로 켰을 때 무슨 일이 일어났는지**를 기록한다. 일어난 일의
절반은 계획대로였고, 나머지 절반은 아무도 몰랐던 결함이었다.

### 활성화

| lane | 주기 | 상태 |
|---|---|---|
| NAVER ORDER_SUMMARY | 60분 | enabled |
| NAVER PRODUCT | 1440분 | enabled |
| Cafe24 3종 | 60분 | **손대지 않음** |
| NAVER REVIEW / INQUIRY | — | **만들지 않음** |

근거는 §6a Self-Pilot Runtime v1의 **standing READ grant**다(2026-08-18 product-owner 결정) — 라이브
승인 계약의 단일 사용 manifest는 사람이 앉아 있는 guided run을 위한 것이고, 소유 org의 routine READ
schedule은 그 결정이 이미 연 경로다. Cafe24 3종이 그 아래에서 돌고 있었다.

### ORDER 첫 automatic cycle — 계획대로 된 부분

```
23:01:55 WARN 네이버 주문 routine 커서가 69일 뒤처져 최근 14일 구간에서 재시작합니다.
              그 이전 구간은 자동 복구하지 않으며 별도 backfill 대상입니다.
```

- stale primary(`2026-06-14`)를 **재개하지 않았다**. horizon `2026-08-08`에서 시작
- 커서에 `bounds{from:"2026-08-08", toExclusive:null}` — floor는 있고 끝은 없다(routine의 모양)
- **2026-06-14 ~ 2026-08-07 구간 일별 합계 기록 0건** — 자동 소급 복구 없음
- `backfill` lane(`from:2026-08-09`) **완전히 불변** — lane 독립 확인
- 실제로 들어온 것: 2026-08-22가 14건 → **19건 / 124,400원**, `channel_orders` 27 → 32.
  21:35 이후 실제로 발생한 주문 5건이다

### ORDER 첫 automatic cycle — 계획대로 되지 않은 부분

**run이 끝나지 않았다.** 5분 21초 동안 초당 1건씩 약 **320회**의 라이브 요청을 냈고, 멈추지 않았다면
executor의 10,000 페이지 가드까지 갔을 것이다. 관측 즉시 schedule을 끄고 백엔드를 정지시켰다.

원인은 한 줄로 말할 수 있다 — **커서가 적을 수 없는 정밀도로 시간을 비교하고 있었다.**

| | |
|---|---|
| 커서 wire format | `yyyy-MM-dd'T'HH:mm:ss.SSSXXX` — 밀리초 **3자리**(NAVER 주문 조회의 요구 형식) |
| 프로덕션 시계 | `Clock.systemUTC()` — 이 JVM에서 **마이크로초** |
| 결과 | 커서에 들어간 instant는 잘려서 나오고, 잘린 값은 자기가 만들어진 `now`보다 **영원히 이전**이다 |
| `isCaughtUp` | 정확히 그 두 값을 비교한다 ⇒ 절대 참이 되지 않음 ⇒ `hasMore` 절대 거짓이 되지 않음 |

**새 결함이 아니다.** 이 org의 마지막 "성공한" NAVER 주문 수집 — 2026-06-14 — 은
**13분 30초 동안 돌고 0행을 반환한 뒤 `SUCCESS`로 기록**됐다. 같은 spin이다. 보이지 않았던 이유는
그 뒤 51회의 credential 실패가 routine을 69일 뒤에 묶어 뒀기 때문이다. 69일 뒤처진 커서는 `now`에
가까워질 일이 없고, 가까워지지 않으면 마이크로초 나머지는 아무 일도 하지 않는다.
**routine에 최근 horizon을 준 것이 그것을 도착하게 만들었다.**

파일의 43개 테스트가 전부 놓친 이유도 하나다: **모든 테스트 시계가 정확한 밀리초였다.** 정확한
밀리초는 왕복해도 값이 변하지 않는다.

### 고친 것 (`7d9203e2`)

시계를 **커서가 표현할 수 있는 해상도로 읽는다**(`NaverOrdersCursor#atWireResolution`, 한 곳). 허용
오차가 아니라 같은 값끼리의 비교로 만든 것이다. 회귀 울타리는 **프로덕션이 실제로 가진 마이크로초
정밀도의 시계**를 쓰는 테스트 2개이고, 둘 다 수정 전 코드에서 **실패함을 확인**했다.

### 재활성화 후 — 증명

| 확인 | 결과 |
|---|---|
| ORDER cycle이 **종료**하는가 | **1.12초 SUCCESS** (이전: 무한) |
| PRODUCT 첫 cycle | stale cursor `3` → 빈 페이지 1건 → **`1`로 자가 복구**, 0.15초 |
| PRODUCT **다음 cycle이 기존 catalog를 재관측**하는가 | **69 리스팅 전부**, 1.4초, 실패 0 |
| REAL listing 중복 | **0** — 재관측 후 listing 77행 **바이트 동일** |
| **합성 DERIVED 8개 승격** | **없음** — `DERIVED:INGEST` 그대로(REAL 5 · DEMO_SEED 3) |
| product 행 | 252 **바이트 동일**, 생성·삭제 0 |
| REAL provenance | 유지 |
| **WRITE** | **0** — 도달 가능한 NAVER 엔드포인트 4개가 전부 read이고 테스트로 잠겨 있다 |
| `next_run_at` | ORDER `2026-08-23 00:13`(+60분) · PRODUCT `2026-08-23 23:14`(+1440분) |
| Cafe24 | 3종 전부 불변(60분, `paused_reason` NULL) |

schedule 2개는 **enabled 상태로 계속 돈다.**

### 후속 운영 hardening (별도 항목, 이번 작업에서 하지 않음)

결함은 사라졌지만 **그것을 run 기록만 보고 알아차릴 방법은 여전히 없다.** 2026-06-14의 13분 30초·0행
run이 `SUCCESS`로 남은 이유가 그거다 — `sync_jobs`에는 행 수만 있고, 그 행들을 얻는 데 몇 번의 라이브
요청이 들었는지는 어디에도 없다. 다음 두 가지를 후속 항목으로 둔다.

1. **run 계측** — `sync_jobs`에 `request_count` · `page_count` · `duration` · `termination_reason`
   (`CAUGHT_UP` / `PAGE_GUARD` / `RATE_LIMITED` / `ERROR` / `BUDGET_EXHAUSTED`). 종료 이유가 기록되면
   "정상 종료"와 "가드에 걸려 멈춤"이 같은 `SUCCESS`로 보이지 않는다.
2. **bounded request budget** — run당 라이브 요청 상한을 커넥터/데이터타입이 스스로 계산해 걸고
   (예: ORDER routine은 `lag ÷ 24h + 여유`), 초과하면 `BUDGET_EXHAUSTED`로 **멈춘다**. 지금의
   `MAX_PAGES = 10,000`은 커넥터와 무관한 값이라 라이브 마켓플레이스 호출의 상한으로는 너무 크다.

이번 REVIEW refresh를 이것 때문에 지연시키지 않는다(2026-08-22 결정).

## 4e. NAVER REVIEW refresh 준비 (2026-08-22) — 마켓플레이스 접촉 0회

**공식 API를 새로 만들지 않는다.** NAVER는 판매자용 리뷰 API를 제공하지 않고(`naver-cap-review-no-api`),
기존 경로는 이미 라이브 증명돼 있다 — `NAVER / REVIEW = EXPORT · LIVE_PROVEN · SELLER_REPEATED`
(`AcquisitionPathRegistry`, 2026-07-25/26 라이브 증명:
`docs/action-window-runtime/naver-initial-review-import-live-proof-record.md`).

### baseline (2026-08-22 측정)

| | |
|---|---|
| NAVER REAL 리뷰 | **3,858건** (2025-06-17 ~ **2026-07-15**) |
| NAVER DEMO_SEED | 22건 (기본 read에서 제외됨) |
| `review_import_plan` | **0건** — 이 배포에는 계획이 없다. refresh는 첫 계획을 만드는 것부터다 |

### 회귀 — 마켓플레이스 접촉 없이 확인한 것

| 확인 | 결과 |
|---|---|
| 실행 중인 백엔드에서 기간 미리보기 | `GET /api/imports/reviews/plans/range-preview` — 시작월 `2026-07` → `2026-07-01 ~ 2026-08-22`, **세그먼트 2**; `2026-08` → 세그먼트 1 |
| collector 오프라인 스위트 | **9,150 통과 / 150 skip** (import 스테이지 머신·scope gate·ingest handoff·locate·guidance 포함) |
| frontend | **2,236 통과** (`GuidedImportCard`, `ReviewImportPage`, `useGuidedImport`, `importRuntime` 포함) |
| backend | **2,653 통과 / 22 skip** (`reviewimport` 패키지 전체 포함) |
| 계정 상태 | NAVER `bdccb7a7` = **CONNECTED**, 가이드형 채널 목록(`GUIDED_CHANNEL_CODES`)에 포함 |
| 파서 계약 | `.xlsx`/`.csv`, dedup 키는 NAVER의 **`리뷰글번호`** → `external_id`. 구간이 겹쳐도 중복 저장되지 않는다 |

즉 **코드 쪽에서 막힌 것은 없다.** 남은 것은 전부 셀러의 화면 행위다.

### 셀러가 실제로 해야 하는 것 — 최소 단계

전제(운영자): 로컬 helper를 **포그라운드로** 띄운다(페어링은 TTY를 요구한다) — `NAVER_REVIEW_URL`
설정 필요, `import/naver` carrier.

1. SellerOps **리뷰 → 과거 리뷰 가져오기**(`/connect/review-history`)에서 **시작 월 `2026-07`** 선택.
   → 화면이 `2026-07-01 ~ 2026-08-22`, **2회 내보내기**라고 알려준다. 이것이 SellerOps 안에서 하는
   **유일한 결정**이다.
2. 카드의 CTA를 누르면 판매자 센터 리뷰 관리 창이 열린다. 거기서 셀러가 **직접**:
   시작일 → 종료일 → 조회 → **엑셀 내보내기** → NAVER의 **확인**.
   SellerOps는 강조하고 관찰만 한다 — 클릭·입력·전송 0.
3. 조회를 누른 뒤 SellerOps가 **화면에서 날짜를 되읽어** 요구 구간과 대조한다. 어긋나면
   `SCOPE_BLOCKED` — 내보내기 컨트롤을 아예 찾지 않는다. 셀러가 날짜를 고치면 다시 확인한다.
4. 다운로드가 감지되면 검증(OOXML magic-byte) 후 자동 ingest되고, 창 안의 패널이 **다음 달**을
   제안한다. 2번 반복하면 끝난다.

**시작 월을 `2026-07`로 잡는 이유**: 저장된 최신 리뷰가 2026-07-15이므로 7월은 절반만 들어와 있다.
7월을 다시 가져와도 `리뷰글번호` dedup이 중복을 막는다 — 겹치게 잡는 쪽이 안전하다.

### 이 경로가 바꾸지 않는 것

- 리뷰 `reply_state`는 여전히 **UNKNOWN**이다. 내보내기 파일이 답변 여부를 담지 않기 때문이며,
  "답변 안 함"이 아니라 "알 수 없음"이다(`naver-status-review-reply-unknown`).
- NAVER INQUIRY는 **UNSUPPORTED** 유지.
- 리뷰는 자동 수집 주기 대상이 아니다 — `SELLER_REPEATED`이고, 셀러가 실행할 때만 들어온다.

## 4g. NAVER REVIEW refresh 라이브 실행 (2026-08-23) — 데이터는 들어왔고, 경로는 아직 완주 못 한다

§4e가 준비한 것을 실제로 돌렸다. **데이터는 전부 들어왔다. 그러나 가이드형 취득은 스스로 완주하지
못했고, 사람이 API로 밀어 넣어서 끝냈다.** 그 둘을 섞어서 기록하면 다음 refresh가 같은 자리에서
멈춘다.

### 들어온 것 (사실)

| | before | after |
|---|---|---|
| NAVER REAL 리뷰 | 3,858 | **4,340** (+482) |
| 최신 리뷰 날짜 | 2026-07-15 | **2026-08-22** |
| DEMO_SEED | 22 | 22 (불변) |

| 구간 | 신규 / 중복 / 실패 | 상태 |
|---|---|---|
| `2026-07-01 ~ 2026-07-31` | **295 / 55 / 0** | `COMPLETED` · `COVERED` 350행 |
| `2026-08-01 ~ 2026-08-22` | **187 / 11 / 0** | `COMPLETED` · `COVERED` 198행 |
| **합계** | **482 / 66 / 0** | 계획 `COMPLETED` |

- **중복 0** — `리뷰글번호`(external_id) 기준 0건, content hash 기준 0건. 겹치는 구간(7월 파일이
  08-01까지 포함)이 있었지만 dedup이 흡수했다
- **product attribution 100%** — 537/537이 상품에 연결됐고 미연결 0건, 상품 23종. **신규 상품 생성 0**
  (252행 불변) — 리뷰가 상품을 만들어내지 않았다
- **REAL provenance 유지**
- **CustomerMemory +482**, ReviewIssues 19건 갱신(newly raised 0), issue evidence 2건이 새 리뷰에서
- **ReviewOps `upToDate: true`** — `lastCoveredDate 2026-08-22`, `missingRanges []`,
  `issueMemoryReady: true`, new 482 / dup 66 / failed 0 (독립 집계와 정확히 일치)

### reply_state — 채널 지식이 틀려 있었다

새로 들어온 537건이 **PENDING 499 · ANSWERED 38**로 실제 답변 상태를 가진다. 내보내기 파일에
**`답글여부`·`답글등록일시` 컬럼이 있고** 매퍼가 읽고 있다. 이전 3,803건만 `UNKNOWN`이다.

`naver-status-review-reply-unknown`이 "내보내기 파일에는 답변 여부가 담기지 않는다"고 단언하고 있었다.
현재 export에는 담긴다. 관측에 맞춰 고쳤다(`LIVE_OBSERVATION` · 2026-08-23). **UNKNOWN은 여전히
"미답변"이 아니다** — 그 3,803건은 답변 여부를 말해주지 않는 소스에서 왔을 뿐이다.

### ⚠️ NAVER Review acquisition은 **COMPLETE가 아니다**

482건이 들어왔다는 것과 **경로가 반복 가능하다**는 것은 다른 주장이다. 이번 실행에서 가이드형 흐름은
셀러를 끝까지 데려가지 못했고, 마지막 두 단계는 파일을 손으로 찾아 API로 ingest해서 메웠다. 아래 두
결함이 살아 있는 한 §4.1의 REVIEW 행은 움직이지 않는다.

#### 결함 1 — guided flow가 scope MATCH 이후 진행되지 않는다

```
00:07:31  aw_import_scope_verdict {"match":"MATCH","datesParsed":2,"spanDiffers":false}
(이후 아무 이벤트도 없음)
```

계약상 다음은 `LOCATE_EXPORT → HIGHLIGHT_EXPORT → WAIT_FOR_EXPORT → …CONSENT → DETECT_DOWNLOAD`다.
실제로는 **패널이 사라졌고**(셀러 관측: "구간 설정 완료하니까 사라졌어") run은 조용히 멈췄다.

치명적인 부분은 그 다음이다. 다운로드는 **consent 단계에서 무장되는 race**가 잡고,
`detectDownload()`는 그 race가 없으면 **fail closed**로 "못 봤다"를 반환하며 **두 번째 리스너를 절대
새로 걸지 않는다**(의도된 설계 — 두 리스너는 서로 모순되는 답을 낸다). 그래서:

- 안내가 끊긴 자리에서 셀러는 스스로 엑셀 내보내기를 눌렀고
- **에이전트 자신의 Chrome이 파일을 정상 수신했는데도**(Playwright 임시 디렉터리에서 3개 확인)
- 런타임은 듣고 있지 않았으므로 구조적으로 감지 불가였다
- run은 실패로 표시되지도 않았다 — **silent PENDING**

즉 **안내가 끊기는 순간 그 run은 조용히 완주 불가 상태가 된다.**

#### 결함 2 — manual fallback이 실제 NAVER export 파일을 다루지 못한다

NAVER는 `Content-Disposition`에 파일명을 주지 않아 다운로드가 **확장자 없는 UUID**로 저장된다
(`f532f7b3-55e9-4f02-94db-78a4a78c3f2e`, 39KB, 내용은 정상 OOXML XLSX).

| 지점 | 결과 |
|---|---|
| `SegmentImportPanel`의 `accept=".xlsx,.csv"` | 파일 선택창에서 **고를 수조차 없다** |
| `FileParser.parse` | 파일명 확장자로만 분기 ⇒ **거절** |
| 자동 경로 | 런타임이 매직바이트로 검증하고 **자기 파일명을 붙여** 올리므로 통과 |

**두 경로가 서로 다른 파일 판별 계약을 쓰고 있다.** 그래서 "자동이 실패하면 수동으로"가 성립하지
않는다 — 자동이 실패한 바로 그 파일을 수동은 받지 못한다.

### 후속: NAVER Review Acquisition Completion Hardening

위 **결함 2개만** 하나의 작은 패키지로 고친다(2026-08-23 결정). 그 회귀가 green이면 그때
"다음 refresh도 반복 가능"으로 판정하고 NAVER Demo Spine을 닫는다.

**섞지 않는다** — UI 발견성(`/connect/review-history` 진입점이 문장 속 ghost 링크), 화면 복잡도,
월 단위 segmentation 최적화(한 번에 되는 크기면 한 구간)는 **Connection/Acquisition UX Polish
backlog**로 분리한다. 그것들은 불편이고, 위 둘은 완주 불가다.

## 4h. NAVER Review Acquisition Completion Hardening (2026-08-23) — 마켓플레이스 접촉 0회

§4g가 기록한 **completion blocker 2개만** 고친다. UI 발견성·화면 복잡도·월 단위 segmentation은 섞지
않았다(그 셋은 Connection/Acquisition UX Polish backlog).

### A. guided flow가 완주하거나, 못 한다고 말한다

**찾은 것은 두 층이었다.**

1. `onDriveError`가 분류하지 못한 driver fault를 **조용한 teardown**으로 처리했다 — 패널을 내리고,
   `RUN_FAILED`도 emit하지 않고, stage는 있던 자리에 그대로. 그게 silent PENDING의 정체다.
2. 설령 실패를 emit했더라도 **패널에는 아무것도 안 뜬다**. `guidancePanelStateFrom`이 COMPLETED가
   아닌 모든 terminal 상태를 `null`로 투영하고 있었다. 즉 실패는 **셀러가 보고 있지 않은 창**
   (SellerOps 카드)에만 알려졌다.

| 고친 것 | |
|---|---|
| `RUNTIME_FAULT` blocker code | terminal이고 recoverable park이 **아니다** — 원인을 모르는데 복구법을 지어내지 않는다 |
| `ImportSegmentEngine#runtimeFault()` | 세션이 명시적으로 실패시킨다. `RUN_BLOCKED` + `RUN_FAILED` |
| `onDriveError` | teardown 대신 **fail → publish → 패널 다시 그림 → 하이라이트만 제거**. 패널은 남는다 |
| `failurePanelFrom` | FAILED도 패널을 투영한다. 런타임은 여전히 **한 문장도 짓지 않는다** — 프론트가 이름 붙이지 않은 blocker는 chrome의 `blockedLabel`만 남고 설명은 비워 둔다 |

**download listener를 export barrier에서 무장한다.** 감지는 브라우저 download 이벤트와의 race이므로
그것을 발생시킬 클릭보다 **먼저 존재해야 한다.** consent barrier에서 시작하던 것을 한 단계 앞으로
옮겼다(`armDownloadDetection`, idempotent — race 두 개는 서로 다른 답을 내고 하나만 이벤트를 잡는다).
이제 셀러가 안내보다 앞서가도 파일은 잡힌다.

### B. 확장자 없는 NAVER export

파일명을 **믿지 않는다**. `UploadFormat`이 바이트로 판정하고, **자동 경로와 수동 경로가 같은 계약을
공유**한다(둘 다 백엔드 `FileParser`를 지난다 — 자동 경로가 자기 파일명을 붙여 통과하던 것이 drift의
정체였다).

| 판정 | 조건 |
|---|---|
| `XLSX` | ZIP local header **그리고** OOXML `[Content_Types].xml` 마커 |
| `CSV` | 엄격한 UTF-8 디코딩 + 비어 있지 않은 첫 줄 + 그 줄에 구분자 |
| `UNKNOWN` | 그 외 전부 — JPEG·PDF·일반 ZIP·빈 파일·산문 |

**느슨한 우회가 아니다.** 파일은 둘 중 하나임을 적극적으로 증명해야 하고, `accept=".xlsx,.csv"`가
사라진 자리를 바이트 검증이 대신한다(확장자보다 강한 검사다). 읽을 수 없는 파일은 **기록된 FAILED
attempt**가 된다 — 400 토스트로 흔적 없이 사라지지 않는다(`UnsupportedUploadFormatException`).
"읽지 못했다"가 "아무것도 없었다"로 읽히지 않아야 한다는 기존 불변식 그대로다.

fixture는 **합성**이다. 실제 export의 헤더 행(컬럼명은 개인정보가 아니다)에 지어낸 셀을 넣어
테스트가 워크북을 직접 만든다 — 저장소에 고객 리뷰 원문은 한 바이트도 들어가지 않는다.

### 회귀

| | |
|---|---|
| collector | **9,159** 통과 / 150 skip |
| backend | **2,679** 통과 / 22 skip |
| frontend | **2,237** 통과 |
| 새 fence가 수정 전 코드에서 실패함 | **확인** — A는 5개, B는 파서 계약 전체 |

## 4i. NAVER Demo Spine — 종료 판정 (2026-08-23)

**현재 계약 기준 COMPLETE로 닫는다** (product-owner 결정, 2026-08-23).

| 축 | 상태 |
|---|---|
| 연결 | `CONNECTED` — credential이 active key로 봉인, 호출 IP·주문 권한 확인 (§4c ①) |
| PRODUCT | 69 리스팅 라이브, 필드 범위 관측 완료, **routine 1440분 running** (§4c ② · §4f) |
| ORDER_SUMMARY | 최근 창 라이브, **routine 60분 running**, restart/floor/lane 독립 전부 테스트로 고정 (§4c ③ · §4d · §4f) |
| REVIEW | REAL **4,340** / 최신 **2026-08-22**, 2구간 COVERED, attribution 100% (§4g) |
| INQUIRY | **UNSUPPORTED 유지** — 계약 변경 없음 |

### 열려 있는 단 하나 — regression checkpoint, blocker 아님

§4g의 completion blocker 2개는 §4h에서 고쳐졌고 회귀는 green이다. 다만 **수정 후 guided path를
마켓플레이스에 대고 다시 돌린 적은 없다** — 데모 org의 계획이 이미 `COMPLETED`라 오늘 돌릴 구간이
없기 때문이다.

> **REVIEW guided acquisition post-fix marketplace re-proof = 다음 실제 refresh(2026-09 구간)에서
> 수행하는 regression checkpoint.** 현재 blocker가 **아니다**. Spine 종료를 막지 않으며, 새 작업을
> 열지도 않는다. 9월 구간을 가져올 때 그 실행이 곧 재증명이고, 그때 확인할 것은 §4h가 고친 두 계약뿐이다
> — 패널이 export/consent 단계까지 유지되는가, download가 감지되어 자동 ingest까지 가는가.

### NAVER에서 추가 개발하지 않는다 (backlog 유지)

2026-08-23 결정. 아래 넷은 **기록만 유지**하고 착수하지 않는다.

| # | 항목 | 어디에 기록돼 있나 |
|---|---|---|
| 1 | **70일 ORDER historical backfill** | §4d — primary cursor가 2026-06-14에 온전하므로 bounded lane으로 언제든 가능 |
| 2 | **Product enrichment** (URL·옵션·상세) | §4c ② — NAVER·Cafe24 **양쪽** 목록 리소스가 담지 않음. Coupang 연결 후 cross-channel 패키지 |
| 3 | **REVIEW segmentation UX** (한 번에 되는 크기면 한 구간) | §4g — 셀러 행동 횟수 문제이지 완주 문제가 아니다 |
| 4 | **connection UI polish / 발견성** | §4g — `/connect/review-history` 진입점이 문장 속 ghost 링크 |

3·4는 **Connection/Acquisition UX Polish backlog**다. 셋 다 불편이지, 경로가 막히는 문제가 아니다 —
그 구분이 §4h가 무엇만 고쳤는지를 설명한다.

## 5. 다음 — Coupang

이 문서가 기록하는 작업에서 **마켓플레이스 접촉은** 라이브 증명 구간(§4c·§4f·§4g)을 빼면 **0회**였다.

**끝난 것** (2026-08-22 ~ 08-23):

1. ~~Cafe24 read 1회 + `mall.read_product` 재동의~~ — 완료 (§4a).
2. ~~NAVER credential 재입력~~ — 완료. 연결 → PRODUCT → 최근 14일 주문 라이브 증명 (§4c).
3. ~~NAVER routine schedule~~ — ORDER 60분 · PRODUCT 1440분 running (§4f).
4. ~~NAVER REVIEW refresh~~ — REAL 4,340 / 최신 2026-08-22 (§4g), completion hardening 완료 (§4h).

**남은 것** — 셀러/운영자의 행위가 필요하다:

1. **Coupang 최초 연결** — credential 행이 없다. 발급 walk는 라이브 증명됨(2026-08-12).
   3채널 canonical Demo Org의 마지막 칸이고, **지금의 목표다**.

Coupang이 붙기 전에는 12칸 전부가 "canonical Demo Org에서 현재 연결로 fresh proof"를 갖지 못한다.
그것이 이 문서가 어떤 capability 상태도 옮기지 않는 이유다.
