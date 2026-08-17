# Review Triage Events — v1

**Status:** ACTIVE (pre-committed 2026-08-17, before the code that writes these events existed).
**Owner:** review AI triage pilot (`docs/workstreams/review_ai_triage_demo.md`).
**Related:** `contracts/review-eval/naver/v2/RUBRIC.md` §8.3 / §13.7 (what may be classified, and how
the pilot is bounded); `docs/slices/production-triage-feedback-draft-v1.md` §7–§8 (silver, asymmetry,
the two layers).

The product question every event is evidence about is one sentence, fixed in RUBRIC v2 §2.3:

> **이 리뷰로 인해 판매자가 확인하거나 조치할 일이 있는가?**

The events record what an AI said about that question, what the seller was actually shown, what the
seller explicitly answered, and what the seller then did. They record nothing else, they carry no
review content, and none of them trains anything.

---

## 1. Channels — the capability gate

Three channels are inside this contract. Every other channel is outside it: no endpoint accepts a
triage event for it, no UI renders a control that would produce one, and the classifier boundary
refuses it as `UNCLASSIFIED` (never a tier, never an exception, RUBRIC v2 §8.5).

| channel | AI triage (`확인 필요` suggestion) | see the original | reply | evidence |
|---|---|---|---|---|
| `NAVER` | yes | **none** — NAVER publishes no per-review URL and SellerOps has no locate surface for it | guided, unverified — the attention surface's copy-and-paste flow; SellerOps never confirms a post | roadmap §4.1 NAVER/REVIEW; ledger `:55` |
| `CAFE24` | yes | **none** — no admin deep-link is verified; none is invented | **no** — no reply flow is built | roadmap §4.1 Cafe24/REVIEW |
| `COUPANG` | yes | **locate run** — `[쿠팡에서 보기]`, an Action Window run that draws a border on the seller's own WING screen | **no — the channel has no reply feature (D8).** No reply event may ever be written for a Coupang review, by any path | `docs/coupang_review_policy_gate_v1.md` §6.1 D8, §7 |

The table is code: one class states it, the endpoints and the UI read it, and a test pins the three
rows. A capability that is `no` here is not "hidden" — it is refused server-side, so a client that
renders the button anyway records nothing.

**Why Coupang is inside the AI column at all.** RUBRIC v2 §8.3 and the Coupang policy gate's D6 both
said "no Coupang review reaches an external LLM". Both were widened on 2026-08-17 by product-owner
decision, for the AI triage pilot only, under the pilot's own bounds (opt-in per org, off by default,
operator-triggered, bounded, no marketplace write). The amendments are recorded where those rules
live (RUBRIC §8.3.1, policy gate §6.1.2), not here; this table only reflects them.

---

## 2. Event kinds

Every event names its `kind` from this closed list, its `channel`, the review, and **what the seller
was shown** at the time (`shownTier`, `shownSource`, §3). Nothing else is required; nothing else about
the review is stored on the event.

### 2.1 Common — every channel in §1

| kind | class | strength | written when |
|---|---|---|---|
| `AI_ATTENTION_SHOWN` | behaviour | silver, weakest | a row carrying the pilot's `AI 확인 필요` mark was rendered to the seller. Written **only** when the server itself resolves the display to `shownSource=AI` (§3); a client claim on a row the server would render as `RULES` is dropped |
| `REVIEW_OPENED` | behaviour | silver, weak | the seller opened the review's detail |
| `ORIGINAL_OPENED` | behaviour | silver, weak | the seller asked to see the original — pressed the channel's "see the original" control. Requires the channel's `see the original` capability |
| `MARKETPLACE_LOCATED` | behaviour | silver, weak | the locate run **reported the review found** on the seller's own marketplace screen (run `COMPLETED`). Requires the `locate run` capability — today Coupang only |
| `AI_AGREE` | explicit | **strong** | the seller answered 확인 필요 on a row shown as `AI` |
| `AI_DISAGREE` | explicit | **strong** | the seller answered 필요 없음 on a row shown as `AI` |
| `RULE_AGREE` / `RULE_DISAGREE` | explicit | **strong** | the same binary answer on a row shown as `RULES`. Evidence about the rating rule, kept apart from the AI's |
| `ACTION_STARTED` | explicit | **strong positive silver** | the seller pressed 조치 시작 |
| `ACTION_COMPLETED` | explicit | **strong positive silver** | the seller pressed 조치 완료 |
| `ACTION_NOT_NEEDED` | explicit | **strong** | the seller pressed 조치 불필요 — the **only** form "nothing to do here" takes |

### 2.2 Channel-gated — written only where §1 says the channel supports the action

