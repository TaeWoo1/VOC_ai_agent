# Proactive Operations Agent v1

**Status:** offline 구현 완료 · **라이브 증명 완료 — LIVE_GREEN (2026-08-26)** · **v1 CLOSED** · 기본값 OFF
**Date:** 2026-08-25
**Branch:** `feat/proactive-operations-agent-v1`
**Marketplace WRITE:** **0** (이 패키지에서 채널 호출은 READ도 없다)

---

## 0. 한 문장

지금까지 판매자는 Inbox/Agent를 **열어서 일을 찾았다**. v1부터는 새 문의·리뷰 신호가 들어오면
SellerOps가 먼저 **처리할 가치가 있는지 판정하고, 근거를 조사하고, 가능하면 답변 초안까지
준비해 두고**, 판매자에게는 **결정만** 요청한다.

```
NEW SIGNAL
→ deterministic candidate gate      (LLM 아님 — 운영 사실만)
→ investigation                     (기존 production draft path 재사용)
→ evidence + prepared draft
→ 「AI가 먼저 확인한 일」 카드
→ 기존 승인/실행 경로                (사람의 승인 경계 그대로)
→ verify → memory
```

**Agent tool catalogue WRITE는 여전히 0이고, 이 패키지에는 전송 경로가 아예 없다.**

---

## 1. 재사용한 기존 아키텍처 — 그리고 재사용하지 않은 것

새 state machine도, 새 work queue도 만들지 않았다. 판매자의 일에는 이미 집이 있다:
문의는 `inquiry_work_item`, 리뷰는 review 행과 reply ledger. **두 번째 큐는 같은 일에 대한
두 번째 권위**이고, 둘이 어긋나는 날 누가 옳은지 말할 수 없게 된다.

| 재사용한 것 | 어떻게 |
|---|---|
| `inquiry_work_item` (phase/audit) | 후보 게이트의 입력이자, 케이스 상태의 **유일한 근거** |
| `InquiryProposalService` | `proposeAs(actor)` 한 줄 추가 — 같은 OPEN→PROPOSED 전이, 같은 멱등성, 같은 원자적 감사 |
| `InquiryDraftComposer` + `InquiryEvidenceRetriever` | **조사 그 자체**. 3-lane retrieval(상품 지식·운영 정책·과거 답변) + 결정론적 OrderFact를 그대로 |
| `InquiryReplyDraftService` | `saveAs(actor)` — 같은 검증·정규화·fingerprint·append-only 버전 |
| `ReviewRepository.TRIAGE_TIER_RANK` | 리뷰 후보 게이트가 **바로 이 식**을 쓴다 (§3) |
| `ReviewRepository.NOT_DISMISSED_PREDICATE` | 판매자가 치워 둔 답변 작업은 후보가 아니다 — 규칙을 베끼지 않고 재사용 |
| `review_issue` / `review_issue_evidence` | 반복 문제는 **읽는다**, 추론하지 않는다 |
| `InboxService.snippet` | PII 마스킹 미리보기 — 두 번째 구현을 만들지 않았다 |
| `SelfPilotProperties` | **어느 org에 대해 백그라운드로 도는가**는 이미 답이 있는 질문 (Self-Pilot Runtime v1) |
| `SelfPilotScheduler` 패턴 | 얇은 `@Scheduled` + 모든 판단은 reconciler에 |
| `AgentQuotaService` | 사전 초안도 판매자 초안과 **같은 카운터**를 쓴다 |

**재사용하지 않은 것과 그 이유:** agent-runtime의 `OperatorGraph`(포트 8787)는 **대화 lane**으로
그대로 두었다. 조사를 그쪽으로 보내면 스케줄러가 서비스 경계를 넘게 되고, 무엇보다 문의 조사의
retrieval은 이미 backend의 `InquiryEvidenceRetriever`에 있다 — 그것이 이 제품의 specialist 구현이다.
OperatorGraph의 계약·도구 카탈로그는 **한 줄도 바뀌지 않았다**.

---

## 2. 새로 추가한 최소 persistence

**테이블 하나 (`proactive_case`, V75), phase 0개, event 스트림 0개.**

이 행은 일을 **소유하지 않는다**. 그것이 존재하는 이유는 기존 어느 테이블도 담지 못하는 세 가지다:
**왜 지금 중요한가 · 무엇을 조사했나 · 무엇이 준비됐나.**

