# Issue → ActionCandidate v0

2026-09-13. Repeated Issue를 본 판매자가 **「그래서 지금 무엇을 할 수 있는가」**를 판단할 수 있게 한다.

새 도메인이 아니다. 인벤토리 결과 이 계층은 **Opportunity Engine v1**(2026-09-04)이라는 이름으로 이미
서 있었고, v0 브리프의 아홉 원칙 중 **일곱이 이미 참**이었다. 남은 둘은 같은 결함의 두 얼굴이었고
이 패키지는 그것만 닫는다.

- 마이그레이션 **1**(V103) · 새 테이블 1 · 새 enum 1(`OpportunityEvent`) · 새 classifier **0** ·
  새 LLM capability **0** · 모델 호출 **0** · 마켓플레이스 호출 **0** · WRITE **0** · 승인 **0**.
- Pilot / Core / Media / Aside contract 무변경. Issue lifecycle · 승인 경계 · Review Decision
  Workspace · reply draft provenance **무변경**.

---

## 0. 인벤토리 — 이미 있던 것

| 브리프가 물은 것 | 저장소에 있는 것 |
|---|---|
| ReviewIssue / IssueChangeView | `reviewissue/` — `ReviewIssue` · `IssueSignature` · `IssueVocabulary`(aspect × problem) · `IssueChangeRules`/`IssueChangeView`(surge 창 vs 8주 baseline) · `ReviewIssueThresholds.NEW_MIN_EVIDENCE` |
| issue lifecycle / state events | `IssueLifecycleState`(OBSERVING · NEEDS_REVIEW · ACTING · RESOLVED) + `ReviewIssueStateEvent`(actor · reason · note) · `ReviewIssueLifecycleService` |
| seller note/action | 리뷰 한 건은 `TriageDisposition` + `review_triage_correction(_audit)`; 반복 문제는 lifecycle 전이 + 그 전이에 붙는 판매자 문장 |
| Seller Knowledge / Product Knowledge | `KnowledgeMentionCheck` — aspect 낱말로 active 지식을 훑는 **결정론** 카운트(랭킹·임계·벤더 0) |
| Review Decision Workspace의 action 구조 | `ReviewDecisionWorkspaceController`의 `decision-context` / `decision-log`, `TriageActionKind.isSellerAct()` |
| reply draft / approval provenance | `review_reply_draft`(append-only version · `author_kind` · `content_fingerprint` · `answer_basis`) + `review_reply_approval(_audit)` |
| Operations Home | `OperationsHomeView` — 리뷰 · 반복 문제 · 수집 상태 · **준비된 작업** |
| **ActionCandidate 자체** | **`opportunity/`** — `OpportunityRules`(결정론 파생) · `OpportunityKind` 넷 · `OpportunityDraftComposer`(모델 0) · `improvement_opportunity`(판매자 결정) · `OpportunityCard`/`OpportunityList` · `OpportunitySafetyFenceTest` |

**UX 흐름도 이미 그 순서였다** — `IssueDetailPanel`:
무슨 문제인가 → 왜 지금 보는가 → 어디서 얼마나 → 누가 무슨 말을 했나 → 우리가 이미 써 둔 것이 있나 →
**무엇을 할 수 있나(개선 기회)** → 무엇을 하기로 했나 → 무엇을 했나.

### 원칙 대조표

| v0 원칙 | v1 상태 |
|---|---|
| Issue의 파생 제안이며 사실/결정/실행 결과가 아님 | ✅ 저장하지 않고 매 읽기마다 파생 |
| seller decision과 분리 | ✅ 결정은 자기 행, issue lifecycle 무접촉 |
| 자동 실행 금지 | ✅ `OpportunitySafetyFenceTest` |
| 채택 / 수정 / 거절 | ✅ accept · updateDraft · dismiss · restore |
| 근거 없는 조치 생성 금지 | ✅ `NEW_MIN_EVIDENCE` 게이트 + dismissed/RESOLVED 제외 |
| evidence + knowledge 근거를 함께 | ✅ `whyKo` + `OpportunityKnowledgeView` |
| Issue lifecycle 임의 변경 금지 | ✅ |
| **existing Action 기록을 덮어쓰지 않음** | ❌ dismiss가 판매자가 쓴 초안을 **지웠다** |
| **선택 결과 / history persist** | ❌ **history가 없었다** |

