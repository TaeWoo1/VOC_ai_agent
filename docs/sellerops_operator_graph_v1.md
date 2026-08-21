# SellerOps Operator Graph v1 — 구현 계약 (정본)

> **Status: IMPLEMENTED 2026-08-21 — product runtime semantics SUPERSEDED by
> `docs/sellerops_operator_graph_v2.md` (2026-08-21).** 이 문서는 **삭제되지 않는다**: 여기 기록된
> 구현·라이브 통합 증명(§14a·§17, `docs/operator_graph_v1_local_integration_proof.md`)은 계속 유효한
> 증거이고, Evidence·Judge·budget·READ-only tool 계약도 v2가 그대로 승계한다. **다만 아래 다섯 문장은
> v2에서 무효다** — §4.1 "planner 실패 시 keyword router가 답한다", §8의 catalogue 전량 인가,
> §13 층2의 결정론 planner 층, §14 "데모 4문항 = 완료 조건", §16 blocker #3(v2 §13.2-B에서 닫혔다).
> 결정론적 goal planner / keyword planner / phrase routing / command fallback은 **v2에서 product·test·
> emergency 어디에도 존재하지 않으며, planner를 쓸 수 없으면 run은 실패한다.** 충돌 시 v2가 이긴다.
>
> **Status(원문): CANONICAL implementation contract — IMPLEMENTED 2026-08-21** (`feat/operator-graph-v1`).
> 계획으로 작성돼 같은 날 구현까지 랜딩했다. 구현이 계획과 다른 곳은 그 자리에 표시했고, 전체 요약은
> §17에 있다. 2026-08-21, product-owner 결정.
> LangGraph를 **SellerOps의 AI Operator 실행 구조**로 지금부터 도입한다. 이 문서는 그 구조의
> **목표·경계·graph/state 계약·tool 계약·구현 package**의 단일 정본이다.
>
> **이 문서가 소유하는 것** — Operator/specialist graph 구성, 행동 등급(READ/PREPARE/WRITE),
> Evidence·Judge·budget 계약, Operator tool 계약, 그리고 v1 구현 package.
>
> **이 문서가 소유하지 않는 것** — capability 진실(`docs/multi-channel-connector-roadmap.md` §4.1),
> 범위 계약(`docs/product-scope-v1.md`), IA·화면 책임(`docs/product_assembly_ia_v1.md`),
> 라이브 승인(`docs/sellerops_live_approval_contract.md`), 현재 능력 상태
> (`docs/demo_baseline_recovery_audit_2026-08-21.md`). 충돌 시 그 문서들이 이긴다.
>
> **현재 상태의 근거는 재감사하지 않는다.** 이 문서의 "지금 무엇이 있는가"는 전부
> `docs/demo_baseline_recovery_audit_2026-08-21.md`(main `2491f1ab`)를 인용한 것이며,
> 여기서 다시 판정하지 않는다. 코드 인용(파일:라인)은 현재 브랜치 기준 재확인한 것이다.

---

## 0. 한 문단

지금 저장소에는 **모델 없는 orchestration**(`agent-runtime/`의 네 StateGraph, 결정론적 keyword
router)과 **orchestration 없는 모델**(backend `agent/llm`, `review/triage/llm`)이 각각 살아 있다
(`docs/decisions/agent-runtime-langgraph-llm-split.md`). Operator Graph v1은 그 둘을 **하나의
실행 구조**로 묶는다: 셀러가 평범한 문장으로 목표를 말하면 **OperatorGraph**가 그것을 해석하고,
어떤 specialist(ProductOps / ReviewOps / InquiryOps / ReportOps)와 어떤 tool이 필요한지 스스로
고르고, 읽은 것을 **Evidence로 남기고**, Evidence Judge가 "근거가 있는가·어디서 왔는가·위험한
단정인가·더 봐야 하는가"를 판정하고, 부족하면 **제한된 범위 안에서** 다시 조회한 뒤 답한다.
**business logic은 Graph 안으로 옮기지 않는다** — Spring이 사실·규칙·데이터·트랜잭션의 정본이고,
Graph는 목표 해석·계획·tool 선택·orchestration·근거 판정·다음 행동 결정만 한다.

---

## 1. 이번 product-owner 결정 (2026-08-21)

1. **LangGraph = SellerOps의 AI Operator 실행 구조.** 실험이 아니라 실행 구조로 채택한다.
2. **Spring Backend = source of truth.** 사실·규칙·데이터·트랜잭션은 전부 backend가 소유한다.
3. **Graph는 재구현하지 않는다.** 기존 business logic을 graph 노드 안에서 다시 쓰지 않는다.
4. **DB는 Agent에 노출하지 않는다.** 검증된 SellerOps capability만 **업무 단위 tool**로 노출한다.
5. **v1 정식 구성** — `OperatorGraph` · `ProductOpsGraph` · `ReviewOpsGraph` · `InquiryOpsGraph` ·
   `ReportOpsNode`. ProductOps·ReviewOps도 **v1 필수**이되, 독립적인 거대 AI 직원이 아니라
   **specialist graph로 제한**한다.
6. **새로 v1에 들어오는 것** — 과거 문의/답변/관련 리뷰에 대한 **retrieval-backed customer memory**,
   **반복 문의 detection**, **실제 LLM 문의 답변 초안의 제품 흐름 연결**.
7. **행동은 READ / PREPARE / WRITE.** READ/PREPARE는 허용, **WRITE는 실제 실행하지 않는다.**
   HITL approval 구조는 설계·구현해도 되나 **외부 write capability(답변 발송·FAQ 수정·상품페이지 변경)는
   disabled 상태를 유지**한다.
8. **credential read/write와 기존 trusted seller interaction 경계는 Agent tool로 노출하지 않는다.**
   현재 privileged plane(collector/Action Window/자격증명 handoff)은 그대로 보존한다.

---

## 2. 경계 — 무엇이 Graph의 일이고 무엇이 Backend의 일인가

| | **Spring Backend (system of record)** | **LangGraph (Operator Runtime)** |
|---|---|---|
| 소유 | 수집·dedupe·정규화·work queue·triage tier·issue memory·item analysis·승인 바인딩·감사·스케줄 | 목표 해석, planning, tool 선택, specialist orchestration, evidence 판단, 다음 행동 결정 |
| 저장 | Postgres 전부 | **없음.** run state조차 backend 소유(`V33__agent_run_store.sql` → `/api/agent-run-store`) |
| 자격증명 | 채널 credential, LLM API key | **어떤 credential도 보유하지 않는다.** 운영자 bearer를 forward할 뿐 |
| LLM egress | **유일한 출구** (`agent/llm/**`, `review/triage/llm/**`) | 없음. 모델은 backend capability로 호출한다 |
| 판정의 정본 | tier·severity·trend·미답변 정의 | 그 판정들을 **선택·조합·설명**하되 재계산하지 않는다 |

