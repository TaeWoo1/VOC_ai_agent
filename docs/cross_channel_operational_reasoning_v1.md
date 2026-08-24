# Cross-Channel Operational Reasoning v1

**2026-08-24** · `feat/agent-evidence-scope-integrity` · 마켓플레이스 접촉 **0** · WRITE **0**

## 0. 이 package가 답하는 질문

지금까지 Operator의 모든 대답은 **읽은 행이 곧 전부**라는 가정 위에 서 있었다. 그 가정이 무너진
날짜가 기록에 있다. 2026-08-24 오전 NAVER 문의는 공식 API 두 리소스로 라이브 증명됐고(REAL 18건,
상품 귀속 100%), 같은 날 오후 첫 routine은 토큰 발급에서 거절당했다
(`docs/naver_inquiry_api_audit_v1.md` §12). **두 사실이 동시에 참이다.**

그날 저녁 "네이버 문의 어때?"라는 질문에, "데이터 없음"을 한 단어로만 표현할 수 있는 런타임이
말할 수 있는 문장은 둘뿐이었고 **둘 다 거짓**이었다:

- "네이버는 문의를 지원하지 않습니다" — 그날 아침에 반증됨
- 수집된 18건을 **현재 상태로** 제시 — 최신인지 증명되지 않음

참인 문장은 **사실 두 개**를 필요로 한다:
> "수집된 이력이 있지만, 자동 수집이 멈춰 있어 지금이 최신인지 확인하지 못했습니다."

## 1. 어휘 — 세 번째 축, 그리고 왜 합치지 않았는가

이 저장소에는 이미 두 개의 coverage 축이 있다.

| 축 | 묻는 것 | 값 |
|---|---|---|
| `AttentionCoverage` | 이 행들을 이 범위에 **귀속**할 수 있는가 | `COVERED` · `UNCERTAIN_*` |
| `KnowledgeCoverage` | 이 사실을 **가지고 있는가**, 얼마나 오래됐는가 | `AVAILABLE` · `PARTIAL` · `UNAVAILABLE` · `STALE` |
| **`ChannelDataState`** (신규) | 이 채널이 **아직도 무슨 일이 일어나는지 말해 주는가** | 아래 6값 |

셋째를 앞의 둘 중 하나에 접었다면 **채널의 능력 한계와 깨진 자격 증명이 같은 단어**를 쓰게 된다.
그게 정확히 이 enum이 불가능하게 만들려는 실수다.

| 값 | 뜻 | 무엇을 말해도 되는가 |
|---|---|---|
| `OBSERVED_FRESH` | 연결 + routine 동작 + 행 보유 | 현재 상태로 말해도 된다 |
| `OBSERVED_FRESHNESS_UNPROVEN` | 행은 있고 최신인지 증명 못 함 | 행을 **자기 날짜와 함께** 인용만 |
| `ZERO` | **측정된 0** — 살아 있는 routine이 보고 없었다 | **유일하게 "없습니다"가 허용됨** |
| `NOT_SUPPORTED` | 채널이 이 데이터를 제공하지 않음 | 채널 한계로만 |
| `NOT_CONNECTED` | 제공은 되나 이 org에 연결된 계정 없음 | "연결해 주세요" |
| `BLOCKED` | 연결됐고 무언가 막고 있음(재인증 등) | "연결이 끊겼습니다" |

**`absence는 주장이다.**` "없습니다"는 세상에 대한 단언이고 `ZERO` 하나에서만 나올 수 있다.
나머지 다섯은 전부 "우리가 못 본다"이며, **못 본다는 것은 없다는 증거가 아니다.**
`mayReportAbsence()`가 그 규칙이고, `channelCoverage.test.ts`가 이 모듈의 어떤 문장도 그 규칙을
빠져나가지 못함을 강제한다.

## 2. 파생 — 순서가 곧 안전 속성

`ChannelCoverageService.stateOf`는 **한 곳에서, 한 순서로** 판정한다.

1. **support** — 채널에 대한 사실이므로 **가장 먼저**. 이 판매자의 연결 상태가 지원 여부를
   뒤집을 수 없다.
2. **connection** — 아무도 연결하지 않은 채널은 절대 0을 보고하지 않는다.
3. **freshness** — 지원 + 연결된 채널만 자격이 있고, `OBSERVED_FRESH`만이 `ZERO`를 낳을 수 있다.

**1단계에 거절 두 개가 내장돼 있다.**

- **`UNDECLARED` ≠ `UNSUPPORTED`.** 참조 테이블에 행이 없다는 것은 *아무도 적어두지 않았다*이지
  *채널이 못 한다*가 아니다. 가정이 아니다 — Cafe24는 `connector_capabilities`에 행이 아예 없었고,
  **첫 라이브 읽기가 `CAFE24 INQUIRY NOT_SUPPORTED`를 답했다. 저장된 문의 113건, 그중 미답변
  69건 위에서.** (V63이 §4.1과 그 proof들로부터 빠진 행을 채운다.)
