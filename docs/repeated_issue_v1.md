# Repeated Issue v1 — 반복되는 문제 하나를 판단하고 추적하는 화면

**날짜:** 2026-09-13 · **상태:** `IMPLEMENTED · LOCAL_BROWSER_QA_PASS` · **v1.1 closeout 2026-09-13**
**마이그레이션 0 · 새 테이블 0 · 새 enum 0 · 새 classifier 0 · 새 LLM capability 0 ·
마켓플레이스 호출 0 · WRITE 0 · 모델 호출 0 · DB 행 변경 0**

개별 리뷰가 아니라 **반복되는 문제 하나**를 판매자가 판단하고 추적할 수 있게 한다.
Review Decision Workspace v1이 「리뷰 하나」에 대해 한 일을 「문제 하나」에 대해 한다.

---

## 0. 감사 먼저 — 이번에도 대부분 이미 있었고, 화면이 닿지 않았다

| 최소 UX 요구 | 이미 있었나 | 어디에 |
|---|---|---|
| 문제 요약 / severity / lifecycle | **있음** | `ReviewIssue` · `IssueSeverity` · `IssueLifecycleState` (5값) |
| 최근 증가/감소/변화 신호 | **있음, 이미 렌더됨** | `IssueChangeView` ← `IssueChangeRules` + `ReviewIssueThresholds` |
| 대표 evidence | **있음, 이미 렌더됨** | `ReviewIssueDetailView.evidence` (인용 3건 + 마스킹된 수) |
| issue-level seller decision | **있음** | `IssueLifecycleState` + `/acting` · `/remediated` · `/dismiss` · `/restore` |
| issue-level action/status | **있음** | 같은 lifecycle |
| decision history | **있음, 이미 렌더됨** | `review_issue_state_events` → `ReviewIssueDetailView.history` |
| 어떤 상품에서 얼마나 반복되는지 | **절반** | `IssueEvidenceSummaryView.byProduct` 는 있었고 **프론트 소비자가 0** |
| evidence count + 해당 상품 review denominator | **없음** | 분모가 어디에도 없었다 |
| 관련 Seller Knowledge / product context | **없음(화면에)** | `KnowledgeMentionCheck` 는 있었으나 개선 기회 안에서만 암묵적으로 쓰였다 |
| Workspace ↔ `/memory/{issueId}` 양방향 | **한 방향** | 리뷰→문제는 있었고, 문제→리뷰는 **인박스에 이미 로드된 행에만** |

그래서 이 패키지가 만든 것은 새 진실이 아니라 **읽는 쪽 하나와 분모 하나**다.

## 1. 화면 순서

무슨 문제인가 → 왜 지금 보는가 → **어디서 얼마나 반복되는가** → 누가 무슨 말을 했나 →
**우리가 이미 써 둔 것이 있나** → 무엇을 할 수 있나(개선 기회) → **무엇을 하기로 했나** → 무엇을 했나

`/memory/{issueId}`는 새 라우트가 아니다. 같은 주소에서 같은 객체를 계속 연다.

## 2. 읽기는 둘이고, **따로 실패한다**

```
GET /api/review-issues/{issueId}                 (기존) 문제 · 근거 · 기록
GET /api/review-issues/{issueId}/repeat-context  (신규) 어디서 얼마나 · 우리가 써 둔 것
```

둘을 `Promise.allSettled`로 함께 띄우고 **각자 정착시킨다**. 하나가 죽어도 다른 하나는 그린다 —
합치면 한쪽의 실패가 다른 쪽을 가린다. 그리고 **못 읽은 블록은 아무것도 그리지 않는다**:
「0개 상품」은 보지 못한 사실에 대한 주장이고, 판단하는 화면에서 지어낸 0이 가장 나쁜 출력이다.

**이 컨트롤러에 write는 없다.** 반복 문제에 대한 판매자의 결정은 issue lifecycle이고,
그 네 transition은 lifecycle이 생긴 이래 `ReviewIssueController`의 것이다. 같은 결정으로 가는
두 번째 문은 언젠가 첫 번째 문과 다른 말을 한다.

