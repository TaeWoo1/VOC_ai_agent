# Responsibility Runtime v1

**날짜:** 2026-09-15 · **상태:** `DESIGN — CANONICAL MILESTONE DEFINITION · 구현 0`
**Baseline:** `feat/review-decision-workspace-v1` @ `c43e3f4d` (clean — main `2491f1ab`, `de1838f6`,
`experiment/aside-executor`, `feat/aside-integration-v1`를 전부 포함하는 유일한 clean checkpoint)
**이 문서가 한 일:** 목표 · 경계 · 불변식 · 재사용 계획 · 3-package 계획 · product-owner 결정 목록.
**이 문서가 하지 않은 일:** 코드 0 · 마이그레이션 0 · 스키마 생성 0 · 마켓플레이스 호출 0 · 모델 호출 0.
§12의 스키마는 **제안**이고 PD(§15)가 닫히기 전에는 migration 번호도 받지 않는다.

---

## 0. 한 문장

> **Seller가 고객 운영이라는 직무를 Reviewnary에게 맡기고, 평소에는 직접 보지 않아도 되며,
> Reviewnary가 끝내지 못한 예외와 업무 장애만 확인한다.**

지금까지의 제품은 **판매자가 열어서 일을 찾는 화면**(Operations Home · 결정 워크스페이스 · 대화)이었고,
Proactive Operations Agent v1이 「먼저 준비해 둔다」를 더했다. 그러나 어느 것도 **직무를 맡는** 주체가
아니었다: 언제 확인했는지, 무엇을 확인하지 못했는지, 어디까지 스스로 처리해도 되는지를 **하나의 기록이
책임지고 말하는 곳이 없다.** 이 milestone은 그 기록을 만든다.

### 0-1. 감사가 먼저 확인한 것 — 「없는 것」은 셋뿐이다

| 질문 | 저장소에 이미 있는 것 | 없는 것 |
|---|---|---|
| 정기적으로 도는가 | `SyncScheduler`→`SyncScheduleClaimer`(`FOR UPDATE SKIP LOCKED`)→`SyncScheduleRunner`, `SelfPilotReconciler`, `ProactiveScheduler` | **직무 단위**의 실행 기록 — 지금은 (계정×데이터타입) 수집 row와 org별 proactive tick이 따로 돈다 |
| 한 번에 하나만 도는가 | `SyncRunGate` single-flight + orphan 회수(60분) | **논리 창(window)** 개념 — 같은 시간대를 두 번 처리하지 않는다는 보장이 없다 |
| 확인하지 못한 것을 아는가 | `sync_jobs.status`(RUNNING/SUCCESS/PARTIAL/FAILED) · `ChannelDataState`(`ZERO`만 「없다」) · `SessionReadinessState` · Aside `AUTH_REQUIRED`/`STORE_UNRESOLVED` | 소스들을 **한 run의 완결성**으로 모으는 곳 |
| 일을 사건으로 드는가 | `proactive_case`(왜 지금·무엇을 조사·무엇이 준비됐나, status는 파생) | **관측 장애**를 사건으로 드는 것 · run과의 연결 · 권한(AUTO/HUMAN) |
| 사람이 결정하는가 | 문의 `InquiryApproval`→`InquiryExecution`→`InquiryVerification`, 리뷰 `review_reply_approval`, `TriageDisposition`, `review_triage_correction`, `improvement_opportunity_event` | 결정을 **다음 조사의 맥락**으로 되돌리는 읽기 |
| 조사하는가 | `ProactiveInquiryInvestigator`/`ProactiveReviewInvestigator`(production draft path), agent-runtime `OperatorToolRegistry`(READ 31종) | strict output schema + provenance를 가진 **조사 계약** |

그래서 새 core object는 **`Responsibility` · `ResponsibilityRun` · `OperationsCase` 셋**이고, 나머지는
전부 KEEP/WRAP/EXTEND다(§15). 새 generic 추상화(workflow engine · job platform · event bus · policy
language · agent framework)는 **0**이다.

---

## 1. Product goal

- **평상시:** 판매자는 앱을 열지 않는다. Reviewnary가 정해진 주기로 채널을 확인하고, 자동으로 처리해도
  되는 일(분류 · 참고 · 관찰 · 맥락 수집 · 초안 준비)을 끝내 둔다.
- **예외:** 판매자의 권한이 필요한 일(고객에게 쓰기 · 환불 · 보상 · 취소 · 돈)은 결정 요청으로 올라온다.
- **장애:** 확인하지 못한 곳은 **「0건」이 아니라 「확인하지 못함」**으로 올라온다.
- 판매자가 여는 화면은 셋만 답한다 — ① 내 결정 필요 · ② Reviewnary가 정리/준비한 일 · ③ Reviewnary가
  제대로 확인하지 못한 곳 (§10).

**성공의 정의는 「많이 처리했다」가 아니다.** 판매자가 열지 않은 동안 참이었던 것만 말하고, 참인지 모르는
것은 모른다고 말하는 것이다. strong success는 `Pilot Usage Loop v1`의 규칙 그대로 **검증된 외부 결과
(`VERIFIED`)**만 센다.

---

## 2. Ownership

| 주체 | 소유 | 소유하지 않음 |
|---|---|---|
| **Reviewnary** (backend) | **Responsibility · Schedule · State · Policy · Case · Decision · History · Authority** — 무엇을 맡았나, 언제 도나, 무엇이 참인가, 무엇을 해도 되나, 무엇이 사건인가, 누가 무엇을 결정했나, 무엇이 일어났나, 누가 할 권한이 있나 | 브라우저 · 세션 · 클릭 · 모델의 판단 결과를 사실로 승격하는 것 |
| **Generic Agent** | **Investigation · Context synthesis · Action proposal** — 주어진 Case에 대해 Reviewnary domain tool로 읽고, 근거를 모으고, 행동을 **제안**한다 | 상태 전이 · 권한 판정 · 쓰기 · 스케줄 · 정책 변경 · 사건 발명 |
| **Aside** | **authenticated browser observation/execution runtime** — 승인된 run 하나를 terminal outcome까지 나르고 구조화된 실패 코드를 돌려준다 | 파싱 · 정규화 · dedup · 판단 · 판매자 결정 · 임의 자동화 (`aside_execution_provider_v1.md` §1.2 그대로) |

**경계 규칙 셋:**
1. **Agent는 Case를 만들지 않는다.** 후보는 결정론 게이트(SQL · 채널 상태 · triage rule)가 정하고
   Agent는 그 뒤에 조사한다 — `ProactiveReason` docblock의 규칙을 Case 전체로 넓힌 것이다.
