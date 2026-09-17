# Responsibility Runtime v1

**날짜:** 2026-09-15 · **상태:** `CANONICAL MILESTONE DEFINITION` · **Package A `IMPLEMENTED`** (§21) ·
**Package B `IMPLEMENTED`** (§22, 2026-09-16)
**Baseline:** `feat/review-decision-workspace-v1` @ `c43e3f4d` (clean — main `2491f1ab`, `de1838f6`,
`experiment/aside-executor`, `feat/aside-integration-v1`를 전부 포함하는 유일한 clean checkpoint)
**§0–§19:** 목표 · 경계 · 불변식 · 재사용 계획 · 3-package 계획 · product-owner 결정 목록 (설계, 2026-09-15 확정 커밋
`7057e9f9`). §16의 스키마는 설계 시점의 **제안**이었고, Package A가 실제로 만든 스키마는 §21-2다.
**§20:** 「No unattended or scheduled collection」 canonical 문구 정정 기록. **§21:** Package A 구현·증명 기록.
**§22:** Package B (Case Intelligence + Exception UX) 구현·증명 기록.

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
| **PD-1** | v1 template의 sources · Coupang REVIEW(브라우저)를 넣을지 · 판매자가 채널을 뺄 수 있는지 | 무인 불가 source를 넣으면 ③이 영구 소음; 빼면 「고객 운영」이 쿠팡 리뷰를 맡지 않는다 | **결정됨 (2026-09-15):** Package A의 scheduled source는 **Cafe24 Inquiry · Cafe24 Review 두 official API source만**. Coupang Review / NAVER guided acquisition은 scheduled obligation에 넣지 않는다 — 무인으로 볼 수 없는 source를 매 run 「확인하지 못함」으로 만드는 것은 잘못된 제품 의미다. Scheduled Aside architecture proof는 C에서 owned/allowed surface로, marketplace 무인 브라우저는 별도 capability gate |
| **PD-2** | cadence 닫힌 집합 · 기본값 · 창 경계(KST) | R1의 key가 창이다 | **결정됨 (2026-09-15):** v1 cadence **2시간 고정** — arbitrary cron 0 · cadence picker 0 · 활성화 시 initial run 1회 · 이후 nextRunAt 기준 2시간마다 · 창 semantics 명시 고정 · 재시작이 논리 창을 바꾸지 않음 (§21-3) |
| **PD-3** | OperationsCase 물리 저장소: `proactive_case` 확장 vs 새 테이블 | 같은 책임의 두 테이블은 두 권위 | **결정됨 (2026-09-16):** 기존 `proactive_case`를 EXTEND한 backing store, 코드 개념은 `OperationsCase`. 대규모 rename·migration 없음, `uq_proactive_case_open_subject` 무변경 (§22-1) |
| **PD-4** | `PREPARE_DRAFT`를 AUTO로 둘지 · 모델 비용/일일 예산 · 고객 문장이 매 run 벤더로 나가는 폭 | 무인 run이 판매자 예산과 payload를 쓴다 (proactive는 기본 OFF였다) | **결정됨 (2026-09-16):** 자동 조사·Action/Draft 준비 허용, 자동 고객 전송 금지. 모델 호출은 rollout 허용 org × 조사가 필요한 Case만, 기존 PII sanitization·quota 재사용, 새 billing 0 (§22-0) |
| **PD-5** | Investigation 실행 위치: backend(기존 production draft path) vs agent-runtime(스케줄 run용 system principal 필요) | 후자는 **새 자격 경로 = security boundary 변경** | **결정됨 (2026-09-16):** backend 내부 Investigator. 사용자 bearer·device token·자기 HTTP API 호출 금지, run이 확정한 orgId가 권한 경계, org-scoped READ domain tools만 (§22-3) |
| **PD-6** | 예외 알림 채널(이메일/푸시/없음) | 「평소 보지 않는다」는 알림 없이는 「가끔 연다」가 된다; mailer는 현재 off | **결정됨 (2026-09-16):** EMAIL 1종, 기존 mailer, run 종료 후 요약 1통으로 coalesce·dedup, 고객 문장 0 (§22-4) |
| **PD-7** | Scheduled Aside 「owned/allowed surface」의 정의 · helper allow-list에 lease route 추가 승인 | device token 권한 확대 · 새 backend→helper 작업 채널 | Reviewnary가 호스팅하는 fixture surface(WING 모양, 실제 WING 아님) + route 1개 |
| **PD-8** | Cafe24 real write의 대상 문의(실고객 무접촉 원칙) · live 승인 · client_ip/shop_no/scope | 2026-08-25 증명 대상은 소진됨 | 판매자(운영자)가 만든 REAL 테스트 문의 1건 + 새 manifest |
| **PD-9** | canonical 문서 충돌 정리 시점: `sellerops_canonical_reference.md`「No unattended or scheduled collection」· Coupang lane「NOT APPROVED」 | C가 architecture proof를 넣는 순간 문장이 부분적으로 거짓이 된다 | **처리됨 (A, 2026-09-15 product-owner 지시):** 「Unattended browser collection is not approved by default.」의 뜻으로 좁힘, 원문 보존 — §20 |
| **PD-10** | Responsibility 대상 org scope (allow-list vs CONNECTED_SELLERS) · 수락 필수 여부 | 파일럿 운영 | **결정됨 (acceptance 한정, 2026-09-15):** acceptance 대상은 **전용 Responsibility Runtime QA org** — Demo Org 금지 · external pilot seller 금지 · 가능하면 실제 READ 가능한 Cafe24 QA connection · WRITE 0 · model 0 · unit/integration green만으로 완료 불가, 사람 trigger 없이 실제 scheduler가 연속 2회 이상 run. 파일럿 org scope(allow-list vs CONNECTED_SELLERS)는 **여전히 열려 있다** (§21-11) |
| **PD-11** | seller-facing 이름 (「고객 운영 맡기기」 등) | 화면 어휘 | **결정됨 (2026-09-15):** 「고객 운영 관리」 |

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

---

## 20. Canonical 문구 정정 기록 — 「No unattended or scheduled collection」 (2026-09-15)

**지시:** 이 표현을 inventory하고, 의도가 browser automation 제한이면 canonical wording을
**"Unattended browser collection is not approved by default."** 의 뜻으로 좁힌다. official API 기반 scheduled
ResponsibilityRun까지 금지하는 뜻으로 남기지 않는다. 기존 문장은 삭제하지 않고 무엇을 어떤 뜻으로 정정했는지 적는다.

### 20-1. Inventory

| 위치 | 원문 | 그 문장이 막던 것 — 문맥이 말하는 근거 | 조치 |
|---|---|---|---|
| `sellerops_canonical_reference.md` §4.2 | 「No unattended or scheduled collection. No seller-facing release.」 | §4의 제목이 「What NAVER v1 proved — and did not prove」이고 NAVER v1은 **Action Window(브라우저) runtime**이다; 같은 목록의 B4(cold restart 재로그인)·B5(auto-relogin)·B7(bridge pairing)이 전부 브라우저 세션 이야기다 | **좁힘** → 「Unattended browser collection is not approved by default. No seller-facing release.」, 원문과 이유를 바로 아래 이탤릭 주석으로 보존 |
| 같은 문서 §6.2 | 「Unattended / scheduled collection — supervised only.」 | §6.2 gated deferrals — 이웃 항목이 Browser Projection · auto-relogin · Device Vault · Windows/cloud managed runtime, 즉 브라우저 runtime의 연기 목록이다 | **좁힘** → 「Unattended browser collection — not approved by default; supervised only」 + 마켓플레이스에서 여는 것은 자기 capability gate, 원문 보존 |
| `multi-channel-connector-roadmap.md` 비목표 | 「모든 채널의 무인(unattended) 자동 수집. export 경로는 사람 감독을 전제로 시작한다.」 | 같은 항목의 둘째 문장이 export(브라우저) 경로를 말한다 | **좁힘** → 「무인 **브라우저·export** 자동 수집(기본값 미승인)」, 원문 보존 |
| `execution_strategy_v1.md` §0·§3·§6 | 「Unattended / scheduled BYO — NOT APPROVED」 · 「Scheduled or unattended BYO execution — NOT APPROVED」 · 「Unattended execution — NOT APPROVED」 | 전부 BYO(브라우저 executor) 절 안에 있다 | **무변경** — 이미 브라우저 실행으로 좁다 |
| `coupang_aside_operator_run_lane_v1.md` | 「unattended / scheduled — NOT APPROVED」 | 그 lane(쿠팡 WING 브라우저 읽기) 자신의 상태 | **무변경** — lane 한정 서술 |
| `review_acquisition_baseline_v1.md` | 「unattended 실행은 코드에도 정책에도 없다」 | NAVER 리뷰 착석 walk | **무변경** — 브라우저 lane 한정 |
| `sellerops_completion_checkpoint_v1.md` | 「never unattended」 | 과거 라이브 증명들에 대한 사실 | **무변경** — 역사적 사실 |

### 20-2. 정정의 뜻

1. **공식 API 정기 수집은 이 문장들이 금지한 적이 없다.** Self-Pilot Runtime v1(2026-08-18)이 이미 routine READ를
   자동으로 돌리고 있었고, 두 canonical 문장은 그 사실보다 넓게 남아 있었다. 정정은 새 허가가 아니라 **표현을 실제
   계약에 맞춘 것**이다.
2. **Responsibility Runtime의 scheduled run은 공식 API source만 연다**(PD-1). 브라우저를 열지 않고, 도우미를 부르지
   않으며, 판매자 세션을 쓰지 않는다.
3. **무인 브라우저 수집은 여전히 기본값 미승인이다.** 마켓플레이스에서 그것을 여는 일은 별도 capability gate이고,
   Package C의 Scheduled Aside는 owned/allowed surface에서의 architecture proof만 한다(§11).

---

## 21. Package A — Runtime + Observation Reliability 구현·증명 기록 (2026-09-15)

**목표:** Reviewnary가 정해진 시간에 실제로 근무했고, 각 source를 어디까지 확인했는지 신뢰할 수 있게 만든다.
**마켓플레이스 WRITE 0 · 모델 호출 0 · 무인 브라우저 실행 0 · `proactive_case` 무접촉 · Bridge device-token 권한 무변경.**

### 21-0. 결정이 설계를 바꾼 곳

| 설계(§0–§19) | Package A가 한 것 | 이유 |
|---|---|---|
| §17-A 「브라우저 source는 seller-run 관측만 채택」 | **폐기** — template source는 Cafe24 INQUIRY · REVIEW 두 개뿐 | PD-1 |
| §16-1 `responsibility.cadence` 칼럼 | **만들지 않음** — 창은 코드 상수(2시간, Asia/Seoul) | PD-2: 저장할 선택이 없다 |
| §4 Responsibility surface (최소 화면) | **API만** — `GET /api/responsibilities/customer-operations` · `POST …/activate · pause · resume · stop`. `displayName` = 「고객 운영 관리」 | 「Home UX 확장」이 이 package의 non-scope이고 acceptance가 화면을 요구하지 않는다 ⇒ 화면은 §17-B로 |
| — | **「Run Now」 없음** | 사람이 일으키는 run은 activation/resume이 여는 현재 창 하나뿐이다 |
| — | 카페24 API 계정이 하나도 없는 org의 activation은 **409** | required source 0인 책임은 매 창 FAILED만 만든다. 문구와 화면 흐름은 §17-B에서 다시 정한다 |

### 21-1. Commits

- `7057e9f9` — canonical milestone definition (설계, 구현 0)
- `a1ba4812` — Package A 구현 (V106 · `responsibility/` · 기존 코드 가산 변경 · 테스트)
- 이 문서 커밋 — §20 정정 기록 · §21 · canonical 문구 정정 3곳

### 21-2. Schema / state (V106 — 테이블 셋, 기존 테이블 변경 0)

| 테이블 | 핵심 | DB가 강제하는 것 |
|---|---|---|
| `responsibility` | org × template 하나 · `ACTIVE/PAUSED/STOPPED` · `next_run_at` · 수락자·시각 | `unique(org_id, template_code)` · `ACTIVE`가 아니면 `next_run_at is null` |
| `responsibility_run` | 논리 창 하나 · `window_start/end` · `run_trigger ACTIVATION/SCHEDULED/RESUME` · `PENDING/RUNNING/SUCCESS/PARTIAL/FAILED/CANCELLED` · `attempt` · `lease_owner/lease_until` · `next_attempt_at` · run-level `failure_reason` | **R1** `unique(responsibility_id, window_start)` · **R2** partial unique `(responsibility_id) where status='RUNNING'` · RUNNING이면 lease 필수 · retry 시각은 PARTIAL/FAILED에만 |
| `responsibility_run_source` | attempt별 관측 사실 · source · method · `recipe_version` · 창 · `cursor_from/to` · `observed_at` · `completeness` · `observed/new/changed_count` · `failure_reason` · `identity_verdict` · `sync_job_id` | `unique(run, account, data_type, attempt)` · **NONE이면 count 전부 null이고 reason 필수** · COMPLETE면 reason 없음 |

