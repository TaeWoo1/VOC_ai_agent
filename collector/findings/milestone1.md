# Milestone 1 — NAVER review export discovery (TEMPLATE)

> **Static template — no live findings.** Fill this in **only after** a separately
> approved live discovery run (`discover-export --discover`). Do not record real
> selectors, URLs with tokens, account identifiers, or customer data here; commit
> only the structural conclusions below. Account-specific scratch notes belong in
> `findings/*.local.md` (gitignored), not in this file.

## Run context

- Date (approved live run):
- Account type: user-owned test seller account (no production/customer account)

## Gating unknown #1 — scripted navigation in a human session

- Could the persistent profile reach the review-management/export area while
  `session-check` reported `LOGGED_IN`? (yes / no)
- Did navigation trip auth / 2FA / CAPTCHA / anti-automation? (state observed:
  `SESSION_EXPIRED` / `ACTION_REQUIRED_FOR_2FA_OR_CAPTCHA` / none)

## Gating unknown #2 — export mechanism

- Classified kind: `SYNC_DOWNLOAD` / `ASYNC_JOB` / `UNRECOGNIZED`
- If sync: did Playwright capture the `download` event? (yes / no)
- If async: where does the file land (download center / list), and what would a
  follow-up poll need to do? (description only — no polling built in this slice)

## Selector / URL stability (replaces the PLACEHOLDER markers)

- Confirmed review/export page URL shape (no query tokens):
- Confirmed logged-in marker(s) (to update `src/session.ts`):
- Confirmed export-trigger selector (to update `src/naver/review-export.ts`):
- Confirmed async-job / download-center marker(s):

## Failure-state behavior observed

- On layout drift: `EXPORT_LAYOUT_CHANGED` (confirmed / not reached)
- On download failure: `DOWNLOAD_FAILED` (confirmed / not reached)

## Recommendation for milestone 2

- (Feasibility verdict + smallest next step — capture-on-schedule vs async-poll.)
