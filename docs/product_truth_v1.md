# Canonical Product Knowledge v1 · v2 — 사람이 검토하는 제품 원장

**날짜:** 2026-09-08 (v1 생성, v2 1차 검토 반영) · **상태:** `SOURCE_BUILT · REVIEW_PENDING · NOT_WIRED`
**마켓플레이스 호출 0 · WRITE 0 · 모델 호출 0 · 마이그레이션 0 · DB 행 변경 0 · `.env.local` 무수정**

이 문서는 Product Knowledge를 **코드에서 매번 역추론하는 구조**에서 **사람이 검토하고 승인하는
Canonical Product Source** 중심으로 옮기는 1단계의 기록이다. 이번 단계는 원장을 만들고 검증
가능하게 만드는 데까지이고, **Grounded Conversation은 아직 이 원장을 읽지 않는다.**

---

## 0. 왜 만드는가

Grounded Conversation QA에서 제품 사실이 세 가지 방식으로 무너졌고, 셋 다 원인이 같다 —
**답변 시점의 코드·registry·runtime env에서 제품 사실을 다시 계산했기 때문**이다.

| 관측된 잘못된 답변 | 실제 사실 | 무너진 이유 |
|---|---|---|
| 카페24 리뷰를 "가져온다는 것만 확인되고 구체 절차는 모른다" | 카페24는 세 채널 중 유일하게 **공식 API로 리뷰를 읽는다**(게시판 4, 라이브 검증 2026-07-30) | 커넥터가 꺼진 환경에서 registry가 침묵했고, 침묵이 "모른다"로 렌더됐다 |
| 쿠팡 문의가 `PARTIAL`로 후퇴 | **라이브 검증됨** (2026-08-14) | stale `NEEDS_VERIFICATION` 행 하나가 라이브 증거를 이겼다 |
| "reviewnary는 직접 전송하지 못합니다" | 카페24 문의(`VERIFIED` 2026-08-25)와 네이버 상품 문의(`LIVE_VERIFIED` 2026-08-26)는 **승인 후 직접 등록한다** | QA 환경의 실행 플래그 OFF가 **제품 사양**으로 렌더됐다 |

세 번째가 가장 크다. **배포 자세를 제품 사양으로 말하는 것**은 판매자가 제품을 도입할지 결정할 때
읽는 문장을 틀리게 만든다.

## 1. 확정된 원칙 — A 방식

**제품이 원래 지원하는 capability를 기본 제품 사양으로 설명하고, 현재 상태는 그 위에 덧붙인다.**

```
Product Capability  카페24 문의 답변은 판매자 승인 후 API로 직접 게시할 수 있습니다.
Current Runtime     다만 지금 이 환경에서는 직접 게시가 꺼져 있어 초안까지만 가능합니다.
```

QA 안전 플래그가 OFF라고 해서 제품 capability를 `PREPARE_ONLY`로 후퇴시키지 않는다.
이 규칙은 원장의 불변식 `INVARIANT.CAPABILITY_VS_STATE`로 적혀 있고, 그것을 어길 수 없게 하는
장치가 **원장이 플래그를 하나도 읽지 않는 것**이다(`ProductTruthPackTest.theLedgerNeverReadsARuntimeFlag`).

## 2. 여섯 개의 층 (v2)

| 층 | 파일 | 무엇인가 | 타입 |
|---|---|---|---|
| **CURRENT_PRODUCT_TRUTH** (채널×객체) | `product-truth/capabilities.yaml` | 채널 × 객체 × 축으로 제품이 제공하는 것 | `ProductCapability` |
| **CURRENT_PRODUCT_TRUTH** (제품 전체 기능) | `product-truth/features.yaml` | 채널을 가로지르는 제품 기능 | `ProductFeature` |
| **CURRENT_PRODUCT_TRUTH** (제품 전체 사실) | `product-truth/invariants.yaml` | 어디에서나 참인 제품 사실 | `ProductInvariant` |
| **PRODUCT_NARRATIVE** | `product-truth/narrative.yaml` | 왜 존재하고 누구를 위한 것인가 | `ProductNarrative` |
| **PRODUCT_DIRECTION** | `product-truth/direction.yaml` | 이미 결정된 제품·UX 방향. capability 주장이 **아님** | `ProductDirection` |
| **ROADMAP** | `product-truth/roadmap.yaml` | 아직 하지 않은 것. 현재 기능이 **아님** | `ProductRoadmapItem` |

