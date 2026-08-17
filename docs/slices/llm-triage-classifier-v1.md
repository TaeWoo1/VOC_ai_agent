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

- **The API key, and the exact OpenAI model id.** *Vendor decided 2026-08-17: **OpenAI**.* No
  `OPENAI_API_KEY` is present in this environment, and the model id has to be named rather than
  guessed. Every offline test runs without a key; the `DEV` run cannot start until both exist.

  ⚠ Recorded so it is not forgotten when the numbers arrive: the pilot's GPT arm was **consumer
  ChatGPT on 37 rows**, and §10.4 pre-committed that a pilot is a rule-out screen, never a rule-in.
  Choosing this vendor because of that arm is legitimate **candidate selection**; quoting its 0.750 /
  1.000 recall as an expectation for the API model is not, and this run measures the API model from
  scratch against the same bars as everything else.

  ⚠ **`temperature`.** The request pins `temperature: 0` for reproducibility, and some OpenAI models
  reject any temperature but their own default with a 400 — which this classifier would faithfully
  turn into `CLASSIFICATION_FAILED` on all 107 rows. That is visible rather than silent, but it is a
  wasted run, so `LLM_TRIAGE_OMIT_TEMPERATURE=true` drops the field. It is not retried around: a
  retry that changed the request would measure two candidates under one name. The flag is part of
  `classifierVersion` (`+t0` / `+tdefault`), so the change log can say which was run.
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

---

## 10. The §8.6 change log

Every model, prompt and version run against `DEV` goes in this table — **including the ones that
scored badly, and including a run abandoned halfway.** §8.6 requires it because a prompt tuned
against `DEV` until the number rises is threshold-fitting performed in prose, and the only defence
against that is a record a reader can count.

Read this table before believing any number in it: a candidate that needed six passes to clear the
bars is a different object from one that cleared them on the first.

| # | date | vendor · model | tuning | DEV recall | DEV precision (95% low) | 4–5★ FP | §6.3(4) demotions | failures | verdict |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 2026-08-17 | openai · gpt-5 | `+tdefault+out4000` | 0.886 | 1.000 (0.890) | 0.000 | *not measured* | 0/107 | incomplete — the harness did not yet measure §6.3(4) |
| 2 | 2026-08-17 | openai · gpt-5 | `+tdefault+out4000` | 0.857 | 0.968 (0.838) | 0.000 | **2** | 0/107 | **FAILS §6.3(4)** |

**Candidate A is dead.** Runs 1 and 2 are kept as its failure evidence and are not to be deleted or
re-run: they are what established that a floating alias, an unguarded model and a single-pass
reading are each insufficient. Candidate B is a different candidate on all three counts.

| candidate | identity |
|---|---|
| A (failed) | `openai:gpt-5` · `triage-prompt/v1` · no guard · 1 pass |
| B | `openai:gpt-5-2025-08-07` · `triage-prompt/v2` · `effort:low` · `out4000` · `additive-guard/v1` · 3 passes, worst-gated |

#### Candidate B — 3 passes, 2026-08-17

| pass | tp | fp | fn | recall | precision (95% low) | 4–5★ FP | guard demotions | model *would* have demoted | failures |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 29 | 0 | 6 | 0.829 | 1.000 (0.883) | 0.000 | 0 | 0 | 0 |
| 2 | 28 | 1 | 7 | 0.800 | 0.966 (0.828) | 0.000 | 0 | 0 | 0 |
| 3 | 30 | 0 | 5 | 0.857 | 1.000 (0.886) | 0.000 | 0 | 0 | 0 |
| **gate (worst)** | | | | **0.800** | **(0.828)** | **0.000** | **0** | **0** | **0** |

Bars: recall ≥ 0.30 **PASS** · precision Wilson LB ≥ 0.80 **PASS** · 4–5★ FP ≤ 0.05 **PASS**.

SENSITIVITY (the 1 drawn synthetic row excluded) moves nothing that matters: recall 0.824 / 0.794 /
0.853, precision LB 0.879 / 0.823 / 0.883, 4–5★ FP 0.000 throughout.

Runs 1 and 2 are the **same candidate on the same rows** — identical model, prompt, schema and
tuning, identical 107 reviews. They disagree. That is not noise to be averaged away, and both rows
stay: see §10.2.