| kind | class | strength | channels | written when |
|---|---|---|---|---|
| `REPLY_DRAFTED` | explicit | strong positive silver | `NAVER` | the seller states they drafted a reply for this review |
| `REPLY_SUBMITTED` | explicit | strong positive silver | `NAVER` | the seller states they posted a reply. **SellerOps never verifies a post** (no NAVER review API); this is the seller's own statement and is stored as one |

**Coupang: never.** A `REPLY_*` event for a Coupang review is refused with an error, not stored with a
flag. Cafe24: refused until a reply flow exists and this table changes.

### 2.3 What is deliberately not an event

- **`IGNORED`, `SKIPPED`, `DISMISSED`, or any absence.** A review nobody opened is a review nobody has
  said anything about. Absence of rows is confounded by queue position, staffing and time of day, and
  writing it as an event would give it the shape of a signal. It is **not a negative label**, not now
  and not at snapshot time.
- **A weight.** No event row carries one. Weighting is a policy applied when a silver snapshot is cut
  (§4), versioned with the snapshot, so it can be revised without rewriting history and so no reader
  can consume a weight without its policy.
- **A tier change.** No event moves a review, hides it, or marks it done on any surface.

---

## 3. Four records, kept apart

The reason the seller-policy layer can arrive later without contaminating the model's evidence is that
these four things are stored in four places and joined only by ids:

| record | table | what it is | mutability |
|---|---|---|---|
| **classifier prediction** | `review_triage_predictions` | what the frozen classifier said: model tier, guarded tier, reason, version, prompt hash, status | immutable history, one row per classification |
| **display decision** | `review_triage_ai_current` + `shown_tier` / `shown_source` on every event | what the seller was actually shown: `RULES` (the rating rule's tier) or `AI` (the pilot's additive mark). Resolved **server-side** by one function from (rule tier, current AI row, org opt-in) — never asserted by the client | `ai_current` rewritten per re-classification; the `shown_*` columns are frozen on each event at the moment it was written |
| **explicit feedback** | `review_triage_corrections` (+ `review_triage_correction_dispositions`) | the seller's binary answer, then a person's reading of it as `CLASSIFIER_ERROR` or `SELLER_PREFERENCE` | one live answer per review; disposition frozen once snapshotted |
| **action events** | `review_triage_actions`, `review_triage_behavior_events` | what the seller did — explicit acts and silver traces | append-only |

When a seller-specific policy layer exists, it will add a **third `shownSource`** (a policy-shaped
display) and its own provenance column; it will not touch the prediction table, and an event written
under a policy display will say so. Model judgment and display judgment are never the same row.

---

## 4. Silver rules (snapshot-time policy, not stored)

1. Explicit answers (`AI_AGREE`, `AI_DISAGREE`, `RULE_*`, `ACTION_NOT_NEEDED`) are **strong** evidence
   about the product question, and still **not gold** (RUBRIC v2 §9: a human confirming a label a
   model showed them measures agreement with the model).
2. `ACTION_STARTED` / `ACTION_COMPLETED` / `REPLY_*` are **strong positive** silver: someone decided
   something had to be done. They are never negative evidence about anything.
3. `REVIEW_OPENED` / `ORIGINAL_OPENED` / `MARKETPLACE_LOCATED` / `AI_ATTENTION_SHOWN` are **weaker**
   silver — traces of navigation.
4. **No absence is negative.** Neither an unopened row nor a shown-and-unanswered row lowers anything.
5. **Weights are decided when a silver snapshot is cut**, written into that snapshot's policy note, and
   versioned with it. **This unit hardcodes none.**
6. A silver snapshot and a correction snapshot are **separate artefacts with separate versions**
   (feedback draft §7.4). They are never merged into one file.
7. **Nothing here changes a running classifier.** A next classifier version is built offline and
   evaluated against gold and a frozen, numbered snapshot before it is considered.

---

## 5. Read model — what a consumer may see

- Per review: an ordered event list, each `{kind, shownSource, shownTier, at}`. No content.
- Per account: the funnel — `marked → AI_ATTENTION_SHOWN → REVIEW_OPENED → ORIGINAL_OPENED / MARKETPLACE_LOCATED → AI_AGREE / AI_DISAGREE → ACTION_STARTED → ACTION_COMPLETED`, plus `ACTION_NOT_NEEDED` and, where the channel supports it, `REPLY_DRAFTED / REPLY_SUBMITTED`. **Distinct reviews per step, counts not rates, and no step called ignored.**

---

## 6. Change log

| date | change |
|---|---|
| 2026-08-17 | v1 created, before implementation. Kinds, strengths, channel table, four-record separation, silver rules. |