### v2에서 층이 둘 늘어난 이유

**features.yaml**: `ProductCapability`는 channel과 object를 요구한다. 그래서 파일 업로드·회사 지식·
과거 답변·리포트·개선 기회·답변 말투·선제 조사는 담을 자리가 **구조적으로 없었고**, 원장에서
불변식의 `notThis` 한 줄로만 언급되고 있었다 — status도 evidence도 없이. **원장이 보지 못하는 기능은
답변이 주장할 수도, 정직하게 거절할 수도 없는 기능이다.** 특히 파일 업로드는 모든 채널이 가진 유일한
공통 취득 경로인데 v1 원장에서 `MANUAL_UPLOAD` mode 사용 횟수가 **0**이었다.

**direction.yaml**: "홈은 command center다"는 판매자에게 "제품이 이걸 해 드립니다"라고 말할 수 있는
capability가 아니고, 그렇다고 아직 정하지 않은 로드맵도 아니다. 내러티브에 두면 내러티브가 조용히
capability 주장을 하고, 로드맵에 두면 이미 내린 결정이 열린 질문으로 읽힌다.

**CURRENT_STATE는 이 원장에 없다.** 스케줄러가 도는가 · 실행이 활성인가 · 이 판매자가 무엇을
연결했는가 · 지금 자동 수집 대상인가는 실행 시점에 계산해 overlay한다. 이 패키지의 어떤 코드도
설정 값을 읽지 않는다.

### 로드맵을 현재 기능으로 읽을 수 없는 이유는 구조다

`ProductRoadmapItem`에는 `status`(capability)도 `mode`도 `evidence`도 없고,
`ProductCapability`와 **공통 상위 타입이 없다**. 두 목록을 한꺼번에 도는 호출자가 존재할 수 없고,
로드맵 항목에는 "제품이 이것을 한다"로 오해될 필드 자체가 없다. 그리고 모든 로드맵 항목은
`qualifier`(언급할 때 함께 말해야 하는 한정어)를 비워 둘 수 없다.

### 하위 계약(subtypes) — v2

한 채널의 한 객체가 사실은 여러 계약일 때 쓴다. 네이버 문의가 그 경우다 — **상품 문의 · 고객 문의 ·
톡톡**은 취득 경로도, 답변 계약도(식별자 공간이 겹치지 않는다), 근거 수준도 다르다. 상위 행 하나가
`SUPPORTED`라고 말하면 상품 문의에는 참, 고객 문의에는 반만 참, 톡톡에는 거짓이고 읽는 쪽은 어느
쪽인지 알 방법이 없다.

**판매자에게 보이는 운영 객체는 여전히 문의 하나다.** `ProductCapabilitySubtype`은 channel·object·
axis를 갖지 않아 3×4×4 격자에 들어가지 않고, capability 행으로 순회될 수도 없다. 검증기는
(1) 상위 행이 어떤 subtype보다도 강한 evidence를 주장하지 못하게 하고, (2) subtype마다 답이 다른데
상위 행에 `limitations`가 없으면 **과도한 일반화**로 거절한다.

### 실행 전제조건(requirements) — v2

"제품이 이걸 할 수 있다"와 "지금 이 판매자·이 배포에서 실행할 수 있다"는 다른 사실이다. 뒤의 것을
앞의 문장에 섞으면 capability가 배포 자세로 읽히고, 그것이 이 원장이 존재하는 이유다. 그래서 전제는
산문이 아니라 **데이터**로 붙는다 — `WRITE_PERMISSION` · `DEPLOYMENT_PREREQUISITE` ·
`VALID_APPROVAL` · `GUIDED_EXECUTION_PREREQUISITE` · `CHANNEL_PRECONDITION`.