---

## 1. 닫은 결함 — 결정이 자기 자신의 흔적을 지우고 있었다

V94의 결정은 **가변 행 하나**였다. status는 제자리에서 바뀌고, `decided_at`은 덮어쓰이고,
dismiss는 `draft_title`/`draft_body`를 **null로 만들고**, restore는 **행을 DELETE**했다.
그래서 판매자가 실제로 하는 순서 —

```
채택 → 수정 → 보류 → 되돌림
```

— 는 데이터베이스를 **시작한 그대로** 남겼고, 그 사이에 판매자가 쓴 문장은 존재한 적 있다는 기록조차
없이 사라졌다. 이것은 두 개의 서로 다른 잘못이다.

1. **결정이 답할 수 없었다.** 「이 기회를 언제 보류했더라」에 답이 없고, 「내가 이걸 채택한 적이 있나」에도
   없다. 제품은 판매자에게 반복 문제를 판단해 달라고 요청한다 — 흔적을 남기지 않는 판단은 기록된 것이
   아니라 소비된 것이다.
2. **버튼이 말하지 않은 일을 했다.** 「지금은 보류」가 판매자가 10분 들여 고친 초안을 지웠다.
   `accept()`는 이미 정반대를 문서화하고 있었다 — *"Idempotent — accepting twice keeps the seller's
   edits"* — 이므로 이것은 정책이 아니라 불일치였다.

### 모양은 새것이 아니다

`review_triage_corrections` + `review_triage_correction_audit`, `review_reply_approval` +
`review_reply_approval_audit` 이 저장소가 「바뀔 수 있고 답할 수 있어야 하는 사람의 결정」에 쓰는
패턴이다: **현재 말을 든 live row + `*_from`/`*_to`를 든 append-only trail.** 이것은 그 패턴의
**세 번째 인스턴스이지 네 번째 패턴이 아니다**. generic event platform **0** · workflow engine **0**.

### V103

```
improvement_opportunity.status          OPEN | ACCEPTED | DISMISSED   (부재한 행도 = open)
improvement_opportunity_event           append-only, 한 번 누를 때마다 한 행
  event        ACCEPTED | EDITED | DISMISSED | REOPENED
  status_from  첫 이벤트에서 null; 그 외에는 실제로 떠난 상태
  status_to    간 곳
  evidence_count  그 순간 제안이 딛고 있던 수 (backfill 행에서만 null)
  actor_id, decided_at
```

- **restore는 삭제하지 않는다.** trail이 이 행에 cascade로 매달리므로, 삭제하면 되돌리기가
  **자기 결정 기록을 지우는 방법**이 된다. 행은 `OPEN`으로 남고, 그것은 부재한 행이 모든 reader에게
  이미 뜻하던 것과 같다. (`review_triage_corrections`의 「WITHDRAWAL DOES NOT DELETE」와 같은 이유.)
- **dismiss는 판매자의 문장을 지우지 않는다.** 보류된 기회에 준비된 조치가 없다는 것은 view가
  `status == ACCEPTED`에서만 draft를 싣는 것으로 이미 참이다. 컬럼을 null로 만드는 것은 거기에
  아무것도 더하지 않고 판매자가 쓴 것만 없앤다.
- **event에 초안 텍스트는 없다.** 판매자의 문장은 정확히 한 곳(위의 행, 이제 파괴되지 않는다)에 산다.
  여기 사본을 두면 첫 번째와 어긋날 수 있는 두 번째 텍스트가 생긴다. free-text note도 없다 — 반복
  문제에 대한 메모는 issue lifecycle의 것이고 그쪽에 이미 있다.