2. **Agent의 출력은 제안이지 사실이 아니다.** Case의 status는 Agent 출력에서 파생되지 않고 운영 진실
   (work item phase · 채널 answered state · 판매자 결정 · verification)에서 파생된다.
3. **Aside의 결과는 관측이다.** Aside가 반환한 행은 기존 ingest spine을 지나야 Commerce State가 되고,
   Aside의 실패는 ResponsibilityRun source의 `failureReason`이 된다. Aside는 Reviewnary state를 직접
   쓰지 않는다.

---

## 3. v1 template — `CUSTOMER_OPERATIONS_V1` 하나

`ResponsibilityDefinition`은 **code registry의 template**이다. DB 행이 아니고, 판매자나 운영자가 편집하는
정의가 아니며, generic builder · procedure editor · DSL · cron language를 만들지 않는다.
(`OperatorToolRegistry`·`HandlerName`·`ReviewReplyTemplateKey`와 같은 규율 — 정의는 닫힌 코드이고
테스트가 그 닫힘을 고정한다.)

```
ResponsibilityDefinition (code)
  code            CUSTOMER_OPERATIONS_V1
  version         1                          ← run이 이 값을 기록한다
  sources         closed list of SourceSpec   (§3-1)
  cadences        closed set                  (PD-2)
  actionClasses   closed table: ActionClass → Authority(AUTO | HUMAN)   (§7)
  caseRules       closed list of deterministic candidate gates          (§5-3)
  surfaceCopy     seller-facing 문장 (한 곳)
```

### 3-1. Sources — 제안 (PD-1)

오늘 **증명된** 관측 경로만 후보다. 새 채널 · 새 수집 capability · pagination 확대 **0**.

| source | method | 오늘 증명 수준 | 비고 |
|---|---|---|---|
| Cafe24 INQUIRY | API | routine READ live-verified (routine sweep, comment observer) | `SyncRunExecutor` |
| Cafe24 REVIEW | API | connector 존재 | 동일 |
| NAVER INQUIRY (상품·고객) | API | live-verified | 고정 egress IP 필요 (NAVER infra) |
| Coupang INQUIRY | API | connector 존재 | 판매자 API 키 필요 — 브라우저 lane과 독립 |
| Coupang REVIEW | BROWSER (Aside, BYO) | **operator-run 1-page, seller-initiated** | 무인 실행 **NOT APPROVED** — §11, PD-1/PD-7 |
| NAVER REVIEW | BROWSER export | seller-seated walk | 무인 불가 — v1 template에서 제외 제안 |

**Coupang REVIEW를 v1 template에 넣으면** 정기 run마다 그 source는 무인 실행 권한이 없어 관측할 수 없고,
그대로 두면 ③이 매 run 같은 장애를 말하는 소음이 된다. 선택지는 PD-1에 적었다.

---

## 4. Seller-facing Responsibility surface

**한 화면, 네 질문.** 새 IA 섹션이 아니라 기존 `/connect` 옆의 설정·상태 surface이고, 일상 화면은 §10의
Exception UX다.

| 질문 | 화면이 말하는 것 | 근거 기록 |
|---|---|---|
| 무엇을 맡겼나 | 「고객 운영」 한 줄 설명 · 확인하는 채널 목록 · 주기 | `Responsibility` + definition |
| 어디까지 스스로 하나 | **자동으로 하는 일** / **항상 묻는 일** 두 목록 (§7 표를 판매자 문장으로) | definition.actionClasses |
| 마지막으로 언제 확인했나 | 「오늘 14:00 확인 · 쿠팡 리뷰는 확인하지 못했습니다(도우미 꺼짐)」 | 최신 `ResponsibilityRun` + sources |
| 멈추려면 | [일시 정지] / [다시 맡기기] | `Responsibility.status` |

- **수락은 명시적 판매자 행위다.** 가입이나 채널 연결이 곧 직무 위임이 아니다(`CONNECTED_SELLERS`가 「수집해
  달라」로 읽히는 것과 다르다 — 수집은 연결의 뜻이지만 초안 준비·자동 정리는 아니다).
- 화면 어휘에 `run`·`source`·`window`·`provider`·`Aside`·`carrier`·`template`·`ActionClass` **0**(테스트).
- 이 surface는 권한을 **넓히는 컨트롤을 갖지 않는다.** v1에서 판매자가 바꿀 수 있는 것은 켜기/끄기와 주기뿐이다.

---

## 5. Core new objects

### 5-1. `Responsibility` — 「이 org는 이 직무를 맡겼다」

- org당 template당 **하나** (`unique(org_id, template_code)`).
- 상태: `ACTIVE` · `PAUSED` · `STOPPED`. `PAUSED`에는 `paused_reason`(판매자 / 시스템 — 예: 연결 전부 해제).
- 기록: 수락한 사용자 · 수락 시각 · template version at acceptance · 선택한 cadence.
- **소스 목록을 저장하지 않는다.** 어떤 계정·데이터타입을 확인하는지는 run 시점에 definition × 연결 상태에서
  파생한다(두 번째 목록을 맞춰 둘 필요가 없다 — `CONNECTED_SELLERS`와 같은 논리). 판매자가 특정 채널을 빼는
  컨트롤이 필요한지는 PD-1.

### 5-2. `ResponsibilityRun` — 「이 창(window)을 이렇게 확인했다」

- identity는 **`(responsibility_id, window_start)`** — 스케줄 tick이 아니라 **논리 창**이다.
- 상태: `PENDING` → `RUNNING` → `SUCCEEDED` | `PARTIAL` | `FAILED` | `CANCELLED`.
- 자식 행 **`responsibility_run_source`** = observation record (§6-2). 새 object가 아니라 run의 일부다.
- 요약 칸: 관측된 신규 row 수 · 열린 Case 수 · 자동 처리 수 · 결정 요청 수 · 장애 source 수 — **각 칸은
  한 모집단만 센다**(`OperationsHomeContractTest`의 `urgent`/`score`/`total` 금지 규칙 적용).

### 5-3. `OperationsCase` — 「이것은 사건이다」

- **canonical term은 `OperationsCase`.** 물리 저장소는 PD-3 (권고: 기존 `proactive_case` 확장, §16-4).
- 종류 둘: `CUSTOMER_WORK`(문의·리뷰 한 건) · `OBSERVATION_GAP`(source 하나가 확인되지 않음).
- **status는 파생된다** — Proactive v1의 규칙 그대로. Case를 직접 바꾸는 API는 없고, reconciler가 운영 진실
  에서 매 tick 재계산한다. 판매자의 행위는 그 행위를 소유한 기록(approval · disposition · correction)에 쓰이고
  Case는 그것을 읽는다.
