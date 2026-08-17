# `review-eval/naver/v2` — calibrating Review Triage against human labels

`v1` asked one question ("does the seller need to do something?") and pre-committed the bars a
detector must clear before an operator may see it. **Every one of those bars is carried here
unchanged.** `v2` adds only what `v1` left undefined: which reviews get labeled, what else the
labeler records, and how a rule may be changed afterwards without the change being tuned to the
answer.

> **`v1` is not superseded and not relaxed.** `contracts/review-eval/naver/v1/RUBRIC.md` §1 (the
> question), §2 (the tie-breakers), §4 (adequacy) and §5 (go/no-go) apply verbatim. If this file ever
> appears to soften one of them, `v1` wins and this file is the bug.

Written **before** the sample was drawn and before any label existed. That ordering is the only
thing that makes the rest of it evidence.

---

## 1. What is being calibrated

`Review Triage v1` (`docs/slices/review-triage-v1.md`, merged as `ad1a88b5`) decides a tier from the
**rating and the presence of body text only**:

| rating | body | tier |
|---|---|---|
| 1–2★ | has text | `NEEDS_ATTENTION` |
| 1–2★ | none | `WATCH` |
| 3★ | either | `WATCH` |
| 4–5★ | either | `FYI` |
| none | either | `WATCH` |

Category tags and the repeat count are **cited** next to a review and can never move it between
tiers. That restraint was correct — it was the only defensible position while `labels.json` held
zero labels. This contract is how that changes: it measures what the rating-only rule gets wrong,
and defines what evidence would license text to promote.

## 2. The labeling question, and the one judgment the labeler makes

The `v1` question is unchanged:

> **Does the seller need to do something about this review?**

The labeler answers it by choosing the tier the review **should** have had. One judgment, read two
ways:

| tier | meaning | `v1` label it maps to |
|---|---|---|
| `NEEDS_ATTENTION` | A seller reading this should respond, investigate, or fix something. | `NEEDS_LOOK` |
| `WATCH` | Nothing to do about this one review, but it is the kind of thing that matters if it repeats. | `NO_ACTION` |
| `FYI` | Nothing for the seller here. | `NO_ACTION` |
| `UNCERTAIN` | Honestly unclear. **Use it.** | `UNCERTAIN` |

The mapping is stated so the `v1` gates score the same partition `v1` defined. `WATCH` is a product
distinction *inside* `NO_ACTION`; it may never smuggle a review across the `NEEDS_LOOK` line. A
`WATCH`/`FYI` confusion is a product-quality finding, **not** a go/no-go finding.

`UNCERTAIN` is excluded from every metric and reported separately, exactly as in `v1` §4.

### 2.1 The tie-breakers are `v1`'s

`v1` §2 decides the cases that move the metric — praise with a concession is `NEEDS_LOOK`, a courier
complaint is `NEEDS_LOOK`, a low rating with no text is `NO_ACTION`, product criticism with no
request is `NO_ACTION`, any actionable topic in a mixed review makes the whole review actionable.
They are reproduced in the labeling surface so a labeler never has to remember them, and they are
not restated here — one copy, in `v1`, is the copy.

### 2.2 A case `v1` §2 does not cover — 3★ with no actionable body

**Product-owner adjudication, 2026-08-16.**

> A 3★ review whose body carries **no actionable content** is `WATCH`, not `NEEDS_ATTENTION`.

`NEEDS_ATTENTION` requires something the seller can check or act on **now**. Three stars is a signal
worth keeping — so it does not fall to `FYI` either — but with nothing in the body to act on there is
no basis for the stronger claim.

This is not a relaxation of `v1` §2. That row covers a **low rating with an empty or emoji-only
body**; this is a middling rating with a short body that says nothing actionable, which §2 is simply
silent on. Two people read the silence differently, which is how it surfaced.

⚠ **It surfaced while reading the §10 pilot**, on the two rows that were the only ones a model arm
missed. A rule clarified after seeing which rows a candidate got wrong is precisely what this
contract exists to prevent, so what keeps it honest is stated rather than assumed:

- the owner's **raw labels are untouched**, and `agreement.json` is computed from raw answers;
- the pilot's **PRIMARY and SENSITIVITY readings stand as published** and are not restated;
- the clarification **lowers a tier**, so it can only shrink the positive class every candidate is
  scored against — it cannot flatter one;
- for the 220-row gold set it is a **genuine pre-commitment**: the annotator had labeled nothing.

Applied at gold assembly through `rubric-adjudication.json`, which names the affected reviews and
carries this reasoning with them.

**What the annotator pass then showed (2026-08-17).** All **six** disagreements between the two
labelers, out of 30 overlap rows, are this exact case: 3★, no actionable body, owner
`NEEDS_ATTENTION`, annotator `WATCH`. Nothing else disagreed. The cause is visible in the artifacts —
`owner.html` (built 20:43) contains no 3점 line; `annotator.html` (built 22:14) contains it. The owner
labeled under the rubric before this section existed and the annotator labeled under the rubric
after, so **part of what κ measured is a contract amendment, not two people disagreeing.**

The product owner adjudicated all six to `WATCH` on this section, not row by row. Three things do not
move as a result, and the mechanism enforces each:

- **the raw labels**, on either side;
- **binary κ = 0.614 ± 0.276**, computed from raw answers before any adjudication ran, and
  `agreement.json`, which stores the raw pair on every row including the six;
- **the pilot's published readings.**

A descriptive figure, recorded here so nobody has to recompute it and be tempted to promote it: had
both labelers read the same version of this section, they would have agreed on **30 of 30**. It is
not the gate number, it does not replace 0.614, and it must never be quoted in its place — the gate
was met at 0.614 on raw answers.

### 2.3 What is being detected, fixed explicitly

**Product-owner decision, 2026-08-17.** `v1` §1's question, sharpened and named:

> **이 리뷰로 인해 판매자가 확인하거나 조치할 일이 있는가?**
>
> This is **seller actionability detection.** It is not sentiment analysis, not satisfaction scoring,
> and not complaint detection.

The distinction is not academic — it is the axis on which candidate B lost precision. Stated as the
two directions it forbids:

| | |
|---|---|
| A **negative** review with nothing to check or act on | is **not** `NEEDS_ATTENTION`. Disappointment is not an action item. |
| A **positive** review that reports something going wrong | **is** `NEEDS_ATTENTION`. 5★ does not neutralise a delivery failure. |

Both are already `v1` §2 rows — "생각보다 두꺼워요" and "예쁜데 배송이 너무 늦었어요". This section names
the property those two rows share so it stops having to be re-derived from examples: **the signal is
whether there is something for the seller to do, and the emotional register of the text is not
evidence either way.**

**What this section may and may not be used for.**

- It **constrains prompts and rules** — §8.11 is its mechanism, and a prompt that asks "is the
  customer unhappy?" or "is there a concrete problem?" is asking a question this contract does not
  turn on.
- It **does not touch a single label.** Fourteen gold rows pair a not-actionable `reasonCode` with
  `NEEDS_ATTENTION` (§3.1's crossing column, quantified in the slice's §14.1). This section is
  **not** licence to discount them, re-adjudicate them, or exclude them from a metric. They stay in,
  they stay positive, and every candidate is scored against them. A rule fixed after a rejection that
  conveniently removed the rows a candidate got wrong would be the exact move §6.2 exists to prevent.

**Why fixing it now is not a favourable amendment.** It changes no tier, no label, no bar and no
sample. It can only narrow what a prompt may ask, never widen what counts as a hit, and it makes the
positive class no easier to reach. The one thing it could have been abused for — discounting the
crossing rows — is forbidden in the paragraph above rather than left to good intentions.

## 3. What else the labeler records

Two fields beyond the tier, both **closed vocabularies**. Neither may influence the tier; both exist
so a failure can be named rather than counted.

### 3.1 `reasonCode` — why this tier, in thirteen words the file can hold

