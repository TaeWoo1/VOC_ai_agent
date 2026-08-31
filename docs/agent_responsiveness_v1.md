# Agent Responsiveness v1

**2026-09-01 · `backend/` · `agent-runtime/` · `frontend/`**
**Marketplace calls 0 · marketplace WRITE 0 · migrations 0 · DB row changes 0**

The product problem this package exists for, stated plainly: a free-sentence turn took 8–27 seconds,
and every improvement the last four packages made to the Agent's *behaviour* was spent waiting. An
operations assistant that is right in twenty-five seconds is not an operations assistant.

Nothing here is a guess about where the time went. **§1 is the measurement**, and every change after it
names the number that justified it.

---

## §0 What this package must not trade away

The obvious way to make an agent fast is to stop asking a model what the seller meant. That is
forbidden here, and not as a matter of taste:

* `docs/sellerops_operator_graph_v2.md` is a product behaviour contract — **a typed sentence is planned
  by the LLM planner or the run fails**; there is no deterministic goal planner, in product, test or
  emergency use, and `plannerFence.test.ts` holds it.
* The instruction for this package added the same thing in the product owner's words: **per-example
  canned intents are prohibited, and semantic coverage may not be sacrificed.**

So no sentence classifier was added, no keyword table, no "fast interpretation" model that guesses
intent before the planner sees it. What changed is what the planner is *asked for*, what it is *given
to think with*, and what the screen does while it thinks.

The deterministic lanes that already exist (a click, an ordinal, a filter over the rows on screen, a
tone revision of the draft on the table) are **not** an exception to this: they act on objects the
seller is looking at, and they never interpret a goal. They were measured too — §1-C.

---

## §1 The measurement

### §1-A What was missing before it could be taken

`agent-runtime` timed its own plan stage, so **the vendor call, this repository's backend, and the
network arrived as one number**. A 30-second turn could have been a large prompt, a slow link, a queue,
or a reasoning model spending its output budget thinking — four problems, four different fixes, and no
way to tell them apart.

