# Agent Semantic Ownership Closure v1

2026-09-06 · HEAD at start `62c9ed2e` · agent-runtime only · backend files **0** · migrations **0** ·
marketplace calls **0** · WRITE **0** · approvals **0** ⇒ no evidence row.

Not a feature package and not a rewrite. One question: **after the planner has decided what the
seller's sentence means, how many other places decide it again?** The Agent Procedure Layer v1 audit
counted the readers and left the number as a finding; this package classifies every one of them and
removes only the duplicates.

The contract it closes on:

| owner | owns |
|---|---|
| **Planner** | what the seller's goal MEANS — the only thing that reads the sentence for meaning |
| **WorldState** | what is true of this seller's shop |
| **Procedure** | precondition · absence · next step |
| **Evidence** | the facts and what supports them |
| **Composer** | how it is said |

Planner · NeedKind · specialists · tools (31, all READ) · artifacts · ActiveTask · the approval
boundary · prompt v15 are **unchanged**. No new taxonomy, no DSL, no second planner. One field was
added to the plan-side vocabulary and it is the need's own token, described in §3.

---

## §1 Census — every post-planner read of the sentence, classified

Counted on comment-stripped source (`agent-runtime/src`), the same way the guard counts:
**70 reads across 21 files at `62c9ed2e` → 61 across 16 files after.**

Classes, as the brief set them:

- **A — a deterministic lane BEFORE the planner.** Legitimate: it decides what context to attach or
  answers a closed intent without a plan at all.
- **B — a boundary, or a meaning the planner provably does not carry.** Kept, and each one was traced
  against the real planner rather than argued about.
- **C — a second judgement of something the plan already decided.** Removed.

| site | decides | class |
|---|---|---|
| `ConversationService:469` `/이 상품/` | whether the anchor's product travels as a hint | **A** — runs before `runtime.run` |
| `directLane` — `visibleSelectionOf` · `visibleFilterOf` · `analyzeIntentOf` · `isAcquisitionRequest` · `subjectTermOf` · `pronounInspectOf` | the closed intents answered with no planner call | **A** |
| `OperationalDefaults` `resolveScope` · `settledPeriod` | plan-time settle, inside the planner | **A** |
| `scopeOverride` `namesOwnObject` · `hasRefineExpression` · `isAcquisitionRequest` | refine-vs-new-question — the planner never sees the working set | **B** |
| `reviewRows` `isAcquisitionRequest` | 「새로 가져와줘」 — traced: plan returns `NONE`, the schema has no acquisition token | **B** |
| `compose` `analyzeIntentOf` | advice vs command — traced: the planner answers `PREPARE_INQUIRY_DRAFT` for **both** 「초안 만들어줘」 and 「뭐라고 답하면 좋을까」 | **B** |
| `compose` `locateBySubject` | a bounded READ when the plan's target did not resolve | **B** |
| `inquiryOps` `policyTopicOf` | the planner's `filters.topic` FIRST, words only when there is no token | **B** — the shape the others should follow |
| `inquiryOps` policy / answer-memory query · `productOps` `factKeysFor` and search query | the words a search runs WITH, not a judgement about them | **B** |
| `reviewOps` `senseOf(goalText)` | which review evidence answers the question | **C** → §2 |
| `compose` `COMPANY_INTRO_ASK` | whether the seller asked to READ the company introduction | **C** → §3 |
| `compose` `sentenceSubjectOf` · `effectiveAxisOf` · `focusForAxis` · `channelFocusOf` | the run's axis — settled a second time | **C** → §4 |
| `inquiryRowsStep` · `inquiryWorkloadStep` `subjectTermOf` | the subject noun — derived a second and third time | **C** → §4 |
| `operatorGraph` `DRAFT_WORDS` | whether the seller asked for a reply draft | **C** → §5 |

Everything in **B** stayed. Two of them are boundaries in the strict sense; the rest are meanings the
planner **provably does not carry**, and the proof is a trace, not an opinion — those traces are in
§2–§5 and in `semanticOwnership.test.ts` §E, which pins the survivor list by name so a fourth cannot
arrive unnoticed.

---

## §2 The review sense was the plan's all along

