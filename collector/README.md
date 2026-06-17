# SellerOps NAVER Review Collector — offline core POC

A separate automation-client slice (not part of the backend ingestion PR). This
directory currently holds the **offline core only**: the state model, the
session detector, and the SellerOps upload client — all exercised **without any
live NAVER automation and without a browser engine**.

## Why this exists

NAVER exposes no official review API, so reviews come from the official
seller-center Excel export. The product direction is a Local Collector Agent that
runs that export on a schedule inside the user's own authenticated browser
session. This POC proves the parts that can be proven offline first; the live
browser layer (Playwright `launchPersistentContext`) and a scheduler are
deliberately **not** here yet.

## Safety boundaries (enforced by design)

- Read/export only — no replies, no order mutations, no writes.
- No CAPTCHA bypass, no 2FA bypass, no login automation — a human always
  authenticates.
- No NAVER password and no NAVER cookies are stored or transmitted. (The live
  layer keeps the session only in a local browser profile dir; this offline core
  touches none of it.)
- Metadata-only logging — `src/log.ts` drops secret-ish keys and non-scalar
  values, so tokens/cookies/raw bodies cannot leak through logs.
- No fake success — `decideState` only yields `LAST_SUCCESS` when a file was both
  captured **and** uploaded.

## Layout

```
src/config.ts   env + local paths
src/log.ts      metadata-only logger (+ in-memory sink for tests)
src/status.ts   CollectorState + decideState() + writeStatus()
src/session.ts  detectSession() + signalsFromHtml() (browser-free)
src/upload.ts   login() / resolveChannelId() / uploadReviewFile()
src/cli/upload-file.ts   offline manual check: upload a local .xlsx to SellerOps
test/           vitest unit tests + one gated live-backend integration test
fixtures/       session HTML stand-ins (markers are PLACEHOLDERS, see below)
```

## Run

```bash
cd collector
npm install
npm test          # offline unit tests only (no backend, no browser)
npm run typecheck
```

### Offline manual check (needs the local SellerOps backend running)

```bash
cp .env.example .env   # SellerOps dev creds — NOT NAVER credentials
node --env-file=.env src/cli/upload-file.ts /absolute/path/to/review_export.xlsx
```

### Gated live-backend integration test (uploads + verifies dedup + item-analysis delta)

`NAVER_SAMPLE_XLSX` MUST be a **synthetic** NAVER-shaped export (fake rows, unique
`리뷰글번호` ids) — never a real seller-center export, since the file is ingested
into the local dev DB. No NAVER credentials / no live NAVER are involved.

```bash
RUN_INTEGRATION=1 NAVER_SAMPLE_XLSX=/tmp/synthetic_review.xlsx \
  SELLEROPS_BASE_URL=http://localhost:8080 npm test
```

It asserts: upload #1 → `successRows>0`, `failedRows=0`, and item-analysis count
rises by exactly `successRows`; upload #2 (same file) → `successRows=0`,
`skippedRows >= first.successRows`, and item-analysis count is unchanged.

## Not in this slice (next steps)

- Live browser layer: `profile.ts` / `navigate.ts` / `export.ts` (Playwright),
  and the milestone-1 export-mechanism discovery (sync blob vs async job). The
  session markers in `src/session.ts` are **placeholders to be confirmed** during
  that live run.
- Scheduler loop. Productization: pairing/collector token + signed upload URL,
  collector status/run-history endpoints. Packaging/signing/multi-OS.
