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

## 5. Coupang 최초 연결

3채널 canonical Demo Org의 마지막 칸이다. **끝난 것** (2026-08-22 ~ 08-23): Cafe24 read 1회 +
`mall.read_product` 재동의(§4a) · NAVER credential 재입력 → 연결 → PRODUCT → 최근 14일 주문(§4c) ·
NAVER routine schedule ORDER 60분 / PRODUCT 1440분 running(§4f) · NAVER REVIEW REAL 4,340 / 최신
2026-08-22(§4g) + completion hardening(§4h). **남은 것은 Coupang 하나**이고, 그것은 셀러의 행위를
요구한다.

### 5a. offline 감사 (2026-08-23) — 마켓플레이스 접촉 **0회**

기존 baseline에서 이어 감사했다. Coupang 최초 연결·주문 routine은 이미 라이브 증명돼 있다
(2026-08-06, `docs/coupang_final_main_first_connection_order_routine_proof_v1.md`) — **단
disposable DB에서다.** canonical Demo Org에서는 아직 한 번도 없었다.

**출발 상태 (실측).** Demo Org `7146c50f…`:

| 사실 | 값 |
|---|---|
| Coupang seller account | `3e2ddaaa…` · **PENDING** · 2026-08-16 생성 |
| `connector_credentials` | **행 없음** |
| REAL 데이터 | **0** — `channel_products` 3 · `order_daily_summaries` 14 · `reviews` 22 · `inquiries` 8+3 은 전부 `DEMO_SEED`/`VERIFY_FIXTURE` |
| Coupang sync_schedules | **없음** (NAVER 2 · Cafe24 3만 running) |

**1 · guided connection / tutorial regression.** 전부 green — backend `*Coupang*`+`*CredentialHandoff*`,
collector 42 files / 1,526, FE 11 files / 169. 전체 회귀도 green (collector 9,164 · FE 2,246).

**2 · account 생성/재사용 semantics.** `SellerAccountService.registerApiChannel`은 **find-or-create**다.
채널 행을 `SELECT … FOR UPDATE`로 먼저 잠가 두 탭/재시도가 직렬화되고, partial unique index
`uq_seller_accounts_api_org_channel (org_id, channel_id) WHERE is_file_upload = false`가 fail-closed
backstop이다. 정착된 CONNECTED / RECONNECT_REQUIRED를 PENDING으로 되돌리지 않는다. ⇒ **새 계정을 만들지
않고 기존 `3e2ddaaa…`를 재사용한다.**

**3 · credential 입력과 첫 collection의 분리.** 분리돼 있다. `CollectControlService.storeCredential`은
vault 저장만 하고 test도 sync도 부르지 않는다. 첫 수집은 셀러가 따로 누른다 —
`coupangTutorial.ts`의 reducer가 `SUBMIT_OK → preparing`에서 멈추고 주석이 그대로 말한다:
`NO auto-sync: the seller starts it explicitly (step 4)`. **단 저장과 연결 확인은 한 번의 press다** —
5c 참조.

**4 · 고정 egress IP · API 권한 · credential diagnosis.** `/api/connect/coupang/setup` 실측:
`advertisedEgressIps` **1개 광고 중** · `connectorEnabled: true` · `approvalArmed: false` ·
`credentialHandoff.armed: false`. `…/credential-diagnosis` 실측: `status: NO_CREDENTIAL` ·
`activeKeyId: self-pilot-1` — 지금 저장하면 **활성 키로 봉인되어 fingerprint가 일치**한다
(§2의 vault key diagnosis 계약).

**5 · 연결 후 가능한 취득 경로.**

| DataType | 경로 | 상태 | 연결 후 |
|---|---|---|---|
| ORDER_SUMMARY | API v5 `ordersheets` 일자 페이징 | `CONFIRMED` · 라이브 2026-08-06 | **첫 수집이 연결을 완성한다** (PREPARING → CONNECTED) |
| INQUIRY | API v5 `onlineInquiries` (상품별). PII를 담은 `callCenterInquiries`는 **호출하지 않음** | `CONFIRMED` · 라이브 2026-08-14 | routine 가능 |
| PRODUCT | API seller-products list + detail | **`NEEDS_VERIFICATION`** — wire shape 미관측 | 구현돼 있으나 미검증. self-pilot이 자동 스케줄하지 **않는다** |
| REVIEW | 공식 API **없음**. Action Window (seller-owned WING READ_ONLY) | `LIVE_PROVEN` 2026-08-15 | 셀러가 직접 실행. 스케줄 대상 아님 |

운영 화면의 capability overview에 PRODUCT가 없는 것은 결함이 아니다 — `OVERVIEW_DATA_TYPES`는 운영
3종(주문·리뷰·문의)이고 NAVER도 같다. PRODUCT는 배경 지식이지 셀러 워크플로 화면이 아니다.

> **연결이 완성되는 순간 routine이 저절로 열린다.** 이 배포는 `SELLEROPS_SELF_PILOT_SCOPE=LOCAL_SINGLE_USER`
> — 이 DB의 **모든 org**가 대상이다. `SelfPilotReconciler`는 5분마다 돌며, CONNECTED이고 전용 커넥터가
>붙는 계정에 REVIEW/INQUIRY/ORDER_SUMMARY 중 커넥터가 지원하는 타입의 schedule을 **없을 때만** 만들고,
> 만든 schedule은 **즉시 due**다. 따라서 첫 주문 수집이 끝나 CONNECTED가 되면 5분 안에 Coupang
> **ORDER_SUMMARY + INQUIRY 60분 schedule이 자동 생성되어 곧바로 돈다**(REVIEW는 커넥터 미지원이라
> 제외). 설계대로이고 NAVER·Cafe24도 이렇게 열렸다 — 그러나 **첫 연결 전에 알고 있어야 하는 사실**이지
> 끝난 뒤에 발견할 사실이 아니다. 원치 않으면 CONNECTED 직후 해당 schedule을 끄면 되고, 꺼 둔 행은
> reconciler가 다시 켜지 않는다.

**6 · synthetic 제외.** 실측으로 확인했다 — Coupang 계정의 리뷰 화면은 `total: 0`을 반환한다.
같은 시점 테이블에는 `DEMO_SEED` 22건이 그대로 있다. `realDataOnly` Hibernate 필터가 auto-enable이고
가시성은 `sellerops.seed.demo-content`(기본 `false`, 이 배포에서 미설정) 하나에 묶여 있다. **쓰는 스위치와
숨기는 스위치가 같다.**

### 5b. 발견한 결함 — 텍스트 fallback 체크리스트가 반박된 계획 그대로였다

`COUPANG_ISSUANCE_TUTORIAL`(`frontend/src/lib/guidedConnection/tutorial.ts`)은 셀러가 **guided 안내가
불가능해지는 순간 자동으로 떨어지는** 화면이다(로컬 에이전트 없음 · 텍스트 전환 · 안내 종료 후).
같은 발급을 두 번 설명하는데, 두 번째 설명이 라이브로 반박된 계획을 그대로 들고 있었다:

1. **`자체개발`을 세 번째 단계로** 놓았다. 그 자리의 화면은 `사용 목적`이고 `OPEN API`(기본값)와
   `플레이오토 웹 솔루션`뿐 — 자체개발이 없다. 진짜 컨트롤은 다섯 화면 뒤 `업체 입력 방식`의
   `자체개발(직접입력)`이다.
2. **업체명 / URL / 호출 IP를 발급 전에** 요구했다. 그 입력란들은 `자체개발(직접입력)`을 고른 뒤에야
   나타난다 — 약관 동의보다 뒤다.
3. **`발급`을 키가 만들어지는 press로** 부르고 바로 다음 단계에서 키를 복사하라고 했다. `발급`은 사용
   목적 화면을 열 뿐이고, `약관 동의 및 Key 발급받기`는 업체 입력 화면을 열 뿐이며(라이브 2회에서 눌러
   키가 나오지 않았다), 키는 그 화면의 `확인`이 만든다. **셀러는 아직 존재하지 않는 키를 복사하라는
   말을 듣고 있었다.**

**왜 여기만 남았는가.** Action Window copy는 cross-stack parity 테스트가 런타임 문자열에 문자 단위로
고정하고 있어서 다섯 번의 라이브 측정이 전부 도달했다. 이 체크리스트는 **아무것도 고정하지 않았다** —
Coupang 체크리스트를 검증하는 테스트가 저장소에 하나도 없었다.

**수정.** 체크리스트를 측정된 순서로 다시 썼고(발급 → 사용 목적 → 약관 2건 → 약관 동의 및 Key
발급받기 → 업체 입력 방식 → 업체명·URL·IP(`추가`까지) → `확인`(키 발급) → 복사), `ConnectCoupang`의
step 1 문구도 같은 사실로 고쳤다. 그리고 **다시 어긋날 수 없게 고정**했다:

- `tutorial.test.ts` — 순서·주장 9건(자체개발이 vendor 화면 앞에서 지시되지 않을 것, `발급`과 `약관
  동의 및 Key 발급받기`가 키 생성을 주장하지 않을 것, 키 생성 press가 복사보다 앞일 것, 호출 IP 단계가
  `추가`를 요구할 것 …).
- `coupang-issuance-fe-copy-parity.test.ts` — **체크리스트의 화면 순서를 런타임의 측정된
  `coupangIssuanceStepPlan()`에 고정**한다. 이제 런타임이 교정되면 체크리스트가 따라오지 않는 한
  빌드가 깨진다. 수정 전 파일로 되돌려 실제로 실패하는 것을 확인했다(2 failed).

갱신 대상이 아닌 것: 재발급(`COUPANG_RENEWAL_TUTORIAL`)은 다른 흐름이고 반박된 주장을 담고 있지 않다.

### 5c. 셀러가 WING에서 해야 할 최소 행동

SellerOps는 이 구간에서 **아무것도 누르지 않는다.** 발급 런타임은 구조적으로 클릭·입력·값 읽기가
불가능하다(`coupang-issuance-guard.test.ts`가 소스 수준에서 강제).

1. 쿠팡 윙 › 판매자정보 › **오픈API 키 발급**으로 이동.
2. **`API Key 발급 받기`** — 사용 목적 화면이 열린다. *키는 아직 없다.*
3. 사용 목적이 **`OPEN API`**(기본값)인지 확인 → **`확인`** — 약관 화면이 열린다. *키는 아직 없다.*
4. **약관 2건을 직접 읽고 동의.** SellerOps는 읽지도 대신 동의하지도 않는다.
5. **`약관 동의 및 Key 발급받기`** — 업체 입력 화면이 열린다. *여기까지 취소하면 계정에 남는 것이 없다.*
6. **`업체 입력 방식` → `자체개발(직접입력)`** 선택 → URL · IP 입력란이 나타난다.
7. 업체명 · URL 입력, **`IP 주소`에 SellerOps 고정 IP를 넣고 옆의 `추가`까지 누른다.** 누르지 않으면
   등록되지 않고 첫 수집이 호출 IP 오류로 실패한다. IP 값은 SellerOps 화면이 그 자리에 표시한다.
8. **`확인`** — ⚠ **여기서 실제 API 키가 발급되어 라이브 계정 상태가 바뀐다.** 되돌리려면 별도의 삭제
   작업이 필요하다. 이 press는 반드시 판매자 본인이 한다.
9. 화면의 **업체코드 · Access Key · Secret Key**를 SellerOps로 가져온다. Secret Key는 이때 한 번만
   표시된다.

### 5d. Coupang read-only live proof manifest (준비)

**상태: 준비됨 — 실행은 셀러 행위 대기.** 저장 뒤 마켓플레이스 호출을 자동으로 돌리지 않는다.

| 필드 | 값 |
|---|---|
| channel | `COUPANG` |
| org / account | canonical Demo Org · 기존 `3e2ddaaa…` **재사용** (새로 만들지 않음) |
| surface | 제품 UI `/connect/coupang` (CLI 하네스 아님) |
| operation | 최초 연결 — credential 저장 → 연결 확인 → 첫 `ORDER_SUMMARY` 수집 |
| mode | **`READ_ONLY`** |
| SellerOps의 라이브 액션 | 서명된 GET만: 연결 확인 1회(`returnShippingCenters` → `ordersheets` fallback), 첫 수집 1회. **WRITE 0.** |
| 백엔드 interlock | `CoupangLiveCallGuard.ensureLiveReadAllowed` — **standing READ grant로 이미 열려 있다**(`SELLEROPS_SELF_PILOT_READ_GRANT_ID`, 계약 §6a). per-run `…_LIVE_APPROVAL_ID`는 **필요 없고 무장돼 있지도 않다** — WRITE gate는 standing grant를 절대 받지 않으므로 write는 여전히 닫혀 있다. |
| 셀러의 라이브 액션 | WING 키 발급 1회 (5c의 8번). SellerOps가 아니라 셀러가, 자기 브라우저에서. |
| 되돌릴 수 없는 것 | 발급된 API 키 1개. 삭제하려면 별도 walk(`coupang_wing_key_deletion_live_v1.md`). |
| 확인할 것 | credential 저장 · vault fingerprint == `self-pilot-1` · account binding · PENDING → PREPARING → CONNECTED · 첫 수집 rows/중복 0 · REAL provenance · secret/PII/provider-body 유출 0 |
| 자동으로 뒤따르는 것 | CONNECTED 5분 내 self-pilot이 **ORDER_SUMMARY + INQUIRY 60분 schedule을 자동 생성**한다 (5a §5의 경고). 원치 않으면 그 자리에서 끈다. |

#### 제품 소유자 결정 (2026-08-23)

5a와 5c가 제기한 두 지점은 결정됐다. **이 결정 때문에 코드를 바꾸지 않는다** — 둘 다 이미 그렇게
동작하고 있고, 바뀐 것은 그것을 결함으로 볼지 정상으로 볼지다.

1. **CONNECTED 후 routine schedule 자동 생성을 허용한다.** 첫 실제 수집으로 CONNECTED가 되면
   ORDER_SUMMARY / INQUIRY 60분 schedule이 self-pilot에 의해 자동 생성되는 것을 **§6a standing READ
   grant의 정상 production-like 동작**으로 취급한다. 다만 **첫 automatic cycle은 반드시 로그·DB로
   관찰한다** — 이상한 DataType만 fail-closed로 pause하고 정상 schedule은 유지한다.
2. **저장 직후의 read-only GET 1회를 허용한다.** credential 저장에 이어지는 인증 확인 + 주문 조회
   권한 확인은 허용한다. **store-only 경로를 새로 만들지 않는다.** 첫 실제 collection은 계속
   **별도의 사용자 action**으로 유지한다.

#### 검증 순서 (credential 입력 직후, 첫 수집 **전**)

credential 값 자체는 로그·보고 어디에도 출력하지 않는다. 확인하는 것은 여섯 가지다 —
기존 account `3e2ddaaa…` 재사용 · credential sealed/open 진단 · vendor/account binding ·
auth verification 결과 · order-access permission 결과 · duplicate account 0. 여기까지 끝나면
이 manifest를 갱신하고 **멈춘다.**

#### 다음 live proof의 범위

canonical Demo Org의 **REAL** 데이터로 **PRODUCT · ORDER_SUMMARY · INQUIRY**를 검증한다. REVIEW는
공식 API가 없으므로 기존 Action Window acquisition을 **별도 단계**로 유지한다. 이번 목표는 Coupang
Demo Spine 조립이며, Product enrichment / 다른 채널 polishing / historical backfill로 넓히지 않는다.

### 5e. credential 검증 결과 (2026-08-23 02:08 KST) — **통과**, 첫 수집 전 정지

셀러가 WING에서 키를 발급하고 입력했다. 검증만 하고 **멈췄다** — 첫 collection은 실행하지 않았다.

| # | 확인 항목 | 결과 |
|---|---|---|
| 1 | 기존 account `3e2ddaaa…` 재사용 | ✅ Coupang 계정 수 **1** · 새 행 0 |
| 2 | duplicate account | ✅ **0** |
| 3 | credential sealed/open 진단 | ✅ `OK` · keyId `self-pilot-1` == activeKeyId · sealed fingerprint == available |
| 4 | vendor / account binding | ✅ credential 1행이 이 계정에만 · `API`/`HMAC` · payload+IV 존재 |
| 5 | auth verification | ✅ **SUCCESS** — `PENDING → PREPARING` (02:08:05) |
| 6 | order-access permission | ✅ **CONFIRMED** — `ordersheets` 200 |
| — | 부수효과 | sync_jobs **0** · schedules **0** · alerts **0** · `channel_orders` **0** · Coupang 행은 전부 `DEMO_SEED`/`VERIFY_FIXTURE` 그대로 |

**probe 형태는 2026-08-06 증명과 동일하다.** `returnShippingCenters` **400 CLIENT_ERROR** →
`ordersheets` fallback **200 CONFIRMED**. 그 엔드포인트는 이 vendor에게 맞지 않고, 권위 있는 답은
우리가 실제로 쓰는 `ordersheets`가 준다 — 커넥터가 400을 "auth 판정 없음"으로 두고 보조 probe로
넘기는 설계가 그대로 작동했다.

#### 도달 과정에서 드러난 것 셋