| code | meaning | side |
|---|---|---|
| `DEFECT_OR_DAMAGE` | 하자·파손·고장 | actionable |
| `WRONG_OR_MISSING` | 오배송·누락·수량 부족 | actionable |
| `DELIVERY_PROBLEM` | 배송 지연·배송 사고·기사 응대 | actionable |
| `PACKAGING_PROBLEM` | 포장 상태 | actionable |
| `NOT_AS_DESCRIBED` | 설명·사진과 다름 | actionable |
| `CANNOT_USE` | 설치·사용이 되지 않음 | actionable |
| `EXPLICIT_REQUEST` | 교환·환불·재발송·답변을 요구 | actionable |
| `PRAISE_WITH_CONCESSION` | 만족하지만 하나를 문제로 짚음 | actionable |
| `PRAISE_ONLY` | 칭찬뿐 | not actionable |
| `CRITIQUE_NO_REQUEST` | 아쉬움을 말하지만 요구는 없음 | not actionable |
| `NEUTRAL_DESCRIPTION` | 사실 서술 | not actionable |
| `TEXTLESS_OR_NOISE` | 본문이 없거나 의미가 없음 | not actionable |
| `OFF_TOPIC` | 상품과 무관 | not actionable |

Drawn from `v1` §2's own tie-breaker cases and the stored category vocabulary — **not** from a scan
of this corpus. `PRAISE_WITH_CONCESSION` is listed first among the ambiguous ones because `v1` §2's
first row makes it the class the whole effort exists for.

The "actionable / not actionable" column is a description of the code, **not** a rule. A labeler may
pair any code with any tier; a pairing that crosses the column is a finding about the rubric and is
reported, never auto-corrected.

### 3.2 `tags` — the issue vocabulary the product already stores

Zero to two values from `ItemAnalysisCategories.ORDERED`
(배송 / 교환 / 제품정보 / 설치 / 가격 / 품질 / 색상 / 사이즈 / 기타), primary first. The same
vocabulary the product surfaces today, so a measured tag is comparable to a shown tag.

### 3.3 Why there is no free-text 근거

A one-line rationale written while reading a real customer's review paraphrases that review. It
would be the one field in this contract that carries customer content into a committed file, and it
would do it in the form hardest to review — prose, in a JSON array, in a repository.

The closed vocabularies above carry what a rationale was wanted for: **which** failure, and **which**
topic. The labeling surface may keep a private note locally for the labeler's own use; the step that
derives `labels.json` drops it, and a test asserts the committed file contains no field outside the
schema in §5.

### 3.4 Why "rating과 text가 충돌" is derived, not asked

The interesting contradiction is *"the text says something the star does not"*, and the exact
measurement of it is **the tier the human chose ≠ the tier `ReviewTriageRules` computes**. That is
the off-diagonal of the confusion matrix — it needs no extra field.

Asking the labeler instead would mean showing them what the rule concluded, which contaminates the
label with the answer. The labeling surface is **blind to the rule's output** for exactly this
reason. What a labeler *can* assert without seeing the rule is that the review praises and concedes
at once, and that is `PRAISE_WITH_CONCESSION` in §3.1.

## 4. The sample

### 4.1 Frame

Reviews acquired from a real NAVER SmartStore export and stored locally:
`channel = NAVER`, `external_id is not null` (an export row carries its `리뷰글번호`; the 22 rows
`MockDataSeeder` writes do not, which is how seeded content is excluded), one org. **3,858 rows.**

⚠ **This is NAVER, not Coupang.** The 22 stored Coupang rows are `MockDataSeeder` output with three
distinct bodies at 1★, and calibrating on them would measure the seeder. The rubric being extended
is `review-eval/**naver**/v1` and the corpus is the one it was written for. What this unit measures
therefore transfers to Coupang only as far as Korean marketplace review prose transfers — the tier
rule is channel-independent, the *numbers* are NAVER's. Any Coupang claim must say so.

### 4.2 Strata

Crossed on **rating band × body length**, both of which are properties a candidate rule's *text*
signal does not read. Deliberately: stratifying on a text feature would over-sample exactly the
reviews a keyword rule can find and hand it free recall.

| stratum | rating | `length(body)` | in frame | drawn | π |
|---|---|---|---|---|---|
| `LOW_S` | 1–2★ | < 20 | 7 | 7 | 1.000 |
| `LOW_M` | 1–2★ | 20–39 | 4 | 4 | 1.000 |
| `LOW_L` | 1–2★ | ≥ 40 | 3 | 3 | 1.000 |
| `MID_S` | 3★ | < 20 | 49 | 49 | 1.000 |
| `MID_M` | 3★ | 20–39 | 30 | 30 | 1.000 |
| `MID_L` | 3★ | ≥ 40 | 12 | 12 | 1.000 |
| `HIGH_S` | 4–5★ | < 20 | 2,440 | 30 | 0.0123 |
| `HIGH_M` | 4–5★ | 20–39 | 969 | 40 | 0.0413 |
| `HIGH_L` | 4–5★ | ≥ 40 | 344 | 45 | 0.1308 |
| | | | **3,858** | **220** | |

Every 1–3★ review in the frame is taken — there are only 105 of them, and any sampling there would
throw away the scarce class. 220 is drawn rather than 200 so the seed still clears `v1` §4's floor
of 200 **after** `UNCERTAIN` rows are excluded.

The high-rating band is weighted toward longer bodies because a concession needs room to be written.
That is a design choice with a cost — it is *not* a claim that short 5★ reviews are never actionable —
and §4.4 is how the cost is paid back.

### 4.3 The draw is reproducible without storing which rows were drawn

Within a stratum, order by

```
SHA-256("review-eval-sample/v2" + LF + reviewIdFingerprint)
```

ascending, take the first *k*. The order is a pure function of the review id, so the sample can be
re-derived from the database at any time and **no list of drawn rows has to be committed**. Nothing
about which reviews a seller received leaves the machine.

The dev/holdout split (§6) is assigned the same way, from a different domain string, so it is fixed
before a single label exists and cannot be re-drawn after seeing a result.

### 4.4 Two readings of every number

- **Gate reading — unweighted over the labeled set.** This is what `v1` §5 specified and what
  decides go/no-go. It is a statement about the sample.
- **Population reading — Horvitz–Thompson reweighted**, each labeled row counted `1/π` times, so
  `HIGH_S` stands for the 63% of the corpus it was drawn from. Reported **separately and always with
  its weights**, because one flipped `HIGH_S` label moves it by 81 reviews.

The population reading is descriptive. It answers "how many of the 3,858 would this rule flag" —
useful, and far too high-variance to gate on.

## 5. What may be committed

`labels.json` carries, per review, **only**:

```json
{ "reviewIdFingerprint": "<64 hex>", "tier": "NEEDS_ATTENTION",
  "reasonCode": "PRAISE_WITH_CONCESSION", "tags": ["배송"], "source": "ADJUDICATED" }
```

`source` is `OWNER`, `ANNOTATOR` or `ADJUDICATED` (§7). It says which human decided, never anything
about the review, and it is what makes "the numbers rest on a second labeler for 190 of these rows"
readable from the file rather than only from a document.

The overlap rows of §7.3 also produce `agreement.json` beside it, carrying — for those rows only —
both labels and whether they matched. Same closed vocabularies, same absence of everything else.

**Not** the body, the raw `리뷰글번호`, the rating, the date, the length, the stratum, the product,
or any seller identity. The stratum in particular is absent even though every metric needs it: it
encodes a rating band and a length band per review, which is precisely the re-identifying attribute
`v1` §3 refused when it left the rating out. The harness re-derives rating, length and stratum from
the local database at evaluation time, exactly as `v1` re-derives the rating.

`reasonCode` and `tags` are admitted alongside the tier because they are the same *kind* of thing —
an operator's judgment from a closed vocabulary of 13 and 9 values — and not customer content. That
is the whole permitted extension. **No free text, ever.**