- **`NOT_SUPPORTED`가 보유한 행을 지우지 않는다.** NAVER는 리뷰 API가 없고 이 org는 승인된 export
  경로로 얻은 NAVER 리뷰 **4,340건**을 가지고 있다. "제공하지 않습니다"는 API에 대해 참이고 데이터에
  대해 거짓이다. 행이 있으면 `OBSERVED_FRESHNESS_UNPROVEN` + "이 채널에는 자동 수집 경로가 없어".

**freshness는 그 스케줄 자신의 주기로 잰다.** 4시간은 60분 스케줄에겐 낡았고 1440분 스케줄에겐
최신이다 — 단일 상수는 둘 중 하나에 대해 반드시 틀린다. 새 숫자를 발명하지 않았다.

## 3. Evidence까지 전달되는 channel provenance

`EvidenceLocator.channelCode`는 이미 있었고, **아무도 채우지 않았다.** 그래서 채널을 지명한 질문은
모든 인용이 `CHANNEL_UNPROVEN`으로 거절됐고 — 정확한 동작이었지만 — 대신 받아들일 것이 없었다.

`get_channel_coverage`는 **채널마다 한 행**을 만들고 각 행이 자기 `channelCode`를 싣는다. 이것이 이
런타임에서 **NAVER에 대한 주장을 NAVER에 대한 주장으로 검증할 수 있게 된 최초의 증거**다.
`digestFor`는 이미 `channel=`을 내보내므로 judge도 공짜로 그것을 본다.

`events`는 `{from: null, to: <가장 최근 행의 날짜>}`다. **누락값이 아니라 정직한 진술이다** — 이
읽기는 마지막 행이 언제였는지 알고 첫 행이 언제였는지 모른다.

## 4. scope와 breakdown은 다른 연산이다

| | 무엇 | 어디서 결정 |
|---|---|---|
| **scope** | "네이버 문의" — 답 전체가 그 채널에 대한 것 | `channelScopeOf(plan)`, run당 1회 |
| **breakdown** | "채널별 문의" — org 범위, **답**이 채널로 나뉨 | `GroupingDimension`에 `CHANNEL` |

**instance는 자기 축만 취소한다.** "네이버에서 어느 상품이 문제야?"는 채널 하나 × 상품 전부이고,
채널 instance를 상품 축까지 접었다면 물어보지 않은 질문에 답하게 된다. `GroupingDimension`은
`PRODUCT_CHANNEL`을 갖고, 읽을 때는 반드시 `groupsBy(dim, axis)`를 쓴다 — 값을 직접 비교하면
새 조합이 이미 동작하던 축을 조용히 꺼버린다.

## 5. PRODUCT × CHANNEL — 두 축이 되는데 교차는 안 된다

| need × 축 | 판정 | 근거 |
|---|---|---|
| `INQUIRY_VOLUME` × CHANNEL | **`SUPPORTED`** | coverage 행의 rows/openRows |
| `REVIEW_SIGNAL` × CHANNEL | **`SUPPORTED`** | 동상 |
| `REVIEW_SIGNAL` × PRODUCT | `SUPPORTED` | evidence-summary:byProduct · dashboard:topProductIssues |
| **`REVIEW_SIGNAL` × PRODUCT_CHANNEL** | **`NO_CHANNEL_ATTRIBUTION`** | 두 grouped read가 productId + count만 주고 channel이 없다 |
| **`INQUIRY_VOLUME` × PRODUCT_CHANNEL** | **`NO_CHANNEL_ATTRIBUTION`** | 대기열 행은 channel은 있고 **productId가 없다** |
| `REPEAT_PATTERN` × CHANNEL | `NO_CHANNEL_ATTRIBUTION` | signature 클러스터에 둘 다 없다 |

**`channel_products`로 교차하지 않는다.** 그건 상품이 **어디에 올라가 있는지**를 말하지, 그 리뷰가
**어디서 왔는지**를 말하지 않는다. 목록 join의 힘으로 건수를 채널에 귀속시키는 것은 C4의 실수가
채널 옷을 입은 것이다. 새 값 `NO_CHANNEL_ATTRIBUTION`이 자기 문장을 갖는 이유도 같다 — 어느 축이
빠졌는지 판매자가 알 수 있어야 한다.

## 6. 라이브 검증 (canonical Demo Org, 마켓플레이스 접촉 0, WRITE 0)

### 6.1 coverage 읽기 — 9행

