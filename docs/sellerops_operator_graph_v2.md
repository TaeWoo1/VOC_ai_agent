# SellerOps Operator Graph v2 — 제품 행동 계약 · 구현 계약 (정본)

> **Status: CANONICAL product-behaviour + implementation contract — IMPLEMENTED 2026-08-21**
> (`feat/operator-graph-v2`). 계획으로 작성돼 같은 날 구현·라이브 통합 증명까지 랜딩했다. 구현이
> 계획과 달라진 곳은 **§22**에, 실데이터가 드러낸 것은
> `docs/operator_graph_v2_local_integration_proof.md`에 있다.
>
> **이 문서가 소유하는 것** — 제품 정의와 4개 invariant, Dashboard/Agent 두 레인의 구분, Planner 계약
> (`InvestigationPlan`), Product Knowledge 계층, specialist 역할 경계, Evidence·Judge·budget·tool 계약,
> 그리고 v2의 단일 구현 package.
>
> **이 문서가 소유하지 않는 것** — capability 진실(`docs/multi-channel-connector-roadmap.md` §4.1),
> 범위 계약(`docs/product-scope-v1.md`), IA·화면 책임(`docs/product_assembly_ia_v1.md`),
> 라이브 승인(`docs/sellerops_live_approval_contract.md`), 안전 울타리(`CLAUDE.md`).
> 충돌 시 그 문서들이 이긴다.
>
> **v1과의 관계.** `docs/sellerops_operator_graph_v1.md`는 **삭제하지 않는다.** v1은 2026-08-21에 구현·
> 라이브 통합 증명까지 끝난 실제 기록이고, 그 §14a·§17과 `docs/operator_graph_v1_local_integration_proof.md`
> 는 계속 유효한 증거다. 다만 **product runtime semantics는 이 문서로 superseded 된다** — 구체적으로
> v1 §4.1의 "planner 실패 시 keyword router가 답한다", §8의 catalogue 전량 인가, §13 층2의 결정론적
> planner 층, §14의 "데모 4문항이 완료 조건"이 **v2에서 전부 무효**다. v1 문서 상단에 그 표시를 넣었다.
>
> **현재 상태의 근거.** "지금 무엇이 있는가"는 `docs/demo_baseline_recovery_audit_2026-08-21.md`,
> `docs/operator_graph_v1_local_integration_proof.md`, `docs/slices/product-context-diagnosis-groundwork.md`
> 를 인용한다. 이 문서는 그 감사를 다시 수행하지 않는다. 코드 인용(파일:심볼)은 현재 브랜치에서 재확인했다.

---

## 0. 한 문단

v1은 **실행 구조**를 세웠다 — Operator가 specialist를 고르고, Evidence를 일급 상태로 들고, Judge가
말해도 되는 것을 판정하고, budget이 fail-closed로 끝낸다. 그 뼈대는 실데이터에서 증명됐고 v2에서
그대로 유지된다. v2가 고치는 것은 **그 뼈대 안에 남아 있는 결정론의 잔재**다: 목표 해석이 아직
키워드 표로도 답할 수 있고, 조사 순서가 specialist 안에 고정돼 있고, "무엇을 팔고 있는지"에 대한
지식이 상품명과 SKU 두 개뿐이며, 반복 문의는 실제 문의 corpus 3,220건에서 signature를 **0건** 만든다.
v2는 네 가지를 못 박는다: **계획은 반드시 LLM이 세운다(못 세우면 실패한다)**, **조사 순서는 계획이
정한다(specialist에 고정하지 않는다)**, **상품 지식에도 provenance와 coverage가 있다**, **WRITE는 계속 0이다.**

---

## 1. 제품 정의 (정본)

> SellerOps는 판매자가 **무엇을 팔고 있는지**와 고객이 그 상품에 대해 **무엇을 묻고, 불평하고,
> 구매하는지**를 함께 이해한 뒤, 판매자가 자연어로 목표를 말하면 필요한 **상품·문의·리뷰·주문·과거 대응**
> 정보를 **스스로 조사해** 업무 판단, 답변 초안, 개선안을 **근거와 함께** 준비하는 AI 판매운영 Agent다.

이 정의에서 **v2가 새로 강제하는 두 단어**는 `무엇을 팔고 있는지`(→ §6 Product Knowledge)와
`스스로 조사해`(→ §4 Planner, §7 Agentic investigation)다. 나머지는 v1에서 이미 강제되고 있다.

---

## 2. 반드시 지켜야 할 4개 invariant

각 invariant는 **문장이 아니라 깨지면 빨개지는 장치**를 가진다. 장치 없는 invariant는 주석이다.

| # | invariant | 강제 장치 (없으면 이 invariant는 없는 것) |
|---|---|---|
| **I1** | **Product-centered.** 고객운영 판단은 가능한 경우 상품을 중심으로 연결한다. | `productCentered.test.ts` — 상품이 해석된 run의 모든 finding은 `locator.productId`를 갖거나, 갖지 못한 이유를 `KnowledgeCoverage`로 명시해야 한다. 둘 다 아니면 finding은 compose에서 탈락한다. |
| **I2** | **LLM-first Planning.** Agent chat의 목표 해석·조사 계획은 **반드시** LLM Planner가 한다. 결정론 planner·keyword planner·phrase routing·command fallback은 **product/test/emergency 어디에도 존재하지 않는다.** Planner를 쓸 수 없으면 run은 **실패한다.** | ① `plannerFence.test.ts` — `Planner` 인터페이스의 구현체는 `src/` 전체에서 **정확히 하나**이고 그 `kind`는 `"LLM"`이다(WRITE tool 구조 거부와 같은 방식). ② `goalRoutingFence.test.ts` — `parseGoal`에 자유문장 keyword 표가 존재하지 않는다(소스 스캔). ③ `plannerUnavailable.test.ts` — planner 미가용 시 `status: "FAILED"` + finding 0. |
| **I3** | **Evidence.** 상품 사실·정책·고객 이슈·인과관계를 확인 가능한 근거 없이 단정하지 않는다. **상품 knowledge에도 provenance와 coverage가 있다.** | v1의 traceability 검사 유지 + `productFactProvenance.test.ts` — 모든 `ProductFact`는 `source` + `observedAt`을 갖고, 갖지 못한 값은 저장되지도 인용되지도 않는다. Judge에 `UNVERIFIED_PRODUCT_FACT` 규칙 추가(§11). |
| **I4** | **No external write.** v2는 investigate / reason / recommend / prepare 까지만. **WRITE tool 0개.** credential·trusted seller interaction privileged plane 비노출. | `operatorToolRegistry.test.ts`(v1, 그대로) + `OperatorToolRegistry` 생성자 거부 + `privilegedPlaneFence.test.ts`(신규) — Operator tool 이름 표에 credential/Action Window/guided-submission 계열 심볼이 **하나도** 나타나지 않는다. |

### 2.1 I1·I3의 강제 장치 — Evidence Scope Integrity (2026-08-23 추가)

I1과 I3은 2026-08-23 라이브에서 **동시에 뚫렸다.** 셀러가 이름으로 지목한 상품에 대해 다른 상품의 HIGH
이슈 3건이 경고 없이 답에 도달했고, 위 표의 어떤 장치도 빨개지지 않았다. 이유는 하나다 — 모든 층이
**"이 finding에 근거가 붙어 있는가"**를 물었고 답이 예였기 때문이다. 붙어 있던 것이 다른 것의 근거였다.
기록: `docs/agent_real_validation_v1.md` §3 Q4.

그래서 질문을 바꾼다: **근거가 증명하는 범위가 need가 물은 범위와 같은가.**

| 축 | 규칙 |
|---|---|
| entity | ORG / PRODUCT / ITEM. **PRODUCT need는 resolved canonical product 없이는 어떤 근거로도 만족되지 않는다** — product-scoped 근거로도 안 된다. `locator.productId` 부재는 "모르는 상품"이 아니라 **org 전체**다 |
| channel | 셀러가 채널을 지목했을 때만. 어느 채널인지 말하지 못하는 근거는 그 채널을 증명하지 못한다 |
| temporal | 셀러가 기간을 지목했을 때, 자기 날짜가 없는 총계는 그 기간을 증명하지 못한다 |
| granularity | COUNT / LIST / DETAIL / ISSUE_SIGNAL / GAP. count는 목록·개별 건 need를 자동으로 만족시키지 못한다. 판정은 planner 자신의 `evidenceRequirements.acceptableKinds` — v2가 계속 보내면서 아무도 읽지 않던 필드 |

**강제 장치.** `src/operator/scope/EvidenceScope.ts`(계약) · `operatorGraph.applyScopeGate`(run의 finding
집합이 조립되는 단일 지점 — 강등이 아니라 **미조립**) · `RuleEvidenceJudge`(같은 검사를 독립 floor로;
graph gate와 judge 중 어느 쪽도 유일한 검사가 되지 않는다) · `evidenceScopeIntegrity.test.ts` 24건, red
test는 **그 잘못된 답을 만든 라이브 plan을 그대로 재생**한다. `claimsCoverageLimit` finding은 양쪽 모두
면제 — 부재가 곧 근거이고, 그것까지 지우면 false calm만 남는다.

**이 장치가 할 수 없는 것:** 새 근거를 가져오는 것. 오직 보류만 할 수 있고, 보류할 때는 어느 범위를
증명하지 못했는지 답에 적는다.

### 2.2 실패의 의미 — Specialist Failure Semantics (2026-08-23 추가)

I3은 "근거 없이 단정하지 않는다"를 말하지만, **근거를 못 얻은 것과 데이터가 조용한 것을 구분하라고는
말하지 않았다.** 2026-08-23 라이브에서 그 둘이 같은 화면이 됐다: `INQUIRY_OPS`가 anchor 없는
`search_customer_memory` 호출로 400을 받아 예외가 나면서 **이미 성공한 두 read까지 함께 사라졌고**, run은
`DONE` + findings 0으로 끝났다. 기록: `docs/agent_real_validation_v1.md` §3 Q5 · §10.

| 규칙 | 내용 |
|---|---|
| tool 격리 | 실패한 read는 자기 evidence만 잃는다. 이미 성공한 read는 남고, 아직 안 한 read는 계속 실행된다. **선언된 의존**만 후속 단계를 멈출 수 있다 |
| precondition | 백엔드가 거절할 호출은 **하지 않는다**. 백엔드를 느슨하게 만들지 않는다 — anchor 없는 customer-memory 검색은 org 전체 훑기이고, 400이 정답이다 |
| specialist terminal | `OK` / **`PARTIAL`** / `FAILED`. PARTIAL의 부재가 Q5를 성공처럼 보이게 했다 |
| run terminal | findings 0 + **의도적 skip이 아닌 실패**가 있으면 `FAILED`/`EVIDENCE_UNAVAILABLE`. read가 성공하고 비어 있었다면 `DONE` — 조용한 받은편지함은 참인 답이다 |
| failure는 데이터 | `specialist · tool · category · statusCategory · recoverable`. **HTTP 숫자가 아니라 등급이고, 예외의 `message`는 읽지도 남기지도 않는다** |

**강제 장치.** `src/operator/failure/SpecialistOutcome.ts` · `inquiryOps`/`reviewOps`의 read별 격리 ·
`operatorRuntime`의 terminal 판정 · `specialistFailureSemantics.test.ts` 18건(red test는 그 답을 만든
라이브 plan을 재생하고, fake가 백엔드와 같은 precondition을 강제한다).

