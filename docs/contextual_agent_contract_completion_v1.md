# Contextual Agent Contract Completion v1

2026-08-27 · branch `feat/proactive-operations-agent-v1` · not a UI package.

**Question this package answers:** when the seller hands work to the Agent from the screen they are on,
does the Agent actually understand the exact operational object on that screen?

Contextual Agent Workspace & Interactive UX QA v1 reported, not fixed: 「`AgentContext` has no inquiry id,
so 「이 문의 조사하기」 sends the surface, not the row」. That is closed here, with its consequences.

## 1. Root cause — a contract bug, not a copy bug

`AgentContext` carried `{goal, productId, channelCode, surface}`. A product launcher therefore reached
the runtime with a verified entity; an inquiry launcher reached it with a sentence (「이 문의를 조사해 줘」)
and a surface name. The runtime planned an org-wide investigation and answered about the queue. The
label was true about the seller's intent and false about the run.

## 2. Request contract — `workItemId`, one kind wider than `productId`

The product pattern was audited first (`operatorRuntime.contextEntities`,
`test/operator/currentPageContext.test.ts`): a structured hint → one org-scoped READ → a
`ResolvedEntity` indistinguishable from one resolved by name → every scope invariant unchanged. The
same pattern carries the inquiry:

| Layer | Change |
|---|---|
| `frontend/src/lib/agentContext.ts` | `workItemId?` (URL param `workItemId`) |
| `frontend/src/lib/agentRuntime/types.ts` · `agent-runtime/src/http/contract.ts` | `StartRunRequest.workItemId?` (zod, same charset limits as `productId`) |
| `agent-runtime/src/goal/parseGoal.ts` | `GoalRequest.workItemId?` |
| `agent-runtime/src/operator/operatorRuntime.ts` | `contextEntities` resolves it with `getInquiryDetail` |

**Why the work-item id and not the inquiry id.** The only exact READ the runtime owns for one inquiry is
`GET /api/inquiries/{workItemId}`; the inquiry's own id comes back *from* that read and is what anchors
customer-memory. A field named `inquiryId` that carried a work-item id would be exactly the mislabelled
identity this contract exists to refuse. The screen joins inquiry id → work-item id client-side from the
queue read it already makes (`CustomerInbox`), and **the launcher promises 「이 문의」 only while it holds
that id** — while the join loads, or for a row the queue no longer holds, it offers the list goal instead.

No generic entity architecture was needed: one optional field per layer, one branch in `contextEntities`.

## 3. Org isolation

The hint is verified by the same org-scoped call the inquiry screen makes, through the operator's
forwarded bearer. Another org's id, a deleted row, a typo: the backend answers 404 and the hint is dropped
in silence; the run proceeds exactly as an un-hinted one. There is no cross-org lookup because no endpoint
exists that could perform one. `TC-CTX-INQ-02` (`currentInquiryContext.test.ts`) fixes: no entity, no
memory search, no evidence carrying either id, the history need declared `UNSATISFIABLE`.

## 4. What the run knows, and from where

The verifying read answers more than identity, and the customer's text is in it. So the runtime mints
**one evidence ref** from that read — `workItemId`, `inquiryId`, `channelCode`, bound `productId`/
`productName`, closed `phase`/`status`, receipt date as the event time — and the text is dropped with
the stack frame. `EvidenceLocator` gained `phase`/`status` (closed backend vocabulary). The graph accepts
the caller's `EvidenceBuilder` so ids stay unique across the run.

`InquiryOps` then:
- cites that ref for what it may say (channel · receipt date · 「아직 답변되지 않았습니다, 초안은 아직
  없습니다」 · bound product) — **no second detail read**; `get_inquiry_thread_context` is a draft-only tool
  by its own description;
- anchors `search_customer_memory` on the inquiry's own id (the exact anchor) instead of the product's net;
- skips `get_today_inbox` / the org queue under an `INQUIRY` entity (C3: a read the gate is known to refuse
  is not made) and says so on the need.

A bound product becomes a `PRODUCT` entity from the same read — `ProductOps` skips resolve-by-name.

**The first live run exposed the real gap.** The inquiry was resolved, the evidence was minted — and the
planner, reading only the sentence, answered 「어떤 문의인지 알려 주세요」 (`supported:false`,
`clarifies:true`, 22.7s). Correct from where it stood: a demonstrative with nothing behind it *is*
unclear. Products never hit this because every product launcher writes the product's **name** into the
sentence; an inquiry has no name a seller would type. The fix uses the one seam the planner already has
for run state, `priorContext` (closed vocabulary, rendered by the backend under 「지금까지의 진행」):
「대상 확정: … 문의 하나가 이미 특정돼 있습니다(INQUIRY) …」 — **no id, no channel, no product name, no
customer word**, backend prompt unchanged. The test asserts what the planner was told, byte-for-byte
about what it was not.

