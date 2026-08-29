# Reviewnary Agentic Operating Workspace v2

**Date:** 2026-08-27 · **Branch:** `feat/proactive-operations-agent-v1` · **Scope:** `agent-runtime/` (conversation
service, tools, specialists), `frontend/` (conversation-first home, contextual panel, artifacts), `backend/`
(one READ endpoint, planner schema v3, a closed tone hint on the existing draft path). Marketplace WRITE 0.

This package changes the product's **primary interaction model**. It is not a polish of the home and it is
not "a chat UI on the home". The AI operator now carries a conversation: it understands a request against
what it showed one turn earlier, plans with the LLM planner, reads bounded seller-operations tools, prepares
a reply through the production draft path when asked, asks the seller for exactly one step when it cannot
proceed, returns **structured artifacts** from a closed vocabulary, and hands off to the existing Human
Approval when the seller says 「보내자」. The deterministic shortcuts that used to intercept free text are
demoted to exact-match chips.

Canonical companions, unchanged in authority: `docs/sellerops_operator_graph_v2.md` (LLM-first planning —
no keyword planner in product, test or emergency use; tool catalogue 100% READ), `docs/sellerops_live_approval_
contract.md` (marketplace WRITE only through an approved Human checkpoint), `docs/reviewnary_design.md` v3 §8
(the conversation-first surface).

---

## 1. Old interaction — root cause of the wrong canned answer

`frontend/src/lib/commandIntents.ts` (Agent Command Center v1) matched a sentence when it contained **any**
SHOW verb (「보여」「알려」「목록」…) **and any** noun of an intent (「문의」「리뷰」「할 일」). 「오늘 새로 달린
리뷰 보여줘」 therefore resolved to `REVIEW_ISSUES` and the home rendered the *repeated review problems*
object — 「리뷰에서 반복되는 문제 / 반복해서 나타나는 문제는 아직 없습니다」 — for a question about
**today's new reviews**. The sentence never reached the planner. Three other things made the wrong answer
look final:

| # | where | what |
|---|---|---|
| 1 | `commandIntents.matchCommandIntent` | verb+noun containment, not equality — a palette that behaved as a keyword router |
| 2 | `agent-runtime` OPERATOR lane | no conversation: every run a fresh thread, `resume` = `409 NO_CHECKPOINT`; nothing remembered what the previous answer showed |
| 3 | tool catalogue | no review **rows** tool (only repeated-issue signals and per-product counts) and no order/sales tool — 「오늘 새 리뷰」 and 「이번 주 매출」 were unanswerable even by a correct plan |
| 4 | protocol | one blocking HTTP call; no stage protocol, so the UI could only show a clock |

## 2. New interaction model

```
Conversation → Understand → Plan (LLM) → Observe / Tool use → Investigate → Decide → Prepare
→ Ask the seller only when necessary → Artifact → Follow-up → Workspace when deeper handling helps
→ Human Approval → Execute (existing Executor) → Verify → Memory
```

- **Understand.** A turn carries the seller's sentence plus structured hints (`productId` / `workItemId` /
  `channelCode` / `surface`) exactly as the contextual panel did. The runtime adds **conversation context** to
  the planner through the existing `priorContext` seam as one closed-vocabulary line —
  `직전 작업 집합: REVIEWS (기간:TODAY, 채널:전체, 평점:ALL, 상품 특정:아니오)` — never a count, an id or a
  customer word (the plan payload floor is unchanged).
- **Plan.** The LLM planner (`agent-plan-prompt/v3`) now also states `requestedAction` (`NONE` /
  `PREPARE_INQUIRY_DRAFT` / `REQUEST_SEND_APPROVAL` / `OPEN_WORKSPACE`), closed `filters` (`period`, `rating`,
  `channel`, `scope = WORKING_SET|ORG`, `topic`), a `target` (`FIRST` / `NTH` / `ALL` / `THIS`) and a `tone`
  hint. A follow-up such as 「안 좋은 것만」 is a plan with `scope=WORKING_SET, rating=LOW` over the same need
  kind — **interpreted by the planner, not by a keyword table**. A run without a plan still fails.
- **Observe.** Three READ tools were added to the catalogue (§5); the catalogue is still 100% READ and the
  privileged plane is still absent (`privilegedPlaneFence.test.ts`).
- **Prepare.** `PREPARE_INQUIRY_DRAFT` runs the production draft path (`POST /api/inquiries/{id}/draft/generate`)
  for the targeted inquiry — the same call the inquiry screen and the Proactive agent make, charged to the
  same daily budget. It is a PREPARE step in the conversation service, **outside** the Operator tool registry
  (`conversationWriteFence.test.ts`).
- **Ask.** `HUMAN_ACTION_REQUIRED` is a first-class turn status (`WAITING_HUMAN`), not a failure (§6).
- **Artifact.** The answer is `TurnView { message, artifacts[], suggestedActions[], continuation }` (§4).
- **Approval / Execute / Verify.** `REQUEST_SEND_APPROVAL` yields an `APPROVAL` artifact bound to the exact draft
  version + fingerprint; the confirm step and `confirmInquiryPublish` are the same Human Approval contract the
  inquiry screen uses; execution and verification remain the backend Action Executor's.

## 3. Deterministic shortcut policy

`matchCommandIntent` now matches only a **normalized exact** sentence (a chip label, tolerating trailing
「요/줘/주세요」 and punctuation). 「오늘 새로 달린 리뷰 보여줘」 does not match anything and goes to the
planner. A matched chip renders a local, non-persisted turn labelled as such (no model, no runtime call).
Suggested prompts are examples, not a capability list; the composer accepts anything.

## 4. Artifact protocol (closed vocabulary)

`agent-runtime/src/conversation/contract.ts` (mirror: `frontend/src/lib/conversation/types.ts`).

`SUMMARY · METRIC · LIST · TABLE · REVIEW_LIST · INQUIRY_LIST · PRODUCT_LIST · ISSUE_LIST · ORDER_SUMMARY ·
CHART · DRAFT · EVIDENCE · CHECKLIST · HUMAN_ACTION_REQUIRED · APPROVAL · EXECUTION_RESULT · WORKSPACE_LINK`

Rules: the model never names a component; content comes from tool evidence; a result with no dedicated
artifact is a `LIST`/`TABLE`/`SUMMARY`; internal locators, provenance strings and raw enums are not artifact
fields. Fields marked *transient* (review preview, inquiry title, draft body) are on the live turn and
stripped before persistence (`persistableTurn`).

## 5. Conversation state

Durable through the existing org-scoped run-state seam (`/api/agent-run-store`, domain `CONVERSATION`, 256 KB
cap) in the `spring` store kind; file/memory kinds for local dev. Persisted: turns (≤ 40, transient fields
stripped, lists ≤ 20 rows), `workingSet` (kind, closed filters, ≤ 50 ids, product ids, work-item ids in shown
order), `pendingHumanAction`, `pendingPrepared`. Not persisted: the operator answer, previews, titles, draft
bodies, raw marketplace payloads. The current conversation id lives in the browser (`localStorage`) so a
navigation or reload continues the same thread; 「지난 대화」 lists recent conversations by the seller's own
first sentence.

## 6. HumanActionRequired and review freshness

