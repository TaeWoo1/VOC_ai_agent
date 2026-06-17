# SellerOps NAVER Review Collector — offline core POC

A separate automation-client slice (not part of the backend ingestion PR). It
holds the **offline core** (state model, session detector, SellerOps upload
client — all exercised without any browser) plus a **live export-discovery
layer** (Playwright). The offline test suite needs no browser; the live layer is
human-attended and runs **only under explicit, per-run operator approval**.

## Why this exists

NAVER exposes no official review API, so reviews come from the official
seller-center Excel export. The product direction is a Local Collector Agent that
runs that export inside the user's own authenticated browser session. The offline
core proves the parts provable without a browser; the live layer answers the two
gating unknowns — can a persistent profile reach the export area in a valid human
session, and is the export a sync download or an async job. A scheduler/recurring
collection and async-job download follow-through are deliberately **not** here
yet.

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
src/profile.ts  launchPersistentContext() wrapper + profile-dir path guard (LIVE)
src/naver/session-check.ts  live Page -> SessionSignals -> detectSession()
src/naver/review-export.ts  classify export (sync/async/unknown) + capture (LIVE)
src/cli/upload-file.ts      offline manual check: upload a local .xlsx to SellerOps
src/cli/discover-export.ts  LIVE export discovery (--login / --discover); gated
test/           vitest unit tests + one gated live-backend integration test
fixtures/       session + export HTML stand-ins (markers are PLACEHOLDERS, see below)
findings/       milestone1.md — static template; real findings only after a live run
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

### Live export discovery (requires explicit per-run operator approval)

`npm run discover` drives a **real browser** against NAVER seller-center to answer
milestone 1. It is human-attended and must run **only when an operator explicitly
authorizes that single run** — never during planning/implementation, never on a
schedule. A human performs the login and any 2FA/CAPTCHA; the collector never
types NAVER credentials, never bypasses auth, and never writes to NAVER. Use a
**user-owned test seller account** only.

The CLI **refuses every live action** unless the explicit approval flag
`--i-understand-this-opens-live-naver` is passed — a bare `--login`/`--discover`
fails fast with a message stating what a live run entails. The gate is a pure
function (`src/cli/live-run-approval.ts`) covered by offline tests.

**Milestone-1 = discovery, not ingestion.** Run `--discover` with
`--classify-only` (alias `--no-upload`): the collector classifies the export
mechanism (sync download / async job / blocked / layout-unrecognized) but does
**not** upload anything to SellerOps. In classify-only mode there is **no
SellerOps login, no channel resolve, no `/api/uploads` call**, so the
`SELLEROPS_*` / `NAVER_CHANNEL_CODE` settings are unused and **the backend does
not need to be running**. `LAST_SUCCESS` is structurally impossible in this mode
(a captured sync export maps to `COLLECTING`, never success — discovery is not
collection). On a sync export the file is **not** persisted (no `saveAs`); the
mechanism is proven by the Playwright download event alone, and the browser's
temporary artifact is discarded when the context closes.

**Recommended for NAVER: use installed Chrome, not bundled Chromium.** Set
`COLLECTOR_BROWSER_CHANNEL=chrome` so the live layer drives your **installed
Google Chrome** (via Playwright's `channel: "chrome"`) instead of the bundled
Chromium. A mainstream Chrome fingerprint is less likely to trip NAVER account
security than the automation-oriented Chrome-for-Testing build. This still uses
the **dedicated SellerOps profile** at `collector/.profile/naver` — **never your
personal Chrome profile** — so your normal Chrome sessions/data are untouched,
and the profile-dir path guard still forbids any dir outside the collector tree.
Leave it unset/blank to fall back to bundled Chromium. It changes only which
browser binary launches; classify-only / no-upload behavior is unchanged.

The browser launches with the **Chromium sandbox enabled** (`chromiumSandbox:
true`), so Chrome does **not** show the "unsupported command-line flag
(--no-sandbox)" security warning. This is purely how the browser is launched —
no change to the dedicated profile or to classify-only / no-upload behavior.

```bash
cp .env.example .env                 # set NAVER_REVIEW_URL for --discover
# Recommended for milestone-1: drive installed Chrome with the dedicated profile
echo 'COLLECTOR_BROWSER_CHANNEL=chrome' >> .env
npm run discover -- --login    --i-understand-this-opens-live-naver   # headed browser; human logs in

# Milestone-1: classify only, no upload, backend down
npm run discover -- --discover --classify-only --i-understand-this-opens-live-naver

# Full capture→upload path (requires the local backend) — NOT milestone-1
npm run discover -- --discover --i-understand-this-opens-live-naver
```

The NAVER session lives **only** in the local profile dir (`.profile/naver`,
gitignored); it is never serialized or sent. The session/export markers in
`src/session.ts` and `src/naver/review-export.ts` are **placeholders to be
confirmed** during the approved live run, then recorded (sanitized — no customer
data, no store identity) in `findings/milestone1.md`.

In the **full** (non-classify-only) path, captured files land in `downloads/`
(gitignored) and are uploaded through the same `/api/uploads` path the offline
core uses. **Milestone-1 must not upload or commit a real captured export.** If a
real file is ever written to `downloads/`, it stays gitignored and must be
deleted/handled manually after the run — never committed.

### Debug-safe session probe (live-gated diagnostic)

When classify-only discovery keeps reporting `SESSION_EXPIRED` on a page you know
is logged in, the cause is usually the placeholder session markers and/or SPA
hydration timing (the review route is a client-rendered SPA, so `page.content()`
right after `domcontentloaded` is an un-hydrated shell). `src/cli/probe-session.ts`
helps confirm what the real logged-in DOM looks like **without exposing any
sensitive content**:

```bash
set -a && . ./.env && set +a    # load NAVER_REVIEW_URL + COLLECTOR_BROWSER_CHANNEL
npm run probe-session -- --i-understand-this-opens-live-naver
```

- **Sanitized structural signals only.** It prints a fixed JSON object of
  booleans / bucketed counts / category enums (`extractProbeSignals` in
  `src/naver/session-probe.ts`) — e.g. `urlCategory`, `documentReadyState`,
  `htmlLengthBucket`, `appRootChildCount` (bucket), `candidateLoggedInShellPresent`,
  `exportCandidateCount` (bucket), `hydrationWaitResult`. No field copies input
  text, so a store name, account, product, review text, id, token, or raw URL can
  never appear in the output. This is enforced by an offline hostile-fixture test.
- **It does NOT** save screenshots, save raw HTML, dump page text, upload
  anything, call `/api/uploads`, start the backend, or mutate the DB.
- **Live-gated** behind the same `--i-understand-this-opens-live-naver` flag and
  the same installed-Chrome + dedicated-profile + sandbox launch path as
  discovery.
- Used only to **correct the session-detection markers (`src/session.ts`) and the
  SPA-wait logic** before retrying discovery.

## Not in this slice (next steps)

- Async-job **download follow-through** (this slice only *detects*
  `EXPORT_ASYNC_JOB_DETECTED`; it does not poll/download an async export).
- Scheduler / recurring collection loop.
- Productization: pairing/collector token + signed upload URL, collector
  status/run-history endpoints. Packaging/signing/multi-OS. Managed cloud
  collector.