`PENDING`은 브리프의 다섯 상태에 하나를 더한 것이다: 창은 열렸는데 같은 책임의 앞선 run이 아직 RUNNING이면(R2) 줄을 서야
하고, 그 사실을 RUNNING으로 적는 것은 거짓이다. Run-level reason: `MISSED · NO_REQUIRED_SOURCE · RESPONSIBILITY_PAUSED ·
RESPONSIBILITY_STOPPED`. Source-level reason: `AUTH_REQUIRED · NOT_CONNECTED · TIMEOUT · RATE_LIMITED · CONNECTOR_UNAVAILABLE ·
CONFIGURATION_REQUIRED · EXECUTION_FAILED · INTERRUPTED · CANCELLED`(+ 브라우저 source용 `DEVICE_OFFLINE · STORE_MISMATCH ·
STORE_UNRESOLVED`, A에서는 생산자 0).

### 21-3. 창 semantics (PD-2 고정)

- 창 = **Asia/Seoul 짝수 정시에 정렬된 2시간** `[00:00,02:00) · [02:00,04:00) …` — `ResponsibilityWindows.slotStart(instant)`는
  순간의 **순수 함수**다. Asia/Seoul에는 서머타임이 없어 모든 창이 정확히 2시간이다.
- 창 W의 run은 **W가 시작할 때** due다 (창은 Reviewnary가 책임지는 시간대의 이름이고, 그 시작에 일을 시작한다).
- **활성화:** 활성화 시각이 속한 창의 run 1회(`ACTIVATION`) + `next_run_at` = 그 창의 끝.
- **재시작:** `next_run_at`은 DB에 있고 창은 시각의 함수라, 어떤 프로세스가 언제 떠도 같은 순간은 같은 창을 가리킨다.
- **놓친 창:** scheduler가 창 전체에 걸쳐 돌지 않았으면 그 창은 `CANCELLED · MISSED`로 **기록된다** — 조용히 건너뛰지도,
  늦게 「근무한 척」 채우지도 않는다. 수집은 incremental이라 다음 창의 run이 그 사이 들어온 것을 가져온다.

### 21-4. Scheduling / claim 알고리즘

`ResponsibilityScheduler`(기본 OFF, `sellerops.responsibility.scheduler-enabled`)가 30초마다 `ResponsibilityRunCoordinator.tick()`을
부른다 — 30초는 **얼마나 자주 보는가**이지 근무 주기가 아니다.

1. **Materialize** (한 트랜잭션): `status='ACTIVE' and next_run_at <= now` 책임을 `FOR UPDATE SKIP LOCKED` → 그 행을 잠근 채
   `next_run_at`부터 now까지 창마다 run이 없으면 생성(끝난 창은 MISSED) → `next_run_at`을 다음 경계로. 판매자 동작
   (activate/pause/resume/stop)도 같은 행을 `PESSIMISTIC_WRITE`로 잠그므로 pause와 창 생성은 경주하지 않는다.
2. **Claim** (run 하나당 한 트랜잭션): `PENDING` · lease 만료 `RUNNING` · retry 시각이 온 `PARTIAL/FAILED`를 창 오래된 순으로
   `FOR UPDATE SKIP LOCKED` → 책임이 ACTIVE가 아니면 은퇴 · 시작 전 창이 끝난 PENDING은 MISSED · 창이 끝난 retry는 retry 취소 ·
   같은 책임의 살아 있는 RUNNING이 있으면 건너뜀 → `RUNNING`, `attempt+1`, `lease_owner`=이 인스턴스, `lease_until`=now+180s,
   `saveAndFlush`. 두 인스턴스가 같은 책임의 서로 다른 run을 동시에 잡으면 **partial unique index가 둘째를 거절**하고 그
   트랜잭션은 아무것도 바꾸지 않는다.
3. **Execute:** heartbeat(30초)가 `lease_owner = me`일 때만 lease를 연장한다. source마다 먼저 책임이 여전히 ACTIVE인지 보고,
   관측 행을 열고(completeness null), 기존 acquisition을 돌리고, 결과를 적는다. **run과 source에 대한 모든 쓰기는 lease 소유를
   다시 확인한 뒤에만** 일어난다.

**`SyncScheduleClaimer`를 재사용하지 않은 이유:** 그 claimer는 실행 전에 claim을 커밋하고 crash 시 그 회차를 잃는다고 스스로
적는다(at-most-once). 책임 runtime에게 그것은 금지된 「조용한 skip」 그 자체다.

### 21-5. Crash / retry semantics

- **Crash:** holder가 죽으면 heartbeat가 멈추고 lease가 지나간 다음 tick이 **같은 run 행을 `attempt+1`로 회수**한다. 죽은
  attempt가 열어 둔 관측은 그 attempt가 시작한 sync job(trigger `RESPONSIBILITY` · 계정 · 타입 · 관측 시작 이후)으로 판정한다:
  끝났으면 **그 읽기를 채택**(다시 읽지 않는다), 아직 `RUNNING`이면 살아 있는 소유자가 없으므로 `SyncRunGate.failOrphan`으로 닫고
  관측을 `NONE · INTERRUPTED`로 적은 뒤 새 attempt에서 다시 관측한다. `COMPLETE/BOUNDED`로 settled된 source는 **다시 수집하지
  않는다**(R6).
- **Fencing:** lease를 잃은 holder의 renew는 0행을 갱신하고 실행을 멈춘다; `finish`도 소유 확인에서 아무것도 쓰지 않는다.
- **Retry:** `PARTIAL/FAILED`이고 settled되지 않은 source 중 하나라도 retryable(`TIMEOUT · RATE_LIMITED · EXECUTION_FAILED ·
  INTERRUPTED`)이면 `next_attempt_at` = +10분(두 번째는 +30분), 최대 3 attempt, **창이 끝나기 전일 때만**. 같은 행, settled되지
  않은 source만. `AUTH_REQUIRED · NOT_CONNECTED · CONNECTOR_UNAVAILABLE · CONFIGURATION_REQUIRED`는 창 안에서 다시 물어도 답이
  바뀌지 않으므로 retry하지 않는다.
- **Pause / stop:** 줄 선 `PENDING`은 `CANCELLED · RESPONSIBILITY_PAUSED/STOPPED`, 기다리던 retry는 취소, 실행 중인 holder는 다음
  source 전에 스스로 멈춘다. **Resume**은 현재 창의 run이 pause로 취소됐으면 **같은 run을 다시 열고**, 없으면 `RESUME` run을 만든다.
  멈춰 있던 동안의 창은 run이 아니다 — 그 시간에는 아무도 책임지지 않았다.

### 21-6. 기존 acquisition 재사용 · 소유권

| 기존 | 판정 | 무엇이 바뀌었나 |
|---|---|---|
| `SyncRunExecutor` | **WRAP** | 호출은 그대로(`execute(org, account, type, "RESPONSIBILITY")`). 반환하는 job 인스턴스에 **transient** `failureCode`·`insertedRows`를 싣는다(칼럼 0) |
| `Cafe24ApiConnector` · token refresh · board reads · `IngestionService` dedup | **KEEP** | 무변경 |
| `sync_jobs` · `sync_cursors` | **KEEP** | source 행이 `sync_job_id`를 가리키고 cursor 전후를 읽는다 |
| `SyncRunGate` | **KEEP + EXTEND** | single-flight 그대로; `failOrphan(jobId)` — lease가 증명한 죽은 소유자의 job만 닫는다 |
| `SyncScheduleRunner` | **EXTEND** | 소유된 source의 schedule을 **defer**(job 0) |
| `SelfPilotReconciler` | **KEEP** | 여전히 schedule을 만든다; 실행 여부는 소유권이 정한다 |
| `JdkCafe24HttpClient` | **EXTEND** | `HttpTimeoutException` → `ConnectorTimeoutException`(여전히 `IllegalStateException`) — 「응답이 늦었다」와 「거절했다」를 구분 |
| `proactive_case` · `agent_runs` · ActionCandidate | **무접촉** | PD-3 전; `agent_runs`는 창 unique·source 행을 표현할 수 없어 쓰지 않았다 |

**소유권 규칙 (source 하나에 주인 하나):** org의 책임이 `ACTIVE`인 동안, 그 책임의 required source(CUSTOMER_OPERATIONS_V1:
그 org의 카페24 API 계정의 INQUIRY·REVIEW) 정기 수집은 **responsibility runtime의 것**이고 `SyncScheduleRunner`는 그 schedule을
defer한다. 소유하지 않은 것 — 다른 데이터 타입(ORDER_SUMMARY·PRODUCT), 다른 채널, 책임이 PAUSED/STOPPED/없는 org — 은 기존
schedule이 그대로 수집한다. 판매자의 「지금 동기화」는 막지 않는다: 같은 single-flight gate를 지나고, 그것과 마주친 run은 **그
결과를 채택**한다(job을 기다려 읽음, 두 번째 수집 0).

### 21-7. 완결성 계약 — 구현된 규칙

| 관측 | completeness | observed | new | changed | reason |
|---|---|---|---|---|---|
| job SUCCESS | COMPLETE | 이번 읽기의 행 수 | inserted 행 | 내용이 바뀐 행 | — |
| job SUCCESS, 새것 없음 | COMPLETE | 0 | 0 | 0 | — **「확인했고 새로 없음」** |
| job PARTIAL (속도 제한·중간 오류) | PARTIAL | 이번 읽기의 행 수 | inserted | changed | RATE_LIMITED / TIMEOUT / EXECUTION_FAILED |
| job FAILED, 행은 받았으나 저장 실패 | PARTIAL | 받은 행 수 | … | … | EXECUTION_FAILED |
| job FAILED, 0행 | **NONE** | **null** | **null** | **null** | AUTH_REQUIRED / TIMEOUT / … |
| executor page guard | BOUNDED | 이번 읽기의 행 수 | … | … | — |
| 계정이 이미 재연결 필요 | NONE (호출 0) | null | null | null | AUTH_REQUIRED |
| 계정 미연결 | NONE (호출 0) | null | null | null | NOT_CONNECTED |
| 다른 trigger의 수집을 채택 | 그 job 기준 | 그 job의 행 수 | **null** | **null** | 그 job 기준 |

- **new는 `success_rows`가 아니다.** ingest는 in-place update도 success로 세므로, 새로 들어온 것은 inserted id 수로만 말한다.
  **changed**는 ingest가 내용 해시가 달라졌을 때만 update로 세는 것을 확인한 뒤에야 `success − inserted`로 쓴다(Cafe24 문의·
  community article 모두 해시 비교 후 update). 이 runtime이 직접 돌리지 않은 job은 둘 다 **null**이다 — 측정하지 않은 숫자다.
- **observed는 이번 읽기의 사실이다.** BOUNDED/PARTIAL의 observed=10은 「이 읽기에서 10」이지 「source 전체 10」이 아니다.
- `SourceObservation`의 생성자와 V106 check 제약이 같은 규칙을 **두 번** 강제한다: 잘못된 관측은 만들어지는 자리에서, 그래도
  새어 나오면 DB에서 실패한다.

### 21-8. Deterministic tests · fault injection

| 스위트 | 수 | 무엇 위에서 |
|---|---|---|
| `ResponsibilityWindowsTest` | 4 | 순수 — KST 경계 · 재시작 불변 · template source 둘 |
| `SourceObservationContractTest` | 11 | 순수 — 완결성 매핑 · NONE에 count 거절 · run outcome 규칙 |
| `ResponsibilityRuntimeTest` | 15 | H2(전용 DB) · **실제** `SyncRunExecutor`+`SyncRunGate`+ingest · Cafe24-coded scripted connector(timeout/auth/fail) · 테스트가 움직이는 clock |
| `ResponsibilityPostgresProofIT` | 5 | disposable PostgreSQL(`sellerops_rr_proof`, Flyway V106) — 두 세션의 경주 |

