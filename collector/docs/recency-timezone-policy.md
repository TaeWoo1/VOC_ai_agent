# SellerOps recency timezone policy

> Offline; no AI. The offset-bearing parser helper (Phase 2b) is implemented; it is
> not wired into normalizers and adds no `eventTimeMs`/`recencyBucket` (Phases 2c+
> deferred). No `Date.*` API, no wall-clock read, no `generatedAt`.

## Implementation status

- **Phase 2b — `parseOffsetTimestampToEpochMs(raw)` implemented**
  (`src/events/offset-timestamp-parser.ts`). Pure, deterministic. Accepts **only**
  strict ISO-like `Z` / `±HH:MM` offset-bearing forms; **timezone-less strings are
  rejected** (→ `null`); **no KST assumption**. Uses strict regex + manual
  calendar/offset arithmetic — **no `Date.parse`, `new Date`, `Date.now`, or
  `Date.UTC`** (no `Date.*` at all), no wall-clock read. Invalid/ambiguous/non-string
  input → `null`. Not wired into normalizers; no `eventTimeMs` field; no
  `recencyBucket` summary wiring.
- **Phase 2c — internal `eventTimeMs` on `review`, `cs_inquiry`, `claim`, and
  `order_shipping` events — implemented** (`src/review/review-normalizer.ts`,
  `src/esmplus/inquiry-normalizer.ts`, `src/esmplus/claim-normalizer.ts`,
  `src/esmplus/order-normalizer.ts`). Each normalizer parses its primary raw field
  (review `writtenAt`, inquiry/claim `createdAt`, order `orderedAt`) with
  `parseOffsetTimestampToEpochMs` and includes an **internal** `eventTimeMs?: number`
  only when the result is a number; timezone-less / invalid / missing → field omitted.
  The raw string is unchanged. `eventTimeMs` is **internal only** — it never appears in
  sanitized summaries, the dispatched summary, attention signals/digest/views, logs, or
  telemetry (asserted by tests). All timestamp-bearing kinds now covered.
- **Phase 2d — sanitized `recencyBucket` on `review`, `cs_inquiry`, `claim`, and
  `order_shipping` — implemented** (`src/review/review-normalizer.ts`,
  `src/esmplus/inquiry-normalizer.ts`, `src/esmplus/claim-normalizer.ts`,
  `src/esmplus/order-normalizer.ts`, `src/events/sanitized-summary.ts`).
  `sanitizedReviewSummary` / `sanitizedInquirySummary` / `sanitizedClaimSummary` /
  `sanitizedOrderSummary` and `sanitizedSummaryFor(event, { referenceTimeMs })` surface a
  coarse `recencyBucket`, computed via `recencyBucketFor` from the internal `eventTimeMs`
  + an **explicit caller reference time**. Missing / non-finite `referenceTimeMs` →
  `"unknown"`; missing / future `eventTimeMs` → `"unknown"`. No wall-clock read.
  `eventTimeMs`, raw timestamps, and elapsed duration are never exposed. No
  scoring/ranking/view behavior change.
- **`sales_context` — recency stays `unknown` by design** (its `periodStart`/`periodEnd`
  are a range, not an event instant).
- **Phase 3 — recency factor in `priorityScoreFor` — deferred.**
- **Phase 4 — `attentionView` passthrough — deferred.**

## Summary

The timestamp audit (`recency-timestamp-source-audit.md`) found that every normalized
event timestamp is a **raw marketplace string** (`writtenAt`, `createdAt`/`regDt`,
`orderedAt`/`orderDt`, `updateDt`, `periodStart/End`). `recencyBucketFor` requires
epoch milliseconds, so a future parser must convert these — but **only safely**. This
policy fixes the conservative rule **before** any parser exists: parse only what is
unambiguous, treat everything else as `unknown`, and never guess a timezone.

## Conservative default

1. **Explicit-offset strings may be parsed later** (once a tested parser exists).
2. **Timezone-less strings are NOT parse-safe** by default → missing `eventTimeMs` →
   `recencyBucket: "unknown"`.
3. **Do not assume KST** just because the marketplace is Korean.
4. **Platform-specific timezone policy must be explicit** (see below).
5. **Ambiguity → `unknown`.** Never guess timezone, locale, calendar, or format.
6. **Human-facing priority must not silently depend on a guessed timezone.**

## Parse-eligible timestamp shapes

Only timestamp strings carrying an **explicit timezone/offset** are eligible for a
future parser:

- ISO string ending in `Z` (UTC) — e.g. `...T09:00:00Z` / `...T09:00:00.000Z`
- ISO string with a numeric offset — e.g. `+09:00`, `-05:00`
- other explicitly offset-bearing formats, **only** if a parser is later written and
  tested for them

Eligibility is necessary, not sufficient — a parser still has to exist, be tested, and
be wired in per the phased plan before any bucket is produced.

## Timezone-less strings

A timestamp string **without** an explicit timezone/offset (e.g. a bare
`2026-06-18 09:00:00` or `2026-06-18`) is **not parse-safe** by default. It must map to
a **missing `eventTimeMs`**, which later maps to **`recencyBucket: "unknown"`**. We do
**not** assume a zone, a locale, or "probably local" — silence beats a wrong guess.

## Platform-specific policy

KST (or any platform-local interpretation) may be added later **per platform/field**
**only if** one of these holds:

- the platform contract/documentation states the field is seller-center **local time**, or
- fixture/source **provenance is documented**, or
- the **adapter explicitly owns** that platform-local interpretation.

The future policy shape is **conceptual only** (do **not** implement this type yet):

```ts
interface TimestampParsePolicy {
  platform: string;
  field: string;
  timezonePolicy: "explicit_offset_required" | "platform_local_kst" | "unknown";
}
```

Default for every (platform, field) pair until explicitly decided:
`"explicit_offset_required"`.

## sales_context policy

`sales_context` remains **`unknown`** for event recency regardless of timezone — it
carries a **period range** (`periodStart`/`periodEnd`), not a single event instant, so
"how recently did this happen" is not well-defined for it. (If an "as-of" recency is
ever wanted, it would be a separate, explicitly-specified decision.)

## Sanitized output boundary

- Raw marketplace timestamp strings must **never** appear in sanitized summaries,
  attention views, logs, telemetry, or test snapshot outputs.
- Parsed **epoch milliseconds stay internal**. Sanitized summaries expose **only**
  `recencyBucket` — never `eventTimeMs`, never the raw timestamp, never elapsed time.
- All parsing must be **deterministic**: a future parser receives the raw string + the
  explicit field/platform policy; it **must not read the wall clock**. The explicit
  reference time is used only by `recencyBucketFor`, separately.

## Future implementation phases

- **Phase 2a** — parser **policy docs/tests only**, if needed.
- **Phase 2b** — implement a parser helper for **offset-bearing strings only**.
- **Phase 2c** — add internal `eventTimeMs?: number` inside **selected normalizers
  only where policy is explicit**.
- **Phase 2d** — add `recencyBucket` to sanitized summaries using an explicit
  reference time.
- **Phase 3** — add a small recency factor to `priorityScoreFor`.
- **Phase 4** — let `attentionView` carry recency **only** through sanitized priority
  explanations.

## Deferred work

Parser implementation · `eventTimeMs` · `recencyBucket` wiring · per-platform KST
decisions · locale/calendar handling · exact SLA · deduplication · clustering · AI
summaries · backend · UI. NAVER live work is **paused**; ESM live/API/credential work
is **deferred**.