**규칙 R1 — 재계산 금지.** graph 노드는 backend가 이미 판정한 값을 다시 계산하지 않는다. "확인 필요"는
`ReviewTriageRules`가, "미답변"은 `InboxResponse.unansweredInquiries`가, "반복/악화"는 `IssueWindows`·
`IssueChangeRules`가 소유한다. graph가 그 숫자를 만들어내면 그 순간 두 번째 정의가 생긴다.

**규칙 R2 — DB 비노출.** tool은 언제나 하나의 HTTP capability에 대응한다. SQL·repository·엔티티가
graph 쪽 타입으로 새지 않는다(기존 `tools/*.ts`가 이미 지키는 규칙).

**규칙 R3 — privileged plane 비노출.** 다음은 **tool 카탈로그에 존재하지 않는다**:
자격증명 등록/조회/삭제(`/api/connect/**`, `/api/agent/credential-handoff`), Action Window 명령,
로컬 에이전트 bridge, 라이브 수집 트리거, 승인 manifest. 이것들은 사람이 화면에서 하는 일이고
`CLAUDE.md` 안전 울타리와 `docs/sellerops_live_approval_contract.md`가 소유한다.

---

## 3. 행동 등급 — READ / PREPARE / WRITE

모든 tool은 정확히 하나의 등급을 선언한다. 등급은 tool의 **주석이 아니라 타입**이다.

| 등급 | 정의 | v1 | 예 |
|---|---|---|---|
| **READ** | 어떤 상태도 바꾸지 않는다 | 허용 | `search_review_issues`, `get_inbox_summary`, `search_customer_memory` |
| **PREPARE** | **SellerOps 내부 산출물만** 쓴다. SellerOps 밖으로 나가는 것이 없다 | 허용 | `propose_inquiry_reply`, `save_inquiry_reply_draft`, `record_inquiry_reply_approval`, `save_review_reply_draft` |
| **WRITE** | **SellerOps 밖(채널·고객)으로 나간다** — 답변 발송, FAQ 수정, 상품페이지 변경 | **v1 disabled. tool이 존재하지 않는다** | — |

**WRITE가 "꺼져 있다"가 아니라 "없다".** v1에서 WRITE 등급 tool은 **구현되지 않는다.** registry는
WRITE 등급 tool을 받으면 생성 시점에 던지고, 구조 테스트가 카탈로그에 WRITE가 0개임을 고정한다.
이는 기존 runtime이 이미 가진 성질(`RunOutcome.externalSendAttempted`가 구조적으로 항상 false,
`ReviewSpringClient` 주석: *"There is no send method, because there is no send endpoint"*)을
등급으로 명문화한 것이지 새 완화가 아니다. `docs/product-scope-v1.md` §7.2(채널로의 쓰기 금지)는
**그대로 유효**하다.

**PREPARE의 HITL.** `record_inquiry_reply_approval`은 backend에서 승인만 바인딩하고
`ACTION_PENDING` intent를 만든다 — execution disabled + 채널 adapter 부재로 아무것도 dispatch하지
않는다. 이것이 v1 HITL의 끝이다: **승인은 기록되고, 발송은 사람이 마켓에서 한다.**

---

## 4. Graph 구성

```
                          POST /api/agent-runs  (기존 surface, 확장)
                                    │
                          ┌─────────▼──────────┐
                          │   OperatorGraph    │
                          │  interpretGoal     │  ← LLM planner (backend), 실패 시 keyword router
                          │  plan              │  ← specialist + tool + budget 선택
                          │  dispatch ─────────┼──────────────┬──────────────┬───────────────┐
                          │  evidenceJudge     │              │              │               │
                          │  (bounded loop) ◄──┤              │              │               │
                          │  compose           │              │              │               │
                          └─────────┬──────────┘              │              │               │
                                    │                          │              │               │
                            OperatorAnswer            ProductOpsGraph  ReviewOpsGraph  InquiryOpsGraph
                                                                                              │
                                                                                       ReportOpsNode
```

### 4.1 OperatorGraph — `agent-runtime/src/operator/`

노드: `interpretGoal → plan → dispatch → collectEvidence → evidenceJudge → (plan | compose) → END`

- **interpretGoal** — 기존 `goal/parseGoal.ts` seam **뒤에** LLM planner를 넣는다. planner가 off이거나
  실패하면 **현재의 결정론적 keyword table이 그대로 답한다**. 즉 LLM이 꺼진 배포에서도 네 데모 질문이
  전부 동작하고, 켜지면 더 넓은 문장을 받는다. `UnrecognizedGoalError`(fail closed)는 유지된다.
- **plan** — 어떤 specialist를 어떤 순서로 부를지, 어떤 tool을 몇 번 쓸지 정한다. 결과는
  `OperatorPlan`(specialist 목록 + tool 예산 + 근거 요구 수준). plan은 **tool 이름으로만** 말한다 —
  registry에 없는 이름은 실행 전에 거부된다(fail closed).
- **dispatch** — specialist subgraph를 호출한다. specialist는 자기 registry만 본다(권한 분리).
- **collectEvidence** — specialist가 읽은 것을 `EvidenceRef`로 state에 적재한다(§5).
- **evidenceJudge** — §6.
- **compose** — `OperatorAnswer`(§5)를 만든다. 근거 없는 문장은 findings에 들어가지 못한다.

**루프는 bounded**(§7). judge가 `needsMore`를 반환해도 예산이 남아 있을 때만 `plan`으로 돌아간다.

### 4.2 ProductOpsGraph — 상품 단위 specialist (신규)

목적: **"A상품 요즘 문제 있어?"** 한 질문.
`resolveProduct → gatherSignals(병렬 READ) → summarize → END`

읽는 것(전부 기존 판정): 해당 상품이 dominant이거나 evidence에 포함된 **반복 이슈**와 그 trend,
per-product evidence split, 그 상품의 **item analysis** 카테고리·추천 액션, 그 상품에 붙은
**확인 필요 리뷰 수**와 **미답변 문의 수**. 자체 판정은 하지 않는다(R1).
**상품 grouping 자체가 지금 끊겨 있다** — 감사 §2.2의 D/G. 그래서 이 graph는 §11의 복구 D 위에 선다.

### 4.3 ReviewOpsGraph — 리뷰 specialist (기존 `reviewGraph` 재사용 + 읽기 확장)

기존 `graph/reviewGraph.ts`(답변 준비 + `interrupt` 승인)를 **그대로** 쓰고, Operator가 부를 수 있는
**읽기 진입점**을 더한다: 계정별 `tier=NEEDS_ATTENTION` 요약, 최근 유입, 답변 작업 큐 상태.
초안 본문은 v1에서도 backend 규칙 제안 그대로다(감사 §2.5 표) — LLM 초안은 **문의 축**에서만 연결한다(§9).

