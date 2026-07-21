# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Scope: this file holds package-level rules for the `collector/` package
> (`@sellerops/collector`, Node/TypeScript). The repo root `../CLAUDE.md`
> holds repository-wide SellerOps rules (working directory, slice workflow,
> standing safety). **Both apply when working under `collector/`** — read the
> root doc for repo-wide workflow/safety and this doc for package architecture,
> sanitization, recency, and conventions.

---

## 1. What this is

The SellerOps **NAVER review collector** POC. NAVER exposes no official review
API, so reviews come from the seller-center Excel export. The product direction
is a Local Collector Agent that runs that export inside the user's own
authenticated browser session and uploads it to the SellerOps backend.

Two halves:

- **Offline core** — pure, browser-free, fully unit-tested logic: a run-state
  model, an HTML session detector, platform normalizers, a unified event model,
  and a sanitized attention/priority layer. This is the bulk of the code and
  needs no browser, no backend, no credentials.
- **Live export-discovery layer** (Playwright, under `src/naver/` + `src/cli/`)
  — human-attended, gated, run **only under explicit per-run operator
  approval**. It answers the two milestone-1 unknowns: can a persistent profile
  reach the export area in a valid human session, and is the export a **sync**
  download or an **async** job.

`docs/` holds the design spec for each slice (one `*-model.md` per layer); read
the relevant doc before changing a layer — it usually states the contract the
tests lock.

---

## 2. Commands

```bash
cd collector
npm install              # PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install to skip the browser binary
npm test                 # vitest run — offline unit tests only (no backend, no browser)
npm run typecheck        # tsc --noEmit
npm run test:watch       # vitest watch

# Single file / single test
npx vitest run test/events/recency-bucket.test.ts
npx vitest run test/events/recency-bucket.test.ts -t "future event is unknown"
```

`npm test` is hermetic: no network, no browser, `RUN_INTEGRATION` skipped. Both
`typecheck` and `test` must be green before any commit.

**Gated live-backend integration test** (uploads a *synthetic* xlsx, verifies
dedup + item-analysis delta — needs the local SellerOps backend up):

```bash
RUN_INTEGRATION=1 NAVER_SAMPLE_XLSX=/tmp/synthetic_review.xlsx \
  SELLEROPS_BASE_URL=http://localhost:8080 npm test
```

`NAVER_SAMPLE_XLSX` must be **synthetic** (fake rows, unique `리뷰글번호`) — it is
ingested into the dev DB. Never a real seller-center export.

**Live CLIs** (`tsx` entrypoints; all require the approval flag — see §4):

```bash
npm run discover -- --discover --classify-only --i-understand-this-opens-live-naver
npm run discover-same-session -- --i-understand-this-opens-live-naver   # recommended for NAVER Commerce; NO-CLICK classify (sync/async/unrecognized from structure only); never triggers/captures
npm run probe-session -- --i-understand-this-opens-live-naver           # sanitized DOM probe (separate launch)
npm run probe-same-session -- --i-understand-this-opens-live-naver      # READ-ONLY same-context verdict probe; sentinel-file continuation; no export/click/download
npm run probe-export-same-session -- --i-understand-this-opens-live-naver  # READ-ONLY frame-aware export-area probe (top doc + every child frame); same sentinel flow; no export/click/download
npm run classify-export-same-session -- --i-understand-this-opens-live-naver  # STRICT NO-CLICK export-layout classifier (sync/async/unrecognized from structure only); same sentinel flow; never triggers/captures
npx tsx src/cli/observe-api-center.ts --i-understand-this-opens-live-naver  # GUIDED-TUTORIAL ONLY API-center page-category observer (NAVER v1 onboarding); reads a SANITIZED page category to show the next tutorial step; NEVER logs in / issues / links / clicks / types / submits / autofills, and NEVER reads any value incl. Client ID / Secret; the seller creates/opens the app and copies Client ID/Secret manually
npm run upload -- /abs/path/to/export.xlsx                              # offline manual upload check (needs backend)
```

---

## 3. Architecture

