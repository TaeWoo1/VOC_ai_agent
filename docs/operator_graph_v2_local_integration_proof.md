# Operator Graph v2 — 로컬 통합 라이브 증명 (2026-08-21)

> **무엇을 증명했는가.** `feat/operator-graph-v2`의 구현을 **실제 SellerOps 데이터** 위에서 실행하고,
> v2의 네 invariant가 실제로 성립하는지, 그리고 실데이터가 어떤 결함을 드러내는지 기록한다.
>
> **무엇을 증명하지 않았는가.** **마켓플레이스에 한 번도 접속하지 않았다.** 신설된 PRODUCT read
> capability(NAVER·Coupang·Cafe24)는 **오프라인 검증만** 됐고, 그 wire shape는 여전히
> `NEEDS_VERIFICATION`이다. 따라서 `docs/multi-channel-connector-roadmap.md` §4.1의 **어떤 칸도 옮기지
> 않는다.** 이 문서는 마켓 라이브 증명이 아니다.
>
> **승인 상태.** 마켓 접속 0회이므로 `docs/sellerops_live_approval_contract.md`의 1회성 마켓 승인은
> 필요하지 않았다. 이번 실행의 유일한 노출은 **plan / judge / inquiry-signature capability를 데모 org
> 하나에만 켠 것**이다(`*` 아님). 키는 draft capability에 이미 설정돼 있던 값을 in-process로 전달했고
> 읽거나 출력하지 않았다.

## 0. 한 줄

**세 종류의 질문이 실제로 세 개의 다른 조사를 만들었고, planner를 끄자 다섯 요청이 모두 실패했으며,
WRITE tool은 끝까지 0개였다.** 그 과정에서 실데이터가 **7건의 결함**을 드러냈고 전부 최소 변경으로
고쳤다 — 그중 하나는 이 org의 문의 corpus 중 **3,201건이 고객 문의가 아니라 스팸**이라는 사실이다.

---

## 1. 대상과 상태

| | 값 |
|---|---|
| org | `7146c50f-…d8e0` "데모 제조사" |
| 리뷰 / 문의 / 상품 | 3,916 / 3,220 / 64 |
| 마이그레이션 | **V48**(product knowledge, 57ms) · **V49**(inquiry semantic signals, 36ms) · **V50**(provider_version 폭, 라이브 중 발견) |
| 실행 전 파생 상태 | `channel_products` **0** · `product_facts` **0** · `product_variants` **0** · 문의 signature **0 / 3,220** |

---

## 2. Product Knowledge — 마켓 접속 0회로 실제로 채워졌는가

**BF2 (Cafe24 리뷰 상품 연결 복구)** — `scanned=0, linked=0`.
이 org에는 미연결 리뷰가 **0건**이고 Cafe24 board article도 **0건**이다. 즉 v2가 고친 불일치는 **이
org에서는 발현되지 않는다.** 복구 자체는 `ProductKnowledgeChainTest`가 실데이터 형태로 증명한다.

**BF1 (Product Knowledge 파생)** — `scanned=64, listings=58, variants=0, facts=9`.

| 결과 | 값 | 해석 |
|---|---|---|
| `channel_products` | 0 → **58** | V1부터 존재했지만 0행이던 테이블이 처음으로 채워졌다 |
| 미생성 6건 | SKU 없는 상품 | 채널 식별자가 없으면 listing 정체성이 없다 — 만들지 않는 것이 정답 |
| `product_facts` | 0 → **9** | 전부 `spec:수량`, `DERIVED:TITLE`, `confidence=DERIVED` |
| `product_variants` | **0** | 이 org의 리뷰에 `source_option_id`가 없다(Coupang WING 경로만 채운다) |

**파생 사실은 전부 실제 제목의 파싱이다** — `세모금컵 4000매 …` → `수량 4000 매`. 9건 전부 검수했고
잘못된 값은 없다. 제목이 아무것도 말하지 않는 55개 상품은 **사실을 만들지 않았다.**

**한 상품의 실제 응답(요약):**

