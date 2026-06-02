# Phase 2E classification — eval seed dataset

Hand-labeled seed for diagnosing Stage 2 polarity classification.
**Not a representative production benchmark** — every row is sourced
from one product (메디힐 더마 패드, run-010) and labeled by a single
labeler. Treat outputs of `evaluate_phase2e_classification.py` as
*direction-of-error indicators*, not metrics fit for an SLA.

## File

- `polarity_eval.jsonl` — JSONL, one labeled span per line.

## Row schema

```json
{
  "id": "stable identifier (run-prefix + attribute + index)",
  "source_run_id": "pipeline run id the row came from",
  "goodsNo": "OliveYoung product code",
  "product_name": "Korean product name",
  "review_id": "phase1_reviews.review_id",
  "attribute": "canonical Phase 2E attribute key",
  "text": "verbatim evidence span as recorded by Stage 1/2",
  "current_polarity": "what Stage 2 produced",
  "gold_polarity": "what a careful labeler thinks",
  "error_type": "see error-type vocabulary below",
  "confidence": "labeler's confidence: high | medium | low",
  "note": "brief justification + context for next labeler"
}
```

### Polarity values

`positive | negative_weak | negative_strong | mixed | neutral`

`neutral` is for spans that don't actually express sentiment about
the attribute (meta-comments, tangential context). Stage 2 doesn't
emit `neutral` directly; the closest current behavior is to over-
fit a span to one polarity. In the eval it lets us mark "this span
should not surface in seller report" without forcing a fake
positive/negative call.

### error_type vocabulary

| code | meaning |
|---|---|
| `positive_as_negative` | Stage 2 said negative_*; gold is positive. The dominant Run-010 failure mode. |
| `negative_as_positive` | Stage 2 said positive; gold is negative. Rarer but more dangerous (overstated strength). |
| `mixed_should_be_mixed` | Span carries both polarities; Stage 2 picked one side. Should ideally be `mixed`. |
| `neutral_or_context_missing` | Span doesn't actually express attribute sentiment; should be excluded from seller surfaces. |
| `attribute_mismatch` | Span doesn't reference the claimed attribute at all. |
| `span_boundary_bad` | Span ends mid-word / mid-clause; verbatim citing in seller PDF would be unprofessional. Polarity may still be correct. |
| `acceptable_current_label` | Stage 2 got it right; row is included to ensure we measure precision, not just recall on errors. |

### Confidence

- `high` — unambiguous; another careful labeler should agree.
- `medium` — defensible read but a different labeler could land elsewhere.
- `low` — labeler is hedging; treat the gold label as tentative.

## Labeling discipline

1. **Read the text alone, then assign gold.** Do not look at the
   current_polarity first; that biases the call.
2. **Korean conventions matter.** `ㅎㅎ` and `ㅜㅜ` after positive
   morphemes are usually positive emoticons. `~` is a soft soften
   particle, not necessarily a complaint.
3. **Negation/concession is decisive.** `밀착력은 좋은데 빨리 말라서`
   is `mixed`, not negative.
4. **Per-attribute polarity.** A span may be globally positive but
   negative on the specific attribute (e.g. positive overall review
   that complains about packaging). The gold polarity is *for the
   labeled attribute only*.
5. **Banned-token spans.** Spans containing 효과 / 효능 / 진정 /
   치료 are flagged via `note` even when polarity is unambiguous,
   so the seller PDF renderer can paraphrase rather than cite.
6. **Document why.** The `note` field is for the next labeler —
   say what cues drove the call.

## Provenance

This seed was authored on 2026-05-01 from `outputs/2026-04-30_product-
83743e299623_run-010/shared/analysis_report.json`. The 4 known
false negatives explicitly called out in the seller-report audit
appear at `run010_adh_001`, `run010_adh_003`, `run010_finish_001`,
`run010_dry_001`.

## Limitations

- Single product, single category (`skincare_pad`). Does not
  exercise `makeup_blush` polarity edge cases (발색, 묻어남).
- 42 rows is below the 80–150 target. Expand by labeling more
  products or by sampling negative-class spans from the DB
  directly (currently spans were lifted from `top_quotes` of
  the analysis_report which is itself filtered).
- Single labeler. Inter-labeler agreement is undefined.
- Some rows reference identical text with different `review_id`
  values (Stage 2 emitted duplicate spans). These are kept to
  measure labeling consistency rather than collapsed.

## Updating the dataset

1. Edit `polarity_eval.jsonl`. One row per line, no trailing
   commas.
2. Re-run the evaluator:
   ```bash
   PYTHONPATH=. python3 scripts/evaluate_phase2e_classification.py \
       --dataset eval_data/phase2e/polarity_eval.jsonl
   ```
3. Compare the new seed report against the prior one in
   `outputs/eval/`. Investigate any sharp accuracy regression
   before committing.