### Offline core (`src/`)
- `config.ts` — `loadConfig(env)` → paths + SellerOps dev creds (never NAVER
  creds). Live paths (`profileDir`, `downloadDir`, `statusFile`) default under
  the collector tree; `naverReviewUrl` is unset until milestone 1.
- `log.ts` — metadata-only logger. `safeMeta` drops secret-ish keys
  (`token`/`password`/`cookie`/`authorization`/`secret`/`credential`/`session`)
  and collapses non-scalars to a type tag, so bodies/tokens cannot leak through
  logs. In-memory sink (`getLogSink`/`clearLogSink`) lets tests assert this.
- `status.ts` — `CollectorState` + the pure `decideState(RunSignals)` mapping.
  **Precedence is deliberate**: pairing → session stop-states → export → upload.
  `LAST_SUCCESS` is reachable **only** when a file was both captured *and*
  uploaded — a fake-success state is structurally impossible. The no-click
  classifier's `SYNC_DOWNLOAD_DETECTED` export outcome maps to the honest
  `EXPORT_SYNC_DETECTED` state (sync mechanism recognized but NOT triggered, so no
  file exists); it returns before the upload leg and can never become
  `COLLECTING`/`LAST_SUCCESS`. Only `CAPTURED` (a real triggered download) flows to
  the upload leg.
- `session.ts` — `detectSession()` / `signalsFromHtml()`: browser-free HTML →
  `SessionState` (`LOGGED_IN`/`LOGGED_OUT`/`AUTH_CHALLENGE`). Markers are
  **placeholders** to be confirmed/corrected by a live run.
- `upload.ts` — `login()` / `resolveChannelId()` / `uploadReviewFile()` against
  the SellerOps backend (`/api/uploads`).

### Event intelligence (`src/events/`, `src/esmplus/`, `src/review/`)
The data spine, all pure and offline:

`raw row → normalize → SellerOpsEvent (discriminated union) → sanitizedSummaryFor → attention signals → digest / priority score / attentionView`

- `esmplus/*-normalizer.ts` + `esmplus/types.ts` — ESM Plus order / inquiry /
  claim / sales-context normalizers. Each emits a `SellerOps*Event` plus a
  `Sanitized*Summary`.
- `review/review-normalizer.ts` + `review/types.ts` — cross-platform review
  normalizer (`SellerOpsReviewEvent`, `SanitizedReviewSummary`).
- `events/types.ts` — unifies all normalizers into one `SellerOpsEvent` union
  keyed on `kind` (`review | cs_inquiry | order_shipping | claim |
  sales_context`), plus the matching `SellerOpsSanitizedSummary` union.