```
IDENTITY   AVAILABLE   (products)
LISTING    UNAVAILABLE (DERIVED:INGEST)   ← 파생 listing은 '존재'만 말하지 이름·가격을 말하지 않는다
PRICE      UNAVAILABLE
VARIANT    UNAVAILABLE
SPEC       AVAILABLE   (DERIVED:TITLE)
SIGNALS    AVAILABLE   ← 별도 축(AttentionCoverage): REVIEW/ITEM_ANALYSIS/CUSTOMER_MEMORY 전부 COVERED
```

두 coverage 축이 한 응답 안에 **나란히** 나오고 서로 다른 답을 한다. 이것이 §6.2가 두 enum을 분리한
이유이며, 실데이터에서 그대로 확인됐다.

---

## 3. 조사 발산(divergence) — v2의 합격 조건

실제 LLM planner ON, 같은 상품(`전선몰딩 1호 (백색)`)에 대한 세 종류의 질문:

| 질문 | specialists | needs | 사용 tool | 종료 |
|---|---|---|---|---|
| **폭이 몇 mm인가요?** | `PRODUCT_OPS` | 2 (규격 확인 · 옵션별 차이) | `get_product_knowledge`, `search_product_facts` | COMPLETE |
| **교환 가능한가요?** | — (되물음) | 3 (정책 · 과거 승인 답변 · 예외 조항) | 없음 | CLARIFICATION_NEEDED |
| **전에 산 것과 색이 달라요** | `PRODUCT_OPS` + `INQUIRY_OPS` + `REVIEW_OPS` | 4 (리스팅/옵션 · 색상 사실 · 색상 반복 신호 · 과거 대응) | `get_product_knowledge`, `search_product_facts`, `search_review_issues` | COMPLETE |

**셋은 같은 고정 tool sequence로 실행되지 않았다.** need 목록도, specialist 조합도, 종료 이유도 다르다.
§18.2가 정의한 v2 실패 조건에 해당하지 않는다.

특히 **교환 질문의 되물음이 옳다**: 모델은 "교환 가능 여부는 채널 정책·주문 경과일·개봉 여부에 따라
달라진다"며 그 정보를 요구했다. 정책 근거 없이 "교환됩니다"라고 답하지 않았다 — I3이 문장 수준에서
지켜졌다.

### 3.1 Paraphrase — 3 목표군 × 5 표현 = 15회

| 목표군 | DONE | FAILED | needs 범위 | 실제 사용 tool 집합 |
|---|---|---|---|---|
| 규격 | 4 | 1 | 1–2 | `get_product_knowledge`, `search_product_facts` |
| 교환 정책 | 5 | 0 | 1–4 | `get_inquiry_thread_context` **(상품 tool 0회)** |
| 과거 구매 차이 | 4 | 1 | 3–4 | 위 둘 + `search_review_issues` |

**목표군 사이의 tool 집합이 겹치지 않는다** — 정책 질문은 15회 중 한 번도 상품 tool을 부르지 않았고,
차이 질문만 리뷰 신호를 봤다. 키워드가 없어도(예: "마음에 안 들면 바꿀 수 있나요") 정책 축으로 갔다.

**2/15 실패**(둘 다 `PLAN_INVALID`). 긴 문장에서 plan 생성이 출력 예산을 넘겼고, 런타임은 **답을 지어내지
않고 실패로 끝냈다.** 정직한 실패이지만 13%는 남은 한계다(§6).

---

## 4. Planner OFF — 다섯 요청 전부 실패

| 요청 | 결과 |
|---|---|
| 규격 / 정책 / 차이 / 오늘 / 주간보고 (5건) | **전부 `FAILED` · `PLANNER_CAPABILITY_OFF` · `answer` 필드 없음** |
| Dashboard lane (`intent: HANDLE_OPERATIONS_ISSUES`) | **`DONE`** |

정상 답변 0건. 대체 답변 0건. 그리고 두 lane의 분리가 실제로 성립한다 — 계획 기능이 꺼진 배포에서도
버튼 경로는 그대로 동작한다.

---

## 5. 반복 문의 semantic detection — 그리고 corpus가 드러낸 것

capability를 데모 org에만 켜고 **200건 한 페이지**를 분류했다(rubric의 gold-set 크기).