| 불변식 | 증명 |
|---|---|
| 같은 창 중복 run 0 | `theNextWindowRunsAtItsBoundary…andRepeatedTicksCreateNothing` · PG `concurrentTicksMaterializeEachWindowExactlyOnce`(8 스레드, 10개 놓친 창 + 열린 창 = 11행, 중복 0) |
| 활성 overlap 0 | PG `concurrentClaimsAcrossInstancesLeaveExactlyOneRunningRun`(8 인스턴스 → RUNNING 1) · `theDatabaseRefusesASecondRunningRunOfOneResponsibility` |
| concurrent claim 안전 | 위 둘 + PG `concurrentFirstActivations…`(8 스레드 → 책임 1 · initial run 1) |
| crash 후 창 silent skip 금지 | `aCrashedHolderLosesTheRunToTheNextTick…` · `aCrashAfterTheReadFinishedAdoptsThatRead…` · `windowsThatPassedWhileNothingRanAreRecordedMissed…` · PG `anExpiredLeaseMovesTheSameRun…andTheOldHolderIsFenced` |
| retry가 새 논리 작업을 만들지 않음 | `oneSourceFailingIsPartial_andTheRetryIsTheSameRun…`(행 1, attempt 2, REVIEW 재수집 0) |
| 한 source 실패 + 한 성공 → PARTIAL | 같은 테스트 · contract `runOutcomeRule` |
| 전부 실패 → FAILED | `everySourceFailingIsFailed_andAnAuthorizationFailureIsNeverAZero` |
| AUTH/timeout을 성공한 0으로 표시 금지 | 같은 테스트 · contract `authFailure…`·`timeout…` · V106 check |
| restart 후 next window 유지 | `aRestartedSchedulerKeepsTheSameNextWindow` |
| PAUSED/STOPPED는 새 run 0 | `aPausedResponsibilityCreatesNoRun…` · `pausingBeforeTheQueuedRunStartsCancelsIt…` · `aStoppedResponsibilityCreatesNoRun…` |
| 이중 수집 0 | `aCollectionAlreadyInFlightIsAdopted…` · `theCollectionSchedulerDefersSourcesAnActiveResponsibilityOwns` |

전체: backend **4,190 tests · 0 failures** (skipped 34 — Postgres-gated IT 포함) · frontend **2,991 tests / 249 files** · `tsc` clean.
**정직하게 적는다:** 첫 전체 실행은 **19 failures**였다 — 새 H2 테스트가 커밋한 CAFE24 채널·계정·수집 행이 공유 in-memory 테스트
DB로 새어 다른 스위트의 unique·count 단언을 깼다. 제품 결함이 아니라 테스트 격리 결함이었고, 그 클래스에 전용 H2 URL을 주어
닫았다(재실행 0 failures).

### 21-9. 실제 scheduled proof — 전용 QA org

**구성.** disposable DB `sellerops_rr_qa`(빈 볼륨 + Flyway 1→106) · backend jar = `a1ba4812`의 main 코드 · 포트 18080 · 제품 자신의
`POST /api/auth/signup`으로 만든 org `997b87b2…`(Demo Org 아님, 외부 파일럿 판매자 아님) · 카페24는 **제품 자신의 OAuth**
(`/api/connect/cafe24/start` → callback)로 연결 → `CONNECTED`, 봉인된 자격 1. responsibility scheduler ON, 나머지 백그라운드
생산자 기본 OFF(ownership 증명 구간에서만 self-pilot ALLOW_LIST + collection scheduler ON).

**카페24는 loopback stub이다.** `rrqa.cafe24api.com`을 backend JVM이 hosts 파일로 127.0.0.1에 풀고 stub의 self-signed 인증서를
신뢰한다 — 제품 코드 변경 0, connector · token refresh(단일 사용 회전) · board 요청 · 파싱 · ingest는 전부 제품 코드다. stub은
loopback 클라이언트만 받고, 동작(timeout·오류·새 글)을 창 사이에 파일로 바꾼다. **실제 카페24 READ가 아닌 이유:** READ 가능한
mall은 Demo Org의 것 하나뿐이고, 같은 (app, mall)에 대한 두 번째 OAuth 승인이 기존 refresh token을 살려 두는지는 이 저장소에서
증명할 수 없는 벤더 동작이며(`pilot_readiness_gate_v1.md`가 이미 product-owner 결정으로 올린 그 질문), 토큰을 두 org가 나누면 단일
사용 회전이 깨지고, 마켓플레이스 READ에는 새 단일 사용 승인이 필요하다 ⇒ **§21-11에 남긴다.**

**(a) 활성화 + 실행 중 `kill -9` (22:18–22:22 KST).**
활성화 22:18:31 → 창 22:00 `ACTIVATION PENDING`, `next_run_at` 00:00. stub이 문의 읽기를 15초 붙잡은 사이 kill 직전 상태:
run `RUNNING · attempt 1 · lease 유효`, INQUIRY 관측 `(open)`, sync job `RESPONSIBILITY · INQUIRY · RUNNING`. 22:18:59 `kill -9`.
재기동 22:19:18(새 owner). 죽은 holder의 lease 22:21:55 만료 → **22:21:59 tick이 같은 run을 회수**:

```
run      22:00 | ACTIVATION | SUCCESS | attempt 2 | started 22:18:55 | finished 22:21:59
source   attempt 1 | INQUIRY | NONE     | observed - | new - | changed - | INTERRUPTED | job 0f4a0daa
source   attempt 2 | INQUIRY | COMPLETE | observed 3 | new 3 | changed 0 |             | job 67b44725
source   attempt 2 | REVIEW  | COMPLETE | observed 4 | new 4 | changed 0 |             | job fc785db5
sync_job 0f4a0daa  RESPONSIBILITY INQUIRY FAILED  「이 수집을 맡았던 실행이 중간에 멈춰 정리되었습니다.」
duplicate checks: runs per window >1 = 0 · RUNNING now = 0 · NONE with a count = 0
```
backend ERROR 0 · WARN 0.

**(b) 소유권 — 기존 scheduler와 함께 (22:25–22:27 KST).** 재기동(self-pilot ALLOW_LIST=QA org, collection scheduler ON):
self-pilot이 schedule 셋(INQUIRY · REVIEW · ORDER_SUMMARY, 60분)을 만들었고, collection scheduler는 22:26:32에
**INQUIRY · REVIEW 둘을 `deferred: the source is owned by an active responsibility`로 넘기고(job 0)** ORDER_SUMMARY만
`SCHEDULED SUCCESS`로 수집했다. 이 재기동을 넘어 `next_run_at`은 **00:00 그대로**였다.

**(c) 사람 trigger 없는 연속 scheduled run (2026-09-16 00:00 · 02:00 KST).** 활성화 이후 run API 호출 0 · 「Run Now」 0.
창 사이에 바꾼 것은 **stub의 동작뿐**이다(QA orchestrator — backend를 호출하지 않는다): 00:00 전 새 문의 1건, 00:30에 문의
게시판 timeout(25초 보류 > 클라이언트 20초), 02:00 run이 끝난 직후 복구. 도중 23:12에 호스트 메모리 압박으로 backend가
**정상 종료**됐다가 23:13에 재기동됐다 — 실행 중인 run이 없던 때였고 `next_run_at` 00:00은 그대로였다(세 번째 재기동).

```
run   09-15 22:00 | ACTIVATION | SUCCESS | attempt 2 | 22:18:55 → 22:21:59          (a의 crash 회수)
run   09-16 00:00 | SCHEDULED  | SUCCESS | attempt 1 | 00:00:27 → 00:00:28
run   09-16 02:00 | SCHEDULED  | SUCCESS | attempt 2 | 02:00:02 → 02:10:51          (PARTIAL → 같은 run retry)

00:00  INQUIRY a1 | COMPLETE | observed 4 | new 1 | changed 0 |          | job d22ce481 (success 1 · skipped 3)
00:00  REVIEW  a1 | COMPLETE | observed 4 | new 0 | changed 0 |          | job c8ed9fa8 (skipped 4)   ← 정상 0
02:00  INQUIRY a1 | NONE     | observed - | new - | changed - | TIMEOUT  | job d6c49342 「카페24 API 호출 시간이 초과되었습니다.」
02:00  REVIEW  a1 | COMPLETE | observed 4 | new 0 | changed 0 |          | job 1bdd6ee1
       → run PARTIAL · next_attempt_at 02:10:23 (+10분, 창 안)
02:00  INQUIRY a2 | COMPLETE | observed 4 | new 0 | changed 0 |          | job 57c2941e
       → 같은 run attempt 2 SUCCESS · REVIEW는 재수집 0 (02:00 REVIEW job은 1bdd6ee1 하나)

responsibility next_run_at: 04:00 · runs per window >1: 0 · RUNNING now: 0 · NONE with a count: 0
backend(23:13 이후) ERROR 0 · WARN 2 (둘 다 HikariPool 「Retrograde clock change detected」 — 호스트 시계, runtime 무관)
```

stub 요청 기록이 같은 이야기를 한다: 00:00:28 문의·리뷰 읽기 각 1회, 02:00:02 문의 읽기가 timeout으로 보류되는 동안 02:00:22
리뷰 읽기 1회, 02:10:51 문의 읽기 1회 — **창마다 source당 한 번, retry는 실패한 source만.**

| acceptance | 결과 |
|---|---|
| CUSTOMER_OPERATIONS_V1 ACTIVE | ✅ 22:18:31부터 |
| 사람이 Run Now를 누르지 않음 | ✅ 활성화 1회 이후 run 관련 호출 0 (00:00·02:00 run의 trigger는 `SCHEDULED`) |
| scheduler가 연속 2회 이상 실행 | ✅ 00:00 · 02:00 (+ 02:10 같은 run의 retry) |
| Cafe24 Inquiry + Review source result 기록 | ✅ 창마다 두 source 행, sync job 연결 |
| duplicate run 0 · overlap 0 | ✅ runs per window >1 = 0 · 동시 RUNNING 0 |
| completeness 정직 · new=0이면 COMPLETE 0 | ✅ 00:00 REVIEW `COMPLETE · observed 4 · new 0` |
| 실패 source를 0으로 위장하지 않음 | ✅ 02:00 INQUIRY `NONE · TIMEOUT · observed/new/changed null` |
| WRITE 0 · model 0 · browser unattended 0 | ✅ stub 요청은 token·GET뿐 · 모델 capability 전부 OFF · 브라우저 source 없음 |

### 21-10. 이 package가 증명하지 않은 것

- **실제 카페24 mall에 대한 READ** — §21-9의 이유로 stub. 커넥터 경로는 제품 코드지만 벤더 응답은 아니다.
- **서로 다른 호스트의 두 backend 인스턴스** — DB 수준의 경주는 PG IT가, 프로세스 교대(kill → 재기동)는 라이브가 증명했다;
  동시에 떠 있는 두 프로세스의 scheduler는 실행하지 않았다.
- **lease보다 오래 멈췄다 깨어난 holder**(예: 3분 넘는 GC 정지)는 회수된 뒤에도 진행 중이던 source 하나를 끝까지 수집할 수 있다 —
  그 쓰기는 fencing으로 버려지지만, 그 사이 새 holder가 `failOrphan`한 sync job의 status를 옛 holder의 `finishJob`이 덮어쓸 수 있다.
  run·source 기록의 정확성에는 영향이 없고 sync job 한 행의 status만 흔들린다.
- 판매자 화면 · Case · 예외 알림 · 브라우저 source — 설계대로 B·C.

### 21-11. 남은 PRODUCT_DECISION_NEEDED · Package B 진입

| # | 결정 | 필요한 시점 |
|---|---|---|
| **NEW-A1** | 실제 카페24 READ proof를 어떤 mall·어떤 승인으로 할 것인가 (Demo Org 연결을 건드리지 않는 전용 QA mall 또는 명시적 운영 판단 + 단일 사용 manifest) | 파일럿 전 |
| **NEW-A2** | activation 전제(카페24 미연결 org 409)와 그 문구 · 「고객 운영 관리」 화면 흐름 | B |
| **PD-10 (잔여)** | 파일럿에서 책임 runtime을 켤 org 범위: allow-list vs CONNECTED_SELLERS — 지금은 판매자 수락이 유일한 게이트이고 scheduler 스위치는 배포 전역이다 | 파일럿 전 |
| PD-3 · PD-4 · PD-5 · PD-6 | Case 저장소 · 초안 자동 준비 비용/payload · 조사 실행 위치 · 예외 알림 | **B 착수 전** |
| PD-7 · PD-8 | Scheduled Aside surface · Cafe24 real write 대상 | C 착수 전 |

**Package B 진입:** runtime 쪽 전제(창 · run · source 완결성 · crash 회수 · 소유권)는 닫혔고 B가 새로 요구하는 runtime 변경은 없다.
B 착수를 막는 것은 **PD-3 · PD-4 · PD-5 · PD-6**이다. *(2026-09-16: 넷 모두 결정됨 → §22.)*

---

## 22. Package B — Case Intelligence + Exception UX 구현·증명 기록 (2026-09-16)