- **`evidence_count`를 얼린다.** 근거 수는 매 읽기마다 다시 세어지므로, 얼려 두지 않으면 1년 뒤
  「왜 이걸 채택했지」에 답할 수 없다(`review_triage_correction_audit`이 `shown_tier`를 얼리는 그 이유).
- **동시성.** append-only는 `status_from`이 **진짜 선행 상태**를 가리킬 때만 합성된다. 두 번의 누름이
  동시에 서면 둘 다 standing status를 읽고 둘 다 그것을 떠났다고 적는다 ⇒
  `findWithLockByOrgIdAndIssueIdAndKind`(PESSIMISTIC_WRITE). 스키마는 이것을 표현할 수 없고 writer가
  소유한다. 잠기지 않은 단건 finder는 **삭제했다** — 한 결정을 읽는 모든 경로가 잠금 아래에 있다.
- **backfill.** 결정이 있는데 history가 비면 화면이 옆의 배지와 모순된다 ⇒ 기존 결정마다 한 행.
  `status_from`은 null(가변 행이 선행 상태를 남기지 않았으므로 이것이 알 수 있는 전부),
  `evidence_count`도 null — **오늘 계산한 수는 관측이 아니라 기억으로 분장한 측정이다**.
  로컬 DB에 기존 결정이 **0건**이어서 이 경로는 **실행되지 않았다**(§6).

### 누른다고 다 결정은 아니다

`settle()`은 **실제로 바뀐 것이 있을 때만** append한다. 같은 버튼을 두 번 누르는 것은 결정 하나이고,
같은 텍스트로 저장을 누르는 것은 수정이 아니다. 결정하지 않은 기회를 되돌리는 것은 아무것도 쓰지 않는다.

---

## 2. ActionCandidate domain boundary (v0 확정)

```
ReviewIssue            사실   — 무엇이 반복되는가. evidence가 소유한다.
IssueLifecycleState    결정   — 그 문제 자체를 어떻게 할 것인가. 판매자 + 규칙.
ActionCandidate        제안   — 저장되지 않는다. (issue, kind)로 매 읽기마다 파생.
  └ 결정              결정   — 그 제안에 대해 판매자가 무엇이라고 했나. improvement_opportunity.
     └ trail          기록   — 어떻게 거기에 이르렀나. improvement_opportunity_event. append-only.
실행                   —      이 경계 안에 없다. 초안은 판매자의 손을 거쳐서만 나간다.
```

- **제안은 결코 저장되지 않는다.** 그래서 두 테이블 중 어느 것도 「evidence가 더는 지지하지 않는
  기회가 존재한다」고 주장할 수 없다. 파생이 멈춘 기회의 행은 그냥 다시 조인되지 않는다.
- **모든 mutation은 쓰기 전에 다시 파생한다.** 지금 제안되지 않는 kind에 대한 결정은 404이고, 그
  문장은 이슈가 사라졌든 남의 org이든 kind가 더는 나오지 않든 **같다**.
- **결정 어휘는 결과 어휘가 아니다.** `ACCEPTED`는 「준비해 줘」이지 FAQ가 쓰였다는 뜻이 아니다.
  문제 자체에 무슨 일이 일어났는지는 issue lifecycle이 말하고, 이 enum에는 그것으로 오독될 수 있는
  낱말이 **없다**.

---

## 3. 생성 근거 — 무엇이 후보를 만드는가

파생은 **결정론 한 파일**(`OpportunityRules`)이고 입력은 셋뿐이다.

1. **게이트** — `dismissed` 아님 · `RESOLVED` 아님 · `evidenceCount >= NEW_MIN_EVIDENCE`(추출기
   자신의 임계). 그래서 **「근거 없는 제안」은 구성상 도달 불가**다.
2. **표** — aspect × problem이 판매자가 행동할 수 있는 자리를 지목한다. GUIDANCE lane(고객에게
   말할 수 있는 것)과 PRODUCT lane(물건 자체가 계속 실패한다) 각각 최대 하나.