Neither may be quoted alone as "gpt-5's DEV result".

**Baseline for comparison**, from `ReviewTriageEvalIT` on the same `DEV` half:

| candidate | recall | precision (95% low) | 4–5★ FP |
|---|---|---|---|
| `rules-v1` PRIMARY | 0.171 | 0.610 | 0.000 |
| `rules-v1` SENSITIVITY | 0.147 | 0.566 | 0.000 |

Bars, from `v1` §5, unchanged: recall ≥ 0.30, precision Wilson 95% lower bound ≥ 0.80,
4–5★ false-positive rate ≤ 0.05.

### 10.2 The candidate is not reproducible, and that is a finding about the candidate

Two runs, everything fixed, different answers:

```
              run 1     run 2
tp               31        30
fp                0         1
fn                4         5
recall        0.886     0.857
precision     1.000     0.968
```

**Cause: `temperature` is at the model's default**, because a reasoning model rejects a pinned one
(§7). The cost was written down before the run as "it costs reproducibility"; this is that cost,
arriving.

What it breaks is not one number but the shape of §8.6. A change log assumes one row is one
candidate is one result. Here a row is one *sample* from a candidate, and the spread between two
samples (0.857–0.886) is larger than the margin by which some future prompt edit would "improve"
anything. **A single run of this candidate cannot support a freeze**, and comparing two prompts by
one run each would be comparing sampling noise.

Three honest ways forward, none of them chosen here because the choice is the product owner's:

1. **Measure the variance.** Run the same candidate *n* times and report mean and spread instead of
   a point estimate. Costs *n* × 107 calls, and changes what a change-log row means — which is a
   contract amendment, not a harness tweak.
2. **Find a reproducible configuration.** A fixed `seed`, or a `reasoning_effort` that is stable in
   practice, verified by two identical runs agreeing exactly before any of it is believed.
3. **Accept a non-deterministic classifier as the product** and gate on the worst observed run
   rather than the best. Defensible, and it must then be said out loud that the shipped number is a
   floor rather than an estimate.

**What must not happen** is picking run 1 because it is the better one. Both are in the table above
for that reason.

### 10.3 How a run is recorded

One row per `LlmTriageEvalIT` invocation. If a run is repeated with no change at all — a retry after
a transport failure — it amends the existing row's failure count rather than adding one, because it
is the same candidate. Anything else is a new row.

The freeze, when it comes, names a single line of this table and nothing else moves afterwards. Then
and only then does `HOLDOUT` get read, once, by `ReviewTriageEvalIT`.


---

## 11. Independent review of candidate B — 2026-08-17

Scope as set by the product owner: contract, additive guard, prompt v2, fail-closed/privacy,
evaluation harness, candidate identity. **No tuning was performed.** The `DEV` precision margin was
not touched, and widening it is explicitly not this review's business — that uncertainty is what the
holdout is for.

### 11.1 Findings

**D1 — the additive guard was harness-only. Real defect. Fixed.**
`AdditiveTriageDecision` appeared in `main/` in exactly one place: as a *string* in
`ApiTriageClassifier`'s version. The invariant itself ran only at `LlmTriageEvalIT:155`.
`TriageFeedbackService.record` stored `result.tier()` — the raw model answer — while stamping
`+additive-guard/v1` onto the row. **A version string asserting a property the row does not have is
worse than one that says nothing.** Fixed by applying the guard on the write path, from a baseline
the service computes itself out of the rating and body so no caller can weaken it, plus a
`model_tier` column (`V42`) keeping the raw answer beside the guarded one.

**D2 — the gate read `PRIMARY` only. Real defect. Fixed.**
§11.1 requires both readings be reported, but `verdicts` was built from the primary row list alone.
A candidate that passed on `PRIMARY` while `SENSITIVITY` failed would have been passing on four rows
no customer wrote. It did not bite candidate B — but that is luck, not design.

**D3 — two boundaries held only by construction. Hardened.**
The holdout-unreachability and gate-is-the-only-door properties were true and verified by reading,
which lasts until the next edit. `ClassifierBoundaryTest` now asserts all three structurally.

