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
temporary artifact is discarded when the context closes. This describes the
`discover-export --classify-only` path, which still *clicks* the control to prove
the download fires. The recommended `discover-same-session` path is **stricter — no
click at all**: it classifies the layout from structure and records a recognized
sync mechanism as `EXPORT_SYNC_DETECTED` without ever triggering it (see its section
below).

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
gitignored); it is never serialized or sent. The **session** markers in
`src/session.ts` (and the async-job markers in `src/naver/review-export.ts`)
remain **placeholders to confirm** during an approved live run, recorded
(sanitized — no customer data, no store identity) in `findings/milestone1.md`.
The **sync export** wording in `src/naver/review-export.ts` is no longer a
placeholder: it was confirmed against the milestone-1 live finding (an
interactive, visible+enabled `엑셀`/`다운로드` control in the top document) and
re-corroborated by `probe-export-same-session`.

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

### Same-session discovery (recommended for NAVER Commerce)

The separate `--login` → quit Chrome → later `--discover` flow does **not** work
for NAVER Commerce: the NAVER-ID login persists (the "logged-in account" card
shows), but the **SmartStore Center / commerce-admin session is not re-entered
automatically** when Chrome restarts — a fresh launch on the review route
redirects to login, so discovery always lands `SESSION_EXPIRED` (confirmed by the
sanitized probe: `urlCategory:"login"` with the SPA fully hydrated). The fix is to
stay in **one persistent-context lifetime**:

```bash
set -a && . ./.env && set +a    # load NAVER_REVIEW_URL + COLLECTOR_BROWSER_CHANNEL
npm run discover-same-session -- --i-understand-this-opens-live-naver
```

Flow (`src/cli/discover-same-session.ts`):

1. Launches installed Chrome (`COLLECTOR_BROWSER_CHANNEL=chrome`) with the
   dedicated profile (`collector/.profile/naver`) and `chromiumSandbox: true`,
   and opens `NAVER_REVIEW_URL`.
2. You complete the **NAVER-ID login, any 2FA/CAPTCHA, and click the commerce-ID
   card to enter the actual SmartStore Center admin screen** — in that same
   window. The collector never types credentials and never bypasses auth.
3. You return to the terminal and **press Enter** (a 10-minute timeout aborts
   safely as `SESSION_EXPIRED` if you don't). **Do not close the browser.**
4. The **same context** re-navigates to the review route, waits for the SPA to
   settle, checks the session, and — if logged in — classifies the export
   **layout** from the rendered structure via the pure `planExportAction`.

It is **classify-only and strictly NO-CLICK**: it never clicks the export control,
never waits for a download, captures nothing — no SellerOps login/channel resolve,
no `/api/uploads`, no backend, no DB, and **no `saveAs`**. A recognized sync layout
is recorded as **`EXPORT_SYNC_DETECTED`** (the mechanism is detected but **not
triggered**, so no file exists) — never `COLLECTING`, which would imply a captured
file; `LAST_SUCCESS` is structurally impossible. (`async` → `EXPORT_ASYNC_JOB_DETECTED`,
unrecognized → `EXPORT_LAYOUT_CHANGED`.) A real triggered download only happens in
the `discover-export` capture path. Logs are metadata-only.

Add `--emit-session-probe` to diagnose a same-session run that still reports
`SESSION_EXPIRED` even though you reached the admin screen:

```bash
npm run discover-same-session -- --i-understand-this-opens-live-naver --emit-session-probe
```

When set, the flow logs the sanitized `extractProbeSignals` snapshot
(booleans / buckets / categories — **no HTML, page text, raw URL, or PII**) at
three points: **after you press Enter but before re-navigation**, **after
re-navigation + SPA settle but before the session check**, and **after the check
if still logged-out**. Comparing the pre- vs post-re-navigation snapshots tells us
whether the logged-in markers are simply wrong (absent in both) or the re-navigation
is resetting the SPA (present before, gone after). Off by default — without the
flag the flow emits no probe diagnostics and behaves exactly as before.

Add `--emit-export-probe` to diagnose the *next* failure mode: a run that now
passes the session gate (`LOGGED_IN`) but classifies the export area as
`EXPORT_LAYOUT_CHANGED` / `LAYOUT_UNRECOGNIZED` (what the last live run showed,
with `exportCandidateCount:"none"`). It is used **after** the session passes but
the export UI is unrecognized — observation first, **not** selector guessing
(`review-export.ts` is left untouched):

```bash
npm run discover-same-session -- --i-understand-this-opens-live-naver --emit-export-probe
```

When set, the flow logs the sanitized `extractExportProbeSignals` snapshot
(`src/naver/export-probe.ts`) at two points: **on the confirmed logged-in page
just before classification**, and **again if the classifier returns
`LAYOUT_UNRECOGNIZED`**. Output is **sanitized structural signals only** — a fixed
set of booleans / bucketed counts / category enums (and frame URL *categories*,
never raw frame URLs). No field copies input text, so a store name, account,
product, review text, id, token, label, selector, or raw URL can never appear.
This is enforced by an offline hostile-fixture test. The probe **does not** save
screenshots/HTML, dump page text, upload, call `/api/uploads`, start the backend,
mutate the DB, or change `review-export.ts`. Off by default; independent of
`--emit-session-probe` (you can pass either, both, or neither).

The signals are chosen to separate the three causes of a `LAYOUT_UNRECOGNIZED`
verdict:

- **Missing selector** — `excelLike` / `downloadLike` / `exportLike` true (and/or
  a non-zero `exportCandidateCount`) on the main document: an export affordance
  *is* here; `review-export.ts`'s placeholder markers just don't match it.
- **Hidden / gated UI** — keyword present but `enabledExportCandidateCount:"none"`
  (with a non-zero total) and/or a non-zero `disabledControlCount` plus date/search
  filters: the export is gated behind a prior search/date-range step.
- **Iframe / sub-route** — export keywords absent on the main document but
  `iframeCount` non-zero and/or `frameUrlCategories` showing another context: the
  export UI lives in a child frame or a different route.

Emitted fields: `urlCategory`, `reviewRouteLike`, `iframeCount`, `buttonCount`,
`anchorCount`, `roleButtonCount`, `disabledControlCount`, `downloadAttributeCount`,
`dateInputCount`, `tableGridListCount`, `excelLike`, `downloadLike`, `exportLike`,
`csvOrXlsxLike`, `reviewLike`, `searchLike`, `frameUrlCategories`,
`shadowRootHostCount`, `exportCandidateCount`, `visibleExportCandidateCount`,
`enabledExportCandidateCount`. Count-like fields are buckets
(`none`/`one`/`few`/`some`/`many`); live-only fields (frames, shadow roots,
visible/enabled candidate counts) are `unknown`/empty when run offline.

## Not in this slice (next steps)

- Async-job **download follow-through** (this slice only *detects*
  `EXPORT_ASYNC_JOB_DETECTED`; it does not poll/download an async export).
- Scheduler / recurring collection loop.
- Productization: pairing/collector token + signed upload URL, collector
  status/run-history endpoints. Packaging/signing/multi-OS. Managed cloud
  collector.