Added, and kept: `AgentLlmCallMetrics` (elapsed ms + the vendor's own token counts) reported on the
existing `agent_plan` / `agent_draft` log lines, on every path including failures. Metadata only — four
integers and a duration; it reads the vendor's `usage` block and never the request or the answer
(`AgentLlmCallMetricsTest`). The transport measures the duration because the duration is a transport
fact (`AgentLlmTransport.Response.elapsedMs`).

### §1-B Where the time went — one plan call, and its length

Five turn kinds, real Demo Org, `low` reasoning effort and prompt v9 (the state at `9cabedb1`):

| turn | total | plan | tools | judge | vendor ms | in tok | out tok | reasoning tok |
|---|---|---|---|---|---|---|---|---|
| 미답변 문의 몇 건이야? | 11,425 | 11,274 | 65 | 12 | 11,214 | 5,549 | 629 | 320 |
| 최근 문의 3개 보여줘 | 11,404 | 11,333 | 53 | 0 | 11,316 | 5,548 | 597 | 256 |
| 네이버 문의 보여줘 | 8,261 | 8,213 | 30 | 0 | 8,198 | 5,546 | 592 | 256 |
| 가장 시급한 문의가 뭐야? | 13,159 | 12,845 | 297 | 0 | 12,830 | 5,549 | 778 | 448 |
| 반복해서 문제가 생기는 상품 | 13,357 | 13,164 | 179 | 0 | 13,151 | 5,551 | 926 | 576 |

**One vendor call is 98–99% of every turn.** Tool calls are 30–300ms for as many as nine of them; the
judge is 0–12ms; this backend's own work between the runtime's HTTP call and the vendor's is 15–60ms.

And the vendor call's duration tracks **the tokens it emits**, not the tokens it reads. The input was a
constant 5.5k across every measurement, including the ones where latency later fell fourfold — so the
5.5k-token system prompt is *not* the lever, however large it looks. Of the 592–926 tokens emitted,
**256–576 were internal reasoning** on a plan whose answer is ~340 tokens of closed-vocabulary JSON.

### §1-C The lanes that were already instant

| sentence | lane | total | model calls |
|---|---|---|---|
| 그중 답변 안 한 것만 | visible filter | **8ms** | 0 |
| 첫 번째 거 | ordinal → inspect | **6ms** | 0 |
| 두 번째 거 자세히 보여줘 | ordinal → inspect | **6ms** | 0 |
| 네이버 것만 | visible filter | **6ms** | 0 |

So the product had **two** tiers and no middle: 6ms, or 8–27 seconds. Everything below is about the
second one.

---

## §2 The answer's length is the turn's latency

The plan schema was audited against the code that reads it. Four fields had **no consumer anywhere in
`agent-runtime`** — the validator copied them into a plan object and nothing ever read them again:

| field | what it is | consumers |
|---|---|---|
| `informationNeeds[].why` | one sentence per need | **0** |
| `retrievalStopWhen` | a sentence about when to stop retrieving | **0** |
| `stopWhenEnough` | a sentence about when the answer is enough | **0** |
| `retrievalParallel` | which needs could run in parallel | **0** (nothing parallelises) |

They were prose the model wrote, the network carried, and the seller waited for. Prompt **v10** stops
asking for them, and asks for `rationale` and `clarificationReason` only on the branches that read
them. Nothing that decides what a run *does* was touched — needs, kinds, specialists, tools, evidence
requirements, filters, target, action and tone are unchanged, which is what makes §5's before/after
comparable at all.

`promptAsksOnlyForFieldsWithAConsumer` fails if one comes back. If a consumer is ever written for one,
that test is the right place to argue with.

---

## §3 Reasoning effort: fast by default, deep on evidence

**Default `low` → `minimal` for the planner.** Measured on the same 14-sentence suite against the real
Demo Org: reasoning tokens 256–576 → **0**, emitted tokens 592–926 → 317–428, median turn 12.2s → 4.8s
— and the **same outcome on 13 of 14 sentences**, the fourteenth being a capability question the faster
setting answered with *more* evidence rather than less.

This is the planner only. The draft capability keeps its effort and was not re-measured: that model
writes the Korean sentence a customer will read, this one fills closed tokens into a schema, and they
are not the same kind of work.

### The tier, and why it is not a sentence classifier

"Deep reasoning only for the hard ones" needs a way to know a goal is hard. The only honest signal this
repository has is **that a first attempt did not settle it** — so the stronger effort is spent on
exactly one call: **the repair after the validator refused a plan**, which is being told which rule it
broke and asked again. That is a question with a right answer that thinking can reach
(`retry-reasoning-effort`, default `low`; blank turns the escalation off).

Two neighbouring cases were tried, measured, and rejected — both are recorded because both were wrong
in a way that only measurement showed:

* **A follow-up sentence is not a retry.** The first implementation read "is `priorContext` present" as
  "was this hard". That field carries two unrelated things: a re-plan's progress line, and the
  conversation's working-set line, which rides along on *ordinary follow-up sentences*. Every second
  sentence in a conversation started paying for deep reasoning — measured live at 5.6–9.6s against 3.4s
  for the same shape asked first. Fixed with an explicit `retry` flag on the wire, because only the
  caller knows which it is.
* **A graph re-plan is about the world, not the plan.** Measured live: one re-plan took 12.6s at the
  stronger setting and returned a plan with no needs and no specialists, on a turn that had already
  spent 6.6s — 19.4s total for a question that answers in 2.5s. Cost certain, benefit unobserved.

`plannerRetryFlag.test.ts` pins which single call carries the flag; `AgentPlanEffortEscalationTest`
pins what the backend does with it, including that a follow-up stays on the fast pass.

---

## §4 The seller's own sentence, before the network

Two waits stood in front of the words someone had just typed, and neither was about them:

* the user's turn was appended **after** `ensureId()`, so on a conversation's first message the bubble
  waited for a round trip;
* `send` **awaited the local-helper health probe** — up to 1.5s on a paired browser — before even that.

Now the bubble is drawn synchronously and both run underneath it. The helper hint still travels: it is
resolved beside the request rather than in front of the sentence, so nothing about what the runtime is
told has changed. Measured in the browser: **bubble at 7–18ms**, on every turn kind.

The progress row is not new and was already honest — it renders only the stages the runtime reports
(`UNDERSTANDING → PLANNED → READING → JUDGING → COMPOSING`), with a measured clock and no bar. What it
gained is a shorter wait to display. **No fake progress was added**: during the planner call the only
true facts are "understanding" and the clock, and that is still all it draws.

**Not fixed, reported:** a step-by-step view *inside* the planner call would need a new protocol
(id-first start, or SSE from the vendor through two hops). The call is one blocking request and the
runtime learns nothing until it returns.

---

## §5 Before / after

Same 14 sentences, same Demo Org, same machine. Before = `9cabedb1` (`low`, prompt v9). After = this
commit (`minimal`, prompt v10, repair-only escalation).

| sentence | before | after | |
|---|---|---|---|
| 미답변 문의 몇 건이야? | 12,341 | 3,433 | 3.6× |
| 최근 문의 3개 보여줘 | 10,210 | 3,147 | 3.2× |
| 네이버 문의 보여줘 | 9,103 | 3,178 | 2.9× |
| 가장 시급한 문의가 뭐야? | 13,280 | 3,920 | 3.4× |
| 반복해서 문제가 생기는 상품 | 25,218 | 5,822 | 4.3× |
| 현금영수증 관련 문의 있어? | 26,554 | 4,255 | 6.2× |
| 우리 배송 정책이 뭐였지? | 16,674 | 3,318 | 5.0× |
| 별점 낮은 리뷰 보여줘 | 12,122 | 3,504 | 3.5× |
| 최근 7일 매출 어때? | 12,236 | 4,050 | 3.0× |
| 답변 안 한 문의 보여줘 | 19,573 | 5,201 | 3.8× |
| └ 그중 네이버만 | 24,359 | 3,290 | 7.4× |
| 카페24 문의 보여줘 | 8,595 | 3,433 | 2.5× |
| └ 최근 문의 5개 보여줘 | 10,193 | 3,290 | 3.1× |
| 쿠팡 문의는 왜 답변을 못 보내? | 7,409 | 2,488 | 3.0× |

**Median 12,236ms → 3,433ms (3.6×). Worst case 26,554ms → 5,822ms (4.6×). Spread 7.4–26.6s → 2.5–5.8s.**

Every one of the fourteen produced the same status, the same artifact types, the same working-set kind
and count, and the same headline as before. The suite is an **outcome** diff, not a latency diff, for
that reason: a faster planner that answers a different question is not faster.

### Live browser, one thread, this build

| | bubble | answer | model | tools | stages reached |
|---|---|---|---|---|---|
| 최근 문의 5개 보여줘 | 14ms | **3,377ms** | 1 | 1 | 이해 → 계획 → 문의 확인 |
| 그중 답변 안 한 것만 | 12ms | **157ms** | 0 | 0 | — |
| 두 번째 거 자세히 보여줘 | 7ms | **159ms** | 0 | 0 | — |
| 우리 배송 정책이 뭐였지? | 8ms | **4,494ms** | 1 | 1 | 이해 → 계획 → 문의 확인 |
| 반복해서 문제가 생기는 상품 | 13ms | **6,233ms** | 1 | 9 | 이해 → 계획 → 리뷰 확인 |

Trace of the last one, from the runtime's own log: plan **5,874ms** · `search_review_issues` 94ms ·
`get_review_issue_evidence_summary` ×8 (4–10ms each) · dispatch 151ms · judge 0ms · total 6,042ms. The
plan call is still 97% of the turn — the ratio did not change, the number did.

Console errors 0.

---

## §6 The context-pollution defect

An org-scope answer that draws no list keeps the previous set as its **anchor** — deliberately, so that
a later 「그중…」 still has a referent. That carried anchor was also feeding the suggestion chips, so a
shipping-policy answer arrived with 「배송 관련부터」 and 「첫 번째 거 답변 준비해줘」 under it: three next
moves about rows that answer had nothing to do with.

The anchor is a fact about the conversation. The chips are examples of what to say next about **this
answer**. They are now two values: `drewSetOf(artifacts)` reads what the turn actually put on screen.

Chips about the **anchored inquiry** are deliberately kept, because the context bar is still naming it
(Working Context v1 §1) — the seller can see the object those chips are about. Verified live: the
policy turn now carries no list chips, and the anchor survives it.

---

## §7 What was NOT done, and why

* **The model was not changed.** Every capability defaults to `gpt-5-2025-08-07`, which the vendor marks
  deprecated, and `docs/image_product_knowledge_v1.md` §10 already records that migrating it is a
  **product-owner decision**. A faster or smaller model is the largest remaining lever — the planner's
  work is closed-token schema filling, which is the shape a smaller model does well — and this package
  deliberately did not spend it. Estimating from §1-B's token-vs-time relationship, a model at twice
  the emit rate would put the median near 1.7s; that is an extrapolation, not a measurement.
* **The 5.5k-token system prompt was not shortened.** It looks like the obvious target and the
  measurement says it is not: latency fell 3.6× while the input stayed constant. Cutting it would risk
  the routing rules that four packages of live QA put there, for a saving §1-B cannot see.
* **The draft capability was not touched or re-measured.** No draft was generated against the Demo Org
  in this package, because generating one writes a draft version against a real customer's inquiry.
  A PREPARE turn's second model call is therefore **unmeasured**, and the anchored PREPARE path's
  deterministic part remains ~0.2s (Agent Interaction Model v2).
* **No new progress protocol.** §4.
* **No caching of plans.** Two identical sentences in different conversations mean different things —
  the working set differs — and a cache keyed on the sentence would answer the second one with the
  first one's scope. A cache keyed on sentence *and* full context is a cache that never hits.

## §8 Verification

* backend **3,592 tests / 0 failures**, agent-runtime **756 / 0**, frontend **2,592 / 0**; both TS
  projects typecheck clean.
* Live: Demo Org, read-only sentences. **Marketplace calls 0 · marketplace WRITE 0 · DB row changes 0 ·
  migrations 0.** Planner model calls only (the measurement itself), no draft calls ⇒ no evidence row.