Baseline `3d2fad09`(Package A). 커밋 `7a30ed58`(구현) · `9cd653a5`(첫 라이브 run이 드러낸 결함 수정). 마켓플레이스 WRITE 0 ·
자동 고객 전송 0 · 브라우저 0 · Bridge 권한 확대 0.

### 22-0. 결정이 설계를 바꾼 곳 (2026-09-16 product-owner 결정)

| 결정 | 설계 제안 (§16-4 · §18) | 구현 |
|---|---|---|
| **Activation** (NEW-A2) | 409와 그 문구가 열려 있었다 | eligible(= CONNECTED 계정 위의 필수 source)이 0이면 `409 NO_ELIGIBLE_SOURCE`. 화면 문장 「고객 운영 관리를 시작하려면 Cafe24를 먼저 연결해 주세요.」 + [카페24 연결하기]. 개별 source 실패는 run PARTIAL/FAILED 그대로 |
| **Rollout** (PD-10 잔여) | allow-list vs CONNECTED_SELLERS | `RESPONSIBILITY_RUNTIME_ORG_IDS` 명시 UUID allow-list **AND** 판매자 ACTIVE. 빈 값 = 아무도 아님 · 와일드카드 없음 · 오타는 기동 거부. 목록 밖 org: 활성화 `409 RESPONSIBILITY_NOT_AVAILABLE` · 창 materialize 0 · claim 0 · Case 0 · 화면은 아무것도 그리지 않는다. generic entitlement 0 |
| **PD-3** | `proactive_case` 가산 확장 | 그대로 — §22-1 |
| **PD-4** | AUTO + quota 공유 + per-run 상한 | 조사·초안 준비 AUTO, 자동 전송 금지. 모델 호출은 rollout org × 조사가 필요한 Case만, run당 `max-per-run`(기본 5), `AgentQuotaService`에 `INVESTIGATE`로 사전 청구. 넘친 후보는 **아무것도 쓰지 않고** 다음 run의 후보로 남는다 |
| **PD-5** | backend 위치 | backend 내부 Investigator — §22-3 |
| **PD-6** | 이메일 1종 or non-goal | EMAIL 1종 · 기존 `Mailer` — §22-4 |

### 22-1. `proactive_case` 확장 (V107)

**가산 칸 14개, 전부 nullable** — `responsibility_id` · `origin_run_id` · `last_run_id` · `case_kind`
(`CUSTOMER_WORK`|`OBSERVATION_GAP`) · `required_authority`(`AUTO`|`HUMAN`) · `disposition`(`AUTO_RESOLVED`|`MONITORING`|
`NEEDS_DECISION`) · `decided_by`(`RULE`|`AGENT`) · `summary` · `recommended_action_type` · `missing_information`(JSON 배열) ·
`confidence` · `resolution_reason` · `reconciled_at` · `notified_at`. 기존 칸(`subject_*` · `signature` · `source_state` · `status` ·
`priority` · `reason` · `reason_note` · `prepared_action` · `draft_version` · `recommendation`)은 **같은 뜻으로** 재사용한다.

- **두 절반:** proactive 행은 `responsibility_id is null`, OperationsCase 행은 not null. `ProactiveCase`와 `OperationsCase`
  두 엔티티가 같은 테이블을 각자의 `@SQLRestriction`으로 읽는다 — proactive loop는 책임 행을 보지도, supersede하지도, 세지도 않는다.
  **기존 proactive 행의 의미 변화 0.**
- **check 제약:** 소유 모양(책임 행은 kind · origin run · authority 필수, proactive 행은 새 칸 전부 null) · kind↔subject
  (`OBSERVATION_GAP`은 `subject_kind='SOURCE'`만) · `AUTO_RESOLVED`는 열린 상태 불가 · gap은 disposition 없음 · 닫힌 토큰.
- **인덱스:** `uq_proactive_case_open_subject`(`where status='PREPARED'`) **무변경** → subject당 열린 카드 1개가 두 producer에 걸쳐
  DB로 보장된다. 소유 규칙: 판매자의 `CUSTOMER_OPERATIONS_V1`이 ACTIVE인 org는 proactive scheduler 대상에서 빠진다.
- **`operations_case_event`:** append-only(UPDATE/DELETE 거부 트리거). actor `SYSTEM`|`AGENT`|`SELLER`, 닫힌 kind 12종,
  provenance는 **메타데이터만**(모델 · prompt/schema/tool/evidence 버전 · 도구 이름과 인자 digest · 짧은 근거 ref · 토큰 · ms).
- **`responsibility_run`:** `notification_state`(`NONE_NEEDED`|`SENT`|`UNDELIVERABLE`|`FAILED`) · `notified_at`.
- 구현 중 발견: H2 스키마 생성에서 Hibernate가 `@Enumerated` 칸을 엔티티별 **H2 ENUM**으로 만들어 두 매핑이 서로의 토큰을 거절했다 →
  공유 enum 칸 6개를 `columnDefinition = "varchar(n)"`로 고정(Postgres는 V75 그대로 varchar, 운영 영향 0).

### 22-2. Case lifecycle · reconciliation

한 run attempt의 관측이 끝나고 **lease를 쥔 채로** `OperationsCaseProcessor.process(runId)`가 네 단계를 돈다(재시작 안전, 자기 원장 없음):

1. **Reconcile 먼저** — 열린 Case를 캐노니컬 기록에서 재도출. 문의: 채널에서 답변되어 커넥터가 work item을 닫음 →
   `CLOSED · ANSWERED_ELSEWHERE` · work item이 판매자 워크플로로 대기 phase를 벗어남 → `ACTED · SELLER_ACTED`(DISMISSED는
   `CLOSED · NOT_OPERATIONAL`) · 제외된 문의 → `NOT_OPERATIONAL` · 답변됨 → `ANSWERED_ELSEWHERE`. 리뷰: 채널 답글 →
   `ACTED · ANSWERED_ON_CHANNEL` · Case 이후 판매자 triage 결정 → `ACTED · SELLER_ACTED` · 지켜보기 14일 경과 →
   `CLOSED · MONITORING_ENDED`. **실행 상태는 만들지 않는다** — resolution 어휘에 SENT/EXECUTED/VERIFIED가 없다(테스트).
2. **Gap** — run의 source별 최신 사실 중 판매자만 고칠 수 있는 실패(`AUTH_REQUIRED`·`NOT_CONNECTED`)는 **계정당 열린 Case 1개**.
   같은 family로 다음 run에 또 실패 → 같은 Case의 `OBSERVED_AGAIN`(메일 0). 모든 source 완전 관측 → `CLOSED · OBSERVED_AGAIN`(`RECOVERED`).
   family가 바뀌면 옛 Case `SUPERSEDED` + 새 Case. 복구 뒤 재발은 새 episode(서명에 첫 run id). 일시적 실패(TIMEOUT 등)는 Case가 아니라
   ③의 source health로만 보인다.
3. **Discover** — 후보는 **책임이 그 source를 처음 끝까지 읽은 시각**(COMPLETE/BOUNDED 관측의 최소 `observed_at`) 이후 들어온 행.
   위임 전·첫 확인에 이미 있던 일은 기존 문의·리뷰 화면이 소유한다. 스캔은 수집이 다시 읽는 범위(15일) 안, run당 200행.
   **서명 = 고객 쪽 상태**(문의: 내용 digest · 상품 · 스레드 / 리뷰: 별점 · 본문 digest · 상품). **답변 상태·work phase는 서명에
   없다** — 판매자가 답한 것은 「새 signal」이 아니라 기존 Case의 reconcile이다.
   같은 서명 존재 → 쓰기 0(`UNCHANGED`). 열린 Case 있음 → **같은 Case 갱신**(`CONTEXT_UPDATED`). 없으면 새 Case.
4. **Decide** — `OperationsCaseRules`(기존 `ReviewTriageRules.tier` · 스레드 · 제외 · 답변 상태의 순수 함수):
   답변된/스레드 답글/제외 문의 · 4–5★ 리뷰 → `AUTO_RESOLVED · RULE` · 3★/무본문 저별점 → `MONITORING · RULE`.
   답변 필요 문의 · 1–2★ 본문 리뷰만 조사 대상 → 먼저 `NEEDS_DECISION · RULE`로 저장(조사 실패·crash 시에도 판매자 앞에 남는다) →
   Investigator → guard → 결론 저장. `NEEDS_DECISION + REPLY_TO_CUSTOMER` 문의는 production draft path(`proposeAs`→`generateAs`)로
   초안 준비 — **PROPOSED에서 멈추고 승인·전송 경로 도달 불가**. 근거가 없으면(`NO_ANSWER_BASIS`) 모델 0 · 초안 0 그대로.

### 22-3. Agent tool boundary

- **실행 위치:** backend 프로세스 안 `CaseInvestigator`. 사용자 bearer · helper device token · `SecurityContextHolder` ·
  자기 `/api/` 호출 · `http(s)://` 리터럴 **0**(`OperationsCaseSafetyFenceTest`가 소스로 고정).
- **권한 경계:** Case의 orgId(= run이 확정한 org). `CaseInvestigationTools.forOrg(orgId)`가 한 번 묶고 **어떤 도구도 org를
  인자로 받지 않는다**(구조 테스트). 다른 org의 subject id는 빈 결과(H2 테스트: 문의·리뷰·주문·유사 Case·과거 결정·반복 문제 전부).
- **도구 7종(READ):** `getSubject`(`redactFullBody` · 1,200자) · `getProductContext`(판매자 카탈로그명 + 상품 지식 발췌 2) ·
  `getOrderContext`(`STORED_ONLY` — 배경 run의 exact 채널 조회 0) · `searchKnowledge`(운영 기준 발췌 2) · `getRelatedIssues` ·
  `getRecentSimilarCases`(같은 상품의 최근 Case 토큰만) · `getPastSellerDecisions`(triage 결정 · 초안 작성자 분포 — **읽기만**,
  정책 writer 0). 브라우저 click/fill/navigate 0 · `requestObservation` 미구현(Package B는 새 관측을 스케줄하지 않는다).
- **payload:** 근거는 `[subject]`·`[k1]`·`[i1]` 같은 로컬 ref로만 이름 붙고 UUID·연락처·주문번호·주문 참조가 나가지 않는다
  (`CaseInvestigationPayloadFloorTest`가 직렬화 바이트로 단언). 모델이 댄 ref 중 주어지지 않은 것은 버리고, 남는 것이 없으면 실패.
- **strict schema:** `caseKind` · `disposition` · `summary` · `recommendedActionType`(8종, 각 authority) · `recommendedAction` ·
  `missingInformation` · `evidenceRefs` · `confidence` — 하나라도 빠지거나 모르는 토큰이면 조사 아님.
- **guard(`CaseDecisionGuard`):** 사람 권한 제안(고객 답변·연락·환불/보상·취소/교환·지식 추가·상세 점검) · LOW confidence ·
  답을 기다리는 문의 → `NEEDS_DECISION`으로만 이동. `AUTO_RESOLVED`는 `NO_ACTION`만. 완료 주장 문장(「보냈습니다」·「환불했습니다」…)은
  화면에 도달하지 않는다. **어떤 규칙도 판매자 쪽에서 멀어지게 하지 못한다.**
- **capability:** `sellerops.responsibility.investigation.*` — 11번째 LLM capability. 자기 flag · key · org list · door
  (`AgentDraftBoundaryTest` 표 행) · 기본 OFF · `admitsPolicyWidening=false` · `AgentQuotaService`에 `INVESTIGATE` 사전 청구 ·
  run당 상한. provenance에 model · prompt/schema/tool/evidence 버전 · 도구 호출 · usage를 남긴다.

### 22-4. Notification

`OperationsCaseNotifier.afterFinish(run)` — run 상태 확정 뒤 한 번. 대상은 **아직 메일에 포함된 적 없는** 열린 `NEEDS_DECISION`
고객 Case와 열린 gap. 없으면 `NONE_NEEDED`. 수신자는 책임을 활성화한 사용자(같은 org). `Mailer`가 전달 불가면 `UNDELIVERABLE`이고
Case는 미표시로 남아 다음 요약에 포함된다. 보내기 **전에** run에 `SENT`를 기록(발송 후 crash가 두 번째 메일을 만들지 않게), 발송 뒤 Case마다
`notified_at` + `NOTIFIED` event. 본문은 **개수와 채널 이름**뿐(`ExceptionSummaryMail`, 소스 스캔으로 case text getter 0). 실제 provider
발송은 이 저장소의 SMTP mode이고 새 provider 0 — QA는 dev-outbox sink로 증명했다.

### 22-5. 실제 scheduled run — 전용 QA org (04:00 – 12:00 KST, 사람 trigger 0)