전제조건은 **EXECUTION 축에만** 붙고, **status를 내리지 않는다**. 설명은 판매자가 실제로 할 수 있는
일을 가리켜야 하고, 내부 설정 키 이름을 담으면 검증기가 거절한다.

## 3. 축과 어휘

행 하나는 `CHANNEL.OBJECT.AXIS`다. 축이 넷인 이유는 **따로 증명되고 따로 낡기 때문**이다 —
카페24 리뷰 수집은 2026-07-30부터 라이브 검증됐지만, 카페24 리뷰 답글은 아직 어떤 몰에도 게시된
적이 없다. 한 행이 둘을 함께 말하면 어느 한쪽에 대해서는 거짓이 된다.

```
status    SUPPORTED · PARTIAL · NOT_SUPPORTED · UNKNOWN     제품이 제공하는가
mode      축마다 허용 값이 다르다                            제공한다면 어떤 모양인가
evidence  LIVE_PROVEN > TEST_PROVEN > IMPLEMENTED
          > DECLARED > UNKNOWN                              무엇이 그 주장을 받치는가
```

**status와 evidence는 다른 축이다.** `SUPPORTED + IMPLEMENTED`는 "제품이 제공하지만 실제 판매자
계정에서 돌려 본 적은 없다"이고, `NOT_SUPPORTED + DECLARED`는 "감사한 벤더 문서가 그 기능이
없다고 말한다"이다. **원장에 적었다는 이유로 evidence가 올라가지 않는다** —
`SUPPORTED`는 `IMPLEMENTED` 이상을 요구하고, 검증기가 그것을 강제한다.

반대 방향도 마찬가지다. **이미 `LIVE_PROVEN`인 capability를 stale registry 하나 때문에
`PARTIAL`/`UNKNOWN`으로 내리지 않는다.** drift가 발견되면 자동으로 코드 편을 드는 것이 아니라
사람이 어느 쪽이 틀렸는지 정한다(§5).

## 4. 검증 — 무엇이 불가능해지는가

`ProductTruthValidator`가 로드 시점에 **모든 위반을 한꺼번에** 모아 던진다.

- 네 층을 통틀어 **중복 id 불가**
- 행 id는 반드시 `CHANNEL.OBJECT.AXIS`, 층마다 네임스페이스가 다르다(`INVARIANT.` · `NARRATIVE.` · `ROADMAP.`)
- **모든 채널 × 객체가 네 축을 전부 선언해야 한다** — 침묵은 "안 한다"와 구별되지 않기 때문이고,
  "아무도 확인하지 않았다"의 정직한 표현은 그렇게 말하는 `UNKNOWN` 행이다
- 축에 속하지 않는 mode 불가 (`ACQUISITION` 행에 `DIRECT_WITH_APPROVAL`을 쓸 수 없다)
- `SUPPORTED`인데 `mode: NONE` 불가 · `NOT_SUPPORTED`인데 경로가 있는 것 불가
- `SUPPORTED`에 `DECLARED`/`UNKNOWN` evidence 불가
- **확인하지 않은 것은 `NOT_SUPPORTED`가 아니라 `UNKNOWN`** (`NOT_SUPPORTED` + `UNKNOWN` evidence 불가)
- **`UNKNOWN` 행은 `sellerFacingNotes`를 가질 수 없다** — 모른다고 적어 둔 행이 판매자에게 할 말을
  들고 있으면 그 행은 자기 status가 못 한다고 말한 주장을 하고 있는 것이다
- `PARTIAL`은 무엇이 부분인지 `limitations`에 적어야 한다
- 로드맵 `qualifier`는 비워 둘 수 없고 실제로 한정어여야 한다

v2에서 추가된 규칙:

- **capability 문장이 지금의 실행 상태를 단정할 수 없다** — "지금 자동으로 가져오고 있습니다"류의
  표현은 runtime overlay의 문장이고, 스케줄이 멈추는 순간 원장이 불완전한 것이 아니라 거짓이 된다