- 권한 칸 `required_authority`(`AUTO` | `HUMAN`)는 definition의 ActionClass 표에서 온다(§7).
- 해결 칸 `resolution`: `AUTO_NO_ACTION` · `AUTO_MONITOR` · `AUTO_PREPARED` · `SELLER_ACTED` ·
  `EXECUTED_VERIFIED` · `EXECUTED_UNRESOLVED` · `ANSWERED_ELSEWHERE` · `SUPERSEDED` · `OBSERVED_AGAIN`
  (gap이 다음 COMPLETE 관측으로 닫힘).
- 이력 `operations_case_event`(append-only): actor `SYSTEM` | `AGENT` | `SELLER`, run id, 닫힌 kind,
  provenance ref. **고객 문장은 복사하지 않는다**(사본은 원본 행 하나).

---

## 6. Run reliability invariants

### 6-1. 불변식과 강제 장치

| # | 불변식 | 강제 장치 (제안) |
|---|---|---|
| R1 | **같은 scheduled window 중복 금지** | `unique(responsibility_id, window_start)`. window는 cadence 경계에 KST로 정렬된 `[start, end)` — tick 시각이 아니라 창이 key다 |
| R2 | **overlapping run 금지** | partial unique `(responsibility_id) where status in ('PENDING','RUNNING')` + `lease_until` heartbeat. lease 만료 run은 `SyncRunGate`처럼 **회수**되지 조용히 겹치지 않는다 |
| R3 | **일부 source 실패 → `PARTIAL`** | run status는 source outcome의 순수 함수: 모두 COMPLETE/BOUNDED → SUCCEEDED · 하나라도 NONE/PARTIAL이고 하나라도 관측됨 → PARTIAL · 전부 NONE → FAILED (`RunOutcome.classify`의 run 단위 판) |
| R4 | **전부 실패 → `FAILED`** | 위 함수. 관측 0인 run은 SUCCEEDED가 될 수 없다(테스트) |
| R5 | **`AUTH_REQUIRED` / device offline / timeout을 「0건」으로 취급 금지** | source의 `rows_new=0`은 `completeness ∈ {COMPLETE, BOUNDED}`일 때만 의미를 갖는다. 그 외에는 count 칸이 **null**이고 화면은 「확인하지 못함」. `ChannelDataState`의 「`ZERO`만 없다고 말한다」를 run 단위에서 다시 강제 |
| R6 | **retry 시 logical window 중복 처리 금지** | retry는 **새 run이 아니라 같은 run 행의 `attempt++`**. COMPLETE/BOUNDED source는 다시 돌지 않는다. 다시 도는 source의 행은 기존 ingest dedup을 지나고, Case 생성은 `signature` unique로 멱등 |
| R7 | 한 org의 실패는 다른 org를 멈추지 않는다 | 기존 `ProactiveScheduler`/`SyncScheduleRunner` 패턴 그대로 — per-org try/catch |
| R8 | 수집 이중화 금지 | Responsibility run은 API source를 **직접 두 번째로 수집하지 않는다** — 창 안의 `sync_jobs` 결과를 관측으로 채택하고, 없을 때만 `SyncRunExecutor`를 부른다(single-flight gate가 in-flight run을 돌려준다). §15 scheduler 행 |

### 6-2. Observation completeness contract

모든 `responsibility_run_source` 행은 다음을 **전부** 가진다. 하나라도 비면 그 source는 COMPLETE일 수 없다.

| 칸 | 의미 | 출처 |
|---|---|---|
| `source` | `channel × data_type × seller_account` | definition × 연결 |
| `method` | `API` · `BROWSER` | connector / execution provider |
| `recipe_version` | 무엇으로 읽었나 — connector version · workflow `{id,version}` · executor version | `SegmentExecutionOutcome.workflow`, connector 식별자 |
| `window_from/to` 또는 `cursor_from/to` | 무엇을 읽기로 했나 | run window / `sync_cursors` |
| `observed_at` | 언제 관측했나 | sync job `finished_at` / Aside `completedAt` |
| `completeness` | `COMPLETE` · `BOUNDED`(page limit 등 명시적 경계 — 경계를 함께 기록) · `PARTIAL` · `NONE` | 아래 규칙 |
| `failure_reason` | 닫힌 어휘: `AUTH_REQUIRED` · `DEVICE_OFFLINE` · `TIMEOUT` · `RATE_LIMITED` · `STORE_MISMATCH` · `STORE_UNRESOLVED` · `CAPABILITY_GATED` · `NOT_CONNECTED` · `UPSTREAM_ERROR` · `CANCELLED` | sync job 오류 분류 · `ExecutionFailureCode` · readiness |
| `identity_verdict` | `MATCH` · `MISMATCH` · `UNRESOLVED` · `NOT_APPLICABLE` — 브라우저 source는 필수 | `storeIdentityVerdict()` |
| `sync_job_id` | 실행 기록 (FK) | **KEEP `sync_jobs`** |
| `rows_received/new/duplicate` | completeness가 COMPLETE/BOUNDED일 때만 non-null | sync job tallies |

**규칙:** `STORE_MISMATCH`·`STORE_UNRESOLVED`·`AUTH_REQUIRED`는 행을 읽지 않은 채 `NONE`이다(fail closed —
기존 Aside 계약 그대로). `BOUNDED`는 「읽은 범위 안에서 없다」만 말하고 「없다」를 말하지 않는다.

---

## 7. AUTO PROCESS ≠ AUTO EXECUTE

**자동으로 처리한다는 것은 Reviewnary state 안의 일이고, 자동으로 실행한다는 것은 고객·돈·마켓플레이스에
닿는 일이다.** v1은 전자만 자동이다.

| ActionClass | Authority v1 | 쓰는 곳 | 비고 |
|---|---|---|---|
| `CLASSIFY_FYI` | AUTO | Case(resolution) | 리뷰 triage `FYI` — 판매자 결정 spine(`TriageDisposition`)에는 **쓰지 않는다** (§9) |
| `RECORD_NO_ACTION` | AUTO | Case | 동일 — 시스템의 판단은 판매자의 결정으로 기록되지 않는다 |
| `MONITOR` | AUTO | Case | 반복 문제 lane은 읽기만 (`IssueLifecycleState` 무접촉) |
| `GATHER_CONTEXT` | AUTO | Case investigation | READ domain tools만 |
| `PREPARE_DRAFT` | AUTO (PD-4: 모델 비용·벤더 payload) | `inquiry_reply_draft` / `review_reply_draft` (append-only, `author_kind=MODEL`) | 기존 production draft path. `NO_ANSWER_BASIS`면 모델 0 · 초안 0 그대로 |
| `CUSTOMER_WRITE` (문의 답변 · 리뷰 답글) | **HUMAN** | 기존 approval → execution | 승인 경계 · fingerprint · single-use 무변경 |
| `REFUND` · `COMPENSATION` · `CANCEL` · money action | **HUMAN** | v1에 실행 경로 없음 | Case는 「이 판단은 판매자의 것」을 말할 뿐 |
| marketplace high-impact write 전반 | **HUMAN** | — | autonomous 금지 (non-goal) |