### 4.4 InquiryOpsGraph — 문의 specialist (기존 두 graph 재사용 + customer memory)

기존 `graph/inquiryGraph.ts`(승인 루프, PREPARE)와 `graph/inquiryDraftGraph.ts`(초안 준비, READ-only)를
그대로 쓰고, **초안 생성 전에** customer memory 조회 노드를 넣는다:

`search → prioritize → loadDetail → recallCustomerMemory → generateDraft → (checkpoint) → END`

`recallCustomerMemory`는 §10의 신규 backend capability를 READ tool로 호출해
**과거 유사 문의 · 그때 승인된 답변 · 관련 리뷰 이슈**를 가져오고, 그것을 `EvidenceRef`로 남긴 뒤
초안 provider에 컨텍스트로 넘긴다. **초안은 실제 LLM 초안**이며(§9), 실패하면 지금처럼 규칙 초안으로
degrade하고 provenance가 그 사실을 말한다.

### 4.5 ReportOpsNode — 리포트 (graph 아님, 노드)

**graph가 아니라 노드다** — 분기도 승인도 없고 한 번의 조합이기 때문이다. 기존 `/reports`가 읽는
네 소스와 **정확히 같은 소스**를 읽어 주간 보고를 구성한다. 숫자의 정의는 backend가 소유하고
(특히 미답변은 서버 `unansweredInquiries`, §11-A), 노드는 조합과 서술만 한다.

---

## 5. State — Evidence는 일급 객체

`agent-runtime/src/operator/state/OperatorState.ts` (신규, 기존 `Annotation.Root` 패턴)

```ts
export type ActionClass = "READ" | "PREPARE" | "WRITE";

/** 무엇을 어디서 읽었는가. 고객 원문은 절대 담지 않는다 — 위치와 메타데이터만. */
export interface EvidenceRef {
  readonly evidenceId: string;        // run 안에서 유일 (e1, e2, …) — finding이 이것을 참조
  readonly kind: "REVIEW_ISSUE" | "REVIEW" | "INQUIRY" | "PAST_REPLY"
               | "ITEM_ANALYSIS" | "INBOX_COUNT" | "ORDER_SUMMARY" | "PRODUCT_SIGNAL";
  readonly sourceTool: string;        // registry 이름
  readonly sourceCall: string;        // 인자의 안정 해시 (재현·중복 제거용)
  readonly locator: {                 // id / 라벨 / 카운트만. 본문·인용 없음
    readonly issueId?: string; readonly workItemId?: string; readonly reviewActionRef?: string;
    readonly productId?: string; readonly accountId?: string; readonly channelCode?: string;
    readonly count?: number; readonly label?: string;
  };
  readonly observedOn: string | null; // 데이터의 날짜 (ISO date-only). 내부 타이밍 아님
  readonly retrievedAtIso: string;    // 조회 시각 (초 단위)
}

/** Operator가 말하려는 한 문장과 그 근거. */
export interface Finding {
  readonly findingId: string;
  readonly statement: string;                 // SellerOps가 생성한 문장 (고객 원문 아님)
  readonly evidenceIds: readonly string[];    // 비어 있으면 finding이 될 수 없다
  readonly verdict: JudgeVerdict | null;
  readonly surfaceLink: string | null;        // 권한 있는 기존 화면으로의 링크
}

export interface OperatorAnswer {
  readonly goalEcho: string;
  readonly findings: readonly Finding[];
  readonly evidence: readonly EvidenceRef[];
  readonly nextActions: readonly { label: string; actionClass: ActionClass; surfaceLink: string }[];
  readonly budget: BudgetReport;
  readonly note?: string;                     // 잘린 것·못 본 것은 반드시 여기에
}
```

state 채널: `goal · plan · specialistResults · evidence(append) · findings · verdicts · budget · answer · trail(append)`.
`trail`만 append reducer(기존 규칙 그대로), 나머지는 last-value.

**Evidence 규칙**
- **E1 — 근거 없는 finding은 없다.** `evidenceIds`가 빈 finding은 `compose`가 버린다.
- **E2 — Evidence는 고객 원문을 담지 않는다.** id·라벨·카운트·날짜만. 기존 `IssueBriefEntry`·
  `AgentRunView`의 sanitization 계약과 동일하며, `V33` run store의 raw-content 거부와도 일치한다.
- **E3 — 추적 가능해야 한다.** 최종 finding/draft에서 `evidenceId → sourceTool + sourceCall + locator`로
  실제 source까지 내려갈 수 있어야 한다. `/agent`는 이 링크를 **권한 있는 기존 화면**(문의 상세·리뷰·
  `/memory`)으로만 연다 — 원문은 거기서 읽는다.

---

## 6. Evidence Judge

`agent-runtime/src/operator/judge/` — finding 하나당 한 번, 최소 네 가지를 판정한다.

```ts
export interface JudgeVerdict {
  readonly hasEvidence: boolean;              // ① 근거 존재 여부
  readonly evidenceIds: readonly string[];    // ② 근거 출처 (제시된 것 중 실제로 그 문장을 지지하는 것)
  readonly unsafeAssertion: boolean;          // ③ 위험한 단정 여부
  readonly unsafeReason: string | null;
  readonly needsMore: { readonly needed: boolean; readonly tool: string | null;  // ④ 추가 조회 필요 여부
                        readonly args: Record<string, unknown> | null; readonly reason: string };
  readonly judgeKind: "LLM" | "RULE_BASED";   // provenance — 라벨을 하드코딩하지 않는다
}
```

**위험한 단정(③)의 정의** — v1의 닫힌 목록:
(a) 원인 단정(“이 문제는 X 때문이다”), (b) 고객 책임 단정, (c) 성과·개선 주장(`pages-copy.test.ts`가
화면에서 이미 금지), (d) 근거 수 대비 과일반화(단일 증거로 “늘고 있다/반복된다”), (e) 채널·상품 범위
확장(한 계정에서 본 것을 전 채널로 말함), (f) 기간 미표기 총계를 “이번 주”로 말함.

**Judge는 fail closed.** LLM judge가 off / 실패 / off-schema면 **규칙 judge**가 답한다: 규칙 judge는
`hasEvidence = evidenceIds.length > 0`, `unsafeAssertion`은 (c)~(f)의 결정론적 검사로 판정하고
`needsMore.needed = false`를 반환한다. 판정이 아예 불가하면 finding은 **버려지지 않고 강등**된다 —
`verdict = null`인 finding은 주장 문장이 아니라 “확인 필요” 항목으로만 렌더된다. **거짓 확신보다
정직한 공백**이 이 저장소의 기존 규칙이다(리포트의 “확인할 수 없음” 렌더와 동일).

---

## 7. Budget — bounded, fail-closed