**C1 — a genuine §8.5 / §8.9 contradiction, surfaced by fixing D1.** §8.5 said a failure may never
fall back to `FYI`; §8.9 says a failure lands on the baseline, and for a 4–5★ review the baseline
*is* `FYI`. Resolved in §8.5 by stating what the prohibition actually protects: the classifier may
not **invent** `FYI` as its own answer. The row falls back to what the product already shows, carries
`status = CLASSIFICATION_FAILED` and a null `model_tier`, and so is never mistakable for a judgment.
Candidate B had 0 failures in all three passes, so this moves no number it produced.

### 11.2 What passed review unchanged

- **§6.3(4) meaning vs implementation** — `final = baseline OR candidate`, exhaustive over the whole
  4×4 input space. The rubric says "may only ADD"; the code cannot do otherwise.
- **The §8.7 amendment is not self-serving.** `v1` §5's three bars are carried verbatim — 0.30, 0.80,
  0.05 appear unchanged in the gate. The amendment changed *how many readings* and *which one counts*,
  and worst-of-three is **strictly stricter** than the single reading it replaced. It also could not
  rescue candidate A, whose failure was §6.3(4) and is now structural.
- **Holdout sealing** — one `splitOf` call, admitting `DEV` only; no `SPEND_HOLDOUT`; now asserted.
- **Payload floor** — `Input` has two fields; the serialized request is asserted by allow-list, so any
  new string fails by construction; Coupang and Product Context are blocked at the boundary.
- **Fail-closed** — no path yields `FYI` except a model that said `FYI`, asserted exhaustively.
- **Candidate identity** — vendor, model **snapshot**, prompt, schema, temperature, budget, effort and
  guard all appear in `version()`; five distinct tunings give five distinct versions.
- **The 3 passes ran one frozen candidate** — a single gate instance, constructed before the loop.
- **The change log is not cherry-picked** — candidate A's better run is still in it.

### 11.3 One risk accepted rather than fixed

**Prompt v2's stage-1 item D enumerates four §3.1 reason codes as tier-forcing conditions**, while
§3.1 says that column "is a description of the code, **not** a rule". The prompt is instructing a
classifier rather than constraining a labeler, and D's direction only ever *raises* a tier — but the
tension is real and is recorded rather than smoothed over. Changing it would be a new prompt version,
a new candidate, and three fresh passes; doing that to tidy a wording question, with a passing gate in
hand, would be tuning by another name.

### 11.4 Do the fixes invalidate the measurement?

No, and the reasoning is what matters:

| fix | touches the request? | touches `version()`? | touches what the harness scored? |
|---|---|---|---|
| D1 write-path guard | no | no | no — the harness already applied the guard itself |
| D2 both-readings gate | no | no | no — it re-reads numbers the passes already printed |
| D3 boundary tests | no | no | no |
| C1 §8.5 clarification | no | no | no — 0 failures in all three passes |

So candidate B's three passes stand as measured, and no re-run is owed.

---

## 12. FREEZE — candidate B

**Frozen 2026-08-17.**

```
llm-triage/v1+openai:gpt-5-2025-08-07+triage-prompt/v2+schema/v1+tdefault+out4000+effort:low+additive-guard/v1
```

**Frozen tree:** `fb77dbcd` — the review-fix commit. Candidate B's three passes were run at
`bbb94dda`; the fixes above changed no part of the request, the version, or the scoring, so the
frozen artifact is the reviewed tree.

**The gate, recomputed across both readings** from the three passes' own printed output. Stated
plainly because it matters: the harness that produced those passes printed a `PRIMARY`-only gate line
(defect D2). The table below is derived by hand from the per-pass numbers that run printed, not
re-measured — re-running to make the harness print it would have produced three *different* samples
and thrown away the evidence this freeze rests on.

| bar | worst observed | limit | |
|---|---|---|---|
| recall | **0.794** (SENSITIVITY, pass 2) | ≥ 0.30 | PASS |
| precision Wilson 95% low | **0.823** (SENSITIVITY, pass 2) | ≥ 0.80 | PASS |
| 4–5★ false-positive rate | **0.000** (all six readings) | ≤ 0.05 | PASS |
| classification failures | **0** of 107, three times | — | |

### 12.1 Remaining known risks, stated before the holdout is opened