## 5. Live/local proof (Demo Org, read-only)

Backend · frontend · agent-runtime restarted on this commit (backend via the connectors-OFF boot: the
Cafe24 validator's fail-closed behaviour is expected and was not weakened — §10). Real OPEN inquiry
(Cafe24, unbound, received 2016-03-19; 19 OPEN work items scanned, none bound to a product in this org).

| Check | Result |
|---|---|
| Request body | keys `goalText`, `workItemId`; `workItemId` == the row's; sentence contains neither id |
| Panel header | 「이 문의」 |
| Findings | 「이 문의는 카페24 자사몰 문의로 2016-03-19에 접수됐고, 아직 답변되지 않았습니다, 초안은 아직 없습니다.」 → `/inquiries/{id}` |
| Queue total in answer | absent |
| Raw tokens on surface | 0 (`COUPANG`/`UNKNOWN`/`KRW`/`OPEN`/`UNANSWERED`… regex) |
| Route change (TC-CTX-INQ-03) | header → 「주문 · 최근 7일」, 「물은 화면」 note shown |
| 「답변 보내줘」 (TC-CTX-WRITE-01) | approval-boundary sentence under the box; browser writes 0 |
| Marketplace READ / WRITE | 0 / 0 (backend log: no connector activity, 0 ERROR) |
| Off-host requests · console errors | 0 · 0 |

Screenshots (real customer sentences) stay in the scratchpad, not the repo.

## 6. Product context regression

`TC-CTX-PROD-01` (unit) — `productId` hint still resolves by one read, no resolve-by-name, and the two
hints coexist. The three pre-existing product-context tests are unchanged and green.

## 7. Seller-facing enum leakage — provenance re-audited

The QA sighting (`COUPANG`, `14500KRW`, `ACTIVE`, `UNKNOWN`) was attributed to model prose. **It was
ours.** The Operator's `compose` node calls no model; every sentence is assembled deterministically by a
specialist, and `productOps` built 「… COUPANG에 등록돼 있습니다 (가격 14500KRW), 판매상태 ACTIVE」 from a
listing row's tokens. `UNKNOWN` lives in a provenance string the surface does not render.

Fix at the point of assembly (`agent-runtime/src/operator/sellerVocabulary.ts`): `channelNameKo` when the
row carries it (code as fallback, never a guess), `14,500원` / `12.5 USD`, selling status through the same
closed map the product screen uses (`SELLING`/`SUSPENDED`/`ENDED`) — **an unknown token drops the clause**
rather than asserting a state. No regex over prose; the planner's own prose (`clarificationReason`,
`rationale`) is not rewritten and was not the source.

## 8. Latency — measured, not optimised

Two log events on the existing sink, no tracer: `operator_stage {plan | specialist:X | dispatch | judge
| total}` and `operator_tool_call {tool, ms, ok}`.

| Stage | ms |
|---|---|
| plan (LLM) | **33,380** |
| dispatch (2 specialists) | 83 — `search_customer_memory` 80 |
| judge | 13 |
| total (HTTP) | 33,543 |

The earlier run: plan 22,693 of 22,746. The planner is >99% of wall clock; tool execution is sequential by
design (`PRODUCT_OPS` first so later specialists reuse its entity) and is not worth parallelising at
80ms. No accidental duplicate reads were found on this path (`contextEntities` reads once; `InquiryOps`
does not re-read). **Optimisation candidate, not done:** the planner call itself — model choice, prompt
length (tool catalogue is sent whole), and whether a repair pass doubles it. Product-owner decision.

## 9. Progress copy

`/agent` said 「보통 20초쯤 걸립니다」 with no measured distribution behind it, against 22–49s observed →
「조사에 잠시 시간이 걸릴 수 있습니다 · N초 경과」. The panel's 「확인하는 중 · N초」 was already a clock.

## 10. Tests

agent-runtime: `test/operator/currentInquiryContext.test.ts` (4 — TC-CTX-INQ-01/02, unbound, TC-CTX-PROD-01),
`test/operator/sellerVocabulary.test.ts` (3 — TC-ENUM-01/02); 498 passed / 23 skipped. frontend:
`AgentPanel.test.tsx` +2 (structured `workItemId`, launcher honesty); 197 files / 2,477 tests / 0 failures.
Backend untouched.

## 11. Counts

Marketplace calls **0** · marketplace WRITE **0** · model calls **2** (the first exposed the planner gap,
the second proved the fix) · browser-originated writes **0** · migrations **0** · backend source **0** ⇒ no
evidence row.

## 12. Remaining pilot blocker

Unchanged from `docs/pilot_runtime_foundation_v1.md`: a host with a fixed public IPv4 and a stable public
HTTPS Cafe24 callback. Nothing in this package moves it. Next: Pilot Host Provisioning / First External
Seller.
