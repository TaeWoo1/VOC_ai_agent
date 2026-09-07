# Grounded Conversation Lane v1 + Cross-Lane Context Continuity

2026-09-07. **AOP / LangGraph execution architecture is FROZEN.** WorldState · Procedure semantics ·
NeedKind · typed tools · Evidence · Approval · Executor · Checkpoint are unchanged, and this package
adds no procedure, no tool and no marketplace WRITE.

What changed is one thing: **ASK/EXPLAIN turns get an LLM back, and DO/CHANGE turns keep the
deterministic machinery they have.**

---

## §0 The defect, measured before and after on the same stack

Three sentences, clean seller, live browser, same commit — the only difference is whether the
capability of §3 is admitted for that organisation.

| sentence | before (deterministic composer) | after (grounded lane) |
|---|---|---|
| 너랑 사방넷 같은 솔루션이랑 뭐가 달라? | 「판매 채널을 연결하시면 문의 · 리뷰 · 주문을 대신 확인하고…」 + the four-domain card | 「그 서비스에 대해서는 제가 정확히 알지 못합니다. 저는 판매자님 대신 문의·리뷰·상품·주문만 확인하고…」 |
| 세 군데 다 연결하면 같은 문의가 중복으로 보일 수도 있어? | the 5-row channel capability matrix | 「채널마다 별개로 저장됩니다. 같은 글을 여러 번 가져와도 원본 글 단위로 하나로 유지되지만, 채널이 다르면 서로 다른 글로 셉니다.」 |
| 쿠팡 리뷰에 고객 답글까지 달아줄 수 있어? | 쿠팡's four-row matrix | 「쿠팡 리뷰에 답글을 직접 보내는 건 제가 대신 하지 않습니다. 연결하신 뒤에는 리뷰를 확인해 드리고… 보내는 것은 판매자님이 확인하신 뒤에 판매자센터에서 진행해 주세요.」 |

The "before" column is not a bug in any of those five composed answers. Each is correct for the
question it was written for. **The ceiling is that there are five of them**: `capabilityAspect` is a
closed token, a sixth question is not one of its values, and the only way to answer a new
informational question was to add a sixth token and a sixth composer. That is the decision tree the
brief forbids growing.

---

## §1 Audit — where conversational context already lives

Nothing was missing. Everything was scattered, and none of it was named:

| what | who owns it | shape |
|---|---|---|
| raw turns | `ConversationStore` | last 40, customer text stripped by `persistableTurn` |
| current object | `WorkingSetView.selectedInquiry` / `selectedObject` | ids only, one anchor at a time |
| candidate set (「두 번째 거」) | `WorkingSetView.ids` / `workItemIds` | ≤ 50 ids |
| step in flight | `ConversationView.activeTask`, `pendingPrepared` | closed tokens |
| procedure in flight | `AopCheckpointStore`, keyed `conversationId:procedureId` | refs, no content |
| the screen the seller sent from | `StartTurnRequest.surface` / `productId` | hints, verified by one read |
| what the planner is told | `priorLineOf` → `priorContext` | closed tokens |

**So this package added no eighth store.** `src/conversation/ContextEnvelope.ts` is a *projection*: every
field is read from one of the rows above and nothing is persisted, cached or reconciled. A package that
answered "context is scattered" by introducing a durable envelope would have made a second copy of the
anchor, and the first time the two disagreed nobody could say which one was the conversation's.

---

## §2 Conversation Context Envelope

```
ContextEnvelope {
  conversationId
  surface            // closed token from the frontend, or null
  readiness          // NO_CHANNEL | NO_DATA | WORKING | UNKNOWN
  focus              // { kind: REVIEW|INQUIRY|PRODUCT|ISSUE|REPORT, id, productId, channelCode } | null
  workingSet         // { kind, count, shown } | null
  activeProcedure    // { id, version } | null
  activeTask         // INSPECT | PREPARE_REPLY | REVISE_DRAFT | CAPTURE_KNOWLEDGE | APPROVE_REPLY | null
  awaiting           // HUMAN_ACTION | APPROVAL | KNOWLEDGE_ANSWER | DRAFT_REVIEW | null
  recentTurns        // ≤ 6, oldest first, { role: SELLER|AGENT, text }
}
```

