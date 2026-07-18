# Reply-submission abort-rehearsal — dispatch record (NOT AUTHORIZED · grants nothing)

> **This file authorizes no live NAVER contact.** It is the choreography and evidence sheet for a run that
> must be authorized elsewhere: **G2 re-extended to a write**, a **fresh `reply submission`-scoped G3**, and a
> **fresh, single-use, reply-submission G6** recorded in the dispatching turn
> ([`r4-gate-record.md`](r4-gate-record.md) §G3/§G6), with **G4 ratified from the proof**, **G5 re-checked**,
> and **P6/P12 signed**. **The boundary** is [`r4-preparation.md`](r4-preparation.md) §4.1/§7 and
> [D-032](decisions.md) — binding, and they win over this file.

**Status:** **☐ NOT AUTHORIZED · NOT EXECUTED.** No `reply submission` G3 instance is affirmed, no
reply-submission G6 is filled, P6/P12 are unsigned, and the reply approval flag has never been affirmed. This
is the pre-dispatch runbook for **one** run; it is not the dispatching turn. The live run happens only in a
later turn where the operator fills the gates.

⚠ **A ratified scope is not an affirmed gate; a template is not an approval.** The sixth G3 scope
`reply submission` and the reply-submission G6 template exist ([D-032](decisions.md);
[`r4-gate-record.md`](r4-gate-record.md) §G6) — **existing is not affirming.** The build prerequisites being
MET offline ([`r4-reply-submission-readiness.md`](r4-reply-submission-readiness.md)) is exactly when they are
easiest to mistake for permission: **the sheet being complete is not the sheet being signed.**

## 1. Why this run exists

