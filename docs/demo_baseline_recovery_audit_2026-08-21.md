# Demo Baseline Recovery Audit — `main @ 2491f1ab` (2026-08-21)

**What this is.** A capability-by-capability audit of the six product capabilities the Demo Baseline
promises, traced on **merged `main` at `2491f1ab`** along the full chain — 수집 → 저장 → 파생·분석 →
API → 화면 → 테스트 → 마지막 live proof — and classified `LIVE` / `IMPLEMENTED` / `DISCONNECTED` /
`BROKEN` / `MISSING`. It is the **canonical audit of the Demo Baseline recovery backlog** and a
**product capability snapshot of this commit**.

**Demo Baseline** here means exactly three documents, unchanged by this audit:
`docs/demo_runbook_v1.md` (§3 화면 순서, §4 proof levels) · `docs/product_assembly_ia_v1.md`
(A7 FE 동결, §4a Today Inbox 계약) · `docs/multi-channel-connector-roadmap.md` §4.1 (능력 정본).

**What this is NOT.** Not capability truth — §4.1 keeps that, and where this document and §4.1 disagree,
**§4.1 wins** and this document is the place to look for why. Not a live-run record: nothing here was
established against a real marketplace account or a real database *by this audit*. Every live proof
cited below was established elsewhere and is linked to its own evidence file. Not a promotion mechanism:
no 운영 지원, no 셀러 표기, no scope decision moves because of a row here.

**Companion, not a replacement.** `docs/channel_integration_completeness_audit_v1.md` audits **channel /
connection / local-agent reachability**. This document audits the **six product capabilities** on top of
that. Where they overlap (수집), this one defers to it.

---

## 0. 판정 요약

| # | Capability | 판정 | 한 줄 근거 |
|---|---|---|---|
| 1 | 실제 주문/문의/리뷰 수집 | **LIVE** (채널별 편차) | 8개 채널×DataType이 라이브 증명됨. 스케줄 flag off = 운영 지원 아님(§4.1 그대로) |
| 2 | 상품·채널별 grouping | **채널 LIVE / 상품 DISCONNECTED** | 상품 링크는 ingest가 생성하나, 상품별 집계 화면의 유일한 소비자가 A1–A7에서 삭제됨 |
| 3 | 미답변 / 확인필요·부정 리뷰 / 반복 triage | **미답변 LIVE · 리뷰 LIVE · 반복 DISCONNECTED + MISSING** | 반복 이슈 메모리는 구현·라이브지만 갱신 트리거가 2개 수집 경로에만 붙어 있음. "반복 **문의**"는 미착수 |
| 4 | 과거 답변·고객 반응 RAG 검색 | **MISSING (의도된 부재)** | 임베딩/벡터/검색 0건. `CustomerMemory.tsx:15` scope fence + `memoryScope.test.tsx`가 고정 |
| 5 | AI 답변 초안 | **부분 LIVE / 제품화면 DISCONNECTED** | 실 LLM 초안은 `/agent` 문의 경로에만 도달. 리뷰·문의 제품화면 초안은 전부 `RULE_BASED` |
| 6 | 실데이터 기반 주간 리포트 | **IMPLEMENTED (2곳 BROKEN)** | 실데이터 파생은 맞으나 미답변 수가 홈과 불일치, FAQ/상세 후보는 커넥터 org에서 구조적으로 항상 0 |

판정 어휘 — `LIVE`: 실계정/실DB 라이브 증명이 있고 지금 `main`에서 셀러가 누를 수 있는 컨트롤에서
체인이 닫힌다. `IMPLEMENTED`: 체인은 닫혀 있으나 라이브 증명이 없다. `DISCONNECTED`: 구현과 테스트는
살아 있는데 호출부/트리거/소비자가 없어 도달하지 않는다. `BROKEN`: 도달은 하지만 잘못된 값을
낸다. `MISSING`: 구현이 없다.

---

## 1. 감사 방법과 스스로 지킨 규칙

- 모든 판독은 `git show main:<path>` / `git grep <pattern> main` 으로 **머지된 `main`** 에서 직접.
  작업 브랜치(`feat/pairing-native-approval`)의 14개 커밋은 이 감사에 포함되지 않는다.
- **파일이 존재하는 것도, 테스트가 통과하는 것도 `LIVE`가 아니다.** 셀러가 누를 수 있는 컨트롤에서
  체인이 닫혀야 한다 — `channel_integration_completeness_audit_v1.md`가 세운 규칙을 그대로 승계한다.
