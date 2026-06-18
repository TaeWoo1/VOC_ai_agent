# Review signal model & collection strategy (offline)

> **Offline spec layer — no live collection.** No live NAVER, no live ESM, no
> browser, no Playwright, no credentials, no real review data exist or are modeled
> here. This defines the normalized review shape and the *strategy* future platform
> collectors will follow — not the collectors themselves.

## Why reviews

Reviews are SellerOps' **core differentiation axis**. Inquiries create daily usage,
and claims/orders/sales are context for priority and risk — but reviews are where
SellerOps' VOC intelligence is differentiated. The review signal model is therefore
the shape every platform collector eventually outputs into, so downstream AI tasks
consume **one** normalized stream regardless of source.

## Normalized review shape

A pure normalizer maps a raw (synthetic) review row to the common
`SellerOpsReviewEvent` (`src/review/types.ts`, `src/review/review-normalizer.ts`):

- **Carries** (VOC value): `eventId`, `platform`
  (NAVER / ESM_PLUS / CAFE24 / COUPANG / UNKNOWN), `kind: "review"`, `channel`,
  `productRef`, `orderRef`, `reviewRef`, `rating`, `title`, `body`, `optionText`,
  `writtenAt`, `updatedAt`, `replyStatus` (not_replied / replied / unknown),
  `collectionMethod`.
- **Drops** (identity/PII): reviewer name, buyer id / phone / email / address,
  account id, seller id, master id — accepted in the raw shape, never mapped.
- **Has no mapping path for** raw capture artifacts: raw URL, raw HTML, screenshot,
  token. These are not fields on the typed raw shape.
- **Optional-safe**: missing fields → `null` / `unknown`.
- **Deterministic `eventId`**: `review:<platform>:<channel>:<reviewRef>` when a
  review reference exists; otherwise a `JSON.stringify`-based SHA-256 content hash
  (`review:<platform>:<channel>:h:<hash>`) over non-PII fields. No NUL separators.

`sanitizedReviewSummary` is the log-safe view — `platform`, `kind`, `channel`,
`ratingBucket` (low / mid / high / unknown), `hasProductRef`, `hasReviewRef`,
`hasBody`, `hasOptionText`, `hasWrittenAt`, `replyStatus`, `collectionMethod`. It
**never** includes the review body/title/option, **never** product/review/order
reference codes, and **never** any identity. The exact rating is reduced to a coarse
bucket (1~2 low, 3 mid, 4~5 high, else unknown).

## Collection strategy — multi-track

Review API availability is **platform-specific**. The strategy is multi-track, in
preference order, recorded per event as `collectionMethod`:

1. **`official_api`** — preferred wherever a platform exposes a review API.
2. **`official_export`** — a platform-provided review export (e.g. a file the seller
   console generates) where no live API exists.
3. **`browser_export`** — a **user-consented, human-assisted** browser/export
   fallback, only where neither official API nor official export is available.
4. **`manual_upload`** — the seller uploads a review file they obtained themselves;
   the universal fallback.

For reviews specifically, **browser/export fallback is planned where an official API
is unavailable** — but it is not implemented in this branch, and never bypasses the
safety rules below.

## Safety rules (NAVER-style discipline)

Any browser/export-assisted review collection follows the same discipline as the
NAVER connection work (see `connection-onboarding.md`):

- **User consent** — collection happens only with the seller's explicit consent.
- **Human login** — the operator authenticates in the browser; SellerOps never
  handles the password.
- **No CAPTCHA / 2FA bypass.**
- **No automatic account / store selection** — the human chooses.
- **Sanitized logs / signals** — coarse categories and booleans only; no raw URLs,
  tokens, HTML, screenshots, or PII.
- **No automatic reply posting** — replies are draft-only, human-approved (initially
  no write-back to the platform at all).

## How reviews feed AI tasks

The normalized review stream is the input to SellerOps' AI leverage points:

- **Sentiment / issue classification** — per review, what kind of problem.
- **Repeated-complaint extraction** — clustering recurring issues across reviews.
- **Product improvement insight** — turning clusters into actionable product/ops
  signals.
- **Reply draft generation** — drafts for the seller to approve; **no auto-posting**.
- **Priority scoring** — combining review signals with **inquiry / claim / sales
  context** (the order/claim/sales-context normalizers) to surface *what needs
  attention today*.

## Out of scope (now)

Live NAVER / ESM / browser / Playwright · credentials / seller IDs / Master ID /
API key / JWT · backend · DB · upload · RUN_INTEGRATION · real review data · live
collection of any kind. NAVER live work is separately **paused**; ESM live/API/
credential work is **deferred**.
