# SellerOps recency timezone policy

> **Docs-only policy — no implementation.** Defines how timezone-bearing vs.
> timezone-less timestamp strings should be treated when recency parsing (Phase 2)
> is eventually built. No parser, no `eventTimeMs`, no `recencyBucket` wiring, no
> normalizer/scoring/ranking/view change, no `Date.now`/`new Date`/`generatedAt`.
> Offline; no AI.

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