**① SellerOps는 자기가 광고하는 호출 IP를 실제 송신 IP와 대조하지 않는다.** `.env.local`의 값이
낡아 있었고 — 실제 송신 대역과 **다른 /8** 이었다 — 화면은 그 값을 그대로 안내했다. 셀러는 **동작할
수 없는 IP를 등록**했다. NAVER 쪽 값도 낡았고 Coupang 것과도 다른 값이다(이 머신의 공인 IP가 최소
두 번 바뀌었다는 뜻). NAVER가 살아 있는 것은 호출 IP 허용목록을 같은 방식으로 강제하지 않기 때문이지
설정이 맞아서가 아니다. 설정만 고쳤고 **제품 코드는 손대지 않았다** — 자기가 주장하는 사실을 검증할
수 있는데 하지 않는다는 결함은 남아 있다.

**② 쿠팡의 IP 거부 403이 `not allowed ip` 마커를 담지 않았다.** 분류기는 공식 영문 문자열을
대소문자 무시로 찾는데 **두 번 다 안 잡혔다**. 설계된 hedge가 작동해 두 원인을 모두 안내하는
`ORDER_ACCESS_DENIED`로 degrade했지만, 그 문장은 **"애플리케이션의 주문 API 그룹 권한"을 먼저**
말한다 — NAVER 어휘이고(`CollectControlService`의 채널 공용 문구), 측정된 WING 발급 흐름에는 API
그룹을 고르는 화면이 없다. 셀러를 엉뚱한 화면으로 보낸다.

**③ 등록이 즉시 반영되지 않는 것으로 보인다.** 셀러가 IP를 고쳤다고 알린 **뒤**의 02:03 시도는
403/403이었고, 4분 뒤 02:08 시도는 400/200이었다. 그 사이 SellerOps 쪽에서 바뀐 것은 **없다** —
백엔드 프로세스 동일(pid 58991), credential 행 동일(id·bytes·`updated_at` 01:51:15 불변). 남은
설명은 WING 쪽 반영 지연이다. **관측 1회·계정 1곳이므로 단정하지 않는다** — 다음 연결 때 다시 본다.

①②③ 모두 **채널 지식 후보**이고, 이번 범위에서는 기록만 한다.

#### manifest 상태 갱신

| 필드 | 값 |
|---|---|
| mode | `READ_ONLY` — 유지 |
| 실행된 SellerOps 라이브 액션 | 서명된 GET **4회** (연결 확인 2회 실패 + 1회 성공, 각 최대 2 엔드포인트). **WRITE 0** |
| 남은 액션 | 첫 `ORDER_SUMMARY` 수집 **1회** — 아직 실행 안 함 |
| 계정 상태 | `PREPARING` (두 신호 중 하나 확보) |
| 다음 단계에서 관찰할 것 | 첫 수집 rows / 중복 0 / REAL provenance / `PREPARING → CONNECTED` / 그리고 **CONNECTED 5분 내 self-pilot이 만드는 첫 automatic cycle** (5d 결정 1) |

### 5f. 첫 ORDER_SUMMARY 수집 + 첫 automatic cycle (2026-08-23 02:15~02:19 KST) — **전부 PASS**

승인: manifest + `Seated and ready.` · mode `READ_ONLY` · 첫 수집 1회.

#### 첫 수집 (MANUAL)

run `1d6850c2` — **SUCCESS · 50 / 50 / 0 / 0** · 8.0초.

| 신호 | 값 |
|---|---|
| `connection_status` | **`PREPARING → CONNECTED`** (02:15:32) — 두 신호 계약 완성 |
| `channel_orders` | **50 · distinct external id 50 → 중복 0** |
| 주문 날짜 범위 | 2026-08-16 … **2026-08-22** (최신 주문 = 어제) |
| `order_daily_summaries` | **REAL 7일 / 50건** — 기존 `DEMO_SEED` 14일(2026-05-31…06-13)과 분리 유지 |
| cursor | `primary {"initialized":true,"throughDate":"2026-08-23"}` — 2026-08-06 증명과 동형 |

#### self-pilot의 자동 schedule 생성

CONNECTED **2분 44초 뒤** (02:18:16) `ORDER_SUMMARY` · `INQUIRY` **60분**, `enabled`, `next_run_at` =
생성 시각(즉시 due). **`REVIEW`는 만들지 않았다** — 커넥터가 지원하지 않으므로 Action Window로 남는다.
5d 결정 1이 예고한 그대로다.

#### 첫 automatic cycle (02:19:02, SCHEDULED)

| data type | 결과 | 읽는 법 |
|---|---|---|
| `INQUIRY` | **SUCCESS · 2 / 2 / 0 / 0** | 이 org Coupang 문의의 **최초 실수집**. 초기 backfill이 한 cycle에 완주 — cursor `{"backfillComplete":true,"earliestSwept":"2026-07-24","throughDate":"2026-08-23"}`. 폭주 없음 |
| `ORDER_SUMMARY` | **SUCCESS · 8 seen / 0 insert / 8 skip / 0 fail** | **멱등 재수집.** cursor가 증분 창으로 묶었고 8건 전부 `external_order_id`로 중복 제거. 주문 수 **50 불변** |

`next_run_at` 양쪽 **03:19:02** (+60분), `paused_reason` 없음. **pause한 DataType은 없다** — 이상한
것이 없었다.

#### 검증 항목

- **REAL provenance** ✅ 신규 주문 7일·문의 2건 전부 `REAL`. synthetic 행은 승격되지 않았다.
- **inserted / updated / skipped** ✅ 위 표. 재수집 insert 0 / skip 8, 중복 0.
- **최신 주문 날짜** ✅ 2026-08-22.
- **401 / 403 / 429 / WARN / ERROR** ✅ **0건** — 첫 수집 구간과 automatic cycle 구간 양쪽 모두.
- **synthetic exclusion** ✅ 두 방향으로 실측. 주문 화면이 보고한 쿠팡 매출이 **REAL 전용 합계와 정확히
  일치**(₩1,044,550). 문의 화면의 쿠팡 항목은 **0건인데, 제외되지 않았다면 큐에 올랐을 synthetic
  `UNANSWERED` 행이 5건 존재한다** — 제외 테스트가 공허하지 않다는 증거.
- **`next_run_at`** ✅ +60분 정상.
- **WRITE 0** ✅ 승인 id 미무장(standing grant는 WRITE gate를 열지 않음) · 오늘자 `inquiry_execution` /
  `review_reply_submission_ref` 신규 행 **0**.
- **downstream** ✅ 새 문의 2건을 `ItemAnalysis`와 `CustomerMemoryIndexer`가 각각 인덱싱했다.

**request 수는 확인하지 못했다.** sync run에 `request_count` / `page_count` / `termination_reason`이
없기 때문이며, 이것은 §4f에서 이미 기록한 운영 hardening 백로그 항목이다. 대신 관측 가능한 대리
지표만 남긴다 — 8.0s / 2.4s / 1.9s, 429 **0건**, 페이지네이션은 이 창에서 소진되지 않음. **없는 계측을
있는 것처럼 보고하지 않는다.**

#### 판정 — Demo Spine은 **닫지 않는다**

Coupang은 canonical Demo Org에서 처음으로 **REAL 데이터를 갖게 됐다**(주문 50 · 문의 2). 그러나
남은 것이 둘이다: **PRODUCT one-shot live proof**(현재 `NEEDS_VERIFICATION`, wire shape 미관측),
그다음 **REVIEW Action Window acquisition**(공식 API 없음). 그 둘이 끝나기 전에는 COMPLETE가 아니다.

backlog 유지, 이번 흐름에서 확장하지 않음: **광고 IP drift 자가검증**(§5e ①) · **Coupang 오류 문구가
NAVER 어휘를 쓰는 문제**(§5e ②) · sync run 요청 계측(§4f).


### 5g. Coupang **PRODUCT** read-only live proof manifest (준비) — 마켓플레이스 호출 **전 정지**

**상태: 준비됨. 실행하지 않았다.** 아래는 전부 코드·DB에서 확인한 사실이며, 이 절을 쓰는 동안
Coupang에 나간 요청은 **0회**다.

| 필드 | 값 |
|---|---|
| channel | `COUPANG` (`346a8e09…`, `supports_product = t`) |
| org / account | canonical Demo Org · 기존 `3e2ddaaa…` **재사용** (새 account 만들지 않음) |
| DataType | **`PRODUCT` 하나.** ORDER_SUMMARY / INQUIRY / REVIEW는 이 run에서 호출하지 않는다 |
| operation | 카탈로그 1회 읽기 (`POST /api/seller-accounts/{id}/sync {"dataType":"PRODUCT"}`, trigger `MANUAL`) |
| mode | **`READ_ONLY`** |
| SellerOps의 라이브 액션 | **서명된 GET만.** 목록 `GET …/marketplace/seller-products?vendorId&maxPerPage=10[&nextToken]`, 상세 `GET …/seller-products/{sellerProductId}` |
| WRITE | **0 — 구조적으로.** `CoupangSellerProductsClient`에는 GET 외의 메서드가 없고, per-run `…_LIVE_APPROVAL_ID`는 무장돼 있지 않으며 WRITE gate는 standing grant를 절대 받지 않는다 |
| 백엔드 interlock | `CoupangLiveCallGuard.ensureLiveReadAllowed` — 주문·문의와 **같은 choke point**, standing READ grant(§6a)로 이미 열려 있다 |
| 기존 schedule | ORDER_SUMMARY / INQUIRY 60분 routine은 **계속 running**. 이 proof는 건드리지 않는다 |
| PRODUCT schedule | **만들지 않는다 — 코드가 이미 그렇다.** `SelfPilotReconciler.ROUTINE_TYPES = (REVIEW, INQUIRY, ORDER_SUMMARY)`; PRODUCT는 없으므로 CONNECTED 상태여도 자동 생성되지 않는다. recurrence semantics는 이 proof 뒤에 정한다 |
| 되돌릴 수 없는 것 | 없음. 읽기뿐이고, 재실행은 멱등이다 |

