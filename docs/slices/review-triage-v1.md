# Slice — Review Triage v1

> **Status:** IMPLEMENTED, offline + local product proof. **Consumes no gate, promotes no
> capability.** §4.1 and `docs/channel_capability_ledger.md` are untouched — this changes what an
> operator *sees* on the channel review record and in what *order*, not what a channel supports.

- **Workstream:** Review Operations (`docs/workstreams/review_operations_mvp.md`)
- **Loop stages:** UNDERSTAND / PRIORITIZE
- **Date:** 2026-08-16 · **Live contact:** none
- **Surface:** `/connect/channels/{accountId}/reviews` (상품평), the Coupang review record

---

## 1. Why

The channel review record is a flat list. `ChannelReviewService` says so in its own words — "It is a
record, not a work queue" — and that was the right call when the only alternative was a queue built
on a capability Coupang does not have. But a seller opening 22 상품평 still has to read all 22 to
find out which one matters, and the single ordering concession (낮은 평점순) only re-sorts; it never
says *why* a row is at the top, or what to do about it.

This slice keeps the record a record and adds the one thing missing: **SellerOps saying what to look
at first, and on what evidence.**

## 2. The constraint that shaped it, stated before the design

`contracts/review-eval/naver/v1/RUBRIC.md` §5 is a pre-committed go/no-go, written before any
detector existed precisely so it could not be tuned afterwards. A candidate detector may be **built**
regardless of the numbers; it may not be **surfaced to an operator** unless it clears all four:

| gate | bar |
|---|---|
| Precision | ≥ 0.80 on the Wilson 95% lower bound |
| Recall | ≥ 0.30 point estimate |
| False positives on 4–5★ `NO_ACTION` | ≤ 0.05 |
| Regression | `LOW_RATING_REVIEW` counts unchanged — a detector may only ADD |

`contracts/review-eval/naver/v1/labels.json` holds **zero** labels against an adequacy floor of 200,
so no candidate can clear anything today. `ReviewIssueQueueIsolationTest` enforces the same boundary
structurally for the issue-memory package, and product-scope §1.7's 2026-07-27 carve-out requires
issue-memory output always be worded as **검증되지 않은 이슈 후보·운영 신호**.

**This is not an obstacle to the slice; it is the slice's design.** The rule it produces:

> **Text may cite. Text may never promote.**

A tier is decided by facts that need no interpretation. Anything derived from the body appears as a
*citation about the text* — never as a verdict about the customer, and never as a reason a review
moved up the list.

### 2.1 Why there is no LLM in v1

Asked and answered before implementing, because it is cheaper to answer than to undo:

1. **The gate is implementation-blind.** RUBRIC §5 governs any detector put in front of an operator.
   An LLM classifier is exactly as unmeasured against an empty label seed as a keyword pass — it
   would inherit the gate, not escape it.
2. **외부 LLM 전송 금지 stands** (CLAUDE.md safety fences). Review bodies are seller VOC.
3. **Nothing on the screen needs one.** Every value rendered is derived from an already-stored
   field: `rating`, `body` presence, `received_at`, and `item_analyses.category`.

So v1 is deterministic end to end. The honest cost is recorded in §6.

## 3. What decides a tier

Three tiers, deliberately few, in the vocabulary the operator reads:

| tier | UI | rule |
|---|---|---|
| `NEEDS_ATTENTION` | 확인 필요 | `rating ≤ 2` **AND** the body is non-blank |
| `WATCH` | 지켜보기 | (`rating ≤ 2` AND blank body) **OR** `rating = 3` **OR** `rating IS NULL` |
| `FYI` | 참고 | `rating ≥ 4` |

**Two inputs only: the rating, and whether there is anything to read.** No third input exists, and
`ReviewTriageRulesTest` pins that no body *content* can change the outcome — only its blankness.

Three of these rows deserve their reasoning written down:

- **A 1★ with no text is `WATCH`, not `확인 필요`.** RUBRIC §2's tie-breakers put this case at
  `NO_ACTION`: "There is nothing to detect. Rating already handles it." It is not demoted to 참고
  either — the rating is real and counts — but a seller cannot act on a review with no content, and
  putting it at the top of the worklist would spend their attention on a row that has nothing to say.
  ⚠ **A strict subset, not a match.** RUBRIC's row reads "an empty **or emoji-only** body"; blankness
  is all this rule tests, so a 1★ of "😡😡" is 확인 필요 here. Detecting emoji-only content means
  reading the body's characters, which is the input this rule deliberately does not have — so the gap
  is stated rather than closed, and the row is over-surfaced rather than hidden.
- **A null rating is `WATCH`.** Unknown is not good news. Sorting it into 참고 would hide a review
  nobody has judged, which is the failure this product's fail-closed posture exists to prevent.
- **`rating = 3` is `WATCH`.** The existing queue's band is 1–3★ (`IngestedReviewVocItemSource`); this
  surface splits that band because 확인 필요 is a stronger claim than "in the attention window", and a
  3★ is where the two honestly differ.

### 3.1 Stated once, so the order and the counts cannot disagree

