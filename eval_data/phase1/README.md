# Phase 1 Signals — Labeling Guide

Curator-facing guide for reviewing and extending `phase1_signals_golden.json`.

## What this eval measures

For each labeled review, the golden file records human-language **concern tags**
(e.g. `durability_concern`, `authenticity_doubt`). `phase1_signal_map.json` maps
those tags to pipeline signal IDs (e.g. `persistence_reservation`). The eval
asks, for each review the human labeled: did the pipeline fire the signals
the mapping says it should have?

Key decoupling: **labels use natural concepts, not pipeline signal IDs.**
Adding a new signal or changing a lexicon entry does NOT require relabeling
— only the map is updated.

## Scope of the first labeling pass

Only cautionary and gap concerns are in scope right now. Positives are
deferred because the positive lexicon fires densely on OY data already and
evaluating its precision would require a much larger labeling effort.

**Rule of thumb**: if a review contains a substantive complaint, warning,
or safety concern, it should appear in the golden file. Happy-path reviews
(plain 5★ "예뻐요") should NOT appear — their absence is the implicit label
"no cautionary concern here."

## Controlled vocabulary (14 tags, v0.7)

Mapped to current pipeline signals:

| Tag | Meaning | Current signal |
|---|---|---|
| `durability_concern` | doesn't last, wears off, needs reapplication | `persistence_reservation` |
| `tone_mismatch` | color/undertone suitability issue for a skin tone or undertone (e.g. 라이트톤에게 비추, 너무 극웜) | `tone_mismatch` |
| `pigment_complaint` | color too weak / too strong / weird color payoff as delivered | `pigment_complaint` |
| `value_complaint` | 돈 아까, 가격대비 실망, 비싼지 — price/value dissatisfaction | `value_complaint` |
| `application_difficulty` | 바르기 어려움, hard to blend, manual-skill required | `application_issue` (combined) |
| `base_makeup_disruption` | application lifts, smears, removes, or destabilizes base makeup | `application_issue` (combined) |
| `authenticity_doubt` | counterfeit suspicion, product-differs-from-official | `coupang_authenticity_concern` (Coupang only) |
| `skin_irritation` | 가렵, 따갑, allergic reaction, skin reacts badly | `skin_irritation_concern` (channel-agnostic, threshold=1) |

Coverage gaps (no pipeline signal today; empty array in signal map):

| Tag | Meaning | Expected in report? |
|---|---|---|
| `shade_mismatch` | wrong delivered shade / unexpected color result / color outcome not as expected | no — coverage gap (see distinction below) |
| `marketing_deception` | 광고에 속, misled by ad claims | no — not yet |
| `seller_trust_concern` | 판매자 무섭, marketplace trust concern, seller-side suspicion | no — not yet |
| `return_intent` | 환불 예정, explicit intent to refund | no — not yet |
| `packaging_complaint` | 뚜껑 구립, packaging quality issues | no — not yet |
| `generic_negative` | vague negativity with no identifiable theme | no — correctly not covered |

### Important distinction: `shade_mismatch` vs `tone_mismatch`

Use `shade_mismatch` when the complaint is about the **color outcome itself**:
- expected one kind of color, got another
- too red / too orange / too purple / too strong / too weak
- "홍당무처럼 된다", "생각한 색상이 아니다"

Use `tone_mismatch` when the complaint is about **fit to undertone / skin tone / complexion**:
- 라이트톤에게 비추
- 너무 극웜
- tone suitability advice rather than shade-delivery failure

This distinction was reified in v0.3: the pipeline signal (formerly
`shade_tone_issue`) was renamed `tone_mismatch` to match what its patterns
(비추 / 극웜 / 너무 극) actually catch. `shade_mismatch` is now an explicit
coverage gap — the pipeline has no rule for wrong-delivered-color complaints
yet.

### v0.3 changelog

- Renamed pipeline signal `shade_tone_issue` → `tone_mismatch`. Display
  label went from "셰이드 톤 부적합 경고" to "톤 부적합 경고". Lexicon
  patterns unchanged.
- Removed `disappointment_general` / `general_disappointment` pair. The
  eval showed precision=0.00 (3 FPs, 0 TPs) after the curator moved to
  more-specific tags. Dropping the signal eliminates pure noise.
- `shade_mismatch` demoted from mapped to coverage gap. No pipeline
  pattern targets wrong-delivered-color complaints today.

### v0.4 changelog

- Added pipeline signal `pigment_complaint` (display: "발색 불만") targeting
  the largest coverage gap (7 labeled reviews in the matched pair). Patterns
  grounded in the 7 labeled rows: `발색이 별로`, `최악의 발색`,
  `발색도 좀 연한`, `이정도의 발색`, `덕지덕지 발라도`, `홍당무처럼`,
  `자주색이 되`. Deliberately EXCLUDES the polarity-ambiguous `발색이 진해`
  pattern (positive-context reviews use it to describe successful
  pigmentation). Expected eval delta: recall_mapped rises, coverage-gap
  count drops by 7.

### v0.5 changelog

- Added pipeline signal `value_complaint` (display: "가격·가치 불만")
  targeting the 4 labeled value-complaint reviews (price/value
  dissatisfaction). Patterns: `돈 아까`, `이가격대`, `비싼지`, `가격대비 실망`.
  Deliberately EXCLUDES bare `가격대비` (4 FPs on 5★ reviews elsewhere
  using `가격대비 좋아요`-style positive framing) and bare `가격대의`
  (fires on `합리적인 가격대의 ... 추천` positive construction) and
  `가성비` (fires 73× across the DB, mostly positive). The tighter
  patterns catch all 4 labels plus one semantically-legit out-of-MP 5★
  review whose body explicitly says `솔직히 돈 아까워요` (rating / review
  text mismatch — the signal correctly surfaces it).