**이 장치도 새 근거를 만들지 못한다.** 할 수 있는 것은 잃지 않는 것과, 잃었을 때 그것을 말하는 것뿐이다.

**I2의 정확한 범위** — 삭제 대상은 **자유 문장에 대한 결정론적 해석**이다. 닫힌 enum `intent`를
검증하는 것(버튼이 보내는 값)은 해석이 아니라 **계약 검증**이며 §3의 Dashboard 레인에 속한다. 이
구분을 흐리면 "버튼도 지웠다" 또는 "keyword 표를 intent 검증이라 부르고 남겼다" 둘 중 하나가 된다.

### 2.3 두 개의 시간 — Temporal Evidence Semantics (2026-08-23 추가)

§2.1이 만든 temporal 축에는 **시간이 한 종류뿐이었다.** evidence가 날짜를 갖고 있느냐만 물었고, 그
날짜가 *언제 봤는지*인지 *언제 일어났는지*인지는 묻지 않았다. 2026-08-23 라이브에서 같은 문장이 두 번
실행됐고, planner가 한 번은 "오늘"을 `PERIOD`로 선언하고 한 번은 하지 않았다 — **같은 데이터, 같은
질문, 다른 답**(한 번은 미답변 총계, 한 번은 근거 없음). 기록: `docs/agent_real_validation_v1.md` §10.4 · §11.

**고치는 방법은 날짜를 찍는 것이 아니다.** 받은편지함 count에 오늘 날짜를 찍으면 두 run 모두 답은
하지만, 그 순간 "현재 미답변 69건"이 "오늘 들어온 문의 69건"이 된다. false negative를 **거짓 주장으로**
바꾸는 거래다.

| | 무엇인가 | 언제 있는가 | 무엇을 증명하는가 |
|---|---|---|---|
| `asOf` | **SellerOps가 언제 봤는가** | 모든 live read (읽는 행위는 언제나 시각을 갖는다) | 신선도. 그 이상은 아무것도 |
| `events` | **밑에 깔린 행이 언제 일어났는가** | 출처가 말할 수 있을 때만. `null` = 모름, 결코 "지금"이 아님 | 기간 안의 발생 |

**`events`는 `asOf`에서 채워지지 않고, 질의 window에서도 채워지지 않는다.** 30일을 물었다는 사실은 어떤
행도 그 안에 있었음을 증명하지 않는다 — 행 자신의 날짜만 증명한다.

**need는 둘 중 하나를 요구한다.** `CURRENT_STATE`(대기열 깊이·상품 속성)는 신선한 관측으로 충족되고,
`PERIOD_EVENTS`(반복·이력·리뷰 신호)는 event range가 있어야 충족된다. 판정은 **planner가 이미 보내는
need `kind`**에서 나온다 — 한국어 산문 해석이 아니라. 그래서 planner가 같은 질문을 다르게 쓰더라도 답이
움직이지 않는다.

**장치는 둘이고, 둘은 다른 것을 본다.** scope gate는 **need가 무엇을 물었는지**를 읽고, rule judge는
**문장이 무엇을 주장하는지**를 읽는다. 후자가 없으면 "현재 미답변 69건"과 "오늘 들어온 문의 69건"을
구분할 수 없다 — 둘은 같은 근거를 인용하고 하나만 증명된다. 문장이 기간 안의 발생을 주장하는데 근거가
행의 날짜를 모르면, plan이 뭐라 했든 거절된다.

**강제 장치.** `src/operator/scope/EvidenceTime.ts` · `EvidenceScope.checkEvidence`의 temporal 축 ·
`RuleEvidenceJudge`의 claim 규칙 · `temporalEvidenceSemantics.test.ts` 21건.

**`get_today_inbox`의 `INBOX_COUNT`는 현재 상태의 snapshot이다** — 이름과 달리 "오늘 들어온 문의"가
아니다. 관측 시각은 갖고, event range는 갖지 않으며, 문장은 "**현재** 답변이 필요한 문의가 N건"이라고
말한다. "현재"는 예의가 아니라 근거가 증명하는 범위다.

---

### 2.4 이미 답이 있는 되묻기 — Operational Defaults (2026-08-23 추가)

되묻기는 v2가 의도한 기능이다. **문제는 시스템이 이미 답을 갖고 있는 되묻기였다.** 2026-08-23 라이브
6건 중 3건이 "기간을 정해달라"로 끝났고 셋 다 tool 0회였다 — `list_repeated_inquiries`에 28일 창이 처음부터
선언돼 있는데도. 기록: `docs/agent_real_validation_v1.md` §12.

| 우선순위 | 무엇 |
|---|---|
| 1 | 판매자가 명시한 범위 |
| 2 | **capability가 선언한 범위** — trailing 창, 또는 "기간 필터가 없다"는 명시적 선언 |
| 3 | 둘 다 없을 때만 되묻기 |

**전역 정책을 만들지 않는다.** 28은 그것을 소유한 capability의 것이고, 문장의 숫자는 반환된 행이 echo한
값에서 온다. 선언이 없는 곳(`ORDER_HISTORY` — 도달 가능한 tool 없음)에서는 되묻기가 그대로 살아남는다.

**규칙:** planner의 `clarificationNeeded`는 **required need 중 어느 것도 수행 불가일 때만** 전달된다.
수행 불가는 두 가지다 — 선언된 범위가 없거나, plan이 해결하지도 언급하지도 않은 anchor가 필요하거나.
일부라도 가능하면 run은 그 일을 하고 못 채운 need를 사유와 함께 말한다.

**감사에서 나온 불편한 결과:** 오늘 **어떤 READ tool도 판매자가 쓴 범위를 받지 않는다.**
`windowDays`는 숫자이고 「최근」을 숫자로 바꾸는 것은 추측이다. 그래서 판매자가 말한 기간은 무엇을
조회할지가 아니라 **무엇을 말해야 하는지**를 바꾼다 — run은 선언된 기본값으로 진행하고 그 차이를 답에
표시한다. `ScopeSource`의 `"USER"`는 오늘 도달하지 않으며, 도달하지 않는 값을 이름으로 남기는 것이 그
공백을 표시하는 방법이다.

**§2.3과 충돌하지 않는다.** 기본 질의 창은 **retrieval scope**이고 `EvidenceTime`은 **evidence time**이다.
28일을 요청했다는 사실은 어떤 행도 날짜 짓지 않는다 — 기간 주장은 여전히 행 자신의 날짜에만 기댄다.

**강제 장치.** `src/operator/defaults/OperationalDefaults.ts` (감사 표 · `clarificationStands` ·
`InvestigationPlan.appliedDefaults`) · `operationalDefaults.test.ts` 20건(음성 대조군 포함).

---

### 2.5 셀러가 읽는 이름 — Human Product Name Resolution (2026-08-23 추가)

**셀러는 자기 상품을 자기 상품 이름으로 부를 수 있어야 한다.** 2026-08-23 라이브에서 셀러가 자기 쿠팡
리스팅 제목("판도리 일체형 종이컵 수거함")을 그대로 쳤고 run은 2회 모두 "상품을 찾지 못했습니다"로
끝났다. `products.name`이 `15223228019` — SKU 숫자였고, 사람이 읽는 이름은
`channel_products.channel_product_name`에만 있었다. 기록: `docs/agent_real_validation_v1.md` §13.

**리스팅 제목은 canonical product의 alias다.** 리스팅을 찾고, 그 리스팅이 **이미 연결돼 있는** canonical
product를 돌려준다. 생성 0 · 병합 0 · 리스팅이 상품 자리에 오지 않는다.

| 순위 | surface |
|---|---|
| 0 | `SKU_EXACT` |
| 1 | `CANONICAL_NAME_EXACT` |
| 2 | **`CHANNEL_PRODUCT_NAME_EXACT`** |
| 3 | `CANONICAL_NAME_PARTIAL` (유일한 비정확 surface) |

**alias는 완전 일치만 한다.** normalize는 화면에서 보이지 않는 차이만 지운다(NFC · trim · lowercase ·
연속 공백) — 정의는 `ProductNameKey` 하나뿐이다. 유사도 점수도, 모델 추측도 없다: 데모 org에는
「선바로 2p」와 「선바로 4p」처럼 한 글자 차이의 별개 상품이 실재한다.

**exact surface의 동점은 해결 불가이며 해결하지 않는다.** 후보마다 `matchedOn`이 실려 오므로 "후보가
여럿"과 "**똑같이 좋은** 후보가 여럿"이 구별된다. 동점이면 run은 고르지 않고 무엇이 있으면 정해지는지를
말한다(SKU·채널). 부분 일치의 동점은 다른 상황이라 기존대로 진행하고 어느 쪽인지 밝힌다.

**범위는 org × REAL, 두 겹.** 두 read 모두 org-scoped이고 자동 활성 `realDataOnly` 필터가 양쪽에서
seeded row를 제외한다 — 합성 리스팅이 실제 상품의 이름이 될 수 없다.

**§2.1을 넓히지 않는다.** 이름이 쉬워졌다고 말할 수 있는 것이 넓어지지 않는다. 상품이 해결돼도
org-scope 증거는 여전히 상품 need를 만족시키지 못한다 — 라이브에서 거절 사유가
`NO_RESOLVED_PRODUCT`에서 `ORG_EVIDENCE_FOR_PRODUCT_NEED`로 바뀌었을 뿐 거절 건수는 4/4로 같다.

**강제 장치.** `ProductQueryService` · `ProductNameKey` · `ProductMatchSurface` ·
`ProductAliasResolutionTest` 10건 · `humanProductNameResolution.test.ts` 9건 (fence 3건은 대조군).

---

### 2.6 카탈로그는 할 수 있는 것만 광고한다 — Tool Reachability (2026-08-23 추가)

**planner에게 보이는 도구 = 어떤 specialist가 실제로 실행하는 도구.** 2026-08-23 라이브에서 planner는
18개를 제시받았고 코드가 부르는 것은 7개였다. 나머지 11개는 계획에 이름이 오르면 사람이 읽기에 제품의
능력처럼 보였고, 모델은 그중 하나를 고르는 데 예산을 썼다. 기록: `docs/agent_real_validation_v1.md` §14.

**capability matrix가 그 등식을 고정한다** — `(specialist, tool, needKinds, precondition)` 한 표에서
planner의 카탈로그와 specialist의 allow-list가 **함께** 파생된다. 두 곳에 적으면 두 개의 규칙이 되고,
어긋난 쪽이 거짓 광고가 된다. 호출자가 없는 도구는 등록된 채 READ인 채로 **planner의 시야 밖**에 남는다.

**precondition은 각주가 아니라 capability의 일부다.** resolved product를 요구하는 도구는 상품 없이
호출되지 않는다 — 그렇게 얻은 "답"은 아무도 들여다보지 않은 상품에 대한 답이다.

**두 번째 planner는 만들지 않는다.** 런타임이 "도움이 될 것 같아서" 부르는 도구는 없고, planner가 고르지
않은 specialist를 런타임이 배치하지도 않는다. 도달성은 **광고를 줄여서** 맞추지, 실행을 늘려서 맞추지
않는다.