`status`는 **파생값**이다. `ProactiveCaseReconciler`가 매 tick마다 work item의 phase, 문의의
operational state, 리뷰의 reply state에서 다시 계산한다. 케이스를 직접 바꾸는 API는 없다 —
그래서 이 테이블은 언제든 운영 진실로부터 재구성 가능하고, 경쟁 권위가 될 수 없다.

```
PREPARED  판매자를 기다리는 중 (목록에 보이는 유일한 상태)
ACTED     판매자가 일을 했다 (work item이 PROPOSED를 떠남 / 리뷰에 답변)
CLOSED    더 이상 할 일이 아니고, 판매자는 손대지 않았다 — close_reason이 이유를 말한다
```

`close_reason`: `SUPERSEDED` · `ANSWERED_ELSEWHERE` · `NOT_OPERATIONAL` · `NO_LONGER_ACTIONABLE`.

---

## 3. Candidate gate는 결정론

**LLM은 "여기 일이 있다"를 발명하지 않는다.** 후보는 SQL이 정하고, 모델은 그 뒤에 조사만 한다.

### 문의 (`InquiryWorkItemRepository.findProactiveCandidates`)

| 절 | 왜 |
|---|---|
| `phase = OPEN` | 판매자가 아직 시작하지 않은 일 |
| `dataOrigin = REAL` | 이 카드의 CTA는 실제 고객의 문의 스레드에서 끝난다 |
| `operationalState = ACTIVE` | 스팸 dismissal과 출처의 스레드 구조를 **둘 다** 존중 |
| `status = 'UNANSWERED'` | 채널이 한 말. 여기서 추론하지 않는다 |
| `threadRole ≠ REPLY` | **ACTIVE와 중복이 아니다** — 두 번째 독립 fence (§7) |

### 리뷰 (`ReviewRepository.findProactiveCandidates`)

tier 판정은 **`TRIAGE_TIER_RANK = 0`** — 운영자 목록이 정렬·집계에 쓰는 바로 그 식이고,
`ReviewTriageRules`와 짝으로 고정되어 있는 두 표현 중 하나다. 여기에 세 번째 사본을 쓰면
세 번째 답이 생기고, 하나가 바뀌는 날 두 화면이 같은 행을 두고 다투게 된다.
나머지는 `dataOrigin = REAL`, `replyState ≠ ANSWERED`, `NOT_DISMISSED_PREDICATE`.

**ORDER-only proactive case는 v1에서 제외** — 주문에는 기다리는 고객도 답 없는 질문도 없다.
`ProactiveSubjectKind`에 값이 둘뿐이고, 구조 테스트가 그 사실을 고정한다.

---

## 3-A. Bootstrap fence — live enable 직전 감사가 RED을 냈다

**후보 게이트의 모든 절은 「이 일이 실재하는가」를 물었고, 「이 일이 지금의 일인가」를 묻는 절이
하나도 없었다.** canonical Demo Org 실측:

| lane | fence 없음 | 가장 오래된 것 | 가장 최근 것 | 30일 내 |
|---|---|---|---|---|
| INQUIRY | **22** | 2014-10-28 | 2025-02-19 | **0** |
| REVIEW | **16** | 2020-10-10 | 2026-07-02 | **0** |

22건 전부 **2026-08-22 단일 backfill**로 들어왔고, 정렬은 `created_at ASC`(오래된 것 우선)였다.
첫 tick은 예산 전부를 org에서 가장 오래된 행에 쓰고 「고객이 4,300일째 기다립니다」를 띄웠을 것이다.

**source-state fingerprint dedupe는 이것을 막지 못한다.** 그것은 "같은 상태를 두 번 분석하지 않는다"의
보장이지, "그 상태를 애초에 분석해야 했는가"의 보장이 아니다.

### fence — lane당 절 하나, 필수 설정값 하나. 새 테이블 0, 새 subsystem 0.

`sellerops.proactive.observed-since`(ISO-8601 instant, **공백 = fail closed**)와
`inquiry_work_item.created_at` / `reviews.created_at`. 정렬은 **newest-observed first**로 뒤집었다.

세 후보를 **측정해서** 기각했다:

| 컬럼 | 기각 이유 |
|---|---|
| `updated_at` · `last_seen_at` | routine 수집이 매 sweep마다 건드린다 — 이 org의 **3,334행 중 3,266행**이 insert보다 새 touch를 갖는다. 전 corpus를 매시간 fresh로 부른다 |
| `received_at` 단독 | enable **이후** 실행된 backfill이 같은 backlog를 다른 문으로 붓는다 |
| 어떤 기본값이든 | 「태초부터」는 홍수 그 자체, 「프로세스 시작」은 재시작마다 홍수 재개, 「지금을 어딘가 기억」은 만들지 않기로 한 watermark subsystem |

**reconcile은 fence 대상이 아니다** — 간밤에 답변된 카드를 닫는 것은 신규 준비 허용 여부와 무관하다.

### 감사가 두 번째 fence를 강제했다

로컬 배포는 self-pilot `LOCAL_SINGLE_USER` = **이 DB의 모든 org, 35개**. 그 범위를 상속했다면
켜는 날 35개 org 전부에 대해 준비를 시작했을 것이다. 그래서 대상은 **교집합**이다:
`sellerops.proactive.org-ids`(공백 = 아무도 없음)를 self-pilot이 허용하는 org로 거른다.
**이름 있는 목록이 출발점이고**, DB 전체를 열거한 뒤 거르는 방식이 아니다 — 후자는 아래로 내려가다
필터 하나를 잊으면 남의 상점에 대해 도는 루프가 된다.

### fence 이후

| lane | 전 | 후 (경계 `2026-08-23T00:00:00Z`) |
|---|---|---|
| INQUIRY | 22 | **0** |
| REVIEW | 16 | **0** |

경계는 **「모든 bulk import 이후」**로 잡았다. 이 org의 import는 2026-06-17(리뷰 3,700) ·
2026-07-06(문의 3,201) · 2026-08-22(문의 68·리뷰 130) · **2026-08-23(리뷰 505)**. 마지막 것이
중요하다 — 초안에서 쓰려던 rolling 72시간 창은 리뷰 1건을 들여보냈는데, **그 리뷰가 08-23 bulk
import의 일부**였다. 시간 단위 창은 import와 arrival을 구별하지 못하고, import 뒤에 놓인 경계는 한다.

**라이브 결과 · 남은 것은 §12와 `docs/evidence/proactive_operations_agent_live_tick_v1.md`.**

---

## 4. Idempotency / stale — 이 기능이 쓸 만한지를 정하는 부분

**dedupe identity = `org + subject kind + subject id + source state`.**

state를 키에 넣은 이유: 넣지 않으면 "이미 조사했다"와 "여전히 유효하다"가 같은 검사가 되고,
앞의 것은 틀린 검사다. 상품이 연결되지 않은 채로 조사된 문의가 나중에 상품에 묶이면,
**쓸 수 있는 근거가 달라졌으므로** 새로 조사할 가치가 있다.

- 소스가 그대로면 → 시그니처가 같고 → tick이 **아무것도 쓰지 않는다**
- 소스가 바뀌면 → 새 케이스, 옛 케이스는 `SUPERSEDED`로 닫힌다 (덮어쓰지 않는다)
- DB가 보증한다: `uq_proactive_case_signature`, 그리고 **subject당 열린 케이스 1개**를 강제하는
  부분 유니크 인덱스 `uq_proactive_case_open_subject where status = 'PREPARED'`

**tick 순서는 reconcile → prepare이고, 이건 장식이 아니다.** 먼저 정리해야
"간밤에 채널에서 답변된 문의"가 **같은 실행에 의해 다시 떠오르는 창**이 없다.

---

## 5. Investigation

### 문의
`proposeAs` → `generateAs`. 즉 **판매자가 「제안 생성」과 「초안 쓰기」를 눌렀을 때 도는 바로 그 경로**.
근거는 상품 지식 · 운영 정책 · 판매자의 과거 답변 3-lane과, 채널이 지목한 주문에 대한 결정론적 OrderFact.

케이스에 남는 것: `evidence_state`(4값 `DraftKnowledgeState`), `evidence_count`, `knowledge_gap`,
`draft_version`, `prepared_action`.

**`knowledge_gap`은 네 상태를 하나로 뭉개지 않는다** — `NO_PRODUCT`(상품을 연결하세요) ·
`NO_LIBRARY`(상품 지식을 적으세요) · `NO_MATCH`(운영 기준을 추가하세요)는 판매자가 할 일이 서로 다르다.