`v1` §3's warning carries: the fingerprint is leak-hygiene, not anonymity. A `리뷰글번호` is an
enumerable 10-digit space, so anyone already holding it can map a fingerprint back. That is
acceptable for an operator judgment and is exactly why nothing else may sit beside it.

## 6. How the rule may change afterwards

### 6.1 The split

Every labeled review is `DEV` or `HOLDOUT` by

```
SHA-256("review-eval-split/v2" + LF + reviewIdFingerprint)
```

— first byte even → `DEV`, odd → `HOLDOUT`. Roughly half each, fixed before labeling, derivable by
anyone, stored nowhere.

### 6.2 What each half is for

- **`DEV` may be looked at as often as needed.** Failure modes are read here, candidate rules are
  built here, and the false-negative taxonomy is reported from here.
- **`HOLDOUT` is read once**, against the final candidate, and **its number is the reported number**.
  If the holdout result is worse than the dev result, that is the finding and it ships as the
  finding. Re-tuning after a holdout read and then re-reading is how a threshold stops being a
  threshold; if it ever has to happen, the contract requires a new domain string, a fresh split, and
  a re-labeled sample — not a second look.

### 6.3 What licenses text to promote a tier

A text signal may move a review from `FYI`/`WATCH` to `NEEDS_ATTENTION` only if, **on `DEV`**, it:

1. clears `v1` §5's precision bar (Wilson 95% lower bound ≥ 0.80) on the reviews it promotes,
2. recovers at least 0.30 of the labeled `NEEDS_ATTENTION` reviews the rating-only rule misses,
3. adds no more than 0.05 false positives on 4–5★ reviews labeled `FYI`, and
4. **only adds** — no review the rating-only rule already calls `NEEDS_ATTENTION` may be demoted by
   it. `v1` §5's regression gate, restated for tiers.

and then repeats 1–3 on `HOLDOUT` at a single reading.

**Where the signal may come from.** From the labeled `DEV` rows and from vocabulary the repository
already owns. A term added because a specific unlabeled review would have been caught by it is
threshold-fitting with extra steps and is out of bounds. Every term in a shipped v2 rule must be
traceable to either an existing committed vocabulary or a `DEV` label, and the trace is written down.

**If nothing clears the bars, nothing ships.** A measured "the rating-only rule is what we have, and
here is exactly how much it misses" is a result. `v1` §6 already says the baseline is the thing every
candidate must beat; a candidate that does not beat it does not become the product because effort
was spent on it.

## 7. Who labels

> **Amended before any label existed.** The first version of this file assumed one person would label
> all 220. The product owner judged that cost too high, and this section replaces the protocol. The
> test for whether such an amendment is legitimate is narrow: **could it have been informed by a
> result?** `labels.json` was empty, no metric had been computed, and §4's sample, §6's split and
> `v1` §5's gates are untouched — so it could not. Every one of those becomes unamendable the moment
> the first label lands.

### 7.1 Three roles, and what each may see

| role | labels | may see |
|---|---|---|
| **owner** (product owner) | 24 calibration rows from **outside** the sample, then the 30 overlap rows of §7.3, then the disagreements | review text and star rating |
| **annotator** (one person) | all 220 | review text, star rating, and the owner's 24 worked examples |
| **the rule's author** | nothing — **does not label** | `DEV` labels and `DEV` review text only, never `HOLDOUT` (§7.6) |

**No model produces a gold label.** Not for a row, not for a tie-break, not as a "first pass a human
then corrects" — a label a person confirmed after being shown a machine's answer measures the
person's agreement with the machine, which is not the quantity any gate here is written against.

### 7.2 The calibration rows come from outside the sample

The owner's first 24 rows are drawn from the **3,638 frame reviews the sample did not take**, by the
same deterministic order: 10 from `HIGH_L`, 8 from `HIGH_M`, 6 from `HIGH_S`.

They exist to do two things at once: let the owner settle a consistent reading of `v1` §2 before any
scored row is touched, and become the worked-example sheet the annotator is given. Both uses are why
they must sit outside the 220 — worked examples shown to the annotator are, by construction, labels
the annotator has been told the right answer for, and if they were evaluation rows they would be
scored as independent agreement.

⚠ **They are all 4–5★, and cannot be otherwise.** Every 1–3★ review in the frame is inside the
sample (§4.2 censuses those strata), so there is no low-rated row left outside it to teach on. The
gap is covered the only honest way available: the low-rating tie-breakers are taught by `v1` §2's own
worked cases, which are printed on every labeling page, rather than by a real row pulled out of the
evaluation set to serve as an example.

### 7.3 The overlap is enriched, and that is stated rather than hidden

30 of the 220 are labeled independently by both people, neither seeing the other's answer. Drawn
deterministically, and **not** in the sample's own proportions:

| band | overlap rows |
|---|---|
| 1–2★ (all strata) | 6 |
| 3★ (all strata) | 10 |
| 4–5★ long | 8 |
| 4–5★ medium | 4 |
| 4–5★ short | 2 |

A uniform overlap would be ~26 rows of 5★ praise, and would measure agreement on the easy class while
saying nothing about the scarce one the gates are about. The cost is that the resulting agreement is
**not the corpus-wide agreement** — it is agreement on a positive-enriched subset — and every report
of it has to say so.

### 7.4 The agreement bar, fixed now

Computed on the 30 overlap rows, `UNCERTAIN` on either side excluded and counted separately:

- **Decisive: Cohen's κ ≥ 0.60 on the binary `NEEDS_ATTENTION` / not partition.** That is the
  partition `v1` §5 gates on, so it is the one that has to hold.
- **Descriptive: three-class κ and raw agreement**, reported alongside, never in place of it.

**If κ falls below 0.60**, the annotator's 190 unverified rows are **not adequate as gold**. The
pre-committed fallback, stated now so it is not invented afterwards: report the metrics on the
owner-labeled rows only, say plainly that they are far below `v1` §4's floor and therefore
descriptive, and treat closing the gap as its own piece of work. A low κ is a finding about the
rubric's clarity, not a reason to relabel until the number improves.

With 30 rows κ is itself imprecise; its confidence interval is reported and is wide. That is a known
limit of an overlap this size, and it is the reason the bar is the binary one rather than a
three-class number that would move on a single `WATCH`/`FYI` slip.

### 7.5 How gold is assembled

1. The 190 rows only the annotator labeled → the annotator's label, `source = ANNOTATOR`.
2. The 30 overlap rows where both agreed → that label, `source = OWNER`.
3. The overlap rows where they differed → the **owner adjudicates**, having seen both answers, and
   may land on either or on a third. `source = ADJUDICATED`.

Adjudication is deliberately the only step where one human sees another's answer, and it happens
**after** the agreement number is computed. Computing κ from adjudicated labels would score the
overlap against a label the owner wrote while looking at it.

### 7.6 The rule's author stays blind to `HOLDOUT`

§6.2 says the holdout is read once. With labeling split across people, that discipline needs a
mechanism rather than an intention, because the person designing the rule is the person running the
harness. So: the harness prints `DEV` only. `HOLDOUT` and the combined reading are withheld unless
the run is explicitly told to spend the holdout, and a run that spends it says so loudly.

The labeling surfaces are blind in the other direction, everywhere and not only on `HOLDOUT`: no
page a labeler sees carries `ReviewTriageRules`' answer, a predicted tier, or any other model output.

### 7.7 What the annotator receives, and what they do not

A single self-contained page: **body text, star rating, an opaque row number, the rubric, and the
worked examples.** No product, no date, no review id, no fingerprint, no seller identity, no channel.
The row number is meaningless off this machine — the map from it back to a review is generated
locally and never leaves.

Packaging **fails closed** on a body that looks like it carries direct personal data (an email
address, a phone number, a resident-registration-shaped string): such a row is refused rather than
sent, and the refusal is counted in the run's output.

