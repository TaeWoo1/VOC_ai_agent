# Inquiry Issue Detection — RUBRIC v1

**What this measures.** Whether SellerOps can find, in a seller's REAL inquiry corpus, the questions
that keep coming back — and whether the labels it attaches to them mean anything.

**Why it exists.** "The pipeline runs" is not the completion criterion for this capability, and saying
so out loud is the lesson of `contracts/review-eval/naver/v1/RUBRIC.md`: that rubric recorded a
detector that ran, stored rows, fed four downstream layers, and had **0/30 sample recall**. Every
surface above it reported success. The measured state this capability starts from is the same shape —
the deterministic extractor produced a signature for **0 of 3,220** real inquiries on the demo org
(2026-08-21) while `RepeatedInquiryService`, the customer-memory index, and the Operator's
`list_repeated_inquiries` tool all worked correctly on top of nothing.

---

## 1. What is being classified

One inquiry → two closed-vocabulary labels:

| axis | vocabulary | owner |
|---|---|---|
| `topic` | 배송 · 교환 · 제품정보 · 설치 · 가격 · 품질 · 색상 · 사이즈 | `ItemAnalysisCategories` (**reused**, not duplicated) |
| `ask` | 가능여부 · 규격 · 기간 · 방법 · 상태 · 비용 · 재고 · 호환 · 하자 | `InquiryAskKind` (new, this contract) |

The signature is `<topic>:<ask>` — the same shape a review's `IssueSignature` key has
(`배송:지연`), so `customer_memory_entries.signature_key` holds one kind of value and the repeat
aggregation needed no change.

**`기타` can never appear.** It is the analyzer's "we looked and it fits nothing", and a signature
built on it would let a classification gap become a pattern. That is not hypothetical: on real data
`기타` was the demo org's largest "repeat" at **1,777 occurrences** before it was excluded.
`InquirySignature`'s constructor refuses it.

---

## 2. Gates — a capability that misses these is a LIMITATION, not a feature

| # | Gate | Threshold | Measured on |
|---|---|---|---|
| G1 | **DEV recall** — of the gold-labelled inquiries that a human says carry a real topic+ask, how many did the classifier label at all | **≥ 0.60** | DEV split |
| G2 | **DEV precision** — of the labels it produced, how many a human accepts | **≥ 0.80** | DEV split |
| G3 | **HOLDOUT usefulness** — repeated issues an operator agrees are worth acting on | **≥ 5 distinct signatures**, each with ≥ 3 occurrences in a 28-day window | HOLDOUT split |
| G4 | **No manufactured pattern** — no signature may be produced for an inquiry a human labelled unclassifiable | **0 violations** | both splits |

**G4 is the one that cannot be traded away.** G1 and G2 are quality; G4 is honesty. A classifier that
guesses to raise recall converts "we could not tell" into a seller-visible pattern, which is worse
than no capability at all.

---

## 3. The gold set

- **Size:** ≥ 200 inquiries, sampled from the real corpus with a fixed seed, recorded with the seed.
- **Split:** DEV / HOLDOUT, disjoint, split before any label is read.
- **Labels:** `topic`, `ask`, or `UNCLASSIFIABLE`. A labeler may use only the inquiry's own text.
- **What a labeler must NOT see:** the classifier's output, the product, or any other inquiry's label.

> ⚠ **Annotation provenance must be stated with every measurement.** `review-eval/naver/v2` used
> multiple human annotators with an agreement step and adjudication. A single-annotator gold set is
> still usable and still better than no measurement, but it measures agreement with ONE reader and the
> report must say so rather than presenting the number as a human consensus.

---

## 4. What a passing run may and may not claim

| may say | may not say |
|---|---|
| "이 org의 문의에서 N개의 반복 이슈를 찾았습니다" | "고객 문의를 이해합니다" |
| "제품정보:규격 문의가 28일간 12건" | "규격 설명이 부족합니다" (a diagnosis, not a count) |
| "분류하지 못한 문의가 M건입니다" | silence about M |

The last row is the rubric's own version of the coverage rule the rest of the product follows: an
unclassified remainder is reported, never folded away.

---

## 5. Recording a measurement

Every run records: date, org, corpus size, model + prompt version (`InquirySignalPrompt.PROMPT_VERSION`),
gold set id and seed, annotator count, G1–G4 results, and the resulting decision (PASS / LIMITATION).
A LIMITATION result is reported in the package's completion report and in
`docs/sellerops_operator_graph_v2.md` §16 — it does not block the rest of the package, and it does not
get rounded up to "done".

## 6. Cost and exposure bounds (not quality gates, but conditions of running at all)

- One inquiry text is classified **at most once, ever** (`inquiry_signature_cache`, keyed by a one-way
  hash of the normalized text). A re-run, a replayed backfill page and a re-collection all hit the
  cache. This is a privacy control before it is a cost control.
- A single text is **truncated, never split** — splitting means two egresses for one customer sentence.
- One backfill page classifies at most `sellerops.inquiry.signature.max-batch-per-call` texts.
- The capability is **off by default**, org-scoped, and carries its own flag and key
  (`sellerops.inquiry.signature.*`) — a deployment that wants goal interpretation must not thereby be
  sending customer questions to a vendor.
