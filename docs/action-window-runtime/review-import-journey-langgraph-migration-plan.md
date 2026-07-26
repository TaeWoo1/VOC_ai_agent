# NAVER Initial Review Import — 상태·이벤트 모델 정본화 + LangGraph 이전 설계

> **모드:** 설계 문서만 산출. 구현·리팩터·커밋·push·PR 없음. #355 / Flyway 순서 / 라이브 주장 / 문서·테스트 불변.
> **결정 고정(operator):** ① LangGraph는 collector Node 프로세스 안의 **LangGraph.js**로 실행. ② backend가 plan/segment/ticket의 **단일 정본**, LangGraph checkpoint는 **한 seating 내 interrupt/resume 전용**(재시작 후 abandon — 오늘 동작 유지).

---

## Context — 왜 지금 이 설계가 필요한가

초기 리뷰 연동 여정은 라이브에서 **한 구간(Addendum 4, 2026-07-26)**까지만 검증됐고, 그 여정을 굴리는 런타임 상태가 **한 곳이 아니라 5개 어휘 + 여러 사본**으로 흩어져 있다. `ImportSegmentEngine.stage`(`collector/src/action-window/initial-import/import-engine.ts:121`)가 실질 정본이지만, 같은 값이 `RunStatus`/`StepStatus` 매핑(`import-stages.ts:176,218`), 세션 미러(`import-session.ts:511`), 디스크 사본(`import-run-store.ts:50`), 드라이버 재도출(`sigs`/`stepNumber`/`lastScopeVerdict`)로 번진다. **가장 위험한 것: scope evidence가 두 출처**로 존재하고 — engine(`import-engine.ts:131`)은 wire용, driver(`naver-live-import-driver.ts:121→545`)는 **실제 ingest 인가용**(`local-agent.ts:352`가 driver 쪽을 읽음) — 조용히 갈라질 수 있다.

목표: (a) 여정 전체를 **하나의 명시적 상태·이벤트 모델**로 정본화하고, (b) 상위 Journey만 안전하게 **LangGraph.js**로 옮기되 기존 deterministic Segment Engine은 subgraph로 보존하는, 게이트가 있는 단계적 이전 계획을 만든다. 라이브에서 확인된 결함·안전장치가 이전 중 회귀하지 않도록 acceptance scenario로 못 박는다.

**감사 기준선(추정 아님):**
- 현재 브랜치 `feat/naver-multi-segment-in-window` — **미커밋** multi-segment-in-window 런타임 작업(신규 `lazy-import-driver.ts`, `guidance-panel`/`bridge-server`/`agent-bridge` 변경, 신규 `V28__review_import_launch.sql`) 다수.
- PR #356(초기 연동)·#357(SmartStore 창) **merged**; **#355(review-issue memory) OPEN — 건드리지 않음**. V27·V28가 리뷰-임포트 마이그레이션, V28가 최신 → **Flyway 순서 불변**.
- 라이브 검증 상태: 1구간 CONFIRMED; **패널-이어가기 / 창 raise / 새 패널 하 SCOPE_MISMATCH / 한 seating 2구간은 designed-but-unproven-live**.
- 계약: `contracts/action-window/v2` README·transport는 v2를 서술하나 `contract-boundary.md`는 여전히 v1이며 `INITIAL_REVIEW_IMPORT_DISCOVERY` intent는 stale(run은 삭제, ticket-kind는 생존).

---

## 1. 현재 전체 사용자 여정 상태도

두 층으로 나뉜다. **상위 Journey**(연결/신원/계획/구간 오케스트레이션 — LangGraph 이전 대상)와 **Segment Execution**(기존 `ImportSegmentEngine` 순수 reducer — subgraph로 보존).

```mermaid
stateDiagram-v2
    [*] --> SELLEROPS_START

    state "상위 Journey (→ LangGraph.js)" as UJ {
      SELLEROPS_START --> AUTH_VERIFY: 디스포저블 backend + FE 기동
      AUTH_VERIFY --> AGENT_CONNECT: JWT org 존재 + NAVER account CONNECTED
      AUTH_VERIFY --> AUTH_FAIL: org 없음/JWT stale → 401
      AGENT_CONNECT --> SURFACE_READY: 도우미 연결하기 승인 + attach-before-mint
      AGENT_CONNECT --> PAIR_REFUSED: carrier-mismatch / unpaired (fail-closed)
      SURFACE_READY --> PLAN_RANGE: 운영자 NAVER 로그인(직접) + SmartStore 창 동일 프로필
      PLAN_RANGE --> PLAN_READY: range-preview → selected-range (plan DRAFT, OPERATOR_SELECTED)
      PLAN_READY --> SEGMENT_LAUNCH: 계속 가져오기 → next-segment ticket(최신월) 발급
      SEGMENT_LAUNCH --> SEG_EXEC: START_RUN(intent=INITIAL_REVIEW_IMPORT_SEGMENT, importRef)
      SEGMENT_LAUNCH --> LAUNCH_REFUSED: org/channel/kind mismatch → ticket EXPIRED 반환
      SEG_EXEC --> SEGMENT_DONE: 구간 COMPLETED+COVERED
      SEG_EXEC --> SEGMENT_FAILED: attempt FAILED (ticket 이미 CONSUMED)
      SEGMENT_DONE --> SEGMENT_LAUNCH: 남은 구간 있음 → 새 single-use ticket
      SEGMENT_DONE --> PLAN_COMPLETE: 남은 구간 없음
      SEGMENT_FAILED --> SEGMENT_LAUNCH: 재시도 = 새 ticket
    }

    state "Segment Execution (기존 ImportSegmentEngine — 유지)" as SEG_EXEC {
      [*] --> PREPARE_SESSION
      PREPARE_SESSION --> READ_FACTS: onSurfaceReady(ok)
      PREPARE_SESSION --> BLOCK_LOGIN: LOGIN_REQUIRED/SESSION_EXPIRED (recoverable)
      READ_FACTS --> LOCATE_START: onFactsRead → SHOW_REQUIRED_RANGE
      LOCATE_START --> HIGHLIGHT: onTargetLocated (dates: prefilled 먼저)
      HIGHLIGHT --> PREFILLED_SKIP: onTargetPrefilled(true) → STEP SKIPPED
      HIGHLIGHT --> WAIT_USER: onTargetHighlighted → HUMAN_ACTION_REQUIRED
      WAIT_USER --> READ_SCOPE: onTargetActionObserved (barrier-guarded)
      PREFILLED_SKIP --> READ_SCOPE
      READ_SCOPE --> SCOPE_BLOCKED: MISMATCH → CLEAR_HIGHLIGHT (fail-closed)
      READ_SCOPE --> WAIT_RANGE_CONFIRM: UNREADABLE → OPERATOR_CONFIRMED
      READ_SCOPE --> LOCATE_EXPORT: MATCH → MACHINE_MATCHED
      SCOPE_BLOCKED --> READ_SCOPE: REQUEST_STEP_RECHECK (재-read only)
      WAIT_RANGE_CONFIRM --> LOCATE_EXPORT
      LOCATE_EXPORT --> WAIT_EXPORT: 운영자 엑셀 다운로드
      WAIT_EXPORT --> DETECT_DOWNLOAD --> VALIDATE_ARTIFACT --> INGEST --> COMPLETED
      COMPLETED --> [*]
    }

    PLAN_COMPLETE --> [*]
```