**구성:** Package A의 QA org `997b87b2…`(Demo Org 아님 · 외부 판매자 아님 · Demo Org OAuth 무접촉) · loopback 카페24 stub ·
`RESPONSIBILITY_RUNTIME_ORG_IDS` = QA org 하나 · investigation·draft capability = QA org, `gpt-5-2025-08-07` effort low ·
mail `dev-outbox` · 합성 운영 기준 2건(배송 · 파손/교환). 고객 문장은 전부 `(QA 합성 …)` 표기를 단 합성 데이터. 사람의 trigger 0 —
창은 실제 scheduler가 연다.

| 창 (KST) | 관측 | Case | 모델 | 메일 |
|---|---|---|---|---|
| **09-16 04:00** SCHEDULED SUCCESS | 문의 COMPLETE 6 · 신규 2 / 리뷰 COMPLETE 7 · 신규 3 | 새 6: 규칙 3(이미 답변된 문의 `AUTO_RESOLVED` · 5★ `AUTO_RESOLVED` · 3★ `MONITORING`) + 조사 대상 3 | 3회 시도 → 전부 `INVESTIGATION_FAILED · transport`(0–1ms) → 3건 모두 `NEEDS_DECISION · RULE`로 판매자 앞에 남음 | 1통 「확인할 일 3건」 |
| **09-16 06:00** SCHEDULED SUCCESS | 문의 COMPLETE 7 · 신규 1 / 리뷰 COMPLETE 9 · 신규 2 | **변화 없음 6(쓰기 0)** · 새 3 · 재확인 1(채널에서 답변된 파손 문의 종료) | **실제 3회 `CONCLUDED`**: 10,270 / 7,203 / 10,917ms · prompt 633 / 650 / 627 · completion 769 / 596 / 835(reasoning 512 / 448 / 448) · guard 발동 0 · 전부 `NEEDS_DECISION`·`REPLY_TO_CUSTOMER`(HIGH/HIGH/MEDIUM) | 1통 「확인할 일 3건」(새 3건만 — 04:00의 3건은 이미 메일에 포함) |
| **09-16 08:00** SCHEDULED **FAILED** | 두 source 모두 `NONE · AUTH_REQUIRED` · **관측/신규 수 전부 null** | 기존 9건 변화 없음(쓰기 0) · **`OBSERVATION_GAP` 1건** 열림 | 0 (관측이 없으면 조사할 signal도 없다) | 1통 — 「제대로 확인하지 못한 곳이 있습니다 / 카페24 자사몰은 연결이 만료되어 문의·리뷰를 확인하지 못했습니다」(**결정 건수 주장 없음**) |
| **09-16 10:00** SCHEDULED **FAILED** | 같은 실패 | **같은 gap Case**(`OBSERVED_AGAIN`) · 새 Case 0 · 변화 없음 9 | 0 | **0통** (`NONE_NEEDED` — 같은 장애는 두 번 알리지 않는다) |
| **09-16 12:00** SCHEDULED SUCCESS *(판매자가 제품 OAuth로 재연결한 뒤)* | 문의 COMPLETE 8 · 신규 1 / 리뷰 COMPLETE 10 · 신규 1 | gap **복구 종료**(`CLOSED · OBSERVED_AGAIN`) · 새 2 · 변화 없음 9 | 실제 2회 `CONCLUDED`(prompt **v2**): 16,701 / 14,909ms · prompt 803 / 725 · completion 828 / 652(reasoning 640 / 448) · guard 0 · 근거 ref에 판매자 운영 기준(`k1`) 포함 | 1통 「확인할 일 2건」 |

- **04:00 transport 실패는 제품이 아니라 QA 하네스였다:** stub을 가리키려고 준 `-Djdk.net.hosts.file`은 파일에 없는 호스트를
  시스템 DNS로 넘기지 않고, `-Djavax.net.ssl.trustStore`는 JDK CA를 대체했다 → 벤더에 닿을 수 없었다(`ConnectException` 재현).
  JDK cacerts + stub 인증서의 truststore와 벤더 주소를 넣은 hosts 파일로 바꾸자 같은 probe가 `HTTP 401`(키 없음 = 도달). **그 실패가
  보여준 것:** 조사가 실패해도 Case는 판매자에게 남고(`RULE` fallback) 메일에 포함되며, 이미 청구된 quota 3건이 원장에 기록된다.
- **06:00 초안:** 교환 문의는 `REPLY_TO_CUSTOMER` 결론 뒤 draft path를 탔고 `NO_PRODUCT`로 composer가 **쓰지 않았다**
  (`DRAFT_NOT_PREPARED · NO_DRAFT` — 근거 없는 초안 0 규칙, 모델 0). work item은 제안 기록으로 `PROPOSED`. 리뷰는 초안 경로가 없다.
  → 라이브에서 **초안이 실제로 준비된 run은 아직 없다**(합성 문의가 상품에 묶이지 않음). 준비된 경로는 H2 테스트가 증명한다.
- **비용(추정):** 06:00의 3회 합계 prompt 1,910 · completion 2,200 토큰. 벤더 공시 단가(입력 $1.25/1M · 출력 $10/1M — 저장소가 검증할 수
  없는 외부 사실)로 ≈ **$0.024, Case당 ≈ $0.008**. 지연은 Case당 7–11초로 run 길이에 더해진다(lease heartbeat가 흡수).
- **장애 Case의 생애(실측):** `OPENED`(08:00) → `NOTIFIED`(08:00) → `OBSERVED_AGAIN`(10:01) → `RECOVERED`(12:03), 그리고
  `CLOSED · OBSERVED_AGAIN`. **두 번 열리지 않았고 두 번 알리지 않았다.** 복구는 판매자가 제품의 OAuth 흐름으로 다시 연결한 뒤
  (start 200 → callback 302 `connected` → 계정 `CONNECTED`) **완전한 재관측**이 한 것이지, 계정 상태를 보고 추정한 것이 아니다.
- **초안:** 12:00의 배송 문의는 `REPLY_TO_CUSTOMER` 결론 뒤 production draft path에서 **초안 v1이 실제로 준비**됐고
  (`DRAFT_PREPARED` · `evidence_state = GROUNDED` — 판매자가 등록한 배송 기준이 근거), work item은 `PROPOSED`에서 멈춘다.
  승인·전송은 그대로 판매자의 것이고 이 run이 보낸 고객 메시지는 **0**이다. 06:00의 교환 문의는 상품이 없어 composer가 쓰지 않았다
  (`NO_DRAFT · NO_PRODUCT`, 모델 0) — 근거 없는 초안 0 규칙 그대로.
- **prompt v2 결과(같은 라이브 환경):** 권장 조치 길이 **59자 · 60자**, 근거에 없는 사용법·플랫폼 기능·약속 **0**, 문장 중간 잘림 **0**.
  모르는 것은 전부 `missingInformation`으로 갔다(주문번호 · 결제 일시 · 부착 환경 · 사진 …). v1의 같은 자리에는 부착 요령과 약속이 있었다.
- **rule vs Agent (전체):** Case 11 — 규칙 결론 3 · 조사 대상 8(실제 결론 **5**, 하네스 실패 3) · 변화 없는 signal(창별 6·9·9·9)에 **모델 0**.
  모델 호출 8회 전부 `INVESTIGATE`로 판매자 일일 예산 원장에 기록(+ 초안 `DRAFT` 1회).
- **비용(추정, 실측 토큰 기반):** 결론 5회 합계 prompt 3,438 · completion 3,680 토큰 → 벤더 공시 단가(입력 $1.25/1M · 출력 $10/1M,
  저장소가 검증할 수 없는 외부 사실)로 ≈ **$0.041**, 조사 1건 ≈ **$0.008**. 지연은 Case당 7–17초.
- 중복 검사(모든 창): subject당 열린 Case >1 **0** · (subject, 서명) 중복 **0** · QA org의 proactive 행 **0** · backend ERROR **0** ·
  마켓플레이스 WRITE **0** · 고객 메시지 전송 **0**.

### 22-6. 첫 라이브 run이 드러낸 결함 (`9cd653a5`에서 수정)

1. **근거에 없는 권장 내용.** v1 prompt의 결론 둘이 근거 목록에 없는 상품 부착 요령(「30초 이상 압착·24시간 고정」)·플랫폼 기능
   (「리뷰 수정 메뉴에서 변경」)·약속(「재발 방지 노력도 약속」)을 권했다. guard는 권한을 지키지만 문장의 근거는 보지 않는다 →
   prompt **v2**: 권장 조치는 판매자의 다음 한 걸음(120자)이고 근거 없는 사용법·기능·일정·보상 조건과 고객에게 하는 약속을 권하지
   않으며 빠진 사실은 `missingInformation`으로. 과도하게 긴 권장 조치는 240자 안에서 **문장 경계**로 자른다(300자에서 문장 중간이
   잘린 「교체·후속 조치 가능 」이 실제로 저장됐다).
2. **채널에서 답변된 문의가 `SELLER_ACTED`로 기록됐다.** 커넥터의 answered-elsewhere 경로가 work item을 COMPLETED로 닫았고
   reconciler가 phase를 이유보다 먼저 읽었다 → 커넥터 audit(actor `SYSTEM:CONNECTOR_INGEST` · phaseTo COMPLETED)로 가르고,
   그 표식이 writer와 어긋나지 않게 fence 테스트로 고정. 화면에는 영향이 없었다(열린 Case가 아니므로) — 기록의 정직성 문제다.
   **이미 닫힌 행은 고치지 않았다**(`6c616dec`는 지금도 `SELLER_ACTED`로 남아 있다): 지나간 판단을 소급해 다시 쓰는 것은 이 기록이
   하지 않기로 한 일이고, 규칙은 다음 reconcile부터 적용된다.
3. (하네스) 위 22-5의 transport.

### 22-7. DB 보장 — 실제 Postgres (QA DB, 롤백 트랜잭션)

같은 subject에 proactive 카드(`responsibility_id null`)를 여는 insert → `uq_proactive_case_open_subject` 위반 · 소유 모양이 빠진
책임 행 → `ck_proactive_case_owner_shape` 위반 · `AUTO_RESOLVED` 행을 다시 열기 → `ck_proactive_case_auto_resolved_closed` 위반 ·
`operations_case_event` UPDATE·DELETE → 「append-only」 거부. 롤백 후 행 수 불변(9 / 23). V107은 실제 Postgres에 Flyway로 적용(0.1초).

### 22-8. Exception UX

Home(`/`)은 기존 Operations Home을 **확장**한다 — 대화 위, 기존 네 영역 앞에 「고객 운영 관리 · 운영 중」 한 줄(확인 주기 · 마지막 확인 ·
다음 확인)과 세 영역: **① 내 결정 필요** · **② Reviewnary가 정리하거나 준비한 일**(접힘) · **③ Reviewnary가 제대로 확인하지 못한 곳**
(다시 연결할 계정 + 지난 확인의 source별 사실). `/customer-operations`는 surface 카드(설명 · 확인 주기/마지막/다음 · 확인 대상 ·
제가 하는 일 · 내 확인이 필요한 일 · 시작/일시정지/다시 시작/중지(확인 후)) + 같은 세 영역 + 최근 확인 기록. 모든 문장은
`lib/customerOperations.ts` 한 곳이고 네 불변식을 테스트가 고정한다 — observed ≠ processed · prepared ≠ executed(초안은 늘
「아직 보내지 않았습니다」와 함께) · 0건 ≠ 확인하지 못함(NONE은 숫자를 찍지 않는다) · PARTIAL ≠ 정상. 읽기 실패 · rollout 밖 ·
카페24 미연결은 Home에 **아무것도 그리지 않는다**. 브라우저 QA(실제 QA org · 1440/1366/1152 · `/`와 `/customer-operations` ·
`<details>` 전부 연 뒤): axe(WCAG 2 A/AA) 위반 **0** · 가로 스크롤 **0** · off-host 요청 **0** · 04:00 데이터에서 「처리했습니다·
보냈습니다·정상·0건 관측」 **0**. 콘솔 오류는 이 QA 스택에서 꺼 둔 agent-runtime(8787)과 기존 `home-opened` 403뿐 — 이 패키지가 만든 것은 없다.
브라우저 pass는 **세 번**(첫 데이터 전 · 장애가 열려 있는 동안 · 복구 뒤) 돌렸고 세 번 모두 같은 결과다. 장애 중 화면은
「다시 연결해야 확인할 수 있는 곳이 1곳 있습니다」 + 계정 행 + [다시 연결하기] + 「Cafe24 문의 — 확인하지 못했습니다 · 연결이
만료되어 다시 연결이 필요합니다」를 그렸고 **어디에도 0건이 없었다**; 복구 뒤 같은 자리는 다시 「지난 확인에서 모든 대상을 끝까지
확인했습니다」와 읽은 건수가 된다.

