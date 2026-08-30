# Knowledge Capture / Learning Loop v1 (2026-08-30)

**Scope.** When the Agent finds a real Knowledge Gap in the middle of the seller's work, it asks the seller
for the one missing fact, saves **only what the seller wrote and explicitly confirmed** through the
seller's own knowledge seams, and performs the original work again **once**. No new RAG/vector/ontology,
no planner-latency work, no marketplace write. Base: `7c106cba`.

The rule that organises the package: **the seller's sentence is the fact; the agent only decides when to
ask, what to ask, and whether the answer may be filed.** A model writes neither the question nor the
content; the gate that opens a capture is the retrieval's own verdict; the write is the same `POST` the
settings and product screens make; the resume is the same draft path the inquiry screen calls.

## 1. Audit — what already existed, what did not

| Needed | Found | Used as |
|---|---|---|
| seller-write path, org rules | `SellerOperationsKnowledgeService.create` behind `POST /api/org-knowledge/sources` | the ORG write |
| seller-write path, product docs | `ProductKnowledgeLibraryService.create` behind `POST /api/products/{id}/knowledge/sources` — `authored_origin` defaults to `SELLER_ENTERED_KNOWLEDGE`, variant FK → 400 for another product's 규격 | the PRODUCT write |
| authoritative gap | `RetrievalOutcome` per lane + `AnswerBasisState` — computed in `InquiryDraftComposer`, but returned only as **sentences** (`answerBasisAction`) | exposed as values (§2) |
| persisted conversation state | `ConversationView` (`workingSet` · `pendingHumanAction(s)` · `pendingPrepared`), whole-view save per turn, file/Spring stores, no zod on load | `pendingCapture` added beside them |
| a human-step seam | `HUMAN_ACTION_REQUIRED` + `resumeOfTurnId` (re-runs the originating request after a sync) | reused for the GOAL resume |
| actionability | `inquiryActionability.ts` (`DRAFTABLE` · `ALREADY_ANSWERED` · `AWAITING_SEND` · `NOT_WORKABLE`) | re-checked before every draft resume |
| duplicate / conflict check on knowledge writes | **none** at the application level — `uq_*_title` unique indexes only, unhandled → **500** | the runtime fence (§6) |
| second knowledge repository | — | **not created** |

## 2. Capture trigger — values, never sentences

`GeneratedDraftView` gains `knowledgeGap` (`KnowledgeGapView`): `productId` · `topic` (the single
`KnowledgeTopic` the question names, or null) · `topics` (every topic the words name) · `missingSubject`
(the customer's own noun `SpecApplicability` already quoted) · `productOutcome` · `policyOutcome` ·
`applicability` · `variantId` · `policyDeclaresTopic`. Every value is one the composer computed for
`answerBasisAction` already; the record is a projection, not a classifier, and it travels on every view
(NO_ANSWER_BASIS, fallback, GROUNDED) so the runtime never parses Korean.

`captureGapOf` (`agent-runtime/src/conversation/knowledgeCapture.ts`) decides deterministically:

| verdict | capture |
|---|---|
| topic named · policy `ABSENT`, or `NO_RELEVANT_EVIDENCE` over rules that declare nothing about the topic | **ORG** (`SHIPPING_POLICY` …) |
| topic named · policy `NOT_APPLICABLE` (a rule exists, does not apply) | **none** — the same rule is never asked for again; only a product-specific exception may be asked, and only when the question named a concrete property |
| no topic · product bound · product lane missing | **PRODUCT** (`DESCRIPTION`), `variantRequired` = `VARIANT_UNRESOLVED` |
| several topics named (「결제하고 나서 출고까지」= 결제·출고) | ORG only when the plan's own POLICY gap named **one of those** topics (found live — the planner may disambiguate among the question's words, never add one); otherwise nothing — a shipping sentence must not become a product document |
| no product, no topic | none — the existing 「답변 기준 추가」 link stands |

Agent lane: an `ORG_POLICY_GAP` with outcome `ABSENT` asks the same way (resume kind `GOAL`);
`NOT_APPLICABLE` still carries no step. The identity the gap holds is verified only: the inquiry/work
item the draft path read, the composer's product, a 규격 named from the listing's own rows.

## 3. The question — a closed template