1. **The precision margin is 0.023.** The bar is 0.80; the worst reading is 0.823. Across three
   identical passes precision LB moved 0.060, so the run-to-run spread is more than twice the margin.
   `HOLDOUT` is 113 rows, drawn the same way but never seen. **It is entirely plausible this lands
   below 0.80 there, and that would be the reported result.** Deliberately not tuned against.
2. **Recall has room; precision does not.** 0.794 against a 0.30 bar is not where the risk is.
3. **The stable misses are `CANNOT_USE` ×2 in every pass**, plus `CRITIQUE_NO_REQUEST` and
   `NEUTRAL_DESCRIPTION`, concentrated at 3★. Four of the seven rubric-crossing `DEV` rows still go
   the annotator's way rather than the model's.
4. **The §11.2 media ceiling is unchanged.** Every gold label and every candidate answer was made from
   a body and a star rating, for reviews that may have carried photographs.
5. **The classifier is non-deterministic**, and the frozen number is a floor, not an estimate.
6. **The `suggestedNextAction` vocabulary is still an unratified product decision.** It gates nothing.
7. **No product surface reads any of this.** `ReviewTriageRules` still owns every tier a seller sees;
   `v1` §5's gate is cleared on `DEV` only, and `DEV` is not the reported number.


---

## 13. FINAL HOLDOUT — candidate B REJECTED

**Spent 2026-08-17, once, per §8.10.** Frozen candidate, unchanged from the freeze:

```
llm-triage/v1+openai:gpt-5-2025-08-07+triage-prompt/v2+schema/v1+tdefault+out4000+effort:low+additive-guard/v1
```

113 rows, 3 passes, both readings, 0 classification failures anywhere.

### 13.1 The gate — worst of 3 passes × both readings

| bar | worst observed | limit | |
|---|---|---|---|
| recall | 0.679 | ≥ 0.30 | PASS |
| **precision, Wilson 95% lower bound** | **0.667** | **≥ 0.80** | **FAIL** |
| 4–5★ false-positive rate | 0.020 | ≤ 0.05 | PASS |
| classification failures | 0 of 113, three times | — | |
| model raw demotions | 0 | — | |

### 13.2 Every reading, as measured

| pass | reading | tp | fp | fn | tn | precision | 95% low | recall | 4–5★ FP |
|---|---|---|---|---|---|---|---|---|---|
| 1 | PRIMARY | 22 | 3 | 7 | 81 | 0.880 | 0.700 | 0.759 | 0.020 |
| 1 | SENSITIVITY | 21 | 3 | 7 | 81 | 0.875 | 0.690 | 0.750 | 0.020 |
| 2 | PRIMARY | 20 | 3 | 9 | 81 | 0.870 | 0.679 | 0.690 | 0.020 |
| 2 | SENSITIVITY | 19 | 3 | 9 | 81 | 0.864 | 0.667 | 0.679 | 0.020 |
| 3 | PRIMARY | 22 | 3 | 7 | 81 | 0.880 | 0.700 | 0.759 | 0.020 |
| 3 | SENSITIVITY | 21 | 3 | 7 | 81 | 0.875 | 0.690 | 0.750 | 0.020 |

**Not one of the six cleared the precision bar.** This is not a marginal miss decided by the
worst-of rule: the *best* reading is 0.700 against 0.80.

### 13.3 What actually happened, and what did not

**The point estimate did not collapse — the interval did.** Precision on `HOLDOUT` is 0.864–0.880,
against 0.966–1.000 on `DEV`. Three false positives instead of zero or one. On 25 predicted
positives a Wilson 95% lower bound simply cannot reach 0.80 with 3 errors, and `v1` §5 gates on the
lower bound precisely so that a small sample cannot pass on luck. It worked as designed, in the
direction it was designed to work.

**The `DEV` reading was optimistic, and the size of the gap is the finding.** `DEV` worst was 0.823;
`HOLDOUT` worst is 0.667. The margin flagged at freeze as "0.023, with a spread twice that" turned
out to understate the risk — the gap was not sampling noise inside one half, it was a difference
between the halves.