**상품 질문에서 org 목록은 후보 목록이지 증거가 아니다.** 상품이 해결돼 있으면 `search_review_issues`의
행은 어떤 문장도 되지 못하고, 문장이 되는 것은 이슈별 근거 집계에서 읽은 **이 상품 몫의 건수**뿐이다
(`ISSUE_EVIDENCE`). 이슈 전체의 날짜는 그 몫에 빌려주지 않는다 — 다른 상품의 최근 리뷰가 이 상품의
「최근」을 증명하게 되는 것은 시간 옷을 입은 §2.1 위반이다. 그리고 훑기는 유한하며, **유한하다는 사실을
답이 말한다**("19건 가운데 6건을 확인했고 나머지는 확인하지 않았습니다").

**강제 장치.** `tools/ToolReachability.ts` · `toolReachability.test.ts` 13건 — matrix의 모든 행에
`registry.invoke` 호출부가 실재하고, 모든 호출 대상이 matrix에 있고, 어떤 evidence도 도달 불가능한 도구를
`sourceTool`로 달지 않는다는 것을 **소스를 읽어** 고정한다.

---

### 2.7 지목한 상품에 닿는 계획 — Plan Product Reachability (2026-08-24 추가)

**미해결 `PRODUCT` 언급이 있는데 그 상품을 해결할 specialist가 계획에 없으면, 그것은 계획이 아니다.**
A1의 entity 축이 해결된 상품 위에 서 있으므로, 그런 계획은 자기 안의 모든 상품 need가 거절될 것을 이미
결정한 계획이다. `PlanValidator` V9가 `PRODUCT_UNRESOLVABLE`로 **거절**한다.

**고치는 것은 planner다.** validator도 runtime도 specialist를 추가하지 않는다 — 추가는 곧 결정론적 두
번째 planner이고 I2가 금지한다. 돌려보내는 것은 **거절 사유와 규칙 한 문장**(닫힌 어휘, 셀러 데이터 0)
이며, **repair는 정확히 1회**이고 **budget에 과금**된다. 두 번째도 같은 계획이면 run은 실패한다.

「누가 상품을 해결할 수 있는가」는 §2.6 capability matrix에서 파생된다 — `PRODUCT_MENTION`을 요구하는
도구를 가진 specialist. 목록을 두 곳에 적지 않는다.

### 2.8 더 많이 아는 결과가 남는다 — Need Outcome Merge (2026-08-24 추가)

need는 여러 specialist가 답한다(설계상 need kind가 겹친다). **마지막에 쓴 쪽이 이기는 규칙은 없다.**
병합 기준은 **status → coverage → completeness**, 동률이면 **먼저 쓴 쪽**이 남는다(`plan/needOutcome.ts`).

- coverage **미보고는 가운데**다. 보고하지 않은 specialist는 전부 봤다고 주장하지도, 사각지대를 인정하지도
  않았다.
- **어떤 경우에도 status를 올리지 않는다.** 승자는 언제나 입력 둘 중 하나이므로, 읽지 않았음이 「문제
  없음」이 되는 경로는 규칙 안에 존재하지 않는다.

같은 원칙이 **읽기 단계**에도 적용된다: 런타임이 이미 **증명한** 사실은 다시 사지 않는다. 판단 기준은
specialist 이름이 아니라 **증거**이므로, 앞선 specialist가 증명에 실패했으면 뒤 경로가 그대로 돈다.

### 2.9 상품에 대한 문장의 숫자는 그 상품의 것이다 (2026-08-24 추가)

상품별 이슈 목록은 상품 범위지만 그 위의 `evidenceCount`는 **이슈의 org 총계**다. 상품 문장은
`get_review_issue_evidence_summary`의 **분할**을 인용하고, org 총계는 **범위를 밝혀** 같은 문장 안에
문맥으로만 둔다. 읽지 못하면 상품 수를 말하지 않는다.

**정렬도 같은 규칙이다.** 무엇을 말할지 고를 때 다른 scope의 수로 순위를 매기면, 이 상품의 가장 큰 문제가
잘려 나간다(2026-08-24 라이브에서 실제로 그랬다). 분할을 먼저 읽고 **상품 자기 수로** 정렬하며, 읽은
건수와 말한 건수를 **각각** 밝힌다.

---

## 3. Dashboard 레인과 Agent 레인은 다른 물건이다

| | **Dashboard shortcut** | **Agent chat** |
|---|---|---|
| 입구 | 버튼 · 메뉴 · 명시적 `intent` · 화면 필터 | 판매자가 타이핑한 **자연어 한 문장** |
| 해석 | 필요 없음 (닫힌 enum 검증) | **LLM Planner만** |
| 경로 | REST capability 직접 호출, 또는 기존 4개 subgraph | 자연어 → **LLM plan → plan validation** → specialist/tool 선택 → evidence 수집 → judge → (필요 시 re-plan) → answer/draft/recommendation |
| 결정론 | **허용** | **금지** |
| planner 미가용 시 | 정상 동작 (영향 없음) | **run 실패** |

**금지되는 것, 명시적으로:** Planner 없이 dashboard capability를 조합해 Agent 답변처럼 반환하는 것.
지금 코드가 정확히 그것을 한다(§12 D1–D6). Agent 카드가 "규칙 해석"이라고 라벨을 붙였다는 사실은
면책이 아니다 — 라벨이 정직해도 **그 경로 자체가 v2에서 존재하지 않아야** 한다.

**기존 4개 subgraph는 Dashboard 레인으로 명확히 이동한다.** `HANDLE_UNANSWERED_INQUIRIES` ·
`PREPARE_INQUIRY_DRAFT` · `HANDLE_REVIEW_REPLIES` · `HANDLE_OPERATIONS_ISSUES`는 **명시적 intent로만**
도달한다(FE 버튼/칩이 text가 아니라 intent를 보낸다). 그 그래프들의 checkpoint·승인·contract는 **불변**이다.

---

## 4. Planner v2 — 계획은 label이 아니라 조사 설계다

### 4.1 `InvestigationPlan` — planner가 반드시 표현해야 하는 의미

```jsonc
{
  "supported": true,
  "userGoal": "…",                    // 판매자 목표의 재진술 (1문장)
  "entities": {
    "resolved":   [],                  // 항상 비어서 나온다 — 아래 §4.5
    "unresolved": [ { "kind": "PRODUCT", "mention": "선바로 일체형 전선몰딩" } ]
  },
  "informationNeeds": [
    { "id": "n1", "question": "이 상품의 규격이 상세에 적혀 있는가",
      "kind": "PRODUCT_FACT", "why": "…", "required": true }
  ],
  "specialistTargets": ["PRODUCT_OPS"],
  "candidateTools":    ["resolve_product", "get_product_knowledge"],
  "retrievalStrategy": {
    "order": ["n1", "n2"],             // 무엇을 먼저 보는가 — specialist가 아니라 여기서 결정된다
    "parallelizable": ["n2", "n3"],
    "stopWhen": "n1이 확정되면 n3는 불필요"
  },
  "evidenceRequirements": [
    { "needId": "n1", "minEvidence": 1, "acceptableKinds": ["PRODUCT_FACT", "PRODUCT_LISTING"] }
  ],
  "riskClass": "ROUTINE",              // ROUTINE | SENSITIVE | REFUSE
  "stoppingCriteria": { "maxIterations": 2, "maxToolCalls": 8, "enough": "…" },
  "clarificationNeeded": false,
  "clarificationReason": null,
  "rationale": "…"
}
```

**`informationNeeds`가 이 계약의 심장이다.** intent label 하나로는 "폭이 몇 mm인가요?"와
"교환 가능한가요?"가 같은 계획이 된다. need 목록은 그 둘을 **구조적으로** 다르게 만든다 — 그래서
§18의 divergence 테스트가 가능해진다.

### 4.2 Plan Validator — 안전·계약만 본다. 업무 계획을 대신 만들지 않는다

Validator가 검사하는 것(전부 거부 사유):

| # | 규칙 | 위반 시 |
|---|---|---|
| V1 | `specialistTargets` ⊆ {PRODUCT_OPS, REVIEW_OPS, INQUIRY_OPS, REPORT_OPS} | 알 수 없는 이름 제거; 전부 제거되면 **REPAIR 1회 → 실패** |
| V2 | `candidateTools` ⊆ tool catalogue **이고 전부 READ** | 목록 밖 이름 제거(registry가 실행 시점에서 또 거부) |
| V3 | `supported=true`면 `informationNeeds` 비어 있지 않다 | REPAIR → 실패 |
| V4 | `evidenceRequirements`의 모든 `needId`가 실재한다 | 고아 요구 제거 |
| V5 | `stoppingCriteria` ≤ 시스템 budget 상한 | 상한으로 clamp (**올리지 못한다**) |
| V6 | `entities.resolved`가 비어 있다 (§4.5) | 즉시 거부 — REPAIR 없음 |
| V7 | `riskClass = REFUSE` | 정직한 거부 답변. 정상 경로 아님 |
| V8 | `clarificationNeeded=true` | specialist 0개 실행, **되묻는 답**을 낸다 |

Validator가 **하지 않는 것**: need를 추가/보정하는 것, tool을 추천하는 것, specialist를 채워 넣는 것,
빈 계획을 기본값으로 채우는 것. 그 순간 Validator가 두 번째 planner가 되고 I2는 무의미해진다.

### 4.3 실패는 실패다

planner 미가용(capability off · 키 없음 · transport 실패 · REPAIR 1회 후에도 스키마 위반) ⇒
**run은 `FAILED`로 끝난다.** finding 0, answer 없음, `failureCode: "PLANNER_UNAVAILABLE" | "PLAN_INVALID"`.
대체 답변을 만들지 않는다. `AgentRunView.status`에 `FAILED`가 추가되는 **wire contract 변경**이며 FE가
정직한 상태를 렌더한다(§16).

### 4.4 re-plan은 판정 결과를 입력으로 받는다

Judge가 `needsMore`를 말하면 v1은 **같은 specialist를 다시 돌렸다.** v2는 planner를 다시 호출하되
입력에 **지금까지의 evidence digest(닫힌 어휘 metadata만) + 충족된/미충족 need 목록**을 얹는다.
planner는 남은 need에 대한 새 `retrievalStrategy`를 낸다. 상한은 `stoppingCriteria`와 시스템 budget의
**작은 쪽**이고, 여기서도 planner가 죽으면 그 시점까지의 답을 내는 것이 아니라 — 이미 SUPPORTED 판정을
받은 finding이 있으면 그것과 함께 `stopReason: "REPLAN_UNAVAILABLE"`을 **명시**한다.

### 4.5 planner가 절대 못 하는 것 (V6가 지키는 것)

**planner는 id를 만들 수 없다.** productId·issueId·workItemId·inquiryId는 전부 **tool이 해석한 결과**로만
state에 들어온다. planner가 낼 수 있는 것은 판매자가 말한 **표현(mention)** 뿐이다. 이것이 없으면
모델이 그럴듯한 UUID를 뱉고 tool이 그것을 조회해 빈 결과를 받고 "문제 없습니다"가 나온다.
`entities.resolved`를 항상 빈 배열로 강제하는 이유이고, 거부에 REPAIR가 없는 유일한 규칙인 이유다.

**planner는 seller 데이터를 보지 않는다.** payload floor는 v1과 같다: 판매자 자신의 문장 + 정적 tool
catalogue. v2는 여기에 **need/entity kind의 닫힌 어휘**만 더한다(고객 발화·행 데이터·id·org 없음).
`AgentPlanPayloadFloorTest`가 직렬화된 바이트에서 이를 계속 검사한다.

---

## 5. State v2

