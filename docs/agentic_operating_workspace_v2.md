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
| NAVER | 리뷰 acquisition (guided export → download detected → ingest → resume) | GUIDED_HUMAN_ACTION (`EXPORT_ACTION_WINDOW`, local agent; fallback file upload) | — | export path LIVE_PROVEN (2026-07-15 / 08-23 partial) · conversation start + auto-resume IMPLEMENTED · LOCAL_PROVEN (file path on the QA org: stale → upload → detect → resume → rows) · guided-from-conversation **LIVE_UNPROVEN** |
| NAVER | 리뷰 analysis / triage / draft | — | — | IMPLEMENTED · LOCAL_PROVEN (draft prepared in conversation, triage recorded from the seller's sentence) |
| NAVER | 리뷰 guided reply (locate → composer fill → seller submit → observe) | — | GUIDED_BROWSER_EXECUTION (`reply/naver` resident carrier, `FILL_COMPOSER`) | IMPLEMENTED · LOCAL_PROVEN (fixture DOM; automatic submit 0 by guard) · **LIVE_SUBMIT_UNPROVEN**; on the Demo Org the stored NAVER reviews carry no trusted acquisition binding ⇒ identity `NONE`, so the card is not offered live |
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
- Guided acquisition from a conversation: NAVER `EXPORT` run and Coupang `REVIEW_ACQUISITION` run are startable from
  the human-action card through the paired helper (`acquire/coupang` resident carrier; `acquisitionRef` mint);
  **LIVE_UNPROVEN** here — this machine has no paired helper session against a seller center in this package.
- Guided NAVER reply: `GUIDED_EXECUTION` card → `submission-run` mint → `REPLY_SUBMISSION` with `FILL_COMPOSER`
  (`guided-fill-reply-driver`: fills only on one matched row + one composer + non-contradicting review-id
  fingerprint; ambiguity fills nothing); submit is the seller's click — **automatic submit 0** by the source
  guard; state `COMPOSER_FILLED → SELLER_SUBMISSION_OBSERVED → SUBMISSION_OBSERVED_CONTENT_UNVERIFIED`, never a
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

## 23. Remaining limitations before an external pilot

1. Every guided path that reaches a seller center (NAVER export/reply, Coupang WING read) is LIVE_UNPROVEN from a
   conversation — it needs a paired helper and a seller-center session under an approval manifest.
2. Cafe24 review comment: `password` acceptance for a mall-authored comment is the one open contract question.
3. NAVER customer-inquiry reply and Coupang inquiry reply adapters exist but have never been run live.
4. Grounded inquiry drafts need an org with Product Knowledge; the Demo Org's open inquiries are all `NO_ANSWER_BASIS`.
5. Planner latency 7–33 s per turn remains the dominant wait (no change in this package).
6. The old NAVER export rows carry no acquisition binding, so their guided reply is refused by design until a
   guided export re-acquires them.
7. `/reviews` page's 「승인」 button contrast (pre-existing).