3. **판매자의 지식** — `KnowledgeMentionCheck`. 아무것도 안 써 뒀으면 FAQ 보완, 써 뒀으면 상세·안내
   보완(즉 답은 있는데 고객이 사기 전에 보는가의 문제).

원인도, 기대 효과도, 우선순위 점수도 만들지 않는다. 판매자가 읽는 문장은 전부
`OpportunityDraftComposer` 한 곳에서 나오고 **모델은 호출되지 않는다**.

---

## 4. 실제 UX flow

`/memory/{issueId}` — Repeated Issue workspace. 브리프의 흐름 그대로이고, 마지막 한 칸이 이번에 생겼다.

```
반복 문제 제목
  └ 왜 올라왔나요           surge/추세 + 조사 힌트
  └ 어디서 얼마나           상품별 근거/모수 (비율 아님, 쌍으로)
  └ 근거                    실제 리뷰 인용(마스킹)
  └ 우리가 써 둔 것         KnowledgeMentionCheck — 개수와 판매자 자신의 문장
  └ 개선 기회               ActionCandidate 카드들
       · {kind} 배지 · 상태 칩
       · 제안 문장 (어디를 볼지, 원인 아님)
       · 왜 이 제안인가      근거 수 · 기간 · 추세 · 주 상품 · 지식 상태
       · [○○ 초안 준비]  [지금은 보류]
       · (채택 후) 편집 가능한 초안 + [답변 기준으로 저장] 또는 [복사] + [되돌리기]
       · 결정 기록  ← v0에서 추가          채택 · 2026-09-13 · 근거 리뷰 18건
                                            수정 · 2026-09-13 · 근거 리뷰 18건
                                            보류 · 2026-09-13 · 근거 리뷰 18건
                                            되돌림 · 2026-09-13 · 근거 리뷰 18건
  └ 이 문제를 어떻게 할까요  issue lifecycle 전이 + 판매자 문장
  └ 기록                     issue lifecycle 기록
```

**결정 기록이 카드 안에 있고 아래의 「기록」에 합쳐지지 않는 이유**: 아래 기록은 **문제**에 대한 것
(관찰 중 → 조치 중 → …)이고 이것은 **제안 하나**에 대한 것이다. 한 목록에 두 주어를 섞는 것은
판매자가 **미루기만 한 것을 해결했다고 믿게 되는** 방식이다.

아무것도 결정하지 않은 기회는 이 섹션을 **아예 그리지 않는다** — 빈 기록은 상태 칩의 일이다.
근거 수가 없는(trail 이전) 결정은 **언제**만 말하고 무엇 위에서였는지는 말하지 않는다.

---

## 5. Home 연결 — 검토 결과 연결한다

`PreparedWork`의 계약은 이미 이것이었다: *"Each number is a row somebody already wrote."*
채택된 기회는 그 시험을 그대로 통과한다 — **판매자가 눌렀고(결정 행이 있다) 초안이 있다**.
그래서 세 번째 kind `IMPROVEMENT_DRAFT`와 `improvementDraftsReady` 하나를 더했고, 새 urgency 개념은
**0**이다.

- **아직 아무도 결정하지 않은 반복 문제는 여기 오지 않는다.** 그것은 `RepeatedProblems`가 세고,
  거기서도 `observing`은 일로 그려지지 않는다. 여기로 끌어오는 것이 브리프가 금지한 「과장된 urgency」다.
- **세지 전에 다시 파생한다.** 채택한 뒤 문제가 해결됐거나 반복 임계 아래로 떨어진 기회는 빠진다 —
  자기 workspace가 더는 제안하지 않는 일을 홈이 요구하지 않는다.
