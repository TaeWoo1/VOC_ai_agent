# Reply-submission composer-abort — Run 3 dispatch record + body-link LIVE FINDING (EXECUTED)

> **Status: ✅ EXECUTED (2026-07-20) — a clean composer-abort, and a LIVE FINDING that changes the milestone premise.**
> Terminal `OPERATOR_REPORTED / SUBMISSION_ABORTED / UNVERIFIED`, `runId = run_535c358f1064`, channel `naver`,
> plan `GUIDED` (3/3), entry transition **`INLINE_COMPOSER`**.
> **Goal was to live-exercise the body-link → detail-page NAVIGATION entry ([D-034](decisions.md) caveat).
> Live evidence shows that entry does not navigate on this surface — see the finding below and [D-035](decisions.md).**

## Gates affirmed in the dispatching turn (PO, 2026-07-20)
Fresh, single-use, affirmed before the mutating run: **G2** to the write boundary · **G3** scope=`reply submission`
+ §9-3 pause lift · **reply-submission MUTATING G6** (channel NAVER, self-consent test store, operator = product
owner, §7 abort criteria, live window, write boundary) · **G4** (offline proof green: typecheck · full suite
3620 passed / 45 skipped · browser rung 11/11) · **G5** · **P6/P12** · explicit **"게이트 확인, seated and ready."**

## Target (privacy-safe metadata only)
Same review as Runs 1–2: **★1, negative, received 2026-02-01 KST (OLDER bucket), body ~502 chars, approved reply
draft v1 (~64 chars).** No raw body, raw reply text, external id, accountId, actionRef, or submissionRef printed.

## LIVE FINDING — the reply body/link entry opens an INLINE composer, NOT a detail-page navigation
The operator was asked to perform the **body-link navigation** entry: click the review body/link to open a
**detail page**. What actually happened, **operator-confirmed at the browser**:
- **No new tab opened**, and **the page URL did not change** — a reply composer appeared **inline** on the same
  surface.
- The entry-transition observer checks for a new tab (`NAV_NEW_TAB`) and a same-tab URL change (`NAV_SAME_TAB`)
  **before** the inline signal, and correctly reported **`INLINE_COMPOSER`**. This is not a misclassification —
  the surface produced no navigation.

**Conclusion.** On this NAVER SmartStore review surface, **the review-body/link reply action opens an inline
composer; there is no distinct detail-page reply composer to navigate to.** The `NAV_NEW_TAB` / `NAV_SAME_TAB`
observer branches remain in the code as **defensive support** for a surface that navigates, and are now
**deterministically unit-tested** (`test/cli/composer-abort-entry-transition.test.ts` covers all three transition
kinds + timeout + the `about:blank` guard + a `url()`-throws-mid-nav case) — but they were **not, and could not
be, live-exercised via the reply action on this surface**.

## What ran
Identical same-session flow to [Run 2](r4-reply-composer-abort-run2-dispatch-record.md): row calibrated + retained
+ highlighted (blue); operator performed the body-link entry (which opened the composer **inline**); runtime
observed `INLINE_COMPOSER`, retained + highlighted the composer read-only (green), showed the operator's OWN
approved draft in a separate read-only overlay; operator confirmed and **aborted** before any text/submit.
Terminal `SUBMISSION_ABORTED / UNVERIFIED` (3/3); backend outcome recorded (`recorded=true, replayed=false`).

## Exact limited claims (do NOT broaden)
**This run IS:** a **second clean operator-calibrated inline composer-abort** (non-mutating by construction),
**plus** the operator-confirmed **live finding** above.

**This run is NOT (unverified — not claimed):**
- **NOT** a live proof of the `NAV_NEW_TAB` / `NAV_SAME_TAB` (detail-page navigation) entry — that entry did not
  occur; it is **not live-reachable via the reply action on this surface**. The NAV branches are defensive +
  unit-tested only.
- **NOT** a cross-source fingerprint equality result (B1 stays `[EXT]`).
- **NOT** an end-to-end reply submission — nothing posted; terminal permanently `UNVERIFIED` ([D-032](decisions.md)(b)).

## Evidence
- Run summary (runId `run_535c358f1064`, status `OPERATOR_REPORTED`, operatorOutcome `SUBMISSION_ABORTED`,
  verification `UNVERIFIED`, entryTransition `INLINE_COMPOSER`, reachedComposerBarrier `true`, 3/3, channel naver).
- Local run-store record `.reply-runs/run_535c358f1064.json` (stage `OPERATOR_REPORTED`, mode `ABORT_REHEARSAL`,
  planKind `GUIDED`, parked=false).
- Backend `review_reply_outcome` row: `SUBMISSION_ABORTED / UNVERIFIED / run_535c358f1064`.
- Operator confirmation (browser): no new tab, no URL change — inline composer.
- No leak: no raw review text, no reply draft text, no selector, no accountId/actionRef/submissionRef, no secret
  crossed any sanitized output or log.

## Reconciliation note
Written on branch `feat/naver-body-link-composer-abort` (off `origin/main`). The Action Window status-of-record
lives in the `sellerops-r4-runtime` worktree; on merge, fold this record + [D-035](decisions.md) into that home.