**Refs, never content.** The facts behind the ids are re-read from the surface that owns them — the same
rule `persistableTurn` has always imposed on the transcript. The one place prose appears is
`recentTurns`, which is the seller's own sentences and ours: the two classes this repository already
sends to a model (`goalText` for the planner, `finding` for the judge).

**Ids do not travel to the model.** `envelopeTokens()` renders the envelope as closed `key=value` lines —
`readiness=NO_CHANNEL focus=REVIEW shownList=REVIEWS shownRows=3 totalRows=19 step=INSPECT` — and *which*
review is anchored is neither sent nor checkable by a sentence-writing model. `ConverseRequestFloor`
refuses that line the day a name or a body appears on it.

---

## §3 The Grounded Conversation Lane

**Routing, after this package:**

| the seller's turn | lane | who writes the sentence |
|---|---|---|
| ASK / EXPLAIN about the product (`requestedAction = EXPLAIN_CAPABILITY`, no object on the table) | **Grounded Conversation** | the model, from the fact sheet |
| ASK about a channel *for the object on screen* (`EXPLAIN_CAPABILITY` + channel + working set) | per-object capability lane, unchanged | the runtime |
| DO / CHANGE (`PREPARE_INQUIRY_DRAFT`, `REQUEST_SEND_APPROVAL`, tone, capture answer) | existing AOP procedure | the runtime |
| explicit UI/object operations (click, ordinal, filter, refine, CLEAR) | existing deterministic direct lane | the runtime |
| everything else | planner → specialists → composer, unchanged | the runtime |

**The tenth LLM capability**, `sellerops.agent.converse.*` (`POST /api/agent/converse`), with its own
flag, key, prompt, parser, quota kind and byte-asserted payload floor. Default **OFF**.

**Grounding sources — all of them already existed:**

| the model is given | derived from |
|---|---|
| what this product does, per domain | the REGISTERED tool catalogue (`capabilityDomains`) |
| the write boundary | the catalogue's own action classes (`boundarySentence`) |
| which channels, and what each holds | this turn's `GET /api/channels/coverage` snapshot — **zero extra reads** |
| what each channel can and cannot do (4 verdicts × channel) | the same `capabilityOf` resolver every execution path uses |
| whether collection runs on its own | `ChannelCoverageRow.routineEnabled` — not a claim |
| this shop's own state | `SellerReadiness` |
| four structural product facts | `ProductFactSheet.STRUCTURAL_FACTS`, **count pinned by a test** |

`ProductSelfKnowledge` therefore stops being a sentence generator for the ASK lane and becomes what the
brief asked for: a **grounding source**. Its five composed answers remain — as the fallback.

**What the model is told it may not do** (`AgentConversePrompt`, three rules that are each a defect this
repository has already had): do not state a fact that is not on the sheet; do not promise a send; do not
print our internal words.

**And what the runtime checks after it answers** (`groundedAnswer.ts`): SCREAMING_SNAKE tokens, tool
names, our internal vocabulary, document furniture (headings, tables), and length > 1,200 chars. A
refusal falls back — it never fails the turn.

### Every failure lands on the answer that shipped before

Capability off · quota met · request floor refused · model declined · model unreachable · guard
rejected the prose ⇒ **the deterministic composer writes the sentence**. That is asserted, and it is
also why the whole CI suite is untouched: the fake operator client has no `converse` method at all, so
this lane does not run in CI and *cannot* change a recorded answer.

### Payload floor