**층 경계의 핵심:** 상위 Journey는 "어느 구간을, 어떤 신원으로, 어떤 ticket으로" — 오케스트레이션. Segment Execution은 "이 구간을 브라우저에서 어떻게 관찰·검증·적재" — 순수 reducer + DOM adapter. LangGraph는 **상위만** 노드로 갖고, `SEG_EXEC`는 **하나의 subgraph(또는 도구 노드)**로 감싼다. **현재의 복잡한 stage들을 LangGraph 노드로 1:1 번역하지 않는다.**

각 상위 단계의 라이브 근거/상태:
| 단계 | 근거 | 상태 |
|---|---|---|
| SELLEROPS_START / AUTH_VERIFY | runbook:24-31, JwtAuthFilter org-exists (`JwtAuthFilter.java:56-58`, `JwtAuthFilterOrgExistenceTest`) | CONFIRMED (org-match은 known trap) |
| AGENT_CONNECT (pairing, attach-before-mint) | proof-record:127-129; `--dev-insecure-auto-approve` 사용 | pairing UI CONFIRMED, **승인 컨트롤 UNPROVEN** |
| SURFACE_READY (창 raise/navigate-back) | proof-record:368-384 | **DESIGNED, UNPROVEN-LIVE** |
| PLAN_RANGE/PLAN_READY (selected-range) | runbook:63-68, proof-record:315 | CONFIRMED |
| SEGMENT_LAUNCH (최신월 ticket) | runbook:69-73 | CONFIRMED |
| SEG_EXEC 1구간 (gate MATCH → ingest 62 rows) | proof-record:320-324 | CONFIRMED (MISMATCH 경로는 새 패널 하 UNPROVEN) |
| SEGMENT_DONE 패널 이어가기 → 다음 구간 | proof-record:399-484 | **DESIGNED, offline만** |
| PLAN_COMPLETE (2구간/seating) | runbook:108-120 | **UNPROVEN-LIVE** |

---

## 2. 상태별 허용 이벤트 표

정본 소유자·side-effect 소유자·멱등성 키·retry/terminal 정책·기록 evidence/금지 데이터를 함께 명시. (상위 Journey는 목표 배치 기준 = LangGraph.js가 오케스트레이션하되 **정본은 backend**.)