When the plan asks for recent/new reviews and a connected review-capable channel's REVIEW coverage is
`OBSERVED_FRESHNESS_UNPROVEN` or has no collection inside the window, the runtime **does not say 0**. It
returns the rows it does hold, a `HUMAN_ACTION_REQUIRED` artifact per such channel (`REVIEW_IMPORT`, path
`MANUAL_SYNC` for the Cafe24 API, `ACTION_WINDOW` for Coupang, `FILE_UPLOAD` for NAVER) and the turn ends
`WAITING_HUMAN` with `pendingHumanAction`. The seller takes the one step in the existing flow; completion is
detected on the existing `SyncJob` seam (`/api/sync-runs`, a run finished after `requestedAt`), the original
request is re-run with `resumeOfTurnId`, and the message opens with 「새 리뷰 가져오기가 끝났습니다. 계속
확인하겠습니다.」. The same contract carries `KNOWLEDGE_ENTRY` (a `NO_ANSWER_BASIS` draft) without a generic
workflow engine.

## 7. Progress protocol

`POST /api/conversations/{id}/turns` with `Accept: text/event-stream` streams `stage` events for the stages
the runtime actually reaches — `UNDERSTANDING → PLANNED → READING(specialist) → JUDGING → COMPOSING
[→ PREPARING_DRAFT | WAITING_HUMAN]` — then one `turn` event. The UI renders exactly the received stages
with a measured clock; there is no bar and no client-side timeline.

## 8. Safety / grounding (unchanged floors)

Tool catalogue READ-only (structural tests); no marketplace WRITE outside the approved Human checkpoint;
drafts come only from the production composer (Product Knowledge → org policy → OrderFact → applicability;
style never overrides facts — the tone hint edits the style section only, the facts section is byte-identical);
`NO_ANSWER_BASIS` writes nothing and asks for knowledge; planner payload floor unchanged; conversation
snapshots carry no customer text; logs carry no text or ids.

---

## 9. Channel capability reasoning (2026-08-28 completion)

The seller says 「오늘 리뷰 확인해줘」 or 「첫 번째 거 답변해줘」 and never learns which channel has an API. The runtime
decides, per channel × object, from **existing code-level registries** — never from a new table and never from the
channel label alone:

| Axis | Closed values | Source read by the runtime |
|---|---|---|
| Acquisition | `AUTOMATIC` · `GUIDED_HUMAN_ACTION` · `UNSUPPORTED` | `GET /api/channels/{code}/capabilities/overview` (`AcquisitionPath{method, verificationStatus, recurrence}` — API+SCHEDULED ⇒ AUTOMATIC; ACTION_WINDOW/EXPORT ⇒ GUIDED; none ⇒ UNSUPPORTED) |
| Execution | `API_EXECUTION` · `GUIDED_BROWSER_EXECUTION` · `NOT_SUPPORTED` | inquiries: `GET /api/inquiry-publish/transports` + `/capability` per (channel, `sourceSubtype`); reviews: `ReviewChannelCapabilityView.executionKind` |
| Identity | `MARKETPLACE` · `NONE` | backend `executableIdentity` on every inquiry/review item (§10) |
| Freshness | `FRESH` · `UNPROVEN` · `NOT_COLLECTED` · `NOT_SUPPORTED` · `NOT_CONNECTED` | coverage rows + this conversation's own completed collections (§6) |

**Acquisition ≠ freshness.** Capability says *how* a channel can be refreshed; freshness says whether the stored rows
answer *this* question. `AUTOMATIC + stale` ⇒ the operator refreshes by itself (stage 「최신 자료를 새로 가져오고
있습니다」, the product's own one-press collection, once, honest on failure — never a HumanAction, never fake
freshness). `GUIDED_HUMAN_ACTION + stale` ⇒ `HUMAN_ACTION_REQUIRED` with the guided path. `FRESH` ⇒ read now.

## 10. Source identity vs executable identity

`channel = NAVER` on a stored row does **not** make it a NAVER marketplace object. `executableIdentity = MARKETPLACE`
is decided by the backend from stored **acquisition provenance** — a trusted marketplace/API run or a reviewnary-minted
guided export/read (single-use run ref, paired local agent, observed download or read, trusted ingest handoff), an
exact org + seller-account binding on an API-mode account, and a provider object identity. The namespaced external id
(`naver-qna:` / `naver-payinq:` / `onlineInquiry:` / `cafe24:b…`) is used to **parse** the provider id, never as the
trust decision. An arbitrary CSV/xlsx upload, ESM Excel, or any user-controlled input stays `NONE` whatever its channel
label — it gets drafts and copy, never an approval, a guided execution or an API write. `PreSendCheck`
(`SYNTHETIC_TARGET`, `NO_TARGET_SNAPSHOT`, …) remains the backend backstop.

## 11. Review freshness claim levels

| Level | Evidence | Sentence shape |
|---|---|---|
| A | completeness of an observed time interval is proven | 「10:12부터 15:41 사이 네이버에 새로 작성된 리뷰가 7건 있어요」 — **never claimed today** (no channel proves interval completeness) |
| B | this collection's rows carry their written date inside the window | 「이번에 확인한 네이버 리뷰 중 오늘 새로 작성된 리뷰가 7건 있어요」 |
| C | only the count of rows newly ingested is known | 「네이버에서 이전에 없던 리뷰 7건을 새로 가져왔어요」 |

`newly ingested ≠ newly written` is pinned by test; a channel-wide freshness claim is never made from an upload or
import the coverage service does not count.

## 12. Guided acquisition (product contract)

reviewnary prepares the exact seller-center screen and period; the seller performs only the confirmations the platform
itself requires (a download, a consent — several clicks are fine); reviewnary detects the download or the read, ingests,
resumes the original request and shows the result. What is removed is the operational friction: menu navigation,
finding the period and the download location, finding the file, uploading it into reviewnary, re-typing the request,
and checking completion by hand. 「한 번 클릭」 is not a guarantee. Paths: NAVER `EXPORT_ACTION_WINDOW` (existing
`EXPORT` run → download listener → `SELLER_CENTER_EXPORT` ingest), Coupang `WING_READ_ACTION_WINDOW` (new
`REVIEW_ACQUISITION` run over the existing WING reader → `SELLER_CENTER_READ` handoff), Cafe24 automatic. When no
local agent is paired the artifact still names the guided path and offers pairing inline; file upload is the explicit
fallback, never the default.

## 13. Guided browser execution (NAVER review reply)

`GUIDED_EXECUTION`: reviewnary locates the exact review (target hint + review-id fingerprint), opens the reply editor,
and **fills the approved draft only after the identity check passes**; the final submit is the seller's click
(automatic submit count is 0 by structural test; ambiguity ⇒ fail-closed, nothing typed). State contract:
`DRAFT_PREPARED → COMPOSER_FILLED → SELLER_SUBMISSION_OBSERVED → (read-back) → VERIFIED`. Because the seller may edit
in the NAVER UI before submitting, `COMPOSER_FILLED`/`SELLER_SUBMISSION_OBSERVED` never promote to a "sent as
approved" Memory; NAVER has no content read-back today, so the strongest recordable state is
`SUBMISSION_OBSERVED_CONTENT_UNVERIFIED`. Product-owner decisions recorded 2026-08-28: the earlier deliberate
no-typing rule in the reply driver is lifted under these conditions, and `reply/naver` becomes a resident on-demand
carrier.

## 14. Channel capability matrix

