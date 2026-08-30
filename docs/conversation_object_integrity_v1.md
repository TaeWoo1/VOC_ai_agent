# Conversation Object Integrity v1 (2026-08-30)

**Scope.** The five object-integrity defects the Agent Context/Reasoning integration QA (2026-08-29, HEAD
`01086555`) named — and only those. Knowledge-retrieval tuning, the seller-facing wording overhaul and the
Knowledge Capture loop are explicitly **not** in this package.

| # | Defect the QA found | Where it actually lived | Change |
|---|---|---|---|
| 1 | 「첫 번째 거」 unresolvable over a ROWS list when the row has no work item | `resolveTargets` indexed `workingSet.workItemIds`; a ROWS row's identity is its **inquiry id** | Targets index `workingSet.ids` and look the row up by inquiry id *or* work item id (`inquiryFromHistory`). `InquiryItem.title` is now **persisted** (bounded) so a reloaded thread names the row. |
| 2 | Same inquiry 「답변 필요」 in rows and 「답변할 것 없음」 in the workload | `inquiries.status` stayed `UNANSWERED` after a **verified** executor read-back; only the work item moved to COMPLETED | `InquiryPublishService.runVerify` marks the inquiry `ANSWERED` (+ `answered_at` once) when the adapter verifies — the same deterministic proof the connector reconcilers act on. **V88** closes rows verified before this (1 Demo Org row: `ae51c7f8`, NAVER, 2026-08-26). |
| 3 | After a specific-inquiry turn the set became PRODUCTS/`null`; 「이 상품 기준으로」·「부드럽게」 lost the inquiry | `workingSetOf` let an R4 product grouping replace the set; a hint-launched turn left `null` | `WorkingSetView.selectedInquiry` — the anchor. Set on PREPARE targets, planner ordinals, and screen launches (from the verified ref); **kept until the seller draws a new list**; products are merged into `productIds` beside it. The anchored inquiry's product travels as the same verified `productId` hint a product screen sends. |
| 4 | COMPLETED inquiry: READ ×4 + draft-model call → 409 → the turn vanished | No phase/status gate before `DraftPreparer` | `inquiryActionability.ts`: `DRAFTABLE` (OPEN/PROPOSED with a work item) · `ALREADY_ANSWERED` (status ANSWERED or EXECUTED/COMPLETED) · `AWAITING_SEND` (APPROVED/ACTION_PENDING) · `NOT_WORKABLE`. Decided from the row before any proposal, retrieval or model call; a non-draftable row gets a state SUMMARY on a DONE turn. A draft path that still refuses is a sentence on a DONE turn (`DRAFT_FAILED_SENTENCE`), never a lost turn. |
| 5 | 「조금 더 부드럽게」 planned as a workload read (9 READs, queue dumped, set replaced); even the chip text ran a plan beside the revision | Tone reached the lane only through the planner | `styleIntent.ts`: a **closed cue table** for the three existing `ToneHint` tokens (`SOFTER`·`MORE_FORMAL`·`SHORTER`), applied only while a draft is on the table (`pendingPrepared`). Matched ⇒ `reviseTone`: planner 0, tools 0, same object, same evidence, one new version, envelope-checked. Not matched ⇒ the planner, as before. A tone word with a selected inquiry but no draft is answered without a plan. |