| 현재 상태 | 이벤트 | 다음 상태 | 상태 정본 소유자 | side-effect 소유자 | 멱등성 키 | retry/timeout/terminal | evidence(허용) / 금지 |
|---|---|---|---|---|---|---|---|
| AUTH_VERIFY | 로그인/토큰 attach | AGENT_CONNECT | **backend** JWT(org from token) `JwtAuthFilter` | FE axios interceptor `apiClient.ts:101-119` | JWT(sub=user,org) | stale/missing org → 401 terminal, 재로그인; **no getMe mock fallback** `apiClient.ts:156-175` | 허용: user/org id enum·bool. 금지: 토큰 로그 |
| AGENT_CONNECT | 도우미 연결 승인 | SURFACE_READY | bridge `BridgeConnectionState` `bridge-server.ts:137` | Bridge(pairing HTTP/WS) | pairingId | carrier-mismatch/unpaired → fail-closed refuse `wsTransport.ts:225-251` | 허용: pairingId(opaque). 금지: 토큰/티켓 |
| AGENT_CONNECT | attach → mint 요청 | SEGMENT_LAUNCH 준비 | **backend** ticket `ReviewImportLaunchService` | FE(connect-before-mint `useGuidedImport.ts:6-10`) | `launch_ref`(16-hex, `uq_...launch_ref`) | START_RUN 거부 시 ticket EXPIRED 반환 `GuidedImportCard.tsx:214-217` | 허용: launch_ref. 금지: plan/org id on wire |
| PLAN_RANGE | selected-range 제출 | PLAN_READY(DRAFT) | **backend** `ReviewImportPlanService` | backend HTTP | plan.id; (org,account)당 non-terminal 1개(app-level) | 재제출 → 기존 open plan 거부 | 허용: `range_evidence=OPERATOR_SELECTED`. 금지: 날짜 값 wire noise |
| PLAN_READY / SEGMENT_DONE | next-segment mint | SEGMENT_LAUNCH | **backend** ticket | backend `mintNextSegment` | 세그먼트당 open ticket 1개 `uq_...open_segment` | idempotent mint(재클릭=동일 ticket); superseded/COVERED/ACTIVE 거부 | 허용: kind enum. 금지: ref 로그 |
| SEGMENT_LAUNCH | START_RUN | SEG_EXEC:PREPARE | **collector** `engine.stage`; wire=`RunStatus/StepStatus` | ImportSegmentSession(WS·driver) | runId(minted) + `importRef` | 재-START(동일 ref)=idempotent NONE `import-host.ts:176`; STALE_REVISION | 허용: 상태 enum·copyKey·requiredStart/End param. 금지: selector/page text/URL/count |
| SEG_EXEC:WAIT_USER | onTargetActionObserved | READ_SCOPE | `engine.stage` | driver(관찰) | barrier-guard `BARRIER_TARGET[stage]===target` `import-engine.ts:315` | 중복/지연 관찰 → NONE(스킵 불가); idle 15분 → SESSION_EXPIRED | 허용: USER_ACTION_OBSERVED enum. 금지: 입력 값 |
| SEG_EXEC:READ_SCOPE | onScopeRead=MISMATCH | SCOPE_BLOCKED | `engine.stage`; evidence `engine.scopeEvidence` | driver(`readSelectedScope`) + CLEAR_HIGHLIGHT | (runId,stage) | **fail-closed**: export 미탐색·미하이라이트; recheck=재-read only `import-engine.ts:193` | 허용: `{match,datesParsed,spanDiffers}`. 금지: 실제 날짜 값 |
| SEG_EXEC:READ_SCOPE | onScopeRead=MATCH | LOCATE_EXPORT | engine + **⚠ driver 2차 evidence** `scopeEvidence()` | driver | (runId,stage) | terminal 아님; MATCH만 export 도달 | 허용: MACHINE_MATCHED. 금지: 날짜 |
| SEG_EXEC:INGEST | onIngested | COMPLETED | **backend** segment exec/coverage `ReviewImportRunService.importSegment` | backend `FileUploadConnector.ingest` | attempt `(segment_id, attempt_no)` `uq_...attempt_no`; attempt별 자체 `sync_job_id` | 처리 오류 → attempt FAILED + segment FAILED(coverage untouched); **재시도=새 ticket**; ticket은 ingest 전 CONSUMED(실패해도) | 허용: `{result,rowsNewBucket,duplicate,failed}` 버킷. 금지: 실제 count on wire, 파일명/경로 |
| SEG_EXEC:COMPLETED | — | SEGMENT_DONE | backend: segment COMPLETED+COVERED, plan `recomputePlanStatus` | backend | segment.id | terminal(성공); markMissing = coverage MISSING+exec COMPLETED(운영자 결론) | 허용: covered_rows(저장), coverage enum. 금지: — |
| SEGMENT_DONE | 남은 구간 없음 | PLAN_COMPLETE | backend `ReviewImportPlanStatus=COMPLETED`(파생) | backend | plan.id | terminal; `rowsReconciled` 항상 false → **"100%" 금지** | 허용: coverage roll-up 범위. 금지: "모든 리뷰" 주장 |

**정본 원칙(표에서 도출):** 지속 상태 = **backend**(plan/segment/attempt/ticket). 일시 run 상태 = **collector `engine.stage`**(wire는 v2 `RunStatus/StepStatus` 투영, FE는 read-only 미러). 신원 = JWT(org from token) + 별도 bridge pairing token. **evidence enum은 backend-set·fail-closed 파싱**(`ReviewImportPlanController.java:193-199`).

---

## 3. 기존 클래스 책임 지도 (현재 중복 소유 → 재배치)