### 22-9. 이 package가 증명하지 않은 것 · 남은 결정

- **실제 카페24 mall READ는 여전히 stub이다**(NEW-A1, §21-10과 같은 이유). 커넥터·ingest·초안·조사는 제품 코드이고 벤더 응답만 합성이다.
- **초안이 승인·전송까지 가는 경로는 이 package에서 실행되지 않았다** — 설계대로 PROPOSED에서 멈춘다(Package C · PD-8).
- **리뷰 답변 초안은 없다** — 증명된 리뷰 답글 WRITE adapter가 없어 리뷰 Case는 `RECOMMENDATION_ONLY`가 천장이다.
- **모델이 쓴 문장은 결정론이 아니다.** guard·payload floor·스키마는 코드의 성질이지만, 같은 Case를 다시 조사하면 다른 문장이 나온다.
  v2가 막는 것은 「근거에 없는 내용을 권하는 모양」이고, 그 검사는 prompt 규칙 + 라이브 재확인이지 단위 테스트가 아니다.
- **한 org·한 채널·두 source**에서만 돌았다. 여러 계정·여러 채널이 한 책임에 붙었을 때의 gap 묶음(계정당 1건)은 단위 테스트만 있다.
- **운영 중 실패 알림의 실제 provider 발송**은 dev-outbox sink로만 증명했다(SMTP mode는 기존 경로, 자격은 배포 결정).
- 남은 PRODUCT_DECISION_NEEDED: **NEW-A1**(실제 mall READ 승인) · **PD-7**(Scheduled Aside surface) · **PD-8**(Cafe24 real write 대상) ·
  **PD-10 잔여**(파일럿에서 어느 org까지 rollout 목록에 넣을지 — 이제 목록은 명시 UUID이고 그 목록을 누가 채우는가가 운영 결정이다) ·
  **신규**: 조사 모델·effort(현재 `gpt-5-2025-08-07`/low, Case당 7–17초)와 판매자 일일 예산에 조사를 청구할지(현재 청구한다).
- **Package C 진입:** B가 남긴 runtime·Case·권한 경계는 닫혔다. C를 막는 것은 **PD-7 · PD-8**이다.

## 23. Scheduled Aside — 실제 브라우저 3-run LIVE (2026-09-16)

§11의 architecture proof와 failure contract는 이미 라이브였고, 남아 있던 것은 **실제 브라우저가 실제로 화면을 읽는 3-run**
하나였다. 이 절이 그것을 기록한다.

**자세(posture).** worktree `decision-workspace` `90e62627` · 일회용 DB **`sellerops_aside_live`** · backend 8090 ·
helper는 `--bridge-only`로 포트 **47620** · helper home은 scratchpad(설치된 launchd 도우미 `ai.sellerops.local-agent`는
**무접촉**) · device token은 V97 경로로 이미 연결돼 있던 그 행 · Aside CLI 1.26.906.1630 · 계정 **u0 / Profile 0**.
dev `sellerops`는 전후 **90 tables · migration 105 · `scheduled_aside_job` 없음**으로 확인했다.

**사람이 한 일은 정확히 하나** — Aside 프로필 u0에 **브라우저 창 하나를 열어 둔 것**(운영자 초기 setup으로 인정된 행위;
CLI에는 창을 만드는 명령이 없고 앱은 `--no-startup-window`로 떠 있었다). 그 뒤 run trigger·버튼·키 입력 **0**.

**한 sitting에 세 창(window)을 만들 수 없다는 제약을 어떻게 다뤘는가.** `uq_responsibility_run_window`는 책임당 한 창에 run
하나이고 창은 2시간 고정이므로, 세 번의 관측은 원래 6시간에 걸쳐서만 일어난다 ⇒ **일회용 DB에 run row만** 직접 넣었다
(2026-09-17 KST 00:00 · 02:00 · 04:00 · 06:00 · 08:00, `PENDING` · `SCHEDULED`). 대체한 것은 **materialize 한 단계뿐**이고
claim → lease → 채널 source → device source → job enqueue → helper claim → Aside repl → report → settle → 관측 기록은 전부
제품 코드가 했다. 실제 판매자 DB에는 아무것도 넣지 않았다.

| # | window (KST) | dataset | completeness | observed | new | changed | digest |
|---|---|---|---|---|---|---|---|
| Run 1 | 00:00 | `initial` | COMPLETE | **3** | **3** | 3 | `b231749081754a71` |
| Run 2 | 02:00 | `unchanged` | COMPLETE | **3** | **0** | **0** | `b231749081754a71` (동일) |
| Run 3 | 04:00 | `changed` | COMPLETE | **4** | **1** | **1** | `158ecb2229f42b46` |
| 장애 | 06:00 | (helper 종료) | **NONE** | **null** | **null** | **null** | — (`DEVICE_OFFLINE`) |
| 복구 | 08:00 | `changed` | COMPLETE | 4 | 0 | 0 | `158ecb2229f42b46` |

Run 1의 `changed=3`은 이전 관측이 아예 없는 상태(prior `NONE`)에서의 값이고, 「정확히 한 건이 바뀌었다」를 말하는 것은 **Run 3**이다
(`co-0004` 한 줄이 늘었고 new·changed 모두 1). 모든 행의 `method`는 **`BRIDGE_ASIDE`**, `recipe_version`은
**`CUSTOMER_OPERATIONS_FIXTURE_OBSERVE_V1`**이다.

**장애와 복구.** helper를 내리고 다음 run을 넣으면 job은 enqueue되지만 아무도 가져가지 않고, 120초 bounded wait 뒤 관측은
**`NONE` + count 3개 전부 null + `DEVICE_OFFLINE`**로 기록됐다 — 이 lane이 존재하는 이유인 「확인하지 못함 ≠ 0건」이 라이브에서
한 번 더 성립했다. helper를 다시 올린 뒤 다음 관측은 곧바로 `COMPLETE`로 돌아왔다.

**정직 보고 둘.** (1) 장애 leg에서 `QUEUED`로 남아 있던 job은 helper가 복구되자 그 helper가 집어 `OBSERVED 4`로 settle했다 —
**run의 관측은 소급해 바뀌지 않는다**(그 source row는 지금도 `NONE`/`DEVICE_OFFLINE`이다). 다만 `enqueue`가 「한 device에 live work
하나」를 강제하므로, 복구 뒤 그 stale job을 먼저 비운 다음 복구 run을 넣었다. (2) run 자체의 status는 `PARTIAL`(장애 leg는 `FAILED`)
인데, 이 QA org의 카페24 채널 source가 여전히 stub(`CONNECTOR_UNAVAILABLE`)이기 때문이다 — device source는 `required` 밖이므로
run을 실패시키지 않고, 반대로 device 관측이 성공했다고 run이 SUCCESS가 되지도 않는다.

**계수.** 마켓플레이스 호출 **0** · WRITE **0** · 모델 호출 **0** · 마이그레이션 **0** · backend ERROR 로그 **0** ·
코드 변경 **0**(이 절의 문서 기록 외). 열린 surface는 `http://127.0.0.1:47620/fixture/customer-operations` 하나뿐이고,
`?dataset=marketplace`는 라이브에서 **404**로 거절됐다.

---

## 24. Scheduled Aside — 실제 NAVER Seller Center 리뷰 무인 관측 (experimental/QA rollout, 2026-09-17)

**자세.** PD-1은 **그대로다** — `CUSTOMER_OPERATIONS_V1`의 scheduled obligation(`sources()`)은 여전히 Cafe24 Inquiry · Cafe24 Review
두 official API source뿐이다. NAVER 리뷰는 obligation이 아니라 **device recipe**(`deviceRecipes()`)로 그 옆에 선다: run을
실패시키지도, 「확인하지 못함」을 판매자 obligation으로 보고하지도, retry를 강제하지도 않는다. 켜려면 배포가 **조직과 판매 계정을 둘 다
이름으로** 적어야 한다(`sellerops.responsibility.aside.marketplace.{enabled,enabled-org-ids,enabled-account-ids}`, 기본 OFF ·
와일드카드 없음 · 오타는 기동 실패). 즉 이것은 **명시적 experimental/QA rollout capability**이지 seller-facing scope 변경이 아니다.

### 24-1. READ-ONLY discovery가 먼저 확정한 것 (추측 selector 0)

운영자가 로그인해 둔 Aside u0에서 `https://sell.smartstore.naver.com/#/review/search`만 열고 닫았다. 클릭·입력·스크롤·다운로드 0,
고객 문장은 페이지 밖으로 나오지 않았다(구조·개수·shape만).

| 사실 | 관측 |
|---|---|
| route · 로그인 | host `sell.smartstore.naver.com`, hash `#/review/search`, password input 0, 로그아웃 표시 존재 |
| 목록 구조 | ag-Grid, **row model type `infinite`**, 기본 기간(7일) **52행 전부 loaded · missing 0 · 1 page(pageSize 500)**. DOM에는 ~15행만(가상 그리드 재활용) ⇒ 스크롤 없이 **model**을 읽는다 |
| **stable source id** | row model의 `id`(10자리) = 그 행 상세 링크 `openReviewDetailModal(<id>)`의 id — **렌더된 15/15행 일치**. 이 id가 가이드 답글 lane이 2026-09-03·09-05 라이브에서 export 리뷰글번호와 대조해 행을 찾은 바로 그 id다. DOM `row-id`는 grid index("0".."14")라 **쓰지 않는다** |
| 필드 | `reviewScore` · `reviewContent` · `createDate`(ISO+offset) · `productNo`(채널상품번호) · `productName` · `hasComment`(답글 여부) · `reviewAttaches`(미디어). **같은 row model에 `maskedWriterId` · `writerIdNo` · `productOrderNo`가 있고 한 번도 읽어내지 않는다** |
| store fence | 화면의 채널상품번호 **11/11이 이 org의 NAVER catalogue**(official API로 이 계정 자격이 수집)에 있고 **다른 org에는 0**; org의 NAVER API 계정 정확히 1개. 채널상품번호는 NAVER 전역 유일 |
| cross-acquisition identity | 화면 id 범위 `5062084137…5066448224`(09-10~09-17), 저장된 export id `4745070536…5055683531`(~09-02) — **같은 단조 증가 수열의 연속**이지만 **겹치는 리뷰는 관측되지 않았다** ⇒ `LIVE_PROOF_PENDING`(아래 24-6) |
| 네트워크 | 목록은 `/api/v3/contents/reviews/search`로 채워진다(performance entry로 경로만 확인). Aside repl에서 `page.on('response')`는 발화하지 않았고, 우리가 그 endpoint를 직접 호출하지도 않았다 |

### 24-2. 구현 (재사용 우선)

- **backend**: `AsideRecipe.NAVER_REVIEW_OBSERVE_V1("NAVER", REVIEW)` + V109(recipe CHECK 확장, job에 `inserted_count` ·
  `changed_count` · `identity_verdict` — 전달 count는 **store가 증명된 경우에만** 존재할 수 있다는 CHECK 포함) ·
  `NaverReviewObservationService`(`AsideMarketplaceTarget` 구현 + 전달) · `POST /api/helper-devices/jobs/{jobId}/naver-reviews`
  (이미 device-token allow-list인 job prefix 아래 — **allow-list 확대 0**, device와 org는 토큰에서, **claim 1개에 전달 1회**) ·
  `AsideSourceObserver`가 marketplace recipe를 **`BOUNDED`**로, new/changed를 **ingest가 job에 기록한 값**으로(digest 추정 아님),
  실패를 `AUTH_REQUIRED` / `STORE_UNRESOLVED`·`STORE_MISMATCH`로 이름 붙여 기록(count null) · `OperationsCaseProcessor`가 device review
  source도 **같은 규칙**(첫 settled read가 hand-over 경계)으로 discovery.
- **canonical ingest**: 새 경로 없음 — `IngestionService.ingestReviews`에 `externalId = 리뷰글번호`, `ChannelProductRef = 채널상품번호`,
  SKU는 **이 DB의 listing → product에서 읽은 값**(find-only), `replyState`는 `hasComment`, `mediaCountObserved = true`. 모든 행이
  이해되지 않으면 **전체 거절**. store 판정: 모든 채널상품번호가 우리 것 ⇒ `MATCH` · 하나라도 **다른 org** 것 ⇒ `MISMATCH` · 아무도
  모르는 번호(catalogue lag)나 **빈 페이지** ⇒ `UNRESOLVED` — MATCH가 아니면 **ingest 0**.