```
scanned=200  distinct texts=190  classified=9  declined=181
```

첫눈에는 4.7%짜리 실패로 보인다. **실제 원인은 corpus였다.**

### 5.1 이 org의 문의 3,220건 중 3,201건은 고객 문의가 아니다

본문 검사 결과 **3,201건이 HTML이고, 그 내용은 계정 판매·DB 판매 스팸 게시물**이다(Cafe24 공개 문의
게시판에 올라온 광고). 평균 1,374자.

| 구분 | 건수 | 분류 결과 |
|---|---|---|
| 진짜 고객 문의 (HTML 아님) | **19** | **19건 전부 분류됨 (100%)** |
| 스팸 게시물 | **3,201** | **0건 분류됨** |

**모델은 스팸을 전부 거절했다.** 이것은 G4(분류 불가한 것에 패턴을 만들지 않는다)의 가장 강한 형태이며,
`기타`가 1,777건짜리 "반복 문의"를 만들던 실패의 정확한 반대다.

### 5.2 진짜 문의 19건의 분류 (단일 검수자 판정 — 합의 절차 없음)

| signature | 문의 유형 | 판정 |
|---|---|---|
| `제품정보:규격` ×3 | "폭이 몇 mm인가요? 굵은 전선도 들어가나요?" | 정확 |
| `설치:가능여부` ×3 | "곡면 벽에도 시공 가능한가요?" | 정확 |
| `색상:재고` ×3 | "색상 아이보리 재고 있나요?" | 정확 |
| `제품정보:비용` ×3 | "추가 양면테이프는 따로 사야 하나요?" | 정확(가능여부도 가능) |
| `가격:가능여부` ×2 | "대량 구매 시 할인 가능한지" | 정확 |
| `설치:방법` ×2 | "절단은 어떤 도구로 하면 되나요?" | 정확 |
| `제품정보:재고` ×1 | "재입고 일정 알려주세요" | 정확 |
| `색상:가능여부` ×1 | "색상 옵션 추가 예정 있나요" | 정확 |
| `사이즈:규격` ×1 | "폭이 몇 mm인가요 배송 문의드립니다" | **일관성 결함** — 같은 질문이 다른 topic |

### 5.3 RUBRIC v1 판정

| 게이트 | 기준 | 실측 | 판정 |
|---|---|---|---|
| G1 recall | ≥ 0.60 | **1.00** (19/19 진짜 문의) / 0.006 (전체 corpus 기준) | **조건부 통과** — 분모를 무엇으로 두느냐가 전부다 |
| G2 precision | ≥ 0.80 | **1.00** 정확도 / 일관성 결함 1건 | **통과** |
| G3 유용한 반복 이슈 | ≥ 5개 (occ ≥ 3) | **4개** (occ 3) + 2개(occ 2) | **미달** |
| G4 조작된 패턴 없음 | 0건 | **0건** (스팸 3,201건 전부 거절) | **통과** |

**따라서 이 항목은 완료가 아니라 LIMITATION으로 보고한다.** G3가 미달이고, G1은 corpus를 정제해야만
의미 있는 수치가 된다. 다만 **0 → 6개의 실제 반복 이슈**는 실측된 개선이다:

```
SIGNATURE | 색상 재고        occ 3 (답변 2)
SIGNATURE | 설치 가능여부     occ 3 (답변 2)
SIGNATURE | 제품정보 규격     occ 3 (답변 2)
SIGNATURE | 제품정보 비용     occ 3 (답변 2)
SIGNATURE | 가격 가능여부     occ 2
SIGNATURE | 설치 방법         occ 2
```

### 5.4 TOPIC 축은 여전히 스팸을 세고 있다

```
TOPIC | 품질  occ 523     TOPIC | 사이즈 occ 473
TOPIC | 배송  occ 240     TOPIC | 가격   occ 195
```

이 숫자는 **스팸 게시물에 규칙 기반 분류기를 적용한 결과**다. SIGNATURE 축은 깨끗하고 TOPIC 축은
오염돼 있다. **이번 scope에서 고치지 않는다** — 스팸 필터는 새 capability이고, 무엇보다 이 문제는
홈 화면의 "답변이 필요한 문의 3,208건"에도 그대로 영향을 준다. 제품 결정이 필요하다(§7-D1).

