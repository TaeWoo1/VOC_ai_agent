# Agent Object + First-use Closure v1

2026-09-01. Scope: `agent-runtime/` (the review anchor's read and the anchor's lifetime), one **new
backend READ** (`GET /api/reviews/{reviewId}`), and `frontend/` (the review card, the first-use home,
two structural de-duplications). **Conversation and planner semantics are frozen**: the deterministic
lanes, the scope rules, `subjectTerm`/`reference`, `scopeOverride`, the approval boundary and the LLM
planner's contract are the ones `frontend_agent_workspace_v1.md` left. **Marketplace calls 0 · WRITE 0
· migrations 0 · new intents/cues 0** (one existing cue table gained one noun — §1-C).

Two questions, and the package is exactly them:

1. **Is the thing the UI calls "the current object" something the seller can actually work with?** A
   review could be anchored and nothing could be said about it — the honest state the previous package
   reported.
2. **Does the first morning look like a product?** Two of the three first-use states were answered with
   a sentence written for the third.

---

## §1 A review is a first-class current object

### §1-A The read that did not exist

The runtime had two review reads: a WINDOW list and an org-wide ISSUE list. Neither can answer a
question about ONE review, so an anchored review had two possible outcomes and both were wrong —
silence, or the widening that was **tried and reverted inside the previous package**: letting 「이 리뷰」
resolve to that review's product answered 「이 리뷰는 어떤 상품 문제야?」 with that product's most recent
review, a ★5 under a question about a ★1.

`GET /api/reviews/{reviewId}` (`ReviewDetailService`) is that read, and it is bounded by construction:
one review row, its product, its channel, its account, and **this review's own issue-evidence links**.
Org-scoped from the JWT; an id this org does not own is a 404, indistinguishable from one that does not
exist. `body` is the **redacted full text** (`VocPreviewSanitizer.redactFullBody`), not the 60-character
list preview — the question this read answers is what the customer wrote.

`issues` is the honest answer to 「왜 이런 리뷰가 나왔을까」: the repeated problems **this review is
already recorded as evidence for**. A count over the product would be a different claim about different
rows, and a review no extractor tied to a problem says so rather than having a cause invented from its
rating.

### §1-B Identity persists; the customer's words do not

`REVIEW_DETAIL` is the artifact, and it follows the rule `INQUIRY_DETAIL` set: the ids and closed facts
persist, `body` is **stripped before the turn is stored**, and the card re-reads it from the same exact
endpoint when a reload needs it. One copy of a customer's sentence, ever.

**The anchor now survives the turn that answers about it.** `workingSetOf` returns null for a turn that
drew artifacts but no SET — so a product or review anchor was dropped by the very turn it produced, and
the second 「이 리뷰…」 went to the org. One rule for all three kinds: the anchor stands until a NEW set
is drawn that does not contain it (`drewFreshObjectList`, the object analogue of `drewFreshList`).

### §1-C 「이 리뷰 자세히 봐줘」 — the planner has no token for "this object"

Measured live: that sentence was planned as review **ROWS with `limit: 1`**, which read the product's
most recent review. The planner is not wrong — it has no vocabulary for "the object the seller is
standing on", and this package does not add one.

What it uses instead is the lane that **already existed for the same sentence about the other object**:
`pronounInspectOf` (「이 문의」 / 「이 고객」 / 「이 문의 자세히」). Its noun list is the objects a
conversation can stand on, and 리뷰 · 상품 join it — **one existing table, one more noun, zero new
cues.** The lane makes ONE read, calls no model, and draws the same card the graph draws.

For everything else the planner still plans, and **the anchored object is always in the answer**
(`reviewOps`): the exact read runs first whatever the plan asked for, and a ROWS request adds the
neighbours BESIDE it — the same product's reviews, with the widening named
(「방금 보신 리뷰와 같은 상품의 리뷰입니다.」). A plan that asked for exactly one row asked for the anchor.

A set that is the anchor alone is **not** a filter to intersect with: after a click the working set holds
one id, and 「같은 상품의 비슷한 리뷰도 보여줘」 was intersecting the product's rows down to the review the
seller was already looking at (「방금 본 1건 중 1건」). Asking about an object's neighbours is not a
narrowing of that object.

### §1-D What the seller can DO with it, and where the boundary is

The card carries `replyCapability`, resolved by the same `capabilityOf` every other execution decision
uses. `NOT_SUPPORTED` says the channel takes no seller reply; **`UNKNOWN` says we did not check** — a
different sentence, and the only honest one when the capability read failed or was not bought (the
deterministic lane buys one read, not two). The reply control is rendered only for `DRAFTABLE`, so the
card never offers a move the channel refuses.

---

## §2 The three first-use mornings

`homeFirstUseState` derives one of three states from `metrics.channels` — the numbers the page already
has, never a second read that could disagree with the table six inches below.

| state | what is true | what the home says |
|---|---|---|
| `NO_CHANNEL` | nothing connected | 「판매 채널을 연결하면 시작할 수 있습니다」 + **what connecting hands over** + one action |
| `NO_DATA` | connected, nothing held yet | 「…연결은 끝났습니다. 첫 수집이 끝나면…」 (or, when a collection HAS run and returned nothing, 「아직 들어온 …이 없습니다」) |
| `WORKING` | there are rows | the ordinary brief, unchanged |