`ReviewEvidenceSense` decided, from two Korean word lists, whether a question was about **negative
reviews** (whole reviews the ingest flagged) or **issue evidence** (opinion units tied to a repeated
problem). Its own neighbour `specialistInput.ts` had written down why that is forbidden — *"a
specialist that keyword-matched the goal to decide would be the second planner invariant I2 forbids"* —
about a different axis, while this one did exactly that.

The brief asked for a real trace rather than an argument. Eight sentences, real planner, Demo Org,
2026-09-06:

| sentence | plan's tools | old word table | plan |
|---|---|---|---|
| 최근 부정적인 리뷰가 있는 상품을 알려줘 | `list_recent_reviews` · `get_dashboard_product_issues` | NEGATIVE | NEGATIVE |
| 별점 낮은 리뷰가 많은 상품이 뭐야? | `list_recent_reviews` · `get_dashboard_product_issues` | NEGATIVE | NEGATIVE |
| **리뷰가 안 좋은 상품 뭐야?** | `get_dashboard_product_issues` · `list_recent_reviews` | **ISSUE (wrong)** | **NEGATIVE** |
| 리뷰 문제가 반복되는 상품 알려줘 | `search_review_issues` | ISSUE | ISSUE |
| 요즘 자꾸 나오는 불만이 뭐야? | `search_review_issues` | ISSUE | ISSUE |
| 최근 반복적으로 리뷰 문제가 나온 상품은? | `search_review_issues` · `get_dashboard_product_issues` | ISSUE | ISSUE |
| 부정적인 리뷰가 반복되는 상품이 있어? | `search_review_issues` · `get_dashboard_product_issues` | ISSUE | ISSUE |
| 상품별로 리뷰 문제가 있는 상품을 알려줘 | all three | ISSUE | ISSUE |

The plan agreed on seven and was **right on the eighth**, where the table matched neither list and fell
to its default. The table was not a safety net; it was a weaker planner for a question the first one
had already answered.

**It is a ladder, not one lookup, and the trace is why.** The planner names
`get_dashboard_product_issues` liberally as a supporting read, so a plan holding BOTH names is still the
issue question. `get_review_issue_evidence_summary` → ISSUE; else `search_review_issues` → ISSUE (the
conservative direction this module always took); else `get_dashboard_product_issues` → NEGATIVE; else
ISSUE. `candidateTools`, never `allowedTools` — the allow-list holds all three whatever the plan said,
so reading it would answer the same sense every time.

Decided once in the graph beside `grouping` and `channelScope`, passed as `SpecialistInput.reviewSense`
— the convention that file already documents.

**Landed live**: on the Demo Org, 「리뷰가 안 좋은 상품 뭐야?」 now answers *「…에 부정 리뷰가 3건
있습니다」*. Before, that sentence produced the issue split.

---

## §3 「회사 얘기가 질문이었나」 — and the correction I had to make

The first attempt deleted the `COMPANY_INTRO_ASK` regex outright, reasoning that the
「회사 정보에는 이렇게 등록돼 있습니다」 finding is produced in exactly one place (the `COMPANY_PROFILE`
branch of InquiryOps) and `get_seller_profile` is invoked nowhere else, so the finding's existence
already proves the planner read the sentence as a company question.

**That was wrong, and the trace said so.** 「우리 회사 특성 고려하면 배송 문의에 어떻게 답하는 게
좋을까」 declares `COMPANY_PROFILE` **beside** `POLICY` and `PAST_ANSWER`. The need means "this turn
needs the profile", not "the seller asked to read it", and reading the whole introduction back on that
turn is the noise §3 of Response Hygiene was written to stop.

The regex was still wrong — measured six ways:

| sentence | old regex | sole `COMPANY_PROFILE` need |
|---|---|---|
| 우리 회사는 어떤 회사야? | **false (wrong)** | true |
| 우리 회사에 대해 알려줘 | **false (wrong)** | true |
| 저희 회사 소개 뭐라고 등록돼 있어? | true | true |
| 회사 정보 등록돼 있어? | true | true |
| 우리 회사 특성 고려하면 배송 문의에… | false | false |
| 우리 회사 스타일에 맞게 문의 답변 초안 만들어줘 | false | need not declared at all |

