# SellerOps unified event model (offline)

> **Offline model layer — no live collection, no AI, no scoring.** No live NAVER /
> ESM, no browser, no credentials, no real data exist or are modeled here. This is a
> type + dispatch layer only.

## What this is

SellerOps unifies the platform-specific normalized signals into **one operational
event stream**. Each normalizer already produces its own `SellerOps*Event`; this
layer joins them into a single discriminated union plus a matching sanitized-summary
union and a dispatcher.

- `SellerOpsEvent` — the union of all normalized events, discriminated on `kind`.
- `SellerOpsEventKind` — `review | cs_inquiry | order_shipping | claim | sales_context`.
- `SellerOpsSanitizedSummary` — the union of the per-kind sanitized summaries.
- `sanitizedSummaryFor(event)` — maps any event to its log-safe sanitized summary via
  an **exhaustive** switch (a new unhandled kind is a compile-time error).

Source: `src/events/types.ts`, `src/events/sanitized-summary.ts`.

## The signals and their roles

- **Reviews** (`SellerOpsReviewEvent`) — the **differentiation axis**; VOC content
  that drives product/operation insight.
- **Inquiries** (`SellerOpsInquiryEvent`) — create **daily usage**; unanswered
  inquiries are the recurring to-do.
- **Claims** (`SellerOpsClaimEvent`), **orders/shipping** (`SellerOpsOrderEvent`),
  **sales/settlement context** (`SellerOpsSalesContextEvent`) — provide **priority
  and risk context** (is this a high-sales product? rising claims? unshipped orders?).

## What this layer is NOT

- **Not AI scoring** — no classification, summarization, or model calls here.
- **Not live collection** — it consumes already-normalized events; it collects
  nothing.
- **Not a DB schema or backend endpoint** — pure types + a pure dispatcher.

## Input boundary for future priority scoring

This union is the **input** a future priority layer will read to answer *"what should
the seller pay attention to today?"*. Signals that layer is expected to weigh
(not implemented here):

- **issue severity** (e.g. low-rating reviews, defect claims)
- **unanswered status** (open inquiries, not-replied reviews)
- **claim presence** (active claims on a product/order)
- **sales importance** (the sales-context amount bucket / order counts)
- **repeated-complaint signal** (clusters of the same issue across reviews)

The first concrete consumer of this boundary is the deterministic attention-signal
layer — see `attention-signal-model.md` (`attentionSignalsFor`), which derives
rule-based attention reasons from these sanitized summaries (no AI, no scoring). Those
signals roll up into the batch `attention-digest-model.md`, and the planned priority
score over them is specified (docs-only) in `priority-score-model.md`.

## Sanitized summaries are the only safe telemetry shape

`sanitizedSummaryFor` returns **only** the existing per-kind sanitized summaries. It
adds no new exposure and reads no raw content itself. Across all kinds, the sanitized
shape **never** includes:

- review body / title / option text
- inquiry title / body / content
- claim reason text
- exact sales amounts (only a coarse `amountBucket`)
- exact sales/order counts
- `productRef` / `orderRef` / `reviewRef` / `claimRef` / `shipmentRef`
- buyer / reviewer / seller identity
- credentials / tokens / raw URLs / raw HTML / screenshots

Logs and telemetry must use the sanitized summary, never the full event.

## Out of scope (now)

Live NAVER / ESM / browser / Playwright · AI calls · priority scoring · credentials /
seller IDs / Master ID / API key / JWT · backend · DB · upload · RUN_INTEGRATION ·
real data. NAVER live work is separately **paused**; ESM live/API/credential work is
**deferred**.