The tier rule exists in two representations — Java, for rendering, and JPQL, for sorting and counting
a page the service never fully loads. That duplication is a drift hazard, and it is handled the way
`ReviewRepository` already handles it for `REPORTED_SUBMISSION_PREDICATE`: **one shared JPQL fragment**
(`ReviewRepository.TRIAGE_TIER_RANK`) is used by the ordering, the filter and the summary count, so
those three can never diverge from each other. Java-versus-JPQL agreement is then pinned by
`ChannelReviewTriageIT`, which asserts the database's rank equals `ReviewTriageRules.rank(...)`
for every combination of rating (null, 1–5) and body (empty, whitespace, text) — 18 rows, exhaustive
over the input space the database can actually hold. A null *body* is not among them: `reviews.body`
is `not null`, so no row can exist to disagree about, and that case is covered where it is reachable,
in `ReviewTriageRulesTest`.

The same 18 combinations were also evaluated against the **local PostgreSQL** instance directly
(`select … case … from (values …)`), and it returns the same rank as both the Java rule and H2 — so
the offline suite's agreement is not an artifact of running H2 in PostgreSQL-compatibility mode. See
§4.3 for the one input class where the two engines genuinely differ.

## 4. What is cited, and how

**Tags come from `item_analyses.category`** — the schema-level vocabulary already documented in
`V5__item_analysis.sql` and owned by `ItemAnalysisCategories` (배송/교환/제품정보/설치/가격/품질/색상/
사이즈/기타). Reused rather than re-derived, for three reasons: it is already stored for these rows, it
is already what the attention drill-down facets on, and a second parallel text pass would create two
answers to one question.

Deliberately **not** reused from the same table:

- **`sentiment` / `urgency`** are pure functions of `rating`
  (`docs/slices/review-classification-queue-v1.md` §2 measured this). Rendering them would dress a
  rating up as an independent signal.
- **`recommendedAction`** is `f(rating, category)` and collapses in practice — on the 22 stored
  Coupang rows it reads `확인 필요` for the 1★ 설치 complaints *and* for the 5★ praise. A recommendation
  that says the same thing about praise and about damage is worse than none.

**기타 is never shown as a tag**, and neither is a missing analysis row. 기타 is a real stored verdict
("we looked and it fits nothing"); `UNCLASSIFIED` is the absence of a row ("we never looked"). Neither
is an issue, and this surface follows the classification-queue slice's precedent: a row with nothing
to say carries no chip.

**Repetition is a count, not a claim.** `같은 분류 N건` counts reviews sharing that category across the
whole stored channel record, with a floor of `REPEAT_MIN = 3` — one review is not a pattern and two
co-occur by chance, the same reasoning as `ReviewIssueThresholds.NEW_MIN_EVIDENCE`.

### 4.1 Why the repetition count carries no time window

The obvious phrasing is the one in the original request — `최근 7일 동일 불만 3건`. It was dropped, on
purpose:

`reviews.received_at` is date-granular and the stored Coupang record spans 2026-05-31…06-13, so on any
day after roughly mid-July every 7-day window over it is **empty**. A surface that then quietly widened
its window until it found something would be choosing a threshold to fit the answer — the exact failure
`ReviewIssueThresholds`' javadoc and RUBRIC §5 both exist to prevent. So the count says what it can
defend: how many of the reviews you have share this category. No window, no claim about recency.

**Recency is still honored, where it is honest**: as the within-tier ordering (newest first) and as the
existing 새 상품평 / `newCount` derivation, both of which are facts about arrival rather than judgements
about content.

### 4.2 Why `ReviewIssueThresholds` is not imported

`REPEAT_MIN` and the issue-memory's `NEW_MIN_EVIDENCE` share a rationale and today share a value. They
are still declared separately, because they are thresholds on **different mechanisms over different
inputs** — a category count on this surface, an aspect+problem signature in the issue memory. Importing
one into the other would mean a future revision of the DRAFT issue-memory thresholds silently
redefining what this list calls repeated.

### 4.3 The one input class where the two engines disagree

`ReviewRepository.TRIAGE_TIER_RANK` tests blankness with `trim(r.body) = ''`, the portable JPQL
expression; SQL `TRIM` strips `U+0020` only. `ReviewTriageRules.isTextless` uses `String.isBlank`, i.e.
`Character.isWhitespace`. **The divergent set is every whitespace code point except `U+0020`** — not
just tabs and newlines but `U+3000` IDEOGRAPHIC SPACE (which a Korean IME emits) and the whole
`U+2000–U+200A` block. A body made only of those ranks 확인 필요 in SQL and 별점만 in Java.

Two things about this are worth stating precisely, because the first draft got both wrong:

- **The direction is not uniformly safe.** On the counts and the default order it over-surfaces,
  which is harmless. Under `tier=WATCH` it does the opposite — the row is filtered out while its own
  chip reads 지켜보기, unreachable through the filter that matches what it says.
- **What makes it benign is that the input does not occur**, and that was checked rather than
  assumed: the Coupang collector normalises `\s| |　` and trims (`review-row-inpage.ts`) then
  maps the result to `""` (`review-rows.ts`); the upload path uses `String.strip()`
  (`ingest/parse/FileParser`), which strips `U+3000`; `Cafe24ReviewPromoter` rejects `isBlank` content.

