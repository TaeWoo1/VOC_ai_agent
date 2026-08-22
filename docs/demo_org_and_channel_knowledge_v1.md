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

## 5. 아직 라이브 경계 너머에 있는 것

이 문서가 기록하는 작업에서 **마켓플레이스 접촉은 0회**였다. 남은 것은 전부 셀러/운영자의 행위가
필요하다 — `docs/sellerops_live_approval_contract.md`.

1. **Cafe24 read 1회** — credential이 열린다는 것은 증명됐다. refresh token이 아직 유효한지는
   실제 호출만이 답한다. (승인 필요한 마켓 액션)
2. **Cafe24 재동의** — `mall.read_product`. 이제 요청 스코프가 고쳐졌으므로 이 한 번이면 된다.
3. **NAVER credential 재입력** — 키 재료 소실. 애플리케이션 ID/시크릿을 다시 입력해야 한다.
4. **Coupang 최초 연결** — credential 행이 없다. 발급 walk는 라이브 증명됨(2026-08-12).

이 넷이 끝나기 전에는 12칸 중 어느 것도 "canonical Demo Org에서 현재 연결로 fresh proof"를 갖지
못한다. 그것이 이 문서가 어떤 capability 상태도 옮기지 않는 이유다.
