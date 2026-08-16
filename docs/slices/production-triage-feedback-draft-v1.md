# Production triage feedback — design draft

**Status: draft, nothing built.** No schema, no endpoint, no UI, no model change. This exists so that
when a seller corrects a triage tier in the product, there is already an answer to "and then what
happens to that correction" — written before the first correction exists, which is the only time the
answer can be written without a result in view.

Scope boundary: this describes what happens to corrections **after** the calibration gold set is
fixed. It changes nothing in `contracts/review-eval/naver/v2/` and it is not authorization to start.

---

## 1. Why this is not "retrain on user feedback"

The long-term operating principle already recorded in `docs/slices/product-context-diagnosis-groundwork.md`
is that **human labeling is not a per-seller operating procedure.** The gold set is for evaluating
classifiers; production is automatic triage with a small human-QA tail. A feedback loop that fed
seller corrections straight into a model would quietly undo that: it would make every seller a
labeler, and it would make the classifier's behaviour a function of whichever sellers complained
most.

So the rule this draft is built on:

> **A correction is an input to a versioned evaluation set. It is never a training signal on
> arrival, and it never rewrites a gold label.**

The corollary matters as much: gold labels come from the fixed human protocol of RUBRIC §7. A
seller's correction is *evidence about the seller*, and only sometimes evidence about the classifier.
Separating those two is the whole design problem.

---

## 2. The three records, kept apart

Today the product shows a tier and a reason. Nothing records what was shown or what the seller did
with it. Three distinct things need to exist, and the value is in their being distinct:

### 2.1 `prediction` — what the system said, and on what

Written at classification time, never edited afterwards.

```
reviewIdFingerprint
classifierId          e.g. "rules-v1" / "rules-v2" / "llm-<name>@<version>"
rubricVersion         which contract the classifier was aiming at
tier, reasonCode, tags
confidence            nullable — a deterministic rule has none, and faking one is worse than null
predictedAt
```

Immutable by construction. A prediction that could be updated in place would make "was the model
wrong, or did the model change" unanswerable six months later — which is exactly the question this
record exists to answer.

### 2.2 `correction` — what the seller changed it to

```
reviewIdFingerprint
predictionId          the exact prediction being corrected, not just the review
correctedTier, correctedReasonCode, correctedTags
correctedAt
```

**No free-text field.** Same closed vocabularies as §3 of the rubric, same reason: a free-text note is
customer-adjacent prose in a table that will be read by an evaluation harness, and every guarantee in
§5 rests on there being nowhere for prose to land.

**One correction per prediction.** A seller who changes their mind produces a second prediction-scoped
correction only if the classifier ran again; otherwise the latest correction supersedes and the prior
one is kept, because a flip-flop is itself a signal that the rubric is ambiguous there.

### 2.3 `disposition` — the adjudicated reading of the correction

This is the record that does the work, and it is written by a human reviewing a batch, never inferred:

| disposition | meaning | goes to |
|---|---|---|
| `CLASSIFIER_ERROR` | the rubric says X, the classifier said Y, the seller said X | candidate evaluation set |
| `SELLER_PREFERENCE` | the rubric says X and the seller wants Y **for their catalog** | per-seller policy, never the classifier |
| `RUBRIC_GAP` | the rubric does not decide this case | contract amendment queue |
| `DATA_DEFECT` | the review row is wrong (truncated, fixture, wrong product) | corpus hygiene |
| `UNRESOLVED` | needs the fuller context to judge | stays open, counted |

**This is the separation the unit asked for**, and it is deliberately a human judgment rather than a
heuristic. The distinction between "the classifier is wrong" and "this seller wants something else"
cannot be read off the correction itself — a 배송 지연 review that one seller triages as urgent and
another treats as noise produces the identical correction row. Only a person holding the rubric can
say which of the two happened, and pretending otherwise would let seller preference leak into the
global classifier under the label of accuracy.

Recording `UNRESOLVED` as a real disposition matters: a taxonomy with no "I cannot tell" bucket gets
one anyway, spread across the other four.

---

## 3. Accumulation, not learning

Corrections dispositioned `CLASSIFIER_ERROR` accumulate into a **versioned candidate evaluation set**
— a numbered, frozen snapshot, quoted with its version wherever it is used.

What that set may be used for:

- **measuring** a candidate classifier, alongside (never instead of) the human gold set;
- **finding** where the current rule fails, as a source of hypotheses;
- **triggering** a drift audit when its error rate moves.

What it may not be used for:

- becoming gold. A correction is one seller's judgment on their own review, made while looking at the
  model's answer. RUBRIC §7.1 already rules out a label produced by a human who was shown a machine's
  answer, and that reasoning does not weaken because the human is a customer.
