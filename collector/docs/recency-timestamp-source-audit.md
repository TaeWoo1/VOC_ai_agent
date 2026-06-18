# SellerOps recency timestamp source audit

> **Docs-only audit — no code change.** Read-only inspection of the existing
> normalized event types and normalizers to decide, before Phase 2, which timestamp
> sources are safe to feed `recencyBucketFor`. No normalizer/scoring/ranking/view
> change, no parsing, no `Date.now`/`new Date`/`generatedAt`. Offline; no AI.

## Summary

`recencyBucketFor(eventTimeMs, referenceTimeMs)` (Phase 1) requires **epoch
milliseconds**. Every timestamp field on every normalized event is currently a
**raw marketplace string passed through `trimOrNull`** — never parsed to epoch ms.
Therefore **no event kind is safe to feed `recencyBucketFor` today**; all would have
to bucket to `unknown` until a parsed, internal epoch-ms timestamp exists.

The sanitized summaries never expose the timestamp value — only `has*At` booleans
(`hasWrittenAt` / `hasCreatedAt` / `hasOrderedAt` / `hasUpdatedAt`). There is no
epoch-ms field anywhere in the event or summary layer.

## Event-kind matrix

| kind | timestamp-like field | current type | safe for `recencyBucketFor`? | Phase 2 recommendation |
|---|---|---|---|---|
| `review` | `writtenAt` (primary), `updatedAt` | `string \| null` (raw) | **No** — raw string | parse `writtenAt` → internal `eventTimeMs` |
| `cs_inquiry` | `createdAt` | `string \| null` (raw) | **No** — raw string | parse `createdAt` → internal `eventTimeMs` |
| `claim` | `createdAt` (primary), `updatedAt` | `string \| null` (raw) | **No** — raw string | parse `createdAt` → internal `eventTimeMs` |
| `order_shipping` | `orderedAt` (primary), `updatedAt` | `string \| null` (raw) | **No** — raw string | parse `orderedAt` → internal `eventTimeMs` |
| `sales_context` | `periodStart`, `periodEnd` | `string \| null` (raw) | **No** — raw string + it's a *range*, not an instant | keep `unknown`; optionally parse `periodEnd` as an "as-of" later |

"Primary" = the field that best represents *when the event happened* for recency
purposes.

## Findings by kind

### review
- Type (`src/review/types.ts`): `writtenAt: string | null`, `updatedAt: string | null`.
- Normalizer (`review-normalizer.ts`): `writtenAt: trimOrNull(raw.writtenAt)`,
  `updatedAt: trimOrNull(raw.updatedAt)` — raw marketplace string, trimmed only.
- Sanitized summary exposes `hasWrittenAt: boolean` (no value).
- **Not safe** for `recencyBucketFor`. Primary recency source would be `writtenAt`.

### cs_inquiry
- Type: `createdAt: string | null`.
- Normalizer (`inquiry-normalizer.ts`): `createdAt: trimOrNull(raw.regDt)` — raw
  string passthrough from the marketplace `regDt`.
- Sanitized summary exposes `hasCreatedAt: boolean`.
- **Not safe.** Primary recency source would be `createdAt`.

### claim
- Type: `createdAt: string | null`, `updatedAt: string | null`.
- Normalizer (`claim-normalizer.ts`): `createdAt: trimOrNull(raw.regDt)`,
  `updatedAt: trimOrNull(raw.updateDt)` — raw string passthrough.
- Sanitized summary exposes `hasCreatedAt` / `hasUpdatedAt`.
- **Not safe.** Primary recency source would be `createdAt`.

### order_shipping
- Type: `orderedAt: string | null`, `updatedAt: string | null`.
- Normalizer (`order-normalizer.ts`): `orderedAt: trimOrNull(raw.orderDt)`,
  `updatedAt: trimOrNull(raw.updateDt)` — raw string passthrough.
- Sanitized summary exposes `hasOrderedAt` / `hasUpdatedAt`.
- **Not safe.** Primary recency source would be `orderedAt`.

### sales_context
- Type: `periodStart: string | null`, `periodEnd: string | null`.
- Normalizer (`sales-context-normalizer.ts`): both `trimOrNull(...)` — raw string
  passthrough.
- Sanitized summary exposes `hasPeriod: boolean` (true if either bound present).
- **Not safe**, and conceptually different: these are **period bounds**, not a single
  event instant. Recency for a sales-context row is ambiguous — recommend it stays
  `unknown` for now; if needed later, `periodEnd` could serve as a coarse "as-of"
  time, but only after the same safe-parsing boundary applies.

### envelope / sanitized-summary types
- `src/events/types.ts` (envelope) carries the per-kind event/summary unions; it adds
  no timestamp of its own.
- Across all sanitized summaries, timestamps appear **only** as `has*At` booleans —
  never a value. There is **no epoch-ms field** anywhere yet.

## Safety decision

- `recencyBucketFor` **stays epoch-ms only**. It must never be handed a raw
  marketplace date string.
- **Parsing must happen at a controlled adapter/normalizer boundary**, not in the
  scoring/summary/view layers.
- The **parsed epoch milliseconds stay internal** to the event (or its adapter); they
  are **never exposed** in sanitized summaries, views, logs, telemetry, or fixtures.
- Sanitized summaries may expose **only `recencyBucket`** (a coarse bucket), never the
  exact timestamp.
- If a timestamp is **missing / invalid / untrusted**, the bucket is **`unknown`**.

## Recommended Phase 2 boundary

Two options were evaluated:

**Option A — internal parsed timestamp on the normalized event (preferred).**
- Add an internal `eventTimeMs?: number` to each normalized event, populated by the
  normalizer (the existing boundary that converts raw platform data into safer
  internal shapes) by parsing the primary raw field (`writtenAt` / `createdAt` /
  `orderedAt`).
- Keep the existing raw string field as-is on the event, but **do not** expose it in
  sanitized summaries; the summary gains **only** `recencyBucket`.
- A safe parse failure → `eventTimeMs` absent → bucket `unknown`.
- Pro: parsing lives at the one boundary already responsible for normalization;
  scoring/summary/view layers stay parse-free and string-free.

**Option B — recency-extraction adapter near sanitized-summary generation.**
- Leave normalized events unchanged; add per-kind extractor functions near the
  sanitized-summary step.
- Con: parsing risks drifting into the summary layer, which is supposed to be
  derive-only; harder to keep the "no raw date parsing outside the normalizer"
  invariant.

**Preferred recommendation: Option A**, because the normalizer is already the
designated boundary for turning raw platform data into safe internal shapes. This is
a **recommendation only** — no implementation in this PR. (`sales_context` is the one
kind recommended to remain `unknown` regardless, given period-range ambiguity.)

## Deferred work

- Phase 2 parsing + `eventTimeMs` + sanitized `recencyBucket` field (the subject of
  this audit's recommendation — not implemented here).
- Phase 3 recency factor in `priorityScoreFor`.
- Phase 4 `attentionView` passthrough via the sanitized priority explanation.
- Exact SLA calculation, platform-specific **timezone handling** (raw strings may lack
  zone info — a parsing-correctness concern to resolve at the boundary), deduplication,
  clustering, AI summaries, backend endpoint, UI.

## Out of scope (now)

Live NAVER / ESM / browser / Playwright · AI calls / model prompts · timestamp parsing
or recency wiring **implementation** · normalizer/scoring/ranking/view changes ·
`Date.now` / `new Date` / `generatedAt` · credentials / seller IDs / Master ID / API
key / JWT · backend · DB · upload · RUN_INTEGRATION · real data. NAVER live work is
**paused**; ESM live/API/credential work is **deferred**.