구조 fence(제안): Responsibility 패키지에서 approval·publish·execution·channel write 클래스를 **이름으로
import 0**(`ProactiveSafetyFenceTest`·`OpportunitySafetyFenceTest`와 같은 방식).

---

## 8. Agent contract

1. **low-level browser tool 직접 제공 금지.** Agent의 도구 목록에 `openTab`·`evaluate`·`click`·`fill`·임의
   URL·임의 script **0**. 브라우저가 필요한 관측은 Reviewnary가 source로 스케줄하고, Agent는 그 결과를
   domain tool로 읽는다.
2. **Reviewnary domain tools만.** 기존 `OperatorToolRegistry` 31종(전부 READ, WRITE 도구는 구조 테스트가
   거부) 위에서. 새 도구가 필요하면 READ domain tool로만 추가한다.
3. **strict output schema.** Investigation 출력은 닫힌 스키마:
   `{caseId, findings[{kind, evidenceRefs[]}], proposedAction{actionClass, targetRef, draftRef?},
   knowledgeGap?, confidenceNote}` — 자유 텍스트 판단이 status나 authority로 흐르는 칸이 없다.
   스키마 위반은 조사 실패이고 Case는 결정론 사실만으로 남는다.
4. **provenance.** 조사 한 번마다 `model` · `prompt_version` · `tool_calls[{tool, argsDigest}]` ·
   `evidence_refs[]` · `started/finished` · token usage(기존 `AgentLlmCallMetrics`)를 case event에 남긴다.
   evidence ref는 id뿐이고 고객 문장 사본 0.
5. **실행 위치는 PD-5.** 사실: agent-runtime은 자격을 갖지 않고 판매자의 forwarded bearer로 backend를
   부른다 — **스케줄된 run에는 bearer를 줄 사용자가 없다.** 반면 `ProactiveInquiryInvestigator`는 backend
   안에서 같은 production draft path를 이미 돈다.

---

## 9. Decision memory

- **입력(전부 기존 기록, 새 writer 0):** `TriageDisposition` · `review_triage_correction(_audit)` ·
  `improvement_opportunity_event` · 문의 초안 버전의 `author_kind`(MODEL v1 → SELLER v2 수정 여부) ·
  `InquiryApproval` · reply work dismissal/restore · `operations_case_event`(actor=SELLER).
- **사용:** 다음 조사의 context에 **닫힌 사실**로 들어간다 — 「이 상품의 비슷한 문의에 판매자가 초안을 고쳐
  보냈다(차이 요약 없음, 버전 ref)」, 「이 유형 리뷰를 판매자가 참고로 낮췄다」.
- **policy 자동 변경 금지.** Decision memory reader는 org knowledge · answer style · reply template ·
  triage rule · definition에 **writer를 갖지 않는다**(구조 테스트). 「판매자가 세 번 고쳤으니 정책을 바꾼다」는
  제안(`proposedAction`)까지이고, 바꾸는 것은 판매자다.
- AI 초안은 여전히 Answer Memory에 들어가지 않는다(기존 fence 무변경).

---

## 10. Exception UX

**세 칸, 각 칸은 한 모집단.** Operations Home의 네 영역 위에 서고(대체가 아니다), 대화는 그대로 아래에 있다.

| 칸 | 포함 조건 (파생) | 행 하나가 말하는 것 | 나가는 길 |
|---|---|---|---|
| ① **내 결정 필요** | `CUSTOMER_WORK` · `required_authority=HUMAN` · 운영 진실상 아직 판매자 차례 | 무엇 · 왜 지금 · Reviewnary가 준비한 것(초안/근거) | 그 결정을 **이미 소유한 화면**(문의 상세 · 리뷰 결정 워크스페이스) |
| ② **Reviewnary가 정리/준비한 일** | 이번 기간 `resolution ∈ AUTO_*` | 무엇을 어떻게 정리했나 · 되돌리기(판매자가 판단을 덮어쓸 수 있는 기존 컨트롤로) | 같은 화면 |
| ③ **Reviewnary가 제대로 확인하지 못한 곳** | 열린 `OBSERVATION_GAP` | 어느 채널의 무엇 · 언제부터 · 판매자가 할 수 있는 한 걸음(로그인 · 도우미 켜기 · 재연결) | `/connect/...` |

- 셋은 **더하지 않는다**(「처리할 일 N건」 합계 칸 0).
- ②는 결정 요청이 아니다 — 기본 접힘, 숫자 한 줄.
- ③은 **같은 source의 연속 장애를 한 Case로** 든다(run마다 새 행 0 — signature = source + failure family).
- 기술 진단(`failure_reason` 원문 · recipe · lease)은 「기술 정보」 fold 안에만.

---

## 11. Scheduled Aside

### 11-1. 현재 사실

- **carrier는 브라우저가 연다.** `RESIDENT_CARRIER_ACTIVATORS`는 paired 브라우저의 `AwAttachRequest`로만
  활성화된다(`collector/src/cli/local-agent.ts`). backend가 helper에게 일을 주는 채널은 **없다**.
- helper device token의 allow-list(`HelperDeviceAuthFilter`)에 **작업 lease 경로가 없다.**
- `ChannelReviewAcquisitionService.mint(org, account, userId)`는 **판매자 press에 묶인** single-use ref다.
- 정책: `sellerops_canonical_reference.md`「No unattended or scheduled collection」,
  `coupang_aside_operator_run_lane_v1.md`「unattended / scheduled — NOT APPROVED」,
  `execution_strategy_v1.md`「Unattended / scheduled BYO — NOT APPROVED」.

### 11-2. v1이 증명하는 것과 하지 않는 것

| | v1 acceptance |
|---|---|
| **architecture proof** — Reviewnary가 스케줄한 run이 helper(Bridge)를 거쳐 Aside로 실행되고, 결과가 run source + Case로 닫힌다 | **포함** |
| 판매자가 탭을 열거나 버튼을 누르지 않은 상태에서 **반복** 실행 (연속 N회, R1–R6 성립) | **포함** |
| 대상 surface | **owned/allowed surface만** — PD-7 |
| **marketplace unattended enablement** (WING 등) | **별도 capability gate · 기본 OFF · v1 acceptance 밖** |

### 11-3. 제안 구조 (PD-7 승인 전 구현 0)