v1 채널을 유지하고 세 개를 더한다. 어느 채널에도 고객 원문은 없다(v1 계약 유지).

| 채널 | reducer | v2 변화 |
|---|---|---|
| `goalText` | last | — |
| `plan` | last | 타입이 `OperatorPlan` → **`InvestigationPlan`** |
| `needs` | **merge by id** | **신규.** need별 `status: PENDING/SATISFIED/UNSATISFIABLE` + 충족시킨 evidenceIds |
| `entities` | merge | **신규.** mention → 해석된 id(항상 tool 출처) + 후보 다수/모호 표시 |
| `knowledge` | last | **신규.** 해석된 상품의 `ProductKnowledge`(§6) — findings가 인용하는 원본 |
| `evidence` | append | v1과 동일. `EvidenceKind`에 `PRODUCT_FACT`·`PRODUCT_LISTING`·`PRODUCT_VARIANT` 추가 |
| `findings` | last | `Finding`에 `needId` 추가 — 어떤 질문에 답한 문장인지 |
| `results`·`answer`·`trail` | v1과 동일 | `OperatorAnswer`에 `plan`(요약)·`needs`·`failureCode` 추가 |

`Finding.needId`가 붙는 이유: need를 세워 놓고 아무도 답하지 않은 채 끝나는 run을 **compose가 감지해서
말할 수 있게** 하기 위해서다("규격은 확인하지 못했습니다"). v1은 그 침묵을 감지할 구조가 없었다.

---

## 6. ProductOps v2 — Product Knowledge layer

### 6.1 v2가 표현해야 하는 것

```
ProductKnowledge
├─ identity   : productId · name · brand? · manufacturer? · category?
├─ listings[] : channelCode · channelProductId · listingName · productUrl? · price? · sellingStatus?
│               · observedAt · source
├─ variants[] : optionName? · optionId? · sku? · observedAt · source
├─ facts[]    : key · value · unit? · source · observedAt · confidence     // 상품 설명 · 주요 spec
├─ signals    : (v1 ProductSignalsView 그대로 재사용 — 문의/리뷰/이슈/미답변)
└─ coverage[] : facet 별 KnowledgeCoverage + provenance
```

**ERP 영역은 범위 밖이다** — 재고·창고·생산 lot·생산계획. 이 문장은 §12의 KEEP 판정과 같은 무게로
읽어야 한다: "상품을 이해한다"가 재고 관리로 번지는 것이 이 계층의 가장 흔한 실패다.

### 6.2 `KnowledgeCoverage` — 새 개념인가, 중복인가

**새 enum이 정당하다.** 기존 `AttentionCoverage`는 *귀속(attribution)*의 질문에 답한다 — "이 신호를 이
범위에 대해 판단할 수 있는가"(COVERED / UNCERTAIN_MULTI_ACCOUNT / UNCERTAIN_UNSUPPORTED_CHANNEL /
UNCERTAIN_PRODUCT_UNLINKED). Product Knowledge는 *가용성(availability)*의 질문에 답한다 — "이 사실을
우리가 가지고 있는가, 얼마나 오래된 것인가". 둘을 한 enum에 밀어 넣으면 `UNCERTAIN_PRODUCT_UNLINKED`와
`STALE`이 같은 칸에 앉는다.

| 값 | 의미 | 예 |
|---|---|---|
| `AVAILABLE` | 이 facet의 사실을 갖고 있고 최신성 기준 안이다 | NAVER 리뷰 export에서 온 상품명 |
| `PARTIAL` | 일부 채널·일부 항목만 있다 | 3개 채널 중 1개만 listing 확인됨 |
| `UNAVAILABLE` | **가진 적이 없다** (≠ 사실이 아니다) | 상품 설명 · spec — 현재 전 채널 |
| `STALE` | 있으나 신선도 기준을 넘겼다 | 90일 넘은 가격 관측 |

**신호(signals) 축은 계속 `AttentionCoverage`/`SignalCoverageView`를 쓴다.** 둘은 한 응답 안에 나란히
실린다: 지식은 `KnowledgeCoverage`, 신호는 `AttentionCoverage`. 중복이 아니라 **다른 질문**이다.

**"정보가 없음"과 "사실이 아님"은 절대 섞지 않는다.** `UNAVAILABLE`인 facet에 대해 Operator는
"그런 규격은 없습니다"라고 말할 수 없고 "그 정보를 갖고 있지 않습니다"만 말할 수 있다. Judge 규칙
`UNVERIFIED_PRODUCT_FACT`가 이것을 문장 수준에서 잡는다(§11).

### 6.3 사실마다 출처와 시각

`ProductFact`는 값만으로 저장되지 않는다. `source`(예: `NAVER:REVIEW_EXPORT:상품명`,
`CAFE24:BOARD_ARTICLE:product_no`, `UPLOAD:PRODUCT_CATALOG:v1`)와 `observedAt`이 **필수**이며,
둘 중 하나가 없으면 저장 자체를 거부한다. `confidence`는 세 값(`SOURCE_STATED` /
`DERIVED` / `INFERRED`)이고, **`INFERRED`는 v2에서 생성되지 않는다** — 값을 추론해 넣는 순간
I3이 무너지기 때문에, enum에 이름만 두고 생산자를 두지 않는다(WRITE와 같은 방식).

### 6.4 상품 identity — 지금 조용히 깨지고 있는 것

`docs/slices/product-context-diagnosis-groundwork.md` §2가 측정해 둔 결함:
`ProductService.resolveOrCreate`는 SKU가 없으면 **이름 완전일치**로 해석한다. 그래서 셀러가 리스팅
제목을 바꾸면 `products` 행이 하나 더 생기고 **자기 리뷰 이력이 갈라진다. 이를 탐지하는 것은 아무것도
없다.** v2는 identity를 `channel_products(channel_id, external_product_id)`로 옮긴다 — 지금 **0행짜리
죽은 테이블**이고(같은 문서 §2), 원래 그 목적으로 만들어졌다(V1). 이름은 표시용으로 강등된다.

---

## 7. InquiryOps v2 — 고정 retrieval 순서를 만들지 않는다

**금지:** InquiryOps 안에 "inbox → repeats → memory" 같은 고정 시퀀스. v1의
`runInquiryOps`가 정확히 그 모양이다(§12 D5).

**대신:** specialist는 `state.needs` 중 **자기 담당 need만** 받아서, planner의 `retrievalStrategy.order`가
정한 순서로 실행한다. 같은 specialist가 질문에 따라 다른 tool을 다른 순서로 부른다.

| 판매자 질문 | 있을 법한 informationNeeds | 먼저 볼 것 |
|---|---|---|
| "폭이 몇 mm인가요?" | 상품 규격 사실 → (없으면) 같은 질문의 과거 응대 | `PRODUCT_FACT` |
| "교환 가능한가요?" | 판매자/채널 정책 → 이 상품의 교환 이력 | `POLICY` |
| "전에 산 것과 색이 달라요" | 상품·옵션 → 주문 이력 → 과거 대응 → 관련 리뷰 | `PRODUCT_VARIANT` |

**이 셋이 같은 고정 tool sequence로 실행되면 v2 실패로 본다** (§18의 판정 기준).

> ⚠ **`POLICY` need는 v2에서 대체로 `UNAVAILABLE`로 답해진다.** 저장소에 셀러/채널 정책 원문이 없다.
> v2는 그 need를 **표현할 수 있게** 만들고 **정직하게 미가용을 말한다**. 정책 수집은 이 package 범위 밖이며
> 선제적으로 제품화하지 않는다(§21-B4).

---

## 8. Specialist 역할 경계

| specialist | 답하는 질문 | 소유 | 절대 안 하는 것 |
|---|---|---|---|
| **ProductOps** | 무엇을 파는가 · 그 상품에 무슨 일이 있는가 | product facts · listings · variants · signals · knowledge coverage | 재고/생산(ERP), 답변 작성 |
| **InquiryOps** | 고객이 무엇을 알고/해결하고 싶은가 | 필요한 evidence · customer memory · past response · reply preparation | 발송, 상품 사실의 출처가 되는 것 |
| **ReviewOps** | 실제 고객 경험에서 나온 문제 signal | attention · issue type · recurrence · trend · 문의와 겹치는 문제 · 상품 개선 근거 | 원인 단정, 리뷰 원문 노출 |
| **ReportOps** | 위 findings의 운영/대표 관점 조합 | 조합·요약·우선순위 | **새 사실의 source of truth가 되는 것** |

**ReportOps 규칙을 장치로:** ReportOps가 만든 finding의 evidence는 **반드시 다른 specialist가 이미
등록한 evidenceId**여야 한다(신규 evidence 생성 금지). `reportOpsNoNewFacts.test.ts`. v1의 ReportOpsNode는
자기 tool을 직접 불러 자기 evidence를 만들었다(§12 M4) — 그래서 라이브에서 같은 3,208이 두 번 나왔다.

**Spring Backend는 계속 사실·규칙·데이터·트랜잭션의 source of truth다.** LangGraph에서 기존 business
logic을 재구현하지 않는다(v1 R1, 유지).

---

## 9. 반복 문의 — "파이프라인이 있다"가 아니라 "실제로 찾는다"

**현재 상태(측정치, 재감사 아님).** 실제 문의 corpus **3,220건에서 signature 0건**. 리뷰는 3,916건에서
80건. 그래서 `RepeatedInquiryService`의 SIGNATURE 축은 구조만 있고 **비어 있고**, TOPIC 축은
`item_analyses.category` 9개 값으로만 말한다. `contracts/review-eval/naver/v1/RUBRIC.md`가 이미 진단한
그대로다: **실패 원인은 어휘 폭이 아니라 표층형 경직성(surface-form rigidity).**

**v2 설계 — 이미 존재하는 port에 두 번째 구현체를 넣는다. 새 파이프라인 아님.**

1. `IssueSignatureExtractor`는 **바로 이 목적으로 만들어진 port**다(그 javadoc이 그렇게 말한다).
   v2는 `SemanticIssueSignatureExtractor`를 그 뒤에 넣는다 — `kind()="SEMANTIC"`, 자기 version.
   기존 `RuleBasedIssueSignatureExtractor`는 **리뷰 축에서 그대로 유지**된다(그것이 만든 issue와 새
   extractor가 만든 issue는 `extractor_kind`로 공존한다 — V31이 이미 그렇게 설계돼 있다).
2. **문의 축에는 자기 닫힌 어휘가 필요하다.** 리뷰 어휘(`파손`/`결함`/`누락`)는 *문제*의 어휘이고
   문의는 대체로 *질문*이다. 그래서 signature는 **`<category>:<askKind>`** 로 조립한다:
   - 앞 절반 = **기존 `ItemAnalysisCategories`** (배송/교환/제품정보/설치/가격/품질/색상/사이즈/기타) — **재사용**
   - 뒷 절반 = 신규 소형 닫힌 어휘 `InquiryAskKind` (가능여부 · 규격 · 기간 · 방법 · 상태 · 비용 · 재고 · 호환 · 하자)
   → `교환:가능여부`, `제품정보:규격`. 새 개념을 만들지 않고 **한 축만 추가**한다.
3. **출력은 라벨뿐이다.** extractor는 닫힌 어휘 2개와 ordinal만 돌려준다. 고객 문장은 저장되지 않고
   요약되지도 않는다 — v1의 customer memory 계약 그대로.