- **과거 live proof**와 **현재 도달 가능성**은 항상 두 개의 열이다. 라이브 증명이 있으면서 지금
  도달 불가인 항목이 실제로 존재한다.
- CI 상태(2026-08-19 기준 backend / frontend / collector / agent-runtime 전부 success, PR #471–#473)는
  **결함 부재의 증거가 아니다**. 아래 결함들은 각자의 테스트가 각자만 검증하기 때문에 통과한다.

---

## 2. Capability별 판정

### 2.1 실제 주문/문의/리뷰 수집 — `LIVE` (채널별 편차)

**구현 위치**
- 커넥터: `backend/src/main/java/com/sellerops/connector/{naver,coupang,cafe24}/**`
- 실행/스케줄: `collect/SyncRunExecutor.java`, `collect/SyncScheduler.java`,
  `collect/SyncScheduleRunner.java`, `collect/CollectControlService.java`, `collect/SyncRunGate.java`
- 적재: `ingest/IngestionService.java` (리뷰·문의·주문요약·커뮤니티 아티클), `ingest/map/**`
- NAVER 가이드 import: `reviewimport/**` + `collector/src/cli/local-agent.ts` (import carrier)
- Coupang 상품평 취득(Action Window): `collect/AgentReviewHandoffService.java:113`
  + `collector/src/cli/acquire-coupang-reviews.ts`
- 자동 운영: `selfpilot/SelfPilotReconciler.java`, `selfpilot/SelfPilotScheduler.java`

**API / data / UI 연결 — 닫혀 있음**
- 지금 수집하기 → `frontend/src/components/connect/CollectionSettingsSection.tsx:203`
  → `POST /api/seller-accounts/{id}/sync`
- 기간 backfill → `frontend/src/components/BackfillPanel.tsx:75` → `POST …/backfill`
- 과거 리뷰 가져오기 → `frontend/src/pages/ReviewImport.tsx` → `/api/imports/reviews/plans`
  → bridge → 로컬 에이전트 → `ImportSegmentHost`
- Self-Pilot v1이 켜지면 reconciler가 수집 설정 행을 자동 생성하고 스케줄러가 주기 실행
  (`docs/self_pilot_runtime_v1.md`)

**테스트** — `IngestionServiceTest`, `ReviewAcquisitionSpineTest`, `ReviewDedupGateHardeningTest`,
`ReviewDedupKeyVersionIngestTest`, `SyncRunExecutorTest`, `SyncRunExecutorSingleFlightTest`,
`SyncRunSingleFlightPostgresProofIT`, `SyncScheduleRunnerTest`, `CollectControlServiceTest`,
`SellerAccountCollectControllerTest`, `SelfPilotReconcilerTest`, `AgentReviewHandoffServiceTest`,
`CoupangReviewPrivacyRegressionTest`; collector `test/action-window/initial-import/**`,
`test/crossstack/fe-import-runtime-real-bridge.test.ts`.

**마지막 live proof** (전부 `docs/evidence/INDEX.md` §1의 행)
| 채널 × DataType | 날짜 | 증거 |
|---|---|---|
| Cafe24 REVIEW (board 4) | 2026-07-30 / 07-31 | `docs/sellerops_cafe24_review_acquisition_completion_live_proof.md` |
| Cafe24 INQUIRY (board 6) | 2026-07-31 | `docs/sellerops_cafe24_inquiry_read_live_proof.md` |
| Cafe24 ORDER_SUMMARY | 2026-06-25 → 06-29 | `docs/sellerops_cafe24_c2_order_summary_live_verification.md` |
| Coupang ORDER_SUMMARY | 2026-08-06 (`apr-01212e2da29a`) | `docs/coupang_final_main_first_connection_order_routine_proof_v1.md` |
| Coupang INQUIRY (`onlineInquiries`) | 2026-08-14 | `docs/coupang_inquiry_live_proof_v1.md` |
| Coupang REVIEW (WING 취득) | 2026-08-15 — 22건 저장, 재수집 stored=0 | `docs/coupang_review_acquisition_v1.md` §6.6 |
| NAVER ORDER_SUMMARY | 2026-06-14 (1회) | `docs/archive/sellerops_phase3c_live_smoke.md` §0 |
| NAVER REVIEW (가이드 세그먼트) | 2026-07-25 / 07-26 | `docs/action-window-runtime/naver-initial-review-import-live-proof-record.md` |

**판정 근거와 남는 것**
- 판정 `LIVE`. 다만 §4.1의 **운영 지원 열은 여전히 파일 업로드뿐**이며 이 감사는 그것을 옮기지 않는다.
- NAVER INQUIRY는 §4.1에서 미확정 — 파일 업로드만. ESM 문의 Excel 임포트 백엔드
  (`inquiry/esmimport/**`)는 존재하나 FE 미노출(§4.1 진행 노트 그대로).
- **결함 F**: `frontend/src/pages/Orders.tsx:11` `PRESETS = [7, 14, 30]`. 백엔드는 366일까지 받는데
  화면은 30일까지만 제공한다. 2026-08-20 라이브 진단(같은 org, 30일 → 0건 / 354일 → 1,150건,
  `order_daily_summaries` 최신 `2026-06-14`)에서 **코드도 데이터 부재도 아닌 날짜 창 문제**로
  확정됐고, 수정은 "새 org의 실제 첫 동기화 후 재판단"으로 product-owner 보류 상태다
  (`docs/evidence/INDEX.md` §1, 2026-08-20 행).

---

### 2.2 상품·채널별 grouping — 채널 `LIVE` / 상품 `DISCONNECTED`

**채널 grouping — 정상**
- 게이트: `frontend/src/lib/productChannels.ts` + `backend/…/channel/ProductChannels.java`
  (NAVER / Coupang / Cafe24)
- 표면: `/reviews` 계정 칩(`pages/app/ChannelReviews.tsx`), `/inquiries` 채널 필터
  (`lib/inboxWorkspace.ts:139`), `/connect` 채널 행
- 테스트: `productChannels.test.ts`, `reviewAccounts.test.ts`, `mocks.triage.test.ts`
  (계정↔채널 일치 — 쿠팡 계정 화면에 NAVER 대시보드가 뜨던 회귀를 고정)

**상품 grouping — 링크는 살아 있고 소비자가 없다**
- 생성: `ingest/IngestionService.java:91·121`(리뷰), `:177·225`(문의)에서
  `ProductService.resolveOrCreate(orgId, productName, sku)` → `reviews.product_id` / `inquiries.product_id`.
  `inquiry/esmimport/EsmInquiryImportWriter.java`도 동일. 테스트 `ProductServiceUpsertTest`,
  `ingest/ExportToReportChainTest`(업로드 → dedupe → 상품 링크 → item-analysis → 리포트 표면을
  한 번에 관통하는 유일한 테스트).
- **끊긴 지점 (D)**: `dashboard/DashboardService.buildTopProductIssues()`는 살아 있고
  `ExportToReportChainTest`가 그 상품 값을 고정하지만, 노출 경로 `GET /api/dashboard/summary`의
  **프론트 소비자가 0개**다. `frontend/src/lib/apiClient.ts:540`의 `getDashboardSummary`는 전
  프론트에서 **정의 1회, 호출 0회**. 소비자였던 `DashboardGrid.tsx` / `AttentionSignalCard.tsx` /
  `InboxFeed.tsx`가 `572f564e` (Product assembly A1–A7)에서 삭제되며 사라졌다.
  → **재연결 문제이지 재구현 문제가 아니다.**
- **끊긴 지점 (G)**: `ingest/Cafe24ReviewPromoter.java:71` `review.setProductId(null)` —
  Cafe24는 자체 `product_no`만 운반하므로 승격된 리뷰는 `products`에 붙지 않는다. 주석에 사유가
  명시돼 있고, 매핑 정책이 없어서 남은 자리다.
- Coupang 상품평은 옵션ID 축이라 `products` 링크가 없다(정책 게이트 D1–D8의 결과이기도 하다).
- `channel-reviews` 목록에 상품 필터 파라미터가 없다 —
  `review/channel/ChannelReviewController.java`의 파라미터는 `sort`(attention/newest/lowest) ·
  `tier` · `page` · `size` 뿐.

**현재 상품 단위로 묶어 보여주는 유일한 화면**은 고객운영 메모리의 이슈별 상품 증거 행
(`frontend/src/components/memory/IssueDetailPanel.tsx:143`, `dto/IssueProductEvidenceView`)이다.

---

### 2.3 미답변 문의 / 확인 필요·부정 리뷰 / 반복 문의 triage

#### (a) 미답변 문의 — `LIVE`
`inbox/InboxService` + `inbox/dto/InboxResponse.java:14`의 `unansweredInquiries` (서버측, **무제한**,
비밀글 제외) → `frontend/src/lib/todayInbox.ts:149 buildInquiryToday` → `/inquiries?state=NEEDS_REPLY`.
홈의 숫자와 목적지 화면의 숫자가 같다는 §4a 계약을 이 경로가 지킨다.
테스트: `todayInbox.test.ts`, `inboxWorkspace.test.ts`, `CustomerInbox.test.tsx`, `HomeV2.test.tsx`.
Live proof: Cafe24 board-6 2026-07-31 · Coupang `onlineInquiries` 2026-08-14 (같은 큐로 흘러 들어감).

#### (b) 확인 필요·부정 리뷰 — `LIVE`
- 규칙 tier: `review/triage/ReviewTriageRules.java`(tier의 유일한 소유자), `ReviewTriageNote`,
  `TriageReasonCode`
- AI 추가 제안(후보 C2, org opt-in, off by default): `review/triage/llm/**`,
  `review/triage/pilot/AiTriagePilotService.java`, `feedback/TriageDisplayDecision`
- 표면: `hooks/useReviewAttention.ts` → 계정별 `GET …/channel-reviews?tier=NEEDS_ATTENTION`
  → 홈 · `/reviews` · 리포트가 **같은 정의**를 읽는다
- 부정 리뷰는 별도 축이 아니라 이 tier가 흡수한다. `reviews.negative` 컬럼은 남아 있으나 유일한
  소비자가 `DashboardService`(= 위 D로 단절)이다.
- 테스트: `ReviewTriageRulesTest`, `ReviewTriageNoteTest`, `ReviewTriageQueueIsolationTest`,
  `AiTriagePilotServiceTest`, `TriageFeedbackServiceTest`, `TriageFailClosedTest`,
  `TriagePayloadFloorTest`, `ChannelReviewAiPilotIT`, `ingest/ExportToAttentionChainTest`;
  FE `ChannelReviews.test.tsx`, `attention.test.ts`, `VocItemTriageControl.test.tsx`
- Live proof: 2026-08-17 — NAVER / Cafe24 / Coupang 3채널 35행 considered·classified,
  **AI 추가 마크 0**; mark → ordering → funnel의 유일한 라이브 증명은 그 이전의 NAVER 1행
  (`docs/workstreams/review_ai_triage_demo.md` §8)

#### (c) 반복 — 리뷰는 `DISCONNECTED`, 문의는 `MISSING`

**반복 리뷰 이슈 메모리**는 구현·라이브다: `reviewissue/**`(V31 `review_issue_memory`),
`ReviewIssueExtractionService`, `ReviewIssueRefreshService`, `IssueWindows`(기간 판정),
`IssueChangeRules`; 화면 `/memory`(`pages/app/CustomerMemory.tsx`). 테스트 `ReviewIssueMemoryTest`,
`ReviewIssueRefreshServiceTest`, `IssueWindowsTest`, `IssueChangeRulesTest`,
`Cafe24ReviewIssueBridgeTest`, `ReviewIssueImportRefreshListenerTest`.

**끊긴 지점 (C)** — 자동 갱신 트리거인 `ReviewSegmentIngestedEvent`를 발행하는 곳은 `main` 전체에서
정확히 세 곳이고, 그중 수집 경로는 **둘뿐**이다:

| 발행처 | 커버하는 수집 경로 |
|---|---|
| `reviewimport/ReviewImportRunService.java:134` | NAVER 가이드 세그먼트 import |
| `ingest/Cafe24ReviewIssueBridge.java:77` | Cafe24 board-4 리뷰 동기화 |
| `ingest/Cafe24ReviewPromotionReconciler.java:114` | (과거분 승격 — 운영자 수동 호출) |

따라서 **Coupang 상품평 취득**(`collect/AgentReviewHandoffService.java:113`은 `ingestReviews`만
호출하고 이벤트를 발행하지 않는다)과 **파일 업로드 ingest**로 들어온 리뷰는 반복 이슈 메모리에
영원히 반영되지 않는다. 유일한 복구 수단인 `POST /api/review-issues/extract`
(`reviewissue/ReviewIssueController.java:112`)와
`POST /api/seller-accounts/{id}/reviews/reconcile-issue-memory`
(`collect/Cafe24ReviewReconcileController.java:33`)는 **FE 호출부가 없다**(`apiClient.ts` 전수 확인) — **단절 E**.

**반복 문의 (I) — MISSING.** `reviewissue` 패키지는 문의를 단 한 번도 참조하지 않는다(전수 grep 0건).
가장 가까운 대체물은 `itemanalysis`의 `FAQ 후보` 카테고리 카운트인데, 그것도 §2.6의 이유로 커넥터
수집 org에서는 구조적으로 항상 0이다. 즉 요구된 triage 3종 중 하나는 **현재 어떤 경로로도 산출되지
않는다.**

---

### 2.4 과거 답변·고객 반응 RAG 검색 — `MISSING` (의도된 부재)

**구현 위치** — 없음. `backend/src/main`, `frontend/src`, `agent-runtime/src` 전수에서 임베딩·벡터
스토어·유사도 검색·검색 엔드포인트 **0건**.

**의도된 부재라는 근거** — `frontend/src/pages/app/CustomerMemory.tsx:15`:

> SCOPE FENCE (v1): recurring issues, their evidence, their trend, and per-product signals. There is NO
> search input, by decision — search over past inquiries, reviews and replies is retrieval-backed work
> outside v1 and gated on a separate scope decision.

이 fence는 `frontend/src/pages/app/memoryScope.test.tsx`가 테스트로 고정하고 있다. **소실이 아니라
미착수**이며, 여는 순간 `docs/product-scope-v1.md`의 개정이 함께 움직여야 한다.

**원료는 이미 쌓여 있다** (재구현 없이 착수 가능한 자산):
`attention/reply/ReviewReplyDraft` · `ReviewReplyApproval` · `ReviewReplyOutcome`(과거 답변과 게시 결과),
`inquiry/reply/InquiryReplyDraft`, `inquiry/proposal/InquiryProposal`,
`review/triage/feedback/**`(`review_triage_predictions` · `_corrections` · behaviour events).
"고객 반응" 축은 현재 리뷰/문의 **원문**이 전부이고, 별도의 반응 신호(재문의·재구매·평점 변화)를
모델링한 테이블은 없다. → **product-owner scope 결정 필요.**

---

### 2.5 AI 답변 초안 — 부분 `LIVE`, 제품화면 `DISCONNECTED`

| 표면 | 초안 생산자 | 상태 |
|---|---|---|
| 리뷰 상세 → 답변 준비 (`components/VocItemReplyPrep.tsx`) | `attention/reply/RuleBasedReviewReplyProvider.java` (`templates-v1`) | `LIVE` — **AI 아님** |
| 문의 상세 → 답변 방향 제안 (`components/inbox/InquiryResponsePanel.tsx`) | `inquiry/proposal/RuleBasedInquiryProposalProvider.java` — **카테고리만, 본문 없음** | `LIVE` — AI 아님 |
| `/agent` 문의 초안 | `agent-runtime/src/provider/SpringDraftProvider.ts` → `POST /api/agent/inquiry-draft` → 실 LLM | **`LIVE` 2026-08-20** |
| `/agent` 리뷰 초안 | `agent-runtime/src/graph/reviewGraph.ts:155` — 백엔드 규칙 제안 본문을 그대로 저장 | LLM 미연결 |

- `InquiryResponsePanel.tsx`의 주석이 스스로 못박고 있다: 제안은 `summaryCategory` + provenance이고
  `providerKind`는 `RULE_BASED`이므로 "AI 답변 초안"이라 부르면 **제품이 만들지 않는 것을 설명하는
  것**이다.
- 교체 seam은 열려 있다: `attention/reply/ReviewReplyProposalProvider` 인터페이스 +
  `sellerops.reply.review.provider` 플래그(`RuleBasedReviewReplyProvider`는 `matchIfMissing=true`로 기본
  선택). **LLM 구현체가 존재하지 않는다.**
- LLM egress는 backend 단일 지점: `agent/llm/**`, 플래그 `sellerops.agent.draft.*`(off by default,
  org allow-list, `*`는 LOCAL_SINGLE_USER), payload floor는 문의 title/body만
  (`AgentDraftPayloadFloorTest`가 직렬화된 요청 바이트에 대해 검증). triage 파일럿과 **별도 플래그·별도 키**.
- 테스트: `AgentDraftBoundaryTest`, `AgentDraftPayloadFloorTest`, `AgentDraftResponseParserTest`,
  agent-runtime `test/provider/springDraftProvider.test.ts`, `RuleBasedReviewReplyProviderTest`,
  `InquiryProposalServiceTest`, `InquiryProposalWriterAtomicTest`; FE `VocItemReplyPrep.test.tsx`,
  `InquiryResponsePanel.publish.test.tsx`, `Agent.test.tsx`.
- **마지막 live proof** — 2026-08-20, `POST /api/agent/inquiry-draft` → `200 {available:true, …
  providerVersion:"agent-draft/v1+openai:gpt-5-2025-08-07+…"}`
  (`docs/decisions/agent-runtime-langgraph-llm-split.md`). 그 evidence 행이 스스로 밝히듯 **그 문의는
  증명을 위해 운영자가 작성한 것이고, 실제 셀러 데이터로는 아직 통과된 적이 없다.** 같은 날의
  `/agent` HITL 런은 초안이 "규칙 기반"으로 라벨링됐다(그 시점 org 플래그 off) — provenance 라벨이
  보수적인 방향으로 스스로를 증명한 사례.
- **단절 H**: Demo Baseline §3의 데모 동선(홈 → 리뷰 → 리뷰 상세 → 문의)에서 AI 초안은 **한 번도
  등장하지 않는다.** 등장하는 AI는 `AI 확인 필요` 마크뿐이고 초안은 전부 규칙 기반이다.
  §4는 "문의 답변 방향 제안은 데모 org에서 시연 불가"를 이미 기록해 두었다.

---

### 2.6 실데이터 기반 주간 리포트 — `IMPLEMENTED`, 2곳 `BROKEN`

**구현 위치** — `frontend/src/lib/reportView.ts`(순수 파생) + `frontend/src/pages/app/ReportsV2.tsx`.
실데이터 4소스: `GET /api/review-issues` · `GET /api/inbox` · `GET /api/item-analysis` ·
계정별 `channel-reviews?tier=NEEDS_ATTENTION`. 로드 실패는 0이 아니라 "확인할 수 없음"으로 렌더된다.

**테스트** — `reportView.test.ts`, `ReportsV2.test.tsx`, `pages/pages-copy.test.ts`(성과 주장 어휘 금지
가드), 백엔드 `ingest/ExportToReportChainTest`, `ItemAnalysisServiceTest`,
`ItemAnalysisReanalysisTest`.

**마지막 live proof** — 리포트 화면 자체의 라이브 증명은 없다. 그 아래 소스들의 증명이 전부다
(§2.1 · §2.3). Demo Baseline §3은 `/reports`를 **기본 동선에서 제외**한다("요청받지 않으면 열지 말 것").

**결함 1 (A) — 미답변 문의 수가 홈과 다르다. `BROKEN`.**
`pages/app/ReportsV2.tsx:123`이 `api.getInboxStrict()`를 **인자 없이** 호출한다 → 서버 기본
`limit=50` → `lib/reportView.ts:80`이 그 최대 50행을 `needsReply`로 걸러 센다. 홈은 같은 라벨에 서버
무제한 `unansweredInquiries`를 쓴다(`todayInbox.ts:149`). 데모 org(미답변 3,208건, 런북 §2) 기준
홈은 3,208, 리포트는 ≤50을 **같은 문구·같은 링크**로 인쇄한다.
`reviewsToCheck`는 바로 이 부류의 버그를 이미 한 번 고친 자리이고 `reportView.ts:31–40` 주석이 그
수정을 기록하고 있다 — 문의 축만 남았다.

**결함 2 (B) — FAQ·상세페이지 후보가 커넥터 수집 org에서 구조적으로 항상 0. `BROKEN`.**
두 수치는 `reportView.ts:81–82`에서 `item_analysis` 행의 `recommendedAction`을 센다. 그런데
`ItemAnalysisService`를 자동 호출하는 곳은 `connector/FileUploadConnector.java:170`
(`itemAnalysis.analyzeForSources(orgId, sourceType, insertedIds)`) **하나뿐**이다. API 풀 수집
(Cafe24 / Coupang / NAVER)과 Action Window 취득 경로는 분석 행을 만들지 않는다. 트리거인
`POST /api/item-analysis/run|backfill`은 `apiClient.ts:563` 주석이 명시하듯 **UI에 없다**
("invoked out-of-band"). 같은 원인으로 문의 목록의 분류 chip과 우선순위 랭킹도 업로드 데이터에서만
켜진다.

**주의 (결함 아님)** — "반복되는 고객 문제" 섹션의 기간 판정은 서버 `IssueWindows`가 소유해 실제로
기간 기반이지만, 두 Figure(미답변·확인필요)와 FAQ 후보는 **주 단위가 아니라 현재 상태 총계**다.
카피가 "이번 기간"으로 조심스럽게 쓰여 거짓 주장은 아니나, "주간 리포트"라는 제목과의 간극은 남는다.
`pages-copy.test.ts`가 성과 주장은 막지만 기간 정합성은 검사하지 않는다.

---

## 3. 단절 목록 (A~J)

`성격` 열이 이 문서의 핵심 구분이다 — **소실/단절**(구현이 있는데 도달하지 않음)과
**의도된 미구현**(결정에 의해 없음)을 절대 섞지 않는다.

| # | 끊긴 지점 | 근거 (파일:라인) | 결과 | 성격 | 심각도 |
|---|---|---|---|---|---|
| **A** | 리포트가 미답변 수를 50행 캡 위에서 계산 | `ReportsV2.tsx:123` + `reportView.ts:80` | 같은 라벨, 다른 숫자 (홈 3,208 vs 리포트 ≤50) | **회귀 — 1줄** | P0 |
| **B** | `ItemAnalysisService` 자동 호출이 업로드 경로에만 | `FileUploadConnector.java:170` (유일), `apiClient.ts:563` | FAQ·상세 후보 항상 0, 문의 분류 chip 없음 | **미연결 seam** | P0 |
| **C** | `ReviewSegmentIngestedEvent` 미발행 (Coupang 취득 · 업로드 ingest) | 발행처 3곳: `ReviewImportRunService.java:134`, `Cafe24ReviewIssueBridge.java:77`, `Cafe24ReviewPromotionReconciler.java:114` / 미발행: `AgentReviewHandoffService.java:113` | 반복 이슈 메모리가 두 수집 경로를 영영 못 봄 | **미연결 seam** | P0 |
| **D** | `getDashboardSummary` 소비자 0 | `apiClient.ts:540` (정의 1, 호출 0); 소비자 삭제 `572f564e` | 상품별 이슈 집계 화면 소실 | **소비자 소실** | P1 |
| **E** | `/review-issues/extract`, `…/reconcile-issue-memory` FE 호출부 없음 | `ReviewIssueController.java:112`, `Cafe24ReviewReconcileController.java:33` | C의 유일한 수동 복구 수단이 curl 전용 | **UI 미연결** | P1 |
| **F** | 주문 화면 최대 30일 (백엔드 366일) | `Orders.tsx:11` | 주문 데이터가 있어도 0건으로 보임 | **알려진 미결** (2026-08-20 진단, 미수정) | P1 |
| **G** | Cafe24 승격 리뷰 `productId=null` | `Cafe24ReviewPromoter.java:71` | Cafe24 리뷰는 상품 grouping 밖 | **정책 미결** | P1 |
| **H** | 리뷰/문의 제품화면에 LLM 초안 미연결 | seam: `ReviewReplyProposalProvider` + `sellerops.reply.review.provider` | AI 초안이 `/agent`에만 존재 | **product-owner 결정** | P2 |
| **I** | 반복 **문의** 탐지 부재 | `reviewissue/**`가 문의 미참조 (grep 0) | 요구 capability 3의 1/3 미산출 | **의도된 미구현** (대체물 미확정) | P2 |
| **J** | RAG 검색 부재 | `CustomerMemory.tsx:15` fence + `memoryScope.test.tsx` | 요구 capability 4 전체 | **의도된 미구현** (scope 밖) | P2 |

### 3.1 소실·단절 vs 의도된 미구현

- **소실·단절 (복구 대상)** — A, B, C, D, E. 다섯 항목 모두 **구현·테스트가 살아 있고 호출부/트리거/
  소비자만 없다.** 재구현은 필요 없고 필요한 것은 composition이다.
- **미결 결정 (판단 대기)** — F, G. 코드 변경은 작지만 각각 product-owner 판단이 선행한다고 이미
  기록돼 있다(F는 evidence INDEX 2026-08-20 행, G는 매핑 정책 부재).
- **의도된 미구현 (결함 아님)** — H, I, J. 없는 것이 기록된 결정의 결과다. 특히 **J는 fence 테스트가
  존재하므로, 여는 것 자체가 scope 개정이다.** 이 셋을 "복구"라고 부르면 안 된다 — 착수다.

---

## 4. 최소 복구 순서

원칙: **기존 구현을 재구현하지 않는다.** 아래 1–3단계는 전부 이미 존재하는 서비스·이벤트·엔드포인트에
호출부를 붙이는 작업이다.

### 1단계 — 숫자 정합성 (코드 1줄, 리스크 0)
- **A**: `lib/reportView.ts`의 `unanswered`를 `inbox.items.filter(needsReply).length` 대신 서버의
  `unansweredInquiries`로 바꾼다. `buildInquiryToday`가 이미 그렇게 하고 있으므로 규칙을 옮겨 오는 것뿐.
  `buildWeeklyReport`의 시그니처가 `readonly FeedItem[] | null`을 받으므로 `InboxResponse` 일부를
  받도록 좁게 넓히는 정도의 변경. 회귀 방지 테스트는 "홈과 리포트가 같은 org 데이터에서 같은 수를
  인쇄한다" 한 개면 충분하다 — 지금 없는 것이 정확히 그 테스트다.

### 2단계 — 이미 있는 seam에 호출 붙이기 (신규 파이프라인 0)
- **B**: `FileUploadConnector.java:170`의 `itemAnalysis.analyzeForSources(orgId, sourceType, insertedIds)`
  호출을 `SyncRunExecutor`의 ingest 결과(삽입된 id)에도 동일하게 부착. 서비스·엔티티·테스트 무변경.
  `ItemAnalysisService.analyzeForSources`는 이미 skip-if-exists 멱등이다.
- **C**: `Cafe24ReviewIssueBridge.java:77`과 **동형으로**, Coupang 취득(`AgentReviewHandoffService`)과
  업로드 ingest 성공 시 `ReviewSegmentIngestedEvent`를 발행. 리스너
  (`ReviewIssueImportRefreshListener`, AFTER_COMMIT · REQUIRES_NEW · best-effort)와 refresh의
  멱등성은 이미 존재한다.
- → 이 둘이 붙으면 **D의 절반 · E · §2.6 결함 2 · §2.3(c)의 반복 격차가 동시에 해소된다.**

### 3단계 — 소비자 재연결 (백엔드 무변경)
- **D**: `TopProductIssue`를 리포트 또는 메모리에 상품 섹션으로 노출. `DashboardService`와
  `ExportToReportChainTest`가 이미 그 값을 고정하고 있으므로 FE 소비자만 새로 쓴다.
- **E**: 2단계가 끝나면 수동 트리거는 운영자 도구로 남겨도 된다(UI 불필요). 남긴다면 그 사실을
  이 문서가 아니라 운영 문서에 적는다.

### 4단계 — 결정이 선행되어야 하는 것 (지금은 보고만)
- **F** 주문 range 확대 — evidence INDEX가 "새 org 첫 동기화 후 재판단"으로 보류 중.
- **G** Cafe24 상품 링크 — `product_no ↔ products` 매핑 정책 필요.
- **H** LLM 초안을 제품화면에 노출할지 — 노출 시 `pages/Agent.tsx`의 provenance 라벨 규칙
  (`draftKindLabel`: `providerKind === "LLM"` → "AI 생성", 그 외 "규칙 기반")을 리뷰/문의 패널로
  이식해야 하고, 문의 본문 egress 게이트의 org 범위 결정이 따라온다.
- **I** 반복 **문의** — `reviewissue`를 문의로 확장할지, `itemanalysis` FAQ 후보를 정식 대체물로
  인정할지. 어느 쪽이든 `docs/product-scope-v1.md`가 먼저 말해야 한다.
- **J** RAG — v1 밖으로 명시적으로 잠긴 상태. 여는 순간 fence 테스트와 scope 문서가 함께 움직인다.

---

## 5. 이 문서가 바꾸지 않는 것

- §4.1의 어떤 칸도 옮기지 않는다. **운영 지원 수준은 여전히 파일 업로드(전 채널)뿐이다.**
- 어떤 셀러 표기도 바꾸지 않는다.
- `docs/product-scope-v1.md`의 scope lock, `docs/product_assembly_ia_v1.md`의 A7 FE 동결,
  `docs/coupang_review_policy_gate_v1.md`의 D1–D8, `docs/sellerops_live_approval_contract.md`의
  승인 계약 — 전부 그대로다.
- 여기서 발견된 결함은 **보고**이며, 이 문서 자체는 어떤 코드도 수정하지 않았다.

## 6. 인덱싱

`docs/evidence/INDEX.md` §4 (Repository audits — not live runs)에 이 문서의 행이 있다.
그 섹션은 이 감사를 위해 새로 만들었다: INDEX §1–§3은 **실행된 런**의 기록이고 이 문서는 런이 아니므로
§1에 넣으면 rule 4("Outcome은 런이 보여준 것")를 어기게 된다. 규칙 1의 목적(**어떤 증거 문서도
inbound reference 없이 남지 않는다** — Coupang `ORDER_SUMMARY`가 2주간 잘못 기록돼 있던 기계적 원인)은
그대로 충족한다.