Status words: **IMPLEMENTED** (code + tests) · **LOCAL_PROVEN** (exercised against the local stack / fixture DOM) ·
**LIVE_VERIFIED** (a real marketplace run recorded in `docs/evidence/INDEX.md`) · **LIVE_UNPROVEN** (implemented,
no live run) · **NOT_SUPPORTED** · **BLOCKED_BY_PASSWORD_SOURCE**. "The API exists" is never written as verified.

| Channel | Object · action | Acquisition | Execution | Status |
|---|---|---|---|---|
| NAVER | 상품 · 주문 read | AUTOMATIC (API, scheduled) | — | LIVE_VERIFIED (routine runs) |
| NAVER | 상품 문의 (Q&A) read → grounded draft → approval → API reply → read-back | AUTOMATIC | API_EXECUTION (`PUT qnas/{questionId}`) | read LIVE_VERIFIED · reply **LIVE_VERIFIED** (2026-08-26) · conversation path LOCAL_PROVEN |
| NAVER | 고객 문의 (네이버페이) read → draft → approval → API reply → read-back | AUTOMATIC | API_EXECUTION (`POST pay-merchant/inquiries/{inquiryNo}/answer`) | read LIVE_VERIFIED · adapter IMPLEMENTED · reply **LIVE_UNPROVEN** |
| NAVER | 리뷰 acquisition (guided export → download detected → launch-bound ingest → resume) | GUIDED_HUMAN_ACTION (`EXPORT_ACTION_WINDOW`; the conversation mints a bounded launch and starts the TRUSTED `import/naver` carrier — §24; fallback file upload) | — | export path LIVE_PROVEN (2026-07-15 / 08-23 partial) · conversation start + auto-resume IMPLEMENTED · LOCAL_PROVEN (file path on the QA org: stale → upload → detect → resume → rows; the launch-bound start is unit-proven) · guided-from-conversation **LIVE_UNPROVEN** (needs a paired helper + seller-center session). **Before §24 this row was unwired**: the card started a v1 `export` carrier that only a dev fixture hosts. |
| NAVER | 리뷰 analysis / triage / draft | — | — | IMPLEMENTED · LOCAL_PROVEN (draft prepared in conversation, triage recorded from the seller's sentence) |
| NAVER | 리뷰 guided reply (locate by review-id ladder → **runtime presses 「답글 작성」** → composer in that row → fill → seller submit → observe) | — | GUIDED_BROWSER_EXECUTION (`reply/naver` resident carrier, `OPEN_COMPOSER` + `FILL_COMPOSER`, target spent at `POST /api/agent/reply-submission-targets`) | IMPLEMENTED · LOCAL_PROVEN (**real-DOM proof**: `ladder-open-composer-browser.test.ts` — the runtime's own press opens the exact row's composer, fills the draft, `__submitClicks` 0; automatic submit 0 by guard) · **LIVE_SUBMIT_UNPROVEN**; on the Demo Org the stored NAVER reviews carry no trusted acquisition binding ⇒ identity `NONE`, so the card is not offered live. **Before §24 this row was unreachable**: the target endpoint did not exist and the seller opened the composer. |
| Cafe24 | 상품 · 주문 read | AUTOMATIC | — | LIVE_VERIFIED |
| Cafe24 | 문의 read → draft → approval → API reply (child article) → verify | AUTOMATIC | API_EXECUTION | **LIVE_VERIFIED** (2026-08-25) · conversation path LOCAL_PROVEN |
| Cafe24 | 리뷰 automatic acquisition (+ agent self-refresh when stale) | AUTOMATIC (`manualSync` on demand) | — | acquisition LIVE_VERIFIED (2026-07-30) · self-refresh IMPLEMENTED · LOCAL_PROVEN (attempted live with connectors OFF ⇒ honest failure) |
| Cafe24 | 리뷰 analysis / draft | — | — | IMPLEMENTED · LOCAL_PROVEN (draft v1 prepared live) |
| Cafe24 | 리뷰 seller comment (approval → `POST comments` → hash read-back) | — | API_EXECUTION (flag + `mall.write_community` grant) | IMPLEMENTED · LOCAL_PROVEN · **LIVE_UNPROVEN** (`docs/cafe24_review_comment_execution_v1.md`; live shows 「전송이 이 배포에서는 아직 켜져 있지 않습니다」) |
| Coupang | 상품 · 주문 read | AUTOMATIC | — | LIVE_VERIFIED |
| Coupang | 지원 문의 (`onlineInquiries`) read → draft → approval → API reply | AUTOMATIC | API_EXECUTION (`v4 replies`) | read LIVE_VERIFIED (2026-08-14) · adapter IMPLEMENTED · reply **LIVE_UNPROVEN** |
| Coupang | 리뷰 guided acquisition (WING read from a conversation) | GUIDED_HUMAN_ACTION (`WING_READ_ACTION_WINDOW`, `acquire/coupang` resident carrier, `REVIEW_ACQUISITION` intent) | — | seated CLI LIVE_PROVEN (2026-08-15) · conversation-startable IMPLEMENTED · LOCAL_PROVEN (fixture driver) · **LIVE_UNPROVEN** |
| Coupang | 리뷰 analysis | — | — | IMPLEMENTED · LIVE (rows shown) |
| Coupang | 리뷰 reply | — | **NOT_SUPPORTED** (`CHANNEL_UNSUPPORTED`) | truthful sentence + next-step chips, no draft, no CTA — LOCAL_PROVEN live |

Identity gate everywhere: file-imported rows (manual CSV, ESM) are `NONE` — draft/copy only. Proven live on the QA org's
uploaded NAVER reviews and on the Demo Org's operator-era NAVER exports (no launch binding ⇒ `NONE`).

## 15. Proof matrix (A–L + capability completion) — 2026-08-27/28, Demo Org unless noted

All runs: real backend + agent-runtime + Vite on this machine, **LLM planner ON**, connectors OFF (no marketplace
call is possible from this stack), marketplace WRITE **0**, automatic submit **0**. Model calls are the planner
(1 per turn, +1 on a repair) and the rule judge; the review/inquiry drafts are the product's own composers.

| Bar | Sentence(s) actually used | Result | Status |
|---|---|---|---|
| A free-form review request | 「지난 7일 동안 들어온 상품평 좀 보여봐」 | `REVIEW_LIST(23)`, 7 products, freshness per channel | PASS (live) |
| B stale → human step → acquisition → resume | 「오늘 리뷰 뭐 들어왔어?」 on the QA org → `HUMAN_ACTION_REQUIRED NAVER/EXPORT_ACTION_WINDOW` (fallback 파일 업로드) → the seller uploads through the product's upload page → the finished SyncJob is detected → `resumeOfTurnId` → 「새 리뷰 가져오기가 끝났습니다. 계속 확인하겠습니다.」 + `REVIEW_LIST(2)` with **Level-B wording** 「이번에 확인한 네이버 스마트스토어 리뷰 중 오늘 작성된 리뷰는 2건입니다」 | PASS (live, browser) — guided export path itself LIVE_UNPROVEN | 
| C working-set follow-up | 「그중 안 좋은 것만 봐줘」 → 「방금 본 23건 중 낮은 평점 리뷰는 0건」; no second collection asked (R1) | PASS (live) |
| D review → inquiry cross-domain | 「문의에서도 같은 문제가 있는지 봐줘」 over a 7-product review set → product-anchored inquiry read | PASS (runtime harness live-shaped; live: honest empty) |
| E inquiry → grounded draft | Demo Org: every targeted inquiry is `NO_ANSWER_BASIS` (no knowledge) ⇒ honest `DRAFT` without a version + `KNOWLEDGE_ENTRY` step; grounded path covered by the runtime harness and the backend composer suite | PASS (contract) · grounded LIVE only on an org with knowledge |
| F style follow-up, facts unchanged | review draft 「조금 더 부드럽게 써줘」 → same envelope, honest 「말투를 바꾸지 못했습니다」 when the product suggestion is unchanged; inquiry tone: `AnswerStyleDraftTest` C2 (facts bytes identical) + runtime `factualEnvelope` refusal test | PASS |
| G send intent → capability-correct action | Cafe24 inquiry 「첫 번째 거 보내자」 → 「전송이 이 배포에서는 아직 켜져 있지 않습니다」 (execution flag off); Cafe24 review 「좋아 게시해」 → same honest reason; NAVER review → identity `NONE` on operator-era exports ⇒ 「파일로 가져온 기록이라 채널로 보낼 수 없습니다」; Coupang review → 「쿠팡에서는 … 지원하지 않습니다」 + 4 next-step chips. `APPROVAL` / `GUIDED_EXECUTION` artifacts: runtime + frontend suites | PASS (capability-correct, WRITE 0) |
| H sales question → chart | 「이번 주 매출 왜 이래?」 → `ORDER_SUMMARY` + `CHART` (14-day window, delta, channels) | PASS (live) |
| I follow-up channel filter keeps the window | 「카페24 때문인가?」 → same 14-day window, channel CAFE24 | PASS (live) |
| J workspace handoff → continuity | artifact link → `/reviews/{account}` with the panel open, 3 turns visible, a 4th sent from the panel; back home 5 turns; reload keeps the thread | PASS (browser) |
| K proactive truthful zero | 「오늘 먼저 확인한 일은 없습니다」 (Demo Org has 0 cases) | PASS |
| L no canned misclassification | 「오늘 새로 달린 리뷰 보여줘」 → planner → freshness/human step; 「내일 날씨 어때?」 → `GOAL_UNSUPPORTED`; 「문의 화면 열어줘」 → `WORKSPACE_LINK` | PASS (live) |
| §13 multi-channel review request | 「오늘 새 리뷰 확인해줘」 → Cafe24 `REFRESHING` (attempted, honest failure with connectors off) · NAVER `EXPORT_ACTION_WINDOW` card · Coupang `WING_READ_ACTION_WINDOW` card · 「일단 확인된 리뷰 보기」 shows held rows without re-asking | PASS (live) |
| §10 capability explanation | 「쿠팡 건은 왜 답변 못 해?」 → `EXPLAIN_CAPABILITY` → two honest sentences + next-step chips, model 1, tool 0 | PASS (live) |

## 16. Source identity vs executable identity — proof

`ExecutableIdentityResolverTest` (backend): connector-written NAVER Q&A row ⇒ MARKETPLACE; CSV upload row with channel
NAVER and external id `naver-qna:123` ⇒ **NONE**; guided-export row (`SELLER_CENTER_EXPORT` + launch binding) ⇒
MARKETPLACE; Coupang handoff row ⇒ MARKETPLACE; Cafe24 board-4 review with its article row ⇒ MARKETPLACE, without ⇒
NONE. Live: the QA org's uploaded NAVER reviews and the Demo Org's operator-era NAVER exports both resolve `NONE`
and the conversation offers copy only. Runtime: `sourceIdentity` gating in `ConversationService` (approval /
guided / API only on `MARKETPLACE`).

## 17. HumanActionRequired · resume · guided proofs

- Resume contract: `pendingHumanActions[]` (per channel), completion detected on the `SyncJob` seam by account **or**
  by channel + `uploadType` (a file upload has no account/dataType), `collected` carried into the re-run so the
  channel reads FRESH for the window; partial completion prompts the next channel. Runtime tests: `liveResumeProof`,
  `liveQaFollowups`, `scopeOverride`, `conversationService` B.
- Guided acquisition from a conversation: Coupang `REVIEW_ACQUISITION` runs through the `acquire/coupang` resident
  carrier (`acquisitionRef` mint); NAVER runs through the TRUSTED `import/naver` carrier on a launch the conversation
  mints (§24 — the v1 `export` start this section first described was hosted by nothing but a dev fixture).
  **LIVE_UNPROVEN** here — this machine has no paired helper session against a seller center in this package.
- Guided NAVER reply: `GUIDED_EXECUTION` card → `submission-run` mint (the intent bound to account · channel ·
  identity · mode · deadline, V86) → the Local Agent spends the ref at `POST /api/agent/reply-submission-targets`
  (every approval gate re-asked NOW; single-use) → `REPLY_SUBMISSION`: ladder locate by the backend's review-id
  fingerprint → **`OPEN_COMPOSER` — the runtime's own press on the row's non-submit control** → composer inside that
  row's scope → `FILL_COMPOSER`; ambiguity opens/fills nothing and asks the seller for exactly that step; submit is
  the seller's click — **automatic submit 0** by the source guard (`.click(` exists in `reply-composer-open.ts` only,
  once); state `COMPOSER_FILLED → SELLER_SUBMISSION_OBSERVED → SUBMISSION_OBSERVED_CONTENT_UNVERIFIED`, never a
  strong Memory. **LIVE_SUBMIT_UNPROVEN.**