```
ResponsibilityRun source (BROWSER)
  → capability gate: unattended_allowed(channel, data_type, surface)   ← default false, 마켓플레이스 false
  → lease 발행 (run-scoped, single-use, 만료 있음; mint의 system-actor 판)
helper (device token)
  → allow-listed lease claim 경로 하나로 due lease를 가져온다        ← 새 allow-list route (security review)
  → resident activator를 브라우저 대신 lease로 호출
  → SegmentExecutionProvider(ASIDE) → 기존 identity → read → ingest handoff
  → outcome → run source(completeness, failure_reason, identity_verdict)
helper offline / lease 만료 → source NONE · DEVICE_OFFLINE / TIMEOUT (「0건」 아님)
```

- page bound · pagination policy · STORE_MISMATCH/ambiguous/AUTH_REQUIRED fail closed · marketplace WRITE 0 ·
  LLM 0 (실행 경로) · OpenAPI independence — **전부 무변경**.
- 앞선 brief의 「explicit seller initiation requirement」는 **마켓플레이스 surface에 대해 그대로 유효**하다.
  이 문서는 owned surface에서의 architecture proof만 그 예외로 기록하며, 마켓플레이스 예외는 gate 결정 없이
  생기지 않는다.

---

## 12. External action — Cafe24 문의 closed loop

**기존 경로 하나를 Case에 연결해 real write까지 닫는다. 새 write path 0.**

```
Cafe24 INQUIRY source 관측
→ CUSTOMER_WORK Case (결정론 게이트: channel unanswered + inquiry_work_item OPEN)
→ PREPARE_DRAFT (AUTO) — InquiryDraftComposer, 3-lane retrieval, provenance
→ ① 내 결정 필요
→ 판매자: 문의 상세에서 수정/승인 — InquiryPublishService.confirmAndPublish(sellerUserId, commandId, fingerprint)
→ InquiryActionIntent → InquiryExecution → Cafe24ChannelReplyAdapter (POST 1회, 재시도 메서드 없음)
→ exact READ 검증 → VERIFIED | ANSWER_POSTED_STATUS_UNRESOLVED | DELIVERY_UNKNOWN
→ Case resolution EXECUTED_VERIFIED | EXECUTED_UNRESOLVED (+ event) — status는 work item/verification에서 파생
→ 판매자가 보낸 버전(SELLER/MODEL)은 기존 Answer Memory hook 규칙대로
```

**실행 전제(코드 아님):** `SELLEROPS_INQUIRY_PUBLISH_EXECUTION_ENABLED` · Cafe24 live approval id ·
`client_ip` · `shop_no` · `mall.write_community` 재동의 · **안전한 실제 대상 문의**(PD-8) ·
`docs/sellerops_live_approval_contract.md`에 따른 **새 단일 사용 in-turn 승인**. 2026-08-25 `VERIFIED`
증명의 승인은 이월되지 않는다.

---

## 13. v1 non-goals

Generic Responsibility Builder · Generic Procedure Editor · Multi-Agent framework · arbitrary browser tools ·
Store Health 구현 · Money/Claims 구현 · Listing Integrity 구현 · Knowledge Folder 구현 · arbitrary cron/policy
language · autonomous marketplace high-impact writes. 추가로 이 문서가 명시하는 것: 새 채널 0 · 새 수집
capability 0 · pagination/page limit 확대 0 · marketplace unattended enablement 0 · 판매자 비밀번호 저장/자동
로그인 0 · CAPTCHA/MFA 우회 0 · 알림 전송 채널 구현(PD-6 결정 전) 0.

---

## 14. Final acceptance — E2E

순서가 곧 증명이다. 전부 **한 org · 한 스택 · 실제 브라우저**에서, 판매자 역할은 운영자가 제품 UI로만.

1. 판매자가 Cafe24(API)를 연결하고 Responsibility surface에서 `CUSTOMER_OPERATIONS_V1`을 **수락**한다.
   화면은 자동으로 하는 일 / 항상 묻는 일을 말한다.
2. 스케줄러가 window W₁ run을 만든다. Cafe24 INQUIRY·REVIEW source가 `COMPLETE`로 관측된다.
3. **R1:** 같은 W₁에 두 번째 trigger → 새 run 0. **R2:** W₁ 진행 중 W₂ trigger → 겹침 0.
   **R6:** W₁ 진행 중 프로세스 강제 종료 → lease 만료 회수 → 같은 run `attempt=2`, COMPLETE source 재실행 0,
   중복 row 0 · 중복 Case 0.
4. 한 source를 인위적으로 실패시킨다(도우미 끔 / 토큰 무효) → run `PARTIAL`, 그 source `NONE ·
   DEVICE_OFFLINE|AUTH_REQUIRED`, count null, ③에 한 행, 화면 어디에도 그 source의 「0건」 없음.
   **R4:** 전 source 실패 run은 `FAILED`.
5. 새 문의 관측 → `CUSTOMER_WORK` Case → domain tool 조사(provenance 기록) → 초안 준비 → ①.
6. FYI 리뷰 관측 → `AUTO_NO_ACTION` → ②, 판매자 결정 spine 무기록.
7. 환불을 요구하는 리뷰/문의 → ① (`HUMAN`), 실행 경로 호출 0.
8. 판매자가 ①의 Cafe24 문의 초안을 수정·승인 → **real Cafe24 POST 1회** → exact READ `VERIFIED` →
   Case `EXECUTED_VERIFIED`, 이력에 SYSTEM/AGENT/SELLER 순서가 남는다.
9. 다음 run의 비슷한 Case 조사 context에 8의 판매자 결정이 닫힌 사실로 들어간다 — org knowledge·style·
   template·triage rule 행 변경 0(단언).
10. 4에서 끈 source가 복구된 다음 run에서 `COMPLETE` → ③ Case `OBSERVED_AGAIN`으로 자동 종료.
11. **Scheduled Aside proof:** owned/allowed surface에서 판매자 press 없이 연속 N(≥3)회 스케줄 run이
    helper(Bridge)+Aside로 실행되고 R1–R6이 성립한다; 같은 스택에서 marketplace surface에 대한 무인 lease는
    capability gate가 **거절**한다(단언).
12. 2~11 동안 판매자가 앱을 열지 않은 구간이 있고, 열었을 때 화면은 ①②③만으로 그 구간을 설명한다.

---

## 15. Existing code reuse map

**KEEP** = 그대로 사용 · **WRAP** = 바꾸지 않고 감싸서 새 계약으로 노출 · **EXTEND** = 가산적 변경 ·
**NEW** = 없던 것.

