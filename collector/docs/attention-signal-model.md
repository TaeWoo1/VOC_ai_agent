# SellerOps attention-signal model (offline)

> **Offline rule layer — no AI, no scoring, no live collection.** Deterministic,
> typed, rule-based. Reads only sanitized summaries; never raw VOC content.

## What attention signals are

Attention signals are **rule-based reasons** an event might need seller attention —
*why*, not *how much*. They are **not** a ranking score, **not** AI classification,
and **not** a prioritization order. They are the bridge between the unified event
envelope (`sellerops-event-model.md`) and a *future* priority score.

- Source: `src/events/attention-signals.ts` — `attentionSignalsFor(event)`.
- Input: the event's **sanitized summary** (`sanitizedSummaryFor`) only. The
  extractor never inspects raw event content.
- Output: a deterministic `AttentionSignal[]` (`{ code, severity, reason }`), fixed
  order per kind, possibly empty.

## Signal roles

- **Reviews** surface product/customer pain.
- **Inquiries** surface immediate work.
- **Claims** surface operational risk.
- **Sales context** surfaces business importance.

## Signals implemented (derivable from existing sanitized fields)

| Code | Source field | Trigger | Severity |
|------|--------------|---------|----------|
| `low_rating_review` | `SanitizedReviewSummary.ratingBucket` | `low` | high |
| `not_replied_review` | `SanitizedReviewSummary.replyStatus` | `not_replied` | medium |
| `unanswered_inquiry` | `SanitizedInquirySummary.status` | `open` | medium |
| `active_claim` | `SanitizedClaimSummary.status` | `open` or `in_progress` | high |
| `high_sales_context` | `SanitizedSalesContextSummary.amountBucket` | `10m_to_100m` / `100m_plus` | high |
| `sales_context_available` | `SanitizedSalesContextSummary` presence booleans | `hasGrossSalesAmount` ∥ `hasOrderCount` ∥ `hasClaimCount` | low |

All triggers read coarse buckets / status enums / presence booleans — never exact
amounts, counts, content, refs, or identity.

## Deferred (intentionally not emitted yet)

- **Content-availability signals** (`review_content_available` /
  `inquiry_content_available`): `hasBody`/`hasTitle` exist in the sanitized summaries,
  but a "has content" signal is low-value and noisy, so it is **not** emitted. Not in
  the `AttentionSignalCode` enum.
- **Order signals**: `SanitizedOrderSummary.status` is available, but no order-specific
  attention rule is defined yet (e.g. "stuck in preparing" would need a time/age
  field the sanitized summary does not currently expose). `order_shipping` events
  return `[]`. **TODO:** revisit when an age/SLA-derived safe field exists.
- **`unknown_attention_signal`**: reserved in the enum for forward-compat; no current
  rule emits it.

No implemented rule required a field the sanitized summaries do not already expose —
nothing was blocked on a missing safe field.

## Boundaries (what signals never contain)

`reason` is a fixed, generic, sanitized phrase. Signals never include: review
body/title/option, inquiry title/body/content, claim reason text, order title, exact
sales amounts/counts, `productRef`/`orderRef`/`reviewRef`/`claimRef`/`shipmentRef`/
`settlementNo`, or buyer/reviewer/seller identity. No AI, no model prompt, no numeric
score.

## Batch rollup

The batch-level rollup of these signals across many events is the **attention
digest** — see `attention-digest-model.md` (`attentionDigest`), a deterministic,
sanitized count of signal codes / severities / event kinds / platforms / channels (no
score, no ranking, no AI).

## Future priority score

A later priority layer can combine these signals — weighing severity, signal
co-occurrence (e.g. a low-rating review on a `high_sales_context` product), and recency
— into the ranked "what needs attention today" view. That scoring is **out of scope
here**; this layer only produces the typed reasons it will consume.

## Out of scope (now)

Live NAVER / ESM / browser / Playwright · AI calls / model prompts · numeric priority
score · credentials / seller IDs / Master ID / API key / JWT · backend · DB · upload ·
RUN_INTEGRATION · real data. NAVER live work is **paused**; ESM live/API/credential
work is **deferred**.
