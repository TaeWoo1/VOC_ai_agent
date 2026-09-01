# Frontend-first Agent Workspace Redesign v1

2026-09-01. Scope: `frontend/` (the conversation surface, the home, the shell), `agent-runtime/`
(the focus contract and one existing action learning a second answer), and one backend prompt line.
**No planner, retrieval or conversation-semantics work**: the deterministic lanes, the scope rules,
`subjectTerm`/`reference`, `scopeOverride`, the approval boundary and every read this product makes are
the ones `agentic_experience_ux_v2.md` left. **Marketplace calls 0 · WRITE 0 · migrations 0.**

The goal was not more features. It was to make an Agent that already works **feel like a capable
operations person**: fewer containers, a rhythm, one place per fact, and an object the conversation
visibly stands on. The acceptance test was the screen — Playwright walkthroughs of eight flows on a live
disposable org, **at 1440 / 1366 / 1152**, before and after.

Reference patterns (interaction only — no branding, no pixels copied): Rovo/Notion *work with the
current object*, Linear *triage with a stated reason*, Asana Dash *proactive briefing*, Devin *real
progress*, Sierra *insight → evidence → action*, Glean *the user states an outcome*. Visual density was
judged against ChatGPT/Claude: **content, not containers**.

---

## §1 What the audit found (measured, not assumed)

Eight flows driven through the product UI, screenshotted at three widths before any change
(`fe-before/*.png`, kept outside the repo — they contain real customer sentences). Counted per screen at
1440: bordered rounded boxes, bordered elements, pill controls, AA text violations.

| # | Root problem | The measurement |
|---|---|---|
| R1 | **A stack of boxes, not a conversation.** Canvas → card → row → nested action strip, whatever the answer's size | 5–10 rounded boxes and up to 22 bordered elements per screen |
| R2 | **The same fact and the same action, up to three times.** Per inquiry row: a ↗ icon, a 「문의 화면에서 열기」 button, and a card-footer link | 5 rows ⇒ 5 shared 「답변 필요」 badges + 5 icons; the receipt date AND the wait on one line |
| R3 | **System state outweighed the work.** On a screen whose subject was 8 customer complaints, the only solid button was 「최신 상태로 갱신」 | collection state said in a footer, a step card and two note lines |
| R4 | **The deliverable was the smallest text.** The draft: 16px regular in a grey inset inside a white card, under a 17px announcement of it | draft body `base`; announcement `[17px]` |
| R5 | **Only inquiries were objects.** Product rows had no press, no facts and no follow-up; a review row expanded but could not be the current object; the context bar could only ever name an inquiry | `product-row-select` did not exist |
| R6 | **The thread history outweighed the navigation.** 12 near-identical truncated sentences, each with a time column, above 5 nav items | — |
| R7 | **The product answered a question about itself with the seller's shipping policy** | 「너는 어떤 일을 도와줄 수 있어?」 → 「어느 채널에 대한 질문인지 알려주세요」 + a quote of 배송 기준 |
| R8 | Two AA violations on the home | decorative 「·」 at **1.12:1** |

---

## §2 Rhythm and weight (ChatGPT/Claude — content, not containers)

24px between turns, 12px inside one: **nothing inside a turn is spaced like a turn.** The answer is
prose at `base` 16/1.7 on the canvas with no container, and it is deliberately **not** the largest thing
in its own turn — the object is (§4). A plain answer stays prose: a `SUMMARY` renders as sentences under
a quiet title, and a paragraph never earns a card.

## §3 One control per row (Linear)

The row IS the control. Its workspace link lives inside the row it belongs to, as a text link, once —
the icon beside every row is gone, and the expansion's second button became a text link so the
row's own primary (「답변 준비」) is unambiguous. Three copies of one action in three visual weights make
the seller decide which one is real.

## §4 The object the seller opened is the largest text in the turn

The customer's message and the draft body are `lg` (design contract §1, which already said so). The
draft also stopped being a panel inside a panel: one hairline on the left marks it as quoted text. And
the send guarantee 「아직 아무 곳에도 보내지 않았습니다」 got its own line instead of running together with a
link as if the two were one sentence.

## §5 One fact, one rendering — generalized

- **A word every row shares is not a distinction** (`lib/conversation/sharedWord.ts`, now used by the
  inquiry and review lists). It is said once in the caption — or **not at all** when the seller asked for
  that state, because the sentence above already says it. The signal is `scope.status`, not a guess.
- **A wait replaces a receipt date** rather than standing beside it: 「1개월 전」 and 「40일째 대기」 are one
  fact in two renderings, and the one that explains the order keeps the space.
- **One header row per card**: title (when it is not a repeat of the sentence above) and meta share the
  left, the action keeps its one place. A card whose title was already said used to open with a lone
  button floating over a blank line.

## §6 System state is secondary disclosure (Sierra — insight → evidence → action)

An **offered** refresh is an `outline` control; only a step the answer genuinely waits on takes a solid
primary. The home's freshness line stopped being `warn` — a qualification that applies to the numbers
beside it is read in the same breath as them, not as an alarm.