Reply Submission Live Readiness v1 (#296/#297) built the whole live seam offline — the real-browser synthetic
rung, the shared dispatch service + gated CLI + Bridge adapter, the FE→agent v2 handoff, the `.reply-runs`
PARK store, and the live-seam privacy proofs. **None of it has ever met NAVER.** Per [D-032](decisions.md),
"live is never the first execution": the synthetic ladder ran, so this is the first run against a **real** NAVER
page — and, by design, it still posts nothing.

One question, unanswerable from code or docs: **does the shipped gated CLI drive a real NAVER
review-composer page — locate the composer, highlight it read-only, observe — and terminate at an
operator-reported UNVERIFIED outcome that records into the backend?** Every piece is offline-green; the live
path adds a real composer locate and a real page the driver has never seen.

## 2. Why it is non-mutating — by construction, not by lever

**Zero clicks by the Runtime, and — this run — zero submit by the operator.** SellerOps never types into the
composer and never clicks submit (§4.1 boundary). This run's operator is instructed to reach the composer,
confirm the read-only highlight, and **not submit** → the run terminates `OPERATOR_REPORTED` /
`SUBMISSION_ABORTED`. **No submit ⇒ no marketplace write.** Not "declined" — the abort-path rehearsal makes the
first live execution non-mutating *by construction*.

This is the reply-side analogue of Run 3 / Run 6's "not acting is the only guaranteed non-mutating lever":
for a reply there is no download-window to simply lapse, so the guaranteed-safe state is **the operator
chooses not to submit**, which terminates as the benign operator-reported `SUBMISSION_ABORTED · UNVERIFIED`
([D-032](decisions.md)(a)). A **real** manual post is a distinct, separately-gated future run.

## 3. The shipped path — three surfaces, an operator-carried join

No code is written for this proof; it uses only shipped surfaces.

1. **Mint** — `POST …/attention/items/{actionRef}/reply/submission-run`
   (`OperatorReviewReplyController.startSubmissionRun`) → `{actionRef, submissionRef, approvedVersion}`.
   `submissionRef` is the opaque single-use 16-hex binding to the approved head.
2. **Live-drive** — `collector/src/cli/run-reply-submission-live-naver.ts`, the **only** shipped entrypoint
   that injects the live `NaverReplySubmitProbeDriver` over a real page. Gated by
   `--i-understand-this-posts-a-live-naver-reply` (refuses the export flag → exit 6; missing → exit 3;
   `NODE_ENV=production` → exit 4). Takes `--submission-ref <16hex>`. Highlights read-only + observes only —
   never types, never clicks submit, imports no ingest path. Runs `recoverReplyRuns` at startup (PARK any
   interrupted prior run) and prints the real `run_<hex>` runId + terminal view. **It never calls `/outcome`.**
3. **Record** — `POST …/reply/outcome` (`recordOutcome`) with `{commandId, submissionRef, operatorOutcome,
   awRunRef}` → an append-only, always-`UNVERIFIED` fact. `awRunRef` is opaque (`requireAwRunRef` accepts any
   ≤128-char non-blank string), so the CLI's runId records unchanged. For this rehearsal,
   `operatorOutcome = SUBMISSION_ABORTED`.

> **The seam, stated honestly:** the gated CLI live-drives but does not record; the FE recording path drives
> only the *synthetic* driver. So the operator carries `submissionRef` **in** to the CLI and the `run_<hex>`
> runId **out** to `POST /outcome`. **Decision (this run): direct `POST /outcome`** — shipped surfaces only,
> zero new code, most auditable. A one-click FE-bridge-to-live path is **not shipped** (it would need code to
> inject the live driver into the local-agent boot) and is **out of scope**.

## 4. Gate state — what carries, what does not (all per-run gates ☐)

| Gate | This run | Basis |
|---|---|---|
| **G1** channel ratified | ✅ carries | NAVER SmartStore review reply |
| **G2** seller consent | ☐ **DOES NOT CARRY** | The recorded export G2 is a **read**; a submission is a **write**. Re-extend to the §4.1 write boundary on own dev account (`NAVER_DEV_SELLER_SELF_01`) — the seller composes/pastes/submits; SellerOps highlights read-only + observes. See [`r4-reply-submission-live-kickoff.md`](r4-reply-submission-live-kickoff.md):§3 |
| **G3** environment (`reply submission`) | ☐ **fresh, per-run** | The **sixth** scope ([D-032](decisions.md)) — non-substitutable; no read scope substitutes. No instance ever affirmed. See below |
| **G4** synthetic ladder | ☐ **ratify from the proof** | Cite the real-browser rung (`reply-browser.test.ts`, `RUN_INTEGRATION=1`) on **this run's own record** — inheritance is not affirmation ([`r4-reply-submission-live-kickoff.md`](r4-reply-submission-live-kickoff.md):§3) |
| **G5** policy track | ☐ **re-check** | A submit can raise a copyright/usage-consent dialog; confirm no platform grant is implied and the §7 dialog rule is understood. (Moot for a run that never submits, but affirmed anyway) |
| **G6** per-run | ☐ **fresh, single-use** | The reply-submission template exists in [`r4-gate-record.md`](r4-gate-record.md) §G6 (lines 224–241) — **blank; a template is not an approval.** ⚠ **NOT restated here: one copy, one source** |
| **P6 / P12** | ☐ **not signed** | Supervised-pilot gate sign-off + per-run PO approval — signed only once G2/G3/G5/G6 + §7 all land in the dispatching turn |

### G3 (scope: `reply submission`) — environment + §9-3 pause lift · ☐ NOT AFFIRMED

- ☐ Stable network / IP / location still holds (the condition that paused NAVER live work).
- ☐ Dedicated Chrome connection profile intact; **Operation Run persistence enabled** — here the isolated
  `.reply-runs/` store; restart recovery PARKs, never auto-re-drives ([D-032](decisions.md)(c)).
- ☐ **§9 item 3 pause lift affirmed for a REPLY-SUBMISSION run** — a fresh, single-run lift for this scope
  only. **Not** a read lift, **not** an export/click/download/ingest lift, **not** general or standing.
- ☐ G4 addressed **on the record** (below) rather than inherited.
- **N/A — `Bridge paired` is SCOPED OUT for this run.** Basis (mirrors Run 6): this is a **CLI run over an
  in-process loopback**, and the live driver is not Bridge-wired — the CLI is the control boundary, not the
  Bridge, so affirming the box would assert a fact not in evidence and a silent drop would hide the question.
  **N/A is a recorded answer, not a waived box; it does not generalize** — an FE-bridge-driven reply run would
  affirm it for real.

### G4 — ratify from the reply real-browser rung · ☐ NOT AFFIRMED

- ☐ Cite `reply-browser.test.ts` (real headless Chromium over the synthetic composer DOM
  `replyComposerFixtureHtml`, `RUN_INTEGRATION=1`) on **this run's own record** — the driver tags its own
  target read-only, the TEST (never the driver) clicks the synthetic submit, no canary leaks. ⚠ **"Live is
  never the first execution"** is satisfied by this rung; **inheritance from a static ✅ is not affirmation.**

### ⚠ The live window this G6 would authorize · ☐ NOT AFFIRMED

The reply-submission G6 carries the `max live window:` field ([D-030](decisions.md)). This run is a
**foreground + observe** window (no download/ingest waits): a bounded operator-report wait (`CONFIRM_TIMEOUT_MS`
= 10 min) plus login/compose/observe. **State the window explicitly in the dispatching turn** — do not inherit
a number from any export run.

### P6 / P12 — supervised-pilot sign-off + per-run PO approval · ☐ NOT SIGNED

- ☐ G1 ✅ · G5 addressed; **G2 re-extended to a write** and **G4 addressed for THIS run** (above), not carried.
- ☐ A **filled** reply-submission G6 recorded in this dispatching turn (template ≠ approval).
- ☐ The `reply submission` **G3 instance** affirmed (above).
- ☐ §7 abort criteria acknowledged · ☐ seated-and-ready confirmed.
- ☐ Signed for the **abort-rehearsal** posture only — **operator does NOT submit**, terminal
  `SUBMISSION_ABORTED · UNVERIFIED`. **Explicitly does NOT authorize a real post**, which is a distinct run
  with its own fresh G2/G3/G6.

### Preconditions — ☐ NOT VERIFIED

- ☐ **The tree under test carries the merged reply stack** (#296/#297) — the gated CLI, dispatch service,
  `.reply-runs` store, and privacy proofs. Verify against the tree the run actually launches from; do not
  assume.
- ☐ Own **test** seller account with a `RESPONSE_NEEDED` review that has a drafted **and approved** reply.
- ☐ Backend **UP** — the two API calls (`submission-run` mint, `outcome` record) need it. ⚠ Unlike the export
  runs, this run **does** cross to the backend at §4.2 — but only to write the operator-reported UNVERIFIED
  fact; there is no marketplace call and no ingest.
- ☐ **No `RUN_INTEGRATION`, no `AW_HEADED`.** This is the gated live entrypoint, nothing else.
- ☐ `NAVER_REVIEW_URL` (review-management page) + `COLLECTOR_BROWSER_CHANNEL` load from `.env` — **never echo
  the values.**
- ☐ `NODE_ENV` unset (the entrypoint independently refuses `NODE_ENV=production`, exit 4).

## 5. Operator choreography (the dispatching turn — a FUTURE turn, not now)

1. **Affirm all gates fresh** in this turn (§4) — record the filled G3 + G6 instances in
   [`r4-gate-record.md`](r4-gate-record.md), sign P6/P12. *If any gate is not affirmable, stop — no launch.*
2. **Mint** `submissionRef` via `POST …/reply/submission-run`; confirm `approvedVersion` is the head you mean.
3. **Launch the gated CLI** attended:
   `npx tsx src/cli/run-reply-submission-live-naver.ts -- --submission-ref <16hex> --i-understand-this-posts-a-live-naver-reply`
   It PARKs any interrupted prior run, opens Chrome on `NAVER_REVIEW_URL`, and starts the run.
4. **Human login** (NAVER-ID + any 2FA / CAPTCHA) in that same window; reach the approved review. The Runtime
   locates and highlights the reply composer **read-only**.
5. ⚠ **Abort-path rehearsal — this run's terminal. Confirm the highlight is on the right composer, then DO
   NOT SUBMIT.** Report "did NOT post" by creating the **aborted** sentinel (`reply-aborted.ready`)
   *(in Claude Code, say "aborted")* → the CLI sends `SWITCH_TO_MANUAL` → the run terminates `OPERATOR_REPORTED`
   / `SUBMISSION_ABORTED`. The CLI prints the real `run_<hex>` runId + terminal view.
6. **Record** the UNVERIFIED outcome: `POST …/reply/outcome` with
   `{commandId: <fresh>, submissionRef: <step 2>, operatorOutcome: "SUBMISSION_ABORTED", awRunRef: <runId from step 5>}`.
   Expect 200, `replayed=false`. The recorded fact is `SUBMISSION_ABORTED · UNVERIFIED` — an audit fact about
   what the operator did, **never** a claim about NAVER.
7. **Close** the browser/CLI; the run is terminal, the `submissionRef` is spent.

## 6. Abort / PARKED / double-post rules (§7 — binding, not re-authored here)

Full definitions in [`r4-preparation.md`](r4-preparation.md) §4.1/§7 and
[`r4-reply-submission-live-kickoff.md`](r4-reply-submission-live-kickoff.md) §5.

- 🛑 **Fail closed, zero clicks.** Ambiguous / missing / drifted composer → the Runtime reports
  `TARGET_AMBIGUOUS` / `TARGET_NOT_FOUND`, never a guess.
- 🛑 **Any unexpected dialog** (incl. copyright/usage consent) → uncertain ⇒ not the expected one ⇒ abort,
  zero further action.
- ✅ **Abort is an outcome, not a fault.** The operator choosing not to post → `SUBMISSION_ABORTED · UNVERIFIED`
  — for this run, the **intended** terminal.
- 🛑 **Single-use / no auto-re-drive.** `submissionRef` is single-use; an interrupted run PARKs
  (`recoverReplyRuns`) and is **never** resumed or re-driven. A retry needs a **fresh** `submissionRef`
  (a new `submission-run` mint that re-confirms the approved head).
- 🛑 **관찰 ≠ 완료 — no `COMPLETED`, ever.** The terminal is the `operatorOutcome` + `verification=UNVERIFIED`
  pair, shown as a pair, never `UNVERIFIED` alone.

## 7. Evidence to record (sanitized)

Enums / booleans / coarse buckets / SHA only. **Never** a URL, filename, path, selector, page content,
credential, cookie, token, reply text, exact count, or `eventTimeMs`.

- ☐ The filled reply-submission G6 instance (dispatching turn, date, operator, scope), and the affirmed
  `reply submission` G3 instance.
- ☐ The real `run_<hex>` runId; final run view `{ status, progress, channelCode }` only.
- ☐ Terminal `{ status: OPERATOR_REPORTED, operatorOutcome: SUBMISSION_ABORTED, verification: UNVERIFIED }`.
- ☐ `POST /outcome` → 200, `replayed=false`; `awRunRef` on the wire is the opaque `run_<hex>`, not content.
- ☐ Collector log tags `aw.reply.parked` (if a prior run was PARKed at startup) / `aw.reply.run { status }`.
- ☐ **Non-mutation confirmation:** the operator did **not** submit; no reply was posted; no ingest/upload
  path was reached (the reply CLI imports none).
- ☐ No-leak assertion (the live-seam privacy proofs `reply-guard.test.ts` already assert the wire + store
  carry only the opaque `run_<hex>`).

## 8. What this run does NOT prove

- **The real-post path.** The operator does not submit, so `OPERATOR_REPORTED_SUBMITTED` is untouched — a
  real manual post is a distinct, separately-gated **mutating** run with its own fresh G2/G3/G6.
- **The FE / Bridge live path.** The CLI is not the FE. The FE-bridge boot injects the **synthetic** driver;
  a one-click FE-bridge-to-live path is unshipped and out of scope.
- **Platform acceptance.** Nothing here says NAVER would have accepted anything — a reply post has no
  read-back oracle ([D-032](decisions.md)(b)), which is exactly why the terminal is UNVERIFIED.

---

**Related:** [`r4-gate-record.md`](r4-gate-record.md) (gates + templates — authorization; the reply-submission
G6 template lives there and is **BLANK**) · [`r4-reply-submission-live-kickoff.md`](r4-reply-submission-live-kickoff.md)
(the pre-dispatch checklist — build prerequisites MET, every run-gate ☐) ·
[`r4-reply-submission-readiness.md`](r4-reply-submission-readiness.md) (build-readiness record) ·
[`r4-preparation.md`](r4-preparation.md) (§4.1 write boundary, §7 abort — normative) ·
[`decisions.md`](decisions.md) ([D-032](decisions.md) sixth scope + MUTATING admission + isolation).