| 컴포넌트 | 현재 소유(중복) | 재배치 목표 |
|---|---|---|
| **Backend** `ReviewImportRunService` / `PlanService` / `LaunchService` | segment exec·coverage / plan status(파생) / ticket 생명주기 — **깔끔한 단일 정본** | **그대로 = Backend authority.** LangGraph는 이 HTTP를 호출만, 상태를 재소유하지 않음 |
| **Backend** enums + evidence | `Segment*State`, `*LaunchStatus/Kind`, `RangeDiscoveryEvidence`, `ScopeEvidence`(+ legacy `scopeConfirmed` 병존 `ReviewImportSegmentAttempt.java:39-49`) | 유지. legacy `scopeConfirmed` vs `scopeEvidence` 이중은 **OPEN Q(Q4)** |
| **collector** `ImportSegmentEngine`(순수 reducer, side-effect 없음 `import-engine.ts:23`) | `stage` = 실질 정본 run state machine | **Segment subgraph의 핵심 = 유지.** LangGraph가 이 reducer를 감싸는 subgraph로 호출(재구현 금지) |
| **collector** `import-stages.ts` | `ImportStage` union + `RunStatus`/`StepStatus` 두 매핑 + `importAllowedCommands` | 유지(투영 계층). **allowedCommands 정의를 단일화** — 패널 사본 제거 대상 |
| **collector** `ImportSegmentSession` | drive-loop + **`BARRIER_STAGE_FOR` 미러**(`:511`) + **`started` 사본**(`:90`) + 패널 소유 | drive-loop = Browser Adapter 오케스트레이션. **barrier-미러 제거**: engine이 "barrier X 열림?" 질의 노출. `started`는 engine 단일 |
| **collector** `ImportSegmentHost` | per-segment 조립 + **`hostedRef`(4번째 runId 사본)** + scope/channel/kind fail-closed(`:186-226`) | Journey Kernel의 "segment 진입 게이트" 노드로. fail-closed 검증 로직 = Kernel의 순수 guard |
| **collector** `InitialImportEndpoint` | carrier 상태 `announcing`(`:60`) + runId/channelCode 사본 | Browser Adapter/Bridge 경계. 신원 사본은 Kernel에서 주입 |
| **collector** `BridgeServer`/`agent-bridge` | 연결/pairing 상태(별도 축) + `onSellerOpsConnected` 훅 | **그대로 = Bridge 계층**(Journey와 독립 축). LangGraph는 pairing 상태를 소유하지 않음 |
| **collector** Live/Lazy/Fixture driver | `sigs`(engine.targetSig 사본 `:115`), `stepNumber`(`:118`), **`lastScopeVerdict`→`scopeEvidence()` 2차 evidence(`:121`, ingest가 읽음)** | **Browser Adapter.** DOM 재도출 사본을 engine 값 대비 **조정(reconcile)**; ingest evidence를 engine 단일 출처로 통일(⚠ 최우선) |
| **collector** `guidance-panel`/`guidance-copy` | run 상태 미소유(투영) + **`TERMINAL` 사본(`guidance-copy.ts:41`)** + `PANEL_COMMANDS/INTENTS` 사본 | FE projection 계층. terminal/allowed 정의 단일 소스에서 파생 |
| **collector** `import-run-store` | **`stage` 디스크 사본(`:50`)**, abandon-only, ref 미저장 | LangGraph checkpoint로 대체(seating 내). ref 미저장·abandon-only 불변 |
| **FE** `importRuntime`/`useGuidedImport`/`wsTransport` | run 상태 read-only 미러; `AwConnectionStatus` FE-owned | FE projection. **`nextRemainingSegment` 재도출(`reviewImport.ts:190-200`)이 backend ordering과 shadow 중복** → backend가 반환하는 값 소비로 축소 |
| **FE** `reviewImport.ts` | `segmentUiState`(exec×coverage 5-state 재인코딩 `:40-55`), `importProgress`, kind→intent 매핑 | FE projection 유지하되 **규칙 재인코딩 최소화**(backend view 소비) |

**중복 정리 우선순위:** (1) ingest scope-evidence를 engine 단일 출처로(가장 조용히 갈라짐). (2) `nextRemainingSegment` newest-first ordering을 backend 단일 정본으로(카드가 ticket과 다른 월을 부를 위험 `reviewImport.ts:186-189`). (3) barrier-미러·`started`·`hostedRef` 사본 제거. (4) terminal/allowedCommands 단일 소스.

---

## 4. 목표 구조 (경계 제안)

> **LangChain LLM Agent는 이번 범위에 넣지 않는다.** LangGraph는 결정론적 오케스트레이션(interrupt/resume/checkpoint)으로만 사용.

```
┌───────────────────────────────────────────────────────────────────┐
│ Backend authority (Spring, 불변)                                    │
│  ReviewImportPlan/Run/Launch Service · DB · 단일 정본                 │
│  plan/segment/attempt/ticket · evidence enum(fail-closed 파싱)       │
└──────────────▲───────────────────────────────────────▲─────────────┘
               │ HTTP(JWT)                              │ HTTP(JWT)
┌──────────────┴───────────────────────────────────────┴─────────────┐
│ collector (Node/TS 단일 프로세스)                                     │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────┐     │
│  │ LangGraph.js Journey Orchestration (상위 Journey만)          │     │
│  │  노드: authVerify · agentConnect · planRange · segmentLaunch │     │
│  │        · runSegment(subgraph) · segmentDone · planComplete   │     │
│  │  checkpoint: seating 내 interrupt/resume 전용(디스크, 비영속)  │     │
│  └───────────────┬──────────────────────────────▲──────────────┘     │
│                  │ 호출(순수)                     │ 결과/effect          │
│  ┌───────────────▼──────────────┐  ┌─────────────┴──────────────┐    │
│  │ 순수 TS Journey Kernel         │  │ Segment Engine (기존 유지)   │    │
│  │  guard/전이 함수(부작용 없음)    │  │  ImportSegmentEngine reducer │    │
│  │  scope/channel/kind fail-closed│  │  = subgraph(재구현 금지)      │    │
│  └───────────────────────────────┘  └─────────────┬──────────────┘    │
│                                                    │ effect              │
│  ┌─────────────────────────────────────────────────▼──────────────┐   │
│  │ Browser Adapter (naver-live driver · surface · overlay/panel)   │   │
│  │  DOM 관찰·하이라이트·다운로드 탐지 — 운영자 클릭만                  │   │
│  └──────────────────────────────┬──────────────────────────────────┘   │
│  ┌──────────────────────────────▼──────────────────────────────────┐   │
│  │ Bridge (BridgeServer/agent-bridge — 연결·pairing, 독립 축)         │   │
│  └──────────────────────────────┬──────────────────────────────────┘   │
└─────────────────────────────────┼──────────────────────────────────────┘
                                  │ WS(v2 transport, opaque in Bridge v1)
┌─────────────────────────────────▼──────────────────────────────────────┐
│ FE projection (React — read-only 미러, 카피 소유, 상태 미소유)             │
└─────────────────────────────────────────────────────────────────────────┘
```