So the signal is **the plan's shape, not its words**: `companyIsTheQuestion(answer)` — the company
profile was the run's *only* need. 6/6 against the trace, and it fixes the two most ordinary ways to
ask, which the regex silently replaced with 「등록된 회사 정보를 참고했습니다」.

To ask it, the answer now reports each need's own `kind` (`AnsweredNeed.kind`). That is not a new
meaning invented for one consumer: the need already carried the token, and only the prose `question`
was being reported, which is why a downstream reader had nothing but the sentence to re-read.

One deliberate behaviour change to record: 「회사 소개를 어떻게 써야 할까?」 plans `COMPANY_PROFILE`
beside `POLICY` and `PAST_ANSWER`, so it now refers rather than reads back. That is the conservative
side, and the seller can ask directly.

---

## §4 The run's axis was settled twice

The graph settles the conversation axis once per dispatch — the plan's tokens with the scope override
and the thread's channel applied — logs it, and hands it to every specialist. `ConversationService`
then settled it **again** from the same plan, the same working set and the same sentence, and the
second call passed `emitLog = false` *because it knew it was the repeat*. Two settlements of one
question are two chances to scope the rows and the sentence about them differently.

It is now a state channel (`OperatorState.axis`), carried on `OperatorAnswer.axis`, read back by the
composer. Three sentence reads gone from `compose` (`sentenceSubjectOf`, `effectiveAxisOf`,
`focusForAxis` + its `channelFocusOf`), and the run's own decision is now the only one there is.

Same shape one level down: `subjectTermOf` was called in the graph and then **again** in
`inquiryRowsStep` and `inquiryWorkloadStep`. It is now `SpecialistInput.subjectTerm`, beside
`grouping`, `channelScope` and `periodNamed`, whose docblock already said why: *"a specialist that
worked this out for itself would be a second place deciding what 상품별 means."*

And `sentenceSubjectOf` existed **twice** — inline in the graph and as a private helper in
`ConversationService`. They agreed, and nothing made them. One definition now, in `scopeOverride.ts`
beside the type it builds.

---

## §5 A word list that could only be wrong

The graph carried `DRAFT_WORDS` = 초안 · 답변 작성 · 답장 작성 · 답변을 작성 · 써줘 · 작성해줘, and
printed 「답변 초안 작성은 이 대화 창구에서 하지 않습니다」 whenever the plan's `requestedAction` was
`NONE` and the sentence held one of them.

Traced 2026-09-06: the planner answers `PREPARE_INQUIRY_DRAFT` for **every** reply-draft sentence tried
(five of five, including 「리뷰 답변 초안 써줘」 and 「미답변 문의 정리하고 답변도 작성해줘」) — and the
guard suppressed the notice in exactly those cases. The list's only *distinct* output was a false one:
「제품 설명 문구 써줘」 plans as `NONE`, contains 써줘, and was told that reply drafts are not written
here — about a request that was not about replies at all.

A second reading that can only disagree by being wrong is not a safety net. The notice and its list are
gone; the READ-only ceiling is still enforced where it always was, by `OperatorToolRegistry` refusing
to register anything else.

---

## §6 Scenario eval — twelve manual-QA defects, as conversations

`test/scenario/qaDefects.scenario.test.ts`, on the layer Agent Procedure Layer v1 built: `world` is a
first-class axis, `never` is as first-class as `expect`, and **CI calls no vendor** (plans replayed from
`SCENARIO_PLANS`; two new ones recorded from the live planner on 2026-09-06).

1. `[NO_CHANNEL]` an empty answer says why it is empty — never 「지금 먼저 하실 일은 없습니다」, never 「0건」
2. `[CONNECTED_NO_DATA]` the collection state, not "no work"
3. `[NO_CHANNEL]` the second capability question is answered with the next step — and never names the 도우미
4. `[WORKING]` the capability answer is heard once, and no connect CTA reaches a connected seller
5. `[WORKING]` a turn that FOUND work never claims there is none
6. `[WORKING]` a new list of the org does not inherit the previous set's frame (never 「방금 본」)
7. `[WORKING]` a pronoun with no referent asks back and buys nothing (`llmCalls: 0`)
8. `[WORKING]` a refine of the rows on screen stays on them
9. `[WORKING]` 「제품 설명 문구 써줘」 is not answered with the reply-draft notice — §5
10. `[WORKING]` the sentence about a set and the set itself are scoped by one decision — §4
11. `[WORKING]` an off-topic sentence is refused with no answer-shaped artifact beside it
12. `[WORKING]` an ordinal over the visible set opens that object and calls no model