The residual is real and is named: **a second person reads real customer review prose.** That is
inherent to human labeling by anyone other than the seller, it is the product owner's decision, and
the mitigations above bound what travels with the text rather than pretending nothing does.

## 8. An LLM is compared only against these same numbers

Optional, and only on a labeled set against the deterministic rule. Scored by §6.3's bars, and "an
LLM would probably do better" is not a result — the only admissible claim is a measured one.

### 8.1 The external-LLM fence, and the one hole cut in it

The fence's default is unchanged and remains the rule everywhere else: **no review text leaves the
machine.**

**Product-owner decision, 2026-08-16**, narrowly scoped to the §10 pilot. It is written out in full
because a permission this shape is only safe if its edges are exact.

**Permitted**

- the **37 pilot rows of §10.1 only** — NAVER corpus, nothing else;
- **manual, blind evaluation in a Claude or ChatGPT consumer subscription** — a person pastes,
  a person reads back;
- payload limited to **body text, star rating, and an opaque evaluation key** minted for this pilot;
- purpose limited to **candidate screening**.

**Forbidden**

- the review id or its fingerprint; the author; the seller, channel, product, or date; any other
  identifying metadata;
- **any Coupang review**, under any circumstances — `docs/coupang_review_policy_gate_v1.md`'s
  D-limits are untouched by this;
- showing a model the human gold labels, the heuristic's prediction, or any other candidate's answer;
- reading this as permission for **production** external-LLM transmission, for an API integration, or
  for a second corpus. It authorises one screening exercise and expires with it.

**Privacy settings, required before a paste**

- ChatGPT: **Temporary Chat**, model-improvement training **off**;
- Claude: **Incognito**, model-improvement training **off**.

⚠ **This is still cloud transmission.** Those settings reduce retention and training use; they do not
make the paste local, and they are a vendor's setting rather than a guarantee this repository can
verify. Real customer prose reaches a third party. That is the decision, stated plainly rather than
softened by the mitigations around it.

### 8.2 What a model result may be used for

Exactly what §10.4 says and nothing more: a **rule-out screen**. A model that fails there sends the
work back to the full human-gold protocol; a model that passes licenses verification sampling, not a
model-authored gold set. §9's rule holds unchanged — **no model produces a gold label**, and a human
confirming a label a model showed them measures agreement with the model.

### 8.3 Production API transmission — NAVER review triage only

**Product-owner decision, 2026-08-17.** §8.1 expired with the pilot and explicitly refused to be read
as production permission. This is that permission, granted separately, and it is a **widening of the
fence**: review text now leaves the machine as ordinary product behaviour, not as one screening
exercise a person performed by hand.

It is written before any client code exists, so that what the code is allowed to send was decided
before anyone knew what would be convenient to send.

**Permitted**

- **NAVER review triage, and nothing else.** One purpose, one channel;
- transmission to a **production LLM API**, automatically, as part of classifying a review;
- payload limited to the **minimum**: the **star rating and the review body**. Not "those plus
  whatever else is handy" — those two, and the §8.4 mechanism is what makes that testable rather
  than aspirational.

**Forbidden**

- the review id, its fingerprint, the author, the seller, the shop, the channel, the product, the
  date, and any other identifying metadata — **whether or not a model would classify better with
  it**;
- the human gold label, any stored prediction, and any other arm's answer, in any form, including as
  an example inside a prompt;
- **any Coupang review.** `docs/coupang_review_policy_gate_v1.md`'s D-limits are untouched and this
  section does not reach them. A classifier that would happily accept a Coupang row must be prevented
  from receiving one by construction, not by a caller remembering;
- **Product Context** — product title, option, attribute or description. Out of scope here, and
  `docs/slices/product-context-diagnosis-groundwork.md` keeps it a separate axis that never feeds a
  tier.

⚠ **This is production cloud transmission of real customer prose.** No vendor setting changes that.
The mitigation is the payload floor above, which bounds what travels — it does not make the transfer
local, and it is stated as the cost of the decision rather than as its absolution.

### 8.4 The payload floor is a mechanism, not an instruction

A rule about what may be sent, enforced by whoever remembers it, is the rule that fails the first
time someone adds a field to improve a number. So:

- the classifier's request is built from a **closed input record carrying a rating and a body, and
  having nowhere else to put anything**;
- a test asserts the serialized request against **the whole outgoing payload**, not against the
  builder's intent — the same shape as `build-annotator-package.mjs`'s artifact check, and for the
  same reason;
- the channel is checked at the boundary, so a non-NAVER review **cannot reach the transport at
  all**.

### 8.5 Fail closed, and never toward silence

A classification that fails — transport error, timeout, or a response that does not satisfy the
output schema — yields `CLASSIFICATION_FAILED`. **The classifier may never invent `FYI`.**

`FYI` is the tier that means "nothing here for the seller". A classifier that defaulted a failure to
it would convert every outage into a silent, invisible dismissal of real reviews, and the seller
would have no way to tell an answered review from an unasked question. The failure states are visible
states.

**Clarified 2026-08-17, during the independent review of candidate B.** §8.9's guard makes a failed
classification land on the **baseline** — and for a 4–5★ review the baseline *is* `FYI`, so the two
sections read as contradicting each other. They do not, and the distinction is worth stating exactly:

- what is forbidden is the **classifier producing `FYI` as its own answer** when it has no answer;
- what happens instead is that the row falls back to **what the product already shows today**, which
  for a 4–5★ review is `FYI` and for a 1–2★ review with text is `NEEDS_ATTENTION`;
- the row carries `status = CLASSIFICATION_FAILED` and a **null `model_tier`**, so an outage is
  never mistakable for a judgment — which is the harm this section names.

The alternative — storing no tier at all on failure — was rejected because it puts the guard back in
the reader, which is the defect this same review found in the write path.

**Ordering honesty.** This clarification widens what may be stored, so it needs the §2.2 test: could
it have been informed by a result? No. Candidate B recorded **0 classification failures across all
three passes**, and the evaluation harness already scored failed rows at the baseline before this
review began. It cannot move any number this contract has produced.

### 8.6 What a DEV result may and may not do to the prompt

§6.2 gives `DEV` to be looked at as often as needed, and that stays true — but a prompt tuned against
`DEV` until the number rises is the same act as fitting a threshold, performed in prose.

So the discipline is recorded rather than assumed: **every model, prompt and version run against
`DEV` is written down — not only the one that wins.** The change log is part of the deliverable. One
candidate is then frozen — model, prompt text, and version string together — and only after it is
frozen may `HOLDOUT` be read, once, per §6.2.

A candidate that needed many `DEV` passes to clear the bars is a different object from one that
cleared them on the first, and the log is what lets a reader tell the two apart.

### 8.7 A candidate is evaluated repeatedly, and gated on its worst pass

**Product-owner decision, 2026-08-17.** §8.6 assumed one run of a candidate is one result. The first
gpt-5 candidate showed that is false: two passes over the identical 107 rows, with the identical
model, prompt, schema and tuning, produced recall 0.886 and 0.857, precision 1.000 and 0.968.

The cause is that a reasoning model rejects a pinned `temperature`, so the classifier runs at the
model's default and samples. **Exact reproducibility is therefore no longer required** — it is not
available at any setting this candidate can use.

What replaces it:

- a candidate is evaluated **3 times on `DEV`**, same rows, same everything;
- the gate reads the **worst** observed pass on every bar: lowest recall, lowest precision Wilson
  lower bound, **highest** 4–5★ false-positive rate, highest classification-failure count;
- the mean and the range are printed too, and are **descriptive only**.

**Best-of is not a reading.** Neither is a mean used as the gate. A candidate whose worst pass fails
has failed, and "it passed on the second try" is the sentence this section exists to make
unsayable. The spread itself is a property of the candidate: one that swings 0.03 in recall between
identical passes is a different product from one that does not, and the reader can see which.

### 8.8 What a candidate's identity now includes