**Nothing else failed.** Recall 0.679–0.759 clears 0.30 comfortably and is four times `rules-v1`'s
`DEV` figure. The 4–5★ false-positive rate is 0.020 against a 0.05 bar — 1 of 51 high-rated
`NO_ACTION` reviews — so the specific harm `v1` §5 named is not what killed this. Zero classification
failures in 339 calls. **Zero raw model demotions in all three passes**, so prompt/v2's precedence fix
held on unseen rows and the additive guard never had to fire.

**The misses are the same shape as on `DEV`**, which is the one encouraging sign: `CRITIQUE_NO_REQUEST`
×4 in every pass, then `CANNOT_USE` and `PRAISE_WITH_CONCESSION`, concentrated at 3★. The model's
failure mode is stable and describable rather than random.

### 13.4 What §8.10.1 now forbids

- The prompt, model, tuning and guard **may not be adjusted and re-measured against this holdout.**
- **This holdout is spent.** It is not read again — not for a later candidate, not as a sanity check.
- A candidate C's final verification requires a **new, untouched holdout**: a new domain string, a
  fresh split, and a re-labeled sample (§6.2).

Recorded exactly as measured, including the three passes whose `PRIMARY` readings reached 0.700 and
which a best-of rule would have reported. They are in §13.2 for the same reason candidate A's better
run is still in the change log.

### 13.5 What is true after this

`rules-v1` remains what every seller sees. It was never displaced: §2.1 kept the classifier's output
in a prediction store that no surface reads, precisely so that a rejection here would cost a
measurement and nothing else. That is what it cost.

The 220-row gold set, the `DEV` half, the labeling protocol, the guard, the fail-closed paths, the
payload floor and the feedback spine all stand. What does not stand is one candidate's claim to clear
`v1` §5, and the claim was tested the only way that means anything.

---

## 14. Candidate C

The unit that follows the rejection. **Product-owner decision, 2026-08-17:** keep the LLM direction,
build candidate C, and make the v2 corpus development evidence — recorded as RUBRIC v2 §12, §13,
§8.11 and §8.12, all committed before candidate C existed or was measured on anything.

### 14.1 What candidate B's errors actually were

**The evidence had to be re-collected, and that is the first finding.** `LlmTriageHoldoutIT` reported
"3 false positives" on every holdout pass and wrote down which rows they were nowhere, so those three
reviews cannot be examined and never will be. RUBRIC v2 §8.12 exists because of that. What follows is
a **fresh pass of the frozen candidate B over all 220 rows**, one pass, per-row records kept — a
re-observation of the same candidate's error modes on the same rows, **not** the spent run's rows.
The candidate is stochastic and this is stated rather than glossed.

```
llm-triage/v1+openai:gpt-5-2025-08-07+triage-prompt/v2+schema/v1+tdefault+out4000+effort:low+additive-guard/v1
220 rows · 1 pass · 0 classification failures · 0 raw model demotions
PRIMARY      tp=53 fp=2 fn=11 tn=152   precision 0.964 (95% low 0.877)  recall 0.828  4–5★ FP 0.010
SENSITIVITY  tp=51 fp=2 fn=11 tn=152   precision 0.962 (95% low 0.872)  recall 0.823  4–5★ FP 0.010
```

#### The additive guard costs no precision at all

Checked first, on committed labels, with no API call: **every `rules-v1` baseline positive in the 220
is also a gold `NEEDS_ATTENTION`.** Zero rows where the guard forces a tier the humans declined. The
hypothesis that candidate B failed on false positives it structurally could not avoid is dead, and
the guard is free on this corpus. Every false positive was the model's own promotion.

#### Eight of eleven false negatives are unreachable by any rubric-faithful prompt

| gold `reasonCode` on the missed row | count | reachable? |
|---|---|---|
| `CRITIQUE_NO_REQUEST` | 6 | **no** — gold's own code says not-actionable |
| `NEUTRAL_DESCRIPTION` | 1 | **no** — same |
| `PRAISE_ONLY` | 1 | **no** — same |
| `CANNOT_USE` | 2 | yes — a genuine miss |
| `PRAISE_WITH_CONCESSION` | 1 | yes — a genuine miss |

By rating: 3★ ×9, 5★ ×2.