**경계 규칙:**
- **Backend authority** = 지속 상태의 유일 정본. LangGraph는 호출만.
- **Journey Kernel(순수 TS)** = 부작용 없는 전이·guard 함수. 테스트 가능·재실행 안전. LangGraph 노드는 이 Kernel을 호출하는 얇은 래퍼.
- **Segment Engine(기존)** = `ImportSegmentEngine` 그대로 subgraph로. 라이브 검증된 결정론 보존.
- **Browser Adapter** = 유일한 부작용 지점(DOM/창/다운로드). evidence 단일화 후 engine 값 대비 reconcile.
- **FE projection** = read-only 미러 + 카피. 상태·정본 미소유(`importRuntime.ts:7-18` 규칙 보존).
- **LangGraph orchestration** = interrupt(운영자 배리어)/resume/checkpoint(seating 내)만. 신원·티켓·지속상태 미소유.

---

## 5. 단계적 migration 계획 (완료 조건·테스트·rollback)

각 단계는 **독립 mergeable**하며 이전 단계 라이브 주장을 승격하지 않는다. #355·Flyway 순서 불변.

**단계 0 — 현재 기준선 동결**
- 내용: 현 `feat/naver-multi-segment-in-window` 미커밋 작업을 정리해 커밋(설계 전 baseline). 상태 어휘·중복 ledger를 코드 주석/문서로 고정. **동작 변경 0.**
- 완료조건: 전 스택 테스트 green, 여정 상태도가 코드와 일치. 라이브 주장 불변.
- 테스트: 기존 collector/backend/FE 스위트 그대로.
- rollback: 커밋 revert(동작 변경 없어 안전).

**단계 1 — 순수 Journey Kernel 추출(부작용 없음)**
- 내용: 상위 Journey 전이·guard를 순수 TS 모듈로 추출 — `import-host.ts:186-226`의 scope/channel/kind fail-closed, next-segment 진입 조건, terminal 판정. **기존 클래스는 이 Kernel을 호출하도록만 위임**(행위 동일). Segment Engine·driver·Bridge 불변.
- 완료조건: Kernel 100% 단위테스트, 기존 cross-stack 스위트 green, wire/DB 무변화.
- 테스트: Kernel 단위테스트(전이 표 그대로) + 기존 `fe-import-runtime-real-bridge.test.ts` 통과.
- rollback: 위임 제거(Kernel은 새 파일이라 삭제만).

**단계 2 — 기존 이벤트를 LangGraph shadow mode에 투영**
- 내용: LangGraph.js 그래프를 **관찰 전용**으로 병렬 기동 — 실제 런타임 이벤트를 그래프에 먹여 phase를 계산하되 **아무 부작용도 내보내지 않음**. 실제 여정은 여전히 기존 경로가 구동. shadow phase vs 실제 `engine.stage`/backend 상태 **불일치 탐지 로거**(sanitized: enum/bool/count만).
- 완료조건: 1구간 재현(디스포저블)에서 shadow phase가 실제와 **0 divergence**. 라이브 없이 offline 소켓 재현으로 검증.
- 테스트: shadow-vs-real divergence 테스트(합성). sanitized tracing 필드 화이트리스트 테스트.
- rollback: shadow 그래프 비활성 플래그(부작용 없어 안전).

**단계 3 — 상위 Journey만 LangGraph로 cutover**
- 내용: 상위 Journey 오케스트레이션(연결→계획→구간런치→다음구간)을 LangGraph.js가 **구동**. `runSegment`는 기존 Segment Engine을 **subgraph로 호출**. interrupt=운영자 배리어, resume=관찰 후. checkpoint=seating 내 디스크(기존 `import-run-store` 대체, ref 미저장·abandon-only 불변). **Segment Engine 내부 미변경.**
- 완료조건: 디스포저블에서 1구간 + (offline) 2구간 이어가기가 기존과 동일 결과. **새 라이브 주장 없음** — 라이브 재검증은 별도 승인 게이트(G3/G6)로만.
- 테스트: cross-stack 스위트 + 새 LangGraph 오케스트레이션 통합테스트. shadow divergence 계속 0.
- rollback: 기존 경로로 플래그 스위치(단계 2까지 병존 유지).

**단계 4 — Segment Engine 유지 vs 후속 이전 판단(게이트)**
- 내용: cutover 안정 후 판단. **기본 = 유지**(라이브 검증된 결정론·barrier-guard·fail-closed를 재작성하는 리스크가 이득보다 큼). 이전한다면 별도 패키지·별도 라이브 게이트.
- 완료조건: 판단 문서화 + (유지 시) Segment Engine을 안정 subgraph 계약으로 동결.
- rollback: 해당 없음(판단 게이트).

**단계 5 — 기존 경로 폐기**
- 내용: 단계 3이 라이브 포함 충분히 안정된 뒤에만 레거시 오케스트레이션 경로·shadow 제거. **문서/테스트 삭제 아님** — dead code 제거만, 이력·proof-record 보존.
- 완료조건: 레거시 경로 무참조 확인, 전 스위트 green, proof-record/runbook 불변.
- rollback: 폐기 커밋 revert(단계 3 경로가 유일 경로가 되기 전까지 미실행).

---

## 6. 기존 동작 보존 계획 (acceptance scenarios)

라이브에서 확인된 결함/안전장치가 이전 중 회귀하지 않도록, 각 단계 게이트에서 **반드시 통과해야 하는 시나리오**. (근거: proof-record / runbook / 각 소스.)