4. **한 번만 분류한다.** `inquiry_signature_cache(org_id, content_hash → signature)`. 같은 본문은 다시
   vendor로 나가지 않는다. 재실행·backfill·재수집이 egress를 곱하지 않게 하는 장치다.
5. **완료 조건은 "돌아간다"가 아니다.** `contracts/inquiry-issue/v1/RUBRIC.md`를 새로 만들고,
   실제 corpus에서 **손으로 라벨한 gold set**(≥200행, DEV/HOLDOUT 분리)에 대해 측정한다.
   합격선: **DEV recall ≥ 0.60, precision ≥ 0.80**, 그리고 **HOLDOUT에서 셀러가 실제로 인정하는
   반복 이슈 ≥ 5개**가 나와야 한다. 숫자가 안 나오면 v2의 이 항목은 **미완**으로 보고한다 —
   RUBRIC이 0/30을 기록했던 것과 같은 정직함으로.

> ⚠ **이 항목은 §21-B1(product-owner blocker)에 걸려 있다.** 문의 본문을 corpus 단위로 vendor에 보내는
> 것은 현재 draft capability(건별)와 **다른 노출 등급**이다. 결정 전에는 구현하지 않는다.

---

## 10. Tool catalogue v2

**WRITE 0개. 전부 READ. v1의 구조적 거부 그대로.** 변경은 세 가지뿐이다.

| 변화 | tool | 이유 |
|---|---|---|
| 신규 | `get_product_knowledge(productId)` | §6의 knowledge 전체(identity·listings·variants·facts·coverage). `get_product_signals`는 **신호 전용으로 유지**(분리해야 coverage 두 축이 안 섞인다) |
| 신규 | `search_product_facts(productId, factKeys[])` | "폭이 몇 mm" 류 need를 catalogue 전체를 읽지 않고 답하기 위해 |
| 신규 | `get_inquiry_thread_context(workItemId)` | 한 문의의 **메타데이터 + 상품 연결 + 과거 대응 요약**. 원문은 여전히 `get_inquiry_detail`(초안 작성 전용)로만 |
| 변경 | 모든 tool 설명이 **"어떤 need에 답하는가"** 를 명시 | planner가 need→tool을 고르는 근거가 catalogue 텍스트뿐이기 때문 |
| **삭제** | 없음 | v1 12개 tool은 전부 유지 |

**여전히 catalogue에 없는 것(의도적):** `prepare_guided_reply_session`, 모든 credential handoff, 모든
Action Window 명령, 모든 수집 트리거. `privilegedPlaneFence.test.ts`가 이름 수준에서 검사한다.

**tool 인가 규칙 변경.** v1은 계획이 tool을 못 고르면 **catalogue 전량**을 인가했다(`KeywordPlanner.built`,
그리고 LLM 계획이 빈 경우도). v2는 인가 = `plan.candidateTools ∪ SPECIALIST_TOOLS[해당 specialist]`이며
**전량 인가 경로는 삭제한다.**

---

## 11. Evidence Judge v2 · Budget

**Judge는 v1 구조 그대로 유지한다**(rule judge가 바닥, LLM judge는 AND로만 좁힌다, `judgeKind` provenance,
`confidenceOf` 3값). 이것들은 제거 대상이 아니다. 추가되는 규칙은 셋:

| 규칙 | 무엇을 잡는가 |
|---|---|
| `UNVERIFIED_PRODUCT_FACT` | `UNAVAILABLE`/`STALE` facet 위에서 상품 사실을 단정하는 문장 |
| `POLICY_ASSERTION` | 교환/반품/보증 가능 여부를 정책 근거 없이 단정하는 문장 |
| `UNANSWERED_NEED` | (compose 단계) `PENDING`으로 끝난 required need를 답이 침묵으로 넘어가는 것 |

**Budget은 v1 그대로 bounded·fail-closed.** 차이 하나: `stoppingCriteria`가 시스템 상한을 **낮출 수만**
있다(V5). 모델이 자기 예산을 올리지 못한다.

---

## 12. 현재 코드에서 v2를 위반하는 것 — 파일·심볼 단위

**판정 어휘:** `DELETE`(제거) · `REPLACE`(같은 자리에 다른 구현) · `MODIFY`(수정) · `KEEP`(그대로).
안전 rule judge · evidence floor · coverage · budget · tool allowlist는 **제거 대상이 아니다.**

### 12.1 deterministic planner

| # | 위치 | 심볼 | 판정 | 비고 |
|---|---|---|---|---|
| D1 | `agent-runtime/src/operator/plan/Planner.ts` | `class KeywordPlanner` (전체) | **DELETE** | I2 직접 위반. product/test/fallback 모두 |
| D2 | 〃 | `KeywordPlanner.PRODUCT_WORDS` / `REPORT_WORDS` / `TODAY_WORDS` | **DELETE** | phrase routing |
| D3 | 〃 | `KeywordPlanner.built()` — catalogue 전량 인가 | **DELETE** | §10 인가 규칙 위반 |
| D4 | 〃 | `SpringPlanner.fallback` 필드 · 생성자 2번째 인자 · 4곳의 `return this.fallback.plan(...)` | **DELETE** | planner OFF success path |
| D5 | 〃 | `SpringPlanner` 나머지 | **REPLACE** → `LlmInvestigationPlanner` | `InvestigationPlan` 반환, 실패 시 throw |
| D6 | 〃 | `productHints()` / `productHint()` 정규식 | **DELETE** | phrase routing. mention 추출은 planner의 일(§4.1 `entities.unresolved`) |
| D7 | `agent-runtime/src/operator/operatorRuntime.ts` | `planner ?? new SpringPlanner(op, new KeywordPlanner())` | **MODIFY** | 기본값에서 fallback 제거; planner 주입은 **transport 수준**에서만 |
| D8 | `agent-runtime/src/operator/graph/operatorGraph.ts` | `interpretAndPlan`의 `withHint` (결정론 hint 보정) | **DELETE** | "planner가 잊으면 우리가 채운다" = 결정론 planner의 잔재 |
| D9 | `agent-runtime/src/operator/state/OperatorState.ts` | `OperatorPlan.plannerKind: "LLM" \| "KEYWORD"` | **MODIFY** | `"KEYWORD"` 제거. `plannerKind`는 provenance로 유지하되 값은 LLM 계열만 |
| D10 | 〃 | `OperatorAnswer.plannerKind` 동일 | **MODIFY** | 〃 |
| D11 | `agent-runtime/src/operator/operatorRuntime.ts` | `emptyAnswer()` — `plannerKind: "KEYWORD"`인 성공 답변 | **REPLACE** | planner 실패는 `FAILED`이지 빈 답이 아니다(§4.3) |

### 12.2 keyword / phrase intent detection

| # | 위치 | 심볼 | 판정 | 비고 |
|---|---|---|---|---|
| K1 | `agent-runtime/src/goal/parseGoal.ts` | `const INTENT_KEYWORDS` (5행 표 전체) | **DELETE** | 자유문장 keyword 표 |
| K2 | 〃 | `parseGoal()`의 `if (request.text) { … 표 순회 … }` 분기 | **DELETE** | text는 더 이상 intent로 해석되지 않는다 |
| K3 | 〃 | `parseGoal()`의 `if (request.intent)` 분기 + `KNOWN_INTENTS` | **KEEP** | 닫힌 enum 검증 = Dashboard 레인(§3) |
| K4 | 〃 | `routeIntent()` | **KEEP** | intent→domain은 계약 매핑이지 해석이 아니다 |
| K5 | 〃 | `UnrecognizedGoalError` | **KEEP** | 알 수 없는 **intent**에 여전히 필요 |
| K6 | 〃 | 파일 docblock "keyword table" 서술 | **MODIFY** | 사실이 아니게 된다 |
| K7 | `agent-runtime/src/http/AgentRunService.ts` | `route()`의 `catch (UnrecognizedGoalError) → "OPERATOR"` 폴백 | **MODIFY** | 폴백이 아니라 **기본 규칙**이 된다: goalText ⇒ 항상 OPERATOR |

### 12.3 demo 4문장 전용 routing

| # | 위치 | 심볼 | 판정 | 비고 |
|---|---|---|---|---|
| X1 | `agent-runtime/src/http/AgentRunService.ts` | `INTENT_CATALOGUE`의 `OPERATOR_GOAL.examples` 3문장 | **MODIFY** | 예시는 남기되 **`examples`가 아니라 `sampleGoals`** 로 이름을 바꾸고 "지원 목록이 아니다"를 계약에 명시. 지금 FE가 이것을 지원 범위처럼 읽는다 |
| X2 | `frontend/src/pages/Agent.tsx` | `ExampleChips` 4개 문자열 | **MODIFY** | Operator 칩 2개는 자유문장 그대로, subgraph 칩 2개("미답변 문의 처리해줘"·"리뷰 답변 준비해줘")는 **text가 아니라 explicit intent**를 보내도록(§3) |
| X3 | `agent-runtime/test/operator/operatorScenarios.e2e.test.ts` | `describe("데모 1..4")` 구조 | **REPLACE** | 4문장 통과가 완료 조건이 아니다(§18). paraphrase + divergence 스위트로 대체 |
| X4 | `docs/demo_runbook_v1.md` §3.1 | "네 질문" 동선 · "keyword table" caveat 문단(L211) | **MODIFY** | v2에서 planner off면 데모 자체가 불가하다는 사실을 기록 |

### 12.4 planner OFF success path

| # | 위치 | 심볼 | 판정 | 비고 |
|---|---|---|---|---|
| P1 | `agent-runtime/src/operator/plan/Planner.ts` | `SpringPlanner.usesModel` getter · `capabilityOff` 학습 | **MODIFY** | 학습은 유지(라이브에서 예산 낭비를 잡은 실제 패치 B4)하되, 도달점이 fallback이 아니라 **FAILED**로 바뀐다 |
| P2 | `agent-runtime/src/operator/graph/operatorGraph.ts` | `interpretAndPlan`의 `if (deps.planner.usesModel && !budget.spend("llm"))` | **MODIFY** | planner는 이제 항상 모델을 쓴다. 조건이 무의미해진다 |
| P3 | `backend/.../AgentPlanProperties` 기본값 `enabled=false` | — | **KEEP (코드)** / **MODIFY (배포 문서)** | 기본 off는 보안 기본값으로 옳다. 바뀌는 것은 "off면 Agent chat이 동작하지 않는다"를 **문서와 FE가 말하는 것** |
| P4 | `agent-runtime/src/operator/judge/EvidenceJudge.ts` | `SpringEvidenceJudge` → `RuleEvidenceJudge` 폴백 | **KEEP** | **Judge 폴백은 planner 폴백과 다르다.** rule judge는 더 조용해질 뿐 절대 대담해지지 않는다(withhold-only). I3을 약화시키지 않으므로 유지 |

### 12.5 fixed retrieval order (I2의 조사 계획 절반)