`questionFor(scope, topic, productName, subject, variantRequired)`: SHIPPING 「이 문의에 답하려면 일반
출고 기간 기준이 필요해요. 보통 결제 후 며칠 안에 출고하시나요?」 · EXCHANGE_RETURN 「{상품}의 교환·반품
가능 기간 기준이 필요해요. …」 · CANCELLATION · PAYMENT · TAX_INVOICE · CASH_RECEIPT · PRODUCT
「{상품}의 '{noun}' 정보가 아직 없어요. 판매자님이 안내하는 정확한 내용은 무엇인가요?」 (+ 「규격에 따라
다르면 어느 규격 기준인지 함께 적어 주세요.」). The only variables are the product's name and the
customer's noun. No model call.

## 4. Seller answer → candidate (write 0)

While a gap is open, the seller's next sentence goes through `classifySellerAnswer` **before** the tone /
ordinal lanes and the planner: closed cancel cues (취소·아니·그만·나중에…) close the gap; a question ending
or a command ending (…해줘 / …보여줘, the tone and ordinal cues) goes to the planner with the gap still
open; anything else **is** the answer. Content = `normalizeContent` (whitespace and a 2,000-char cap —
nothing else), title = first line ≤ 60 chars (the quick-add convention), fingerprint =
`sha256(scope · product · 규격 · type · content)[:16]`. The CANDIDATE card shows the sentence back verbatim
with [저장하고 계속] / [취소] / 「설정에서 직접 편집」; the turn's message is 「저장 전에는 아무것도 바뀌지
않습니다」 and the write count is 0 (case B/C live).

규격: `variantFromAnswer` names a variant only from the listing's rows (whole option name, or a numeric
token unique to one option); 「공통」 makes the fact generic; nothing named ⇒ the agent asks which. Found
live: a listing with **no variant rows** has no 규격 to name — the whole listing is the only truthful
scope, so the fact proceeds as generic and the draft asks the customer (Knowledge Gap Resolution v1 §5).

## 5. Confirm, then save — bound, once

`StartTurnRequest.captureDecision {captureId, fingerprint, decision}` — the frontend button sends the
capture id and the fingerprint of the exact sentence the card displayed; the runtime compares both against
the open CANDIDATE. A changed sentence is a new fingerprint (case C: the old one is `STALE`, writes 0,
the current candidate stays). Only a matching SAVE reaches `KnowledgeCaptureWriter`, the one file the
write fence allows to call `createOrgKnowledge` / `createProductKnowledgeSource`
(`conversationWriteFence.test.ts` pins the caller and asserts the writer names no draft, customer,
message or memory field). Controls exist only on the latest agent turn; on reload the card shows
「저장됨」 and no button.

What can never be a source: an AI draft, an assistant message, the customer's body, Answer Memory, an
imported answer, a model-extracted claim — structurally, because the writer reads `candidate.content`
and nothing else, and the candidate is set only from the seller's USER turn.

## 6. Duplicate / conflict fence (deterministic)