---

## 6. 실데이터가 드러낸 결함 7건 — 전부 수정 + 회귀 추가

| # | 결함 | 어떻게 드러났는가 | 수정 | 회귀 |
|---|---|---|---|---|
| **L1** | `provider_version varchar(64)`가 너무 좁음 | 첫 실제 분류의 INSERT가 실패 — **모델을 부른 뒤에** | **V50** 마이그레이션, 256 | `theVersionStringFitsItsColumn` |
| **L2** | 문의 본문이 HTML인데 그대로 모델에 전송 | 3,201/3,220이 HTML임을 확인 | `InquiryText` 정규화(해시 키도 정규화 후) | `InquiryTextTest` 9건 |
| **L3** | 분류 실패 이유가 전부 `off_schema` 한 덩어리 | 181건이 같은 라벨이라 진단 불가 | `model_declined`/`off_vocabulary_*`/`fallback_topic` 분리 | 〃 |
| **L4** | inquiry-signature 출력 예산 200 | 50건 중 2건 `budget_exhausted` | 기본값 2000 (draft capability가 이미 문서화한 함정) | 설정 + 주석 |
| **L5** | plan 출력 예산 2000 | 3개 질문군 중 2개가 `budget_exhausted` | 기본값 6000 | 설정 + 주석 |
| **L6** | 진전 없는 pass가 re-plan을 삼 | "이 제품"(지시대명사)에서 LLM 예산 전부 소모, 진짜 답("찾지 못했습니다")을 예산 실패로 덮음 | `learnedSomething` 가드 | `the re-plan loop stops when a pass learns nothing` |
| **L7** | 두 번째 pass가 확정된 need를 PENDING으로 되돌리고 같은 문장을 두 번 출력 | 규격 답변이 같은 문장 2회 | need reducer는 전진만 · `dedupeStatements` | `a second pass may add, but never un-say` (2건) |
| **L8** | 상품 단위 customer-memory 조회가 400 | 차이 질문에서 `INQUIRY_OPS 조회에 실패` | `productId`도 정당한 cue로 허용 | 컨트롤러 문서화 |
| **L9** | 파생이 실제 catalogue read 옆에 두 번째 listing 생성 | 오프라인 테스트가 라이브 전에 잡음 | 실제 read가 있는 채널은 건너뜀 | `a derivation never overwrites…` |

L6·L7은 **v1이 같은 계열의 실수를 한 자리**(같은 숫자 두 번 출력)의 재발이며, 이번에는 구조로 막았다.

---

## 7. 안전 fence — 끝까지 유지

| fence | 확인 |
|---|---|
| WRITE tool 0개 | catalogue 15개 tool, action class **`READ` 하나뿐** |
| privileged plane 비노출 | `privilegedPlaneFence` — submission·credential·action_window·collect·send 계열 이름 0건 |
| planner 구현체 1개 | `plannerFence` — `src/` 전체에서 `implements Planner` 1개, `kind === "LLM"` |
| 자유문장 keyword 라우팅 없음 | `goalRoutingFence` — `parseGoal`에 keyword 표·text 매칭 없음 |
| 외부 발송 | `/capabilities` → `externalSend: disabled` |
| 마켓 접속 | **0회** |
| credential | 읽지도 출력하지도 않음. 키는 in-process 전달 |

---

## 8. 전체 회귀

| 스위트 | 결과 |
|---|---|
| backend | **2,565 통과 / 0 실패** |
| frontend | **2,213 통과** |
| agent-runtime | **232 통과 / 23 skip** |
| collector | **9,150 통과 / 150 skip** |

---

## 9. 종료 상태

스택은 **기본 posture로 복원**했다 — plan / judge / inquiry-signature 전부 off. 남은 데이터:
`channel_products` 58, `product_facts` 9, `inquiry_signature_cache` 190행(그중 9건이 라벨).
캐시가 남아 있으므로 같은 문의를 다시 분류해도 **재전송은 일어나지 않는다.**