What leaves: the seller's own sentence · the last ≤ 6 sentences of this thread (theirs and ours) · the
fact sheet · closed `key=value` envelope tokens. **No customer content of any kind** — no review body,
no inquiry body, no buyer field, no identifier. `AgentConversePayloadFloorTest` asserts it on the
serialized bytes, and `AgentConverseGenerator.Input` has four components and no place to put an object
id.

`ConverseRequestFloor` enforces the two checkable shapes at the door: prose sections are bounded by SIZE
(80 facts × 400 chars, 8 turns × 2,000 chars), and the envelope is held to the judge digest's
`key=value` rule — refused, never truncated.

### "한 사실은 한 번" — reduced to the fallback

`saidOnceId` / `shortenRepeat` keyed a repeat to the ASPECT, so a second question the planner read as
the same aspect came back as the shortened repeat whatever it had asked. The grounded lane answers
before that rule runs and is instead given the thread, so it avoids repeating itself the way a person
does. The rule is not deleted: it still owns the deterministic fallback, where it is still right.

---

## §4 Cross-Lane Context Continuity

**One real defect, found and closed.** The step in flight was carried when the anchor had not moved, and
the test for "had not moved" read `selectedInquiry` alone — so a thread anchored on a **REVIEW** or a
**PRODUCT** lost its `activeTask` on the very next conversational turn, and the context bar stopped
saying what the conversation was doing with the object it was still showing. `sameAnchor()` compares the
anchor, which is one of three kinds. **The new test is red on the old rule.**

**Three fences, and they are the part that matters:**

1. **A conversational turn advances no procedure.** The AOP router is a table over closed tokens and
   reads no sentence; a question arrives as `EXPLAIN_CAPABILITY` or `NONE`, and every procedure holding a
   `prepare` / `validateApproval` / `execute` step requires a DO token. Asserted over the full
   readiness × anchor × action grid.
2. **A stopped procedure is still stopped after a question.** A `WAITING_HUMAN` cursor with its
   `approvalId` is unchanged across a grounded turn. *An interrupt is a pause, never a permission* — and
   「이 답변 괜찮아?」 is not the confirmation that lifts it.
3. **The lane is READ only.** Its three modules name no writer, no approval and no channel call (source
   scan); the backend seam reads nothing and writes nothing; a grounded turn produces no draft, no
   approval artifact and no `pendingPrepared`.

**Live, on the connected Demo organisation:** 리뷰 목록 → click a row (context bar: 「선택한 리뷰 · 판도리
조립형 종이컵 수거함 · ★ 1」) → a capability question → **the bar still names the same review** → 「이
상품에서 반복되는 문제는?」 → 「이 상품은 됐고 전체에서 가장 반복되는 문제는?」 widens correctly (the
`namesEveryProduct` scope-exit rule from `780a0b94`, unchanged).

---

## §5 Context engineering (§6 of the brief)

The only routing this lane does is **which facts to fetch**, never which words to say:

* a sentence that named a channel ⇒ that channel's verdicts (measured: 21 fact lines, 1 channel);
* a sentence that named none ⇒ the coverage table's channels (measured: 29 fact lines, 3 channels);
* the product's own derivations and this shop's readiness travel on every turn (they are already in
  hand — the coverage snapshot is the turn's own).

Bounded per turn: ≤ 3 channel overviews + 2 org reads, on the turn that needs them.

---

## §6 Measured cost

Same stack, same organisation, same three sentences; the only variable is whether the capability admits
that org.

| | before (deterministic) | after (grounded) |
|---|---|---|
| model calls per capability turn | 1 (plan) | 2 (plan + converse) |
| converse prompt tokens | — | **1,288 – 1,427** |
| converse completion tokens | — | 98 – 128 (reasoning 0) |
| converse round trip | — | **≈ 2,200 ms** |
| end-to-end turn | **2,501 – 3,027 ms** | **4,190 – 5,681 ms** (one 10.3 s outlier) |

Charged against the seller's daily budget as `AgentUsageKind.CONVERSE` — a new enum value, no migration
(`kind varchar(16)`, nothing switches exhaustively).

---

## §7 Live QA

**Clean seller** (created by the product's own `POST /api/auth/signup`, `@example.invalid`, real browser
1440×900@2×). Eight sentences, eight different answers, each about what was asked:

| sentence | what the answer did |
|---|---|
| 너랑 사방넷 같은 솔루션이랑 뭐가 달라? | said it does not know that service, then described ours |
| 내가 그냥 네이버 판매자센터 들어가서 보면 되는 거 아냐? | granted the premise, then named what it adds |
| 결국 그냥 문의 답변 써주는 AI야? | refused the narrowing and named the other domains |
| 내가 매일 여기 들어와야 돼? | 「매일 꼭 들어오실 필요는 없습니다」 + what happens without them |
| 너 지금 할 수 없는 건 뭔데? | three limits, all from the sheet (no channel yet · no direct send · outside the four domains) |
| 세 군데 다 연결하면 같은 문의가 중복으로 보일 수도 있어? | per-channel storage, per-object dedupe |
| 쿠팡 리뷰에 고객 답글까지 달아줄 수 있어? | 「직접 하지 않습니다」 + what it does instead |
| 네이버 리뷰는 네가 알아서 등록까지 해줘? | no — and named NAVER's *guided* acquisition, which is the real verdict |

**Console errors 0 · off-host requests 0 · horizontal scroll 0 · document height 900.**

**Connected Demo organisation, same two sentences:** the answers are *different* and are about that
shop — three connected channels named, routine collection stated from `routineEnabled`, and NAVER/쿠팡's
first-time guided step named. Same code, different world.

Grounded turns: **10 answered, guard rejections 0**. When the capability was withdrawn for the QA
organisation the same three sentences logged `answered=false reason=EMPTY` and the deterministic answers
came back unchanged.

---

## §8 Verification

* backend **3,903** · frontend **2,779** · agent-runtime **994** · **failures 0** · typechecks clean.
* New suites: `groundedConversation.test.ts` (14) · `crossLaneContinuity.test.ts` (4) ·
  `AgentConversePayloadFloorTest` (4). The continuity assertion was **confirmed red on the old carry
  rule** before it was kept.
* **Tests rewritten: 0.** No safety test weakened; `AgentDraftBoundaryTest` gained a tenth row.
* **Marketplace calls 0 · WRITE 0 · approvals 0 · executions 0 · migrations 0 · DB row changes 0** ⇒ no
  evidence row. Model calls were the QA turns' planner and converse only.

---

## §9 Reported, not fixed

* **Object-level 「왜」 questions are still answered by showing the object.** 「왜 이 리뷰가 문제야?」 lands
  on the review lane, which draws `REVIEW_DETAIL` and its issue links rather than explaining. Extending
  the grounded lane to those turns means putting the object's own facts — and eventually a customer's
  sentence — into this capability's payload, which is a **floor decision**, not a wording one. The seam
  is ready (the fact sheet takes any list of our own sentences); the decision is not this package's.
* The **per-object** capability lane (`channel named` + `working set`) still answers with the runtime's
  composed two sentences. That is deliberate: it is a verdict about one object, not a question about the
  product.
* `capabilityAspect` is **still on the wire and still used** — by the deterministic fallback. It is no
  longer the thing that decides what a seller hears when the lane is on.
* The grounded answer is not deterministic: the same question twice may be worded differently. The facts
  are fixed; the sentence is not.
* Structural facts are four hand-written lines. Each names the code that makes it true and the count is
  pinned, but nobody re-derives them — the fifth one is how a fact sheet becomes a brochure.
* The lane costs one extra model round trip (**≈ 2.2 s**) on every product question. Whether that is the
  right trade for the pilot is a **product-owner decision**; the switch is per-organisation.
* Turning this capability on means **the seller's own sentences and this thread's transcript leave for a
  vendor on every product question** — a widening of the same kind the planner already makes, on more
  turns. Off by default, so it is a **deployment decision**, not a merge.