- **helper**: `src/naver/review-list-observe-inpage.ts`(page script, 8개 필드만 명시적으로 복사 · 매 run id↔상세링크 재대조 · 미로드 노드
  있으면 거절) · `naver-review-workflow.ts`(route를 파싱 후 **정확히 한 URL**과 동일해야 통과) · `naver-review-runtime.ts`(**운영자
  단일 파일 승인 2026-09-17**: 탭 열기 → grid 로드 대기 → 행 READ → 기간 census → 탭 닫기) · `naver-review-observe-runner.ts`
  (기간이 **오늘로 끝나고** 모든 행이 기간 안일 때만 전달) · dispatch는 기존 unattended loop, `REVIEWNARY_EXECUTION_PROVIDER=ASIDE`
  per-machine opt-in 재사용. 기간 census는 가이드 답글 lane의 live-proven `inPageReviewListRange` 재사용.
- **guard**: `aside-guard.test.ts`의 evaluate forwarder 예외를 **목록**으로 바꾸고 새 runtime을 넣었다 — 「forwarder는 page code를
  작성하지 못한다」 4개 단언이 **두 forwarder 모두**에 적용되고, 금지 토큰에 `.type(` · `setInputFiles` · `waitForEvent`를 더했다.

### 24-3. 라이브 proof (일회용 DB, 실제 로그인된 Aside u0, run trigger·클릭 0)

**환경.** worktree `decision-workspace`, 일회용 DB **`sellerops_nv_live`**(dev `sellerops` 무접촉 — 끝난 뒤 migration 105 · 90 tables
재확인), backend 8091(커넥터 전부 OFF · 모델 capability 전부 OFF · marketplace gate가 Demo Org와 NAVER 계정 `bdccb7a7`만 명시),
helper `--bridge-only` 47621(scratchpad helper home · scratch device token; 설치된 launchd 도우미 무접촉). 일회용 DB에는 Demo Org 1행 ·
사용자 1행 · NAVER/Cafe24 계정 행 · NAVER listing 77 + product 77만 복사했고 **리뷰는 복사하지 않았다**.

**「scheduled」의 정확한 의미.** Scheduler/Run 경로(tick → claim → lease → sources → device job → retry)는 §21·§23에서 이미
LIVE_PROVEN이다. 여기서는 NAVER browser observation leg를 **일회용 DB에 넣은 run row**(PENDING·SCHEDULED)로 반복 검증했다 —
대체한 것은 materialize 한 단계뿐이고 **2시간 scheduler가 여섯 번 실제로 돈 것이 아니다.** 단, 장애 창의 attempt 2는 **제품의 retry가
스스로** 수행했다(아래).

| leg | 결과 | observed | new | changed | identity | 비고 |
|---|---|---|---|---|---|---|
| **Run A** | `BOUNDED` | **52** | **52** | 0 | MATCH | reviews 52 · distinct external_id 52 · **product 연결 52/52** · provenance(sync job) 52/52 · `data_origin=REAL` · Case **0**(hand-over 경계) |
| **Run B** (동일 상태) | `BOUNDED` | **52** | **0** | **0** | MATCH | ingest `0 inserted / 52 skipped` · 중복 external_id **0** · Case **0** |
| **장애** (helper 종료) | **`NONE`** | **null** | **null** | **null** | — | `DEVICE_OFFLINE`, job `QUEUED`로 남음 |
| 장애 창 **attempt 2** (제품 retry, 10분 뒤) | `BOUNDED` | 52 | 0 | 0 | MATCH | helper 복구 후 stale job이 claim·전달·settle됐고, retry가 **같은 clientJobId로 그 job을 다시 찾아** 기록. attempt 1 행은 `NONE` 그대로 |
| **복구 run** | `BOUNDED` | 52 | 0 | 0 | MATCH | `cursor_from = cursor_to`(직전 관측과 digest 동일) |
| **Run C** | `BOUNDED` | 52 | 0 | 0 | MATCH | 실제 새 리뷰가 아직 없음 ⇒ **exact NEW 1 = `LIVE_PROOF_PENDING`** |

모든 device 행 `method=BRIDGE_ASIDE` · `recipe_version=NAVER_REVIEW_OBSERVE_V1`. 도우미 로그 6건 모두
`{"windowDays":7,"identity":"MATCH","llmCalls":0}`, 1회 4.0–5.4초. backend ERROR 0.

**라이브가 찾아 같은 sitting에서 닫은 결함 둘.** (1) 첫 Run A에서 52건이 **전부 product 미연결**로 저장됐다 — declaring row는 호출자가
준 SKU로만 연결되는데 SKU를 넘기지 않았다(listing 77건은 전부 있었다). listing → product → SKU find-only 조회를 넣고, 일회용 DB의 run
산출물만 지운 뒤 Run A를 재실행해 **52/52 연결**. (2) Run B의 `cursor_from`이 비었다 — device baseline 쿼리가 `COMPLETE`만 settled로
봤는데 marketplace read는 설계상 `BOUNDED`다. `BOUNDED` 포함으로 고친 뒤 복구·Run C에서 prior digest가 실린다.

### 24-4. 무엇이 Case / Agent / Draft까지 갔나

Run A가 저장한 52건은 **첫 settled read 이전부터 있던 것**(hand-over 경계)이라 Case 0이 정답이고, 이후 새 리뷰가 오지 않아
**라이브 Case 0 · Agent 호출 0 · draft 0**이다. device review source의 discovery 규칙(경계 이전 0 · 경계 이후 1 · 불변 재실행 0 · lane 없는
배포 0)은 `OperationsCaseProcessorTest.reviewsABrowserReadBroughtInBecomeCasesByTheSameRule_andOnlyAfterItsFirstSettledRead`가 고정한다.
NAVER 리뷰 답글은 공식 API가 없고 guided composer fill(`COMPOSER_FILLED ≠ posted`)뿐이므로 이 lane의 천장은 `RECOMMENDATION_ONLY`이다.

### 24-5. 안전 계수

marketplace WRITE **0** · click/type/fill/scroll/download/export **0** · password/MFA/CAPTCHA 처리 **0** · 임의 URL **0**(route는 파싱 후
정확 일치) · 모델 호출 **0** · 판매자 dev DB 변경 **0** · 설치된 도우미 변경 **0** · 추가 permission 확대 **0**(운영자 단일 파일 승인만).
READ-ONLY discovery 탭 열기 ~11회 + 무인 관측 6회(첫 결함 run 포함), 전부 같은 route.

### 24-6. 남은 것 (정직하게)

| 항목 | 상태 | 이유 |
|---|---|---|
| NAVER Review Browser Acquisition (실제 READ + 반복 dedup) | **LIVE_PROVEN** | Run A/B |
| NAVER Review Responsibility Slice (BRIDGE_ASIDE 반복 관측 · 장애 NONE · 복구 · retry) | **LIVE_PROVEN** (experimental/QA rollout, 일회용 DB run row) | 위 표 |
| exact NEW 1 → Case → Agent | **LIVE_PROOF_PENDING** | 관측 동안 실제 새 리뷰 없음. 합성 리뷰를 만들지 않았다 |
| AUTH_REQUIRED 라이브 → 재로그인 복구 | **LIVE_PROOF_PENDING** | 로그아웃이 자연 발생하지 않았고 세션을 인위적으로 파괴하지 않았다. mapping은 단위 테스트(`AsideMarketplaceObservationTest`, `naver-review-observe-guard.test.ts`)로 고정 |
| export ↔ browser cross-acquisition dedup | **LIVE_PROOF_PENDING** | 같은 id 수열의 연속이지만 겹치는 리뷰 미관측 |
| 빈 기간(리뷰 0건) | 설계상 `NONE · STORE_UNRESOLVED`(빈 페이지는 store를 증명하지 못한다) + grid 행이 없으면 `GRID_NOT_FOUND` — **「0건」으로 기록되지 않지만 진짜 0건도 COMPLETE/BOUNDED로 말할 수 없다**는 알려진 한계 |
| NAVER 리뷰 WRITE | **LIVE_PROOF_PENDING** | 이번 slice 필수 아님, 테스트 리뷰·승인 없음 |
| Coupang `COUPANG_REVIEW_OBSERVE_V1` | 구현·기본 OFF · **LIVE_PROOF_PENDING** | 2026-09-17 WING 세션 로그아웃(`AUTH_REQUIRED` 5회), 이후 범위 제외 |

### 24-7. 실제 scheduler가 만든 연속 2개 window (2026-09-17 14:00 · 16:00 KST)

24-3의 run은 일회용 DB에 넣은 row였다. 여기서는 **run row를 하나도 넣지 않았다.** 코드 변경 0.

**준비(한 번).** 24-3에서 넣었던 synthetic run 5개(14:00~22:00 KST 창을 점유)를 일회용 DB에서 **지웠고**(리뷰 52건은 유지), 일정
포인터는 SQL이 아니라 **제품 API**로 다시 세웠다 — 일회용 DB에 복사된 Demo 계정(저장소에 문서화된 데모 자격)으로 로그인해
`POST …/customer-operations/pause` → `…/activate`. 그 결과 제품이 `next_run_at = 14:00 KST`를 쓰고 현재 창(12:00)의 `RESUME` run을
스스로 만들었다. backend(8091)와 helper(47621)를 띄운 뒤 **이후 사람 행위 0**(버튼·trigger·DB insert 0).

| window (KST) | 누가 run을 만들었나 | run 생성 → 종료 | job (자동 enqueue · 자동 claim) | NAVER read | completeness | observed | new | changed | identity |
|---|---|---|---|---|---|---|---|---|---|
| 12:00 | 제품 `activate`(RESUME) | 12:52 | 자동 | 실제 | BOUNDED | 52 | 0 | 0 | MATCH |
| **14:00** | **scheduler** (`tick 생성=1`, trigger `SCHEDULED`) | 14:00:27 → 14:00:53 | `rr-run:a0d6516e…:nr` claim 14:00:47 · `OBSERVED` | 실제, 4.3초 | **BOUNDED** | **52** | **0** | **0** | MATCH (prior digest 동일) |
| **16:00** | **scheduler** (`tick 생성=1`, trigger `SCHEDULED`) | 16:00:26 → 16:00:54 | `rr-run:6d50655c…:nr` claim 16:00:47 · `OBSERVED` | 실제, 4.0초 | **BOUNDED** | **53** | **1** | **0** | MATCH (digest 변경) |

**exact NEW 1이 실제로 일어났다.** 15:11 KST에 실제 고객이 새 리뷰를 남겼고, 16:00 run이 그것 하나만 넣었다(`received 53 · inserted 1 ·
skipped 52`). canonical review: 10자리 리뷰글번호 external_id · ★5 · 본문 있음 · `reply_state PENDING` · 미디어 0(관측값) · **product
연결됨** · acquisition sync job stamp · `data_origin REAL` · 중복 external_id 0(총 53/53). 같은 tick의 case 처리:
`새Case=1 · 규칙=1 · 조사=0 · 초안=0` — `REVIEW · CUSTOMER_WORK · AUTO_RESOLVED · decided_by RULE · REVIEW_ROUTINE ·
required_authority AUTO`로 **규칙이 닫았다**(★5 루틴 리뷰, 모델 호출 0). 즉 새 리뷰 → Case까지 사람 없이 이어졌고, 이 리뷰는 판매자
결정이 필요 없는 것으로 판정됐다.

**계수.** backend ERROR 0 · 모델 0 · marketplace WRITE 0 · click/type/scroll/download 0 · dev `sellerops` 무접촉(migration 105 · 90 tables
재확인) · 코드 변경 0. 두 프로세스는 종료했다.

**분류.**

| 항목 | 상태 |
|---|---|
| SCHEDULED_NAVER_OBSERVATION | **LIVE_PROVEN** (14:00 KST, scheduler 생성) |
| SCHEDULED_NAVER_REPEATED_OPERATION | **LIVE_PROVEN** (14:00 → 16:00 연속 창) |
| exact NEW 1 → canonical Review → Case | **LIVE_PROVEN** (실제 새 리뷰 1건 → Case 1, 규칙 종결) |
| **NAVER Review Responsibility Slice** | **LIVE_PROVEN** (experimental/QA rollout, PD-1 불변) |
| Agent 조사가 필요한 새 리뷰 · AUTH_REQUIRED 라이브 · export↔browser dedup · NAVER 리뷰 WRITE | **LIVE_PROOF_PENDING** (24-6 그대로) |

## 25. NAVER 상품 문의 Responsibility Slice (experimental/QA rollout, 2026-09-17 – 09-18)

§24(리뷰)의 문의 짝이다. 판매자가 네이버 문의 화면에 들어가지 않아도 Reviewnary가 정해진 시간에 상품 문의를 읽고, 새 문의는
Case → 조사 → 근거 있는 답변 초안까지 준비하며, **보내는 것은 판매자의 승인 뒤 기존 실행 경로**다. PD-1(template source 범위)
불변 — 이 lane도 `deviceRecipes()` 옆자리이고 required source가 아니다.