- **결정한 것이 없는 org는 인덱스 조회 한 번만 낸다.** 게이트가 이슈 목록이 아니라 **결정된 행**이다.
- **합치지 않는다.** 「승인하신 리뷰 답변 4건 · 초안이 준비된 문의 3건 · 준비하신 개선 초안 1건」이고
  「8건」은 아무도 읽지 않은 넷째다.
- `to`는 `/memory/{issueId}` — 홈은 일을 **넘기지** 두 번째 작업 화면이 되지 않는다.
- `id`는 **결정 행의 id**다(목적지의 것이 아니라). 한 반복 문제가 두 개의 채택된 초안을 낳으면 둘 다
  같은 이슈로 링크되고, 목적지 id를 쓰면 한 행이 두 번 그려진다.

---

## 6. 검증

**테스트** — backend **4,130** · frontend **2,902** · 실패 **0** · typecheck clean.

새 테스트: `OpportunityDecisionTrailTest`(stateful fake repo 위에서 전 순서를 돌린다 — append-only
trail은 무엇이 append됐는지 잊는 mock으로 단언할 수 없다) 5건 ·
`OpportunitySafetyFenceTest.itDeletesNothing` · Home contract의 세 번째 count · 카드의 결정 기록 렌더
2건 · `preparedLine` 2건.

**fence는 강화됐다**: 이 패키지가 SAVE할 수 있는 repository는 **자기 것 둘**(`decisions`, `trail`)뿐이고
산술이 맞아야 하며(세 번째 writer는 설명되지 않는 `.save(`로 드러난다), `.delete(`·`.deleteAll`·
`deleteBy`는 **어디에도 없다**.

**라이브**(로컬 스택, 커넥터 전부 OFF · 모델 0 · 마켓플레이스 0):

- V103 적용 **1건 · 31ms · ERROR/WARN 0**.
- 실제 Demo Org에서 `채택 → 수정 → 보류 → 되돌림 → 채택` 5회, DB 실측:

  | event | status_from | status_to | evidence_count | actor |
  |---|---|---|---|---|
  | ACCEPTED | — | ACCEPTED | 18 | ✓ |
  | EDITED | ACCEPTED | ACCEPTED | 18 | ✓ |
  | DISMISSED | ACCEPTED | DISMISSED | 18 | ✓ |
  | REOPENED | DISMISSED | OPEN | 18 | ✓ |
  | ACCEPTED | — | ACCEPTED | 18 | ✓ |

  (되돌린 뒤의 `status_from`이 다시 null인 것은 규칙대로다 — 되돌림 뒤에는 떠날 standing decision이 없다.)
- 보류 뒤 다시 채택했을 때 돌아온 것은 새 scaffold가 아니라 **판매자가 고친 제목·본문**.
- 되돌린 기회는 `검토 전` + `decidedAt: null`.
- Home: `{reviewRepliesApproved: 4, inquiryDraftsReady: 3, improvementDraftsReady: 1}`.
- 브라우저 1440×900@2×: 결정 기록 5행이 순서대로 렌더, **AA 7.11 / 16.56 @13px**, 가로 스크롤 0,
  off-host 0, 실패 요청은 미기동 agent-runtime(8787) 하나뿐.
- **issue lifecycle 무변경**(ACTING 1 · OBSERVING 24) — 결정은 그것을 건드리지 않는다.
- QA 잔여(결정 1 · 이벤트 5)는 세션 종료 시 제거, 두 테이블 **0행**.

**backfill 경로는 실행되지 않았다** — 로컬 DB에 V103 이전 결정이 0건이었다. 가드(`not exists`)와
SQL은 자명하지만 관측되지 않았다고 적어 둔다.

---

## 7. 계약이 바뀌어 다시 쓴 테스트

`OpportunityServiceTest.dismissAndRestore` **1건**. 판매자가 **보는** 것에 대한 단언은 전부 그대로
남았다(보류는 준비된 조치를 싣지 않는다 · 기본 목록에서 빠진다 · `includeDismissed`로 보인다 ·
되돌리면 `OPEN`). 바뀐 것은 그 아래의 기록이고, 두 변경 다 **결정이 자기 존재의 증거를 파괴할 수 없게**
하려고 있다. 단언은 늘었고 안전 테스트 약화는 **0**.