1. **stale JWT / missing org** — org 없는 검증-토큰은 **401**(200 []가 아님). `JwtAuthFilterOrgExistenceTest`(존재→200, 없음→401, null→401)가 실 `SecurityConfig`로 통과.
2. **FE identity mock fallback 금지** — `getMe`는 조용한 mock fallback 없음(`apiClient.ts:156-175`); 토큰 거부 시 throw→로그인. 리뷰-임포트 변이 메서드는 순수 `http`(mock 없음).
3. **FE↔Agent org 불일치** — 서로 다른 org면 host가 **fail-closed 404**(spent/nonexistent와 동일 응답, proof-record:350-354). runbook trap 6 pre-check(org_id 일치) 시나리오화.
4. **NAVER/Coupang channel mismatch** — 드라이버가 non-NAVER ticket 거부(`import-host.ts:213`); carrier 불일치/부재는 fail-closed(`wsTransport.ts:225-251`). *(주: 라이브 Coupang 결함 사례는 없음 — carrier/§4.1 fail-closed로만 커버, OPEN으로 명시.)*
5. **동일 Chrome profile: SellerOps → 연결 → SmartStore 순서** — attach-before-mint(`GuidedImportCard.tsx:195-217`), 프로필 지속(`collector/.profile/naver`). 재시작이 재로그인을 부르지 않음.
6. **OS 창 포커스 vs 탭 포커스** — 다른 창에서만 바뀌는 배리어는 안 보임(finding 12, proof-record:209-215). 창 raise/navigate-back 시나리오. *(라이브 UNPROVEN — 게이트에서 라이브 승인 시에만 검증, 그 전엔 offline.)*
7. **로그인 navigation 후 guidance panel remount** — pack이 매 `START_RUN` 후 재전송(host가 세그먼트마다 새 세션 `proof-record:274-275`); off-origin(로그인/2FA) 페이지에선 navigate away 안 함(`proof-record:376-380`).
8. **prefilled date SKIPPED** — `{prefilled}` 프로브가 locate 후·annotation 전 실행, gate 자신의 read로 응답 → skip과 검증이 불일치 불가(finding 13, proof-record:254,319,333).
9. **SCOPE_MISMATCH fail-closed + recheck** — MISMATCH면 export **미탐색·미하이라이트·미무장**; `REQUEST_STEP_RECHECK`는 재-read/재-arm만, 누구의 말로도 step 완료 없음(proof-record:291). *(새 패널 하 렌더는 offline-proven only — 게이트에서 명시.)*
10. **구간마다 새 single-use ticket** — 세그먼트당 open ticket 1개(`uq_...open_segment`), idempotent mint, `ingestForLaunch`가 ingest 전 CONSUMED(실패해도) → 재시도=새 ticket. 두 구간=두 CONSUMED ticket, 한 ticket 두 번 사용 없음.
11. **민감정보 비로그·비영속** — launch ref/날짜/파일명/경로/URL이 로그·wire·디스크에 없음; count는 버킷만; guidance pack은 count로만 로그; `findProhibitedFields` 디스크 게이트. `readExportScope` 원값은 operator-local stderr만.
12. **모든 NAVER 클릭 = 운영자 수행** — 런타임은 locate/highlight/observe/detect만, 클릭·입력·export·consent 안 함(proof-record:18-20); 패널 버튼은 `preventDefault`+`stopPropagation`으로 이벤트를 패널에서 멈춤.

**추가 보존(중복 정리로 깨지기 쉬운 것):**
13. **단일 scope-evidence** — ingest 인가가 읽는 evidence와 wire가 싣는 evidence가 **동일 출처**임을 시나리오로 고정(현재 engine vs driver 2출처 `local-agent.ts:352`).
14. **next-segment ordering 일치** — 카드가 부르는 월 == ticket이 인가한 월(backend newest-first 단일 정본, `reviewImport.ts:186-189`).
15. **"100%" 금지** — `rowsReconciled` 항상 false인 한 "모든 리뷰 100%" 문구 미노출; valid-empty = COMPLETED+COVERED 0행.

---

## 7. LangGraph 도입 검증 (구체화)

- **checkpoint / thread 식별자:** thread_id = **runId(collector-minted)**; seating 내에서만 유효. checkpoint 네임스페이스에 **launch_ref·org·plan id·날짜 미포함**(오늘 run-store가 ref 미저장인 것과 동일 규율). 저장 위치 = operator 디스크(`import-run-store` 대체), `0o600`, `findProhibitedFields` 게이트 재사용. **cross-sitting 재개 없음** — 재시작 시 non-terminal → abandon(오늘 동작 유지).
- **interrupt / resume 위치:** interrupt = 운영자 배리어(각 `WAIT_*` — 날짜 입력, 엑셀 다운로드, NAVER 확인, SCOPE_BLOCKED 복구, 패널 이어가기). resume = 런타임 **자체 관찰** 이후에만(누구의 말로도 아님 — `CONFIRM_STEP_COMPLETED` 없음 규칙 보존). LangGraph interrupt는 barrier-guard(`BARRIER_TARGET[stage]===target`)를 대체하지 말고 **감쌀 것**.
- **node 재실행 side-effect 멱등성:** 모든 노드는 순수 Kernel 호출 + adapter effect로 분리. 재실행 안전 키 — START_RUN 재실행=idempotent NONE(`import-host.ts:176`), ticket mint=idempotent(동일 open ticket), ingest=attempt `(segment_id,attempt_no)` unique + ticket **consume-before-ingest**(재실행이 두 번 적재 못 함). checkpoint 재개가 **이미 CONSUMED ticket을 재사용하지 않음**을 테스트.
- **subgraph 경계:** `runSegment`가 유일 subgraph = 기존 `ImportSegmentEngine`. 입력=required range+importRef, 출력=결과 enum+evidence. **엔진 내부 stage를 상위 그래프 노드로 승격 금지**(사용자 지시: 복잡 구조 1:1 번역 금지).
- **sanitized tracing / monitoring:** LangGraph trace 필드 = enum/bool/opaque 16-hex/dotted copyKey/count-bucket만. **selector·page text·URL·경로·날짜·토큰·ref 금지**(§6 privacy boundary 화이트리스트 재사용, `v2-README:117-128`). trace exporter에 `findProhibitedFields` 동일 게이트.
- **기존 runtime vs shadow graph phase 불일치 탐지:** 단계 2의 divergence 로거 — 매 published state에서 `shadowPhase`(그래프) vs `engine.stage`(실제) vs backend segment state를 비교, 불일치는 sanitized 카운터로 기록. **divergence>0이면 cutover(단계 3) 게이트 차단.**