### 리뷰
**답변을 준비하지 않는다.** 이것은 범위 결정이 아니라 **capability 사실**이다 — 보이는 채널 어디에도
증명된 리뷰 답변 WRITE adapter가 없고, 이 카드에 「답변 보내기」를 두면 **말한 대로 못 하는 버튼**이 된다.

준비하는 것: 왜 확인이 필요한지 · **반복 문제인지**(기존 issue memory에서 **읽는다**) · 다음 행동.
판매자가 dismiss한 issue는 다시 꺼내지 않는다.

**정책은 꾸며내지 않는다.** 추천 문장은 이 클래스가 가진 사실(평점, 반복 여부, 상품 연결 여부)에서만
조립된다. 이 상점의 환불·교환·배송 기준을 SellerOps는 모르고, 아는 척하면 판매자의 입에 말을 넣는 것이다.
`ProactiveReviewInvestigatorTest`가 그 문장들에 그 단어가 없음을 고정한다.

---

## 6. Human Approval boundary

**준비된 초안 ≠ 승인.** 문의는 **PROPOSED에서 멈춘다**. 승인·command id·Action Executor·전송은
전부 예전 자리에 그대로 있고, 이 패키지에서 도달할 수 없다.

`ProactiveSafetyFenceTest`가 소스를 읽어 이름으로 막는다:
- 채널 도달 금지 — `HttpClient` · `RestTemplate` · `postForm` · `"POST"` · `Cafe24` · `Coupang` · `connector.`
- 승인 경계 금지 — `InquiryApproval` · `ActionIntent` · `PublishExecution` · `confirm-publish` · `commandId` · `approvalId`
- **Answer Memory 쓰기 금지** — AI 초안이 들어가면 판매자 자신의 선례로 되인용된다
- 사실 발명 금지 — `ProductBinding` · `OrderFactLookup` · `EXACT_ALLOWED`; `setProductId(`는 **케이스 행에만** 허용
- 우선순위에 `confidence` · `score(` · `Math.random` 금지
- 컨트롤러에 status를 바꾸는 엔드포인트 없음 — **일을 해야 카드가 정리된다**

---

## 7. 두 번째 fence 하나를 특별히 적어 둔다

문의 게이트의 `threadRole ≠ REPLY`는 `operationalState = ACTIVE`와 **오늘은** 중복이다
(`IngestionService`가 수집 시점에 projector를 돌린다). 그래도 남긴 이유는, 투영을 잊은 경로가
언젠가 답글 article을 저장하면 **판매자 자신의 답변이 고객의 질문으로 조사되기** 때문이다.
`ProactiveCandidateGateTest`는 그 상태(REPLY인데 ACTIVE)를 직접 심어서 0건임을 증명한다 —
소스를 읽는 게 아니라 상태를 심고 게이트를 읽는다.

---

## 8. Priority

설명 가능한 lookup 하나. ML 랭킹도, 모델 confidence도 없다.

| reason | priority | 근거 |
|---|---|---|
| `UNANSWERED_INQUIRY` | HIGH | 고객이 기다린다 |
| `SEVERE_NEGATIVE_REVIEW` (1점) | HIGH | 가장 낮은 평점 |
| `REPEAT_ISSUE_REVIEW` | HIGH | issue memory가 반복을 증언 |
| `NEGATIVE_REVIEW` (1–2점 + 본문) | NORMAL | 기존 확인 필요 tier |

문의 카드의 첫 줄에는 **며칠째 기다리는지**가 붙는다 — 똑같아 보이는 미답변 20건을 구별하는
유일한 운영 사실이고, tick 주기로 갱신되므로 일 단위로만 말한다.

---

## 9. Background execution boundary

**스케줄러이고 ingest hook이 아니다.** 조사는 모델을 부른다. 수집 트랜잭션 안에서의 모델 호출은
느리거나 죽은 모델을 **수집 실패로** 만든다. 이 패키지는 ingest 경로에서 도달할 수 없고,
그래서 둘은 함께 실패할 수 없다.

스위치 둘이 모두 켜져야 한다: `sellerops.proactive.enabled`, 그리고 org 범위를 정하는
`SELLEROPS_SELF_PILOT_*`. 어느 쪽이든 꺼져 있으면 fail closed.