```ts
export const OPERATOR_BUDGET_V1 = {
  maxIterations: 3,      // plan → dispatch → judge 사이클
  maxToolCalls: 12,      // run 전체 (specialist 포함)
  maxLlmCalls: 6,        // planner + judge + draft 합계
  deadlineMs: 60_000,
} as const;
```

- 예산 초과는 **에러가 아니라 종료 상태** `BUDGET_EXHAUSTED`다. 지금까지의 findings + evidence를
  그대로 반환하고 `note`에 **무엇을 못 봤는지** 적는다. **조용한 절단 금지**는 이미 저장소 규칙이다
  (`inquiryDraftGraph`의 `capped` 로그, 감사 §4의 “조용히 제거하지 않는다”).
- registry에 없는 tool, WRITE 등급 tool, 스코프 밖 인자 → **실행 전 거부**(fail closed).
- specialist 하나가 실패해도 run은 실패하지 않는다: 그 specialist의 결과가 빠졌다는 사실이 `note`에
  남고 나머지로 답한다(기존 best-effort listener 패턴과 같은 방향).

---

## 8. Tool 계약

`agent-runtime/src/operator/tools/OperatorToolRegistry.ts` — 기존 `ToolRegistry`를 **감싸서**
등급·스코프를 강제한다(기존 registry 3개는 손대지 않는다).

**표 읽는 법** — `상태` 열은 **backend capability**의 상태다. `재사용` = 그 endpoint가 이미 있고 이미
검증돼 있다는 뜻이며, 그중 `get_today_inbox` · `list_item_analysis` · `get_dashboard_product_issues`는
**tool wrapper만 새로 쓴다**(endpoint 신규 아님). `신규`인 넷만 backend 코드가 추가됐다.

| tool | 등급 | backend endpoint | 상태 |
|---|---|---|---|
| `get_today_inbox` | READ | `GET /api/inbox` | 재사용 |
| `search_review_issues` | READ | `GET /api/review-issues` | 재사용 |
| `get_review_issue_trend` | READ | `GET /api/review-issues/{id}/trend` | 재사용 |
| `get_review_issue_evidence_summary` | READ | `GET /api/review-issues/{id}/evidence-summary` | 재사용 |
| `search_unanswered_inquiries` | READ | `GET /api/inquiries?phase=OPEN` | 재사용 |
| `get_inquiry_detail` | READ | `GET /api/inquiries/{workItemId}` | 재사용 |
| `list_item_analysis` | READ | `GET /api/item-analysis` | 재사용 |
| `get_dashboard_product_issues` | READ | `GET /api/dashboard/summary` | 재사용 |
| `resolve_product` | READ | `GET /api/products` | **신규** (§10.3) |
| `get_product_signals` | READ | `GET /api/products/{id}/signals` | **신규** (§10.3) |
| `search_customer_memory` | READ | `GET /api/customer-memory/search` | **신규** (§10.1) |
| `list_repeated_inquiries` | READ | `GET /api/customer-memory/repeats` | **신규** (§10.2) |

**12개 tool · 8 재사용 · 4 신규 · 등급은 전부 READ · WRITE 0개.**

**구현이 계획보다 좁아진 지점 (의도적).** 계획 단계의 이 표는 PREPARE tool 다섯 개
(`propose_inquiry_reply` · `save_inquiry_reply_draft` · `record_inquiry_reply_approval` ·
`save_review_reply_draft` · `approve_review_reply`)도 Operator 카탈로그에 넣을 예정이었다.
**넣지 않았다.** 그 다섯은 기존 문의 승인 루프와 리뷰 답변 루프 **안에** 그대로 남아 있고, 각자의
intent로만 도달한다 — 즉 사람이 그 흐름을 명시적으로 시작했을 때만 실행된다. Operator는 자기 tool을
스스로 고르므로, 카탈로그에 있는 것은 곧 **Operator가 혼자 결정해서 할 수 있는 일**이다. 초안 저장과
승인 기록은 사람이 시작한 흐름 안에 있어야 하는 일이라 카탈로그 밖에 두었다. 결과적으로
**Operator 카탈로그는 100% READ**이며, 이는 계획한 fence보다 한 칸 더 보수적이다.

**Operator 카탈로그에 일부러 넣지 않은 기존 tool** — `prepare_guided_reply_session`
(`reviewTools.ts`). 발송이 아니라 단일-사용 guided submission ref를 mint할 뿐이지만, **사람이 마켓에서
하는 행동의 입구**다. `operatorToolRegistry.test.ts`가 이 이름과 자격증명·Action Window·수집 트리거
이름들이 카탈로그에 없음을 고정한다.

## 9. LLM 노출 — 세 capability, 세 flag, 세 payload floor

backend가 유일한 LLM egress라는 성질은 **바뀌지 않는다.** Operator가 필요로 하는 모델 호출은
전부 backend capability로 추가된다. ADR이 세운 규칙 — *다른 노출은 다른 flag·다른 key·다른 prompt·
다른 payload floor* — 을 그대로 따른다.

| capability | 무엇이 나가는가 | flag | 상태 |
|---|---|---|---|
| `review triage` | 리뷰 rating + body | `sellerops.triage.ai-pilot.*` | **기존, 손대지 않음** |
| `inquiry draft` | 문의 title + details | `sellerops.agent.draft.*` | **기존, 제품 흐름에 연결**(§11-H 방향) |
| `operator plan` | **운영자가 입력한 목표 문장 + 정적 tool 카탈로그** | `sellerops.agent.plan.*` | **신규** |
| `operator judge` | **SellerOps가 생성한 finding 문장 + evidence 메타데이터(라벨·카운트·날짜)** | `sellerops.agent.judge.*` | **신규** |

- **plan/judge에는 고객 원문이 단 한 글자도 포함되지 않는다.** planner는 운영자 자신의 문장과 정적
  카탈로그만 본다. judge는 SellerOps가 만든 문장과 §5-E2를 통과한 evidence만 본다. 두 payload floor는
  각각 **직렬화된 요청 바이트에 대해** 테스트로 고정한다(`AgentDraftPayloadFloorTest`와 동형).
- **customer memory 검색은 LLM이 아니다.** §10.1은 backend 내부의 결정론적 lexical retrieval이며
  **새로운 vendor egress를 만들지 않는다.** 임베딩은 port 뒤에 남겨 두고 v1에서 구현하지 않는다(§16).
- 세 capability는 각각 자기 door를 가지며, `AgentDraftBoundaryTest`의 “유일한 문” 검사를
  **(generator, door) 쌍의 표로 일반화**한다(§12-6).

---

## 10. 신규 backend capability (전부 READ, 전부 기존 자산 위)

### 10.1 Customer Memory — retrieval-backed (신규 모듈 `backend/…/customermemory/`)

**무엇을 검색하는가** — 과거 **문의**, 그 문의에 대해 **승인된 답변**, 그리고 **관련 리뷰 이슈**.