| 영역 | 기존 코드 | 판정 | 새 Runtime에서의 역할 | 같은 책임이 이미 있나 |
|---|---|---|---|---|
| **scheduler/worker** | `SyncScheduler`·`SyncScheduleClaimer`(SKIP LOCKED, at-most-once per tick)·`SyncScheduleRunner`(backoff·DEGRADED alert)·`SyncRunGate`(single-flight+orphan) · `SelfPilotReconciler`(기본 schedule 생성) · `ProactiveScheduler` | **KEEP** 수집 scheduler · **WRAP** 패턴 · **NEW** `ResponsibilityScheduler` | 수집은 계속 `sync_schedules`가 한다(R8). Responsibility scheduler는 **창 단위 run**을 만들고 관측을 채택한다. claim 패턴(SKIP LOCKED)과 per-org 격리를 그대로 쓰되, at-most-once 트레이드오프 대신 lease 회수를 둔다 | 부분 — 계정×타입 단위 수집은 있음, **직무×창 단위 run은 없음** |
| **sync_jobs/acquisition evidence** | `sync_jobs`(status·tallies·trigger·attempt·rate_limited) · `sync_cursors` · `CollectionRunService` · `RunOutcome.classify` · `ChannelDataState` · `ChannelCoverageService` · `sync_jobs.acquisition_sync_job`(V83) | **KEEP** + **WRAP** | `responsibility_run_source.sync_job_id`가 실행 기록을 가리킨다. completeness는 sync job + `ChannelDataState` 규칙에서 파생. 두 번째 실행 기록 테이블 0 | 있음 — 실행 기록은 sync_jobs가 소유 |
| **Review acquisition** | API connectors · Coupang Aside lane(`coupang-review-runtime.ts`, `ChannelReviewAcquisitionService.mint/resolve`, `ScreenReadReadiness`, identity MATCH gate) · NAVER export walk · `SegmentExecutionProvider` | **KEEP** 실행 · **WRAP** outcome→source · **EXTEND** (C) lease 경로 | 브라우저 source의 `failure_reason`·`identity_verdict`·`recipe_version`은 `SegmentExecutionOutcome`에서 그대로 옮긴다. 무인 lease는 C에서 gate 뒤에 | 있음 — 실행은 있고 **스케줄 trigger가 없음** |
| **Inquiry acquisition** | Cafe24/NAVER/Coupang inquiry connectors via `SyncRunExecutor` · `Cafe24InquiryAnswerObserver` · `InquiryOperationalStateProjector` · `reconcileConnectorAnswered` | **KEEP** | API source. answered-elsewhere는 기존 reconcile이 소유하고 Case는 읽는다 | 있음 |
| **Attention/Rules** | `ReviewTriageRules`/`ReviewTriageTier` · `TRIAGE_TIER_RANK`/`FINAL_TIER_RANK` · `NOT_DISMISSED_PREDICATE` · `InquiryWorkItemPhase.AWAITING_SELLER` · `ProactiveReason` candidate gate | **KEEP** + **WRAP** | Case candidate gate와 ActionClass 매핑의 입력. 새 classifier 0 | 있음 |
| **Repeated Issue** | `reviewissue/`(extractor·lifecycle·evidence·`NegationScope`) · `RepeatedIssueWorkspaceService` | **KEEP** (READ only) | `MONITOR` / 조사 context. lifecycle 무접촉 | 있음 |
| **Product/Seller Knowledge** | `KnowledgeRetriever`(3-lane) · org/product knowledge · Answer Memory · style · company profile · `KnowledgeGap` candidates | **KEEP** | 조사 grounding. Decision memory는 이들에 writer 0 | 있음 |
| **Decision Workspace** | `ReviewDecisionWorkspaceService`(`decision-context`/`decision-log`, write 0) · `TriageDisposition` · `review_triage_correction` · reply approval | **KEEP** mutation surface · **WRAP** decision-log reader | ① 행의 목적지. Decision memory reader의 입력. 두 번째 결정 문 0 | 있음 — 결정의 canonical surface |
| **ActionCandidate/current action models** | `IssueActionCandidate` = `ImprovementOpportunity`(파생, 저장 안 함) + `improvement_opportunity_event` · `ProactivePreparedAction` · `InquiryProposal` | **KEEP** · **WRAP** into ActionClass | Agent `proposedAction`의 어휘는 이 기존 모델들 위의 닫힌 ActionClass 표이지 새 action 모델이 아니다 | 있음 — 부분(authority 칸이 없음) |
| **execution/audit** | 문의 `InquiryApproval`·`InquiryActionIntent`(V86 binding)·`InquiryExecution`(`InquiryExecutionStatus`)·`InquiryVerification`·`DispatchRecoveryRunner` · `Cafe24ChannelReplyAdapter`/`Cafe24AnswerExecutionGrant` · 리뷰 `review_reply_execution`(V84) · `InquiryWorkItemAudit` | **KEEP** | §12 closed loop 그대로. Case는 결과를 읽어 resolution/event로 투영 | 있음 — authority/실행은 여기서만 |
| **Operations Home** | `OperationsHomeService`/`OperationsHomeView`(한 read, write 0, 합계 칸 금지) · `OperationsAreas` in `AgentHome` · `ProactiveCases` 섹션 | **EXTEND** | ①②③ 세 칸을 같은 한 read에 추가, 기존 네 영역 유지. 「AI가 먼저 확인한 일」은 ①/②로 흡수 | 부분 — 준비된 작업은 있고 **장애 칸·권한 구분은 없음** |
| **Bridge/Aside provider** | `SegmentExecutionProvider`(LOCAL_HELPER/ASIDE) · `aside-cli.ts`(closed invocations) · `RESIDENT_CARRIER_ACTIVATORS` · `HelperDeviceAuthFilter` · helper device token (V97) | **KEEP** provider · **EXTEND** (C) lease claim route + lease-driven activation | Scheduled Aside architecture proof | 부분 — 실행은 있고 **backend→helper 작업 채널이 없음** |
| **(참고) proactive** | `proactive_case`·`ProactiveCaseReconciler`(파생 status)·Investigators·`proactive_baseline_at` | **EXTEND** (PD-3 권고) | OperationsCase의 물리 저장소 후보 | **거의 같은 책임** — 그래서 새 테이블을 기본값으로 두지 않았다 |
| **(참고) agent run store** | `agent_runs`(org-scoped · version · claim/lease · domain) | **KEEP** (대화/절차용) | Responsibility run 저장소로 **재사용하지 않는다** — snapshot text blob이고 창 unique·source 행을 표현할 수 없다 | 아니오 |
| **NEW** | — | **NEW** | `ResponsibilityDefinition` registry · `responsibility` · `responsibility_run` · `responsibility_run_source` · `operations_case_event` · `ResponsibilityScheduler`/run coordinator · completeness classifier · Case reconciler 확장(gap kind) · investigation contract(schema+provenance) · decision memory reader · Responsibility surface · Exception UX 3칸 · helper lease route | — |