**모델 호출 0.** 반복 문제를 여는 것이 벤더 왕복을 사서는 안 된다 — retrieval의 두 단계는 검색마다
새로 이루어지는 모델 호출이고, 아무도 아직 인용해 달라고 하지 않은 문단을 위해 여는 값이 돈이 된다.
라이브러리가 **무엇을 가졌는가**는 결정론적 낱말 대조이고, 그것으로 **답할 수 있는가**는 초안을 쓰는
자리에서 묻는 질문이다.

## 3. 분모 — 이 패키지의 본체이자 가장 위험한 숫자

`IssueProductEvidenceView`에 칸 하나(`productReviews`)를 더했다. **분자 옆에 둔 것이 설계다** —
따로 다니는 분모는 언젠가 다른 모집단을 가리킨다. 둘 다 org 범위이고 둘 다 `realDataOnly`를 지난다.

**그리고 이 쌍은 비율이 아니다.** 「이 상품 리뷰 1,761건 중 16건이 이 문제를 말했습니다」는 그대로 참이다 —
16건이 그렇게 말했다. 나머지 1,745건이 괜찮다는 뜻은 **아니다**: 추출기는 본문이 있는 리뷰만 읽으므로
읽은 적 없는 리뷰가 분모에는 있고 분자에는 구조적으로 들어갈 수 없다. 그 둘을 나눈 퍼센트는 **아무도
측정하지 않은 「검사된 모집단」에 대한 주장**이고, 하필 사람이 보고 행동할 바로 그 숫자다.
⇒ `repeatLine()`이 쌍을 렌더하고 무엇을 세는지 말한다. 테스트가 `%`·퍼센트·비율의 부재를 단언한다.

**어느 상품에도 연결되지 않은 근거는 따로 말한다.** 그 행들은 이슈 총계에 있고 어떤 상품 행에도 없으므로,
말하지 않으면 판매자가 상품별 합계를 더해 보고 모자란 수를 발견하고도 이유를 알 길이 없다.

## 4. 우리가 써 둔 것

`KnowledgeMentionCheck`(개선 기회 lane이 이미 쓰던 결정론적 낱말 대조)를 **재사용**해, 이 문제의
aspect를 이름 짓는 판매자 자신의 문장을 찾는다. 숨어 있던 신호를 **명시적으로 올린 것**이지 새 판정이 아니다.

**세 상태를 일부러 가른다** — 비어 있는 라이브러리 · 가진 것이 있으나 이 문제를 다루지 않는 라이브러리 ·
답하는 라이브러리는 다음 걸음이 서로 다르다. 합치면 **이미 답을 써 둔 판매자에게 가서 쓰라고 말하게 된다.**
「답변 기준 채우기」는 **빠진 것이 있을 때만** 렌더된다.

어느 라이브러리를 읽었는지 이름을 댄다. 이슈에는 상품 칼럼이 없으므로(구조상 org 범위) 상품 lane은
issue의 dominant product를 읽고, 근거가 어느 상품에도 닿지 않으면 **읽을 상품 선반이 없다**고 말한다 —
회사의 답을 상품 이름 아래 보고하지 않는다.

`OpportunityRules.guidanceTargetOf`를 순수 함수 그대로 재사용한다. 값이 있다 —
**「배송 파손」은 파손된 물건을 든 고객이고 그들에게 답하는 규칙은 교환·반품 규칙**이라는 측정된 정정이
거기 들어 있다. 여기서 두 번째로 정하는 것이 두 화면이 「어느 규칙이 이 문제에 답하는가」에 대해
서로 다른 답을 갖게 되는 방식이다.

## 5. 판단 — 새 어휘를 만들지 않았다

브리프는 「per-review `TriageDisposition`을 억지 재사용하지 말 것」과 「별도 의미가 필요하면 작은 closed
vocabulary」를 말한다. **필요하지 않았다** — `IssueLifecycleState`(관찰 중 · 확인 필요 · 조치 중 ·
개선 확인 중 · 해결됨)가 lifecycle이 생긴 이래 그 어휘이고, 증거만이 할 수 있는 transition을 거부하는
상태 기계를 이미 가지고 있다. per-review 축과는 테이블도 의미도 겹치지 않는다.

