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

Optional, and only on this labeled set against the deterministic rule. The external-LLM fence stands:
no review text leaves the machine. If a local classifier is tried, it is scored by §6.3's bars on the
same `DEV`/`HOLDOUT` split, and "an LLM would probably do better" is not a result — the only
admissible claim is a measured one.