**어떻게 — 임베딩 없이.** 이미 있는 것을 쓴다: `reviewissue/IssueSignatureExtractor`(port),
`OpinionUnitSplitter`(절 분리), `IssueSignature.signatureKey()`. `IssueSignature`의 주석이 그
설계를 이미 적어 두었다 — *“search the issue memory”는 similarity search가 아니라 indexed lookup이며
vector extension도 external call도 없다.* v1의 customer memory는 그 성질을 문의 축으로 확장한 것이다:
정규화된 signature key + 용어 중첩(term overlap) 기반의 **결정론적 lexical retrieval**.

`CustomerMemoryRetriever`를 port로 둔다. 임베딩 기반 구현은 **다른 exposure**(고객 원문을 대량으로
vendor에 보내는 일)이므로 별도 결정 전까지 구현하지 않는다 — `IssueSignatureExtractor`가 semantic
half를 port 뒤에 남겨 둔 것과 정확히 같은 방식이다.

**적재는 어디서** — §11의 `IngestFollowUp` 한 지점(아래 §11-BC). 새 파이프라인을 만들지 않는다.

### 10.2 반복 문의 detection

§10.1의 같은 index 위의 **집계**다: 기간 창 안에서 `signature_key`별 문의 수를 세고,
`ReviewIssueThresholds`가 리뷰 축에서 쓰는 것과 같은 모양의 임계값으로 “반복”을 판정한다.
**별도 테이블도 별도 파이프라인도 없다.** 감사 §2.3(c)의 `I`(반복 문의 MISSING)가 여기서 닫힌다.

### 10.3 Product signals

- `GET /api/products?q=&limit=` — 상품 해석(이름/SKU). `ProductRepository` 위의 조회.
- `GET /api/products/{id}/signals?referenceDate=` — 그 상품의 반복 이슈·trend·evidence split,
  item analysis 추천 액션, 확인 필요 리뷰 수, 미답변 문의 수를 **기존 서비스에서 모아** 반환.
  새 판정 없음(R1). `ReviewIssueQueryService` · `ItemAnalysisService.list` · 리뷰/문의 repository의
  상품 스코프 count만 추가된다.

---

## 11. 함께 복구할 것 (감사 A·B·C·D) — 재구현 없이 composition

감사 §4가 이미 최소 복구 순서를 정해 두었다. 이 package는 **그 순서를 그대로 실행**한다.

**A — 홈/리포트 미답변 수 정합성 (P0, FE 1곳)**
`frontend/src/lib/reportView.ts:80`의 `unanswered`를 50행 캡 위의 필터가 아니라 서버
`InboxResponse.unansweredInquiries`로 바꾼다. `lib/todayInbox.ts:149 buildInquiryToday`가 이미
그렇게 하고 있으므로 규칙을 옮겨 오는 것뿐이다. `ReportsV2.tsx:123`은 그 필드를 넘기도록 좁게 조정.
회귀 테스트 1개: **같은 org 데이터에서 홈과 리포트가 같은 수를 인쇄한다.**

**B·C — 하나의 ingest 후처리 seam (P0, backend)**
지금 세 ingest 경로가 각자 다른 후처리를 갖는다:

| 경로 | item analysis | issue memory event |
|---|---|---|
| `connector/FileUploadConnector.java:170` | ✅ | ❌ |
| `collect/SyncRunExecutor.java:405 ingestPage` (API 수집) | ❌ | Cafe24 board-4만 (`Cafe24ReviewIssueBridge:77`) |
| `collect/AgentReviewHandoffService.java:113` (Coupang 취득) | ❌ | ❌ |

→ **`ingest/IngestFollowUp`** 하나를 만들고 세 지점이 그것을 부른다. 후처리 세 가지를 한 곳에서 한다:
(1) `ItemAnalysisService.analyzeForSources(orgId, sourceType, insertedIds)` — **기존 메서드, skip-if-exists 멱등**,
(2) `ReviewSegmentIngestedEvent` 발행 — **기존 이벤트·기존 리스너**(AFTER_COMMIT · REQUIRES_NEW · best-effort),
(3) customer memory index 적재(§10.1) — 같은 `insertedIds` 위에서.
`IngestOutcome.insertedIds`는 이미 모든 ingest 경로가 반환한다. **새 파이프라인 0개, 새 서비스 로직 0개.**
`FileUploadConnector`의 기존 호출은 이 컴포넌트로 대체한다(동작 동일, `ExportToReportChainTest`가 고정).

**D — product issue aggregation consumer 복원 (P1, FE)**
`DashboardService.buildTopProductIssues()`와 `GET /api/dashboard/summary`는 살아 있고
`ExportToReportChainTest`가 값을 고정한다. 소비자만 없다(`apiClient.ts:540` 정의 1·호출 0).
`/reports`에 **상품별 이슈 섹션**을 붙여 소비자를 되살린다. **백엔드 무변경.** ProductOpsGraph의
`get_dashboard_product_issues` tool이 같은 endpoint의 두 번째 소비자가 된다.

**E(수동 트리거 UI 미연결)는 이번에 닫지 않는다.** B·C가 붙으면 수동 복구 경로는 운영자 도구로 남는다 —
감사 §4-3단계가 이미 그렇게 판단했다.

---

## 12. 정본·테스트 충돌 목록 (조용히 제거하지 않는다)