## §7 The current object, for all three kinds (Rovo / Notion)

The conversation can stand on ONE object — **문의 · 상품 · 리뷰** — and a press is the same state
transition as naming it (`select`, verified in the runtime, persisted, appended to the transcript as
nothing). 「해제」 is that transition backwards and drops whichever anchor is held.

**Verified by what can actually prove each kind.** A product the thread already drew came from an
org-scoped read and needs no second one; a product id the thread cannot account for costs exactly the
read a product-screen launch makes, and a failure changes nothing. A review is verified by the thread's
own record of having drawn it — there is no single-review endpoint, and inventing one to check a click
would be a read the seller did not ask for.

**A product is named; a review is described.** The context bar resolves a name from the artifact the
thread already drew. A product's name is the seller's own catalogue label and survives a reload; a
review's text is the customer's and is transient by contract, so the bar says 「선택한 리뷰」 with the
closed facts (product · ★ · date) rather than promising to quote it.

**The bar is attached to the composer** — one outline, because the object the next sentence is about and
the place that sentence is typed are one thing.

## §8 A question about the assistant is answered by the assistant

`EXPLAIN_CAPABILITY` already existed and already got the routing right; it had only ever learned to talk
about **a channel**, so a question about reviewnary itself fell through to 「어느 채널에 대한 질문인지
알려주세요」. The two are told apart by **the plan's own structure, never by words**: a capability question
that named no channel and declared nothing to look up is about the assistant.

The answer is **derived** (`operator/capability/AssistantCapability.ts`):

- **what it can look at** — the specialists that own at least one REGISTERED tool
  (`TOOL_CAPABILITIES` ∩ the catalogue the runtime builds). Add a tool with a caller and the answer
  gains its domain; remove the last one and the domain disappears.
- **what is connected right now** — one org-scoped `get_channel_coverage` READ, the same one every
  channel-aware answer makes. A read that fails costs that sentence and nothing else.
- **the boundary** — `registry.actionClasses()`. The catalogue is READ-only by construction
  (`OperatorToolRegistry` refuses to construct with anything else), so 「제가 직접 채널에 보내거나 고치는
  일은 없습니다」 is a statement about the object graph, not a promise.

No canned reply keyed to an example sentence, and no hand-maintained feature list — both were available
and both are what goes stale the first time the product changes. Prompt **v13** teaches the planner to
declare no information need for this question (that is where the 배송 기준 quote came from).

## §9 Shell

The thread list drops its per-row time column: the list is ordered by recency already, and the column
restated the order it was in while turning twelve near-identical sentences into a table. The home's
decorative 「·」 became drawn dots (R8).

---

## §10 Verification

- agent-runtime **789** · frontend **2,615** · backend **3,593** · **0 failures** · typecheck clean on
  both TS projects.
- Live walkthrough of eight flows **before and after at 1440 / 1366 / 1152** on a disposable QA org
  created through the product's own signup (15 inquiries · 14 reviews · 3 products · 3 policies; **no
  real seller data**). Console errors **0**, off-host requests **0**, horizontal scroll **0** in both runs.
- **AA text violations 0 at all three widths** (composited over painted ancestors), from 2 before.
- Rounded containers across the eight comparable screens: **61 → 54**. `d-capability` went the other way
  (2 → 5) and that is the point of §8: it went from a two-line refusal to a real answer with next steps.
- **Marketplace calls 0 · marketplace WRITE 0 · DB row changes 0 · migrations 0** ⇒ no evidence row.

### Test contract deliberately rewritten (1)

`AgentHome.test` asserted that every brief row carried its own 「문의 화면에서 열기」 link. That control is
the one §3 removes; the assertion now states the new contract (the row is the control, and no duplicate
link stands beside it).

## §11 Reported, not fixed

- **A REVIEW anchor carries, but nothing answers "about this review."** There is no single-review read in
  the runtime, so a follow-up on an anchored review is planned like any other sentence. Tried and
  **reverted within this package**: letting 「이 리뷰」 resolve to that review's product turned 「이 리뷰는
  어떤 상품 문제야?」 into a product-scoped review read that answered with that product's most recent
  review — a five-star one. A demonstrative that names one object must not silently become a scope over
  another; the honest state is that the anchor is held and shown, and the planner decides.
- **One channel's collection state can still be said twice in a turn** — once by a step card and once by
  a note line. The step-vs-footer duplication is closed structurally (`stepped`), but the runtime's note
  sentences are not tagged by channel, so merging them would mean matching prose. That is a runtime
  wording question, not a layout one.
- **The brief card's title 「가장 오래 기다린 문의」 still sits under a sentence that says 「가장 오래 기다린
  것부터」.** The suppression rule is exact containment on purpose; loosening it into fuzzy matching would
  start dropping headers that carry something.
- **The disconnected first-use home is still unobservable in this org** (all three channels are
  connected), as the two previous packages also reported.
- The QA org's daily AI budget and capability allowlists were raised in `backend/.env.local` for the
  walkthrough and restored from the pre-package copy afterwards. No product default changed.