per-tick 상한은 예산 보호다 — 사전 초안은 판매자 초안과 **같은 일일 AI 예산**을 쓴다.
상한이 없으면 25건 backlog 한 번에 하루치를 다 써 버리고, 그 뒤 판매자가 요청한 초안은
전부 조용히 결정론 drafter로 떨어진다. **백그라운드 루프가 사람을 이겨서는 안 된다.**

---

## 10. Product UX

새 앱을 만들지 않았다. 섹션 하나와 진입점 하나.

| 화면 | 무엇 |
|---|---|
| **문의** (`/inquiries`) | 「AI가 먼저 확인한 일」 카드 — 목록 로딩 분기 **밖**에 둔다 (500행을 기다린 판매자는 이미 직접 훑기 시작했다) |
| **홈** (`/`) | 한 줄 + 링크. **목록을 다시 찍지 않는다** — 같은 4건을 두 번 읽고 어느 쪽에서도 결정하지 않게 된다 |
| **Agent** (`/agent`) | 프롬프트 **위에** 「이미 확인해 둔 일」 — 물어봐야만 찾는 화면이 아니게 |

카드가 담는 것: 문의/리뷰 · 채널 · 상품(알면) · 왜 지금인지 1–2줄 · 우선순위 · 근거 상태 ·
준비 상태 · 부족한 지식. CTA `[확인하기]`는 **언제나 이미 있는 화면**으로 간다 — proactive 전용
상세 페이지는 없다. 같은 문의를 읽는 두 번째 장소는 답한 걸 잊는 두 번째 장소다.

**아무것도 없으면 아무것도 렌더링하지 않는다.** 빈 상태도, 스켈레톤도 없다. 매일 아침 "0건"이라고
말하는 줄은 둘째 주면 읽히지 않는다. 읽기 실패도 **fail-soft** — 이 워크플로에서 유일하게 그렇고,
뒤의 큐는 여전히 strict다.

---

## 11. Telemetry

케이스 행의 타임스탬프 4개(`surfaced_at` · `opened_at` · `acted_at` · `closed_at`)와
`GET /api/proactive/telemetry`. 별도 이벤트 스트림을 만들지 않았다 — 판매자가 **행동한 뒤**의
모든 것(초안 편집·승인·실행·검증)은 이미 `inquiry_work_item_audit` / `inquiry_execution` /
`inquiry_verification`에 있고, 복사하면 두 번째 진실이 된다.

`prepared / surfaced / opened / acted / closedUnacted / draftsPrepared / **medianSecondsToAction**`.

**median이고 mean이 아니다** — 한 건을 2주 방치하면 평균은 소설이 된다. 표본이 없으면 `null`이지
`0`이 아니다 (0은 "즉시"로 읽힌다).

프론트 이벤트는 둘, prop은 `kind`(`inquiry`/`review`) 하나뿐 — 기존 analytics 어휘의 규칙 그대로
자유 문자열이 들어갈 자리가 없다.

---

## 12. Acceptance — 무엇이 증명됐고 무엇이 아닌가

**증명됨 (offline, 자동 테스트):**

| 요구 | 어디서 |
|---|---|
| same signal duplicate proactive card **0** | `ProactiveReconcilerTest.anUnchangedSignalIsInvestigatedOnce` + 부분 유니크 인덱스 |
| stale answered inquiry resurfacing **0** | `answeredElsewhereClosesTheCard` (닫힌 뒤 추가 tick에도 0) |
| cross-org evidence **0** | `ProactiveCandidateGateTest` 2건 + `ProactiveCaseServiceTest.theListIsOrgScoped` + 리포지토리 구조 fence |
| REPLY article candidate **0** | `aThreadReplyIsNeverACandidate` (두 fence를 따로) |
| excluded/spam candidate **0** | `aDismissedInquiryIsNeverACandidate` |
| 판매자 행동이 카드를 정리 | `sellerActionMarksTheCaseActed` |
| 리뷰 dismissal 존중 | 게이트가 `NOT_DISMISSED_PREDICATE` 재사용 + reconcile 시 단건 재확인 |
| 정책 fabrication 없음 | `ProactiveReviewInvestigatorTest.itFabricatesNoPolicy` |
| 승인 경계 · 채널 도달 · Answer Memory | `ProactiveSafetyFenceTest` |