- Cafe24 review comment: `docs/cafe24_review_comment_execution_v1.md` — IMPLEMENTED · LOCAL_PROVEN · **LIVE_UNPROVEN**.

## 18. Telemetry

Frontend `analytics/events.ts` (closed props): `conversation_started`, `conversation_turn_sent{surface}`,
`agent_result_shown{status}`, `artifact_shown{type}`, `artifact_opened{type}`, `human_action_requested{type}`,
`human_action_completed{type}`, `approval_opened`, `conversation_resumed`. Runtime logs (sanitized, no text/ids):
`conversation_started`, `conversation_turn{status, toolCalls, llmCalls, ms, artifactTypes, workingSetKind,
requestedAction}`, `conversation_human_action`, `conversation_resumed`, `conversation_refresh`,
`conversation_review_triaged`, `operator_scope_override`, `operator_stage`, `operator_tool_call`.

## 19. Browser QA (Chromium, real stack)

Pass 3 (`ui.mjs`): home 0/3/5/10 turns, composer above the fold at 1440×900 (y 328 → 679 with turns), 1366×768 and
1152×720, horizontal scroll 0, **AA text-node violations 0 on the home at every state**; workspace handoff + panel
continuity + reload continuity; off-host requests 0; console errors 0 after the token-gated helper probe. Capability
pass (`ui2.mjs`): multi-channel cards with 「지금 네이버 스마트스토어 리뷰 가져오기」 / 「지금 쿠팡 리뷰 가져오기」 /
「계속 확인하기」, Cafe24 draft + honest disabled execution, NAVER identity-none sentence, Coupang unsupported + chips,
Cafe24 preview rendered as plain text (markup stripped server-side), writes 0. One pre-existing AA miss on the
`/reviews` page itself (「승인」 4.4:1, `VocItemReplyPrep`) — not a conversation element, reported not fixed.
Screenshots: scratchpad only (`v2/shots/pass3`, `v2/shots/cap2`, `v2/shots/resume`).

## 20. Free-language QA (no per-sentence branch anywhere)

