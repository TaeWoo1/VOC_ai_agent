# Run 5 — barrier + observation dispatch record (NOT AUTHORIZED · grants nothing)

> **This file authorizes no live NAVER contact.** It is the choreography and evidence sheet for a run
> that must be authorized elsewhere: a **fresh, single-use, Run-5-scoped G6** recorded in the
> dispatching turn ([`r4-gate-record.md`](r4-gate-record.md)). **Every G6 to date is CONSUMED.**
> **The boundary** is [`r4-preparation.md`](r4-preparation.md) §4/§7 — binding, and it wins over this file.

**Status:** ☐ NOT RUN. **Precondition:** the readiness-diagnostic offline slice merged + verified.

## 1. Why this run exists

`40d7c53` fixed a real defect: **`humanCheckpoint.observed` was `false` on every live run to date,
including Run 4.** `driveOneRun` rechecked ~1 s after the highlight, so the stage left
`WAIT_FOR_USER_ACTION` before the seller acted and the session's stage guard dropped the observation.
The fix makes the run wait. It is **offline-proven only** and has **never run against live NAVER**.

Two questions, neither answerable from code or docs:

1. **Does `USER_ACTION_OBSERVED` fire on a real NAVER click?** The in-page listener
   (`observer.ts:21-28`) has **never once fired live**. The fix assumes it can. If a live SPA re-render
   drops the listener between arm and click, it never will.
2. **What is the live period/scope state, and is the Run 4 dialog the already-recorded consent
   dialog?** Both are recorded open in [`HANDOFF.md`](HANDOFF.md), and **inventing a procedure for
   either is forbidden.**

## 2. Why it is non-mutating — and why that is not a choice of politeness

**`USER_ACTION_OBSERVED` fires on the CLICK; the dialog is step 2.** So a click that is never confirmed
answers question 1 **in full**, shows the operator the dialog, and produces no download → no validate →
no ingest.

This matters because **there is no no-ingest mode**: `buildLiveRunDeps` unconditionally wires the real
backend uploader, `NaverLiveProbeDriverOptions.ingest` is non-optional, and the engine runs
VALIDATE→INGEST with no gate. **If the seller confirms, ingest is unconditional and irreversible.**
Not confirming is the only lever — the same one Run 3 (§8-16) used.

## 3. Operator choreography — this DEVIATES from the operator runbook, on purpose

⚠ [`r4-operator-runbook.md`](r4-operator-runbook.md) §3 tells the operator to confirm the dialog
"without hesitation". **Run 5 requires the opposite.** The runbook describes the **export pilot** and is
correct for it; **it must not be rewritten to describe Run 5, and these two must not be "reconciled".**
This record is the sole choreography for this run.

1. **Phase A, unchanged.** The seller logs in, completes 2FA/CAPTCHA, selects account/store **and
   period/scope normally**, reaches the review-management export surface, leaves the browser open, and
   signals ready. Budget `CONFIRM_TIMEOUT_MS` = 10 min.
2. The Runtime prepares the surface, highlights the one export control, and **now genuinely waits**
   (up to `OBSERVE_TIMEOUT_MS`). Unlike every prior run, the clock is not already running.
3. **The seller clicks the highlighted control.** This is the action under test.
4. **The seller does NOT confirm.** **Simply let the ~60 s window lapse.** This needs no knowledge of
   the dialog's controls, so it invents no procedure. Dismiss the dialog afterwards, outside the run,
   however you normally would.
5. While it is on screen, record the **single boolean** in §4. **Read nothing else off it.**
6. The run fails closed at `DOWNLOAD_TIMEOUT`. **That is the success condition, not a fault.**

**Be seated and ready before the run starts.** A no-click outcome means **operator-absent first**, not
a code bug — and here it would be indistinguishable from the very defect under test.

## 4. Evidence to record (sanitized) — new dated §8-18 in [`r4-evidence-pack.md`](r4-evidence-pack.md)