---

## 8. 파일럿에서 검증할 가설

1. **H1 — 판단 가능성.** 반복 문제를 연 판매자가 「무엇을 할 수 있는가」에 화면을 떠나지 않고 답한다.
   측정: 기회가 있는 이슈를 연 세션 중 결정(채택/보류)이 붙은 비율.
2. **H2 — 제안의 타당성.** 채택 ÷ (채택 + 보류). 낮으면 규칙 표가 틀렸다는 뜻이지 판매자가 게으른 것이
   아니다. 보류는 실패가 아니라 신호다.
3. **H3 — 초안이 실제로 쓰인다.** 채택 중 `EDITED`가 붙은 비율, 그리고 지식으로 **저장된** 비율.
   수정 0 · 저장 0이면 scaffold가 판매자의 언어가 아니다.
4. **H4 — 되돌림의 의미.** `REOPENED`가 많으면 상태 어휘가 판매자가 뜻한 것과 다르다.
5. **H5 — Home이 일을 만들지 않는다.** `improvementDraftsReady`가 채택 없이 늘어나는 일은 구조상
   불가능해야 한다. 파일럿에서 이 수가 채택 수와 어긋나면 재파생 경로가 틀린 것이다.
6. **H6 — kind 분포.** 네 kind가 실제로 다 쓰이는가. `OPERATING_POLICY_SUPPLEMENT`가 한 번도 안 나오면
   배송 aspect의 issue가 임계를 못 넘는다는 뜻이다.

**의도적으로 세지 않는 것**: 「개선으로 문제가 줄었는가」. 이 제품은 원인을 판단하지 않으므로 조치와
그 뒤의 evidence 감소 사이에 인과를 주장할 수 없다.

---

## 9. 남은 한계 (고치지 않고 보고)

1. **초안의 버전 history는 없다.** trail은 「수정했다 · 언제 · 무엇 위에서」를 남기고 **이전 텍스트는
   남기지 않는다**. 현재 텍스트는 파괴되지 않으므로 「덮어쓰지 않는다」는 지켜지지만, 세 번 고친 초안의
   첫 번째 문장은 되살릴 수 없다. reply draft의 append-only version 패턴이 그 답이고 v0에 넣지 않았다.
2. **Home 행은 5개에서 잘리고 개선 초안이 마지막이다.** 실측에서 4 + 3 + 1 = 8행 중 5행만 그려져
   `IMPROVEMENT_DRAFT` 행이 잘렸다(수치는 문장에 그대로 나온다). 순서를 바꾸는 것은 리뷰 하나와 반복
   문제 하나 사이에 가중치를 두는 일이고, `OperationsHomeView`가 명시적으로 금지한 바로 그것이다 ⇒
   **product-owner 결정**.
3. **첫 실행 잠금은 없다.** 같은 기회의 **첫** 결정 두 개가 동시에 오면 둘 다 잠글 행이 없고,
   직렬화는 unique index가 한다(한쪽이 제약 위반으로 실패). 이후의 모든 결정은 잠금 아래다.
4. **agent-runtime의 `ImprovementOpportunitySummary`는 `history`를 싣지 않는다.** 의도적이다 —
   Agent lane의 일은 기회를 나열하는 것이지 판매자의 결정 기록을 읽어 주는 것이 아니고, 아무도 묻지
   않은 질문을 위해 payload를 넓히지 않는다.
5. **`actor_id`는 저장되지만 화면에 나오지 않는다.** 한 org에 사람이 여럿일 때 「누가」가 답이 되며,
   그때 이름을 보여줄지는 UX 결정이다.
6. **이슈 추출기의 부정문 오탐은 그대로다**(`agentic_report_v1.md`가 닫은 뒤 잔존분). ActionCandidate는
   issue만큼만 참이다.