Closing it properly would need a whitespace class SQL `TRIM` cannot express portably, so it is
documented rather than papered over.

## 5. The recommended action never implies a reply

Coupang gives sellers no way to answer a 상품평. `ChannelReviewService` and `ChannelReviews.tsx` both
already document the absence of a reply control as deliberate, and this slice must not reintroduce it
through the back door by recommending one. The map is fixed, small, and internal-facing:

| condition | 권장 |
|---|---|
| 확인 필요 + a repeated category | 같은 분류의 상품평이 반복됩니다. 상품·포장 상태를 확인해 보세요. |
| 확인 필요 | 내용을 읽고 상품 상태를 확인해 보세요. |
| 지켜보기, 별점만 | 별점만 남긴 상품평입니다. 같은 상품의 다른 상품평과 함께 보세요. |
| 지켜보기 | 같은 분류가 늘어나는지 지켜보세요. |
| 참고 | *(none — a row with no action says nothing)* |

`ReviewTriageNoteTest` sweeps every string the map can produce and pins that none contains 답변/답글/회신.

## 6. What v1 honestly does not do

- **The case the rubric exists for stays invisible.** A 5★ reading "배송이 너무 늦었어요" is `참고` here.
  Detecting it needs body polarity measured against labels, and the seed is empty. v1 does not
  approximate it, because an approximation that fires on happy customers is the single most trust-
  damaging error this surface can make (RUBRIC §5's 0.05 gate is about exactly that harm).
- **No triage state is recorded.** The tier is computed at read time from the review itself; there is
  no 처리함 control, so a 확인 필요 row stays 확인 필요. A half-integration with
  `attention.triage.ReviewTriage` — which records a *human's* decision from a different surface — would
  let a row's tier depend on which screen the operator happened to use.
- **Nothing is pushed.** product-scope §1.8's exception-push trigger set is untouched; this is a
  pull-first surface.

## 7. Naming: two things called triage

`com.sellerops.attention.triage.ReviewTriage` / `TriageDisposition` record **a human's conclusion**
about a review they drilled into from an attention signal, durably, with an audit trail.
`com.sellerops.review.triage.ReviewTriageTier` / `ReviewTriageRules` are **a computed suggestion**,
stateless, derived at read time. They are not layered and neither reads the other. The suffixes carry
the difference: a *disposition* is decided, a *tier* is calculated.

## 8. Verification

The boundary in §2 is guarded at **three** layers, because it can be broken at any of them and an
independent review confirmed that guarding only the first leaves the other two open:

| layer | guard | the mutation it catches |
|---|---|---|
| the rule | `ReviewTriageRulesTest.noAmountOfTextCanChangeATier` | a keyword branch inside `ReviewTriageRules` |
| the note | `ReviewTriageNoteTest.theNoteExplainsTheTierAndCannotChangeIt` | a promotion in `ReviewTriageNote.of` — swept over **every** rating, not just 4★ |
| the service | `ChannelReviewTriageIT.aBodyFullOfComplaintVocabularyStillTiersOnTheRatingAlone` | a promotion in `ChannelReviewService`, which holds the body-derived material and sits outside the triage package |

The rest:

- `ChannelReviewTriageIT` — the JPQL rank equals the Java rank for all 18 (rating × body) cases; the
  filter, the summary count and the row's own note agree with the page they describe; 낮은 평점순 puts
  an unrated review last on either database.
- `ReviewTriageNoteTest` — the reason, the tags, the action map, that no emitted string implies a
  reply, and that a category outside `ItemAnalysisCategories` is dropped rather than rendered.
- `ReviewTriageQueueIsolationTest` — RUBRIC §5's fourth gate (`LOW_RATING_REVIEW` unchanged) made
  structural: the triage package cannot reach the attention queue's mechanisms and persists nothing.
  There is no separate attention-signal regression test; the gate is held by construction plus this
  scan, and the existing `AttentionSignalRulesTest` is untouched.
- Frontend: tier chip / reason / action rendering, the filter, the summary, that the row ORDER is the
  server's and the chip is the server's tier, that a filtered list still reports the record's size,
  and that `[쿠팡에서 보기]` is unchanged.
- Local product proof on the 22 stored Coupang rows — see §9.

## 9. Local product proof, and what it does and does not show

Run against the 22 stored Coupang 상품평 on the local database.

⚠ **Those 22 rows are `MockDataSeeder` content, not acquired review text.** They are two distinct
bodies at 11 copies each, rated 1★ and 5★ with nothing between, all `reply_state = UNKNOWN`. No real
Coupang review body has ever been persisted here: the Coupang live proofs were REVIEW_LOCATE runs,
and #100 pinned that they left the database unchanged.

The proof therefore demonstrates **the mechanism**, on a corpus whose perfect bimodality flatters it.
It is not evidence that the tier rule sorts real seller VOC well, and nothing in this slice may be
cited as if it were. That evidence needs the labeling session RUBRIC §4 describes.