Enums / booleans / coarse buckets / SHA only. **Never** a URL, filename, path, selector, page content,
credential, cookie, token, exact count, or `eventTimeMs`.

- ☐ The filled Run-5 G6 instance (dispatching turn, date, operator, scope).
- ☐ Final run view: `{ status, progress, channelCode, blockerCode? }` only.
- ☐ **`aw.live.barrier { observed }` — THE headline.**
  - `observed: true` → the fix works live; the §4 audit trail is real for the first time.
  - `observed: false` → the in-page listener does not survive live NAVER; the fix is insufficient and
    the download remains the sole evidence of the human action.
  - **Both are publishable findings. Neither is a failed run.** Record what happened.
- ☐ **`aw.live.readiness { verdict, readinessDecision, readinessState?, readinessReason,
  readinessBranch, selectedRangePresent, dateRangeControlPresence }`** — the first machine evidence of
  the live period/scope state. The wire flattens every readiness HALT to `UNSUPPORTED_STATE`;
  `readinessBranch` is the only thing that says which rung fired.
- ☐ **`dialogMatchesRecordedConsentMarkers: yes/no`** — operator eyeball, against the marker set
  **already recorded** in `collector/src/naver/export-click-signals.ts` (the copyright/usage consent
  that an earlier live run misread as `date_range_required`). This tests an **existing recorded
  hypothesis** rather than inventing one, and resolves `HANDOFF.md`'s open "whether that is the same
  dialog Run 4 hit is NOT established" **in either direction**.
  ⚠ **Do not name the dialog in the write-up, whichever way it lands.**
- ☐ The Operation Run id (`run_…`), and its persisted `humanCheckpoint.observed` — which **must agree**
  with the `aw.live.barrier` line. A disagreement is a P0-class finding about the audit trail.
- ☐ No-leak assertion (`findProhibitedFields == []` across wire + store).
- ☐ **Non-mutation confirmation:** no download fired, quarantine never written, `/api/uploads` never
  called. ⚠ **A `COMPLETED` terminal means the seller confirmed and the run MUTATED the local dev DB** —
  dedup makes it non-destructive but it is **not reversible by the Runtime**. Report it plainly.

## 5. What Run 5 does NOT prove

**The `COMPLETED` path under the new timing.** The confirmed-download → validate → ingest chain is
untouched here and still rests on Run 4's **old-timing** evidence. Re-proving it needs a **separate
mutating run with its own fresh export-scoped G6** — worth deferring until Run 5 answers whether the
observation fires at all, because `observed: false` would change the design before that run is worth
spending.

## 6. Abort criteria

Full definitions in [`r4-preparation.md`](r4-preparation.md) §7 — **binding, not re-authored here.** The
two points this record restates because Run 5 inverts the usual reading:

- ✅ **The expected export confirmation dialog is NOT an abort trigger** (§7 carve-out). **Declining to
  confirm it is this run's SCOPE, not an abort** — and it is exactly one dialog wide.
- 🛑 **Everything unrecognized still aborts immediately.** Any *other* prompt or dialog, any anti-abuse
  signal (CAPTCHA storm, lockout warning), any on-screen data the seller did not expect to share, or
  withdrawn consent → the human completes it or walks away; the Runtime never retries around it.
  **Uncertain whether a dialog is the expected one ⇒ it is not ⇒ abort.**

---

**Related:** [`r4-gate-record.md`](r4-gate-record.md) (the Run-5 G6 template — authorization) ·
[`r4-preparation.md`](r4-preparation.md) (§4 boundary, §7 abort — normative) ·
[`r4-operator-runbook.md`](r4-operator-runbook.md) (the **export-pilot** choreography — deliberately
different from §3 above) · [`r4-evidence-pack.md`](r4-evidence-pack.md) (§8-16 Run 3 is this run's
terminal shape; §8-17 Run 4 is the choreography observation) · [`HANDOFF.md`](HANDOFF.md).