| # | 충돌하는 것 | 무엇이 문제인가 | 처리 |
|---|---|---|---|
| 1 | `docs/architecture.md` §“두 facts” ①: *“`agent-runtime/`은 LLM 호출을 담지 않는다”* | **이미 2026-08-20에 사실이 아니게 됐다**(SpringDraftProvider). Operator v1이 planner/judge를 더하면 더 벌어진다 | **수정**(이번 턴) — 사실을 현재로 맞추고, 유지되는 성질(“backend가 유일한 egress”, “runtime은 credential 0”)을 그 자리에 남긴다 |
| 2 | `docs/architecture.md` 런타임 표: *“Four compiled StateGraphs”* | v1에서 Operator + ProductOps가 늘어난다 | **수정**(이번 턴, 문구를 구성 정본 링크로) |
| 3 | `docs/product-scope-v1.md` §5.1 · §7.10: *RAG는 맥락형 “운영 메모리” 패널로만, **별도 승인 전 구현 금지*** | 이번 결정이 바로 그 **별도 승인**이다. 다만 “standalone AI 검색 페이지 금지”는 계속 유효 | **개정 v1.12**(이번 턴) — 금지의 **조건부 해제**를 기록. 해제 범위: Operator/문의 초안 컨텍스트로서의 retrieval. **1차 내비의 독립 AI 검색 페이지는 계속 금지** |
| 4 | `docs/product-scope-v1.md` §7.18: *OperationRun 도메인 조기 구현 금지* | 혼동 위험 — Operator Graph는 backend의 OperationRun 도메인이 아니다 | **문구 추가**(이번 턴) — 두 가지가 다른 것임을 명시. OperationRun은 계속 금지 |
| 5 | `docs/decisions/agent-runtime-langgraph-llm-split.md` §“Still open”: *`parseGoal` 미결* | 이번 결정이 그 항목을 닫는다(planner 도입) | **부분 supersede 표기**(이번 턴) — ADR은 유지하고 상태 줄만 추가. 나머지 두 미결(triage 미이관, reviewGraph 초안)은 **계속 열린 채** |
| 6 | `backend/src/test/.../AgentDraftBoundaryTest.theServiceIsTheOnlyDoor` | planner/judge가 `AgentLlmTransport`를 쓰는 순간 이 테스트가 깨진다 | **일반화**(구현 시) — “AgentDraftService가 유일한 문” → “**capability마다 정확히 하나의 문**” 표. 삭제 금지. 약화 아님 — 검사 대상이 1개에서 3개로 늘어난다 |
| 7 | `frontend/src/pages/app/CustomerMemory.tsx:15` scope fence + `pages/app/memoryScope.test.tsx` | 겉보기엔 “RAG 금지”로 읽히지만 **그 fence는 `/memory` 화면에 검색창을 두지 않는다**는 화면 계약이다 | **유지. 건드리지 않는다.** v1의 retrieval은 `/agent`(Operator)와 문의 초안 컨텍스트에만 붙고 `/memory`에는 검색창이 생기지 않는다. `memoryScope.test.tsx`는 **수정 없이 계속 통과해야 한다** — 이 package의 DoD 항목이다 |
| 8 | `CLAUDE.md` “Active source ownership”의 agent-runtime 문단(“four compiled graphs”, “one node of two graphs”) | 구현 후 사실이 달라진다 | **구현 PR에서 수정**(이번 턴에는 canonical reading path에 이 문서만 추가) |
| 9 | `docs/demo_runbook_v1.md` §3 데모 동선 | Operator 콘솔이 동선에 없다 | **구현 PR에서 갱신.** Demo Baseline 문서이므로 이번 턴에는 건드리지 않는다 |
| 10 | `docs/multi-channel-connector-roadmap.md` §4.1 | — | **아무 칸도 옮기지 않는다.** 운영 지원 열은 그대로 |

**의도적으로 유지되는 fence** — §7.2(채널 쓰기 금지) · §7.1(무인 수집) · §7.13(인증 우회) ·
§7.14(사람 통제 결정 자동화) · §7.16·§7.17(Action Window) · `CLAUDE.md` 안전 울타리 전부 ·
라이브 승인 계약. Operator v1은 이 중 어느 것도 완화하지 않는다.

---

## 13. 단일 구현 package plan

작은 기능 slice로 쪼개지 않는다. **한 브랜치, 한 package, 한 PR**(`feat/operator-graph-v1`).
아래 다섯 층은 순서가 있지만 서로 다른 PR이 아니다 — 하나의 package 안의 작업 순서다.

### 층 0 — 복구 (다른 층이 이 위에 선다)
- `backend/…/ingest/IngestFollowUp.java` **(신규)** — §11-BC의 후처리 3종을 한 곳에서.
- `backend/…/connector/FileUploadConnector.java` — `triggerAnalysis` → `IngestFollowUp` 호출로 대체.
- `backend/…/collect/SyncRunExecutor.java` — `ingestPage` 반환 직전 `IngestFollowUp` 호출.
- `backend/…/collect/AgentReviewHandoffService.java:113` — 같은 호출.
- `frontend/src/lib/reportView.ts` · `pages/app/ReportsV2.tsx` — §11-A(미답변 서버 수치) + §11-D(상품별 이슈 섹션).

### 층 1 — backend capability (전부 READ, 얇게)
- `backend/…/customermemory/` **(신규 모듈)** — `CustomerMemoryEntry`, `CustomerMemoryEntryRepository`,
  `CustomerMemoryIndexer`(적재), `CustomerMemoryRetriever`(port) + `LexicalCustomerMemoryRetriever`(구현),
  `RepeatedInquiryService`, `CustomerMemoryController`(`/api/customer-memory/{search,repeats}`), `dto/`.
- `backend/…/product/ProductQueryService.java` **(신규)** + `ProductSignalsService.java` **(신규)** +
  `ProductController.java` **(신규, `/api/products`)** — 기존 서비스 조합만.
- `backend/…/review/ReviewRepository` · `inquiry/InquiryRepository` — 상품 스코프 count 쿼리 추가.
- `backend/…/agent/llm/` — `AgentPlannerService` + `AgentPlanPrompt` + `AgentPlanResponseParser` +
  `AgentPlanProperties` **(신규)**, `AgentEvidenceJudgeService` + 동형 3종 **(신규)**,
  `AgentOperatorController`(`POST /api/agent/plan`, `POST /api/agent/judge`) **(신규)**.
  transport(`AgentLlmTransport`)는 **공유**, flag·key·prompt·parser·floor는 **분리**.
- **migration `V47__customer_memory_index.sql`** — `customer_memory_entries` 1개 테이블 + 인덱스.
  V46이 현재 최대이므로 V47이 다음 자유 번호(forward-only).

### 층 2 — agent-runtime Operator
- `agent-runtime/src/operator/state/OperatorState.ts` **(신규)** — §5.
- `agent-runtime/src/operator/graph/operatorGraph.ts` **(신규)** — §4.1.
- `agent-runtime/src/operator/graph/productOpsGraph.ts` **(신규)** — §4.2.
- `agent-runtime/src/operator/graph/reportOpsNode.ts` **(신규)** — §4.5.
- `agent-runtime/src/operator/judge/{EvidenceJudge.ts, RuleEvidenceJudge.ts, SpringEvidenceJudge.ts}` **(신규)** — §6.
- `agent-runtime/src/operator/plan/{Planner.ts, KeywordPlanner.ts, SpringPlanner.ts}` **(신규)** — §4.1.
- `agent-runtime/src/operator/tools/OperatorToolRegistry.ts` **(신규)** — 등급 강제 §3·§8.
- `agent-runtime/src/operator/budget/OperatorBudget.ts` **(신규)** — §7.
- `agent-runtime/src/operator/operatorRuntime.ts` **(신규)** — 기존 runtime 4개와 같은 모양.
- **수정** — `src/goal/parseGoal.ts`(planner seam + `HANDLE_OPERATOR_GOAL`·`PRODUCT_OPS` 도메인 추가),
  `src/router.ts`(OPERATOR/PRODUCT 라우팅), `src/spring/SpringClient.ts`(신규 READ 4종 + plan/judge),
  `src/spring/types.ts`(응답 타입), `src/http/{contract.ts,AgentRunService.ts,server.ts}`
  (`AgentRunView.answer?: OperatorAnswer`), `src/graph/inquiryDraftGraph.ts`(`recallCustomerMemory` 노드),
  `src/tools/inquiryTools.ts`(memory READ tool 추가).
