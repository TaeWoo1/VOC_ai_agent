# Reply-submission composer-abort rehearsal — Run 2 dispatch record (EXECUTED)

> **Status: ✅ EXECUTED — the first supervised live NAVER reply abort rehearsal to reach the COMPOSER barrier (2026-07-20).**
> Terminal `OPERATOR_REPORTED / SUBMISSION_ABORTED / UNVERIFIED`, `runId = run_6ca0d6b71e2d`, channel `naver`,
> plan `GUIDED` (3/3 steps), entry transition `INLINE_COMPOSER`.
> This advances [Run 1](r4-reply-abort-rehearsal-run1-dispatch-record.md) — which aborted at the *row* barrier
> before any composer — to an abort at the *composer* barrier. The exact limited claims below must not be
> broadened. See [D-034](decisions.md).

## Gates affirmed in the dispatching turn (PO, 2026-07-20)
A single escalation checkpoint before the mutating run, all fresh/single-use, affirmed by the product owner:
**G2** re-extended to the write boundary · **G3** scope=`reply submission` + §9-3 pause lift · **reply-submission
MUTATING G6** (channel NAVER, self-consent test store, operator = product owner, §7 abort criteria, max live
window, write boundary) · **G4** re-cited from the offline proof (typecheck clean · full collector suite
3613 passed / 45 skipped · browser rung 11/11) · **G5** re-checked · **P6/P12** signed · explicit
**"게이트 확인, seated and ready."** (This records a run that happened; it grants nothing for any future run.)

## Target (privacy-safe metadata only)
The single NAVER SmartStore review with `RESPONSE_NEEDED` triage **and** an `APPROVED` reply (v1), selected from
the local DB and operator-confirmed on the live list: **★1, negative, received 2026-02-01 KST (OLDER bucket),
body ~502 chars, approved reply draft v1 (~64 chars).** No raw review body, raw reply text, external id,
accountId, actionRef, or submissionRef was printed at any point. (Same review as Run 1.)

## What ran (same-session composer flow — `run-composer-abort-rehearsal-live-naver.ts`)
One browser process, no reload, no persisted mapping, no whole-page signature:
1. Operator filtered the list (6개월 + ★1) so the target was visible, and confirmed readiness on the LIST.
2. Operator clicked the target review body **once** (capture-phase `preventDefault` — **nothing fired on
   NAVER**); the runtime **retained that exact element** and highlighted the review **row** read-only (blue).
3. Runtime minted a **fresh one-shot submissionRef** (backend `requireTargetHint`, `reply.submissionRun.ok`).
4. Operator performed **their own entry** into the composer — the **checkbox + toolbar reply** path — opening an
   **inline composer**. The runtime **observed the transition** (`INLINE_COMPOSER`: a generic composer candidate
   appeared over the baseline) and re-acquired the active page. **The runtime did not click or navigate.**
5. Operator clicked the reply **composer once** (capture-phase `preventDefault` — **nothing fired on NAVER**);
   the runtime **retained that exact element** and highlighted the **composer** read-only (green).
6. Runtime read the operator's OWN approved draft (`reply.draft.fetched hasDraft:true approved:true`) and showed
   it in a **separate SellerOps read-only overlay** (`pointer-events:none`, `textContent`) — **nothing was typed
   or pasted into the composer**.
7. Operator visually confirmed the green composer highlight + the read-only draft overlay, and **aborted** —
   before any text was entered or submitted.
8. Terminal `OPERATOR_REPORTED / SUBMISSION_ABORTED / UNVERIFIED` (progress 3/3); outcome recorded on the backend
   (`POST …/reply/outcome`, `recorded=true, replayed=false` — idempotent by `commandId`).

## Exact limited claims (do NOT broaden)
**This run IS:** an **operator-calibrated same-session composer-abort rehearsal**, that is **non-mutating by
construction** (the submit terminal is structurally unreachable in `ABORT_REHEARSAL`; the operator never
submitted). It proves the runtime can, in one session, retain **two** operator-designated live elements (the
review row anchor **and** the reply composer), **observe the operator's own entry transition** into the composer,
highlight the composer read-only, show the seller's OWN approved draft **read-only** (never pasting it), and that
the operator's abort at the composer barrier yields the honest `SUBMISSION_ABORTED · UNVERIFIED` terminal, now
recorded server-side.

**This run is NOT (unverified — not claimed):**
- **NOT** a cross-source fingerprint equality result — the same-session flow ran **no** live-DOM↔stored-body
  fingerprint comparison (B1 remains an open `[EXT]` non-goal).
- **NOT** an end-to-end reply submission — nothing was posted to NAVER; the terminal is permanently `UNVERIFIED`
  (no read-back oracle, [D-032](decisions.md)(b)).
- **Entry-strategy caveat:** only the **`INLINE_COMPOSER`** entry (checkbox + toolbar reply) was **live-exercised**
  this run. The **body-link → detail-page navigation** path (`NAV_NEW_TAB` / `NAV_SAME_TAB`) is **supported in
  code** and observed generically, but was **not** live-exercised here.
- **No layout-generality claim:** the composer highlight + overlay were operator-confirmed correct on this SPA;
  there is no claim the resolution generalizes to other NAVER composer layouts.

## Evidence
- Run summary (runId `run_6ca0d6b71e2d`, status `OPERATOR_REPORTED`, operatorOutcome `SUBMISSION_ABORTED`,
  verification `UNVERIFIED`, entryTransition `INLINE_COMPOSER`, reachedComposerBarrier `true`, progress 3/3,
  channel naver).
- Local run-store record `.reply-runs/run_6ca0d6b71e2d.json` (stage `OPERATOR_REPORTED`, mode `ABORT_REHEARSAL`,
  planKind `GUIDED`, parked=false).
- Backend `review_reply_outcome` row: `operator_outcome=SUBMISSION_ABORTED`, `verification=UNVERIFIED`,
  `aw_run_ref=run_6ca0d6b71e2d`.
- No leak: no raw review text, no reply draft text, no selector, no accountId/actionRef/submissionRef, and no
  secret crossed any sanitized output or log (the draft was shown only in the in-page read-only overlay).

## Reconciliation note
Written on branch `feat/naver-reply-entry-composer-abort` (off `origin/main`). The Action Window
status-of-record lives in the `sellerops-r4-runtime` worktree; on merge, fold this record + [D-034](decisions.md)
into that home.