**없던 것은 판매자의 문장이었다.** `startActing`/`markRemediated`는 처음부터 operator note를 받는데
화면이 하나도 보내지 않았다 — 그래서 판매자가 내린 모든 결정이 **아무 말도 하지 않은 사람의 상태 변경**으로
기록됐고, 기록은 「언제 움직였나」에 답하고 「무엇을 했나」에 답하지 못했다. 그것이 조치 기록의 존재 이유다.
칸은 **선택**이다: 문장 없는 결정도 결정이고, 상태를 바꾸기 전에 산문을 요구하면 사람들이 상태 변경 자체를
건너뛰어 기록이 더 나빠진다.

**해결 처리 컨트롤은 어느 상태에도 없다**(무변경). 해결됨은 기록된 조치 뒤의 조용한 기간을 관측해 닿는
자리이고, 버튼은 그 증거 자리에 단언을 앉히는 일이다.

### 5-1. v1.1 — 관찰 중에서도 조치를 시작할 수 있다 (product-owner decision, 2026-09-13)

v1은 §9에 「판매자 결정 컨트롤이 오늘 이 org에서 도달 불가」라고 적었다 — `startActing`이 `NEEDS_REVIEW`를
요구했고 그 상태는 자동 변화 판정만이 만드는데, 이 org의 근거 밀도로는 어떤 판정도 발화하지 않아 25개가
전부 `OBSERVING`이었다. 즉 **판매자는 시스템이 알아챈 문제에만 조치를 기록할 수 있었다.**

`IssueLifecycleState.sellerMayStartActing()`이 그 집합을 **`OBSERVING` + `NEEDS_REVIEW`**로 넓힌다.

- **자동 규칙은 건드리지 않았다.** `IssueChangeRules`·`ReviewIssueThresholds` 무변경. 넓어진 것은
  **사람이 말할 수 있는 것**이지 reviewnary가 결론짓는 것이 아니다.
- **`systemMayTransitionTo`는 여전히 `OBSERVING → ACTING`을 거부한다.** 두 행위자의 권한을 enum에
  **나란히** 선언한 이유가 이것이다 — 한쪽을 넓히는 편집이 다른 쪽을 조용히 넓힐 수 없다.
- **`VERIFYING`·`RESOLVED`는 일부러 뺐다.** 두 상태에는 이미 조치가 기록돼 있고, 거기서 ACTING으로
  되돌아가는 것은 증거가 받치는 결론을 단언으로 덮는 일이다(해결 처리 버튼이 없는 것과 같은 이유).
- 화면은 조치가 가능해도 **reviewnary의 입장을 함께 말한다** — 「reviewnary가 먼저 확인을 권할 만큼
  근거가 모이지는 않았습니다」. 판매자는 자기가 시스템보다 앞서 결정하고 있다는 것을 볼 수 있어야 한다.

**이 변경이 결함 하나를 드러냈고 테스트가 잡았다.** 화면의 start/complete 분기가 `=== "NEEDS_REVIEW"`
였고 나머지를 전부 「조치 완료」로 흘려보내고 있었다 — `OBSERVING`이 합류하는 순간 관찰 중 문제의
**「조치 시작」 버튼이 「조치 완료로 기록」을 호출**했다. 상수 비교 대신 **상태에 묻는다**(`ACTING_STATES`).

### 5-2. v1.1 — 어떤 별점에서 나왔나 (product-owner decision, 2026-09-13)

`ratingDistribution`은 `evidence-summary`에 이미 있었고 화면이 읽지 않았다. **count만** 그린다 —
percentage·average·importance 추론 **0**.

- **비율도 평균도 만들지 않는다.** 이 단위들은 **이 문제를 말한** 근거이므로 그 평균 별점은 상품이 아니라
  **추출기가 무엇을 매치했는가**에 대한 숫자이고, 점유율은 그 표본 위의 rate다. 별점으로 문제의 중요도를
  매기는 것은 이 저장소의 어떤 측정도 받치지 않는다 — severity는 problem vocabulary에서 오고 **의도적으로
  별점에서 오지 않는다**.