- **기존 4개 graph의 노드·엣지·checkpoint 계약은 바꾸지 않는다.** InquiryDraft에 노드 하나가 들어가는 것이
  유일한 그래프 변경이며 그것도 READ-only 경로다.

### 층 3 — frontend
- `frontend/src/pages/Agent.tsx` — Operator 답변 렌더(finding + evidence chip + next action).
  기존 checkpoint UI·provenance 라벨 규칙(`draftKindLabel`)은 그대로.
- `frontend/src/lib/agentRuntime/types.ts` — `OperatorAnswer` 타입.
- `frontend/src/lib/apiClient.ts` — 신규 READ endpoint(필요한 것만).
- **route 추가 없음. 1차 메뉴 변경 없음. `/memory` 변경 없음.** → A7 FE freeze 유지.

### 층 4 — 문서
- 이 문서를 구현 사실에 맞춰 갱신 + `CLAUDE.md` agent-runtime 문단 · `docs/architecture.md` 갱신 ·
  `docs/demo_runbook_v1.md` §3 동선에 Operator 단계 추가.
- 라이브 실행이 있으면 `docs/evidence/INDEX.md`에 같은 PR에서 행 추가(증거 규칙).

### 테스트 전략

| 층 | 테스트 | 무엇을 고정하는가 |
|---|---|---|
| 구조 | `OperatorToolRegistryTest` (agent-runtime) | **WRITE 등급 tool 0개**, 미등록 tool 거부, privileged endpoint 미노출 |
| 구조 | `AgentLlmBoundaryTest` (backend, 기존 `AgentDraftBoundaryTest` 일반화) | capability마다 문 정확히 1개, 세 capability 상호 미참조 |
| 경계 | `AgentPlanPayloadFloorTest` · `AgentJudgePayloadFloorTest` | **직렬화된 바이트**에 고객 원문 0 |
| 경계 | `OperatorEvidenceSanitizationTest` | `EvidenceRef`·`OperatorAnswer`에 원문·토큰·내부 타이밍 0 |
| 동작 | `operatorGraph.e2e.test.ts` ×4 | 데모 4문항이 fake backend에서 끝까지 간다 |
| 동작 | `operatorBudget.test.ts` | 예산 초과 = `BUDGET_EXHAUSTED` + note, 크래시 아님 |
| 동작 | `evidenceJudge.test.ts` | judge off/실패/off-schema → 규칙 judge, finding 강등, 조용한 통과 없음 |
| 결정론 | `operatorPlannerOff.test.ts` | planner off에서 네 질문이 keyword router로 **동일하게** 동작 |
| 복구 | `IngestFollowUpTest` (3 호출 지점) | 세 경로 모두에서 item analysis + issue event + memory index |
| 복구 | `reportView.test.ts` + `HomeReportParityTest` | **홈과 리포트가 같은 수를 인쇄한다** |
| 신규 BE | `CustomerMemoryRetrievalTest` · `RepeatedInquiryServiceTest` · `ProductSignalsServiceTest` | 결정론·멱등·org 스코프 |
| **비-회귀** | `pages/app/memoryScope.test.tsx` **수정 없이 통과** | §12-7의 fence가 유지된다 |

### Definition of Done
1. 데모 4문항이 로컬에서 실제 데이터로 끝까지 동작한다(planner on / off 양쪽).
2. WRITE tool이 카탈로그에 0개임을 구조 테스트가 고정한다.
3. 홈·리포트 미답변 수가 같다.
4. 세 ingest 경로 모두 item analysis·issue memory·customer memory에 도달한다.
5. `/reports`에 상품별 이슈가 다시 보인다.
6. `memoryScope.test.tsx`가 **수정 없이** 통과한다.
7. 네 CI(backend/frontend/collector/agent-runtime) green.
8. §12의 문서 수정이 같은 PR에 들어 있다.

---

## 14. 데모 4문항 → 실행 경로

| 질문 | Operator가 고르는 것 | 근거 |
|---|---|---|
| “오늘 뭐부터 봐야 해?” | `get_today_inbox` + `search_reviews_needing_reply` + `search_review_issues` → findings 우선순위 | 서버 미답변 수 · triage tier · issue severity/trend |
| “A상품 요즘 문제 있어?” | `resolve_product` → **ProductOpsGraph** (`get_product_signals`, `get_review_issue_trend`, `list_item_analysis`) | 상품별 issue evidence split · trend · item analysis |
| “이 문의 답변 초안 만들어줘.” | **InquiryOpsGraph** (`get_inquiry_detail` → `search_customer_memory` → LLM 초안) | 과거 유사 문의 + 승인된 답변 + 관련 이슈, provenance 라벨 |
| “이번 주 대표에게 보고할 내용 정리해줘.” | **ReportOpsNode** (`get_today_inbox`, `search_review_issues`, `list_item_analysis`, `get_dashboard_product_issues`) | `/reports`와 **같은 소스·같은 정의** |

네 경우 모두 근거가 부족하면 judge의 `needsMore`로 **예산 안에서** 한 번 더 조회하고, 그래도 부족하면
“확인 필요”로 강등해 말한다.

---

## 14a. 구현 결과 — 계획과 달라진 것

계획대로 랜딩한 것은 다시 적지 않는다. **달라진 다섯 곳**만 기록한다.

1. **Operator 카탈로그가 계획보다 좁다 — 100% READ.** PREPARE tool 5개를 넣지 않았다(§8 참조).
   Operator가 스스로 고를 수 있는 tool 목록에 초안 저장·승인 기록을 두지 않는 편이, 그것들을 사람이
   시작한 흐름 안에 남겨 두는 것보다 나쁠 이유가 없었다.

2. **`Finding.claimsCoverageLimit` — 없으면 정직한 답이 스스로를 지운다.** judge의 핵심 규칙은
   "판단 불가 소스의 근거는 주장을 뒷받침하지 않는다"인데, **주장 자체가 "판단할 수 없습니다"인
   finding**에는 그 규칙이 정반대로 작동한다: 불확실성이 곧 근거다. 플래그 없이 구현했을 때
   ProductOps의 판단-불가 finding이 UNSUPPORTED로 떨어져 compose에서 제거됐고, 결과는 3,208건의
   귀속 불가 문의를 가진 상품이 "문제 없습니다"로 답하는 것이었다 — 이 설계가 막으려던 바로 그 실패.
   `operatorScenarios.e2e.test.ts`의 "a product with no linked data says so"가 이것을 고정한다.