Used live: 오늘 리뷰 뭐 들어왔어? · 지난 7일 동안 들어온 상품평 좀 보여봐 · 그중 안 좋은 것만 봐줘 · 상품별로 묶어줘 ·
문의에서도 같은 문제가 있는지 봐줘 · 오늘 새 리뷰 확인해줘 · 일단 확인된 리뷰 보기 · 쿠팡 건은 왜 답변 못 해? ·
최근 한 달 카페24/네이버/쿠팡 리뷰 보여줘 · 첫 번째 거 답변해줘 · 첫 번째 리뷰 답변해줘 · 좋아 게시해 ·
네이버에서 답변하게 열어줘 · 조금 더 부드럽게 써줘 · 어제 온 문의 중 내가 답해야 할 거? · 배송 얘기부터 처리하자 ·
첫 번째 거 답장 써줘 · 좀 덜 딱딱하게 · 좋아 이거 보내자 · 오늘 내가 답해야 할 네이버 문의 정리해줘 · 첫 번째 답변
써줘 · 좋아 보내자 · 이번 주 매출 왜 이래? · 카페24 때문인가? · 그때 고객 반응도 달라졌어? · 내가 해야 할 일 정리해줘 ·
요즘 문제 생기는 상품 있어? · 첫 번째 거 자세히 봐줘 · 내일 날씨 어때? · 문의 화면 열어줘.
Defects found by these sentences and fixed in this package: canned intent interception, filter follow-up re-firing
the gate, empty filtered set losing the anchor, headline repeats, product-health with no object, ordinal over
products, TODAY zero wording, WORKING_SET over a new period, product hint from a one-row set, UTC 「오늘」,
upload-shaped completion, NOT_SUPPORTED coverage on manual-path channels, review reply needing 「대응 필요」,
Coupang draft for an unsupported channel, tone "change" that changed nothing, duplicated lists after a replan,
navigation target from a mention, no channel filter on the inquiry workload.

## 21. Tests

Final full run (2026-08-28): backend `./gradlew test` BUILD SUCCESSFUL · agent-runtime 559 (+ typecheck) · collector
9,302 passed / 150 skipped · frontend 206 files / 2,544 passed (+ typecheck). Failures 0. New/changed suites named in the lane reports and §15–§17. Structural fences kept: planner fence,
privileged plane, tool registry READ-only, conversation write fence (two named PREPARE/REFRESH exceptions),
reply-submission source guard (fill only in `reply-composer-fill.ts`, submit tokens nowhere), Answer Memory never
reads a review execution, comment client posts once, password ephemeral.

## 22. Counts

Marketplace calls **0** · marketplace WRITE **0** · automatic submits **0** · model calls: planner 1–2 per turn
across ≈ 60 live turns (+ 0 judge — rule judge locally) · DB rows written outside the product's own flows: 0 (QA org
rows came through signup / file-channel / upload endpoints). Cloud resources created: 0.

## 23. Remaining limitations before an external pilot (as amended by §24)

1. Every guided path that reaches a seller center (NAVER export/reply, Coupang WING read) is LIVE_UNPROVEN from a
   conversation — it needs a paired helper and a seller-center session under an approval manifest. These are the
   only **external-only** proof gaps left; the repository paths are connected (§24).
2. Cafe24 review comment: `password` acceptance for a mall-authored comment is the one open contract question.
3. NAVER customer-inquiry reply and Coupang inquiry reply adapters exist but have never been run live.
4. Grounded inquiry drafts need an org with Product Knowledge; the Demo Org's open inquiries are all `NO_ANSWER_BASIS`
   (proven on the QA org instead — §24 E).
5. Planner latency 7–38 s per turn remains the dominant wait (no change in this package).
6. The old NAVER export rows carry no acquisition binding, so their guided reply is refused by design until a
   guided export re-acquires them.
7. `/reviews` page's 「승인」 button contrast (pre-existing).

## 24. Acceptance Closure (2026-08-28)

A read-only acceptance audit of `29aac9b2` found repository-side gaps behind the labels above. This section is the
closure: each item, the verdict before, what changed, the verdict after. Nothing in it is a live marketplace
action; every "PASS" below is a code path plus a test or a bounded proof named by file.