- **근거를 세지 리뷰를 세지 않는다.** 근거의 grain은 `(review, unit_ordinal)`이라 한 리뷰가 같은 말을 두 번
  하면 두 번 세어지고, 여섯 칸의 합은 리뷰 수가 아니라 **이슈의 근거 총계**다. 라벨이 「근거」인 이유다.
- **0인 칸을 지우지 않는다.** 1★ 행이 없는 것과 1★ 0건인 것은 같은 사실이지만, 뒤의 것만이 판매자에게
  **아무도 화내지 않았는데 계속 일어나고 있다**를 보여 준다. 실측 접착 부족 = 5★ 10 · 4★ 5 · 3★ 3 ·
  **1~2★ 0**. 별점으로 정렬하는 어떤 화면도 이 문제를 보여 줄 수 없다.
- 근거가 하나도 없으면 여섯 개의 0 대신 **아무것도 그리지 않는다**.

## 6. 양방향 연결

- 리뷰 → 문제: Decision Workspace의 **반복 신호**가 `/memory/{issueId}`로 (기존)
- 문제 → 리뷰: 근거 인용마다 **`/reviews/reply/{reviewId}`** (신규)

바뀐 것은 목적지와 **조건의 소멸**이다. 이전 링크는 인박스로 갔고 인박스는 **이미 들고 있는 행만** 열 수
있었으므로 membership 검사가 붙어 있었다 — 그 판단은 그 목적지에 대해 옳았지만, 결과적으로 **판매자가
인용 뒤의 리뷰에 닿을 수 있는지가 다른 화면이 무엇을 fetch했는지에 달려** 있었다(이 org에서는 근거 대부분이
어떤 인박스 페이지보다 오래됐다). 새 목적지는 review id에서 계정을 스스로 푼다 ⇒ 조건이 사라지고,
**모든 인용이 그 리뷰가 판단되고 답해지는 하나의 화면**에 닿는다.

소비자가 0이 된 `evidenceInboxRef`는 테스트와 함께 삭제했다(`VocItemCard`·`ReplyWorkControls` 선례).
`/memory`가 그것 하나 때문에 매 로드마다 하던 인박스 조회도 함께 사라졌다.

## 7. 하지 않은 것

- **마이그레이션 0.** `review_issue_evidence`에는 `product_id`와 `(org_id, issue_id, product_id)`
  인덱스가 V31부터 있었다. 분모는 상품별로 읽되 **근거를 실제로 가진 상품 수**만큼만 읽는다(측정된 최대 3).
- **Opportunity Engine 확장 0.** 읽지도 바꾸지도 않았고, `improvement_opportunity`·`/api/opportunities`·
  `(issue, kind)` 결정 정체성 전부 무변경. 재사용한 것은 순수 함수 하나다.
- **Customer Timeline · multi-agent · Agent Chat 중심 UI 0.**
- **새 유사도 판정 0.** 이 저장소의 유사도는 aspect+problem signature 하나다.
- **marketplace execution 변경 0.**

## 8. 검증

backend **4,048** · frontend **240 files / 2,853** · 실패 0 · `tsc` clean.

**실제 Demo Org 로컬 브라우저 QA**(커넥터·스케줄러·프로액티브·시드·모든 AI capability OFF):

| 확인 | 결과 |
|---|---|
| 어디서 얼마나 | 접착 부족 — 전선몰딩 **1,761건 중 16건** · 종이컵보관함 **416건 중 1건** · 세모금컵 **786건 중 1건** |
| 미귀속 근거 | 0건 (있으면 자기 줄로 렌더) |
| 우리가 써 둔 것 | 「등록된 안내 5건 가운데 2건이 이 문제를 다룹니다.」 + 판매자 자신의 문장 3 |
| 문제 → 리뷰 | `/reviews/reply/{id}` → `/reviews/{account}/reply/{id}` 「리뷰 처리」 착지 |
| 리뷰 → 문제 | 반복 신호 「접착 부족」 → `/memory/{issue}` 착지 |
| 퍼센트 | **0건** (렌더된 텍스트에서 단언) |
| 1440 / 1366 / 1152 | 가로 스크롤 0 · **axe 위반 0** (3폭 전부) |
| 콘솔 오류 · off-host 요청 | 0 · 0 |
| 백엔드 채널 호출 · 모델 호출 · ERROR/WARN | 0 · 0 · 0 |
| DB | 마이그레이션 0(schema 99 유지) · **행 변경 0** (issues 25 · evidence 55 · state_events 23 · opportunity 0 전후 동일) |