| # | 위치 | 심볼 | 판정 | 비고 |
|---|---|---|---|---|
| M1 | `agent-runtime/src/operator/graph/inquiryOps.ts` | `runInquiryOps` 고정 2단 시퀀스 | **REPLACE** | need 기반 실행(§7) |
| M2 | `agent-runtime/src/operator/graph/productOps.ts` | `runProductOps` 고정 resolve→signals | **REPLACE** | need 기반 + knowledge 조회 |
| M3 | `agent-runtime/src/operator/graph/reviewOps.ts` | 고정 1 tool | **MODIFY** | need 기반. 나머지 로직 유지 |
| M4 | `agent-runtime/src/operator/graph/reportOpsNode.ts` | 자체 tool 3회 호출 + 자체 evidence 생성 | **REPLACE** | §8 규칙: 다른 specialist의 evidence만 조합 |
| M5 | `agent-runtime/src/operator/graph/operatorGraph.ts` | `SPECIALIST_TOOLS` 상수 | **KEEP** | specialist가 자기 tool을 갖는 것은 유지(라이브 패치 B5의 근거 그대로). 다만 **인가 하한**이지 실행 순서가 아니다 |
| M6 | 〃 | `afterJudge`의 `"interpretGoal"` 재진입 | **MODIFY** | re-plan이 evidence를 입력으로 받도록(§4.4) |

### 12.6 결정론 planner를 전제하는 fake / test

| # | 위치 | 판정 | 비고 |
|---|---|---|---|
| T1 | `agent-runtime/test/goal/parseGoal.test.ts` — `parseGoal({text:…})` 케이스 전부 | **DELETE** | 삭제되는 동작을 고정하는 테스트 |
| T2 | 〃 — `intent` 검증 케이스 3건 · `routeIntent` 케이스 | **KEEP** | Dashboard 레인 계약 |
| T3 | `agent-runtime/test/goal/reviewRouter.test.ts` — `parseGoal({text:…})` 케이스 전부 | **DELETE** | 〃 |
| T4 | 〃 — `routeIntent(...)` 3건, `intent` 경로 | **KEEP** | |
| T5 | `…/operatorScenarios.e2e.test.ts` — `describe("데모 3")`/`it("the other three existing intents…")`의 `parseGoal({text})` 5건 | **DELETE** | 자유문장 라우팅을 고정한다 |
| T6 | 〃 `it("with the planner and judge off, the run still completes…")` | **REPLACE** | 정반대를 고정하는 테스트가 된다: planner off ⇒ FAILED |
| T7 | 〃 같은 it 안의 `expect(answer.plannerKind).toBe("KEYWORD")` | **DELETE** | |
| T8 | 〃 `describe("product resolution — the full phrase beats one word of it")` | **REPLACE** | mention 추출이 planner로 이동(D6) — 2026-08-21 라이브에서 나온 그 실데이터 사례를 **recorded plan** 기반으로 재작성(사례는 버리지 않는다) |
| T9 | `agent-runtime/test/support/FakeOperatorSpringClient.ts` | **MODIFY** | `planGoal` 미구현 = "planner 없음" 상태를 정상 취급하게 만든다. **recorded plan을 재생하는 `planGoal`을 필수 구현**으로 |
| T10 | `agent-runtime/test/http/httpServer.contract.test.ts` `it("GET /capabilities is public and lists intents")` | **MODIFY** | catalogue 형태 변경(X1) 반영 |
| T11 | `agent-runtime/test/integration/issueRealBackend.integration.test.ts` | **KEEP** | `routeIntent`만 쓴다 |
| T12 | `frontend/src/pages/agentOperatorAnswer.test.tsx` — 픽스처의 `plannerKind: "KEYWORD"` | **MODIFY** | |
| T13 | `frontend/src/pages/Agent.tsx` — `plannerKind === "LLM" ? "AI 해석" : "규칙 해석"` | **MODIFY** | "규칙 해석" 분기 삭제 |

**테스트 대체 원칙 — 이것이 T9의 핵심이다.** v2에서 테스트는 **planner 전략을 가짜로 만들지 않는다.**
가짜는 **transport 경계**(`planGoal`)에 두고, **실제 모델이 낸 계획을 녹화해서 재생**한다
(`test/support/recordedPlans/*.json`, 각각 어느 모델·언제·어떤 문장에서 나왔는지 기록). 그래서
"keyword planner는 테스트용으로도 없다"가 지켜지면서 CI는 벤더 키 없이 돈다.

### 12.7 fixed command routing을 정상 동작으로 서술하는 문서

| # | 위치 | 판정 |
|---|---|---|
| C1 | `docs/sellerops_operator_graph_v1.md` §0·§4.1·§8·§13 층2·§14 | **MODIFY** — 상단에 v2 supersede 표시(이번 턴 반영) |
| C2 | `docs/decisions/agent-runtime-langgraph-llm-split.md` L10·L41–42·L154 | **MODIFY** — "planner off면 keyword table이 답한다"는 v2에서 거짓 |
| C3 | `docs/sellerops_agent_runtime_migration.md` L41·L77·L272·L385·L445 | **MODIFY** — 역사 문서이므로 **정정하지 않고** 상단에 "v2에서 대체됨" 한 줄 |
| C4 | `docs/demo_runbook_v1.md` L211 | **MODIFY** (X4와 동일 건) |
| C5 | `CLAUDE.md` agent-runtime 소유 문단 · canonical reading path 4행 | **MODIFY** (이번 턴 반영) |
| C6 | `docs/architecture.md` 런타임 표 4행 | **MODIFY** (이번 턴 반영) |
| C7 | `docs/product-scope-v1.md` | **개정 v1.13** (이번 턴 반영) |

### 12.8 명시적으로 유지되는 것 (제거 대상 아님)

`RuleEvidenceJudge` 전체 · `EvidenceDigestFloor` · `digestFor`/`callDigest` · `AttentionCoverage`와
`SignalCoverageView` · `OperatorBudget` 전체 · `OperatorToolRegistry`의 세 거부 · payload floor 테스트 3종 ·
`AgentDraftBoundaryTest` 일반화판 · `memoryScope.test.tsx` · 기존 4개 subgraph의 checkpoint/승인/멱등 계약 ·
collector/Action Window/자격증명 plane 전체.

---

## 13. Product Knowledge 수집·정규화 — 현재 read capability 기준

### 13.1 지금 실제로 얻을 수 있는 것 (§4.1을 한 칸도 옮기지 않고)

| facet | NAVER | Coupang | Cafe24 | 오늘의 출처 |
|---|---|---|---|---|
| 상품명 | ✅ | ❌ | ❌ | 리뷰 export `상품명` → `ReviewRowMapper` |
| SKU / 채널 상품번호 | ✅ (상품번호) | ✅ (sku) | ✅ (`product_no`) | ingest row |
| 채널별 listing 존재 | 파생 가능 | 파생 가능 | 파생 가능 | 어느 채널의 행이 이 상품을 낳았는가 |
| listing name / URL / 가격 / 판매상태 | ❌ | ❌ | ❌ | **없음** |
| 옵션 / variant | ❌ | ✅ (`reviews.source_option_id`, WING 상품평) | ❌ | V37 |
| 브랜드 / 제조사 / 카테고리 | ❌ | ❌ | ❌ | **없음** |
| 상품 설명 / spec | ❌ | ❌ | ❌ | **없음** |
| 상품별 문의·리뷰·이슈 신호 | ✅ | ✅ | 부분(리뷰 `productId=null`) | v1 `ProductSignalsService` |
| 상품별 주문 | ❌ | ❌ | ❌ | `order_daily_summaries`는 **일 단위 집계**, `channel_orders`에 상품 축 없음 |

> 근거: `docs/slices/product-context-diagnosis-groundwork.md` §2–§3 — *"전 채널에 product/catalog
> client가 없다"*, *"오늘 SellerOps의 상품 컨텍스트 전부는 `products.name`과 `products.sku`"*,
> *"`channel_products`는 0행"*. 이 문서는 그 조사를 다시 하지 않는다.

### 13.2 v2가 이번 package에서 실제로 만드는 것 — **마켓 접속 0회**

**A. 파생 조립기 `ProductKnowledgeAssembler` (backend, READ-only).** 이미 저장된 행에서 조립한다:
- identity: `products` + 어느 채널의 어떤 외부 id가 이 상품을 낳았는가
- listings: **드디어 `channel_products`를 쓴다** — `(channel_id, external_product_id)`에 first/last seen과
  source를 기록. 죽은 테이블을 새 테이블로 대체하지 않고 **되살린다**
- variants: Coupang `reviews.source_option_id` distinct
- facts: **`상품명 파생 spec` 만**. 근거는 같은 문서 §3의 관측 — 실제 스마트스토어 제목은 키워드 밀도가
  높아 spec의 상당 부분을 제목이 들고 있다(`4000매`, `하향식`, `일체형`). 파생 fact는 `confidence:
  DERIVED`, `source: NAVER:REVIEW_EXPORT:상품명`, 그리고 **닫힌 key 집합**(수량·형식·규격단위)만.
  제목에서 못 읽으면 fact를 만들지 않는다 — 추론하지 않는다.
- coverage: 위에서 못 채운 facet은 전부 `UNAVAILABLE` + 그 이유