| # | Audit item | Before | Change | After |
|---|---|---|---|---|
| 1 | NAVER guided reply reachable | **MISSING** — `POST /api/agent/reply-submission-targets` did not exist; the resident carrier died `SUBMISSION_REF_REFUSED`; observations posted `submissionRef: ""` | `ReviewReplySubmissionTargetService` + `AgentReplySubmissionTargetController`: spends the ref once (conditional UPDATE), refuses expired · reused · cross-org · pre-V86 · stale draft · non-marketplace · non-approved · answered · not-대응 필요; returns account · actionRef · hint · as-of date · review-id fingerprint · approved body/version/fingerprint · operation · mode. The real `submissionRef` now travels to `…/execution/observe`. | PASS — `ReviewReplySubmissionTargetServiceTest` (5) |
| 2 | Agent opens the composer | **MISSING** — the seller's own click at a row-open barrier | `OPEN_COMPOSER` stage (engine · session · stages); `reply-composer-open.ts` is the ONE module allowed to `.click(` (source guard: exactly one site, no submit tokens); ambiguity/NOT_FOUND falls back to the seller's own row-open step | PASS — `open-composer.test.ts` (11), real DOM `ladder-open-composer-browser.test.ts` (2) |
| 3 | Composer scoped to the exact review; `reviewIdVerdict` wired | **PARTIAL** — document-wide composer, verdict never supplied in production, hint-only fill allowed | `NaverLadderReplyDriver`: identity by the review-id ladder (fingerprint on exactly one row, rating only as a contradiction check), composer searched inside that row's exclusive scope (`reply-row-composer-inpage.ts`), `reviewIdVerdict()` answered by the driver; `composerFillDecision` refuses `UNAVAILABLE` | PASS — same suites; `guided-fill-reply-driver.test.ts` |
| 4 | NAVER guided acquisition has a live carrier | **MISSING** — the card started a v1 `export` carrier hosted only by a dev fixture | Option B: the card mints a bounded launch on the account's plan (`selected-range` / reuse open plan → `extend` → `next-segment`) and starts the TRUSTED `import/naver` carrier (`launchRef`, `SEGMENT`), whose ingest is `/launches/{ref}/ingest` = `SELLER_CENTER_EXPORT` + launch binding ⇒ V83 stamp ⇒ MARKETPLACE | PASS (repo) · LIVE_UNPROVEN (seller center) — `HumanActionArtifact.test.tsx` |
| 5 | Completion matching (FE) | **PARTIAL** — polled by `sellerAccountId,dataType`; an export ingest (`null,null,uploadType`) never matched | `runsOfThisStep`: this account's run, or an upload-shaped run on this account's channel with the requested `uploadType`; never another account's | PASS — `ConversationProvider.test.tsx` |
| 6 | Approval/action binding (correction B) | **PARTIAL** — 4/9 fields; no v1→v2 test; `observe()` no head recheck | V86: the guided intent (`review_reply_submission_ref`) binds seller account · channel · executable identity · operation `REVIEW_REPLY` · execution mode · deadline · single-use; `observe()` re-checks the approved head and the account; the execution row already binds account · channel · lane · version · fingerprint | PASS — v1→v2 regressions in `ReviewReplyExecutionServiceTest` (execute 409, POST 0; observe 409, ledger 0) and `ReviewReplySubmissionTargetServiceTest` (target refused) |
| 7 | Cafe24 double-post · service tests | **PARTIAL/MISSING** | `ALREADY_EXECUTED`: a NEW command id against a review already POSTED/DELIVERY_UNKNOWN is refused before the transport; `uq_review_reply_execution_api_sent` partial unique index is the race boundary | PASS — `ReviewReplyExecutionServiceTest` (12: approval · identity · account/channel · disabled · ANSWERED · same-command replay · new-command fence · DELIVERY_UNKNOWN · read-back) |
| 8 | Fake freshness (3 holes) | **PARTIAL** | Refresher: only terminal SUCCESS/PARTIAL with a finish time counts; QUEUED/PENDING ⇒ IN_PROGRESS, unknown ⇒ UNAVAILABLE. `syncCompleted`: account-stamped runs must be this account's; upload-shaped runs only on this channel with the requested type and a seller-driven trigger; PARTIAL carried as partial. `pendingHumanWindow` suppresses the second card, never the gate; a failed/partial refresh keeps the window gated with its own sentence, never 「0건」 | PASS — `acceptanceClosure.test.ts` §8 (7 cases) |
| 9 | Canned-command drift · rows vs issues | **DRIFT/PARTIAL** | 「리뷰 문제 보여줘」 shortcut removed (two exact object operations remain); plan token `filters.reviewIntent ∈ ROWS | ISSUES` (prompt v3 rule, parser, view, runtime); `wantsRows` routes on it; two LIVE planner recordings pinned (`liveRecordedPlans.ts`) | PASS — `acceptanceClosure.test.ts` §9, `AgentOperatorResponseParserTest`, `commandIntents.test.ts` |
| 10 | Coupang capability fence | **PARTIAL** | `CAPABILITY_UNKNOWN` no longer drafts (conversation) and `DraftPreparer.prepareReview` refuses NOT_SUPPORTED/Coupang itself; backend `ReviewReplyService.authorize` refuses a channel with no reply flow (`replyFlowExists`); dead chip 「상세페이지 개선 검토」 replaced by servable prompts | PASS — `acceptanceClosure.test.ts` §10, `ReviewReplyServiceTest` |
| 11 | Server-side identity backstop | **PARTIAL** | `PreSendCheck.NOT_MARKETPLACE_OBJECT` in `InquiryPublishService.revalidate` via the real resolver; ingest-through-service stamp test (`ReviewAcquisitionSpineTest`); runtime NONE-item refusal test | PASS — `InquiryPreSendCheckTest` (+2) |
| 12 | FILE_UPLOAD semantics | **DRIFT** | an EXPORT with no reviewnary carrier is UNSUPPORTED, never a file-upload primary; MANUAL stays a real file path; pairing is a runtime-availability fact the screen resolves | PASS — `channelCapability.test.ts` |
| E | Grounded draft proof | proof gap | QA org: product-bound inquiry + one POLICY knowledge through product endpoints (+ one bounded SQL work-item row — the file path opens no work item by design) → 「배송 얘기부터 처리하자」 → 「첫 번째 거 답변 준비해줘」 → **DRAFT v1 `GROUNDED`** → 「조금 더 부드럽게 써줘」 → **v2 `GROUNDED`, tone SOFTER**, envelope intact (both bodies carry 1~2일 · 2~3일). Found and fixed on the way: the conversation lane never proposed an OPEN item before drafting (409 on a real save; the fake had masked it) — `DraftPreparer` now proposes through the product's own seam, the fake mirrors the backend | PASS |

Also in this closure: the runtime target endpoint records nothing beyond the spend timestamp; no customer text is
returned to the agent except the review body fingerprint and the approved reply; the composer-open click is
bounded by wording (open words only, submit words excluded before the marker is set).

**Re-drive (Demo Org, planner ON, connectors OFF, this tree):** V (natural rows/issues variants) · A7 · M · R · RN · RC ·
N · G · R2 · C · D · L — all as in §15, with the new behaviour visible: 「일단 확인된 리뷰 보기」 re-asks nothing and
still says the window is gated; the failed Cafe24 refresh is said as failed; Coupang chips are the servable three;
the identity-`NONE` NAVER row is refused for the guided card. QA org: E (NEEDS_CLARIFICATION on a 2호 question with
no registered variants — the correct answer) and E2 (GROUNDED, above).

**Suites (this tree, once, after integration):** backend `./gradlew test` BUILD SUCCESSFUL · agent-runtime 577 (+ typecheck) ·
collector 9,364 passed / 152 skipped (+ the real-DOM OPEN_COMPOSER proof under `RUN_INTEGRATION=1`) · frontend 207 files /
2,546 passed (+ typecheck). Failures 0.

**Browser QA (Chromium, real stack restarted from this tree):** home 0/1/3/5/10 turns, workspace handoff + panel follow-up,
reload continuity, 1366×768 and 1152×720 — horizontal scroll 0, console errors 0, off-host requests 0, AA text violations 0 on
every conversation surface (the one 4.4:1 hit is the pre-existing 「승인」 control on the `/reviews` page itself); capability
pass — multi-channel cards (`지금 네이버 스마트스토어 리뷰 가져오기` · `지금 쿠팡 리뷰 가져오기` · `계속 확인하기`), Cafe24 draft +
honest disabled send, NAVER draft + identity-`NONE` refusal, Coupang unsupported + the three servable chips. The only
non-runtime write observed was the review workspace's own `triage-feedback/behavior` event when a review was opened —
existing product telemetry, not a conversation write and not a marketplace call. Screenshots stay in the scratchpad.

**Counts for this closure:** marketplace calls **0** · marketplace WRITE **0** · automatic submits **0** · model calls: planner
1–2 per turn over ≈ 45 live turns (Demo Org re-drive, QA org E/E2, two browser passes) + 2 planner recordings + 4 QA-org
drafts (v1/v2 × 2 inquiries) · DB rows written outside product flows: **2** (the QA org's bounded work-item fixture rows,
documented above) · migrations 1 (V86) · cloud resources 0.

**External-only proof gaps that remain:** NAVER guided export and guided reply against a real seller-center session
(paired helper); Coupang WING read from a conversation; Cafe24 comment POST; NAVER customer-inquiry and Coupang
inquiry POSTs. Each needs a fresh single-use approval manifest.




## 25. Query Accuracy v1 — typed QuerySpec, end to end (2026-08-29)

**Why.** A read-only diagnosis of HEAD `99ff330e` (every sentence run through the live planner with a recording proxy
between the runtime and the backend) showed that the planner read every sentence correctly — object, channel, period,
order, count, status all appeared in its `question`/`filters` — and that the meaning was lost **after** planning:

| sentence | planner said | where it died |
|---|---|---|
| 가장 최근 리뷰 1개만 | ROWS · LAST_7_DAYS · "1개" in prose | `PlanFilters` had no `limit`/`order`; `readRecentReviews` read `size=50` → 13 rows |
| 최근 문의 3개 | INQUIRY_VOLUME · `list_inquiry_workload` · "3개" in prose | `wantsWorkload()` (a heuristic over *other* filters) sent it to the **count** path → 「22건 / 18건」 summary, no artifact, no working set |
| 가장 오래된 문의 1개 | same | same |
| 오늘 들어온 문의 | `period=TODAY` | the period only *gated* the workload path and was never an argument of the read → 2016–2025 rows |
| 오늘 네이버 문의 중 최근 2개 | `period=TODAY, channel=NAVER` | `channel` was stripped by the tool's zod schema (LangChain `tool()` parses and drops unknown keys) → Cafe24 rows |
| 답변 안 한 것만 | INQUIRY_VOLUME | no `status` axis; the only inquiry reads were work-queue phases → the queue summary |
| (follow-up) 답변 안 한 것만 | `scope` unset | the count path had produced no working set, so the planner never saw a 「직전 작업 집합」 line |