#### 요청 볼륨 — 이 proof의 **유일한 실질 위험**

한 상품마다 **상세 호출이 1회** 붙는다(목록은 identity·상태만 주고, 옵션 축 —
`vendorItemId` · 옵션명 · 옵션가 · 셀러 SKU — 은 상세에만 있다). 따라서 카탈로그 N개에 대해

> 요청 수 ≈ **⌈N/10⌉ (목록) + N (상세)**

이고, 상품 수 상한은 **없다**(`MAX_PAGES = 10,000`은 페이지 한도이지 상품 한도가 아니다). 429는
페이지 단위로 잡혀 커서를 그대로 두고 멈춘다. **카탈로그 크기를 지금은 모른다** — 그것이 이 proof가
측정하려는 값 중 하나이므로, 실행 전에 알 방법이 없다.

#### 측정 대상 — 요청하신 항목과 **현재 코드가 실제로 볼 수 있는 것**

| 요청 항목 | 코드가 읽는가 | 저장 위치 | 이번 proof로 측정 가능? |
|---|---|---|---|
| 실제 product/listing 수 | — | `channel_products` | ✅ |
| `sellerProductId` | ✅ 목록 | `channel_products.external_product_id` | ✅ |
| `vendorItemId` (옵션ID) | ✅ 상세 `items[]` | `product_variants.external_variant_id` | ✅ |
| `productId` (노출상품ID) | ❌ 읽지 않음 | — | ❌ |
| 상품명 | ✅ `sellerProductName` | `channel_products.channel_product_name` | ✅ |
| 판매가 | ✅ `items[].salePrice` | `channel_price` · `product_variants.price` | ✅ |
| 판매상태 | ✅ `statusName` | `selling_status` (**정규화 후**) | ⚠ 원문 토큰은 저장되지 않는다 |
| option / variant | ✅ `items[].itemName` | `product_variants.option_name` | ✅ |
| seller SKU | ✅ `items[].externalVendorSku` | `product_variants.sku` · `products.sku` | ✅ |
| category | ✅ `displayCategoryCode` (**코드만, 이름 아님**) | fact `taxonomy:category` | ✅ |
| brand | ✅ | fact `taxonomy:brand` | ✅ |
| manufacturer | ❌ "이 리소스에 없음"이라고 **단정** | — | ❌ |
| description / contents | ❌ "별도 리소스"라고 **단정** | — | ❌ |
| structured attributes / specs | ✅ `items[].attributes[]` | fact `spec:*` | ✅ |
| URL 제공 여부 | ❌ "seller API가 제공하지 않음"이라고 **단정** | — | ❌ |
| 채널이 말하는 최종수정시각 | ❌ `null` 고정 | — | ❌ |

**"매퍼가 읽는 필드가 아니라 실제 응답의 채움 비율"은 현재 코드로 절반만 답할 수 있다.** 위 표의
❌ 다섯 줄은 매퍼가 필드를 아예 만들지 않으므로 DB에도 로그에도 흔적이 남지 않는다. 그리고 그중
셋(manufacturer · description · URL)은 **한 번도 실물 응답과 대조된 적 없는 부정 단정** —
§5b에서 텍스트 체크리스트를 틀리게 만든 것과 정확히 같은 종류의 주장이다.

> **열려 있는 결정 하나.** 이 proof의 핵심이 wire shape 최초 관측이라면, 응답 본문의 **키 이름과
> 키별 채움 개수만**(값은 절대 아님) 1회 기록하는 관측자가 필요하다. 사니타이즈 규칙과 헬퍼는 이미
> 있다 — `CoupangResponseDiagnostics`("object KEY-NAME sets … Object keys are API schema, not data")의
> `fieldNames`/`shapeDiagnostic`을 성공 응답에도 쓰는, 플래그로 감싼 10줄 남짓. 키 이름은 플랫폼
> 지식이지 셀러 데이터가 아니다. **승인 없이 넣지 않았다.** 넣지 않고 실행해도 proof는 성립하며,
> 그 경우 위 ❌ 다섯 줄은 "측정하지 못했다"로 남는다.

#### 사전 측정한 baseline (2026-08-23, DB)

| | 값 |
|---|---|
| Coupang `channel_products` | **3 — 전부 `DEMO_SEED` · `DERIVED:INGEST`** (외부 id는 시드 패턴 7자, 비숫자) |
| org 전체 `product_variants` | **0** (채널 불문) |
| `COUPANG:%` source를 가진 `product_facts` | **0** |
| Coupang REAL 문의 | 2건 → **REAL product 2개** 생성됨, `sku` = 11자리 숫자 = `sellerProductId` |
| `reviews.source_option_id`가 채워진 행 | **org 전체 0** (Coupang REAL 리뷰는 애초에 0) |

#### provenance 계약 — 무엇이 보장되고, 무엇이 보장되지 않는가

- **REAL로 임의 승격 없음.** writer는 기존 행의 `data_origin`을 **건드리지 않는다**. 게다가 기존
  Coupang 3건의 외부 id는 시드 패턴이라 실제 `sellerProductId`(숫자)와 **충돌할 수 없다** → 3건은
  `DEMO_SEED`로 그대로 남을 것으로 예측한다.
- **역방향 위험도 같이 본다.** 만약 REAL 리스팅이 `DEMO_SEED` product에 붙으면 writer는 승격하지
  않으므로 **실제 데이터가 기본 조회에서 가려진다**. 예측은 "발생하지 않음"이고, 확인 대상이다.
- **placeholder 생성 없음.** `sellerProductId`가 없는 행은 `continue`로 건너뛴다. 상세 호출이 실패한
  상품은 identity만으로 기록되고 옵션 축은 그냥 비어 있다 — 합성하지 않는다.
- **`product_variants` / `product_facts`에는 `data_origin` 컬럼이 아예 없다.** 이 둘의 provenance는
  `source = 'COUPANG:SELLER_PRODUCTS:v1'` + `observed_at`이 전부이고, `realDataOnly` 필터는 이 두
  테이블에 걸리지 않는다. 사실이므로 적어 둔다.
- `observed_at`은 **읽은 시각**, `source_updated_at`은 채널이 말하지 않으므로 `null`. 후자를 전자로
  대체하지 않는다.

#### 정당한 reconciliation과, 예측되는 identity 분열

문의로 만들어진 REAL product 2개의 `sku`는 `sellerProductId`다. 카탈로그 행의 `sku`는
**첫 옵션의 `externalVendorSku`가 있으면 그것**, 없으면 `sellerProductId`다. 따라서

- `externalVendorSku`가 **없다** → 카탈로그 sku = `sellerProductId` → **기존 REAL product에 붙는다.**
  실제 외부 식별자가 일치하는 정당한 reconciliation이다.
- `externalVendorSku`가 **있다** → 새 product가 생기고, 문의가 붙어 있는 product는 따로 남는다 →
  **한 리스팅이 두 product로 갈라진다.**

두 번째가 이 proof에서 드러날 수 있는 실제 결함이다. **미리 고치지 않는다** — 어느 쪽인지 모르는
상태에서 고치는 것은 §5b가 경고한 그 행동이다. 측정하고, 그 결과로 결정한다.

#### order ↔ product — 지금은 **연결할 정보가 없다** (PRODUCT proof로도 안 생긴다)

양쪽이 다 비어 있다: `channel_orders`에는 상품 컬럼이 **하나도 없고**(product_id · sku ·
vendorItemId 전부 부재), Coupang 주문 매퍼의 `OrderItem` 레코드는 `orderPrice` **하나만** 읽는다.
이미 수집된 주문 50건의 원문은 남아 있지 않으므로 소급 연결도 불가능하다. 이 proof는 조인의
**상품 쪽 절반**(`vendorItemId` → `product_variants`)만 실재하게 만든다. 나머지 절반은 별도
결정이며 **이번 범위가 아니다.**

#### live read 성공 후 — 추가 마켓플레이스 호출 **0회**로 검증할 것