The gold set contains **14 rows whose own `reasonCode` contradicts their tier in this direction**, 11
of them `CRITIQUE_NO_REQUEST → NEEDS_ATTENTION`. That pairing contradicts `v1` §2's *"product
criticism with no request → `NO_ACTION`"* directly. §3.1 has always said the actionable column is a
description and not a rule, and a pairing that crosses it is a finding about the rubric — this is
that finding, at scale, concentrated at 3★.

**Consequence: rubric-faithful recall on this corpus is capped near 50/64 ≈ 0.78–0.875**, and
candidate B measured 0.828. Its recall bar was 0.30. **Recall was never the thing to fix**, and a
prompt that reached these rows would have to promote criticism-without-a-request across the whole
3★ band — which is precisely where the remaining precision would go.

#### One of two false positives is prompt/v2's own item B

| | rating | model said | gold said | structural cause |
|---|---|---|---|---|
| FP 1 | 3★ | `NEEDS_ATTENTION` / `DEFECT_OR_DAMAGE` | `WATCH` / `CRITIQUE_NO_REQUEST` | the model read a defect claim where the human read a gripe. **No prompt structure fixes this** — it is a judgment about the text |
| FP 2 | 5★ | `NEEDS_ATTENTION` / `PRAISE_WITH_CONCESSION` | `FYI` / **`PRAISE_WITH_CONCESSION`** | prompt/v2 item B: *"satisfied but pointed at one concrete problem → NEEDS_ATTENTION, even at 5★"* |

FP 2 is one of exactly **two** rows in the gold set where a human paired `PRAISE_WITH_CONCESSION`
with a `NO_ACTION` tier — and both of those rows are in the former `HOLDOUT` half. The other 18
`PRAISE_WITH_CONCESSION` rows are `NEEDS_ATTENTION`. So item B is right 18 times out of 20 and its
two exceptions both sat in the half that decided candidate B's fate, where the §13.1 arithmetic gave
the bar a tolerance of exactly one.

That is not bad luck to be complained about. It is what a bar computed on 25 predicted positives
does, and §13 is the answer to it.

### 14.2 What candidate C changes, and what it does not

**`triage-prompt/v3`.** One structural change, stated as a rubric reading rather than a patch.

`v1` §2 puts *"예쁜데 배송이 너무 늦었어요"* on the `NEEDS_LOOK` side and *"생각보다 두꺼워요"* on the
`NO_ACTION` side. Neither has a request. One has praise and the concession is still actionable. **The
axis is what the complaint is about** — something that went wrong fulfilling this order, against an
opinion about what the product is — and prompt/v2 asked neither question. It asked "is there a
concrete problem?", which both rows answer yes to.

So v3's stage 1 asks *"이 주문에서 무언가 잘못되었는가"* and asks nothing else, and stage 2 exists only
to name a tier already decided. §8.11's requirement, met structurally: **no `reasonCode` list appears
as a tier-forcing condition**, which is what v2's stage 1 did in the same prompt that told the model
a reason code does not decide a tier.

The gripe also gets a legitimate destination. Under v2 a praise-plus-gripe review had to be
`NEEDS_ATTENTION` or `FYI`; under v3 it is `WATCH` — *"하나로는 할 일이 없지만 반복되면 문제가 될
종류"* — which is what §2's tier table has always meant by the word.

**Unchanged, deliberately:**

| | why |
|---|---|
| model snapshot `gpt-5-2025-08-07` | changing two things at once measures neither |
| `tdefault`, `out4000`, `effort:low` | same |
| `schema/v1` | same |
| `additive-guard/v1` | it costs nothing on this corpus and it is the false-negative floor |
| the low-star rule as stage 1 item 3 | so the model is not fighting the guard on every low-star row |
| `suggestedNextAction`'s vocabulary | still an unratified product decision; it gates nothing |

**What was deliberately not done:** nothing was written into the prompt because a particular row
would flip. No corpus review, phrase or fragment appears in it. The two illustrations are `v1` §2's
own invented rows, written before this corpus was drawn, which §8.11 permits by name. The 8
unreachable false negatives were **not** chased, because reaching them costs the bar that failed.

```
llm-triage/v1+openai:gpt-5-2025-08-07+triage-prompt/v3+schema/v1+tdefault+out4000+effort:low+additive-guard/v1
```
