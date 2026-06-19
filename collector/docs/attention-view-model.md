# SellerOps attention-view model (offline)

> **Offline assembler — no AI, no scoring, no live collection, no timestamp.**
> Deterministic; combines existing pure layers into one sanitized payload.

## What the attention view is

The attention view is the **first UI/report-consumable assembled payload** — the
"what needs attention today" object. It does **not** add new scoring logic; it only
assembles two existing pure layers:

- **`attentionDigest(events)`** — the batch rollup over **all** events.
- **`prioritizeEvents(events)`** — the sanitized ranked rows — sliced to a top-N limit.

Source: `src/events/attention-view.ts` — `attentionView(events, opts?)`.

## Shape

```
AttentionView {
  totalEvents:        number          // events received
  totalRankedEvents:  number          // ranked rows produced (== totalEvents today)
  limit:              number          // the normalized top-N limit actually applied
  truncated:          boolean         // ranked.length > limit
  digest:             AttentionDigest // summarizes ALL events
  top:                PrioritizedEvent[] // sanitized ranked rows, sliced to limit
}
```

## Behavior

- `digest` is built from **all** events (it always reflects the full batch, never just
  the top-N).
- `top` is `prioritizeEvents(events).slice(0, limit)` — it preserves the ranking
  order (score descending, then `inputIndex` ascending).
- `totalEvents = events.length`; `totalRankedEvents = ranked.length`;
  `truncated = ranked.length > limit`.
- Empty input → empty digest + `top: []`.
- Deterministic and pure: same input → same output.

### Limit normalization

- Default limit: **10**.
- Maximum: **50** (larger values clamp down).
- Negative → **0**.
- Decimal → **floored**.
- Non-finite (`NaN`/`Infinity`) → default **10**.
- Never throws for bad limit values.

## Boundaries (what the view never exposes)

It carries only the digest counts + sanitized `PrioritizedEvent` rows, so it never
includes: review body/title/option · inquiry title/body/content · claim reason text ·
product/order/review/claim/shipment/settlement refs · exact sales amounts/counts ·
buyer/reviewer/seller identity · seller ID / Master ID / account ID · API key/JWT/token ·
raw URL / raw HTML / screenshot · **the raw event object** · **any current timestamp**.

This layer deliberately generates **no `generatedAt`/timestamp**. It may forward an
explicit caller `referenceTimeMs` (never a wall-clock read) so the rows carry a coarse
`recencyBucket` and the digest a `byRecency` histogram — **display only**, with no effect
on scoring or ordering (Phase 4; see `recency-bucket-model.md` §7).

## Future work (out of scope here)

- **Backend endpoint** serving the view.
- **UI card / list** rendering it.
- **Recency-aware ordering / SLA windows** — the coarse `recencyBucket` is now surfaced
  for display (Phase 4) and feeds the Phase 3 score tie-breaker, but exact date-windowed
  ordering and SLA math remain deferred (`recency-bucket-model.md`).
- **Deduplication.**
- **Clustering.**
- **AI summary** of the digest / top rows.

## Out of scope (now)

Live NAVER / ESM / browser / Playwright · AI calls / model prompts · new scoring logic ·
recency-aware ordering / SLA math · deduplication · clustering · `generatedAt` / wall-clock
timestamps · credentials / seller IDs / Master ID / API key / JWT · backend · DB · upload ·
RUN_INTEGRATION · real data. NAVER live work is **paused**; ESM live/API/credential work is
**deferred**.