**계약이 바뀌어 테스트 2건을 다시 썼다**(안전 테스트 약화 0):
- `memoryScope`의 「textarea 0」은 「두 번째 chat composer 없음」의 **proxy**였고, 판단을 적는 칸이 생기면서
  그 proxy는 **판단하는 화면에서 판매자가 아무것도 쓰지 못하게** 하는 규칙이 됐다 ⇒ 주장을 직접 한다:
  쓸 수 있는 칸은 그 기록 하나이고 검색도 composer도 아니다(id·라벨·placeholder로 단언).
- `CustomerMemory`의 「인박스에 로드된 행에만 링크」는 §6의 이유로 **더 강한 주장**으로 대체했다 —
  모든 인용이 리뷰에 닿는다.

## 9. 고치지 않고 보고

- ~~판매자 결정 컨트롤 도달 불가~~ · ~~별점 분포 미렌더~~ → **v1.1에서 닫혔다**(§5-1 · §5-2).
  그 측정은 그대로 기록해 둔다: 어떤 이슈의 어떤 7일 창에도 근거 4건(`SURGE_MIN_CURRENT`) 이상인 곳이
  **없었고**, 임계에 닿는 것은 접착 부족이 2026-03-19 기준 28일 6건(CONCENTRATED)뿐이었다 —
  이 org의 근거는 13개월에 18건으로 퍼져 있어 임계가 전제하는 밀도에 미치지 않는다.
  **과거 날짜로 lifecycle-pass를 돌려 상태를 올리지 않았다**(실제 규칙을 합성된 「오늘」로 발화시키는 일).
- **같은 문장이 화면에 두 번.** 「우리가 써 둔 것」의 인용 3건과 바로 아래 개선 기회의 「왜 이 기회인가」
  인용 3건이 같다. 정본은 새 블록이지만 중복은 개선 기회의 rationale 안에 있고, 이 브리프가 그 패키지를
  **확장 금지**로 막아 두었으므로 손대지 않았다.
- **접착 부족의 별점 분포는 3★ 3 · 4★ 5 · 5★ 10 · 1~2★ 0**이다. 이 반복 문제는 전부 **칭찬 속에서**
  이야기되고 있고, 별점을 보는 어떤 화면도 이것을 보여줄 수 없다. 화면은 분포를 아직 그리지 않는다.
- `IssueListArtifact`의 severity 맵은 `MEDIUM`을 쓰는데 백엔드는 `NORMAL`만 낸다(기존, 이 패키지 밖).
- `ReviewIssueEvidenceRepository.issueCountsInWindow`는 네이티브 SQL이라 `realDataOnly`를 지나지 않는다
  (기존 성질, V95의 데이터 정리에 의존).
- `frontend/CLAUDE.md`가 그 workstream에 금지한 `backend/**` 수정을 product-owner 지시(conflict priority 1)에
  따라 했고 **전부 읽기 전용 · state semantics 변경 0 · write 0**이다.

## 10. 결정된 것 (2026-09-13) · 남은 PRODUCT_DECISION_NEEDED

v1이 올린 두 질문은 **product-owner가 답했고 v1.1에 반영됐다**:

1. **판매자는 `OBSERVING` 이슈에서도 명시적으로 조치를 시작할 수 있다.** `OBSERVING → ACTING`은
   **SELLER explicit action에서만** 허용되고, 자동 lifecycle rule/threshold는 변경하지 않는다 (§5-1).
2. **반복 문제에 근거의 별점 분포를 count로 표시한다.** percentage/average/importance 추론은 만들지
   않는다 (§5-2).

ACTION/decision event는 기존 append-only trail(`review_issue_state_events`) 그대로다 — 새 이벤트 표 0.

**남은 것**: 없음. 이 패키지에서 새로 필요해진 product decision은 없다.