### 25-1. READ-ONLY discovery가 먼저 확정한 것

- **화면:** Seller Center 자체 메뉴의 「문의 관리」가 가리키는 `#/comment/`(AngularJS, debug info off). 행은
  `comment in ::vm.commentList`이고 `angular.element(el).controller()`가 그 `vm`을 돌려준다(요소 data라 debug info와 무관).
- **source identity = 공식 API의 `questionId`.** API가 이미 저장한 7건에서 id · 생성 시각(ms) · 질문 본문 SHA-256이 **7/7 일치**.
  그래서 browser read와 API read는 같은 canonical 행(`naver-qna:<id>`)이고 서로를 덮어쓰지 않는다 — 비밀글 플래그는 API가
  싣지 않으므로 canonical에 쓰지 않는다(두 경로가 다르게 쓰는 칸은 서로를 「변경」으로 만든다; 관측값은 개수로만 로그).
- **store fence:** 행의 상품 링크 = `channelProductNo` **8/8**(옛 `productNo`는 7/8 불일치라 쓰지 않는다). 리뷰 recipe와 같은
  채널상품번호 fence를 `AsideCatalogueFence` 하나로 공유한다.
- **coverage:** 한 페이지 8행 · 기본 기간 3개월 · 페이지 이동은 클릭이다. 그래서 읽기는 **최신 페이지**이고, 그 페이지의 가장
  오래된 행이 이미 저장돼 있을 때(또는 페이지가 기간 전체일 때)만 `BOUNDED`, 아니면 `PARTIAL`(행은 저장하되 baseline이 아니다).
  판정은 저장 이전을 아는 backend가 delivery 시점에 한다(V110 `delivery_completeness`).
- 같은 행 객체의 구매자 마스킹 id · 회원번호 · 작성자 IP 감사 블록은 **읽어내지 않는다**(reader가 필드 여섯 개를 이름으로 만든다).

### 25-2. 구현 (재사용 우선)

recipe `NAVER_PRODUCT_INQUIRY_OBSERVE_V1`(job tag `ni`) · V110(recipe CHECK + `delivery_completeness`) ·
`NaverProductInquiryObservationService`(`POST /api/helper-devices/jobs/{jobId}/naver-product-inquiries`, 기존 device-token 경로 prefix) —
검증 → fence → coverage → **기존 `IngestionService.ingestInquiries`**(연결 계정 전달 ⇒ 미답변 신규는 기존대로 work item) →
`afterInquiryIngest` → SyncJob(`SELLER_CENTER_READ`, `PARTIAL`, `NEWEST_PAGE_n_OF_m_<coverage>`) → new = ingest insert, changed = ingest
update. Case discovery는 §24의 device-review 경로를 문의로 넓혔다(계정 범위 candidate, 그 계정의 첫 settled 문의 read가 경계).
helper는 **리뷰 recipe의 승인된 runtime(`naver-review-runtime.ts`)을 그대로** 쓰고 plan만 다르다 — 새 runtime · 새 evaluate forwarder ·
새 browser 권한 **0**. 테스트: backend 신규 10 + processor 1 + observer 1, collector guard 27(실제 page script를 VM에서 실행).

### 25-3. 실제 scheduler 관측 (일회용 DB `sellerops_nv_live`, run row 삽입 0)

backend 8091 · helper 47621 · Aside u0. 준비는 제품 API `activate`뿐이고 이후 사람 trigger 0.

| window (KST) | run (scheduler 생성) | 문의 read | observed | new | changed | identity |
|---|---|---|---|---|---|---|
| 09-17 18:00 | 18:00:05 → 18:00:50 | `PARTIAL`(저장 이력 0) | 8 / 11 | 8 | 0 | MATCH |
| 09-17 20:00 | 20:00:22 → 20:01:19 | **`BOUNDED` — Case 경계** | 8 / 11 | 0 | 0 | MATCH |
| 09-17 22:00 | 22:00:21 → 22:01:19 | `BOUNDED` | 8 / 11 | 0 | 0 | MATCH |
| **09-18 00:00** | 00:00:19 → 00:01:30 | `BOUNDED` | 8 / 12 | **1** | 0 | MATCH |

00:00의 신규 1건(`naver-qna:689256548`, 23:08 작성, 운영자 테스트 문의이나 **다른 상품 6355372669**에 작성됨) → canonical 1 · 중복 0 →
work item → **Case 1**(`NEEDS_DECISION · AGENT`) → **조사 1회**(prompt v2 · 13.0s · 724/541 토큰 · guard 0 · `REPLY_TO_CUSTOMER`)
→ 초안 **미작성**(`NO_LIBRARY` — 그 상품에는 판매자 지식이 없다). 10:52의 실고객 비밀글 문의는 경계 이전 history로 저장됐고
Case 0 · 초안 0 · 답변 0.

### 25-4. 근거 있는 초안 — QA_ACCELERATED_PRODUCT_RUN (scheduler 생성 run이 **아니다**)

올바른 상품(6473457702)의 테스트 문의(`naver-qna:689260413`, 00:17, 「부착했는데 잘 떨어지면 어떻게 하나요? (테스트)」)는
02:00 창을 기다리지 않고 **일회용 clone**에서 가속했다: clone에서만 00:00 run의 source 4 · job 2를 지우고 `CANCELLED`로 둔 뒤
제품 API `activate`가 **같은 run을 reopen**(attempt 2). run row 생성·삽입 0, 원본 proof DB 무접촉.

| 구성 | clone | 검색 결과 | 초안 |
|---|---|---|---|
| **retrieval OFF**(기본값 · 단어 일치) | `sellerops_naver_inquiry_draft_proof` | `NO_MATCH` · evidence 0 | **거절**(`DRAFT_NOT_PREPARED · NO_DRAFT`) — 근거 없는 초안 0 규칙 유지 |
| **retrieval ON**(embedding + 질문 재진술 + 적합성 판정, 이 org만) | `sellerops_naver_inquiry_draft_proof_r2` | **판매자 작성 지식 2건** — 「부착이 잘 떨어질 때 안내」·「자주 묻는 질문 - 잘떨어지네요」(`SELLER_ENTERED_KNOWLEDGE`) | **`DRAFT_PREPARED` · `GROUNDED` · v1** (fingerprint `b82f40ad…`) |

두 run 모두 같은 inquiry → canonical 1(중복 0) → Case 1 → 조사 1회(prompt v2, guard 0)까지 동일했고 달라진 것은 검색뿐이다.
retrieval ON 실측(metadata 로그): embedding passage 12건 4,368ms + 5건 167ms, question 2회(원문 · 재진술) · 재진술 `restated=true`
3,123ms · 적합성 판정 passage 2 `answered=true` 2,163ms · 초안 `grounded=2` 6,956ms. 초안의 사실 주장(먼지·기름기·습기 제거 ·
마른 천 · 완전 건조 · 30초 이상 압착 · 벽지·요철면 접착 약함 · 실리콘/보조 양면테이프)은 **전부 두 판매자 문단에 있다** —
근거 없는 사실 0. 끝 문장은 추가 정보 요청이다. 승인 0 · 실행 0 · marketplace WRITE 0 · live approval id 비어 있음.

### 25-5. 실행 leg는 이미 증명돼 있다

답변 전송은 이 slice에서 다시 증명하지 않았다: **2026-08-26 `LIVE_VERIFIED`** — `naver-qna:686514802`, 승인
`apr-ce092e823017`(WRITE max 1, 소진), `PUT /external/v1/contents/qnas/{questionId}` 1회 · 재시도 0 · 판정은 시스템 read-back
(`docs/evidence/naver_inquiry_answer_live_proof_v1.md`, commit `692c5a78`).

### 25-6. 알려진 gap (기록만, 이번 closeout에서 수정 0)

- **INVESTIGATOR_RETRIEVAL_GAP** — r2에서 조사자의 `searchKnowledge` tool은 **0건**을 돌려줬고 같은 run의 초안 검색은 판매자 지식
  **2건**을 찾았다. 조사 요약은 상품 문맥(`getProductContext` 3)에서 같은 안내를 인용했지만, 두 검색 경로가 같은 질문에 다른 답을 낸다.
- **KNOWN_RECONCILIATION_GAP** — 08-26 테스트 문의는 NAVER에서 삭제됐지만 canonical `inquiries.status`는 `UNANSWERED`로 남는다
  (부재를 삭제로 판정하는 경로 없음).
- 첫 read는 저장 이력이 없으면 설계상 `PARTIAL`이라 Case 경계는 **두 번째** read부터 선다. 한 창에 8건 넘게 새 문의가 오면 다음 read가
  `PARTIAL`로 정직하게 떨어진다(페이지 클릭 없음). 비밀글 여부는 canonical에 없다.
- 관측을 기다리던 백그라운드 대기 셸이 세 번 **메모리 부족으로 종료**됐다(backend·helper·scheduler는 무사했고 run은 영향 없음) — QA 하네스의 한계이지 제품 결함이 아니다.

### 25-7. 배포 권고 — FIRST_PILOT_RECOMMENDATION

**retrieval 세 capability(embedding · 질문 재진술 · 적합성 판정)를 global default로 켜지 않는다. 첫 pilot org의 allowlist에서만 켠다.**
근거: 같은 판매자 지식·같은 문의에서 단어 일치 구성은 `NO_MATCH`로 초안을 거절했고, retrieval 구성은 판매자 문장 2건에 근거한
초안을 준비했다(25-4). **대가를 명시한다:** 켜면 **모든 지식 검색마다 고객의 질문(과 재진술)이 모델 벤더로 나가고**, 적합성 판정은
고객 문장과 순위에 오른 판매자 문단을 한 요청에 싣는다(`docs/knowledge_retrieval_quality_v2.md`, payload floor 테스트) · 검색 turn당
왕복 3~4회가 늘어 지연(이번 실측 합계 ≈10s)과 비용이 붙고 이 셋은 판매자 일일 AI 예산 **밖**이다
(`docs/retrieval_runtime_closure_v1.md` §5). 켤지는 **DEPLOYMENT_DECISION_PENDING** — 이 proof는 default를 바꾸지 않았다.

### 25-8. 분류

| 항목 | 상태 |
|---|---|
| NAVER Product Inquiry Browser Acquisition | **LIVE_PROVEN** |
| NAVER Product Inquiry Scheduled Observation | **LIVE_PROVEN** (18:00 · 20:00 · 22:00 · 00:00 scheduler 생성) |
| New Inquiry → Case → Investigation | **LIVE_PROVEN** (00:00 scheduler run) |
| Knowledge-grounded Draft Preparation | **LIVE_PRODUCT_PATH_PROVEN** (QA_ACCELERATED_PRODUCT_RUN, retrieval-enabled) |
| NAVER Product Inquiry Execution | **LIVE_PROVEN** (2026-08-26) |
| **NAVER Product Inquiry Responsibility Slice** | **LIVE_PROVEN under retrieval-enabled configuration** (experimental/QA, PD-1 불변) |
| FIRST_PILOT_RETRIEVAL | **ORG_ALLOWLIST_RECOMMENDED** · DEPLOYMENT_DECISION_PENDING |

종료 상태: 세 DB(`sellerops_nv_live` · `…_draft_proof` · `…_draft_proof_r2`) 모두 `PAUSED` · next run 없음 · backend/helper 정지 ·
evidence 보존. dev `sellerops` 무접촉(migration 105; 지식 12행·봉인 credential 1행을 승인 하에 **읽기 전용 export**한 것 외 접촉 0).

## 26. Customer Operations Manager Demo v1 — canonical product goal (2026-09-18)

**Product-owner decision.** 이 vertical의 canonical product goal은 **Customer Operations Manager Demo v1**이다: 판매자가 고객 운영을
맡기면 Reviewnary가 **Observe → Understand → Knowledge → Decide → Prepare → Ask/Execute → Learn**을 수행하고, 책임질 수 없는 예외만
판매자에게 가져온다.

- Responsibility Runtime과 NAVER scheduled observe는 **충분히 증명됐다**(§21–§25). 다음 우선순위는 Runtime 확장이 아니라
  **Knowledge · Judgment · UX 품질**이다.
- `CUSTOMER_OPERATIONS_V1` vertical만 깊게 만든다. 새 Store Health · Money Ops · Listing Agent · Procedure platform **금지**.

| 단계 | 문서 | 상태 |
|---|---|---|
| Q1 Knowledge Spine v1 | `docs/knowledge_spine_v1.md` | 구현 · 테스트 증명(라이브 0) — 판매자 운영 흔적 6종을 scope·authority·freshness·provenance·원천 ref와 함께 **하나의 scoped 읽기**로; 저장 0 · 기존 초안/검색 경로 변경 0 |