A `classifierVersion` names **all** of these, and changing any one is a new candidate and a new
change-log row:

| component | why it is in the name |
|---|---|
| vendor | a different API |
| **model snapshot**, never a floating alias | `gpt-5` moves under you; `gpt-5-2025-08-07` does not. A result measured against an alias describes a model that may no longer exist |
| prompt version | a reworded prompt is a different classifier |
| output-schema version | what the parser will accept |
| reasoning effort | fixed to exactly one value per candidate; another value is another row, never a retry |
| output budget | on a reasoning model it competes with the answer |
| **additive-guard version** | the guard is part of what decides the tier, so it is part of what produced the result |

### 8.9 The additive guard is code, not an instruction

`v1` §5's fourth condition — *no review the rating-only rule already calls `NEEDS_ATTENTION` may be
demoted; a detector may only ADD* — is enforced by an invariant:

```
final NEEDS_ATTENTION  =  rules-v1 NEEDS_ATTENTION  OR  candidate NEEDS_ATTENTION
```

**Product-owner decision, 2026-08-17**, after the first candidate demoted two low-star reviews the
humans had also called 확인 필요. A prompt instruction not to do that is a request: unchecked,
re-litigated by every prompt edit, and silently broken by the next model.

This is **not** a retreat to the rule. The rule keeps only what it already had; the model may promote
anything else, and the `WATCH`/`FYI` split is left entirely to it because both are `NO_ACTION` in the
partition the gates score. What the floor removes is the single direction that loses a review the
seller was already being shown.

A failed classification lands on the **baseline**, never on `FYI` — so an outage makes the classifier
exactly as good as the rule and no worse. Rows that failed are still scored, at that baseline tier,
because a harness that dropped them would be measuring a system that skips reviews.

The gate is computed on the **final decision**, not the raw model output. What the model would have
done without the guard is reported separately, because "did the prompt fix the behaviour, or is the
guard carrying it?" is a real question about the candidate.

### 8.10 The final `HOLDOUT` evaluation of a frozen candidate

**Product-owner decision, 2026-08-17, written and committed BEFORE any holdout row was read.** That
ordering is the entire value of this section: a procedure fixed after seeing the number is not a
procedure, and §6.2 gives the holdout exactly one reading to spend.

**Procedure**

1. The candidate is **frozen** — model snapshot, prompt, schema, tuning and guard version all fixed
   and named. Nothing about it may change between this section and the reading.
2. **3 independent passes** over the **113 `HOLDOUT` rows**, same candidate, same rows.
3. Each pass is scored under **both** readings: `PRIMARY` (all rows) and `SENSITIVITY` (§11.1's
   synthetic rows excluded).
4. The final gate is the **worst observed value across 3 passes × both readings** — six readings per
   bar.

**The gate**

| bar | statistic | limit |
|---|---|---|
| recall | **minimum** observed | ≥ 0.30 |
| precision, Wilson 95% lower bound | **minimum** observed | ≥ 0.80 |
| 4–5★ false-positive rate | **maximum** observed | ≤ 0.05 |

**Reported beside it, always**

- every classification failure, by kind and count, on every pass;
- the **raw model demotion count** — how many baseline `NEEDS_ATTENTION` rows the model itself would
  have lowered, separately from the guarded figure, because "did the prompt hold, or is the guard
  carrying it?" is a different question from whether the gate passed;
- the §11.1 synthetic sensitivity reading and the §11.2 media ceiling.

The **production final tier applies §8.9's additive guard**, and the gate is computed on that tier —
the one a seller would see — never on the raw model output.

#### 8.10.1 One reading, and what happens after it

**This is the only final `HOLDOUT` evaluation a frozen candidate gets.**

**If any bar fails**, on any of the six readings:

- the candidate is **REJECTED**;
- the result is **recorded exactly as measured**, including the passes that would have cleared it;
- the prompt, model, tuning or guard may **not** be adjusted and re-evaluated against this holdout.
  That is the move this whole contract exists to prevent: a holdout read twice is a development set
  with a ceremony attached;
- a subsequent candidate's final verification requires a **new, untouched holdout** — which means a
  new domain string, a fresh split, and a re-labeled sample (§6.2), not a second look at this one.

**If every bar passes**, the result is recorded as `PASS` and **this holdout is never used again**.
Not for candidate C, not for a re-check, not for a "quick sanity run" after an unrelated change.

Passing here is not permission to ship. It clears `v1` §5's measurement gate; surfacing a classifier
to an operator is a separate decision with its own scope.

### 8.11 A prompt decides the tier first, and names it afterwards

**Product-owner decision, 2026-08-17, before candidate C was written or measured.**

§3.1's `actionable` / `not actionable` column is **a description of the code, not a rule** — that
sentence has been in this contract since the labeling surface was built, and it binds a labeler. It
now binds a prompt too:

> A classifier prompt may not let a `reasonCode`, a `tag` or a `suggestedNextAction` **force,
> promote or demote** a tier. The tier is decided from §2 / §2.1 / §2.2 alone. The descriptive
> fields are assigned to a tier that has already been decided.

Two things made this necessary, one measured and one recorded at the freeze:

- Candidate A demoted two low-star reviews the humans called 확인 필요, **both carrying
  `CRITIQUE_NO_REQUEST`** — the shape of a model that picked a label and reasoned backwards to a tier
  that matched it.
- `triage-prompt/v2` answered that by telling the model outright that `reasonCode` does not decide
  the tier, and then **enumerated four §3.1 codes as tier-forcing conditions in its own stage 1.**
  §11.3 of the slice recorded that tension as an accepted risk rather than fixing it, because fixing
  it with a passing gate in hand would have been tuning by another name. The gate did not hold, so
  the risk is now a defect and this section is where it is answered.

**What the prompt states instead of a code list.** §2.1's two rows that a code list cannot separate:

| `v1` §2 case | label | what actually distinguishes it |
|---|---|---|
| "예쁜데 배송이 너무 늦었어요" — praise with a concession | `NEEDS_LOOK` | the concession is an **operational failure** — something that went wrong in fulfilling this order |
| "생각보다 두꺼워요" — product criticism with no request | `NO_ACTION` | it is an **opinion about what the product is**, and nothing went wrong |

Neither is separated by whether praise is present, and neither is separated by whether a request was
made — *both* lack a request. The axis is **what the complaint is about**. A prompt that asks
"was there a request?" or "was there praise?" is asking the question §2 does not turn on, which is
how a praise-plus-gripe review and a praise-plus-defect review end up on the same side of the line.

This is a structural statement of §2, not a patch. **No specific review, phrase or row from this
corpus may appear in a prompt as an example** — §6.3's rule against a term traceable to a specific
review, applied to prose. The two cases above are `v1` §2's own invented illustrations and were
written before this corpus was drawn.

### 8.12 An evaluation that cannot show its errors did not measure them

**Product-owner decision, 2026-08-17.** `LlmTriageHoldoutIT` reported that candidate B produced 3
false positives on every pass and wrote **no record of which rows they were.** The holdout is spent
and those three reviews can now never be examined. The `HOLDOUT` reading was therefore adequate to
*fail* the candidate and useless for understanding *why* — and understanding why is the entire input
to the next candidate.

Every evaluation harness in this contract writes a **per-row record** of each pass: fingerprint,
stratum, rating, baseline tier, raw model tier, final decided tier, gold tier, candidate
`reasonCode`, gold `reasonCode`. Not only pass 1. The record is written to `build/` and is **never
committed** — it pairs review fingerprints with content-derived judgments and §5 governs what may
enter the repository.

## 9. What this gold set is for, and what it is not

**Product-owner decision, 2026-08-16.** Recorded here because it bounds the artifact: without it, the
obvious reading of a labeling protocol this careful is that every new seller gets one.

**Human labeling is not an operating procedure.** It is not repeated per seller, per category or per
onboarding. This gold set exists to **evaluate and calibrate a classifier**, once, on one corpus —
and it is a fixed reference from that point on.