---

## 16. Proposed schema/state changes (제안 — 생성 0)

### 16-1. `responsibility`
```
id uuid pk · org_id fk · template_code varchar(48) · template_version int
status varchar(16) check in (ACTIVE, PAUSED, STOPPED)
cadence varchar(16)                      -- closed set, PD-2
accepted_by uuid · accepted_at timestamptz · paused_reason varchar(32) null
unique (org_id, template_code)
```

### 16-2. `responsibility_run`
```
id uuid pk · responsibility_id fk · org_id
window_start timestamptz · window_end timestamptz · definition_version int
trigger varchar(16) check in (SCHEDULED, MANUAL)
attempt int · status varchar(16) check in (PENDING, RUNNING, SUCCEEDED, PARTIAL, FAILED, CANCELLED)
lease_until timestamptz null · started_at · finished_at
observed_new int null · cases_opened int · auto_processed int · decisions_requested int · gap_sources int
unique (responsibility_id, window_start)                                  -- R1
unique (responsibility_id) where status in ('PENDING','RUNNING')          -- R2
```

### 16-3. `responsibility_run_source`
```
id uuid pk · run_id fk · org_id · seller_account_id · channel_code · data_type
method varchar(16) · recipe_version varchar(80)
window_from/window_to timestamptz null · cursor_from/cursor_to text null
observed_at timestamptz null
completeness varchar(16) check in (COMPLETE, BOUNDED, PARTIAL, NONE)
bound_note varchar(48) null            -- BOUNDED일 때 필수 (예: PAGE_LIMIT_1)
failure_reason varchar(32) null        -- closed vocabulary §6-2
identity_verdict varchar(16) check in (MATCH, MISMATCH, UNRESOLVED, NOT_APPLICABLE)
sync_job_id uuid null fk sync_jobs
rows_received/rows_new/rows_duplicate int null
check (completeness in ('COMPLETE','BOUNDED') or rows_new is null)       -- R5
unique (run_id, seller_account_id, data_type)
```

### 16-4. OperationsCase — PD-3 권고안: `proactive_case` 가산 확장
```
+ case_kind varchar(24) default 'CUSTOMER_WORK' check in (CUSTOMER_WORK, OBSERVATION_GAP)
+ subject_kind 값 추가: SOURCE (subject_id = seller_account_id, signature에 data_type + failure family)
+ required_authority varchar(8) null check in (AUTO, HUMAN)
+ resolution varchar(32) null
+ first_run_id uuid null · last_run_id uuid null
~ uq_proactive_case_open_subject → (org_id, subject_kind, subject_id, case_kind, signature_family)
  where status = 'PREPARED'        -- 비파괴 인덱스 교체이나 constraint 의미 변경 → 리뷰 필요
```
대안 B(새 `operations_case` 테이블 + proactive producer 재배선)는 §18 PD-3.
Java canonical 이름은 `OperationsCase`, 물리 이름 유지 — `IssueActionCandidate`/`improvement_opportunity`
선례와 같은 처리.

### 16-5. `operations_case_event` (append-only)
```
id · org_id · case_id · run_id null · actor (SYSTEM|AGENT|SELLER) · kind (closed)
provenance jsonb null   -- model, prompt_version, tool_calls[{tool,argsDigest}], evidence_refs[], usage
created_at
```
provenance에 고객 문장·판매자 문장·초안 본문 금지(payload floor 테스트).

### 16-6. 상태 기계 요약
```
Responsibility:   ACTIVE ⇄ PAUSED → STOPPED
ResponsibilityRun: PENDING → RUNNING → {SUCCEEDED | PARTIAL | FAILED | CANCELLED}
                   RUNNING --lease expired--> RUNNING(attempt+1)       (same row, R6)
OperationsCase.status (derived, 기존): PREPARED → ACTED | CLOSED
  bucket(derived): ① HUMAN ∧ PREPARED · ② resolution ∈ AUTO_* · ③ OBSERVATION_GAP ∧ PREPARED
```
기존 `inquiry_work_item` phase · approval · execution · verification · review reply 상태 기계는 **무변경**.

---

## 17. 3-package implementation plan

### Package A — Runtime + Observation Reliability

**범위:** `ResponsibilityDefinition` registry(`CUSTOMER_OPERATIONS_V1`) · `responsibility`/`responsibility_run`/
`responsibility_run_source` · `ResponsibilityScheduler`(창 계산 · claim · lease · 회수 · per-org 격리) ·
source 채택(창 안의 `sync_jobs` 채택 → 없으면 `SyncRunExecutor` via gate) · completeness classifier ·
run status 함수 · 브라우저 source는 이 package에서 **seller-run 관측만 채택**(무인 trigger 0) ·
최소 seller surface(수락/일시정지 · 마지막 확인 · 확인하지 못한 source 목록) · 기본값 OFF + org scope.
**Case는 만들지 않는다** — ③ 목록은 run source에서 직접 읽는 임시 뷰가 아니라, B에서 Case로 옮겨질
**같은 문장 소유자**(한 곳)로 둔다.

**E2E 종료조건:** 일회용 org · 실제 로컬 스택 · 실제 브라우저에서 §14의 1–4를 통과. 결정적 fault injection
(도우미 끔 · 토큰 무효 · 프로세스 kill · 동시 trigger)으로 R1–R8 전부 단언. API source 라이브 READ는 기존
connector의 approved routine 범위에서만(새 승인 필요 시 manifest); 없으면 fixture connector가 아니라
**mock fence가 켜진 상태에서 source=NOT_CONNECTED로 정직하게 기록되는 것**을 증명한다.
**마켓플레이스 WRITE 0 · 모델 0.**

### Package B — Case Intelligence + Exception UX

**범위:** OperationsCase(PD-3 결정대로) · `CUSTOMER_WORK`/`OBSERVATION_GAP` 파생 · ActionClass 표와 AUTO 처리
(`CLASSIFY_FYI`·`RECORD_NO_ACTION`·`MONITOR`·`GATHER_CONTEXT`·`PREPARE_DRAFT`) · investigation contract
(strict schema + provenance, PD-5 위치) · `operations_case_event` · Operations Home ①②③ · Responsibility surface
완성 · safety fence(approval/publish/execution import 0 · policy writer 0).

**E2E 종료조건:** §14의 5–7, 10, 12. 실제 draft 모델 호출이 포함된 run을 일회용 org에서 관측(비용·지연 실측
기록) · 3폭(1440/1366/1152) AA 0 · 화면 내부 어휘 0 · 같은 source 연속 장애가 Case 1행 · 복구 시 자동 종료.
**마켓플레이스 WRITE 0.**

### Package C — Closed Action Loop + Decision Memory + Scheduled Aside Proof