### v0.6 changelog

- Added pipeline signal `application_issue` (display: "바르기·밑화장 문제")
  — one COMBINED signal covering both `application_difficulty` and
  `base_makeup_disruption` tags. Rationale: 2 of the 3 labeled reviews
  carry both tags; splitting would produce two sparse signals that
  frequently co-fire, while a combined signal gives operators one clear
  bucket for "how-to-apply problems" without losing semantic clarity in
  the report. Patterns: `어떻게 쓰는거예요`, `어떻게 바르시`,
  `발리는 양이 아주 작`, `잘 얹어지지 않`, `피부화장이 밀리고`,
  `밑화장까지 벗겨`. Deliberately EXCLUDES `바르기 어려` (2 FPs on 5★
  reviews saying "even people who find blush hard can use this"),
  `피부화장이 밀리` and `화장이 밀리` (collides with positive-negation
  construction `밀리지 않`), and `베이스가 밀리` (6 FPs on 5★ reviews using
  `밀리지 않`).

### v0.7 changelog

- Added code-level gap rule `skin_irritation_concern` (display:
  "피부 자극·알러지 우려 (고위험 안전 신호)") — channel-agnostic,
  threshold=1, following the same high-severity-class design as
  `coupang_authenticity_concern`. Safety-class signals get threshold=1
  because one credible report warrants operator attention. Patterns are
  DELIBERATELY CONJUNCTIVE (`가렵고 따갑`, `따갑고 가렵`, `이상하게 가렵`)
  because every bare single-word irritation term (`가렵`, `따갑`, `알러지`,
  `두드러기`, `발진`, `피부 트러블`, `자극적이`, `피부 자극`, `피부가 붉어`)
  appears more frequently in positive-negation constructions ("자극 없어요",
  "알러지 반응 없음", "피부 트러블 없어요") than in genuine complaints across
  the corpus. Conjunctive patterns are reliable evidence of actual
  irritation, not negation.

## How to label a review

1. **Open** `phase1_signals_golden.json`.
2. **Read** the `text_excerpt` for the review. Optionally join to the DB for
   the full text if the excerpt truncates the key clause.
3. **Check** the `concerns` array. Ask:
   - Does every tag here actually match a claim the reviewer made?
   - Is any complaint in the text NOT represented by a tag?
4. **Edit** accordingly:
   - Add missing tags from the controlled vocabulary above.
   - Remove tags the reviewer didn't actually express.
   - If a review genuinely has no substantive concern, set
     `"status": "dismissed"` and clear `concerns`.
   - If a concern needs a tag that doesn't exist yet, add it to the vocab
     in this README **and** update `phase1_signal_map.json` with an empty
     array (marking it as a coverage gap).
5. **Update** `"status"` from `"draft"` to `"reviewed"`.
6. **Optional**: add a short `curator_note` explaining any judgment call.

## How to NOT label

- Don't assign tags just because a rating is low. A 1★ review that just
  says "그냥 별로" gets `generic_negative`, not 5 guessed tags.
- Don't try to tag positives during this pass. If a review has both positive
  and cautionary content, record the cautionary tags only.
- Don't invent fine-grained tags prematurely. Coarseness here is deliberate.
  But when two concepts matter analytically (e.g. `tone_mismatch` vs
  `shade_mismatch`, or `durability_concern` vs `base_makeup_disruption`),
  splitting them is allowed and encouraged.

## When to stop

The point of this first pass is **cautionary + gap coverage on the Phase 1
matched pair**. Stopping criteria:
- Every low-star Coupang review (1-3★, product `7156638510`) has `status: reviewed`.
- Every OY review containing a 지속력 / 비추 / 극웜 / 톤 marker has `status: reviewed`.
- Clearly positive-only reviews are NOT in the file at all.

Anything beyond that (positives, age-group biases, cross-channel rating
drift) belongs to a later labeling pass.

## Known judgment calls in the current draft

- `fe2fe09823734d88` ("판매자 무섭네요 ㅋ") — still short and borderline.
  Keeping it as `seller_trust_concern` is reasonable; dismissing it is also defensible.
- `6708e93dd69647a3` — the 지속력 reservation is conditional
  ("파우더처리 한번만 더 해주면 좋은편"), not an unambiguous complaint.
  Keeping this as `durability_concern` implies the pipeline's current
  `지속력도 파우더` pattern is correctly cautionary-coded.
- `9665eaca8c3d9904`, `d1fbaf6c2c5bfd95` — treated as `tone_mismatch`,
  not `shade_mismatch`, because the core complaint is undertone suitability.
- `3ba45d8c16fc013a`, `c08f583ab2401928` — treated as
  `base_makeup_disruption` when the main issue is that application destroys
  or lifts existing base makeup, not just that the product wears off later.
- `910076d664d4b78a` — upgraded from `generic_negative` to `pigment_complaint`
  because the review still points at a bad delivered color effect, even though
  the text is short.
- `d46a4c61b028a5fc`, `4b958dd193650531` — broad `disappointment_general`
  was removed where more specific concern tags already explain the complaint.

## After the first review pass

Run the eval script (once implemented) and look at:
- **Recall per signal**: are we catching the rows the human said should fire?
- **Precision per signal**: are we firing on rows the human said shouldn't?
- **Coverage-gap count**: how many labeled concerns have no pipeline signal?
  This number is the best hint for what to curate into the lexicon next.