`judgeCandidate` reads the existing rules/documents in the same scope (ORG: the same type plus the
untyped kinds 공통 안내·기타; PRODUCT: the same 규격 or the whole listing) **before** offering to save:
same normalized body ⇒ `DUPLICATE` (no second row); same title ⇒ `CONFLICT` (also what would have been
the backend's 500); the same unit with a different figure (「1~2일」 vs 「2~3일」, `figuresOf`) ⇒
`CONFLICT` 「기존 배송 기준과 내용이 다릅니다. … 자동으로 덮어쓰지 않았습니다.」 with the existing title +
excerpt and the settings path. No AI resolution.

## 7. Resume — once

After the write: `INQUIRY_DRAFT` → re-read the inquiry, `actionabilityOf` again (case J: `ALREADY_ANSWERED`
⇒ 「이 문의는 이미 처리되어 기준만 저장했습니다」, draft 0, model 0), then the same `DraftPreparer` the
inquiry lane uses — propose/generate, so retrieval, applicability and `AnswerBasisState` are recomputed
by the backend; the runtime checks whether the saved source id is among the cited evidence and says
「저장한 기준을 근거로 답변 초안을 다시 준비했습니다」 only then. Still `NO_ANSWER_BASIS` ⇒
`DRAFT_STILL_GAP`, said honestly, the new knowledge never pushed into a draft by hand, and **no second
question on the same breath** (`captureAllowed` is false on the turn after a SAVED card and on any
`afterCapture` turn). `GOAL` → the originating turn is re-run through the existing `resumeOfTurnId`
path with the save said first (「배송 기준을 저장했습니다. 저장한 기준으로 원래 요청을 다시 확인합니다.」);
one planner call, and no 「등록하면 답할 수 있습니다」 link beside the rule just saved.

## 8. State / reload

`ConversationView.pendingCapture` (and each turn's `continuation.pendingCapture`) persists with the
thread; older files simply lack it. A carried gap is dropped when the seller moves to another inquiry
(`carriedCapture`), on cancel, on save, on duplicate/conflict; a new conversation starts with none. The
gap is bound to inquiry identity, so it cannot file under another customer's case by construction.

## 9. What was verified

Unit/integration: runtime `test/conversation/knowledgeCapture.test.ts` (pure rules + cases A–L + H2/I2/K2/A2
against the fake backend; writes counted on the fake), write fence extended, two re-contracted assertions
(`knowledgeContext` B, `retrievalGrounding` E: an ABSENT rule is asked for, not only linked); backend
`KnowledgeGapResolutionTest` (the gap view's values); frontend `KnowledgeCaptureArtifact.test.tsx`.
Runtime 710 passed · frontend 2,579 passed · backend 3,570 passed / 0 failures.

Live (disposable org 「QA 지식학습」, real planner, real draft model, 6 CSV inquiries + SQL work items,
connectors/scheduler/proactive/self-pilot OFF; **marketplace calls 0 · marketplace WRITE 0**):

| case | result |
|---|---|
| E conflict | ASKED (shipping) → rule 「1~2일」 registered meanwhile → 「2~3일」 ⇒ `CONFLICT`, rows 1→1, existing quoted |
| D duplicate | same body (extra spaces) ⇒ `DUPLICATE`, rows 1→1, settings chip |
| B / I / C | candidate write 0 · `GET` shows `pendingCapture` ASKED then CANDIDATE across the reload boundary · re-typed sentence ⇒ new fingerprint, old ⇒ `STALE` (writes 0) · CANCEL ⇒ rows 0 |
| A (배송 문의 「배송은 보통 며칠」) | saved (rows 0→1) → resumed → **`DRAFT_STILL_GAP`**: the retriever is lexical and 「배송…며칠」 shares no word with the seller's 「출고…2~3일」 — reported as such, no threshold change |
| A (출고 문의 「출고까지 얼마나」) | saved → resumed → **GROUNDED v1**, the saved source cited (`cited=true`), model 1 |
| K agent lane | 「현금영수증 발행 기준이 어떻게 돼?」 → ASKED (GOAL) → answer → [저장하고 계속] in the browser → resumed turn quotes 「등록된 현금영수증 기준 「…」」; planner 1 |
| J | tax-invoice rule saved while the inquiry was set ANSWERED ⇒ `INQUIRY_NOT_ACTIONABLE`, draft 0, generate 0 |
| G | 「가닥」 → PRODUCT capture bound to `QA 전선몰딩` (no org rule written) → saved as `DESCRIPTION` → resumed `DRAFT_STILL_GAP` (the SUBJECT candidate keeps 「몰딩 안에…까지」 and misses; 「전선 가닥」 finds it) |
| F | a two-topic question (반품·배송) with no planner POLICY need ⇒ no capture, link only; `NOT_APPLICABLE` itself was not reached live (unit-pinned) |
| H | not reachable on this org (no variant rows) — H2 (no rows ⇒ generic) reached instead; H unit-pinned |
| L | 「최근 문의 3개」 ⇒ capture 0, retrieval 0, writes 0 |

Model calls over the whole QA: planner 14, draft 1 (the one GROUNDED resume), judge per plan; the
decision turns and candidate turns are 0/0. Browser (1440×900): internal tokens 0, console errors 0,
off-host requests 0, horizontal scroll 0, knowledge writes from the browser 0 (the runtime wrote).

## 10. Not fixed, reported

- **Lexical retrieval decides the resume.** A saved fact is FOUND only when it shares words with the
  question's SUBJECT candidate; the seller's 「출고」 for the customer's 「배송」, or a product-name word in
  the subject, keeps `DRAFT_STILL_GAP` after a correct save. The template question nudges shipping
  answers toward 「출고」. Threshold lowering and scorer changes were out of scope; this is where the next
  retrieval package should look (topic-level applicability already agrees; coverage does not).
- **Two-topic questions depend on the planner naming a POLICY need** (variance observed: the same
  question asked once with and once without). Without that signal the agent links instead of asking.
- The backend still answers **500** for a duplicate title through the settings screens; the runtime fence
  avoids it in this lane only.
- `NOT_APPLICABLE` and variant-named saves are unit-pinned, not live-proven on this org.

## 11. Residue

QA org 「QA 지식학습」 removed after the run (rows, work items, seller account, knowledge, runtime store
scope); Demo Org untouched; backend restored on its original env. Marketplace calls 0 · WRITE 0 ·
migrations 0 · new tables 0 ⇒ no evidence row.