Every one of these was a **contract/runtime** defect, not a model defect: 6/6 sentences were understood; 0/6 reached the
tool with their axes intact. Per turn: planner **1** call (no replan, no repair), ~5.4 KB request / ~1.3 KB response,
8–16 s latency = the planner; plus one `POST /api/agent/judge` round-trip per turn to a capability that was **off**
(`available:false`), counted as `llmCalls`.

**What changed (no Text-to-SQL, no new engine).**

- **Planner prompt v4** (`agent-plan-prompt/v4`): four closed tokens — `filters.inquiryIntent ∈ ROWS|WORKLOAD|COUNT`,
  `filters.limit` (int, clamped to 50 by the parser), `filters.order ∈ NEWEST|OLDEST`, `filters.status ∈
  UNANSWERED|ANSWERED|ALL` — with the rule that these are executed **only** from `filters`, never from prose, and that
  `period` is an inquiry's *receipt* window (ROWS only): 「오늘 내가 답해야 할 문의」 is WORKLOAD with no period. The prior
  line the runtime sends now carries `상태:` too. Parser/controller records grew by the same four fields.
- **Inquiry semantics split** (`inquiryIntentOf`, `inquiryOps.ts`): `ROWS` → new `inquiryRowsStep` over a new backend read
  `GET /api/inquiries/rows` (`InquiryRowsService`: ACTIVE·REAL inquiries, window · channel · status · order · limit as
  query parameters, count under the same predicate, the open/proposed work item riding along when one exists);
  `WORKLOAD` → the existing classified queue (now with `channel`, `order`, `limit` honoured; a queue has no receipt
  window); `COUNT` → the existing inbox count. The `wantsWorkload` heuristic is **gone**; the only structural override is
  that a draft/send request or an ordinal target is WORKLOAD (a row without a work item has nothing to draft on).
  Without a token (a v3 plan) the legacy reading is kept so recorded plans keep their meaning.
- **No silent loss**: the workload tool's zod schema names `channel`/`from`/`to`/`order`/`limit`; the rows tool names every
  axis; `list_recent_reviews` takes `order` and the backend reads oldest-first from the window (a new repository query, not
  the newest page reversed); the review limit is applied after the set intersection so 「그중 1개」 stands on the set.
- **ROWS always produces an artifact + working set** (`INQUIRY_LIST` with `scope`, anchored by inquiry ids, the spec
  copied into the set), and a follow-up re-reads with the previous spec as its base, keeps only the previous ids, then
  applies order/limit — 최근 5개 → 그중 네이버만 → 그중 최근 1개 → 답변 안 한 것만 each stand on the set before it. The
  rows keep the requested order on screen (consecutive same-status runs become one group each; a new `ANSWERED` group
  key, the only `frontend/` change besides the nullable `workItemId`).
- **Judge round-trip**: the learned "capability off" state is memoised per org for 10 minutes
  (`SpringEvidenceJudge` memo, keyed by the org the conversation lane already resolves) — one probe per org, not per turn.

**Tests.** Backend: `InquiryRowsServiceTest` (window/order/limit · channel/status · work item + tenancy), parser pins for
the four tokens and their closed sets/clamping, `RecentReviewServiceTest` unchanged and green. Runtime:
`queryAccuracy.test.ts` — the seven sentences and the refine chain, each asserting **Planner filters → exact tool args →
rows → working set**, plus WORKLOAD/COUNT routing, the schema-strip regression, and the judge memo. Two AUTHORED v3
fixtures that carried `period: "TODAY"` on a work-queue sentence were rewritten as v4 (`inquiryIntent: "WORKLOAD"`, no
period) — with a period now reaching the read, the fixture had to say what the sentence means.

**Live re-run (real planner, Demo Org, connectors OFF, marketplace 0 · WRITE 0 · DB rows 0).**

| sentence | planner filters (verbatim) | tool request | result | planner ms |
|---|---|---|---|---|
| 가장 최근 리뷰 1개만 보여줘 | ROWS · LAST_7_DAYS · limit 1 · NEWEST | `/api/reviews/recent?…&size=50&order=NEWEST` | 1 row (title 「· 가장 최근 1건」) | 8,070 |
| 최근 문의 3개 보여줘 | inquiryIntent ROWS · limit 3 · NEWEST (· LAST_7_DAYS) | `/api/inquiries/rows?…&status=ALL&order=NEWEST&limit=3` | 3 newest rows, 「답변 필요 1 · 답변함 2」 | 7,742 |
| 가장 오래된 문의 1개 보여줘 | ROWS · limit 1 · OLDEST · ALL | `…/rows?status=ALL&order=OLDEST&limit=1` | 1 row from 2014-10-27 of 92 | 8,494 |
| 오늘 들어온 문의 보여줘 | ROWS · TODAY | `…/rows?from=2026-08-29&to=2026-08-29&…` | 「오늘 들어온 문의는 없습니다.」 (true today) | 6,634 |
| 오늘 네이버 문의 중 최근 2개만 | ROWS · TODAY · NAVER · limit 2 · NEWEST | `…/rows?from=…&channel=NAVER&…&limit=2` | 「오늘 들어온 네이버 문의는 없습니다.」 | 6,155 |
| 답변 안 한 문의만 보여줘 | ROWS · status UNANSWERED | `…/rows?status=UNANSWERED&order=NEWEST&limit=50` | 22 rows, all UNANSWERED, 2016–2026 (the real backlog) | 9,075 |
| 최근 문의 5개 → 그중 네이버만 → 그중 최근 1개 → 답변 안 한 것만 | ROWS → +scope WS·NAVER → +limit 1 → +UNANSWERED | 4 rows reads, each carrying the previous set's window/channel | 5 → 3 (all NAVER) → 1 → 1 (UNANSWERED); prior line `직전 작업 집합: INQUIRIES (…채널:NAVER, 상태:ALL…)` reached the planner | 7.5–12.2 s |
| 오늘 내가 답해야 할 문의 정리해줘 | WORKLOAD · period null · LIST_ACTIONS | `/api/inquiries?phase=PROPOSED`, `?phase=OPEN` | the queue (20), unchanged behaviour | 8,513 |

Model calls: planner **1 per turn**, 15 turns → 15; replans 0; repairs 0; judge round-trips **1** for the whole session
(first turn of the org; every later turn `llmCalls: 1`). Latency is the planner (6.2–12.2 s); tools 20–90 ms.
Nondeterminism observed and accepted: the planner set `LAST_7_DAYS` on 「최근 문의 5개」 on one of two runs and no period
on the other — both are honest readings and both were executed as stated.

**Reported, not fixed.** 「최근」 with no period is sometimes read as a 7-day window and sometimes as "newest overall";
the answer states which. A NAVER unanswered inquiry with no open work item (a known queue-scope gap) shows as a row with
no draftable target. The prompt is ~5.7 KB per call on a reasoning model with `reasoning-effort: low`; the planner is
still the whole latency budget.