---

## OPEN QUESTIONS (저장소 근거 포함 — 해소 전 가정 금지)

- **Q1. 계약 v1/v2 표기 불일치.** `contracts/action-window/v2/README.md`는 "v2"이나 본문·transport.ts는 여전히 v1 경로/헤더; `contract-boundary.md`는 전부 v1(`ACTION_WINDOW_PROTOCOL_VERSION=1`). LangGraph 계약을 어느 것에 고정할지 = product-owner/유지보수 결정. **정본은 `index.ts`(README 자체 명시).**
- **Q2. `INITIAL_REVIEW_IMPORT_DISCOVERY` intent stale.** 계약 enum엔 살아있으나 run은 삭제(proof-record:257), ticket-kind만 생존(review-ops:673), roadmap "폐기"(roadmap:223-228). LangGraph 노드 집합에서 DISCOVERY **run** 노드는 제외, DISCOVERY **ticket**(plan 1회 생성 HTTP)만 유지 — 확인 필요.
- **Q3. 패널-이어가기 / 창 raise / 새 패널 하 SCOPE_MISMATCH / 2구간-seating = 라이브 미검증.** 이전 게이트가 이들을 승격하지 않음. 라이브 재검증은 별도 G3/G6 승인. (repository-verifiable = 코드 존재; 라이브 = 미증명.)
- **Q4. attempt `scopeConfirmed`(legacy bool) vs `scopeEvidence`(enum) 병존**(`ReviewImportSegmentAttempt.java:39-49`). 단일화 여부·방향 = 결정 필요(DB 마이그레이션 영향 → Flyway 순서 주의).
- **Q5. ingest scope-evidence 2출처**(engine vs driver, `local-agent.ts:352`가 driver를 읽음). 어느 쪽을 단일 정본으로 — repository-verifiable, 이전 전 반드시 해소.
- **Q6. pairing 승인 컨트롤 라이브 미검증**(`--dev-insecure-auto-approve` 2회). LangGraph interrupt가 pairing을 감싸기 전 실 승인 경로 확인 필요.

---

## 최종 보고

**1. 현재 구조의 핵심 문제**
run phase가 단일 정본(`engine.stage`)에서 5개 어휘 + 디스크/미러/DOM 사본으로 번져, 특히 **ingest 인가 evidence가 engine·driver 2출처**로 조용히 갈라질 수 있다. next-segment ordering이 backend·FE 이중 도출이라 카드가 ticket과 다른 월을 부를 커플링이 있다. 계약 문서가 v1/v2 혼재이고 DISCOVERY intent가 stale이다. 라이브는 1구간만 검증 — 이어가기/2구간/새-패널 MISMATCH는 미증명.

**2. 목표 상태도와 이벤트 모델**
상위 Journey(연결→신원→계획→구간런치→다음구간→완료)와 Segment Execution(기존 결정론 엔진)의 2층. 상위만 LangGraph.js 노드, Segment Engine은 subgraph. 상태별 허용-이벤트 표로 정본 소유자(backend=지속, collector=일시, JWT=신원)·멱등성 키·fail-closed·evidence/금지-데이터를 고정(§2).

**3. 책임 재배치안**
Backend authority 불변. `engine.stage`=Segment subgraph 핵심(유지). 순수 Journey Kernel로 guard/전이 추출. Browser Adapter가 유일 부작용 + evidence 단일화. FE=read-only projection. barrier-미러/`started`/`hostedRef`/terminal/allowedCommands 사본 제거(§3).

**4. 단계별 migration plan과 gate**
0 기준선 동결 → 1 순수 Kernel 추출 → 2 LangGraph shadow(관찰·부작용0, divergence=0 게이트) → 3 상위 Journey cutover(Segment=subgraph) → 4 Segment Engine 유지/이전 판단 게이트 → 5 레거시 폐기. 각 단계 완료조건·테스트·플래그 rollback 명시(§5).

**5. 리스크·rollback**
최대 리스크 = evidence/ordering 사본이 이전 중 갈라짐 → §6의 acceptance 13·14로 게이트. LangGraph 재실행 이중-적재 → consume-before-ingest + attempt-unique로 차단, checkpoint 재개 테스트. 각 단계는 병존-플래그로 즉시 rollback, 폐기(단계 5)는 라이브 안정 후에만. 라이브 미검증 항목 승격 금지.

