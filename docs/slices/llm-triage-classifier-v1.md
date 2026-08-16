# LLM Triage Classifier v1

**Status: design, then build.** Supersedes the planned `rules-v2` promotion rule. Base `main@ee9622b6`.

Governing contract: `contracts/review-eval/naver/v2/RUBRIC.md`, in particular the **§8.3–§8.6**
amendment written before any line of this was implemented.

---

## 1. Why the rule is not being extended

`rules-v1` was measured on `DEV` against the 220-row human gold set:

```
                      PRIMARY   SENSITIVITY      bar
recall                  0.171         0.147     0.30
precision (95% low)     0.610         0.566     0.80
4–5★ false positives    0.000         0.000     0.05
```

It has never produced a false positive; it is close to blind. Of 35 human `확인 필요` rows on `DEV` it
caught 6. What it misses is not a tail:

```
PRAISE_WITH_CONCESSION  12        by rating:  3★ 18
CRITIQUE_NO_REQUEST      5                    5★  7
CANNOT_USE               4                    4★  4
DEFECT_OR_DAMAGE         3
…
```

`PRAISE_WITH_CONCESSION` is the largest bucket and is the class `v1` §2's first tie-breaker exists
for — a satisfied review that names one real problem. A rule whose entire input is the rating and
whether the body is empty cannot see it, and no amount of vocabulary added to such a rule can, because
the body's content is not an input. Extending it would mean building a keyword rule, which §6.3
already forbids being fitted to this corpus.

**What the pilot does and does not license.** GPT was the strongest of the three pilot arms. That was
37 rows, evaluated by hand in a consumer subscription, and §10.4 pre-committed that a pilot pass is a
rule-out screen and never a rule-in. So the pilot is why an LLM classifier is worth building; it is
**not** evidence about any API model's performance, and no number from it carries forward.

## 2. What the classifier is

**One versioned artifact, not a model call.** A `classifierVersion` names all four of these together,
and changing any one of them is a new version:

```
model id  +  system prompt  +  the rubric text handed to the model  +  the output schema
```

This matters because the alternative — "we use model X" — makes a result unreproducible the moment a
prompt is edited, and makes the §8.6 change log meaningless.

### 2.1 Where it sits, and what it must not do yet

The classifier produces a **stored prediction**. It does not decide what the product shows.

`v1` §5 is unambiguous: a text-derived detector may be built but may not be surfaced to an operator
until it clears precision (Wilson 95% lower bound) ≥ 0.80, recall ≥ 0.30, ≤ 0.05 false positives on
4–5★ `NO_ACTION` rows, and leaves `LOW_RATING_REVIEW` counts unchanged. Nothing has cleared that yet,
and `HOLDOUT` has not been read. So:

- `ReviewTriageRules` remains the tier the list sorts by, the counts count, and the seller sees;
- classifier output is written to the prediction store and read by the evaluation harness;
- **no product surface changes in this unit.**

The wiring that would surface it is a later, separately gated step. Building it now and leaving it
switched off would put the gate in a flag, where the gate's whole purpose is to not be one.

### 2.2 The port, so the vendor is a configuration

```java
interface ReviewTriageClassifier {
    Result classify(Input input);   // Input carries a rating and a body. Nothing else fits.
    String version();               // askable without classifying, same contract as InboxItemAnalyzer
}
```

`InboxItemAnalyzer` already establishes this shape in this codebase and says why: "a future AI
adapter can implement this same port behind a flag without touching the service or storage."

Vendor-neutral because **the vendor is an open product-owner decision** (§7). The port means that
decision changes one adapter and one config value, not the design.

## 3. The payload floor

§8.3 sets the floor at **rating + body**. §8.4 requires it be a mechanism. Three of them:

1. **`Input` is a closed record of `(Integer rating, String body)`.** There is nowhere to put a
   product, a date, or an id, so a caller cannot pass one by mistake or by conviction.
2. **The outgoing bytes are asserted, not the builder's intent.** A test serializes a real request
   and checks the whole payload — the same artifact-level check
   `build-annotator-package.mjs` uses, chosen for the same reason: a check on what the code meant to
   send passes forever after the code starts sending more.
3. **Channel is enforced at the boundary.** The classification entry point takes a review whose
   channel it verifies, and a non-`NAVER` review cannot reach the transport. Coupang's prohibition
   (`docs/coupang_review_policy_gate_v1.md`) is thereby structural rather than remembered.

## 4. The output schema

```
tier                NEEDS_ATTENTION | WATCH | FYI          (never UNCERTAIN — see below)
reasonCode          one of the thirteen, RUBRIC §3.1
tags                0–2 of ItemAnalysisCategories.ORDERED, RUBRIC §3.2
suggestedNextAction one of the seven below
classifierVersion   stamped by the adapter, never by the model
```

`classifierVersion` is stamped locally on purpose. A model asked to report its own version reports
what it was told to, which is not evidence of anything.

**`UNCERTAIN` is not offered to the model.** It exists in the labeling vocabulary because a human
who cannot decide should say so rather than guess (§2), and it is excluded from every metric. A model
given the option would use it to avoid being scored, and an abstention rate is not a triage product.
A model that cannot decide must still answer, and be wrong in a countable way.