**「지금 먼저 확인할 일은 없습니다」 is true in exactly one of these and a lie in the other two.** It reads
as "the product looked and your store is quiet" — a claim about the seller's business that no read
supports on the morning they connected. The opener turn is therefore drawn only in `WORKING`.

What connecting hands over is **derived, not written down**: a data type is delegable when at least one
channel on this seller's own table offers a path for it, so a channel whose reviews this product cannot
collect never appears as a review promise. `NOT_SUPPORTED` is not "not connected" and `ZERO` is not
"not collected" — those distinctions are what let the two `NO_DATA` sentences differ.

---

## §3 Two duplications, closed structurally

- **A channel's collection state is said ONCE, by whichever thing carries the control.** A step card
  already names the channel, the as-of instant and the move; the prose sentence beside it was the same
  fact in weaker words and the seller had to work out that the two were about one channel. The card
  wins — it is the only one of the two that can be acted on — and channels with NO card still say their
  sentence. (`reviewRows.ts`; the gap stays evidence, so the coverage limit is not lost.)
- **A repeated title is DECLARED by the producer** (`ArtifactBase.titleSaid`). The renderer used to
  test whether the headline CONTAINED the title — a string search standing in for a fact only the
  writer of both sentences knows: 「가장 오래 기다린 것부터 보여드릴게요」 over a card titled 「가장 오래
  기다린 문의」 is a repeat no containment test can see. Containment stays as the fallback for producers
  that have not declared, where the two strings are literally equal.
- **A turn that drew ONE object's card does not roll the same evidence up underneath it.** The card
  names the review and its product; 「이 답변이 가리키는 상품 · 선택한 리뷰 1」 below it was the object
  counted a second time.

---

## §4 The capability answer follows the catalogue, one read at a time

`assistantCapabilityAnswer` gained per-tool clauses: a domain's extra sentence is said only when the
tool behind it is REGISTERED. So 「리뷰 하나를 고르시면 그 리뷰만 놓고…」 appears because
`get_review_detail` exists, and would disappear with it. No hand-maintained feature list, and the
boundary sentence is still `registry.actionClasses()` — the catalogue is READ-only by construction.

---

## §5 Verification

- backend **3,594** tests / 0 failures · agent-runtime **796** · frontend **2,627** · 0 failures ·
  typecheck clean on both TS projects.
- **Live browser QA at 1440 / 1366 / 1152** on a disposable QA org created through the product's own
  signup (no real seller data), with the three processes restarted on this commit:
  - **review object**: list → press a row (context bar: 「선택한 리뷰 · 실리콘 몰딩 2호 · ★1 · 2026-08-29」)
    → 「이 리뷰 자세히 봐줘」 answered ★1 / 카페24 / 2026-08-29 with the customer's own sentence
    (**model calls 0**) → 「왜 이런 리뷰가 나온 것 같아?」 stayed on that review → 「같은 상품의 비슷한
    리뷰도 보여줘」 drew the product's 5 rows beside the anchored card, named as the same product's.
  - **reload**: the context bar still names the review and the body is re-read from the exact endpoint.
  - **product object**: press a product row → 「이 상품 리뷰에 어떤 문제가 있어?」 answered
    「논슬립 주방 매트 45x120에 "포장 파손" 문제로 기록된 리뷰 근거가 4건」.
  - **inquiry object**: unchanged, re-proven end to end.
  - **capability**: the derived answer now carries the review and catalogue clauses.
  - **first-use**: a real disconnected org (signup) for `NO_CHANNEL`; `NO_DATA` rendered in the same
    real browser with the overview response rewritten at the network boundary — **no DB row is
    invented**, and this is exactly what the state means for the minutes after a first connection.
  - **AA text violations 0 at all three widths · console errors 0 · off-host requests 0 ·
    horizontal scroll 0.**
- One colour token moved: `bad` #DC2626 → **#B91C1C**. The 「부정」 chip sits on a `bad/10` tint and
  measured **4.49:1** there — under AA by a hundredth, and it surfaced the moment a review list drew a
  negative row beside the anchored review. The new value is 6.1:1 on canvas, 5.2:1 on its own tint.
- **Marketplace calls 0 · marketplace WRITE 0 · DB row changes 0 (the QA org's own reads only) ·
  migrations 0** ⇒ no evidence row.

### Test contracts deliberately rewritten (4)

Three freshness tests and one conversation test asserted that a stale channel's sentence appears in the
prose **exactly once** beside its step card. §3 makes the card the only place that fact is rendered, so
the assertions now state the new contract (`not.toContain`), with the card's own `asOf`/reason still
asserted.

## §6 Reported, not fixed

- **A review anchor still cannot be ordinal-selected from a list** (「두 번째 리뷰 자세히」 selects but
  does not draw the card; the ordinal lane for REVIEWS predates this package and belongs to the frozen
  conversation semantics).
- **`replyCapability` is `UNKNOWN` on the deterministic INSPECT lane** — it buys one read, and the
  channel capability is a second. The graph lane resolves it properly; the difference is visible as the
  card's reply control appearing only on the planner path.
- **The QA org's daily AI budget and the planner allowlist were raised in `backend/.env.local`** for the
  walkthrough and restored byte-for-byte afterwards (verified). No product default changed.
- **A product anchor is not named by a `PRODUCT_DETAIL` card** — products have no detail artifact, and
  inventing one was outside this package. The context bar names them from the list row.