- **판매자 문장에 내부 설정 이름을 담을 수 없다** — OAuth 스코프 문자열, 배포 property 이름
- 실행 전제조건은 EXECUTION 축에만, 그리고 실행 경로가 있는 행에만
- subtype id는 `부모 id + '.' + KEY`, 상위 행은 어떤 subtype보다 강한 evidence를 주장할 수 없고,
  subtype이 서로 다른 답을 가지면 상위 행이 그 사실을 `limitations`에 적어야 한다
- 기능(`FEATURE.`)과 방향(`DIRECTION.`)은 자기 네임스페이스를 갖고, `SUPPORTED` 기능도 capability와
  같은 evidence 규율을 진다

## 5. Drift detection

`ProductTruthDriftTest`가 **코드도 말하는 사실을 다시 말하는 행**을 코드에 핀으로 고정한다.

| 핀 | 무엇과 무엇 사이 |
|---|---|
| 쿠팡 리뷰 실행 | 원장 `NOT_SUPPORTED` ⟺ `ChannelApiGapRegistry`의 `REVIEW_REPLY` |
| 리뷰 수집이 `AUTOMATIC`인 채널 | 원장 ⟺ `REVIEW_API` gap이 **없는** 채널 (= 카페24뿐) |
| 가이드형 취득 | 원장 `SELLER_GUIDED` + 근거 ⟺ `AcquisitionPathRegistry`의 method·verification |
| 문의 답변 전송 | 원장 `DIRECT_WITH_APPROVAL` ⟺ `InquiryReplyCapabilityRegistry.isImplemented` (NAVER는 subtype별) |
| 덮어쓰기 계약 | `overwritesExistingAnswer("NAVER", 상품문의)` ⟺ 원장 limitations |
| 리뷰 실행 | `ReviewExecutionCapability`의 **설정과 무관한** 두 분기(NAVER guided · 기본 unsupported) |
| 단건 주문 조회 | `ExactOrderLookupCapability.isAvailable` ⟺ 그 채널의 주문 읽기 문장 |

**중요 — drift는 원장을 덮어쓰지 않는다.** 실패했을 때 답은 사람이 어느 쪽이 틀렸는지 정하는 것이고,
런타임이 조용히 코드 편을 드는 일은 없다. 그렇게 하는 것이 정확히 쿠팡 문의를 후퇴시킨 그 동작이다.

**설정에 따라 답이 달라지는 것은 일부러 핀으로 고정하지 않았다.** 카페24 리뷰 실행은 플래그·커넥터·
판매자 write grant가 모두 맞을 때만 `API_EXECUTION`이므로, 그것을 핀으로 걸면 원장의 값이 테스트
환경의 플래그에 의존하게 된다 — 이 패키지가 끝내려는 바로 그 혼동이다.

**기동을 막는 새 fail-fast는 추가하지 않았다.** `ProductTruthPack`은 Spring bean이 아니고
지금은 아무도 런타임에서 읽지 않는다. 잘못된 파일은 배포가 아니라 빌드를 실패시킨다.

## 5-1. v2에서 고친 사실 (1차 사람 검토 결과)

| 행 | v1 | v2 | 근거 |
|---|---|---|---|
| `CAFE24.PRODUCT.ACQUISITION` · `.READ` | `PARTIAL · IMPLEMENTED`, "실제 응답 모양이 관측된 적이 없습니다" | `SUPPORTED · LIVE_PROVEN` | `docs/evidence/INDEX.md` 2026-08-22, run `44bea7b3` — 144 리스팅 · 이름/판매가/판매상태/통화 144/144 |
| 같은 행의 한계 | "기존 연결은 상품 읽기 권한이 없어 재동의 필요" | URL · 옵션조합 · 카테고리 · 브랜드 부재 | 같은 라이브 실측 (URL 0 · variants 0 · category/brand 0) |
| `NAVER.REVIEW.DRAFT` | `LIVE_PROVEN` (승인 head라고 적음) | `IMPLEMENTED` + 어느 lane이 증명됐는지 명시 | 그 초안은 `templates-v1+org`(템플릿 lane)이고 대상 approval은 **0**건 |
| `NAVER.PRODUCT.READ` | "상세페이지의 글과 그림에서 규격 지식을 읽는 별도 경로가 있습니다" | 현재 truth에서 제거 → `ROADMAP.PRODUCT_DETAIL_KNOWLEDGE` | 두 lane 모두 기본값 OFF · 발행 0 |
| 문의 수집 3행 | "한 번 연결하면 사람이 없어도 정해진 주기로 새 문의가 들어옵니다" | "정해진 주기로 다시 읽는 자동 수집 경로가 있는 채널입니다" | runtime posture ≠ capability |