1. `channel_products`: 건수 · `data_origin` · `source_kind` · `observed_at`/`first_seen_at`/`last_seen_at`
2. `product_variants`: 건수 · `vendorItemId` 유일성 · 옵션명/SKU/가격 채움 비율
3. `product_facts`: 네임스페이스별(`taxonomy:*` · `spec:*` · `desc:*`) 건수 · `source` · `confidence`
4. `products`: 신규 생성 vs 재사용 · `data_origin` · 문의 product 2개가 리스팅을 얻었는지
5. 기존 `DEMO_SEED` 3건이 **그대로 3건 DEMO_SEED**인지 (승격 0)
6. 문의 linkage: Coupang REAL 문의 2건의 `product_id`가 이번에 만들어진 product 집합 안에 있는지
7. `GET /api/products/{id}/knowledge` — facet별 coverage(IDENTITY · LISTING · PRICE · VARIANT ·
   TAXONOMY · DESCRIPTION · SPEC · SIGNALS), `/facts`, `/signals`
8. Agent `get_product_knowledge` · `get_product_signals` 가시성 (읽기 전용 도구)
9. synthetic exclusion이 여전히 유효한지 (기본 조회에 DEMO_SEED 리스팅이 안 나오는지)
10. WRITE 0 · 새 schedule 0 · ORDER_SUMMARY/INQUIRY schedule 무변경 · 401/403/429/WARN/ERROR

#### 정지

여기서 멈춘다. 실제 Coupang PRODUCT 호출에는 **새로운 단회 승인**이 필요하다.

### 5h. Coupang PRODUCT one-shot live proof (2026-08-23 03:00 KST) — **PASS**, split 없음

`sync_job cb71ffbb` · MANUAL · **SUCCESS 68 / 68 / 0 / 0** · 28.0초 · commit `14d29567` ·
승인 "Seated and ready." + 이 턴의 단회 승인.

| | 값 |
|---|---|
| listings / products / options | **68 / 68 / 405** (옵션 최소 1, 최대 **140**) |
| marketplace requests | **69** = 목록 1 + 상세 68. 한 페이지로 끝(`hasMore=false`) |
| budget | **69 / 250.** `BUDGET_EXHAUSTED` 미발생. 순회 완료로 커서 초기화 → 다음 순회는 다시 250에서 시작 |
| 401 / 403 / 429 / WARN / ERROR | **0** |
| WRITE | **0** — 신규 `inquiry_execution`(최신 2026-08-20) · `review_reply_submission_ref`(최신 2026-07-21) 없음 |
| PRODUCT schedule | **생성 0.** 계정의 schedule은 여전히 `ORDER_SUMMARY` · `INQUIRY` 둘뿐, 둘 다 enabled·`paused_reason` 없음 |
| REVIEW | **호출 0** |

옛 page size 10이었다면 같은 카탈로그에 목록 7 + 상세 68 = **75회**가 들었다. 페이지를 키운 것이
요청을 줄였고, 요청을 실제로 묶는 것은 페이지가 아니라 상한이다.

#### wire shape — 처음으로 실물과 대조했다

관측자는 **키 이름·노드 종류·개수만** 기록한다(값 0건, `CoupangWireShapeObserverTest`가 상품명·가격·
SKU·본문·식별자·토큰을 하나도 찾지 못함을 단언한다). 아래는 그 집계다.

**매퍼의 부정 단정 4개 중 2개가 틀렸다.**

| 단정 | 실제 응답 | 판정 |
|---|---|---|
| "manufacturer is not on this resource" | `$.data.manufacture` **present 68/68, 채움 39** (57%) | **틀렸다** |
| "description lives in a separate contents resource" | `$.data.items[].contents` **405/405**, 본문 블록 **1,196개**가 같은 상세 응답 안에 | **틀렸다** |
| "the seller API states no storefront URL" | 상품 페이지 URL 키 **없음**(`images[].cdnPath`는 이미지) | **맞다** |
| "the resource states no last-modified time" | 수정시각 키 **없음**(`createdAt`·`saleStartedAt`·`saleEndedAt`뿐) | **맞다** |

**읽지 않고 지나간 것들** — 전부 100% 채워져 있다: `productId`(노출상품ID) 68/68 ·
`sellerProductItemId` 405/405 · `itemId` 405/405 · `images` 1,751개 · `notices` 2,046개 ·
`searchTags` 842개.

**채움 비율이 낮은 것들**(매퍼가 읽는 것 중): `brand` **34/68**(50%) ·
`attributes[].attributeValueName` **1,020 / 6,570**(15.5%) — 속성 항목은 6,570개가 선언돼 있지만
값이 든 것은 1/6이다. 그래서 spec fact가 86개(38개 상품)에 그친다. 빈 속성을 사실로 적지 않은
결과이지 누락이 아니다.

#### identity — **split 없음 (green)**

예측했던 두 갈래 중 어느 쪽인지가 한 필드로 갈렸다:

> `$.data.items[].externalVendorSku` — **present 405/405, non-null 0.**
> 이 셀러는 어떤 옵션에도 자기 SKU를 넣지 않았다.

따라서 카탈로그 행의 `sku`는 전부 `sellerProductId`로 떨어졌고, 문의가 만들어 둔 product identity와
정확히 같은 키가 됐다.

- REAL 리스팅 68건 전부 `products.sku == channel_products.external_product_id` (**다른 것 0건**)
- 리스팅 68 ↔ product 68, **1:1**
- 문의로 생긴 REAL product 2개는 각각 **리스팅 1 + 옵션 1**을 얻었다 — 새 product가 생기지 않고
  기존 identity에 붙었다. **실제 외부 식별자가 일치하는 정당한 reconciliation.**
- product 총계 242 → 308 (**+66 신규, 2개 재사용**) — 68이 아니라 66인 것이 위 문장의 산술적 증거다.

**단, 이것은 이 셀러의 데이터가 그랬다는 뜻이지 결함이 없다는 뜻이 아니다.** `externalVendorSku`가
채워진 셀러에서는 §5g가 예측한 분열이 그대로 일어난다. 이번 proof는 그 조건을 **재현하지 못했을 뿐**
반증하지 못했다. blocker로 판정하지 않는 이유는 조건이 성립하지 않았기 때문이고, 조건이 성립하는
셀러가 나타나면 그때는 blocker다.

#### provenance — 임의 승격 0

- Coupang 리스팅 **71 = REAL 68 + DEMO_SEED 3.** 기존 3건은 `DEMO_SEED` · `DERIVED:INGEST` 그대로 —
  외부 id가 시드 패턴이라 숫자 `sellerProductId`와 충돌할 수 없었다(§5g 예측대로).
- `DEMO_SEED` product **8건 불변**. REAL로 올라간 행 **0**.
- 역방향도 없음: REAL 리스팅이 `DEMO_SEED` product에 붙어 가려진 경우 **0**.
- 신규 행의 provenance: `source_kind = COUPANG:SELLER_PRODUCTS:v1`, `observed_at` = 읽은 시각,
  `source_updated_at` = **null 68/68**(채널이 말하지 않으므로).
- `product_variants` / `product_facts`의 `data_origin` 부재는 **이번에 건드리지 않았다.** 운영 화면
  혼입은 관측되지 않았다 — 이 두 테이블은 product를 거쳐서만 읽히고, 그 product는 필터를 받는다.

#### Product Knowledge · Agent 가시성

facts **188** = `taxonomy` 102(브랜드 34 + 카테고리 68 — wire의 채움 수와 정확히 일치) +
`spec` 86, 전부 `SOURCE_STATED`. variants 405, `vendorItemId` **중복 0**.

문의가 붙어 있는 product의 `/api/products/{id}/knowledge`:

| facet | 판정 | provenance |
|---|---|---|
| IDENTITY · LISTING · PRICE · VARIANT · TAXONOMY | **AVAILABLE** (`statable`) | `COUPANG:SELLER_PRODUCTS:v1` |
| DESCRIPTION · SPEC | **UNAVAILABLE** | — |
| SIGNALS | AVAILABLE | customer-memory · inquiry-store · issue-memory · item-analysis · review-store |

DESCRIPTION이 `UNAVAILABLE`인 것은 **정직한 답이면서 동시에 낭비의 증거다** — 본문 1,196블록이
이미 응답에 들어왔는데 매퍼가 읽지 않아 저장되지 않았다.

Agent의 `get_product_knowledge`는 `SpringClient`에서 이 엔드포인트로 그대로 나가는 READ 도구
(`/api/products/{id}/knowledge`)다. 위 응답을 운영자 토큰으로 직접 확인했으므로 가시성은 확인됐다 —
**LLM planner를 돌려서 확인한 것은 아니다.**

#### 이번에 드러난 결함 둘 (backlog, 이번 흐름에서 고치지 않음)