**B. Cafe24 리뷰 ↔ 상품 연결 복구 (v1의 미해결 blocker #3이 여기서 닫힌다).**
`cafe24_community_articles.product_no`가 이미 저장돼 있고, Cafe24 문의는 그 값을 **이미 `sku`로 써서**
상품을 만든다(`Cafe24InquiryArticleMapper`: `sku = row.productNo()`). 그런데 리뷰 승격은
`Cafe24ReviewPromoter:71`에서 `review.setProductId(null)`을 한다. **같은 org 안에서 같은 키가 한쪽은
상품이 되고 한쪽은 버려진다.** v2는 `product_no → products.sku → productId`로 연결한다 —
새 capability 0, 마켓 접속 0, 새 추론 0. 이것으로 `UNCERTAIN_PRODUCT_UNLINKED`의 한 축이 실제로 줄어든다.

**C. 신선도.** 모든 파생 사실은 그 소스 행의 `received_at`을 `observedAt`으로 갖는다. 90일 초과는
`STALE`. "언제 관측한 값인지 모르는 사실"은 저장 자체를 거부한다(§6.3).

### 13.3 v2가 이번 package에서 **만들지 않는 것** (그리고 그 이유)

| 원하는 것 | 유일하게 정당한 경로 | 왜 지금 안 하는가 |
|---|---|---|
| 상품 설명 · spec 원문 · 옵션표 | 채널 **공식 seller-product API** (Official APIs first) | 세 채널 모두 §4.1에 PRODUCT DataType 행이 **없다**. 새 DataType 등재 = §4 discovery checklist 9항 + Cafe24/NAVER **scope 재동의**. → §21-B2 |
| listing 페이지에서 읽기 | — | **금지.** raw HTML/DOM/스크린샷은 Coupang D-limit로 이미 금지이고, 나머지 채널도 같은 규율을 적용한다 |
| 상품 카탈로그 **파일 업로드** | 기존 업로드 spine + 새 매퍼 | 마켓 capability 변경은 0이지만 **새 제품 표면**이다(A7 freeze 인접). → §21-B3 |
| 상품별 주문 | NAVER 주문 API는 이미 per-order를 받지만 **상품 축을 버린다**(V32 주석) | 별건 슬라이스. v2는 "주문 근거 없음"을 정직하게 말한다 |

---

## 14. 기존 seller org를 위한 backfill 전략

**하나의 원칙: 재수집으로는 못 채운다.** ingest는 멱등이라 기존 org에서 `insertedIds`가 비고 follow-up이
no-op이다 — 2026-08-21 라이브 증명에서 실제로 확인됐고, 그것이 v1 패치 B1(customer memory backfill)의
이유였다. v2도 같은 방식으로 **operator-triggered backfill 3종**을 붙인다(전부 org-scoped, bounded,
멱등, READ + 파생 write만).

| # | 엔드포인트 | 무엇을 채우는가 | 멱등성 |
|---|---|---|---|
| BF1 | `POST /api/product-knowledge/backfill` | `channel_products` 되살리기 + variants + 파생 facts | `(channel_id, external_product_id)` upsert |
| BF2 | `POST /api/reviews/product-link/backfill` | Cafe24 승격 리뷰의 `product_id` 연결(§13.2-B) | 이미 연결된 행 skip |
| BF3 | `POST /api/customer-memory/backfill` (**기존, 유지**) + `signature` 재계산 옵션 | 문의 signature(§9) | `content_hash` 캐시 hit는 vendor 재호출 없음 |

**순서가 있다:** BF2 → BF1 → BF3. 리뷰가 상품에 연결된 뒤에야 상품 지식의 신호 축이 정확해지고,
지식이 있어야 signature 재계산이 상품 축을 쓸 수 있다. 순서를 문서로만 두지 않고 **BF1이 BF2 미실행을
감지하면 경고 카운트를 반환**한다.

**신규 org에는 자동으로 걸린다** — `IngestFollowUp`(v1에서 만든 단일 합류점)에 knowledge 조립 한 줄이
더 붙는다. 새 파이프라인이 아니라 기존 합류점의 한 스텝이다.

---

## 15. DB / migration 영향

Flyway forward-only, 현재 max **V47**.

| 버전 | 내용 | 비고 |
|---|---|---|
| **V48__product_knowledge.sql** | `channel_products` 확장(`org_id`, `channel_product_name`, `product_url`, `selling_status`, `currency`, `source_kind`, `observed_at`, `first_seen_at`, `last_seen_at`) + `uq_channel_products_external(channel_id, external_product_id)`; 신규 `product_variants`; 신규 `product_facts(org_id, product_id, fact_key, fact_value, unit, source, observed_at, confidence)` + `uq_product_facts(org_id, product_id, fact_key, source)` | **기존 테이블 재사용**이 핵심. 새 `products_v2`를 만들지 않는다 |
| **V49__inquiry_issue_signals.sql** | `customer_memory_entries`에 `extractor_kind`·`extractor_version` 추가; 신규 `inquiry_signature_cache(org_id, content_hash, signature_key, topic, ask_kind, extractor_version)` + unique | 문의 본문 저장 **없음** — 해시와 라벨만 |

**하지 않는 것:** `review_issue_evidence`에 문의를 넣기 위한 스키마 변경. 그것은 `review_id` FK를
`(source_kind, source_id)`로 바꾸는 파괴적 변경이고, v2는 문의 반복을 `customer_memory_entries` 축에서
답한다(이미 그 목적의 테이블이다). 리뷰·문의 통합 이슈 메모리는 별건.

**데이터 마이그레이션 없음.** 모든 채움은 §14의 backfill 엔드포인트로 하며 SQL로 하지 않는다 —
되돌릴 수 있어야 하고, 실행 여부가 감사에 남아야 하기 때문이다.

---

## 16. FE 변화 (A7 route/menu freeze 유지 — 새 라우트·새 메뉴 0)

| 화면 | 변화 |
|---|---|
| `/agent` | ① **planner 미가용 상태**를 정직하게 렌더(입력 비활성 + "AI 계획 기능이 꺼져 있어 지금은 대화형 요청을 처리할 수 없습니다" + Dashboard 경로 안내). ② `status: "FAILED"` 렌더. ③ **조사 계획 카드** — `informationNeeds`를 "무엇을 확인했는지"로 보여줌(모델 내부가 아니라 판매자가 검증할 수 있는 목록). ④ `clarificationNeeded` = 되묻는 답 렌더. ⑤ "규칙 해석" 라벨 삭제. ⑥ 칩 2개는 explicit intent 전송 |
| `/agent` 답변 카드 | finding마다 **어떤 need에 답한 것인지** + 상품 사실은 `source · observedAt` 동반. `UNAVAILABLE` facet은 "정보 없음"으로, 절대 "문제 없음"으로 렌더하지 않음 |
| `/reports` 상품별 패널 | knowledge coverage 배지 추가(연결된 채널 수 / 미연결) — v1에서 되살린 패널의 확장 |
| `/memory` | **변화 없음.** 검색창 없음 계약과 `memoryScope.test.tsx` 그대로 |
| 그 외 | 변화 없음 |

---

## 17. 단일 구현 package — `Operator Graph v2 Product Assembly`

작은 PR/기능 slice로 쪼개지 않는다. **한 브랜치, 한 package**(`feat/operator-graph-v2`). 아래는 PR 분할이
아니라 **하나의 package 안의 작업 순서**다.

**층 0 — 삭제 먼저.** §12의 DELETE 목록을 먼저 지운다. 나중에 지우면 새 경로가 옛 경로를 폴백으로 쓰게
되고, 그 순간 I2는 영원히 회복 불가능해진다. 이 층이 끝나면 **빌드가 깨진 상태**가 정상이다.

**층 1 — Planner 계약.** `InvestigationPlan` 타입 · `PlanValidator`(V1–V8) · `LlmInvestigationPlanner` ·
backend `AgentPlanPrompt` v2(need/entity 어휘 포함) · `AgentOperatorResponseParser` 확장 ·
`AgentPlanPayloadFloorTest` 갱신 · `plannerFence.test.ts` · `goalRoutingFence.test.ts`.

**층 2 — Product Knowledge.** V48 · `ProductKnowledgeAssembler` · `ProductKnowledgeService` ·
`KnowledgeCoverage` · `ProductKnowledgeView` · Cafe24 리뷰 링크 복구 · BF1/BF2 · `IngestFollowUp` 한 줄.

**층 3 — 반복 문의(§21-B1 결정 시).** V49 · `SemanticIssueSignatureExtractor` · `InquiryAskKind` ·
`inquiry_signature_cache` · `contracts/inquiry-issue/v1/RUBRIC.md` + gold set · BF3 확장.
**결정이 안 나면 이 층만 빠지고 나머지는 그대로 나간다** — 그 경우 반복 문의는 **TOPIC 축만**으로
정직하게 보고된다(§9 완료 조건 미달을 명시).

**층 4 — Graph 재조립.** state v2 채널 · need 기반 specialist 4종 · re-plan 경로 · ReportOps 재작성 ·
tool 3종 추가 · Judge 규칙 3종 · `FAILED` 경로.

**층 5 — FE.** §16.

**층 6 — 문서·증거.** 이 문서 갱신(§구현 결과) · 라이브 증명 문서 · `docs/evidence/INDEX.md` 행.

### Definition of Done
1. `src/` 전체에서 `Planner` 구현체가 1개이고 `kind === "LLM"` (`plannerFence.test.ts` green)
2. `parseGoal`에 자유문장 keyword 표가 없다 (`goalRoutingFence.test.ts` green)
3. planner 미가용 ⇒ `FAILED`, finding 0 (`plannerUnavailable.test.ts` green)
4. §18의 divergence·paraphrase 스위트 green (recorded plans)
5. WRITE tool 0 · privileged plane 비노출 (v1 테스트 + 신규 fence green)
6. 모든 상품 사실이 `source`+`observedAt`을 가짐 · `UNAVAILABLE`과 "문제 없음"이 문장 수준에서 구분됨
7. 4개 subgraph 회귀 0 · `memoryScope.test.tsx` **수정 없이** green
8. backend/frontend/agent-runtime/collector 전체 스위트 green
9. **실데이터 라이브 증명** 통과(§18.3)

---

## 18. 테스트 / acceptance 철학

**특정 4개 문장을 맞추는 것은 완료 조건이 아니다.**

### 18.1 CI에서 증명 가능한 것 (벤더 키 없이)

| 스위트 | 무엇을 고정하는가 |
|---|---|
| `plannerFence` · `goalRoutingFence` · `privilegedPlaneFence` | 구조적 invariant(I2·I4) |
| `planValidator.contract` | V1–V8 각각의 거부 |
| `plannerUnavailable` | 실패가 실패로 끝난다 |
| `planDivergence` (**recorded plans**) | 규격 질문 · 교환 정책 질문 · 과거 구매 차이 질문이 **서로 다른 informationNeeds와 다른 tool multiset**을 만든다 |
| `paraphrase` (**recorded plans**, 목표군당 ≥5 표현) | 같은 목표의 다른 표현이 **같은 need 집합**(정확히 같은 tool 순서가 아니라)에 도달한다 |
| `productKnowledgeCoverage` | UNAVAILABLE ≠ 문제 없음 |
| `reportOpsNoNewFacts` | §8 |
| 기존 v1 스위트 전부 | 회귀 0 |

**recorded plan의 정직한 한계 — 반드시 명시한다.** 녹화된 계획은 *그때 그 모델이 그 문장에 낸 계획*이다.
CI는 **계약·검증·발산의 구조**를 고정할 뿐 **일반화를 증명하지 못한다.** 일반화는 §18.3에서만 증명된다.
녹화 파일마다 모델·일시·프롬프트 버전을 함께 저장하고, 프롬프트 버전이 바뀌면 재녹화한다.

### 18.2 판정 기준 (v2 실패로 보는 것)

- 규격 질문 · 교환 정책 질문 · 과거 구매 차이 질문이 **동일한 고정 tool sequence**로 실행됨 → **실패**
- planner unavailable/failure 상태에서 **정상 답변이 생성됨** → **실패**
- 근거 없는 상품 사실 단정이 답변에 도달 → **실패**
- `UNAVAILABLE`을 "문제 없음"으로 렌더 → **실패**

### 18.3 실데이터 라이브 증명 계획 (별도 승인 후 실행, 마켓 접속 0회)

대상은 v1 증명과 같은 로컬 org(데모 제조사: 리뷰 3,916 · 문의 3,220 · 상품 64). 마켓에 접속하지 않으므로
`docs/sellerops_live_approval_contract.md`의 마켓 승인은 필요 없고, **planner capability를 그 org에만
켜는 것**이 이번 증명의 유일한 노출이다.

1. V48(+V49) 적용 확인 · 전 서비스 재기동
2. BF2 → BF1 (→ BF3) 실행, **전후 카운트 대조**: `channel_products` 0 → N, Cafe24 리뷰 `product_id` null → M,
   `UNCERTAIN_PRODUCT_UNLINKED` 신호 수 감소량
3. planner **ON**으로 3개 질문군 × 5개 paraphrase = 15 run. 각 run의 `informationNeeds`·tool 순서 기록
4. **발산 확인**: 세 질문군의 tool multiset이 실제로 다른가 (같으면 v2 실패로 보고)
5. **일반화 확인**: 같은 질문군의 5개 표현이 같은 need 집합에 도달하는가
6. planner **OFF**로 같은 15 run → **전부 `FAILED`** (정상 답변 0건)
7. 상품 사실 인용 검증: 모든 fact가 `source`+`observedAt`을 갖고 SQL과 일치
8. WRITE 0 · credential plane 미접촉 재확인
9. §9의 RUBRIC 측정치 보고(층 3이 포함된 경우)

**실행 기록 (2026-08-23).** 이 계획의 첫 실측이 `docs/agent_real_validation_v1.md`에 있다 — REAL 3채널 데이터 위 6개 셀러 질문, planner OFF 6/6 `FAILED`(결정론 fallback 부재 확인) → planner ON 6/6 `DONE`, **plan divergence 실재**. 동시에 §18.2의 실패 조건 중 **"근거 없는 상품 사실 단정이 답변에 도달"이 실제로 발생**했다(Q4). 그 결과가 `Agent Evidence Scope Integrity v1`의 착수 근거다.

---

## 19. requirement → implementation → test → live proof traceability

| # | requirement (출처: 제품 오너 지시) | implementation | test | live proof |
|---|---|---|---|---|
| R1 | Product-centered | §6 ProductKnowledge · §13.2-B Cafe24 링크 복구 | `productCentered` · `productKnowledgeCoverage` | 18.3-② 링크 복구 전후 카운트 |
| R2 | LLM-first planning, 결정론 planner 전면 삭제 | §12.1 D1–D11 · §12.2 K1–K7 · 층1 | `plannerFence` · `goalRoutingFence` | 18.3-③ |
| R3 | planner 없으면 run 실패 | §4.3 `FAILED` | `plannerUnavailable` | 18.3-⑥ |
| R4 | Planner가 단순 intent label 이상을 표현 | §4.1 `InvestigationPlan` 10필드 | `planValidator.contract` | 18.3-③ 기록 |
| R5 | Validator는 계획을 대신 만들지 않는다 | §4.2 V1–V8 (추가·보정 금지) | `planValidator.contract` (보정 시도 = 실패) | — |
| R6 | 고정 retrieval 순서 금지 | §7 · §12.5 M1–M4 | `planDivergence` | 18.3-④ |
| R7 | 서로 다른 정보 요구 ⇒ 서로 다른 plan | §4.1 `informationNeeds` | `planDivergence` | 18.3-④ |
| R8 | paraphrase 일반화 | §4 planner | `paraphrase` (recorded) | 18.3-⑤ (**여기서만 진짜 증명**) |
| R9 | Evidence — 상품 knowledge에도 provenance·coverage | §6.2 · §6.3 | `productFactProvenance` | 18.3-⑦ |
| R10 | "정보 없음" ≠ "사실이 아님" | §6.2 · Judge `UNVERIFIED_PRODUCT_FACT` | `productKnowledgeCoverage` · FE 렌더 테스트 | 18.3-⑦ |
| R11 | WRITE 0 · privileged plane 비노출 | §10 (v1 구조 유지) | `operatorToolRegistry` · `privilegedPlaneFence` | 18.3-⑧ |
| R12 | ReportOps는 새 사실의 출처가 아님 | §8 · §12.5 M4 | `reportOpsNoNewFacts` | 18.3-③ 중복 finding 0 |
| R13 | 반복 문의를 **실제 corpus에서** 찾는다 | §9 (port 재사용 + `InquiryAskKind`) | `contracts/inquiry-issue/v1/RUBRIC.md` gold set | 18.3-⑨ (**B1 결정 필요**) |
| R14 | Dashboard 레인은 결정론 허용 | §3 · §12.2 K3–K5 KEEP | `parseGoal` intent 케이스(T2/T4) | 4개 subgraph 회귀 0 |
| R15 | 기존 business logic 재구현 금지 | v1 R1 유지 | 기존 스위트 | — |
| R16 | 기존 org backfill | §14 BF1–BF3 | backfill 멱등 테스트 | 18.3-② |

---

## 20. v1과의 관계 · 유지되는 fence

**v1에서 그대로 살아 있는 것:** Evidence 일급 상태 · `EvidenceRef → Finding` 추적 · rule judge와 AND 결합 ·
`EvidenceDigestFloor` · bounded budget과 fail-closed 종료 · `OperatorToolRegistry`의 세 거부 ·
`AttentionCoverage` false-calm 계약 · READ 전용 catalogue · backend 유일 LLM egress · 세 capability 세 flag
세 payload floor · v1이 복구한 감사 A/B/C/D · `IngestFollowUp` 합류점 · 라이브 패치 B1–B5.

**v2가 무효화하는 v1 문장:** §4.1의 planner 폴백 · §8의 catalogue 전량 인가 · §13 층2의 결정론 planner 층 ·
§14의 "데모 4문항 = 완료 조건" · §16의 blocker #3(§13.2-B에서 닫힌다).

**이 문서도 바꾸지 않는 것:** §4.1 capability 표의 어떤 칸도 옮기지 않는다 · 셀러 채널 집합
(NAVER/Coupang/Cafe24) · A7 FE freeze · 라이브 승인 계약 · Coupang D1–D8 · collector/Action Window/
자격증명 plane · §7.2 채널 쓰기 금지 · §7.18 OperationRun 금지.

---

## 21. 구현 전 product-owner 결정이 필요한 것

**진짜 blocker 2건, 결정 요청 2건.**

### B1 (BLOCKER) — 문의 corpus의 의미 기반 분류 = 새로운 노출 등급
§9의 완료 조건은 실제 문의 본문을 의미적으로 분류할 것을 요구한다. 현재 승인된 LLM 노출은
**건별 초안**(`sellerops.agent.draft.*`, 셀러가 한 건을 열었을 때)이다. corpus 단위 분류는 3,220건을
한 번에 vendor로 보내는 것이며 **다른 등급**이다. 제안 기본값: **org opt-in · 자기 flag
(`sellerops.inquiry.signature.*`) · content-hash 캐시로 1회만 · 닫힌 어휘 라벨만 반환·저장 · 임베딩 없음
(v1.12 ②의 임베딩 금지 유지) · 배치 상한**. **이 결정이 없으면 층 3을 실행하지 않는다.**

### B2 (BLOCKER) — 상품 설명 / spec / 가격 / 브랜드를 실제로 가져올 것인가
§13.3: 세 채널 모두 §4.1에 PRODUCT DataType 행이 없다. 가져오려면 (a) 채널별 공식 seller-product API
discovery(§4 체크리스트 9항, **external-research required**) + (b) Cafe24/NAVER **scope 재동의**(셀러가
다시 승인해야 한다) + (c) §4.1에 새 행 등재. **이것 없이 v2는 "무엇을 팔고 있는지"를 상품명·SKU·채널
연결·옵션까지만 안다.** 제안 기본값: **v2는 파생 조립만 하고 나머지는 `UNAVAILABLE`로 정직하게 말한다.**
API 경로는 별도 슬라이스.

### D3 (결정 요청) — 상품 카탈로그 파일 업로드를 v2에 넣을 것인가
마켓 capability 변경 0으로 설명·spec·가격을 실제로 얻는 유일한 경로. 기존 업로드 spine을 쓰지만
**새 제품 표면**이다(A7 인접). 제안 기본값: **v2에서 하지 않음**(선제적 제품화 금지 지시에 따름).

### D4 (결정 요청) — planner off 배포에서 `/agent`의 태도
I2에 따라 planner 없이는 Agent chat이 동작하지 않는다. 제안 기본값: **라우트·메뉴 유지(A7 freeze),
화면 안에서 입력 비활성 + 이유 명시 + Dashboard 경로 안내.** 숨기지 않는다.

### 확인만 필요(진행 지장 없음)
- Cafe24 리뷰 링크 매핑 정책(`product_no → sku`)이 **셀러 의도와 일치**하는지 — 기술적으로는 Cafe24 문의가
  이미 같은 매핑을 쓰고 있어 새 정책이 아니라 **일관성 회복**이다.
- 상품별 주문 근거 부재(§13.1 마지막 행)는 v2 범위 밖으로 둔다.


---

## 22. 구현 결과 — 계획과 달라진 것 (2026-08-21)

### 22.1 계획대로 된 것

§12의 DELETE 목록은 전부 삭제됐고 `plannerFence` / `goalRoutingFence` / `privilegedPlaneFence`가 그것을
구조로 고정한다. `InvestigationPlan`·`PlanValidator`(V1–V8)·`LlmInvestigationPlanner`·need 기반 specialist
4종·`FAILED` 경로·Product Knowledge 계층(V48)·semantic inquiry signature(V49)·backfill 3종·FE 두 lane —
전부 계획대로 랜딩했다. WRITE tool은 0개이고 privileged plane은 노출되지 않았다.

### 22.2 계획과 다르게 한 것

| # | 계획 | 실제 | 이유 |
|---|---|---|---|
| 1 | PRODUCT read는 §21-B2 결정 후 별건 | **이번 package에 포함** | product-owner가 기본안을 기각하고 신설을 지시(B2) |
| 2 | Cafe24 리뷰 링크 복구가 §13.2-B의 핵심 성과 | **이 org에서는 발현되지 않음**(미연결 리뷰 0건) | 복구는 구현·테스트로 증명, 실효는 다른 org에서 |
| 3 | budget v1 그대로 | **maxToolCalls 24 / maxLlmCalls 12 / 180s** | v1 예산은 고정 시퀀스용이었고 4개 need짜리 실제 계획을 감당하지 못했다(라이브 L5·L6) |
| 4 | `sampleGoals` 이름만 변경 | `/capabilities`에 **`freeTextPlanning`** 추가 | 화면이 "왜 입력이 막혔는지"를 알아야 하는데, 이 route는 public이고 capability는 org 단위라 `unknown`이 유일하게 정직한 값 |
| 5 | recorded plans는 실제 모델 녹화 | **AUTHORED(수기 작성) 상태로 유지** | 실행 중 wire JSON을 저장하지 않았다. CI는 계약·발산 구조만 고정하고, **일반화는 §18.3의 15회 라이브 실행이 증명**한다. 파일이 그렇게 표시한다 |
| 6 | TOPIC 축은 그대로 | **그대로 두되, 오염을 기록** | 이 org의 TOPIC 반복 상위 4개가 전부 스팸 집계다. 고치려면 스팸 필터가 필요하고 그것은 홈 화면의 미답변 수에도 영향을 준다 — 제품 결정(§23-D1) |

### 22.3 라이브가 드러낸 결함 9건

전부 최소 변경으로 고치고 회귀를 붙였다. 목록과 증거는
`docs/operator_graph_v2_local_integration_proof.md` §6. 이 중 **V50**은 새 마이그레이션이다.

---

## 23. 남은 product-owner 결정

### D1 (신규, 중요) — 문의 corpus의 스팸
데모 org의 문의 **3,220건 중 3,201건이 고객 문의가 아니라 계정·DB 판매 스팸 게시물**이다(Cafe24 공개
문의 게시판). semantic classifier는 그것을 **전부 거절**했지만, 규칙 기반 TOPIC 축과 **홈 화면의
"답변이 필요한 문의 3,208건"** 은 여전히 그것을 세고 있다. 스팸을 어떻게 다룰지는 수집·표시·카운트
전반에 걸친 제품 결정이며 v2 scope 밖이다.

### D2 — 반복 문의는 LIMITATION으로 남는다
RUBRIC G3(반복 이슈 ≥5개, 각 occ ≥3) 미달(4개). 진짜 문의 19건에 대해서는 19/19 정확하지만, 이 org의
진짜 문의 모수가 19건이라 통계적 결론을 낼 수 없다. **corpus를 정제하거나 다른 org에서 재측정해야 한다.**

### D3 — 채널 PRODUCT read의 실제 연결
세 connector 모두 구현·오프라인 검증 완료, wire shape는 `NEEDS_VERIFICATION`. 실제로 켜려면:
**Cafe24** `mall.read_product` 스코프 재동의(기존 연결은 `mall.read_community,mall.read_order`만 보유),
**NAVER** 판매자 애플리케이션의 상품 API 권한, **Coupang** 기존 HMAC 키로 가능하나 라이브 미검증.
세 가지 모두 **판매자의 행동이 필요**하며 우회하지 않았다.