3. **`Planner.usesModel` / `EvidenceJudge.usesModel` — `kind`와 다른 질문.** `kind`는 무엇인가이고
   이것은 다음 호출에서 실제로 모델을 부르는가이다. judge endpoint가 없는 backend를 가리키는
   `SpringEvidenceJudge`는 `kind === "LLM"`이면서 모델을 한 번도 부르지 않는다. 이 구분 없이는
   일어나지도 않을 호출로 llm 예산을 소진해 run이 조기 종료됐다(finding이 `verdict: null`로 남았다).

4. **자유 문장의 라우팅이 400에서 OPERATOR로 바뀌었다.** keyword table이 거부하던 free text
   ("오늘 뭐부터 봐야 해?")는 이제 Operator로 간다. **명시적 `intent`는 그대로** — 모르는 intent는
   여전히 400이다. Operator 자신이 fail-closed floor를 가지므로(지원하지 않는 목표는 정직한
   "지원하지 않습니다" 답), **물을 수 있는 것**만 넓어지고 **할 수 있는 것**은 넓어지지 않는다.

5. **rule judge의 인과 탐지는 명시적 표지만 잡는다.** 한국어의 `-아서/-어서` 연결어미까지 잡으면
   "확인해서", "정리해서" 같은 평범한 순접까지 걸린다. 그래서 결정론적 judge는 "때문", "원인은",
   "탓", "로 인해"에서 멈추고 LLM judge가 넓은 그물이다. **알려진 한계로 기록**했고
   `evidenceJudge.test.ts`의 "KNOWN LIMIT" 테스트가 그 경계를 고정한다.

### 라이브 통합 증명 (2026-08-21) — 실제 데이터에서 찾은 5건

정본: `docs/operator_graph_v1_local_integration_proof.md`. 마켓 접속 없음, 자격증명 접근 없음, WRITE 없음.
실제 org 하나(고객 발화 7,136건)에서 전 체인을 돌렸고 **구조적 결함 5건**이 드러나 최소 수정 + 회귀로 닫았다.

| # | 결함 | 왜 실데이터에서만 보였나 | 패치 |
|---|---|---|---|
| B1 | customer memory index가 기존 셀러에게 영원히 비어 있음 | ingest는 멱등 → 재수집이 0행 삽입 → follow-up이 아무것도 안 함. 기존 데이터는 어떤 재수집으로도 채워지지 않는다 | `POST /api/customer-memory/backfill` — 이미 있던 backfill 2종의 빠진 셋째 |
| B2 | `기타` 1,777건이 최대 반복 문의로 보고됨 | 분류기의 "해당 없음" 판정을 패턴으로 인쇄. 합성 데이터에는 기타가 쌓이지 않는다 | FALLBACK 카테고리 제외 (null과 같은 이유) |
| B3 | 연결이 100% 완전한 org에서 "판단할 수 없습니다" | `unlinked=0`인데도 UNCERTAIN 반환. 모든 행이 연결된 실제 org가 있어야 보인다 | `unlinked == 0` ⇒ 측정된 0 ⇒ COVERED |
| B4 | planner/judge OFF인데 모델 예산 6 중 5 소진 | 실제 backend가 `available:false`를 응답해야 왕복이 발생한다 | capability off를 학습해 그 run 동안 재질의 중단 |
| B5 | LLM planner의 좁은 tool 목록이 specialist를 죽임 | 실제 모델이 계획해야만 나온다. 3개 중 2개가 findings 0으로 실패 | specialist의 tool은 specialist의 성질 — plan ∪ 필수 tool |

**②는 OFF와 ON에서 동일한 답을 냈다** — 같은 5개 finding, 같은 23건 근거. 모델은 무엇을 볼지 고르고,
무엇이 참인지는 Spring이 정한다는 성질이 실제로 성립한다.

### 검증 결과 (2026-08-21)

| 스택 | 결과 |
|---|---|
| backend | **2,521 통과** / 18 skipped / 0 실패 (신규 27) |
| frontend | **2,207 통과** / 0 실패 |
| agent-runtime | **186 통과** / 23 skipped / 0 실패 (신규 37) |
| collector | **9,150 통과** / 150 skipped / 0 실패 (무변경) |

라이브 증명 후 최종: backend **2,528** · frontend **2,207** · agent-runtime **191** · collector **9,150**, 실패 0.

교차 스택 검증은 `backend/.../ingest/OperatorCapabilityChainTest`가 담당한다 — 실제 DB 위에서
ingest → `IngestFollowUp` → Operator tool이 부르는 바로 그 read까지 한 번에 걷고, 데모 4문항 각각이
의존하는 불변식을 확인한다. 단위 테스트만으로는 감사 결함 B·C가 보이지 않았다는 사실이 이 테스트의
존재 이유다.

**`memoryScope.test.tsx`는 수정 없이 통과한다** — §12-7의 fence가 유지된다는 뜻이고, DoD 항목이다.

---

## 15. 이 문서가 바꾸지 않는 것

- `docs/multi-channel-connector-roadmap.md` §4.1의 어떤 칸도 옮기지 않는다. 운영 지원 수준은 그대로다.
- 셀러에게 보이는 채널 집합(NAVER / Coupang / Cafe24)과 A7 FE freeze.
- `docs/sellerops_live_approval_contract.md`의 승인 계약. Operator는 라이브 마켓 행동을 하지 않는다.
- `docs/coupang_review_policy_gate_v1.md` D1–D8.
- collector / Action Window / 자격증명 plane. **Agent tool로 노출되지 않는다.**
- backend가 유일한 LLM egress라는 성질.

---

## 16. 구현 전 product-owner 판단이 필요한 것

**blocker: 없다.** 아래 셋은 기본값을 정해 두었고, 그 기본값으로 진행 가능하다. 다르게 원하면 말해 달라.

1. **retrieval 방식** — v1 기본값은 **결정론적 lexical**(§10.1): 새 vendor egress 없음, pgvector 없음,
   재현 가능. 임베딩은 port 뒤에 남긴다. 임베딩을 v1에 원한다면 그것은 **고객 원문을 대량으로 vendor에
   보내는 새 노출**이므로 별도 결정이 필요하다.
2. **LLM 초안을 리뷰 축에도 붙일지** — v1 기본값은 **문의 축만**(감사 §2.5·단절 H 그대로). 리뷰 초안은
   계속 backend 규칙 제안이다. 리뷰까지 원하면 `sellerops.reply.review.provider` seam에 구현체가
   필요하고 노출 결정이 하나 더 붙는다.
3. **Cafe24 승격 리뷰의 상품 링크(감사 G)** — 매핑 정책이 없어 `productId=null`이다. v1은 **그대로 두고**
   ProductOps 응답에서 “이 채널 리뷰는 상품에 연결되지 않음”을 정직하게 말한다. 정책을 정하면 별건으로 닫는다.

**확인만 필요한 것(진행에 지장 없음)** — 감사 §4-4단계의 F(주문 30일 창)는 이 package 범위 밖으로 둔다.
