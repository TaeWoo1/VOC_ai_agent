# SellerOps recency-bucket model — specification

> Offline; no AI; no live collection. Phase 1 (the pure helper) is implemented;
> Phases 2–4 (sanitized-summary field, scoring factor, view passthrough) remain
> deferred. No `Date.now` / `new Date` / current-time read in source.

## Implementation status

- **Phase 1 — `recencyBucketFor(eventTimeMs, referenceTimeMs)` implemented**
  (`src/events/recency-bucket.ts`). Pure, deterministic. Accepts **epoch milliseconds
  only** — no `Date` objects, no raw date-string parsing, **no `Date.now`**, **no
  `new Date`**, no current-time read. `eventTimeMs` null/undefined/non-finite →
  `unknown`; non-finite `referenceTimeMs` → `unknown`; future event
  (`eventTimeMs > referenceTimeMs`) → `unknown`. Otherwise buckets by age:
  `[0,2h) fresh · [2h,24h) same_day · [24h,3d) recent · [3d,7d) aging · [7d,∞) stale`.
  Output is the coarse bucket only — never a timestamp, duration, raw date string, or
  timezone.
- **Phase 2b — offset-bearing parser `parseOffsetTimestampToEpochMs` implemented**
  (`src/events/offset-timestamp-parser.ts`). See `recency-timezone-policy.md`.
- **Phase 2c-1 — internal `eventTimeMs` on review events implemented**; other kinds
  deferred (`sales_context` stays `unknown`). See `recency-timestamp-source-audit.md`.
- **Phase 2d-1 — review-only sanitized `recencyBucket` implemented**
  (`sanitizedReviewSummary` / `sanitizedSummaryFor` accept an explicit
  `{ referenceTimeMs }`; missing/non-finite ref or missing/future `eventTimeMs` →
  `"unknown"`; no wall-clock read; `eventTimeMs`/raw timestamps/elapsed never exposed).
  Remaining kinds deferred.
- **Phase 3 — small recency factor in `priorityScoreFor` — deferred.**
- **Phase 4 — `attentionView` passthrough via priority explanation — deferred.**
- **Exact SLA, timezone handling, deduplication, clustering, AI summaries, backend,
  UI — deferred** (§8).

## 1. Why this layer exists

Recency is the most-cited deferred factor across the scoring stack
(`priority-score-model.md` §9, `attention-view-model.md`). It would let attention
priority reflect *how recently* something happened. But recency touches **timestamps**,
which are sensitive and easy to leak — so the safety boundary is specified before any
code.

The safe recency bucket answers:

> **"How recently did this event happen — coarsely enough to nudge attention priority?"**

It must **not** answer:

- exact event time
- exact SLA deadline
- exact elapsed seconds / minutes
- exact creation timestamp
- exact customer activity timeline

## 2. Bucket model

```ts
type RecencyBucket =
  | "fresh_0_2h"
  | "same_day_2_24h"
  | "recent_1_3d"
  | "aging_3_7d"
  | "stale_over_7d"
  | "unknown";
```

Coarse, ordinal buckets only. `unknown` is the honest default when no safe timestamp
exists or the input is invalid.

## 3. Principles

1. **Recency must be coarse** — buckets only, never a precise age.
2. **No exact timestamps** appear in sanitized summaries, views, logs, telemetry, or
   fixtures.
3. **Deterministic** — the same `(eventTime, referenceTime)` always yields the same
   bucket.
4. **No `Date.now()`** inside scoring or ranking — ever.
5. **Explicit reference time** — a future implementation accepts a caller/test-provided
   `referenceTime` / `referenceDate`; it never reads the wall clock itself.
6. **Missing/invalid timestamps → `unknown`** (never a guessed bucket).
7. **Recency is a small multiplier/bonus only**, never the sole priority signal.
8. **Recency must not override** a high-risk claim or a low-rating review on its own.
9. **Human approval remains required** for outward actions.
10. **Explainable** — recency contributes only through fixed reason codes.

## 4. Allowed future inputs

- a parsed event timestamp **inside the normalizer/adapter** (kept internal, not
  re-emitted)
- an **explicit caller-provided reference time**
- the coarse **age bucket** itself
- platform / channel coarse tags
- existing attention signals
- existing priority-score explanation

## 5. Forbidden future outputs

Never expose:

- exact timestamp
- exact elapsed seconds / minutes
- raw date string from the marketplace
- raw timezone string from the seller center
- raw URL / raw HTML / screenshot
- buyer / reviewer / seller identity
- product / order / review / claim refs
- seller ID / Master ID
- API key / JWT / token

If a desired factor needs one of these, it stays deferred — never satisfied by
exposing raw time or identity.

## 6. Deterministic reference-time rule

The bucket is a **pure function of two explicit inputs**: the event time and a
caller-supplied reference time. The wall clock is never read inside the library.

- Production callers pass the reference time in from the edge (a single, auditable
  place), so the library stays deterministic and testable.
- Tests pass a fixed reference time and assert exact bucket boundaries.
- This is why the codebase-wide rule "no `Date.now` / `new Date()` in source" can hold
  even once recency ships.

## 7. Phased implementation plan (to document, not implement)

**Phase 1 — pure helper.**
`recencyBucketFor(eventTime, referenceTime): RecencyBucket` — explicit reference time
only, no `Date.now`, invalid/missing → `unknown`. Pure + unit-tested at boundaries.

**Phase 2 — sanitized-summary field.**
Add a safe `recencyBucket` to sanitized summaries **only where a safe event timestamp
already exists** in the normalized event. Expose the **bucket**, never the timestamp.

**Phase 3 — small scoring factor.**
Add a small recency factor to `priorityScoreFor` with a fixed explanation code
`recency_bucket_applied`. Keep it **lower** than claim/review/inquiry severity, so it
nudges but never dominates.

**Phase 4 — view passthrough.**
Let `attentionView` carry recency **only** through the already-sanitized priority
explanation. Do **not** add a `generatedAt` (the reference time stays a caller input,
not a view-generated timestamp).

## 8. Deferred work (beyond this model)

- exact SLA calculation
- platform-specific timezone handling
- deduplication
- clustering
- AI summaries
- backend endpoint
- UI

## Out of scope (now)

Live NAVER / ESM / browser / Playwright · AI calls / model prompts · recency/scoring/
ranking/normalizer **implementation** · `Date.now` / `new Date` / `generatedAt` ·
credentials / seller IDs / Master ID / API key / JWT · backend · DB · upload ·
RUN_INTEGRATION · real data. NAVER live work is **paused**; ESM live/API/credential
work is **deferred**.