**v1 초안이 틀렸던 방식을 기록해 둔다.** `CAFE24.PRODUCT` 행은 §4.1의 stale `NEEDS_VERIFICATION`을
인용해 쓰였고, 그 칸은 라이브 검증 뒤에도 갱신되지 않은 상태였다. 즉 이 원장의 첫 판이 **원장이 막으려던
실패를 그대로 재현했다** — 증거 색인에서 재도출하지 않고 정본의 한 칸을 믿었다. §4.1의 그 칸은
2026-09-08에 함께 정정했다.

## 5-2. 함께 정리한 stale seller-facing source

| 파일 | 무엇이 stale이었나 |
|---|---|
| `docs/multi-channel-connector-roadmap.md` §4.1 | Cafe24 PRODUCT `NEEDS_VERIFICATION` (라이브 2026-08-22 뒤에도) |
| `channel-knowledge/cafe24.yaml` `cafe24-cap-product` | "insufficient_scope가 돌아옵니다" — 현재 요청 스코프에는 그 권한이 포함돼 있다 |
| `channel-knowledge/cafe24.yaml` `cafe24-workflow-inquiry-answer` | "Cafe24 스코프는 전부 읽기 전용입니다. SellerOps가 글을 쓰지는 않습니다" — 답변 등록은 2026-08-25 `VERIFIED` |
| `channel-knowledge/naver.yaml` `naver-ops-what-api-cannot-tell` | "리뷰, **문의**, 리뷰 답변 여부를 알 수 없습니다" — 문의는 2026-08-24 라이브 검증 |
| `InquiryReplyCapabilityRegistry` ROWS | Cafe24·NAVER 상품문의 evidence 문자열 "(구현됨, 라이브 미실행)" — **주석이 아니라 프론트로 나가는 DTO 값**이다 |
| `ReviewTriageChannelCapability` 클래스 docblock | "Cafe24 has no reply flow built" — 같은 파일의 `replyFlowExists()`가 CAFE24에 `true`를 준다 |
| 죽은 경로 · 잘못된 FQCN | `docs/sellerops_phase3c_live_smoke.md` → `docs/archive/…` · `Cafe24ScopeContract`는 `…cafe24.onboarding` · `CoupangChannelReplyAdapter`는 `com.sellerops.inquiry.publish` |

## 5-3. Grounded Conversation wiring (2026-09-08)

사람 검토가 끝나(83/83 `HUMAN_REVIEWED`) 대화 lane이 이 원장을 authority로 읽는다.

```
backend  product-truth/*.yaml → ProductTruthPack → ProductTruthCatalog(lazy) → GET /api/product-truth
runtime  getProductTruth() → planSelection(closed tokens) → selectCanonicalFacts → productFactSheet
         + 기존 live read(coverage · posture · channel verdicts) = runtime overlay
         → POST /api/agent/converse (facts: string[])
```

**층이 겹치지 않는다.** canonical이 있으면 파생 product-level 문장과 파생 채널 capability 문장은
**보내지 않는다** — 같은 사실의 두 사본이 한 payload에 있으면 낡는 쪽이 생기고, 그것이 이 원장이
막으려는 것이다. 남는 것은 원장이 알 수 없는 것뿐이다: 배포(스케줄러가 도는가) · 판매자(무엇을
연결했는가) · **둘의 차이**(`RUNTIME.{CH}.{OBJ}.EXECUTION` — 실행이 꺼져 있어도 canonical
`DIRECT_WITH_APPROVAL`은 그대로 있고, 그 옆에 한 줄이 더 설 뿐이다).