1. **Coupang 판매상태가 68건 전부 `UNKNOWN`이다.** wire에는 `statusName`이 68/68 채워져 있다.
   매퍼는 그 **한글 표시명**을 `SellingStatus.normalize`에 넘기는데, 그 함수의 Coupang 항목은
   `APPROVED` / `PARTIAL_APPROVED` 같은 **영문 enum**이다. 그리고 상세 응답에는 그 enum으로 보이는
   `$.data.status`가 **68/68 존재하는데 읽히지 않는다.** 채널이 말한 사실이 저장 단계에서 통째로
   "확인되지 않음"이 됐다.
2. **가려진 product를 물으면 404가 아니라 500이 온다.** `DEMO_SEED` product의 `/knowledge`는
   `UnexpectedRollbackException`(rollback-only 트랜잭션 안에서 `notFound`를 던진 결과)으로 끝난다.
   **데이터는 새지 않는다** — synthetic 제외는 정상 동작한다. 잘못된 것은 실패 방식뿐이고, 이번
   PRODUCT 읽기가 만든 문제도 아니다.

#### 판정

PRODUCT는 **green**이고 identity split은 **없다**. Coupang Demo Spine의 남은 하나는
**REVIEW Action Window acquisition**이다. `docs/multi-channel-connector-roadmap.md` §4.1의
Coupang PRODUCT 상태 이동은 이 문서가 하지 않는다 — 상태는 §4.1이 소유한다.

---

### 5i. Coupang **REVIEW** Action Window acquisition — offline 회귀 + manifest (준비) — WING 접촉 **전 정지**

**상태: 준비됨. 실행하지 않았다.** 이 절을 쓰는 동안 Coupang(WING·API 모두)에 나간 요청은 **0회**다.
아래는 전부 코드·DB·테스트에서 확인한 사실이다.

#### 회귀 — 기존 LIVE-PROVEN 경로가 현재 코드에서 그대로 서 있는가

2026-08-15에 라이브로 증명된 취득 경로(`docs/coupang_review_acquisition_v1.md` §6.6, 22건 저장)를
현재 HEAD에서 오프라인으로 다시 돌렸다.

| 스위트 | 결과 |
|---|---|
| collector 전체 | **9,164 passed · 150 skipped · 0 failed** (378/397 파일) |
| 그중 상품평 취득 계열 6개 파일 | 165 passed · 0 failed |
| backend `AgentReviewHandoffServiceTest` · `CoupangReviewPrivacyRegressionTest` · `ReviewAcquisitionSpineTest` · dedup-key | **BUILD SUCCESSFUL** |

경로 자체는 **무결하다.** 아래에서 blocker로 판정하는 것은 이 경로의 결함이 아니라, 이 경로가
설계될 당시 **존재하지 않았던 것** — 같은 org 안의 실제 Coupang 상품 카탈로그 68개 — 과 만나면서
생기는 identity 문제다.

#### 이것은 NAVER와 **같은 기계가 아니다**

| | NAVER REVIEW | **Coupang REVIEW** |
|---|---|---|
| 취득 형태 | 마켓 화면에서 **export → 파일 다운로드 → 파싱** | **화면을 읽는다.** 파일이 없다 |
| 날짜 범위 | 필수. 지정 → 재읽기 검증(`readSelectedScope`) | **개념 자체가 없다.** 실화면 드롭다운 4개는 기간 필터가 아님이 이미 측정됐다(`docs/coupang_review_policy_gate_v1.md` §9.4) |
| 순회 | 파일 1개 | **pager. 셀러가 넘기고 SellerOps는 읽기만 한다** |
| 완주 판정 | 파일이 곧 범위 | **pager를 읽어서만.** 못 읽으면 coverage를 주장하지 않는다(`PAGER_UNRESOLVED`) |
| ingest | download detect → validate → ingest | **끝에 POST 1회** `/api/agent/review-handoff` |
| 안내 | in-page guidance panel | **operator-confirm 탭 — 페이지마다 확인 1회** |
| resident helper carrier | `import/naver` | **없다.** `RESIDENT_CARRIER_ACTIVATORS`에 상품평 취득 carrier가 없다 |
| 진입점 | 제품 화면 | **CLI 전용** — `src/cli/acquire-coupang-reviews.ts` |

⇒ 요청하신 확인 항목 중 **3(파일 scope/date 재검증)과 4의 download detection은 이 채널에 존재하지
않는다.** 없는 것을 "확인했다"고 적지 않는다. 대응물은 각각 **pager 재읽기**와 **단일 handoff POST**다.

#### 1. 셀러가 WING에서 해야 하는 최소 행동

1. 열린 창에서 **WING 로그인** (SellerOps는 이 창을 조작하지 않는다)
2. **상품평 목록 화면**을 띄운다
3. `현재 화면 확인` 누름 → SellerOps가 **그 페이지만** 읽는다
4. **직접 다음 페이지로 넘긴다** → 다시 누름 → (마지막 페이지까지 반복)
5. (선택) 저장된 상품평 1건을 화면에서 찾아 테두리 치는 locate 1회

셀러가 하지 않는 것: 내보내기·다운로드·업로드·양식 선택·기간 지정. **그런 단계가 없다.**
SellerOps가 하지 않는 것: 클릭·입력·전송·페이지 넘김·창 열린 뒤의 이동 — 선언된 marketplace action은
**0개**(`COUPANG_WING_REVIEW_ACQUISITION_SCOPE.maxActions`).

#### 2. Action Window가 안내/검증하는 범위 — 정확히 어디까지인가

| 단계 | 안내 | 검증 |
|---|---|---|
| 창 열기 | 전용 창 1개 | `screenWingUrl` — URL 화이트리스트 통과 못 하면 **브라우저를 열지 않는다** |
| 승인 | 매니페스트 표시 + **run-level 누름**(`confirmRunGrant`) | 누르지 않으면 exit 7, 아무것도 읽지 않음 |
| 페이지마다 | "읽을 목록이 보이면 눌러 주세요" + 무엇을 읽는지 7줄 | 열은 **쿠팡 자체 머리글 단어**로 해석. 해석 실패 → `PAGE_UNREADABLE`, 저장 없이 중단 |
| 구매자 열 | — | **찾아서 제외하기 위해서만 해석한다.** 와이어·canonical·DB 어디에도 작성자 자리가 없다 |
| 완주 | "마지막 페이지까지 읽으면 자동으로 끝납니다" | pager를 **읽어서** 판정. 못 읽으면 `complete=false` — 반올림 없음 |
| 저장 후 | locate 1회 제안 (건너뛰기 가능) | 5개 필드 동시 일치 · **정확히 1행일 때만** 표시 |

FE에는 **취득 진입점이 없다.** `/reviews` 계열의 Coupang 항목은 **읽기 기록 + `[쿠팡에서 보기]`
locate**만 제공한다(`frontend/src/lib/reviewRecord.ts`). 취득은 오퍼레이터가 CLI로 연다.

#### 3. pager 재읽기 (NAVER의 scope 재검증에 대응)

매 페이지 pager를 다시 읽는다. 중단 사유는 닫힌 목록이다 — `FINAL_PAGE_REACHED` ·
`OPERATOR_FINISHED` **(완주 2개)** / `PAGE_UNREADABLE` · `PAGER_UNRESOLVED` · `PAGE_DID_NOT_ADVANCE` ·
`PAGE_LIMIT_REACHED` · `REVIEW_LIMIT_REACHED` **(미완주 5개)**. 미완주는 `sync_jobs.status =
PARTIAL` + `error_message = stopReason`으로 남는다.

**v1은 첫 backfill과 재수집이 같은 일을 한다** — 정렬 순서가 라이브로 증명된 적 없어, 아는 리뷰가
나온 페이지에서 멈추면 "다 봤다"는 거짓 주장이 되기 때문이다.

#### 4. ingest contract

`POST /api/agent/review-handoff` **1회, 걷기가 끝난 뒤에.** 페이지마다 보내지 않는 이유는 실패한
걷기가 coverage 주장 없이 목록의 앞부분만 저장하는 상태를 만들기 때문이다.

와이어 행: `writtenOn` · `rating` · `body` · `textless` · `productId` · `vendorItemId` ·
`productName` · `mediaCount`. **작성자 필드는 존재하지 않는다**(unknown property는 400).
상한: 한 handoff **500건**(백엔드 `@Size`와 agent `MAX_ACQUISITION_REVIEWS`가 같은 수), 페이지 100,
페이지당 행 200, 본문 8,000자. 매핑은 **전부-아니면-전무** — 날짜 1건이 깨지면 배치 전체 거부.

#### 5. identifier topology — **이번 준비에서 나온 blocker**

Coupang은 상품 식별자를 셋 쓰고, 셋은 서로 다른 값이다.