**6. 다음 첫 구현 슬라이스의 정확한 범위**
= **단계 0 + 단계 1의 최소 컷.** (a) 현 미커밋 baseline을 동작 변경 0으로 커밋(#355·Flyway 불변). (b) 상위 Journey guard/전이를 **순수 TS Journey Kernel 모듈**로 추출 — 우선 `import-host.ts:186-226`의 scope/channel/kind fail-closed와 next-segment 진입 조건만; 기존 클래스는 위임만(행위 동일). (c) Kernel 100% 단위테스트 + 기존 cross-stack green. **범위 밖:** LangGraph 코드, Segment Engine 변경, evidence 단일화(= 별도 슬라이스, Q5 해소 후), 라이브 실행, 계약 v2 확정(Q1). shadow 그래프(단계 2)는 그 다음 슬라이스.

---

## Verification (이 계획을 실행할 때의 검증 방법)

- **단계 0:** `cd collector && npm test`, `cd backend && ./gradlew test`, `cd frontend && npm test` 전부 green; `git diff`가 동작 변경 0(포맷/주석/커밋 정리만) 확인.
- **단계 1:** 새 Journey Kernel 단위테스트가 §2 전이 표를 그대로 재현; `collector/test/crossstack/fe-import-runtime-real-bridge.test.ts` 통과; wire 프레임·DB 스키마 diff 없음.
- **단계 2:** 합성 1구간 재현에서 shadow phase vs `engine.stage` divergence=0 리포트; trace 필드 화이트리스트 테스트로 금지 데이터 부재 증명.
- **단계 3:** 디스포저블 backend(name-guarded `sellerops_riv_*`)에서 1구간 + offline 2구간 이어가기가 기존과 동일 결과; §6 acceptance 1–15 통과. **라이브 재검증은 별도 fresh G3/G6 승인 + "seated and ready" 전까지 금지.**
- 전 단계: proof-record/runbook/#355/Flyway 순서 불변을 `git diff`로 확인.

---

## 부록 A — 고정 결정 (2026-07-26 dispatch, 단계 0+1 착수)

> 이 부록은 위 계획을 저장소 정본으로 승격하며 operator가 단계 0+1 착수 시 **고정한 결정**을 기록한다. 위 본문은 손실 없이 그대로 옮겨온 것이고, 아래는 그에 대한 구속력 있는 보강이다.

### A.1 계약(Contract) 결정 — 고정

- 현재 Action Window wire와 **`ACTION_WINDOW_TRANSPORT_VERSION = 1`을 그대로 유지한다.** 이번 이전 작업(단계 0~1)에서 프레임·헤더·메시지 계약을 변경하지 않는다.
- 새 **내부 상태 계약**은 **`review-import-journey/v1`** 네임스페이스로 두며, **Action Window 버전과 분리**한다(`contracts/review-import-journey/v1/`). 이는 wire 계약이 아니라 collector 내부의 순수 상태/이벤트/effect 계약이다 — LangGraph.js(단계 2~3)가 소비할 Journey Kernel의 계약면이다.
- `contract-boundary.md`의 v1/v2 표기 불일치(OPEN Q1)는 **이번 슬라이스에서 건드리지 않고 별도 후속 슬라이스로 남긴다.**

### A.2 Scope evidence 결정 — 방향 고정, 구현은 후속

- **최종 방향(고정):** scope evidence의 단일 정본은 **`ImportSegmentEngine`** 이다. Driver는 **sanitized scope facts/verdict만** 반환하고, ingest 인가는 **Engine evidence만** 사용해야 한다. 현재의 engine·driver 2출처(`local-agent.ts` ingest capability가 driver의 `scopeEvidence()`를 읽음)는 제거 대상이다.
- **이번 단계(0+1)에서는 구현하지 않는다.** 아래를 **acceptance requirement로 못 박아** 후속 슬라이스(Q5)로 넘긴다:
  - **AR-EV1.** ingest가 읽는 scope evidence와 wire가 싣는 scope evidence는 **동일한 단일 출처(Engine)**에서 나와야 한다.
  - **AR-EV2.** Driver는 scope에 대해 **enum/bool/count 버킷 등 sanitized facts/verdict만** 노출하고, ingest 인가를 스스로 판단하지 않는다.
  - **AR-EV3.** 회귀 방지: driver evidence와 engine evidence가 갈라지면 실패하는 테스트가 존재해야 한다(단일화 완료 후).
  - 이 항목들은 §6 acceptance 13(단일 scope-evidence)의 상세화이며, 단일화 슬라이스의 완료 게이트다.

### A.3 단계 1 범위 — 이번 슬라이스에서 실제로 한 것

- `contracts/review-import-journey/v1/`에 순수 TS **state/event/effect 타입 + reducer/guard**를 추가한다.
- **우선 추출 대상:** `ImportSegmentHost`의 **segment 진입 판단만** — (a) 동일 ref 재전송 idempotency, (b) 동시 시작 busy 판정, (c) scope kind(SEGMENT 여부 + declared-vs-server 불일치), (d) required range 존재, (e) channel 일치. I/O(`resolveScope`)·`building` 동시성 플래그·mint/arm/assemble/replay·**모든 로그 호출**은 Host에 남는다(Kernel은 부작용·로그·네트워크·브라우저 import 없음).
- Host는 Kernel의 결정에 위임하되 **기존 실행 결과·로그 의미·wire를 그대로 유지**한다. 허용되지 않은 입력은 모두 fail-closed.
- **범위 밖(이번 슬라이스에서 하지 않음):** LangGraph 설치/shadow graph, Scope evidence 코드 변경(A.2), `ImportSegmentEngine` 내부 수정, Action Window wire 변경, DB migration 추가·수정·번호 변경, #355, 라이브 실행, proof record 라이브 주장 승격, 레거시 삭제.