**selection은 닫힌 토큰만 읽는다.** planner의 `capabilityAspect`, 채널 토큰, 대화의 focus. 한국어
낱말표는 없다 — planner 뒤에서 문장을 다시 읽는 것은 `semanticOwnership.test.ts`가 막는 그 모양이다.
토큰이 없는 질문(제품 비교·앞으로의 계획 등)은 **넓히는 쪽**으로 떨어진다: selection의 실패 방향은
"맥락이 많다"여야 하고 "묻지 않은 좁은 질문에 답했다"여서는 안 된다.

**evidence는 실어 보내되 말하지 않는다.** `LIVE_PROVEN`/`IMPLEMENTED`는 우리 낱말이고, 판매자가
읽어야 하는 것은 원장이 이미 한국어로 써 둔 「실제 몰에 게시한 적이 없습니다」다. 그래서 capability를
주장하는 행(`SUPPORTED`/`PARTIAL`)이 `LIVE_PROVEN`보다 약한데 한국어 한계 줄이 없으면 **아예 보내지
않는다**(`admits`). enum 토큰은 fact 문장에 한 번도 들어가지 않고, 테스트가 렌더된 문자열로 확인한다.

**계약 사본** `contracts/product-truth/v1/ledger.json` — 백엔드 테스트가 재생성하고, 런타임 테스트가
그 파일 위에서 단언한다. 손으로 쓴 fixture는 원장의 두 번째 사본이 되고 두 번째 사본은 낡는다.

**fallback은 좁아지지 않는다.** 원장을 못 읽으면(옛 백엔드·로드 실패) canonical이 `null`이고 sheet는
이 wiring 이전과 **바이트 단위로 같은** 파생 사실을 만든다. 결정론 composer로 곧장 떨어지는 경로는
만들지 않았다.

**추적**: `grounded_conversation` 로그가 `knowledge`(선택된 category) · `depth` · `canonicalIds` ·
`runtimeKeys`를 나눠 남긴다. 한 줄로 합치면 「원장이 그렇게 말했나, 이 배포가 그랬나」에 답할 수 없다.
민감값은 없다 — 닫힌 토큰과 ledger id 뿐.

프롬프트는 **v3**: 「제품 방향」·「앞으로의 방향」을 현재 기능으로 말하지 않기, 한계를 빼고 앞부분만
말하지 않기, 종류(subtype)별로 다른 것을 하나로 말하지 않기.

## 6. 아직 하지 않은 것

- Grounded Conversation은 이제 이 원장을 읽는다(§5-3). `ProductSelfKnowledge`의 다섯 composed 답변은
  **fallback으로 남는다**.
- 사람의 검토는 끝났다 — **83개 항목 전부 `HUMAN_REVIEWED`**. `HUMAN_REVIEWED`는 seller-facing
  authority라는 뜻이고 `LIVE_PROVEN`을 뜻하지 않는다.

## 7. 리뷰해야 하는 파일

렌더된 요약: **`docs/product_truth_matrix.md`** (생성 파일 — 손으로 고치지 말 것)

원본:

1. `backend/src/main/resources/product-truth/capabilities.yaml` — 3채널 × 4객체 × 4축 = **48행** (+ 네이버 문의 subtype 12)
2. `backend/src/main/resources/product-truth/features.yaml` — 채널×객체가 아닌 제품 기능 **8개**
3. `backend/src/main/resources/product-truth/invariants.yaml` — 제품 전체 불변식 **9개**
4. `backend/src/main/resources/product-truth/narrative.yaml` — 제품 내러티브 **6개**
5. `backend/src/main/resources/product-truth/direction.yaml` — 결정된 제품 방향 **4개**
6. `backend/src/main/resources/product-truth/roadmap.yaml` — 로드맵 **8개**

행을 확인했으면 `review: TODO_REVIEW` → `review: HUMAN_REVIEWED`로 바꾼다.