- `events/sanitized-summary.ts` — `sanitizedSummaryFor(event, opts)` dispatches
  on `kind` with an **exhaustive `switch` guarded by `assertNever`** (a new
  kind that isn't handled is a compile error). Adds no new exposure; delegates
  to each normalizer's own sanitized summary.
- `events/attention-signals.ts` → `attention-digest.ts` → `priority-score.ts`
  (`priorityScoreFor`, single event) → `prioritize-events.ts` (`prioritizeEvents`,
  batch ranking) → `attention-view.ts` (`attentionView`, top-N). All derive from
  **sanitized summaries only**, never raw event content.
- `events/recency-bucket.ts` + `offset-timestamp-parser.ts` — coarse recency.
  `recencyBucketFor(eventTimeMs, referenceTimeMs)` is pure; the parser turns an
  explicit-offset timestamp string into epoch ms with **manual** calendar/offset
  arithmetic. Recency is mid-rollout: wired into the review summary only (Phase
  2c/2d); other kinds and the scoring/view passthrough are deferred.

### Connection layer (`src/connection/`)
A SellerOps account ↔ one NAVER store binding, above the run-level state.
`ConnectionStatus` (PENDING_USER_LOGIN … CONNECTED … ACCOUNT_MISMATCH …), a
drift `guard`, onboarding `workflow`, and a `registry`/`store`. **Privacy
invariant**: a connection never stores raw store/account identity — only a
one-way `boundStoreFingerprintHash` + a coarse `fingerprintSourceCategory`. See
`docs/connection-onboarding.md`.

### Live layer (`src/naver/`, `src/cli/`)
- `profile.ts` — `launchPersistentContext()` + a **path guard** that refuses any
  `profileDir` resolving outside the collector tree (unit-tested).
- `naver/session-check.ts` — live `Page` → `SessionSignals` → `detectSession()`.
- `naver/review-export.ts` — classify the export (`CAPTURED` / `ASYNC_JOB_DETECTED`
  / `LAYOUT_UNRECOGNIZED` / `DOWNLOAD_FAILED`) and capture. A **sync** download is
  recognized by finding an *interactive, visible+enabled* control whose accessible
  wording matches `EXPORT_WORDING` (`엑셀`/`다운로드`/`내려받기`/`excel`/`download`/
  `xlsx`/`csv`) via `findExportCandidates` → `buildTriggerSelectors`; an
  `ASYNC_JOB_MARKERS` affordance wins over it. The sync wording is **confirmed** —
  corrected from the milestone-1 live finding (top-document, visible+enabled
  Excel/download control; the old `[data-export='review']`-only selector missed it)
  and re-corroborated by `probe-export-same-session`. `ASYNC_JOB_MARKERS` stays a
  placeholder pending a live async run — correct it only from observed findings, per
  §6, never guess-tune.
- `naver/session-probe.ts` + `export-probe.ts` — sanitized structural probes
  (`extractProbeSignals` / `extractExportProbeSignals`) emitting only
  booleans/bucketed counts/category enums for diagnosing `SESSION_EXPIRED` and
  `LAYOUT_UNRECOGNIZED` without exposing any DOM content (hostile-fixture tests
  enforce no leakage). `ACCOUNT_RECONNECT_MARKERS` were **corrected from the Run-1
  sanitized finding**: the live Commerce reconnect screen shows a currently-logged-in
  account-continuation card (`현재 로그인 중인 …`) above an *alternate* login form, so
  `session-verdict.ts` guards the password rule (`passwordFieldPresent && !accountReconnect
  → ACCOUNT_LOGIN_REQUIRED`) to stop the alternate form masking the reconnect. Generic
  login-button phrases are deliberately not markers. `ASYNC_JOB_MARKERS` remain a placeholder
  pending a live async run — correct from observed findings only, per §6.
- `naver/export-classify.ts` — pure, no-click export-layout planner
  (`planExportAction`). Folds `review-export.ts`'s existing pure pieces
  (`classifyExportPage` / `findExportCandidates` / `buildTriggerSelectors`) into one
  sanitized `ExportActionPlan` (layout enum + actionable-candidate / trigger-selector
  count buckets + async-marker boolean) so the export mechanism can be classified
  **without** triggering it. Raw selectors are counted, never emitted; a purity
  source-guard test proves the module reaches no click/download/save path.
- `cli/discover-export.ts`, `cli/discover-same-session.ts`, `cli/probe-session.ts`,
  `cli/probe-same-session.ts`, `cli/probe-export-same-session.ts`,
  `cli/classify-export-same-session.ts` — live entrypoints, all
  gated by `cli/live-run-approval.ts`.
  `probe-same-session.ts` is a READ-ONLY diagnostic: it keeps one persistent-context
  lifetime (human logs in → creates the sentinel file printed by the probe → the SAME
  context reads the verdict) and is structurally separate from discovery — it never
  imports `review-export`/`runExport`, never clicks/captures an export, and writes no
  status file (source-guard test). The continuation is a sentinel file (not a terminal
  Enter, which the harness can't deliver); its path is derived by `cli/probe-sentinel.ts`
  (default `.status/probe-same-session.ready`), cleared at startup and after use.
  `probe-export-same-session.ts` is the same read-only one-context + sentinel flow but
  **frame-aware**: it runs the pure `extractExportProbeSignals` once per frame (top document
  + every child frame, via `page.frames()`) and folds them with `summarizeFrameExportProbes`,
  to locate *where* the export UI lives (iframe vs shadow DOM vs sub-route vs gated control
  vs marker mismatch) without ever clicking/downloading — same source-guard boundary, same
  shared sentinel path (run only one probe at a time).
  `classify-export-same-session.ts` is the same read-only one-context + sentinel flow and
  classifies the export **layout** (sync / async / unrecognized) via the pure
  `planExportAction` under a **strict no-click boundary**, writing no status record. It imports
  only the pure planner (never `review-export`/`runExport`), and its source-guard forbids
  `.click(`/`waitForEvent("download")`/`saveAs`/upload/`writeStatus`.
  Both discovery CLIs' classify-only paths are **also no-click**: `discover-same-session.ts`
  and `discover-export.ts --classify-only` each read the page the human reached and decide the
  layout via the same `planExportAction` — never clicking the control, never waiting for a
  download, capturing nothing. A recognized sync layout writes the honest `EXPORT_SYNC_DETECTED`
  state (mechanism detected, NOT triggered) — never `COLLECTING`, which would imply a captured
  file. `discover-export.ts` keeps importing `runExport` for its **full** capture path, so its
  no-click guarantee is proved by a *branch-separation* source-guard: `doDiscover` splits into
  `doDiscoverClassifyOnly` (no `runExport`/`.click(`/`waitForEvent("download")`/`saveAs`/upload)
  and `doDiscoverFullCapture`, and `runExport` is confined to the latter. The **only** path that
  actually triggers/captures the export is that deliberate full capture leg
  (`discover-export --discover` without `--classify-only`).

---

## 4. Non-negotiable safety model

These are enforced by code and tests — treat them as hard contracts, not
guidelines.

1. **Live NAVER runs require explicit, per-run operator approval.** Every live
   CLI refuses to act without the `--i-understand-this-opens-live-naver` flag
   (`cli/live-run-approval.ts`, pure + unit-tested). Never run a live action
   during planning or implementation, never on a schedule, never on standing
   authorization. A human always performs login / 2FA / CAPTCHA — the collector
   never types NAVER credentials and never bypasses auth. User-owned **test**
   seller account only. **Current standing state: NAVER live work is paused** —
   do not launch a browser, log in, or run discovery until the operator approves
   a specific run in a stable environment.
2. **Milestone-1 = discovery, not ingestion.** Run discovery `--classify-only`
   (alias `--no-upload`): classify the export mechanism with no SellerOps login,
   no channel resolve, no `/api/uploads`, no `saveAs` of a real file. The backend
   stays down. A real captured export is never uploaded or committed.
3. **Sanitization contract.** Sanitized summaries / signals / probes expose
   **only** categories, booleans, and coarse buckets — never raw content (review
   body/title/option, inquiry/claim text), reference codes, exact amounts/counts,
   identity (reviewer/buyer/seller/Master/account), tokens, raw URLs/HTML/
   screenshots, raw timestamps, internal `eventTimeMs`, or elapsed durations.
   No-leak sweeps in the tests assert this; keep them passing.
4. **Internal-only timestamps.** `eventTimeMs` on a normalized event is internal;
   it must never appear in any sanitized summary, signal, digest, view, log, or
   probe output.
5. **No fake success.** Don't add a path that yields `LAST_SUCCESS` without a
   real captured-and-uploaded file. Preserve `decideState`'s precedence.
6. **Placeholders stay honest.** Session/export markers are guesses pending a
   live run. Correct them from observed (sanitized) findings — never tune them
   speculatively, and don't claim a mechanism is confirmed until a run proves it.
7. **Product-boundary check — MANDATORY before every NAVER live run.** Approval
   to run live is not approval to act like the product. Answer all of these
   **in the dispatch, before launch**:
   1. Is this **product-path behavior** or a **one-off diagnostic exception**?
   2. Will the tool **click export, consent, download, submit, upload, or
      otherwise mutate platform state**?
   3. If yes — is that **supported v1 product behavior**?
   4. If not — the run must be **labeled a diagnostic exception**, the
      **human-driven product alternative must be stated**, and the user must
      **explicitly approve that exception in the grant**. A generic live grant
      does not cover it.
   5. **Default production NAVER review export is human-driven Action Window:**
      the user clicks export / consent / download **on NAVER**; SellerOps only
      **detects, validates, and processes the resulting download**.
   6. **Do not implement, wire, or present automatic export / consent / download
      as NAVER v1 behavior.**

   **B3 Run B (2026-07-20) is NOT precedent for product behavior** — it was a
   single supervised diagnostic exception taken to classify one artifact. **No
   further B3 live download probes.** See the §8 note in
   `docs/action-window-runtime/naver-smartstore-v1-plan.md`.

---

## 5. Conventions

- **ESM + strict TS.** `"type": "module"`, `target ES2022`, `strict` +
  `noUncheckedIndexedAccess`. Index access can be `undefined` — narrow with a
  length check + non-null (`const row = ranked[0]!;`) rather than blind
  indexing.
- **Pure leaf modules.** Logic modules take plain structured inputs and are
  browser/network/fs-free. Many (e.g. `recency-bucket.ts`,
  `offset-timestamp-parser.ts`) have **zero imports**. Keep shared types in leaf
  modules to avoid import cycles.
- **No wall-clock reads in the recency/event-time layer.** No `Date.now`,
  `new Date`, `Date.parse`, or `Date.UTC` in `events/recency-bucket.ts`,
  `offset-timestamp-parser.ts`, or the normalizers — reference time is always an
  explicit caller parameter (epoch ms); parsing uses a strict regex + manual
  calendar/offset math. (`log.ts` does use `new Date().toISOString()` for the log
  timestamp — that's the one intentional exception and is not part of this rule.)
- **Deterministic IDs.** When a row has no stable id, hash
  `JSON.stringify([...fields])` with SHA-256 and take the first 16 hex chars
  (the array form avoids NUL-separator ambiguity).
- **Coarse buckets only** for sanitized output: `amountBucket`, `ratingBucket`
  (low/mid/high/unknown), `RecencyBucket`
  (fresh_0_2h/same_day_2_24h/recent_1_3d/aging_3_7d/stale_over_7d/unknown).
- **Module-boundary tests are a pattern, not noise.** Several tests read a
  module's source and assert it imports no `fs`/`http`/`playwright` and contains
  no forbidden tokens. When scanning source for forbidden tokens, **strip
  comment lines first** (and check imports on import lines only) — prose
  mentioning `token`/`screenshot`/`Date`/`prioritizeEvents` has produced false
  failures before.

---

## 6. Git workflow (one slice = one PR)

> **NAVER SmartStore v1 phase override:** the "one slice = one PR" cadence below is
> **suspended until v1 is complete** — no push/PR/merge/rebase/remote sync/branch deletion
> until the single final v1 integration, and **no new local commits without an explicit
> user instruction** (do not optimize for tiny checkpoints). See root `CLAUDE.md`
> "Current phase". Standing safety (§4), sanitization, and the pre-commit suite are
> unchanged.

Development proceeds in small, approval-gated, offline-first slices:

- Each slice is a new branch off `sellerops/main`.
- Implement src + tests + docs for **one** slice, run the pre-commit suite
  (`git diff --check`, `typecheck`, `npm test`, confirm `package.json`/lock
  unchanged, forbidden-import/content grep, no NUL bytes, `file` text check),
  then **HOLD** before committing and report readiness. Commit only on an
  explicit commit instruction.
- **Stage exact files** — never `git add .`. Never stage `.env`, `.profile/`,
  `.status/`, `.connections/`, `downloads/`, `findings/*.local.md`, screenshots,
  raw HTML, exported files, or any credential/real data (all gitignored).
- Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Open **one** PR into `main`. Merge via a **normal merge commit** (`gh pr merge
  N --merge`) — never squash/rebase — then `git fetch origin` and fast-forward
  `sellerops/main` (`git merge --ff-only origin/main`). Re-verify
  `typecheck` + `test` + clean worktree after merging.

When an instruction says "recommend readiness" or "do not commit yet", HOLD
without committing.