What production is meant to look like, so nothing here is mistaken for it:

- a classifier triages a new seller's reviews **automatically**;
- only the few that are low-confidence, novel, or where the text and the rating point different ways
  go to a human for QA;
- a new seller or a new category does **not** trigger a full relabel;
- when domain drift is actually observed, it is re-checked with a **small audit sample**, not a new
  gold set.

Two consequences for anything built on this contract:

1. **An LLM is a candidate, never a source of gold.** It is scored on this fixed human gold set by
   §6.3's bars, like any other candidate (§8). A gold label it produced, or a human's confirmation of
   one it showed them, measures agreement with the model and is inadmissible as ground truth.
2. **Numbers from this corpus are one seller, one channel, one category.** §4.1 already says the
   numbers are NAVER's; §7.4 already says 190 of the labels rest on one annotator. Neither becomes
   less true when a classifier trained or tuned against them meets a different seller. The audit
   sample above is the mechanism for finding that out, and it is the thing to build before claiming
   the classifier generalises — not a bigger version of this session.

## 10. The 54-row pilot

**Product-owner decision, 2026-08-16.** Before spending an annotator's pass on 220 rows, use the
owner's own labels to find out whether a classifier can do this job at all. Written before any pilot
number exists, for the same reason everything else here was.

### 10.1 What the pilot may look at — 37 rows, not 54

The owner labels 24 calibration rows (outside the sample) and 30 overlap rows (inside it). Of those
30, **13 are `DEV` and 17 are `HOLDOUT`.**

The pilot runs on the **24 + 13 = 37** rows. The 17 `HOLDOUT` rows are withheld entirely, including
from aggregate counts: §6.2 says the holdout is read once, and a "does the model look good?" reading
is exactly the kind of soft look that mechanism exists to prevent.

The pilot therefore does **not** wait on the annotator. Deciding whether the annotator's pass is
worth doing is its whole purpose, so it cannot be downstream of it.

⚠ **32 of the 37 are 4–5★, and that is structural.** §4.2 censuses every 1–3★ review into the
sample, so nothing outside it is low-rated. It is also the right target: the reviews a rating-only
rule cannot see are, by definition, the highly-rated ones. What the pilot cannot say anything about
is the 1–2★ band — which the rating already handles, and which no candidate needs to be measured on.

### 10.2 What is compared, in this order of importance

1. **`NEEDS_LOOK` recall and the false negatives themselves**, by `reasonCode`. The rating-only rule's
   known blindness is the whole subject; a candidate that does not recover those misses is not
   interesting however well it agrees elsewhere.
2. **Precision, and false positives on 4–5★ rows the human cleared** — `v1` §5's specific harm.
3. **Tier agreement** overall (three-class), descriptive.
4. **`reasonCode` and `tags` disagreement**, tallied. A candidate that gets the tier right for the
   wrong stated reason is a different thing from one that agrees, and the difference matters for a
   surface that shows its reasoning.
5. **Inter-model agreement**, by the same Cohen's κ as §7.4. Two models that disagree with each other
   are not a second opinion; they are one unreliable one.

### 10.3 Blindness

The human labels were made **before any candidate ran** and are never shown to a model. A model
receives the review text, the star rating, and the rubric — the same three things a human labeler
gets, and nothing else. No candidate's output is ever shown to a human labeler.

### 10.4 The decision rule, fixed now

Deliberately **asymmetric**, because 37 rows can rule a candidate out but cannot rule one in:

- **Fall back to the full 220 human-gold protocol** if any of: recall < 0.30 (`v1` §5's bar);
  4–5★ false-positive rate > 0.05; or inter-model κ < 0.60.
- **A pass does NOT license skipping human gold.** `v1` §4's floor — 200 labeled, 40 positive, 30
  high-rated `NO_ACTION` — exists because a sample this size lets a candidate pass on noise. On 37
  rows a Wilson lower bound cannot reach 0.80 even on a perfect run, so no pilot result can clear
  §5's precision gate. Anyone quoting one as if it had is misreading this section.
- **What a pass DOES license** is changing *how* the 220 gets its labels, from "a human reads all
  220" to **verification sampling**: the candidate labels all 220; a human then blind-labels a
  targeted subset — every predicted `NEEDS_ATTENTION` row, plus a random sample of the rest — and the
  metrics are reweighted by the known selection probabilities, exactly as §4.4 already reweights
  strata. Every scored label is still a human's, made without seeing the candidate's answer. The
  saving is real and comes from spending human attention where it moves the number, not from
  trusting a model.
- **Neither clear?** Extend the pilot with a further out-of-sample draw before deciding. Those rows
  are outside the evaluation sample, so labeling more of them changes no pre-commitment — and they
  are all 4–5★, which is where the class in question lives.

### 10.5 What the pilot does not touch

The 220-row sample, the `DEV`/`HOLDOUT` split, `v1` §5's gates, and the 54 human labels themselves.
The labels are made blind and stay as made; a pilot result is never a reason to revisit one.

## 11. Two things that are true of this corpus, and are reported with every number

**Product-owner decisions, 2026-08-17.** Both were established by
`docs/slices/review-eval-corpus-lineage-v1.md` after the annotator pass and before any triage metric
had been computed on this gold set. Neither changes the §4 sample, the §6.1 split, or `v1` §5's
gates.

### 11.1 The frame contains rows no customer wrote — kept, and reported twice

23 of the 3,858 frame rows (0.60%) are fixtures that reached `reviews` through the production ingest
path, so nothing stored distinguishes them from an export row. Four of them are in the 220
(1.8% — three times the frame rate, because §4.2 censuses the low-rating strata and a synthetic short
low-rated row therefore cannot fail to be drawn). They are listed by fingerprint in
`synthetic-rows.json`, all 23 and not only the 4, because the §4.4 population estimate reweights by
stratum and dropping a sample row without dropping the frame rows it stands for would estimate a
corpus that does not exist.

**The decision: keep them.** The sample stays exactly as drawn. Every `DEV` and `HOLDOUT` reading is
reported **twice**:

| reading | over |
|---|---|
| `PRIMARY` | the whole sample, all 220 rows |
| `SENSITIVITY` | the same sample with the 4 synthetic rows excluded, and the frame reduced by all 23 |

Both are printed together, always. A reading quoted without saying which one it is, is not a result.

This costs nothing pre-committed, which is why it is available: excluding the rows would edit an
evaluation set after a finding was in view, and that is the move §4 exists to prevent. The
sensitivity reading is an *addition*, and the same shape as §10's primary/sensitivity pair.

**Why this could not have been fitted to a result.** None of the four appears in any computed metric.
The §10 pilot is the 24 calibration rows plus the 13 `DEV` overlap rows; three of the four are not
overlap rows at all and the fourth (`HOLDOUT`) was withheld from the pilot. No triage evaluation had
been run against this gold set when the rows were found.

The harness re-derives the frame, so if a synthetic count changes — the generating test is one that
adds three rows every time it runs and cannot clean up after itself — it says so instead of silently
reweighting.

### 11.2 The gold set is rating + text, and it could not have been anything else

The real NAVER export carries **`포토/영상` as column 5 of 25**. `ReviewRowMapper` maps eight columns;
`포토/영상` is one of fifteen it does not read, and unlike the three PII-class columns it carries no
refusal sentinel. So it is dropped silently, `CanonicalReview` writes `mediaCount = 0` as a literal,
and `reviews.media_count` is `0` on all 3,927 stored rows across every channel.

**Every label in this gold set was therefore made by a human reading a body and a star rating, for
reviews that may have had photographs attached.** A 5★ `좋아요` beside three photographs of a damaged
item is, in this corpus, identical to a 5★ `좋아요`.

This is a **ceiling on the measurement, not a limit of one classifier.** It bounds `rules-v1`, any v2
rule, Claude, GPT, and the two humans who set the labels, by exactly the same amount. It is printed
with the harness output and it belongs beside every recall figure this contract produces.

It is not a defect to be fixed inside this unit. Whether to alias `포토/영상` belongs with the Product
Context unit, which will open the same mapper for `상품번호` and `상품명`.

## 12. What this corpus is after the holdout was spent

**Product-owner decision, 2026-08-17, taken after candidate B was rejected and recorded.**

§8.10.1 was executed: candidate B failed the precision bar on all six readings, the result was
recorded as measured, and the 113 `HOLDOUT` rows are spent. This section says what the 220 rows are
*now*, because leaving that unstated is how a spent holdout quietly returns to service.

> **All 220 labeled rows become development evidence.** `DEV` and `HOLDOUT` alike may be read,
> analysed row by row, and used to build the next candidate.
>
> **No candidate may ever again be finally verified on any of them.** Not the 113, not the 107, not
> a re-split of the 220, not a subset drawn from them by any rule.

### 12.1 What that costs, stated rather than absorbed

Every number a later candidate produces on these 220 rows is **in-sample by construction.** It is
diagnostic — it says which reviews a candidate gets wrong and why — and it is **not** evidence for
`v1` §5. A candidate C `DEV` gate that clears every bar clears them on rows whose errors were read
while the candidate was being written. That is the definition of the thing this contract was built
to keep out of a shipping decision.

So: §13's fresh holdout is not a formality to be arranged later. **Until it exists and has been
read, no classifier claim rests on anything.** §7 of this decision is enforced structurally — see
`docs/slices/llm-triage-classifier-v1.md` — and the product surface keeps `ReviewTriageRules`.

### 12.2 The split is retired as a gate and kept as provenance

§6.1's `review-eval-split/v2` domain string still computes, and every harness still prints which half
a row came from. It now records one historical fact and nothing else: **which rows candidate B had
never been shown when it was frozen.** That distinction is worth keeping legible — a candidate C
error on a former-`HOLDOUT` row and the same error on a former-`DEV` row are the same error now, but
candidate B's numbers came from halves and a reader tracing them needs to see which.

It licenses nothing. A future harness that re-derived the split to gate on one half would be reading
a holdout twice with a rename.

### 12.3 The spend is sealed by a file, not by this paragraph

`holdout-spent.json` in this directory records the spend: date, the frozen candidate string, the
verdict, and the section that authorised it. `LlmTriageHoldoutIT` and `ReviewTriageEvalIT` **refuse
to run while that file exists** and say why. §8.9's reasoning applies to contracts as well as
prompts: an instruction not to do something is a request, re-litigated by whoever next needs the
number to come out differently.

Deleting the seal to run it anyway is possible, of course. It is also a commit with a message.

## 13. The fresh final holdout — designed before it exists

**Product-owner decision, 2026-08-17. Written and committed BEFORE a single fresh review was
acquired, drawn or labeled, and before candidate C had been measured on anything.** §8.10 earned its
authority the same way; this section is the same move made one step earlier, because the sizing rule
below is exactly the kind of thing that would look like tuning if it arrived after a result.

### 13.1 Why the spent holdout could not have adjudicated what it was asked to

This is the finding that shapes everything below, and it is arithmetic, not hindsight.

Candidate B's holdout reading had **25 predicted positives.** At n = 25, a Wilson 95% lower bound
reaches 0.80 only at 24 correct — so the bar tolerated **exactly one false positive.** The candidate
made three, and its point estimate, 0.880, would clear the same bar at 100 predicted positives.

| predicted positives | max false positives the 0.80 bar tolerates | implied precision |
|---|---|---|
| 25 | 1 | 0.960 |
| 40 | 3 | 0.925 |
| 54 | 5 | 0.907 |
| 70 | 7 | 0.900 |
| 87 | 10 | 0.885 |
| 100 | 12 | 0.880 |

**The gate was correct and it was not wrong to fail candidate B** — a candidate that has not
demonstrated 0.80 has not demonstrated it, and a lower bound is the statistic precisely so that a
small sample cannot pass on luck. But a 113-row holdout could only ever have certified a classifier
at ≈0.96 true precision. It had almost no power to tell 0.88 from 0.70, and both of those answers
print as `FAIL`.

A holdout that can only return one answer is not measuring. **The fresh sample is sized so the gate
can come back either way.**

### 13.2 The sizing rule

> Draw enough rows that the frozen candidate is expected to produce **at least 60 predicted
> positives** on the fresh sample.

60 certifies a true precision of ≈0.91 and tolerates 5 false positives — one more than double
candidate B's count, at a sample size that can still be labeled by two humans.

The row count follows from a rate that is **known before the fresh sample is drawn**: the candidate's
positive-prediction rate over the 220 development rows. Expected positives ≈ rate × rows, per
stratum, so:

```
rows drawn  =  ceil( 60 / observed positive-prediction rate on the 220 )
```

with a **floor of 300 labeled rows** regardless of what that computes to, and the allocation across
strata following §13.3. If the rate is the ≈22% candidate B showed, this is ≈280 rows and the floor
binds.

**The rate is measured on the development corpus, never on the fresh one.** Choosing a size after
seeing how the fresh rows score is choosing a size that makes the answer come out.

### 13.3 Strata — label-blind, and the same two axes

**Rating band × `length(body)`**, the §4.2 definitions unchanged: `LOW` 1–2★, `MID` 3★, `HIGH` 4–5★
crossed with `S` < 20, `M` 20–39, `L` ≥ 40.

**No text-feature or keyword enrichment of any kind.** Not a complaint lexicon, not a negation
pattern, not a length-of-longest-sentence heuristic — nothing a candidate's own signal reads.
Stratifying on what the classifier looks at hands it the recall it is being measured for. Rating and
body length are properties of the row that no tier rule in this contract consults as evidence.

**The 1–3★ bands are censused**, as in §4.2. They are the scarce class, they carry most of the
positives, and sampling inside them throws away exactly the rows the gate needs. Enrichment toward
low ratings **is permitted and expected** — it is label-blind, it raises predicted positives per
labeled row, and it makes the sample harder rather than easier. It also makes the unweighted gate
reading a statement about an enriched sample, which §4.4 already requires be said out loud, and the
§4.4 Horvitz–Thompson population reading is reported beside it with its weights.

The 4–5★ allocation keeps §4.2's tilt toward longer bodies, and the 4–5★ false-positive bar is
computed over the high-rated `NO_ACTION` rows in the sample, as before.

### 13.4 Frame requirements

1. **Real NAVER review rows**, acquired through the ordinary path — an export the seller produced.
   No live marketplace run happens without the fresh, single-use approval `docs/sellerops_live_approval_contract.md`
   requires; this section is not that approval and cannot become one.
2. **Disjoint from the 3,858.** Enforced by `reviewIdFingerprint`: any row whose fingerprint appears
   in the existing frame is dropped from the fresh frame before the draw. A fresh **seller** or a
   fresh **time window** of the same store both satisfy this; a different seller is preferred,
   because it also tests whether the candidate generalises past one store's product mix and one
   store's customers.
3. **Zero synthetic rows.** §11.1's three generator families are screened out of the fresh frame by
   fingerprint before drawing, and the frame's synthetic count is asserted to be 0. §11.1's
   `PRIMARY` / `SENSITIVITY` pair is still printed — it will read identically, and that identity is
   the evidence that the screen worked.
4. **The §11.2 media ceiling is unchanged and still printed.** If `포토/영상` is aliased by the
   Product Context unit before this sample is labeled, that is a different corpus and this section is
   re-derived rather than reused.
5. **The frame's composition is reported before the draw**: row count, rows per stratum, and the
   fingerprint-overlap count with the old frame.

### 13.5 Labeling

§2, §2.1, §2.2, §3 and §5 apply unchanged — **including §2.2, which both labelers now read from the
start.** The version skew that consumed six of thirty overlap rows on the last pass was an artifact
of one labeling surface being built before that section existed, and it does not recur by accident;
the surface build asserts the section is present.

- two labelers, roles per §7.1, the rule's author blind to the sample per §7.6;
- an enriched overlap per §7.3, stated as enriched;
- the agreement bar is **κ ≥ 0.60 on the binary `NEEDS_ATTENTION` partition**, per §7.4, computed on
  **raw answers before any adjudication**, exactly as it was;
- disagreements are adjudicated against this contract's text, never row by row against a candidate's
  answers — and no candidate answer on a fresh row may be looked at until gold is assembled and
  committed.

### 13.6 The reading

Identical to §8.10, and it inherits §8.10.1 whole:

- one frozen candidate, 3 independent passes, both readings, worst observed across the six;
- recall ≥ 0.30 · precision Wilson 95% LB ≥ 0.80 · 4–5★ FP ≤ 0.05;
- classification failures and raw model demotions reported beside it;
- the gate computed on the §8.9 final decision, the tier a seller would see;
- **one reading, ever**, and a failure may not be answered by a prompt edit and a second look.

**Reported beside the gate, and new:** the **power diagnostic** — the observed number of predicted
positives, the maximum false positives the bar tolerates at that number, and the smallest number of
predicted positives at which the observed precision *would* have cleared it. Descriptive. It does not
move the bar, and it may never be offered as a reason a failure does not count. It exists so that
§13.1's arithmetic is visible at the moment it matters rather than a day later.

### 13.7 Until it exists — and the one pilot permitted before it

**As first written (2026-08-17, before candidate C):** no classifier reaches a product surface until
the fresh holdout has been read and passed.

**Product-owner amendment, 2026-08-17, after candidates C and C2 were measured on the 220.** Tuning
ended at `triage-prompt/v4`; the fresh holdout is a second seller's corpus and does not exist yet. A
**conservative production pilot** of C2 is permitted before it, under all of these — and the
amendment is stated as a list of what the pilot may *not* do, because that is what makes it
conservative rather than a rename of "ship":

1. **Additive `확인 필요` promotion only.** The pilot may add an `AI 확인 필요` mark to a review that
   `ReviewTriageRules` did not already call `NEEDS_ATTENTION`. It may not move any review *down*, and
   it does not own `WATCH` / `FYI` — those remain the rating-only rule's, unchanged.
2. **§8.9's guard, in the ordering as well as the store.** The final rank a seller sees is
   `min(rules rank, AI rank)`; the SQL that orders the list has no expression that can lower a rules
   `NEEDS_ATTENTION`.
3. **`AI 확인 필요` is displayed as what it is** — a candidate's suggestion, marked as such, never
   merged into the rules tier so that the seller cannot tell which mechanism spoke.
4. **NAVER only, through `NaverOnlyClassifierGate`, per §8.3.** No Coupang review reaches the transport
   under the pilot or any future one.
5. **No marketplace write.** The pilot changes what the seller *sees* and records what they *do*; it
   submits nothing anywhere. The existing human-in-the-loop boundary is untouched.
6. **Opt-in per organisation**, and off by default. An org that has not enabled it sees exactly what
   it saw before this section existed.
7. **A pilot is not a `PASS`.** No metric produced by the pilot — correction rate, action rate,
   anything — substitutes for the fresh holdout. §13.6's reading remains the only thing that clears
   `v1` §5.

**Where the fresh holdout comes from, in order of preference:** a **second real seller's corpus**
first (§13.4's stated preference, now the primary route); a fresh time window of the same store
second. The unlabeled remainder of the existing frame is **not** a holdout — it may be used only as
**high-rating precision stress evidence**, so labeled wherever it is quoted, because §4.2 censused
every 1–3★ row and what remains cannot test the 3★ band at all. The spent holdout is never reused
(§8.10.1, §12.3).

**What the pilot records is feedback, not learning.** Corrections, actions and behaviour events
accumulate under `docs/slices/production-triage-feedback-draft-v1.md` §7–§8: explicit corrections
are strong evidence, behaviour is weighted silver, ignore is never a negative label, and nothing
changes a live classifier. A next version is built offline and measured against gold and a frozen
snapshot before it is considered.

**Every candidate C number remains labeled in-sample** per §12.1 wherever it is written down.

### 13.8 How large a fresh frame has to be, and why a month of reviews is not one

Computed 2026-08-17 from `labels.json` and the existing frame — committed labels and stratum counts
only, no candidate result of any kind. It belongs in this section rather than in a slice note because
it is what makes §13.2's target reachable or not, and finding that out after acquiring a sample would
be finding it out too late.

**The positive rate by stratum, over the 218 scored rows:**

| stratum | in frame | labeled | gold `NEEDS_ATTENTION` | rate |
|---|---|---|---|---|
| `LOW_S` / `LOW_M` / `LOW_L` | 14 | 13 | 13 | 1.000 |
| `MID_S` | 49 | 49 | 9 | 0.184 |
| `MID_M` | 30 | 30 | 13 | 0.433 |
| `MID_L` | 12 | 12 | 11 | 0.917 |
| `HIGH_S` | 2,440 | 29 | 1 | 0.034 |
| `HIGH_M` | 969 | 40 | 2 | 0.050 |
| `HIGH_L` | 344 | 45 | 15 | 0.333 |

Two things follow, and the second is not obvious.

**1–3★ is 2.7% of this frame.** Censusing it, as §4.2 does, yields 0.442 positives per row — but only
105 rows exist. A frame with this composition would need ≈5,000 reviews before the low bands alone
carried 60 positives, and this store produces ≈297 reviews a month. **A one-month fresh window from
the same seller cannot come close**, and neither can six.

**`HIGH_L` is the dense stratum, not the low bands.** 4–5★ reviews with a body of 40 characters or
more are positive at 0.333 — one in three — and there are 344 of them, 8.9% of the frame. That is
where `PRAISE_WITH_CONCESSION` lives: a concession needs room to be written, which is the reason
§4.2 tilted the high band toward long bodies in the first place. Per labeled row, `HIGH_L` is worth
seven `HIGH_S` rows and three-quarters of a `MID_S` row.

**So `HIGH_L` is censused too**, alongside 1–3★. Both are rating × body-length strata, both are
label-blind, and neither reads a text feature — §13.3's fence is untouched by this. `HIGH_S` and
`HIGH_M` are then sampled at roughly the §4.2 allocation, which is what keeps a denominator under the
4–5★ false-positive bar.

**The frame requirement that falls out**, using a deliberately conservative 0.25 for `HIGH_L` rather
than the observed 0.333 — 15 of 45 is a wide interval and the fresh store is a different store:

```
positives  ≈  F × ( 0.027 × 0.442  +  0.089 × 0.25 )  ≈  0.034 × F
```

| target positives | fresh frame needed | rows to label |
|---|---|---|
| 40 | ≈ 1,200 reviews | ≈ 220 |
| **60** | **≈ 1,800 reviews** | **≈ 290** |
| 80 | ≈ 2,400 reviews | ≈ 360 |

**≈1,800 reviews is the acquisition requirement** — about six months of this store's volume, or one
comparable store's year. §13.2's floor of 300 labeled rows and this table agree at the 60 target,
which is the reason the floor was set where it was.

**What this enrichment costs, said out loud.** Censusing `HIGH_L` concentrates the sample on the
stratum where the hardest calls live. The unweighted gate reading is therefore a statement about a
sample deliberately made harder than the corpus, exactly as §4.4 has always required be said, and the
Horvitz–Thompson population reading is printed beside it with its weights. It is not a way of making
a candidate look good; it is the only way of getting enough positives to tell 0.88 from 0.70 at all.

**If the fresh frame comes in smaller than ≈1,200 reviews**, the sample is drawn and read anyway and
the §13.6 power diagnostic says what the bar could and could not have adjudicated. What does not
happen is a smaller frame quietly producing a `FAIL` that reads like a measurement.
