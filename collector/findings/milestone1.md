# Milestone 1 — NAVER review export discovery (CLOSEOUT)

> **Sanitized closeout.** Milestone-1 was a human-attended, **classify-only**
> discovery exercise: prove the export mechanism end-to-end without ingesting any
> real seller data. This file records only structural conclusions. It contains
> **no** store/account identity, no raw URL or URL with tokens, no raw filename,
> no row counts, no review text, no screenshots, no DOM dumps. Account-specific
> scratch notes (if any) live in `findings/*.local.md` (gitignored), never here.

## Status: complete

The full discovery chain was confirmed live, then closed without persisting,
uploading, or reading any real export contents.

## Confirmed mechanism

- **Export kind: synchronous download (`SYNC_DOWNLOAD`).** Pressing the review
  export trigger produces an immediate browser `download` event — there is no
  request → download-center → fetch job. No `ASYNC_JOB` path was exercised.
- **Single `확인` confirmation modal.** The export trigger opens one confirmation
  modal. Auto-confirm is deliberately limited to the **`확인`** affordance only.
  The collector never clicks `취소` / `닫기` / `cancel` / `close`, and never
  auto-confirms `동의` / `계속` / a bare `다운로드` label.
- **Class-based modal selector shape.** The confirmation modal is a class-based
  layer (Bootstrap/AngularJS-style), not a `role="dialog"` / `aria-modal`
  element. The confirm control is reached by scoping into the modal container and
  selecting the primary action button inside the footer
  (shape: `<modal-scope> <footer-scope> button.<primary-class>:has-text("확인"):not([disabled])`),
  with role/aria-scoped and global `확인`-text selectors as ordered fallbacks.
  Cancel/close wording is excluded from candidate matching.
- **Output format: Excel.** The captured download's suggested-filename extension
  classified as `xlsx` (category only — the raw filename is never logged).
- **Classify-only completion wait.** In classify-only mode the collector waits for
  the download stream to **complete** (resolving the Playwright download path)
  before closing the browser, so completion vs. failure is known deterministically
  and the browser does not close mid-stream. It then stops: **no `saveAs`, no
  persistence to `downloads/`, no upload, no row parsing, no file-content read.**

## Session / navigation findings

- The persistent local browser profile, after a **human** completed login (and
  any 2FA / CAPTCHA manually), reached the SmartStore Center review/export area
  with the session check reporting `LOGGED_IN`.
- No login, 2FA, CAPTCHA, or account/store selection was automated at any point;
  the human performed all of those.

## Final-state behavior (classify-only)

- A completed classify-only run resolves to `COLLECTING` (a captured-but-not-
  uploaded outcome). `LAST_SUCCESS` is structurally impossible in classify-only
  because no upload leg runs — see `decideState` in `src/status.ts`.

## What was deliberately NOT done in milestone-1

- No real export file saved, persisted, uploaded, or parsed.
- No review rows, customer data, or PII read or logged.
- No raw store name, account name, URL, filename, path, HTML, or screenshot
  recorded anywhere committable.

## Recommendation for milestone 2

The export mechanism is proven and stable enough to productize. The next step is
**not** another live discovery run but a design pass for connection onboarding and
account binding (see `docs/connection-onboarding.md`), followed — as a separate,
explicitly approved step — by validating the upload/parse path against a
**synthetic** NAVER-shaped `.xlsx` (fake rows, unique ids) via the existing
`RUN_INTEGRATION` test. The real captured export is never used for that.