## §26 Freshness Semantics + Seller-facing UX v1 (2026-08-29)

Four facts stay apart and each is allowed to say one thing: **last successful observation** (coverage
`lastSuccessfulSyncAt`, rendered 「오늘 09:12」/「어제 18:40」/「8월 20일」 in seller time — `conversation/asOf.ts`,
mirrored in `frontend/src/lib/conversation/asOf.ts`), **requested window** (the seller's period only — planner v5 no
longer invents 「오늘」 when no period was said; the runtime default window is disclosed in the label), **freshness
verdict** (`freshnessVerdict` unchanged; `isFreshnessRequired` = TODAY/YESTERDAY/THIS_WEEK — only those need current
rows), and **acquisition capability** (AUTOMATIC / GUIDED / UNSUPPORTED, unchanged resolver).

Decision table (`graph/reviewRows.ts`): held rows answer a non-required question **first**; each stale channel gets one
sentence 「{채널} 리뷰는 {언제} 기준입니다.」 and an **offered** step (`HUMAN_ACTION_REQUIRED.optional=true`, turn DONE,
gates nothing, card 「{채널} 리뷰 · 8월 20일 기준 / [최신 상태로 갱신]」). A required question over a stale channel says
「{채널} 리뷰는 {언제} 이후 아직 확인하지 못했어요.」 **once** (the gap finding's statement is that same sentence; the note
is split into sentences before dedupe) and asks for exactly that channel's step (WAITING_HUMAN; NAVER
`EXPORT_ACTION_WINDOW` + file fallback, Coupang `WING_READ_ACTION_WINDOW`). Cafe24 AUTOMATIC+stale is refreshed by the
agent in both cases; a failed refresh is said once with the as-of it falls back to. A stale zero is never 「0건」
(「지금까지 확인한 범위에는 … 없습니다」); a fresh TODAY zero is 「오늘 들어온 리뷰는 없습니다」. Claim levels stay B/C, never A.
The generic warning (`HUMAN_STEP_SENTENCE`) is no longer read; `REVIEW_LIST` carries `freshnessRequired` +
`referenceDate` and no freshness prose — the footer shows 「채널 · 언제 기준」 compactly (stale in warn colour).

Regression: `test/conversation/freshnessUx.test.ts` (14: stale+held result, stale+required, Cafe24 automatic,
NAVER/Coupang guided, partial/failed, unrelated sync ≠ satisfied, resume shows the original request, B/C, offered
refresh resume) + `HumanActionArtifact.test.tsx` (compact/offer) + `ReviewListArtifact.test.tsx`. Query-accuracy
regression kept and one live defect closed: a refine that flips order (「최근 3개」→「그중 가장 오래된 1개」) re-read the
oldest page and intersected to 0 — the base set is now re-read in its own order (`WorkingSet.filters.order`) and
re-sorted in-process (`queryAccuracy.test.ts`).

Browser QA (Playwright 1440×900, Demo Org, connectors OFF, planner live): 「오늘 리뷰 뭐 들어왔어?」 → rows sentence +
one line per stale channel + two compact cards; 「별점 2점 이하 리뷰 보여줘」 (fresh conversation) → LAST_7_DAYS result
first + NAVER offer card; in a conversation after 「오늘 리뷰」 the planner refines the TODAY set (by design). Console
errors 0 · off-host requests 0 · marketplace calls 0 · WRITE 0 · DB changes 0 · migrations 0 · model calls: planner 1/turn.
**Reported, not fixed:** Cafe24 REVIEW coverage has no successful run in this DB (footer says 「확인 기록 없음」 and the
automatic refresh fails with connectors OFF — data/deployment truth, not wording); the home KPI strip's own
「일부 채널 최신 수집 확인 필요」 is dashboard copy outside this package.

## §27 Chat UI v1 — conversation-first workspace (2026-08-29)

`frontend/` shell + a bounded cancel seam in `agent-runtime/`. Agent / query / freshness logic untouched.

**Layout.** The home IS the thread: `AppShellV2` gives `/` the full column (`data-layout="chat"`, no page
padding, no outer scroll); `ConversationWorkspace` is a flex column — transcript in its own scroll area
(`max-w-[840px]`), composer docked at the viewport bottom, nothing rendered below it. The KPI strip is
gone from the home; the three numbers are ONE muted context line under the greeting, shown only while the
thread is empty (`/overview` keeps every number). Threads moved to the sidebar (`ConversationNav`: 「새 대화」
as a `compose` icon control, the recent list with `aria-current` on the open thread, collapsible — folded by
default under 1366px). Example prompts render on an empty thread only; the latest agent turn alone carries
its follow-up chips.

**Composer.** One round control at the right edge: ArrowUp 「보내기」 while idle, Square 「중지」 while a
turn runs — same place. Enter sends, Shift+Enter breaks a line, the box grows to ~8 lines. `data-state`
= idle | running | disabled.

**Stop is real and bounded — audited first.** Before this package the SSE handler kept running after the
client disconnected and nothing could cancel a run. Now: the client aborts the fetch → the server sees the
response close → `AbortController` → `ConversationService.turn(…, {signal})` → `OperatorAgentRuntime.run`
→ `OperatorBudget.cancel()` (nothing further affordable; the step in flight — typically the planner call —
finishes on its own and no next step starts). The thread records 「요청을 중지했습니다. 이미 시작된 확인은
되돌리지 않습니다.」 both live (client) and persisted (`failureCode: CANCELLED`), so a reload shows the stop,
never a half-answer. What ran is never claimed undone (a Cafe24 refresh already started keeps going). Live:
Stop at 0.9 s → runtime `conversation_turn status=CANCELLED ms=6033` (after the in-flight planner step).
**Defect found by the live QA and closed:** a stop frees the composer while the runtime is still finishing,
so the next sentence raced the first turn and the later whole-view save dropped the stop record ⇒ turns on
one conversation are now serialized in `ConversationService` (`lanes`), pinned by `cancel.test.ts`.

**Icons.** No new dependency: Lucide-shaped strokes added to the existing `NavIcon` set (`compose`,
`history`, `panelLeft`, `arrowUp`, `stop`, `ellipsis`, `copy`, `chevronDown`, `refresh`, `check`); every
icon-only control carries `aria-label` + `title`. Agent sentences get a hover 「복사」 that says 「복사됨」
only after the clipboard accepted.

**Density.** Progress is one line (latest stage + measured seconds, earlier stages as quiet checks);
`ArtifactCard` header is one row with the action always top-right; user bubbles 80% max width.

**QA** (Playwright, real planner, 1440 / 1366 / 1152 × empty · sidebar collapsed · 10-turn thread top/bottom
· HumanAction · long artifact; 1440 also keyboard send · running · stop · one turn · reload): horizontal
scroll 0 · console errors 0 · off-host requests 0 · composer bottom gap 27px on every state · elements below
the composer 0. Before/after screenshots in the session scratchpad (contain live thread text; not committed).
Tests: frontend 210 files / 2,560 · runtime 609. Marketplace calls 0 · WRITE 0 · DB changes 0 · model calls
3 (the live stop/turn proofs). **Reported, not fixed:** the planner step itself cannot be aborted mid-flight
(the backend→vendor call has no abort seam), so a stop lands after it; no motion added (next package); the
`/agent` page keeps its legacy sections under the thread.