**라이브에서 증명됨 — positive (2026-08-26, `cafe24:b6:a3674` — Part 2):** 운영자가 스토어프론트에 쓴
실제 문의를 **standing routine이 자연 수집**(대상을 찾기 위한 채널 호출 0)하고, 결정론 후보 → production
draft path 조사 → **`MODEL` 작성 초안**(`created_by=SYSTEM:PROACTIVE_AGENT`) → `proactive_case` 1건 →
**세 화면 모두 렌더**까지 갔다. work item은 **`PROPOSED`에서 정지**, `inquiry_approval`·`action_intent`·
`inquiry_execution`·`answer_memory` **전부 0**, product binding 생성 0, quota 소비 **DRAFT 1회**.
근거는 정직하게 비어 있고(`NO_PRODUCT`) 카드가 그렇게 말한다.

**라이브에서 증명됨 — negative (2026-08-25, bounded 1-tick — `docs/evidence/proactive_operations_agent_live_tick_v1.md`):**
production scheduler 경로로 1회 실행 · **대상org수 1/35** · 준비 0건 · `proactive_case` 0행 ·
marketplace WRITE/READ/새 채널호출 **0/0/0** · **LLM 호출 0** · approval·intent·execution·draft·
answer_memory·work-item 감사 **전부 0** · 세 화면 모두 렌더링되고 **섹션 자체가 없음**(0건 계약) ·
telemetry median **null** · `a3672`/`a3673` 각각 **독립적인 두 이유로** 후보 아님(채널 호출 0).

**증명되지 않음 (정직하게):**
- **리뷰 lane의 positive 경로.** baseline 이후 fresh review candidate가 0이라
  **`NO_FRESH_REVIEW_CANDIDATE`**로 남는다 — 가짜 리뷰를 만들지 않았다. offline acceptance는 green이고,
  실제 fresh review가 자연 발생할 때 live evidence를 덧붙인다.
- **판매자의 실제 행동.** `surfaced`까지가 관측됐고 `opened`/`approved`/`VERIFIED`는 null이다. 관측 세션은
  CTA의 target을 **읽기만** 하고 따라가지 않았다 — 클릭은 판매자가 하지 않은 행동을 기록하는 일이다.
- H2 테스트 스키마는 부분 유니크 인덱스를 만들지 않는다. 그래서 그 보증은 **마이그레이션 파일을
  읽는 테스트**로 고정했다 — 실행 증명이 아니라 스키마 증명임을 적어 둔다.

---

## 13. 하지 않은 것

Cafe24 추가 hardening · board 4 · second org 정리 · historical Answer Memory backfill ·
connector expansion · vector DB · synonym ontology · autonomous marketplace write ·
push/email notification · 새 workflow engine · Dashboard 재설계 — **전부 손대지 않았다.**

---

## 14. 남은 product blocker

1. **다음 단계는 아키텍처가 아니라 관찰이다.** 실제 pilot에서 `surfaced → opened → edited/approved →
   VERIFIED`가 실제로 일어나는지를 본다. 이 층을 더 만들 이유는 그 관찰이 나오기 전까지 없다.
2. **`inquiries.content_hash`가 이 org의 실 문의 3,335행 전부 null이다.** dedupe source state가
   `hash=-`이므로, 고객이 **질문 본문만 수정한 경우**는 재조사되지 않는다(상태·역할·상품 연결 변화는 전부
   잡는다). 관측해서 기록만 했고 고치지 않았다.
3. **리뷰 lane live evidence가 남았다** — fresh review가 자연 발생할 때.
4. **일일 AI 예산의 배분은 product-owner 결정이다.** 지금 기본값은 tick당 문의 3건이다. 백그라운드가
   하루 예산의 얼마까지 써도 되는지는 코드가 정할 문제가 아니다.
5. **리뷰는 준비까지만 간다.** 리뷰 답변 WRITE capability가 증명되기 전까지 `RECOMMENDATION_ONLY`가
   천장이고, 이건 v1의 결함이 아니라 채널 사실이다.
6. **판매자가 카드를 "안 볼래"라고 말할 방법이 없다.** 의도적이다 — 카드를 직접 치우는 컨트롤은
   문의 큐와 리뷰 ledger가 모르는 두 번째 dismissal이 된다. 실제로 필요해지면 기존 dismissal을
   확장해야 하고, 그건 product-owner 결정이다.
