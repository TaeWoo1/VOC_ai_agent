# SellerOps attention-digest model (offline)

> **Offline batch rollup — no scoring, no ranking, no AI, no live collection.**
> Deterministic; reads only attention signals + sanitized summaries.

## What the digest is

The attention digest is a **batch-level rollup** of the deterministic attention
signals. It answers *"what kinds of issues are accumulating today?"* across a set of
events — it does **not** score, **rank**, or summarize with AI.

- Source: `src/events/attention-digest.ts` — `attentionDigest(events: SellerOpsEvent[])`.
- Inputs: `attentionSignalsFor(event)` (which reads only sanitized summaries) and the
  sanitized summary's coarse `kind` / `platform` / `channel`.
- Output: an `AttentionDigest` of counts only — never event ids, refs, content,
  amounts, counts, or identity.

## Shape

```
AttentionDigest {
  totalEvents:   number          // events processed
  totalSignals:  number          // signals emitted across the batch
  bySignalCode:  { code, count }[]
  bySeverity:    { severity, count }[]
  byEventKind:   { kind, count }[]
  byPlatform:    { platform, count }[]
  byChannel:     { channel, count }[]
  byRecency:     { bucket, count }[]   // Phase 4 — coarse recency histogram (display only)
}
```

- **Signal-level** counts: `bySignalCode`, `bySeverity` (a count per emitted signal).
- **Event-level** counts: `byEventKind`, `byPlatform`, `byChannel`, `byRecency` (a count
  per event, so an event with zero signals — e.g. an order — still counts toward its kind/
  platform/channel/recency bucket).
- `byRecency` (Phase 4) counts every event by its coarse `recencyBucket`. It needs the
  explicit `attentionDigest(events, { referenceTimeMs })`; omitted → every event is
  `"unknown"`. `sales_context` (no safe timestamp) is always `"unknown"`. It is **display
  only** — coarse buckets, never an exact timestamp / `eventTimeMs` / elapsed, and it does
  not influence any score or ordering.

## Deterministic ordering

- `bySignalCode` — fixed declared order: `low_rating_review`, `not_replied_review`,
  `unanswered_inquiry`, `active_claim`, `sales_context_available`, `high_sales_context`,
  `unknown_attention_signal`.
- `bySeverity` — `high` → `medium` → `low`.
- `byEventKind` — `review`, `cs_inquiry`, `claim`, `order_shipping`, `sales_context`.
- `byRecency` — fixed bucket order: `fresh_0_2h`, `same_day_2_24h`, `recent_1_3d`,
  `aging_3_7d`, `stale_over_7d`, `unknown`.
- `byPlatform` / `byChannel` — lexicographic after counting.
- Only entries with a non-zero count appear (empty input → all empty arrays, zero
  totals).

## Boundaries (what the digest never exposes)

review body/title/option · inquiry title/body/content · claim reason text · product/
order/review/claim/shipment/settlement refs · exact sales amounts/counts · buyer/
reviewer/seller identity · seller ID / Master ID / account ID · API key / JWT / token ·
raw URL / raw HTML / screenshot. No event ids, no sample raw data, no numeric score,
no per-event ranking.

## Example product uses

- a **daily attention overview** ("3 high-severity signals today")
- **signal-code counts** (which problem types recur)
- **severity counts** (how urgent the mix is)
- **platform / channel breakdown** (where issues concentrate)
- the **event-kind mix** (reviews vs inquiries vs claims vs sales context)

## Future work (out of scope here)

- **Deduplication** — collapsing repeated signals for the same underlying entity.
  Deferred deliberately: there is no safe, stable dedup key exposed in the sanitized
  summaries yet (event ids and refs are intentionally not in the summary). When a safe
  coarse key exists, dedup can be added without reading raw content.
- **Exact recency windows** (today / 7d / 30d). The coarse `byRecency` histogram is now
  implemented (Phase 4); exact date-windowed counts remain deferred.
- **AI summaries** of the digest.
- **Dashboard / backend persistence.**

This layer is the **input boundary** for that future priority score / dashboard; it
produces only the deterministic counts they will consume. The priority score's
philosophy, allowed/forbidden inputs, and draft weighting are specified (docs-only,
not yet implemented) in `priority-score-model.md`.

## Out of scope (now)

Live NAVER / ESM / browser / Playwright · AI calls / model prompts · numeric score ·
ranking · credentials / seller IDs / Master ID / API key / JWT · backend · DB · upload ·
RUN_INTEGRATION · real data. NAVER live work is **paused**; ESM live/API/credential
work is **deferred**.
