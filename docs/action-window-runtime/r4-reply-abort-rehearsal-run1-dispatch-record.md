# Reply-submission abort rehearsal — Run 1 dispatch record (EXECUTED)

> **Status: ✅ EXECUTED — the first successful supervised live NAVER reply abort rehearsal (2026-07-20).**
> Terminal `OPERATOR_REPORTED / SUBMISSION_ABORTED / UNVERIFIED`, `runId = run_b3e351d537b0`, channel `naver`.
> This is the row-match abort rehearsal only; the exact limited claims are enumerated below and must not be
> broadened. Supersedes the prior *composer-based* [abort-rehearsal dispatch
> record](../evidence/INDEX.md) for the executed path.

## Gates affirmed in the dispatching turn (PO, 2026-07-20)
A single escalation checkpoint before the mutating run, all fresh/single-use, affirmed by the product owner:
**G2** re-extended to the write boundary · **G3** scope=`reply submission` + §9-3 pause lift · **reply-submission
MUTATING G6** filled (channel NAVER, self-consent test store, operator = product owner, §7 abort criteria, max
live window, double-post precond, write boundary) · **G4** re-cited from the offline proof (full collector suite
+ browser rung green) · **G5** re-checked · **P6/P12** signed · explicit **"게이트 확인, seated and ready."**
(This is a record of a run that happened; it grants nothing for any future run.)

## Target (privacy-safe metadata only)
NAVER SmartStore review with `RESPONSE_NEEDED` triage **and** an `APPROVED` reply (v1), selected from the local
DB and operator-confirmed on the live list: **★1, negative, received 2026-02-01 KST (OLDER bucket), body ~502
chars.** No raw body, external id, accountId, actionRef, or submissionRef was printed at any point.

## What ran (same-session flow — `run-abort-rehearsal-live-naver.ts`)
One browser process, no reload, no persisted mapping, no whole-page signature:
1. Operator filtered the list (6개월 + ★1) so the target was visible, signalled ready.
2. Operator clicked the target review body **once** (capture-phase `preventDefault` — **nothing fired on NAVER**);
   the runtime **retained that exact element as an in-memory handle**.
3. Runtime minted a **fresh one-shot submissionRef** in memory (backend `requireTargetHint`), assembled the
   `ABORT_REHEARSAL` engine over a retained-element driver, and **highlighted the row read-only**.
4. Operator visually confirmed and **aborted** — no body/checkbox/toolbar click, no composer, no navigation.
5. Terminal `OPERATOR_REPORTED / SUBMISSION_ABORTED / UNVERIFIED`; outcome recorded on the backend
   (`POST …/reply/outcome`, `recorded=true`; a second POST returned `replayed=true` — idempotent).

## Exact limited claims (do NOT broaden)
**This run IS:** an **operator-calibrated row-match rehearsal, aborted before reply-entry/composer**, that is
**non-mutating by construction** (submit path structurally disabled in `ABORT_REHEARSAL`; the operator never
submitted). It proves the runtime can retain the operator's exact live target element in one session and outline
it read-only, and that the operator's abort yields the honest `SUBMISSION_ABORTED · UNVERIFIED` terminal, now
recorded server-side.

**This run is NOT (unverified — not claimed):**
- **NOT** a cross-source fingerprint equality result — the same-session flow ran **no** live-DOM↔stored-body
  fingerprint comparison (B1 remains an open `[EXT]` non-goal).
- **NOT** an end-to-end reply submission — nothing was posted to NAVER; the terminal is permanently `UNVERIFIED`
  (no read-back oracle, [D-032](decisions.md)(b)).
- **Highlight caveat:** the operator judged the highlighted target correct but noted the outline position was
  somewhat ambiguous (the executed run outlined the retained element; the highlight was **subsequently reworked**
  to resolve and outline the whole review row — a post-run improvement, not part of this run's evidence).

## Evidence
- Terminal view (runId `run_b3e351d537b0`, status/outcome/verification, channel naver).
- Local run-store record `.reply-runs/run_b3e351d537b0.json` (stage `OPERATOR_REPORTED`, mode `ABORT_REHEARSAL`,
  parked=false).
- Backend `review_reply_outcome` row: `operator_outcome=SUBMISSION_ABORTED`, `verification=UNVERIFIED`,
  `aw_run_ref=run_b3e351d537b0`.
- No leak: no raw review text, selector, or secret crossed any sanitized output.

## Reconciliation note
Written on branch `feat/naver-live-review-match-abort-rehearsal` (off `origin/main`). The Action Window
status-of-record lives in the `sellerops-r4-runtime` worktree; on merge, fold this record + the same-session
design lesson ([D-033](decisions.md)) into that home.
