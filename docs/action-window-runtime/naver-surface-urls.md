# NAVER seller-center surface URLs

The routes the live NAVER runtime needs, recorded here because they were repeatedly supplied verbally and
repeatedly lost — a live run was blocked twice for want of one value that nobody had written down.

| purpose | env var | value |
|---|---|---|
| Review management / search — the review-export surface every guided review flow starts from | `NAVER_REVIEW_URL` | `https://sell.smartstore.naver.com/#/review/search` |

## Why this is safe to commit, and where it still may not go

It is a **public seller-center application route**. It carries no account, no store, no token, and no query
identifying anyone — the same class of fact as "the seller center is at sell.smartstore.naver.com". Committing
it removes a recurring blocker at no cost.

What does **not** change: raw URLs remain prohibited in sanitized runtime output. Connector results, logs,
probes and Action Window frames still never carry a URL (`docs/multi-channel-connector-roadmap.md` §9), and
the import boot logs only that navigation happened. A URL being publishable in a document does not make it
loggable at runtime — those are different boundaries and the rule is about the second one.

## Who reads it

Every live NAVER CLI requires `NAVER_REVIEW_URL` in the environment and refuses without it:

- `cli/local-agent.ts` — the approval-gated import mode, which opens this page at boot before announcing
  itself, then never navigates again (a run only ever *confirms* the surface);
- `cli/run-reply-submission-live-naver.ts`
- `cli/run-composer-abort-rehearsal-live-naver.ts`
- `cli/capture-export-same-session.ts`

Set it per environment (a shell export, or the gitignored `collector/.env`). **This repository's
`collector/` has no `.env`** — the logged-in profiles and env files live in `sellerops/runtime-holders/`,
which is preserved runtime state and is never read or copied from during development. So a run started from
this repo must be given the value explicitly.

## If a route changes

NAVER owns these paths and may change them. A changed route surfaces as a fail-closed
`UNSUPPORTED_STATE` from the surface probe, never as a silent wrong-page run. Correct the table from an
observed run — not from a guess — and say in the commit which run showed it.