- fine-tuning or few-shot selection without an explicit, separately approved decision that names the
  snapshot version.
- silently growing. A snapshot is cut, frozen, and numbered; an evaluation set that changes under a
  metric makes the metric meaningless.

**Drift is confirmed on an audit sample, not on the correction stream.** A rising correction rate is a
reason to draw a small fresh sample and label it under §7; it is not itself a measurement, because
corrections are volunteered by whoever was annoyed enough to click.

---

## 4. What goes to human QA

Automatic triage on everything; a bounded queue for the cases where automation should not be trusted.
Four candidate routes, and the point of naming them separately is that they fail for different
reasons and should be counted separately:

| route | trigger | why not automatic |
|---|---|---|
| `LOW_CONFIDENCE` | the classifier's own confidence below a pre-committed threshold | the model says so |
| `NOVEL` | the review is unlike anything in the calibration corpus | out of distribution — the measured accuracy does not apply |
| `CONTRADICTION` | rating and text point opposite ways | the failure mode this whole unit started from |
| `MEDIA_REQUIRED` | the decision depends on attached photos or video | see §5 |

`LOW_CONFIDENCE` presupposes a classifier that produces a calibrated confidence. `rules-v1` does not
and cannot; a deterministic rule's "confidence" would be a constant. So this route is empty until a
scoring classifier ships, and it should be visibly empty rather than filled with a fabricated number.

The queue is **bounded**. An unbounded QA queue is a full relabel with extra steps, which is the thing
the operating principle forbids. When the bound is hit the overflow is dropped to automatic with a
recorded count, not silently held — a queue that grows without saying so is how "a small human QA
tail" becomes an operations team.

---

## 5. `NEEDS_MEDIA_REVIEW` — a candidate, and what it currently cannot be

`docs/slices/review-eval-corpus-lineage-v1.md` establishes that review media is not merely absent from
the product — it is **dropped at `ReviewRowMapper`**, where NAVER's `포토/영상` column is one of
fifteen unmapped columns, and `reviews.media_count` is `0` on all 3,927 stored rows across every
channel.

So the honest sequencing:

1. **Today, this tier cannot be produced at all.** Not "is not implemented" — there is no stored fact
   from which any rule could derive it. A `NEEDS_MEDIA_REVIEW` shipped now would be a guess dressed
   as a category.
2. **The first step is a count, not a model.** Aliasing `포토/영상` and letting the Coupang path's
   existing `media_count` fill would make "how many reviews carry media, and how do they distribute
   across tiers" answerable. That is a measurement, and it decides whether the tier is worth having.
3. **Only then a rule.** The two cases worth naming as candidates, once there is data:
   - **image-only** — a review with media and an empty or contentless body. Currently these land in
     `TEXTLESS_OR_NOISE` and, under RUBRIC §2.2, in `WATCH`; that reading is correct *given text
     only*, and would be wrong if the photographs show damage.
   - **ambiguous text + media** — a body that could go either way beside attachments that would
     settle it.
4. **Reading the media is a separate decision again.** Counting attachments is metadata. Looking at
   them is image processing on customer-submitted content, with its own privacy question, and nothing
   here presumes that answer. A `NEEDS_MEDIA_REVIEW` tier that routes a human to the marketplace to
   look at the photos themselves is a complete product behaviour and needs no image model at all.

**The ceiling this puts on the current unit is real and should be quoted with its numbers:** every
label in the gold set was made by a person reading text and a star rating for reviews that may have
had photographs attached. No text-only classifier can be measured past that, and neither can the
humans who set the gold.

---

## 6. What this draft does not decide

Repository-verifiable facts are settled above. These are not, and each is named as what it is:

- **Product-owner decision** — whether corrections are surfaced to the seller as "training the AI".
  Everything above says they are not, and the UI must not imply otherwise.
- **Product-owner decision** — who performs disposition, and at what cadence. §2.3 requires a human;
  it does not say which one.
- **Product-owner decision** — whether `SELLER_PREFERENCE` becomes a real per-seller policy layer or
  is only recorded and excluded. Recording it is required either way; acting on it is a product.
- **External research required** — whether Coupang and NAVER terms permit storing review media
  metadata, and separately the media itself. `docs/coupang_review_policy_gate_v1.md` is the precedent
  for how that question gets answered before anything is built.
- **Repository-verifiable, not yet checked** — whether `channel_products` can carry the product
  identity a `SELLER_PREFERENCE` policy would have to be scoped to. That is step 3 of the Product
  Context unit and must not be pre-empted here.