### 4.1 `suggestedNextAction` — a closed vocabulary, and descriptive only

| value | 뜻 |
|---|---|
| `REPLY_TO_BUYER` | 답변 필요 |
| `INVESTIGATE_PRODUCT` | 실제 상품·출고 확인 |
| `CHECK_DELIVERY` | 배송 프로세스 확인 |
| `OFFER_REMEDY` | 교환·환불·재발송 검토 |
| `IMPROVE_LISTING` | 상세페이지·옵션 정보 보강 |
| `MONITOR_REPEAT` | 반복 여부 모니터링 |
| `NONE` | 지금 할 일 없음 |

Closed rather than free text because a model writing a sentence about a review writes **customer
content into a stored field**, and every privacy guarantee in this contract rests on there being
nowhere for prose to land.

**Provenance**, since §6.3 requires terms be traceable: `REPLY_TO_BUYER` and `IMPROVE_LISTING` are
`RuleBasedInboxItemAnalyzer`'s own "답변 필요" and "상세페이지 개선 후보"; `CHECK_DELIVERY`,
`INVESTIGATE_PRODUCT` and `OFFER_REMEDY` restate §3.1's `DELIVERY_PROBLEM`, `DEFECT_OR_DAMAGE` and
`EXPLICIT_REQUEST`; `MONITOR_REPEAT` is `WATCH`'s own definition in §2.

⚠ **This is a new product vocabulary and therefore a product-owner decision** (§7). It gates nothing
and is reported descriptively; the primary gate never reads it.

## 5. Failing closed

§8.5, restated as states rather than prose:

| state | when |
|---|---|
| `CLASSIFICATION_FAILED` | transport error, non-2xx, timeout, or the retry budget is spent |
| `UNCLASSIFIED` | the call has not been made, or the model returned something the schema rejects |

**No path returns `FYI`.** `FYI` means "nothing here for the seller"; an outage that produced it would
silently dismiss real reviews and look identical to a considered judgment. Both failure states are
visible, both are counted in the evaluation output, and a run with a non-trivial failure rate reports
that rate beside its metrics rather than quietly scoring the rows that happened to succeed.

Schema violations that fail closed rather than being repaired: an unknown tier, an unknown
`reasonCode`, more than two tags, an unknown tag, an unknown action, missing fields, or trailing prose
around the JSON. Repairing a malformed response is the point at which the harness starts measuring
the repair.

## 6. The feedback spine

Implemented in this unit, from the draft in
`docs/slices/production-triage-feedback-draft-v1.md`. Three records, kept apart because the value is
entirely in their separation.

### 6.1 `prediction` — immutable, and carries what produced it

```
reviewId · tier · reasonCode · tags · suggestedNextAction
classifierVersion · modelId · promptHash · predictedAt · status(OK|FAILED|UNCLASSIFIED)
```

`promptHash` rather than the prompt: the prompt text lives in the repository under a version, and a
hash proves which one ran without duplicating it into every row. Immutable, because "was the model
wrong, or did the model change" must stay answerable.

### 6.2 `correction` — the seller's answer, scoped to a prediction

Scoped to the **prediction**, not the review, so a correction always says which answer it corrected.
Closed vocabularies only, no free-text note — same reason as §4.1.

### 6.3 `disposition` — the separation the unit is for

`CLASSIFIER_ERROR` or `SELLER_PREFERENCE`, assigned by a **human**, never inferred.

The correction row is byte-identical in both cases: a 배송 지연 review one seller triages as urgent
and another treats as noise produces the same correction. Only a person holding the rubric can say
which happened. Inferring it would let one seller's preference become the global classifier's
definition of accuracy — which is precisely the failure this record exists to prevent.

- `CLASSIFIER_ERROR` → accumulates into a **frozen, versioned feedback snapshot**, used to evaluate
  the *next* classifier version offline;
- `SELLER_PREFERENCE` → recorded, scoped to that seller, and **kept out of the global gold set**.

**Nothing trains online.** A correction never changes a running classifier. §9's rule holds without
weakening: no model produces a gold label, and a human confirming a label a model showed them
measures agreement with the model — which does not become untrue because the human is a customer.

## 7. What is blocked on the product owner

- **The vendor and the API key.** No `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` is present in this
  environment. Everything above is vendor-neutral and every offline test runs without a key; the
  `DEV` run cannot start until one exists. Which vendor is a product decision, and the pilot's GPT
  result is not evidence about an API model.
- **The `suggestedNextAction` vocabulary** (§4.1), which is new product language.
- **A cost ceiling per classified review**, which is what decides between a frontier and a small
  model. It is not a technical question and this unit will not answer it by picking the model that
  scores best.

## 8. Out of scope, explicitly

Review acquisition, the locate path, and Product Context are untouched. Product Context remains a
separate axis that never feeds a tier, in the order fixed in
`docs/slices/product-context-diagnosis-groundwork.md`.

## 9. The stopping point

`DEV` evaluation → independent review → freeze exactly one candidate → **report and stop**. The
`HOLDOUT` is read once, after the freeze, and only on the product owner's word.