**범위:** Cafe24 문의 Case → 기존 approval/execution/verification → Case resolution 투영 · decision memory reader
(기존 결정 기록 → 조사 context, writer 0 테스트) · helper lease claim route + lease-driven carrier activation +
`unattended_allowed` capability gate(마켓플레이스 false) · owned/allowed surface 반복 실행.

**E2E 종료조건:** §14의 8, 9, 11 — **real Cafe24 POST 1회 `VERIFIED`**(새 단일 사용 승인 · PD-8 대상) ·
decision memory가 다음 조사 provenance에 나타남 + policy 행 무변경 · 판매자 press 없이 연속 ≥3 스케줄 Aside run
(R1–R6 성립) · marketplace 무인 lease 거절 단언. 이후 §14 전체를 한 sitting에서 재실행.

---

## 18. Risks / PRODUCT_DECISION_NEEDED

### 18-1. Product-owner decisions (임의 결정 금지 — 전부 열려 있음)

| # | 결정 | 왜 필요한가 | 이 문서의 권고 (결정 아님) |
|---|---|---|---|
| **PD-1** | v1 template의 sources · Coupang REVIEW(브라우저)를 넣을지 · 판매자가 채널을 뺄 수 있는지 | 무인 불가 source를 넣으면 ③이 영구 소음; 빼면 「고객 운영」이 쿠팡 리뷰를 맡지 않는다 | API source 전부 포함 · Coupang REVIEW는 **「판매자가 가져오는 source」**로 표시하고 마지막 관측 나이가 임계를 넘을 때만 ③ |
| **PD-2** | cadence 닫힌 집합 · 기본값 · 창 경계(KST) | R1의 key가 창이다 | 1h / 3h / 1d, 기본 3h |
| **PD-3** | OperationsCase 물리 저장소: `proactive_case` 확장 vs 새 테이블 | 같은 책임의 두 테이블은 두 권위 | 확장(§16-4). 인덱스 의미 변경 리뷰 포함 |
| **PD-4** | `PREPARE_DRAFT`를 AUTO로 둘지 · 모델 비용/일일 예산 · 고객 문장이 매 run 벤더로 나가는 폭 | 무인 run이 판매자 예산과 payload를 쓴다 (proactive는 기본 OFF였다) | AUTO + 기존 `AgentQuotaService` 카운터 공유 + per-run 상한 |
| **PD-5** | Investigation 실행 위치: backend(기존 production draft path) vs agent-runtime(스케줄 run용 system principal 필요) | 후자는 **새 자격 경로 = security boundary 변경** | v1은 backend 위치 + contract는 runtime 교체 가능하게 |
| **PD-6** | 예외 알림 채널(이메일/푸시/없음) | 「평소 보지 않는다」는 알림 없이는 「가끔 연다」가 된다; mailer는 현재 off | v1 non-goal로 명시하거나 이메일 1종 — **결정 필요** |
| **PD-7** | Scheduled Aside 「owned/allowed surface」의 정의 · helper allow-list에 lease route 추가 승인 | device token 권한 확대 · 새 backend→helper 작업 채널 | Reviewnary가 호스팅하는 fixture surface(WING 모양, 실제 WING 아님) + route 1개 |
| **PD-8** | Cafe24 real write의 대상 문의(실고객 무접촉 원칙) · live 승인 · client_ip/shop_no/scope | 2026-08-25 증명 대상은 소진됨 | 판매자(운영자)가 만든 REAL 테스트 문의 1건 + 새 manifest |
| **PD-9** | canonical 문서 충돌 정리 시점: `sellerops_canonical_reference.md`「No unattended or scheduled collection」· Coupang lane「NOT APPROVED」 | C가 architecture proof를 넣는 순간 문장이 부분적으로 거짓이 된다 | C 착지 PR에서 「marketplace surface에 대해」로 좁혀 갱신 |
| **PD-10** | Responsibility 대상 org scope (allow-list vs CONNECTED_SELLERS) · 수락 필수 여부 | 파일럿 운영 | 명시적 판매자 수락 필수 + 배포 allow-list |
| **PD-11** | seller-facing 이름 (「고객 운영 맡기기」 등) | 화면 어휘 | — |

### 18-2. Risks

1. **helper가 꺼져 있는 것이 SME PC의 정상 상태다.** 브라우저 source는 대부분의 run에서 `DEVICE_OFFLINE`일
   수 있다 — PD-1 없이는 ③이 신뢰를 잃는다.
2. **두 스케줄러의 이중 수집.** R8을 지키지 않으면 `sync_schedules`와 Responsibility run이 같은 source를
   두 번 친다(rate budget). 채택 우선 규칙과 single-flight gate가 방어선이다.
3. **두 권위.** Case가 work item phase와 다른 말을 하는 날 누가 옳은지 말할 수 없다 — status 파생 규칙을
   깨는 편의 API가 가장 큰 회귀 위험이다(구조 테스트로 막는다).
4. **`SyncScheduleClaimer`의 at-most-once 트레이드오프.** 그대로 쓰면 crash 시 창이 조용히 건너뛰어진다 —
   Responsibility run은 lease 회수가 필요하다(R2/R6).
5. **모델 비용·지연.** 무인 초안 준비는 판매자가 보지 않는 동안 돈을 쓴다(PD-4). 조사 1회 plan ≈3–5s,
   draft 왕복 추가 — run 길이가 lease 설계에 들어가야 한다.
6. **Cafe24 real write는 되돌릴 수 없다.** 검증이 `ANSWER_POSTED_STATUS_UNRESOLVED`로 끝날 수 있고 그것은
   성공도 실패도 아니다 — Case resolution이 그 셋을 구분해야 한다.
7. **Scheduled Aside는 새 security surface다.** lease route는 device token 권한을 넓힌다; single-use ·
   run-scoped · 만료 · org fence · capability gate가 전부 있어야 한다.
8. **정책 문서 충돌**(PD-9)을 방치하면 다음 세션이 「unattended 금지」를 근거로 C를 막거나, 반대로 이 문서를
   근거로 marketplace 무인을 켠다.

---

## 19. Recommended first implementation package

**Package A — Runtime + Observation Reliability.**

- B와 C가 전부 **run과 source 완결성** 위에 선다. 완결성 없이 만든 Case는 「0건」과 「못 봤다」를 구분하지
  못하고, 그것이 이 milestone이 고치려는 결함 자체다.
- A는 **마켓플레이스 WRITE 0 · 모델 0 · 새 security surface 0**으로 끝낼 수 있는 유일한 package다.
- A를 시작하는 데 필요한 결정은 **PD-1 · PD-2 · PD-10**뿐이다. PD-3/4/5/6은 B 전, PD-7/8/9는 C 전에 필요하다.