| 식별자 | 어디서 오는가 | 지금 저장되는가 |
|---|---|---|
| **등록상품ID** `sellerProductId` (11자리) | seller-products API | ✅ `products.sku` · `channel_products.external_product_id` — REAL 68건 |
| **옵션ID** `vendorItemId` (11자리) | seller-products 상세 `items[]` | ✅ `product_variants.external_variant_id` — 405건 |
| **노출상품ID** `productId` | 상세 응답에 **68/68 존재**(§5h에서 관측) · WING 상품평 화면의 `노출상품ID (옵션ID)` 컬럼 | ❌ **어디에도 저장되지 않는다.** 매퍼가 읽지 않고, 담을 컬럼도 없다 |

그런데 **상품평 handoff는 노출상품ID를 `sku`로 보낸다**(`AgentReviewHandoffService.mapRows` →
`CanonicalReview.sku`), 그리고 `ProductService.resolveOrCreate`는 **sku가 있으면 sku로만** 찾는다
(이름 fallback은 sku가 없을 때만).

> **예측 (반증 가능):** 노출상품ID는 카탈로그가 저장한 등록상품ID와 **다른 식별자 공간**이므로
> 어떤 행도 매칭되지 않고, 수집된 상품평은 **자기 상품 행을 새로 만든다.** 노출 상품 수만큼,
> 최대 **+68 products**. 조건이 성립하지 않는 유일한 경우는 이 셀러에서 노출상품ID = 등록상품ID인
> 경우인데, 쿠팡 API가 두 키를 **같은 객체에 동시에** 싣는다는 사실이 그 가능성을 사실상 배제한다.

**즉 요청하신 6번(기존 REAL product 68개에 resolve되는가)과 7번(새 product를 만들지 않는가)은
실행 전에 이미 `FAIL`로 예측된다.** 이것은 §5h에서 PRODUCT가 통과한 바로 그 시험의 REVIEW 축이고,
그때는 `externalVendorSku`가 전부 null이라 조건이 성립하지 않았을 뿐이다.

##### 왜 "일단 수집하고 나중에 고친다"가 비싼가

`ReviewDedupKey.contentHash`에 **resolve된 product의 id가 들어간다.** 지금 수집해서 새 product에
붙인 뒤 identity를 고치면, 같은 상품평이 다른 product로 resolve되어 **해시가 바뀌고 재수집 때
두 번째 사본으로 저장된다.** `docs/coupang_review_acquisition_v1.md` 한계 7이 기록한 해시 경계
사고와 같은 종류이며, 그때와 달리 이번에는 노출 행 수가 0이 아니다.

##### 선택지 — **제품 결정 사항. 여기서 정하지 않는다**

| | 무엇을 한다 | 마켓 호출 | 스키마 | 결과 |
|---|---|---|---|---|
| **A** | 그대로 실행하고 split을 **측정한다** | 0 (리뷰 읽기 외) | 없음 | products +N. 이후 identity 수정 시 **중복 재저장 마이그레이션 필요** |
| **B** (권고) | handoff resolve를 **`product_variants.external_variant_id`(옵션ID) 우선**으로 바꾸고 sku fallback 유지 | **0** | **없음** — 405행이 이미 저장돼 있다 | 리뷰가 기존 68 product에 붙는다. 옵션ID가 비면 A로 떨어짐 |
| **C** | PRODUCT 응답의 `productId`(노출상품ID)를 저장한 뒤 그것으로 resolve | PRODUCT 재수집 1회 | 컬럼 1개 | 정공법. **§4.1이 기다리는 동일범위 재수집(멱등) 증명과 같은 호출로 처리됨** |

B의 근거는 측정된 사실이다 — 2026-08-15 라이브에서 **옵션ID가 전 행에 찍혔고**(`docs/coupang_review_acquisition_v1.md`
§74·§250), 이 계정에는 옵션 405개가 이미 저장돼 있다. 다만 **이 계정 화면에서 옵션ID coverage가
100%라는 것은 아직 확인되지 않았다**(다른 계정의 관측이다).

#### 6~7. resolve / placeholder

위 5번이 답이다. 만들어지는 행은 `data_origin = REAL`(엔티티 기본값)이고 이름은 화면의 상품명이라
**"synthetic placeholder"는 아니지만 중복 product**다. 결과로 `get_product_signals` ·
`get_product_knowledge`가 **서로 다른 두 product 행**을 가리키게 된다 — 카탈로그 쪽에는 리뷰가 0건,
리뷰 쪽에는 knowledge·옵션·facts가 0건.

#### 8. provenance

`Review.dataOrigin` 기본값 **`REAL`**. synthetic 22건(DEMO_SEED, product 3개, sku 7자리)과는 값
공간이 겹치지 않는다(실계정은 11자리). `sync_jobs`에 `method = SELLER_CENTER_READ` ·
`trigger = ACTION_WINDOW` · `job_type = AGENT_HANDOFF`로 남는다 — **파일을 받은 게 아니라 화면을
읽었다**는 정직한 출처 표기.

#### 9. 중복 처리

`external_id`가 **없다**(화면에 리뷰 번호가 없다) ⇒ 공용 ingest spine의 content hash로 떨어진다.
본문 있는 리뷰 **v2**, 별점만 리뷰 **v3**(옵션ID 포함). DB가 dedupe 권위이고 걷기는 알려진 키를
미리 싣지 않는다 — 2026-08-15 재수집이 `stored=0 / skipped=22`로 증명했다.
알려진 한계 그대로: **같은 옵션·같은 날·같은 별점의 별점만 리뷰는 병합된다.**

#### 10. downstream — **라이브에서 한 번도 돈 적 없다**

`IngestFollowUp.afterReviewIngest`가 세 가지를 순서대로 부른다: item-analysis → customer-memory
index → `ReviewSegmentIngestedEvent`(반복이슈 메모리 갱신). 전부 결정론(외부 LLM 호출 없음),
전부 best-effort.

**이 배선은 2026-08-21(`c8165291`)에 들어왔다 — 2026-08-15 라이브 취득보다 늦다.** 즉 그때 저장된
22건은 셋 중 어느 것도 받지 못했고(그것이 그 감사가 찾은 결함 B·C다), **이번이 Coupang 상품평이
downstream까지 도는 첫 라이브 사례가 된다.** Agent 쪽 가시성은 `search_review_issues` ·
`get_review_issue_trend` · `get_review_issue_evidence_summary` · `list_item_analysis` ·
`get_dashboard_product_issues` · `search_customer_memory` — 전부 READ.

#### 11. WRITE 0

마켓플레이스 WRITE는 **선언상 0이고 구조상 0**이다: 이 CLI에는 클릭·입력·전송·페이지넘김 코드가
없고, 승인 매니페스트가 `0 marketplace actions`를 명시하며, 쿠팡 API 자격증명은 이 경로에 아예
등장하지 않는다(handoff는 셀러 자신의 SellerOps 세션으로 간다). SellerOps 자기 DB로의 쓰기는
있고, 매니페스트가 그것을 숨기지 않는다.

#### NAVER에서 겪은 결함 4개 — Coupang 경로에서 재발하는가

| NAVER 결함 | Coupang | 근거 |
|---|---|---|
| 안내가 중간에 사라지는 **silent PENDING** | ⚠️ **부분적으로 열려 있다** | `main()`의 walk 블록은 `try … finally`이고 **`catch`가 없다.** reader 자체는 방어적이지만(예외 → `UNREADABLE`), 셀러가 창을 닫는 등으로 confirm 탭이 죽으면 예외가 그대로 올라가 **핸드오프 전에 프로세스가 끝나고, 읽은 상품평은 전부 사라지며, 문서화된 exit code(0/5/6/7) 어디에도 해당하지 않는다** |
| listener는 export **전에** armed | ✅ **해당 없음/충족** | 다운로드가 없다. 대응물인 reader는 첫 확인 요청 **전에** 생성된다 |
| **확장자 없는** 파일도 같은 parser 계약 | ✅ **해당 없음** | 파일이 없다 |
| terminal failure가 **보이는 상태로 남는다** | ⚠️ **위와 같은 구멍** | 정상 종료 경로는 전부 보인다(`PARTIAL` + `stopReason`, exit code, 요약 1줄). 분류되지 않은 fault만 조용하다 |

**이 구멍은 이번 흐름에서 고치지 않는다** — 범위를 넘는다. 기록해 두고, 실행 시에는 **셀러에게
"창을 닫지 마세요"를 구두로 고지**하는 것으로 대응한다.

#### 매니페스트 (실행 시)

