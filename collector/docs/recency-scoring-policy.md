# SellerOps recency-scoring policy — specification (Phase 3)

> Offline; no AI; no live collection. **Phase 3 is implemented** — the safe
> `recencyBucket` (Phase 2c/2d) now feeds `priorityScoreFor` as a small, capped,
> secondary tie-breaker. No `Date.*`, no `Date.now` / `new Date` / `generatedAt`, no
> wall-clock read — recency scoring uses an **explicit `referenceTimeMs`** only. Phase 4
> (surfacing the bucket as a view-row field) stays deferred.

This is the Phase 3 detail behind `recency-bucket-model.md` §7 ("small scoring
factor") and `priority-score-model.md` §6 ("Future recency factor"). The *policy*
(weights, guardrails, plan) was locked before code, consistent with how the priority
model itself was specified before implementation.

**Implemented in:** `src/events/priority-score.ts` (`RECENCY_BUCKET_POINTS`, the
`{ referenceTimeMs }` option, the `recency_bucket_applied` code), threaded through
`prioritizeEvents` and `attentionView`. Tests in `test/events/priority-score.test.ts`,
`prioritize-events.test.ts`, `attention-view.test.ts`.

**Note on band tipping (current weights):** the model is score-folded (§3), so a band is
derived from the post-recency total. Under the *current* severity weights, every
recency-bearing event scores 0, 40, 70, or 120, and the +8 cap is smaller than every gap
to the next band threshold (the nearest is 70 → 100 = 30). So today recency **never
changes a band** — it only reorders within a band. The score-folded rule still means a
future re-calibration could let a near-boundary event tip up by ≤1 band; it can never
overcome a full severity gap.

## 0. Prerequisite status (already shipped)

Phase 2c/2d is complete: a coarse `recencyBucket` is exposed on every timestamp-bearing
sanitized summary, computed from an internal `eventTimeMs` + an explicit
`referenceTimeMs`:

- `review` → `recencyBucket` (from `writtenAt`)
- `cs_inquiry` → `recencyBucket` (from `createdAt`)
- `claim` → `recencyBucket` (from `createdAt`)
- `order_shipping` → `recencyBucket` (from `orderedAt`)
- `sales_context` → recency stays `unknown` **by design** (its timestamps are a period
  range, not an event instant)

`eventTimeMs` is internal-only and never exposed. See `recency-bucket-model.md`,
`recency-timestamp-source-audit.md`, `recency-timezone-policy.md`.

## 1. Role of recency in scoring

Recency is a **secondary tie-breaker**, not the main priority driver. It nudges
ordering among events of otherwise-similar severity ("two open claims — surface the
fresher one first"); it must **never** be what makes a low-severity event outrank a
high-severity one.

Specifically, recency **must never outweigh**:

- critical / negative review signals
- unanswered review / inquiry signals
- claim-risk (active claim) signals

The existing severity weights (high = 70, medium = 40, low = 10) and the co-occurrence
and high-sales bonuses remain the dominant terms. Recency is a small additive nudge on
top.

## 2. Recency contribution (additive, capped at +8)

A single, capped, additive contribution derived **only** from the coarse
`recencyBucket` — never from `eventTimeMs`, a raw timestamp, or an elapsed duration.

| `recencyBucket`    | recency points |
|--------------------|----------------|
| `fresh_0_2h`       | +8             |
| `same_day_2_24h`   | +5             |
| `recent_1_3d`      | +2             |
| `aging_3_7d`       | +0             |
| `stale_over_7d`    | +0             |
| `unknown`          | +0             |

**Maximum recency contribution: +8 points.** This is well below a single high-severity
signal (70) and below even the high-sales bonus (15) and 2-signal co-occurrence bonus
(10) — so by construction recency cannot flip severity ordering.

### Guardrails baked into the table

- **No negative recency penalty.** Old events are not pushed *down*; they simply get
  `+0`. Aging never subtracts.
- **`unknown` is never punished.** A missing/timezone-less/unparseable timestamp yields
  `+0`, identical to an old-but-known event — never a negative. Missing timestamps are
  frequently a **platform/export limitation**, not a signal about the event, so they
  must not cost the seller attention. (This is the same "never penalize for missing
  data" principle already applied to the sales `amountBucket`.)
- **`sales_context` → `+0`.** Its recency is `unknown` by design, so it receives the
  `unknown` row (+0). No special-casing.

## 3. Determinism & safety constraints

- **Explicit `referenceTimeMs` required.** The recency contribution is computed from the
  event's coarse `recencyBucket`, which is itself derived from `eventTimeMs` + a
  caller-supplied `referenceTimeMs`. Scoring must **never** read the wall clock.
- **No `Date.*` / `Date.now` / `new Date` / `Date.UTC` / `generatedAt`.** The reference
  time is always a caller input threaded into scoring.
- **No new exposure.** Recency scoring reads only the already-sanitized coarse bucket;
  it adds no raw content, refs, exact times, or elapsed durations to the score or its
  explanation.
- **Deterministic.** Same sanitized inputs + same `referenceTimeMs` → identical score
  and explanation. With no `referenceTimeMs` supplied, recency contributes `+0` and the
  score is unchanged from today's behavior.
- **Score-folded bands.** Recency adds at most +8 to the raw score and the band is
  derived from the total (`band = bandFor(score)`), exactly as today. Band **thresholds**
  are unchanged. Because the contribution is capped at +8, recency may nudge an event
  that is already at a band boundary **up by at most one band** (e.g. a high-sales review
  at 95 + `fresh_0_2h` (+8) = 103 → `urgent`). It can **never overcome a full severity
  band gap**, so it never lets a lower-severity event outrank a higher-severity one — the
  guarantee that matters is severity ordering, not band immutability.

## 4. Explanation / audit

When (and only when) the recency contribution is non-zero, scoring records a fixed
explanation code:

- `recency_bucket_applied`

This matches the code already named in `recency-bucket-model.md` §7. The code names
*that* recency applied; it does **not** encode the bucket value, the points, the
timestamp, or the elapsed duration. A `+0` contribution (aging/stale/unknown, or no
`referenceTimeMs`) adds **no** explanation code, so the absence of the code is itself
audit-meaningful ("recency did not move this score").

## 5. Implementation (Phase 3 — done)

1. **Recency contribution in `priorityScoreFor`.** `priorityScoreFor(event, opts?:
   { referenceTimeMs?: number })` derives the event's `recencyBucket` via the existing
   `sanitizedSummaryFor(event, opts)` seam (`sales_context` has no bucket → read as
   `unknown`), maps it through the named `RECENCY_BUCKET_POINTS` table (§2), and adds the
   capped contribution. It is applied on the main signal path only — a zero-signal event
   stays score 0 (recency never invents priority).
2. **Explanation code.** Pushes the fixed `recency_bucket_applied` only when the
   contribution is non-zero (§4); `PriorityScoreExplanation` shape is unchanged.
3. **Deterministic ranking.** `prioritizeEvents(events, opts?)` forwards a SINGLE
   batch-wide `referenceTimeMs` to every event's score; sort stays score-descending then
   `inputIndex`-ascending. `attentionView(events, { referenceTimeMs })` forwards it to
   `prioritizeEvents` only (not the digest); the view row shape is unchanged.
4. **Per-bucket tests** — each bucket yields exactly its §2 points; `unknown`, future
   `eventTimeMs`, and missing `referenceTimeMs` → `+0`.
5. **Dominance + safety tests** — a stale high-severity event still outranks a
   fresh medium one; a fresh no-signal event stays 0; no-leak sweep (no `eventTimeMs` /
   raw timestamp / elapsed in score or explanation); determinism (same inputs + same
   `referenceTimeMs` → identical result); no-reference baseline identical to the
   pre-recency behavior.

## 6. Still deferred after Phase 3

- **Phase 4 — `attentionView` recency passthrough.** Carry recency only through the
  already-sanitized priority explanation; do **not** add a `generatedAt` (reference time
  stays a caller input). Specified in `recency-bucket-model.md` §7; not in this PR.
- **Negative recency penalties, SLA math, dedup, clustering, AI summaries, backend, UI**
  — all remain out of scope.

## Out of scope (now)

Live NAVER / ESM / browser / Playwright · AI calls / model prompts · Phase 4 view-row
recency surfacing · `Date.now` / `new Date` / `generatedAt` / wall-clock · credentials /
seller IDs / Master ID / API key / JWT · backend · DB · upload · RUN_INTEGRATION · real
data. NAVER live work is **paused**; ESM live/API/credential work is **deferred**.