**They bite.** Restoring the draft-word notice turns #9 red along with two structural assertions;
re-adding a Korean word array beside a `goalText` turns three red. Both were reverted.

`test/operator/semanticOwnership.test.ts` pins the structure: the sense's one caller, the retired
regex, the axis read back once, `subjectTermOf`'s call sites, no Korean word ARRAY beside a `goalText`
in any post-planner module, the class-B survivor list by name, and the read count itself (≤ 61 across
≤ 16 files) — a number that may fall freely and may not rise without this test being edited on purpose.

---

## §7 Verification

- agent-runtime **883 passed / 23 skipped**, frontend **2,762 passed**, both typechecks clean.
- Backend source **untouched**; frontend source **untouched**.
- Live browser, real planner, 1440×900@2×, after restarting the stack on this code —
  **console errors 0 · off-host requests 0 · backend ERROR 0 · runtime error events 0**:
  - clean seller, the same three turns: capability card → 「시작하는 방법」 (no 도우미) →
    「아직 연결된 판매 채널이 없어서…」 with `1. 판매 채널 연결하기`. **Byte-for-byte the same answers as
    before this package** — zero regression on the flow it did not touch.
  - Demo Org: capability said once with no connect CTA · 「지금 하실 일을 정리했습니다 (2건)」 above
    23 real inquiries with no absence claim · **「리뷰가 안 좋은 상품 뭐야?」 → 부정 리뷰 per product**
    (§2 landing live) · 「제품 설명 문구 써줘」 with **no** draft notice (§5).

### Contracts that changed, and the tests rewritten for them

Three, all rewritten to assert **more** than before; no safety test weakened.

- `responseHygiene.test.ts` §3 — its fixture gave the 「우리 회사 특성 고려하면…」 sentence a single
  `COMPANY_PROFILE` need, which the live planner does not do. Re-recorded to the measured three-need
  shape, and a new case pins the rule directly.
- `groupedProductAnswers.test.ts` — the sense unit test now passes measured tool lists instead of
  sentences, each with the sentence it was recorded for in a comment.
- `specialistFailureSemantics.test.ts` — asserted a note the live planner makes unreachable for its own
  sentence. It now asserts the opposite, and keeps the READ-only assertion that was the real point.

Three plan fixtures were re-recorded (`NEGATIVE_REVIEWS_CLARIFY_PLAN`, `REPEATED_REVIEW_AXIS_PLAN`,
`GROUPED_NO_PERIOD_PLAN`): their `tools: []` came from runs where the clarification meant zero tools
ran, and the sense now reads that field. Their docblocks said what was exact — needs, clarification,
period — and tools were never among it.

---

## §8 Reported, not fixed

- **The 15 post-planner modules that read `goalText` are now 13, not 0.** Everything left is class B,
  each traced; `AgentPlanPrompt`'s claim that *"the planner is still the only thing that reads the
  sentence"* is still not true and is still worth saying out loud.
- **`analyzeIntentOf` is the one B that a small closed field could retire** — advice vs command is a
  real distinction the planner does not carry. It has one consumer today, and the brief forbids putting
  a single-consumer meaning on the plan schema, so it stays. If a second consumer appears, this is the
  first candidate.
- **`ConversationService:442`'s `/이 상품/`** is class A and unchanged.
- The company read-back branch was **not observable live**: the Demo Org has no company profile
  registered, so the turn takes the GAP branch. The behaviour is fixed by unit test only.
- `groupingOf` is still called twice in the graph — once for a log line, once for the dispatch. Same
  pure function, same inputs, one owner; left alone deliberately rather than counted as duplication.