| 필드 | 값 |
|---|---|
| phase | `COUPANG_WING_REVIEW_ACQUISITION` |
| channel / org / account | `COUPANG` · canonical Demo Org `7146c50f…` · 기존 `3e2ddaaa…` **재사용** |
| surface | Coupang WING 상품평 |
| mode | `READ_ONLY` — **marketplace action 0** |
| CLI | `src/cli/acquire-coupang-reviews.ts` |
| 계정 슬롯 | 이 준비 중 발급 완료 (24-hex, find-or-create 멱등, 마켓 접촉 0회). **값은 여기 적지 않는다** |
| 백엔드 세션 | `demo@sellerops.ai` — 로컬 로그인 200 확인 |
| 상한 | 페이지 100 · 리뷰 500 · 행/페이지 200 · 본문 8,000자 |
| 되돌릴 수 없는 것 | 저장된 상품평과 **(선택지 A일 경우) 새로 생기는 product 행** |

**실행 전 조건**: 트리가 **clean**해야 한다(`verifyRepoIdentity`가 `DIRTY_TREE`로 거부) · 환경변수
`SELLEROPS_APPROVAL_PHASE` = `SELLEROPS_WING_APPROVED_PHASE` = phase, `WALKTHROUGH_APPROVAL_ID` /
`WALKTHROUGH_RUN_ID` / `WALKTHROUGH_GIT_COMMIT`(= HEAD), `COUPANG_WING_URL`,
`SELLEROPS_REVIEW_ACCOUNT_SLOT` · 이 저장소에는 브라우저 프로필이 없으므로 **셀러가 창에서 직접
로그인**한다.

#### 정지

**여기서 멈춘다.** WING 상호작용 전에 필요한 것은 두 가지다 — (1) 위 A/B/C 중 하나에 대한
제품 결정, (2) 이 실행에 대한 단회 라이브 승인.

---

### 5j. 노출상품ID 보존 (선택지 **C**) + Coupang PRODUCT 동일범위 재수집 (2026-08-23 03:57 KST) — **재수집 PASS**, REVIEW 앞에서 정지

제품 결정: **C**. 세 식별자를 섞지 않고, 노출상품ID를 **listing 수준의 별도 alias**로 보존한 뒤
리뷰를 그것으로 **찾는다**. `products.sku = 등록상품ID` 계약은 그대로 두고,
`external_variant_id`로 resolve하는 B는 채택하지 않았다.

#### Phase 1 — 코드 (마켓플레이스 접촉 0회) · `b3fd468b` · `1ee5daa3`

| 무엇 | 어디 |
|---|---|
| 컬럼 추가 | `V60` — `channel_products.external_display_product_id` (nullable, 부분 인덱스). **identity 아님**: 리스팅 키는 여전히 `external_product_id` |
| 와이어 읽기 | `CoupangSellerProductsClient` — 상세 `$.data.productId` 우선, 목록 행 fallback. **등록상품ID로 대체하지 않는다**(둘 다 없으면 null) |
| 저장 | `ProductKnowledgeWriter` — present-overwrites / absent-preserves. 상세 호출이 실패한 주기가 이전 alias를 지우지 못한다 |
| 리뷰 resolve | `AgentReviewHandoffService` — 노출상품ID로 **listing을 찾고**, 그 listing이 속한 product의 **sku를 우리 DB에서 읽어** 스파인에 넘긴다. 클라이언트가 보낸 값은 **조회 키로만** 쓰인다 |
| product 생성 | **불가능해졌다.** 못 찾은 행은 `failed`로 세고 import는 `PARTIAL`. 조용히 버리지도, 새로 만들지도 않는다 |
| 필터 | 두 조회 모두 `RealDataOnly`를 통과한다 — `findById`는 필터를 타지 않아 리스팅 조회가 거부한 synthetic product를 id 조회가 돌려줬을 것이다 |

`CanonicalProduct`의 새 component는 **맨 뒤**에 뒀다. 컴파일러가 9개 생성 지점을 전부 다시 보게
하려는 것이고, 실제로 **5개**를 잡았다.

**offline 고정** — 요청하신 6개 전부 + 라이브가 추가로 요구한 2개:
productId 저장 · 동일 product 재관측(alias 유지·행 불변) · exact review resolution ·
wrong productId 미매칭 · DEMO_SEED 미승격 · 기존 sellerProductId/vendorItemId semantics 불변 ·
**한 노출상품ID가 두 product일 때 거부** · **같은 product의 리스팅 둘은 모호하지 않음**.
회귀: **backend 2,712 · collector 9,164 · frontend 2,246, 전부 green.**

#### Phase 2 — 동일범위 one-shot 재수집 (라이브)

run `d329ff9e` · MANUAL · **SUCCESS 68/68/0/0** · 24.7초 ·
`쿠팡 상품 수집: listed=68 mapped=68 hasMore=false requests=69 budget=69/250` ·
`product-knowledge write … rows=68 **listings=0** variants=405 facts=188`.

| 기대 | 실측 | |
|---|---|---|
| REAL listing 68 재관측 | **68** | ✅ |
| 신규 listing / product 0 | **listings=0 신규** · products REAL **300 불변** | ✅ |
| productId 68/68 저장 | **68/68** | ✅ |
| variants 405 중복 0 | **405 / distinct 405** | ✅ |
| facts idempotent | **188 불변** | ✅ |
| synthetic 불변 | DEMO_SEED 리스팅 3 · product 8 · 상품평 22 **전부 불변** | ✅ |
| cursor sweep 완료 | `PRODUCT` 커서 **null** | ✅ |
| 401/403/429/WARN/ERROR | **0** | ✅ |
| request count | **69** (목록 1 + 상세 68), `BUDGET_EXHAUSTED` 미발생 | ✅ |
| WRITE 0 · PRODUCT schedule 0 | 승인 id 미무장 · 스케줄 여전히 INQUIRY·ORDER_SUMMARY 60분 둘뿐 | ✅ |

#### 예측이 맞았다는 증거 — 그리고 예측하지 못한 것

저장된 노출상품ID는 **8~10자리**, 등록상품ID는 **11자리**다.
**`external_display_product_id = external_product_id`인 리스팅은 0건.** 즉 이 컬럼이 없었다면
수집된 상품평은 68개 중 **단 하나도** 기존 product를 찾지 못했을 것이다. 예측은 반증되지 않았다.

**예측하지 못한 것: 노출상품ID는 1:1이 아니다.**

> 리스팅 68개가 노출상품ID 68개를 갖는데 **distinct는 63**이다. 5개의 노출상품ID가 각각
> **등록상품 2개**를 앞에 두고 있고, 그 둘은 **서로 다른 product**를 가리킨다(리스팅 10개 = 14.7%).

이것이 드러낸 결함은 즉시 고쳤다 — Optional finder는 그 5건에서 `NonUniqueResultException`을
던졌을 것이고, 병합된 리스팅의 상품평 하나가 **판매자가 손으로 넘긴 모든 페이지를 500 하나로**
날렸을 것이다. 이제 List를 돌려주고, 호출자가 판정한다: **같은 product의 리스팅 둘 = 답 하나(해결),
서로 다른 product 둘 = 답할 수 없음(거부)**.

#### §4.1 판정 — **`CONFIRMED`로 올릴 수 있다**

기다리던 바 하나(동일 범위 재수집 멱등)가 충족됐다. INQUIRY가 넘었던 기준(재수집이 행을 늘리지
않음)의 PRODUCT판이며, 실측은 신규 리스팅 0 · 신규 product 0 · 옵션 405 불변 · fact 188 불변 ·
커서 완주다. **정직한 단서 하나**: 이 두 번째 주기는 새 컬럼 1개를 처음으로 채웠으므로 "바이트
단위로 아무것도 쓰지 않은" 재수집은 아니다. 바뀐 것은 **identity가 아니라 alias**이고, 행 수는
어느 테이블에서도 움직이지 않았다.

#### REVIEW 앞에서 정지 — 규칙대로

"Phase 1에서 identity가 예상과 다르면 REVIEW로 진행하지 말고 멈춰"에 해당한다. 노출상품ID가
1:1이라는 전제가 **58/63에서만** 성립한다.

지금 실행하면 그 5개 노출상품ID에 달린 상품평은 `failed`로 세어지고 import는 `PARTIAL`이 된다 —
안전하고, 조용하지 않고, 되돌릴 것도 없다. 다만 **판정은 제품 결정이다**:

| | 무엇을 | 결과 |
|---|---|---|
| **C-1** | 그대로 진행. 모호한 5건은 fail-closed | 리스팅 68개 중 58개(85%)에서 상품평이 붙는다. 나머지는 수집돼도 저장되지 않는다 |
| **C-2** | 모호할 때만 **옵션ID로 tie-break** (후보 안에서만; B의 전면 채택이 아님) | 405개 옵션ID는 전부 distinct하므로 5건이 전부 해소된다. 2026-08-15 라이브에서 옵션ID는 전 행에 찍혔다 |

C-2는 옵션ID를 **1차 키로 쓰지 않는다** — 노출상품ID가 고른 후보 2개 사이에서만 쓴다. 그래도
채택 여부는 결정 사항이라 여기서 정하지 않았다.