Two further seams the live run exposed and this package closes:
- **`pickSet` precedence** — a PREPARE plan that also reads the org queue made 「첫 번째 거」 the first row of *that* queue. The set a sentence indexes into is the one the seller was **looking at** (the conversation's); this turn's incidental list only when there is none. On a PREPARE turn with a resolved target the incidental `INQUIRY_LIST`, the plan's findings and its note stay out of the prose (they remain in the evidence disclosure).
- **Bare ordinal selection** — 「첫 번째 거」 / 「두 번째 문의」 as a whole sentence over the list just shown selects that row deterministically (no planner call); an ordinal *after* a selection still counts on the list the seller saw (the anchored set keeps the list's ids). An ordinal with a verb (「첫 번째 거 답변 준비해줘」) stays the planner's `target`.

Contract note: the tone cue table and the ordinal pattern are the only readers of the seller's words in the
conversation lane, both closed, both unit-tested; no per-sentence branches were added.

## Regression QA (real planner · real runtime · real backend on this tree)

Processes restarted on this commit (connectors · scheduler · proactive · self-pilot OFF). Marketplace calls **0**,
marketplace WRITE **0**, judge rule-based.

| Case | Where | Result |
|---|---|---|
| A 「최근 문의 3개」 → 「첫 번째 거」 | Demo Org (read-only) + QA org | PASS — resolved by inquiry id; first row had **no work item** (answered); planner 0 · tools 0 · 17 ms |
| B COMPLETED inquiry → draft | Demo Org (read-only): by ordinal and by `workItemId` hint (`7eafaf5a`) | PASS — `agent_draft` **0**, proposal 0, DONE turns, 「이미 답변된 문의라 새 초안은 만들지 않았습니다.」 (the hint-launched turn still spends the graph's READs — 5 — before the gate; the gate is on the draft path) |
| C one answer state | Demo Org after V88 | PASS — rows `ANSWERED`, workload (OPEN 10 / PROPOSED 10) no longer lists it, rows-UNANSWERED total 21 |
| D OPEN → 「답변 준비해줘」 | QA org | PASS — v1 `GROUNDED` (운영 정책 1), `selectedInquiry` kept |
| E 「이 상품 기준으로 답변 준비해줘」 | QA org | PASS — product knowledge read on the **anchored** product (no name resolve), v2 on the same inquiry, `productIds` carry it |
| F 「조금 더 부드럽게」 · 「더 짧게」 | QA org | PASS — `TONE_REVISION`, planner 0 · tools 0, v3/v4 `GROUNDED`, `styled=true`; envelope v1–v4 identical (`1~2일`, `2~3일`) |
| G reload | runtime `GET` + browser 1440×900 | PASS — `selectedInquiry`, `pendingPrepared v4`, persisted titles; console errors 0, off-host 0 |

Found and fixed during the live run: ordinal after a selection said 「없습니다」 (the anchored set had one id);
tone word with no draft ran a plan; `이 상품` was resolved by name and failed; a SUMMARY `note` carried an internal
path the FE prints as text.

**Not fixed, reported.** (a) The planner still reads the org workload beside a PREPARE — the read is dropped from
the prose, not avoided (planner prompt untouched). (b) `answered_at` for V88 rows is the verification timestamp,
not the channel's own time. (c) A `NO_ANSWER_BASIS` draft saves no version, so tone requests on it correctly find
nothing to revise. (d) The ESM inquiry import controller is not mounted in this build (`sellerops.inquiry-import.esm.enabled`),
so the QA org was seeded through `/api/uploads` (file path = no work item) plus the bounded SQL fixture below.

## Side effects and residue (exact)
- **Demo Org DB writes: 1** — V88 set `ae51c7f8` to `ANSWERED` (`answered_at` 2026-08-26T16:17:14+09, its verification time). No draft, proposal or work-item change; `answer_memory` 22 → 22.
- **Disposable QA org `QA 객체정합성` (`2764aa66…`, `qa-object-integrity-1788064646002@example.test`)** — created via `POST /api/auth/signup`; 4 inquiries via `POST /api/uploads` (CSV, MANUAL_UPLOAD); 2 `SHIPPING_POLICY` sources via `/api/org-knowledge/sources`; **SQL fixture**: 1 `seller_accounts` row (`11111111-0000-4000-8000-00000000c001`, CAFE24, CONNECTED) + `inquiries.seller_account_id` on its 4 rows + 3 `inquiry_work_item` OPEN rows. Product flows then wrote: 2 work items → PROPOSED, 4 MODEL draft versions on `4dff2e08…`. Left in place for re-verification; nothing of it is visible to any other org.
- Runtime conversation store: 5 conversations (2 Demo Org, 3 QA org). Backend was booted with the QA org appended to the plan/draft/judge allow-lists through a wrapper (no env file edited).
- Model calls: planner 13, draft 4 (v1–v4), judge 0. Marketplace 0.

## Tests
`objectIntegrity.test.ts` (19: closed intents ×3, A ×5, B ×3, D/E/F ×6, G ×1 — over the real graph and recording fakes),
`InquiryPublishServiceTest` (+1, +1 assertion), one existing persistence test **re-contracted** (titles persist).
Runtime 655 · frontend 2,569 · backend full suite green.