| 채널 | 타입 | 상태 | rows | open | 가장 최근 |
|---|---|---|---|---|---|
| NAVER | INQUIRY | **`BLOCKED`** | 18 | 0 | 2026-08-19 |
| NAVER | REVIEW | `OBSERVED_FRESHNESS_UNPROVEN` (API 없음) | 4,340 | 17 | 2026-08-22 |
| NAVER | ORDER_SUMMARY | `BLOCKED` | 48 | — | 2026-08-22 |
| CAFE24 | INQUIRY | `OBSERVED_FRESH` | 113 | **69** | 2025-03-27 |
| CAFE24 | REVIEW | `OBSERVED_FRESH` | 133 | 1 | 2026-08-16 |
| CAFE24 | ORDER_SUMMARY | **`ZERO`** | 0 | 0 | — |
| COUPANG | INQUIRY | `OBSERVED_FRESHNESS_UNPROVEN` | 2 | 0 | 2026-08-07 |
| COUPANG | REVIEW | `OBSERVED_FRESHNESS_UNPROVEN` (API 없음) | 23 | 4 | 2026-08-23 |
| COUPANG | ORDER_SUMMARY | `OBSERVED_FRESHNESS_UNPROVEN` | 58 | — | 2026-08-23 |

**부분의 합이 전체와 정확히 같다**: 미답변 **0 + 69 + 0 = 69**, 그리고 홈 화면이 찍는 org 총계도
**69**. 같은 corpus, 같은 `ACTIVE` 술어 — 화면 위에서 부분이 전체와 어긋나지 않는다.

CAFE24 INQUIRY가 `OBSERVED_FRESH`인데 가장 최근 행이 2025-03-27인 것은 모순이 아니라 **정확히 이
축이 나누려던 두 가지**다: 관측의 최신성과 데이터의 최근성은 다른 사실이다.

### 6.2 에이전트 라이브 (LLM planner, 실데이터)

| 질문 | 결과 |
|---|---|
| 채널별로 답변이 필요한 문의가 몇 건인지 | 채널 3행 + 자격 붙은 합계. `grouping=CHANNEL` |
| 네이버 문의는 지금 어때? | **NAVER 한 행만** — scope가 breakdown이 아님을 라이브로 증명 |
| 쿠팡 리뷰 상황 알려줘 | "자동 수집 경로가 없어" — API 부재를 데이터 부재로 말하지 않음 |
| 카페24 문의는 지금 어때? | `channelScope=CAFE24`, 한 행 |
| 전체 채널에서 지금 뭐가 제일 급해? | INQUIRY_OPS + REVIEW_OPS, 6행 + 합계 2개 |
| 상품별로 그리고 채널별로 리뷰 문제를 | `grouping=PRODUCT_CHANNEL`, 채널 축 + **교차 불가 문장** |

실제 답 (그대로):

> 네이버 스마트스토어 연결이 끊겨 문의 데이터를 확인할 수 없습니다. 채널 연결에서 다시 연결해 주세요.
> 카페24 자사몰 문의 113건, 그중 답변이 필요한 것 69건.
> 쿠팡 문의는 수집된 이력이 있지만(2건, 가장 최근 것은 2026-08-07), 최근 자동 수집이 성공하지 못해 지금이 최신인지 확인하지 못했습니다.
> 연결된 채널 합계 115건 (그중 확인이 필요한 것 69건). 네이버 스마트스토어(연결 끊김)는 이 합계에 없습니다. 쿠팡은 최신 여부를 확인하지 못했습니다.

**"네이버 문의가 없습니다"는 한 번도 나오지 않았고, 나올 수 없다.**

### 6.3 라이브가 찾아 같은 package에서 고친 것 4건

1. **Cafe24 = NOT_SUPPORTED (113건 위에서)** — 참조 테이블에 행이 없었다. `UNDECLARED` 도입 + V63.
2. **coverage evidence가 두 번 실렸다** — 두 need가 한 읽기를 공유하는데 need마다 refs를 밀어 넣어
   9행이 18행으로 보였다.
3. **"쿠팡는"** — 조사 불일치. `withTopic()`이 받침으로 결정한다.
4. **planner가 통째로 거절했다** — "일부만 답할 수 있다"를 "답할 수 없다"로 읽어 `supported=false`.
   판매자는 답할 수 있었던 절반까지 잃었다. planner 프롬프트에 **"부분 계획이 거절보다 낫다"** 규칙
   추가 ⇒ 같은 질문이 재실행 2/2에서 채널 축을 답한다.

## 7. 회귀

backend **2,805 / 0 failures** · agent-runtime **483 passed / 23 skipped** · frontend **162 files /
2,246 tests** · `tsc` clean (agent-runtime · frontend).

신규: `channelCoverage.test.ts` 21건 · `ChannelCoverageStateTest` 9건.
`toolReachability.test.ts`의 `sourceOf`가 graph-local import를 따라가도록 확장됐다 — 특화 에이전트가
**도달하는** 도구도 선언돼야 하며, 공유 스텝 하나로 그 규칙을 빠져나갈 수 없다.

## 8. 하지 않은 것

새 marketplace endpoint **0** · TalkTalk **0** · 2026-06 이전 backfill **0** · 20 vs 69 결정 **0** ·
repeated inquiry product schema **0** · UI **0** · answer write API **0** · **WRITE 0**.

`docs/multi-channel-connector-roadmap.md` §4.1의 어떤 칸도 옮기지 않았다.
