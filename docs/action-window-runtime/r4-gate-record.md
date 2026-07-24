# R4 Supervised-Pilot Gate Record — NAVER SmartStore review export

**Opened:** 2026-07-12 · **Channel:** NAVER SmartStore review export (G1 ratified, [`decisions.md`](decisions.md) D-021).
**Pilot seller:** `NAVER_DEV_SELLER_SELF_01` — the operator's **own development NAVER seller account**
([`decisions.md`](decisions.md) D-024). **Status:** LIVING register of the §3 supervised-pilot gate.

> **This record authorizes NO live NAVER contact beyond what a filled per-run G3 + G6 grant.** It records
> the gate state only. A **read-only session-precondition probe was completed 2026-07-12** under a
> **consumed one-run G6** and a **consumed read-only-scoped G3** (§G3/§G6 below, §8-4 result). **Live export
> stays blocked** — it needs a **fresh export-scoped G3** (stable environment + the §9-3 live-work pause
> lift under the full §4 scope) **and a fresh per-run G6**, both in the dispatching turn. **G3 and G6 are
> both per-run** ([`decisions.md`](decisions.md) D-026); the consumed read-only-probe instances carry over
> to nothing.

**Sanitization discipline (self-applied):** every value here is a label, enum, boolean, date, or SHA.
No raw seller/account ID, email, username, raw URL, credential, cookie, token, or profile path
appears — the pilot seller is referenced ONLY as the sanitized label `NAVER_DEV_SELLER_SELF_01`. This
is the same contract the adapter enforces on the wire and the persisted store.

This register is the source of truth for [`r4-preparation.md`](r4-preparation.md) §3 (G2/G3/G5/G6) and
the §8-1 gate row in [`r4-evidence-pack.md`](r4-evidence-pack.md).

---

## G1 — Channel ratified · ✅

NAVER SmartStore review export — [`decisions.md`](decisions.md) D-021 (2026-07-09). See
[`r4-preparation.md`](r4-preparation.md) §2 for the selection rationale.

---

## G2 — Seller consent · ✅ RECORDED (self-consent)

**The operating seller is the operator**, acting on their **own development NAVER seller account**
(label `NAVER_DEV_SELLER_SELF_01`). The seller consents to the §4 live-action safety boundary, which
this record acknowledges verbatim:

- **The seller (human) always:** logs in; completes 2FA/CAPTCHA/account-lock challenges; selects
  account/store; selects marketplace; selects period/scope; **clicks the real export/download
  control**; judges anything legally or semantically uncertain.
- **SellerOps (Runtime) only:** prepares/validates the session precondition; opens/foregrounds the
  dedicated real-Chrome window on the seller's own account; locates and **highlights** the one real
  control (salted signature, never a raw selector); **observes** the user's action; verifies the
  expected transition; **detects** download start/completion read-only; validates the artifact;
  continues downstream through the existing ingestion path; persists the audited Operation Run.
- **SellerOps never:** types credentials; bypasses/automates login/2FA/CAPTCHA; auto-selects
  account/store/marketplace; clicks the export control; expands one request into a hidden click
  sequence; runs unattended/scheduled; proceeds on ambiguity (0/many/drifted → fail closed, zero
  clicks); emits or persists selectors, URLs, page content, credentials, cookies, tokens, or paths.

**Scope of the first authorized live run:** the **read-only session-precondition probe only** (checks
`READY` vs a fail-closed blocker and stops — no locate/highlight/click/export/download/downstream).
The full §4 boundary above governs any later, separately-approved export pilot.

*Consent basis:* self-consent by the operator/product-owner (same person as the pilot seller),
affirmed by ratifying D-024 and this record. Satisfies [`r4-preparation.md`](r4-preparation.md) §1
**P7**.

---

## G3 — Environment + pause lift · ☐ PER-RUN (affirmed in the dispatching turn — a standing ✅ is not possible)

G3 is a **per-run** gate ([`decisions.md`](decisions.md) D-026), exactly like G6: the §3 environment
preconditions **and** the §9 item 3 NAVER live-work pause lift are affirmed **fresh in the dispatching
turn**, **scoped to that one run**, and **consumed** with it. Prior affirmations, this register, and goal
pressure never carry over. To affirm G3 for a run, record one instance of this shape in that turn (append
per run; a blank template affirms nothing):

- ☐ Stable network / IP / location still holds (the condition that paused NAVER live work).
- ☐ Dedicated Chrome profile for the connection intact.
- ☐ Bridge paired. *(⚠ **Scope-dependent** — recorded **N/A with a reason** where the run's scope is not
  Bridge-driven; see the `session recovery` note below, where it is scoped out. **Never a vacuous ☑.**)*
- ☐ Operation Run persistence enabled.
- ☐ **§9 item 3 NAVER live-work pause lift — freshly affirmed FOR THIS RUN'S SCOPE ONLY**
  (`read-only probe` | `export pilot` | `export+ingest` | `real-click barrier` | `session recovery` —
  distinct scopes that never substitute for one another); not a blanket lift, not inherited from any
  earlier run.

**`session recovery` — RATIFIED as a fifth scope 2026-07-17 (product owner, [D-030](decisions.md); D-026
is extended, not superseded — G3 stays per-run, scopes stay non-substitutable, only the enum grows).**
It is none of the other four: it is read-only *in effect* (zero clicks, no download, ingest unreachable) but it is **not** the
§8-4 read-only probe — it drives the full engine and holds a live browser **~32 min**. Choreography:
[`r4-run6-session-recovery-dispatch-record.md`](r4-run6-session-recovery-dispatch-record.md).
**`Bridge paired` — SCOPED OUT for `session recovery`, RESOLVED 2026-07-17 (product owner).** For this
scope the box is recorded **N/A, with its reason**, never ☑ and never silently dropped: the run is a **CLI
run over a loopback**, and the live driver **is not Bridge-wired** — §6's Bridge rung
([`r4-preparation.md`](r4-preparation.md)) says verbatim *"the live driver is not yet Bridge-wired,"* and
[`r4-evidence-pack.md`](r4-evidence-pack.md) §8 records that the entrypoint *"uses a loopback channel."*
**Bridge pairing is not this run's control boundary — the CLI is.** A ☑ would assert a fact not in
evidence; a drop would hide the question.
⚠ **Scoped to `session recovery` only.** The box stands unchanged for every other scope, and a
Bridge-driven run affirms it for real. **This resolves the box's applicability, not the run's
authorization** — the G3 instance is still ☐.

⚠ **Ratifying the scope authorized nothing** — the *scope* being ratified was never the *run* being
authorized. **↳ SINCE EXECUTED 2026-07-17 (Run 6):** a `session recovery` G3 instance was affirmed and a
Run-6 G6 filled in that dispatching turn, the run drove once, and **both are now CONSUMED** (§G6 below;
[`r4-evidence-pack.md`](r4-evidence-pack.md) §8-23). Both were per-run and neither carries over — a further
run needs a fresh G3 + G6.

**`reply submission` — RATIFIED as a SIXTH scope 2026-07-18 (product owner, [D-032](decisions.md); D-026
extended, not superseded).** It is the first **MUTATING** scope — the seller performs a marketplace **write**
(composes + submits a NAVER review reply); all five earlier scopes are read/non-writing. SellerOps highlights
the composer read-only and **observes only** — never types, never clicks submit ([`r4-preparation.md`](r4-preparation.md)
§4.1). No read-back oracle exists, so the run terminates `OPERATOR_REPORTED` (`operatorOutcome` +
`verification=UNVERIFIED`), **never `COMPLETED`**. `submissionRef` is single-use; an interrupted run parks
(no auto-re-drive). Contract: `contracts/action-window/v2/` (side-by-side; v1 untouched).
⚠ **Ratifying the scope authorizes nothing** — the scope being ratified was never the run being authorized.
**↳ AFFIRMED 2026-07-18 (fresh dispatching turn, abort rehearsal), bound to ONE approved review** (NAVER dev
seller; approvedVersion 1, approvedFingerprint `4f0feedd9f498ce2…`; identifiers kept LOCAL): a `reply submission`
G3 instance is affirmed — environment VERIFIED this turn (operating checkout `sellerops-r4-runtime` @ `666d334`,
clean, HEAD == current origin/main & contained; dedicated NAVER R4 profile intact; `.reply-runs` persistence;
backend healthy); §9-3 pause lift + stable location/IP **operator-CONFIRMED this turn (2026-07-18)**; Bridge
paired = N/A (CLI/loopback) — alongside a filled
reply-submission G6 (§G6 below). Per-run, single-use — **VOID if the run is not launched this dispatching turn**;
carries over to nothing. (The prior 2026-07-18 instance was VOIDED unlaunched.)

*Owner:* operator/PO — never Runtime code. A filled G3 **alone authorizes no live contact**: a fresh
single-use **G6** (§G6 below) is still required in the same dispatching turn.

*Affirmations recorded:* one **CONSUMED** read-only-probe instance (below), plus the read-only-, export-,
and export+ingest-scoped lifts recorded in the seven executed dispatch records
([`r4-probe-…`](r4-probe-dispatch-record.md), [`r4-rowshape-…`](r4-rowshape-probe-dispatch-record.md),
[`r4-export-…`](r4-export-dispatch-record.md), [`r4-run2-…`](r4-run2-settle-verification-dispatch-record.md),
[`r4-run3-…`](r4-run3-precedence-fix-verification-dispatch-record.md),
[`r4-run4-…`](r4-run4-full-export-pilot-dispatch-record.md),
[`r4-readiness-branch-…`](r4-readiness-branch-probe-dispatch-record.md)) — **all spent**.

```
R4 G3 affirmation — CONSUMED (authorizes nothing further)
- date:            2026-07-12
- operator:        self
- run scope:       read-only session-precondition probe (no click/export/download)
- ☑ Stable network / IP / location (the condition that paused NAVER live work).
- ☑ Dedicated Chrome profile for the connection.
- ☑ Bridge paired.
- ☑ Operation Run persistence enabled.
- ☑ NAVER live-work pause LIFTED — for the first read-only session-precondition probe ONLY
     (no click / export / download); not a general lift.
- outcome:         CONSUMED — spent on the §8-4 read-only probe (2026-07-12); result in
                   r4-evidence-pack.md §8-4. Authorized ONLY that one read-only probe. Does NOT
                   carry to an export, ingest, or real-click run.
```

```
R4 G3 affirmation — CONSUMED (authorizes nothing further)
- date:            2026-07-23
- operator:        self (OPERATOR_SELF_01)
- run scope:       export+ingest (Run 7 — reply-state live proof; Run 4's ratified scope, no new scope)
- ☑ Stable network / IP / location — affirmed FOR THE CURRENT ENVIRONMENT in the dispatching turn.
     (The first 2026-07-23 attempt was DEFERRED precisely because this box went false; that instance
     was VOID and carried nothing here.)
- ☑ Dedicated Chrome profile intact (mechanically verified: unheld, preserved paths byte-identical
     across the holder re-sync to 783a9b4).
- N/A Bridge paired — CLI run over a loopback; the live driver is not Bridge-wired (the same
     resolution ratified for `session recovery`: recorded with its reason, never a vacuous ☑).
- ☑ Operation Run persistence enabled (verified post-run: the run persisted its marker).
- ☑ §9 item 3 pause lift — for `export+ingest` ONLY, this one run; not blanket, not inherited.
- outcome:         CONSUMED — spent on Run 7 (2026-07-23), which drove once and FAILED closed:
                   DOWNLOAD_TIMEOUT (readiness green, control highlighted, no export action within
                   the windows; no download ⇒ no artifact ⇒ zero ingest). Dispatch record §15.
                   Carries to nothing; a retry needs a fresh G3 + G6.
```

⚠ **This instance is spent.** ⚠ **G3 has never "failed".** Each affirmation above was real and is retained
here as a dated record — `☐ PER-RUN` is this register's **category** label for a gate that is never standing
(the same shape §G6 carries), not a failure marker.

---

## G4 — Synthetic ladder green · ✅

Every §6 adapter-readiness item green on NAVER fixtures — [`r4-evidence-pack.md`](r4-evidence-pack.md)
§8-2 (offline suite), §8-3 (headed human-click proof).

⚠ **This ✅ predates A3 and A4, and §8-2's table is a dated snapshot that does not enumerate §6's 11th
rung.** A run whose code postdates it therefore **addresses G4 on its own record, citing the proof** —
the precedent Run 5 set — rather than resting on this line. **A static ✅ is not an answer for new code.**

### RATIFIED 2026-07-17 — G4 carries for **Run 6 (session recovery)**, on the basis of §8-22 · [D-030](decisions.md)

§6's 11th rung — **Session recovery (park → re-probe)** — is green over a **real browser on a synthetic
DOM**: `run-action-window-live-naver-browser.test.ts`, `RUN_INTEGRATION` **PASSED 2026-07-17, 5/5**
([`r4-evidence-pack.md`](r4-evidence-pack.md) §8-22). The real `NaverLiveProbeDriver` re-probes across a
real navigation, so live NAVER is **no longer the first browser execution of the recovery path**.

⚠ **Two named seams are PRESERVED as live-first residual risks — accepted by the product owner, not
closed.** Both are **executed by nothing offline**; this is not Run 5's "offline-green, cite the proof"
shape, and the distinction is recorded deliberately:

1. **`page.content()` mid-navigation** (`naver-live-driver.ts`) — **unguarded**, and §8-22 does not reach
   it: that test's gate `await`s its navigation, so the re-probe reads a **settled** page and the
   destroyed-context window never opens. **Run 6's premise — a seller who just logged in and navigated —
   IS that window.** A throw tears the driver down and **spends the G6**. Signature to record:
   `aw.live.recovery { outcome: "driver-error" }` with **no** `aw.live.readiness` for that attempt. A3
   makes the failure **legible**; it does not prevent it. Guarding the read is a known, PO-declined fix.
2. **`settleSpa` on `main()`'s recovery branch** — executed by nothing offline (§8-22 injects its own
   gate, so `main()` stays untestable). **Best-effort by construction:** the driver's own readiness settle
   stands behind it, so a failure costs latency, not the run.

⚠ **This ratification is scoped to Run 6 and to these two seams. It does not generalize** — any later run
introducing a code path with no offline execution addresses G4 again, on its own record. **It authorizes
no live contact:** G3 + G6 do that, and both are ☐.

---

## G5 — Policy track · ✅ LOGGED

The §5 platform-policy/provider-inquiry state for the NAVER pilot (parallel track, D-019 — tracked
here, executed outside the repo):

| §5 item | State |
|---|---|
| Seller-tool / provider / API-partner program + prerequisites | ☐ not logged (not required for this pilot) |
| Written ToS question (seller-controlled overlay + read-only detection on the seller's own session) | ☐ not sent (not required for this pilot) |
| Platform position on third-party tools assisting (not automating) export | ☐ not recorded (not required for this pilot) |
| **NAVER-specific** | **None required** for a seller-owned export on the seller's own session per §5; Solution Market remains a long-term option, not a prerequisite. |

No platform is marked "승인됨/approved" (matrix §3 rule). The parallel track is **opened and logged** —
this satisfies [`r4-preparation.md`](r4-preparation.md) §1 **P8**. It does **not** authorize any live
action; live is governed by G3 + G6.

---

## G6 — Per-run approval · ☐ TEMPLATE (filled in the dispatching turn — a blank template grants nothing)

Explicit product-owner approval is required **in the dispatching turn** of each live run. It is never
standing and never inherited from prior approvals or goal pressure. To authorize a run, fill and
record one instance below (append per run; a blank template is not an approval):

```
R4 live-run approval
- channel:            NAVER SmartStore review export
- seller-account:     NAVER_DEV_SELLER_SELF_01
- date:               <YYYY-MM-DD>
- operator:           <operator>
- run scope:          <read-only session-precondition probe | export pilot>
                      (first run MUST be: read-only session-precondition probe — no click/export/download)
- §7 abort criteria:  acknowledged (ambiguous/missing/drifted target, unexpected post-state,
                      session invalid, artifact-validation failure → fail closed, zero clicks;
                      operator abort on withdrawn consent / unrecognized dialog / anti-abuse challenge)
- G2/G3/G5 state:     G2 ✅ recorded · G5 ✅ logged
                      G3 ☐ AFFIRMED FOR THIS RUN (§G3 instance recorded in this same turn, scoped to
                      the run scope above — G3 is per-run; no earlier affirmation carries over)
```

**Reply-submission G6 template (v1.6, MUTATING — additional required fields).** A `reply submission` run is a
marketplace **write**, so its G6 carries the `max live window:` field ([D-030](decisions.md)) AND a double-post
precondition, and its `run scope` must be exactly `reply submission`. A blank template grants nothing.

```
R4 live-run approval — REPLY SUBMISSION (MUTATING)
- channel:            NAVER SmartStore review reply
- seller-account:     NAVER_DEV_SELLER_SELF_01
- date:               <YYYY-MM-DD>
- operator:           <operator>
- run scope:          reply submission   (sixth G3 scope, D-032 — never substitutes for a read scope)
- max live window:    <state it> (foreground + observe window; no download/ingest waits)
- double-post precond: acknowledged — submissionRef is single-use; a retry needs a fresh re-confirmed
                      binding; the Runtime never auto-re-drives the submit; interrupted run parks to operator
- write boundary:     acknowledged (r4-preparation §4.1) — SellerOps highlights the composer read-only and
                      observes ONLY; the seller composes/pastes and clicks submit; SellerOps never types,
                      never clicks submit; terminal is OPERATOR_REPORTED (UNVERIFIED), never COMPLETED
- §7 abort criteria:  acknowledged (ambiguous/missing/drifted composer, unexpected dialog incl.
                      copyright/usage consent → fail closed, zero clicks; operator abort at will)
- G2/G3/G5 state:     G2 ✅ recorded · G5 logged · G3 ☐ AFFIRMED FOR THIS RUN, scope = reply submission
                      (recorded in this same turn; per-run; no earlier affirmation carries over)
```

⚠ **VOID / CONSUMED — the 2026-07-18 live attempt FAILED (fail-closed).** Run `run_2253b30a8e0b` reached
`stage=FAILED`, `parked=false` at the composer-locate step (no click, no submit). **No operator-reported terminal
was produced; backend outcome is null; no reply was posted.** Per operator directive this **G6 and its
`submissionRef` are SPENT / NON-REUSABLE** — a retry requires a **fresh** dispatching-turn G6 **and** a **fresh**
`submissionRef`. **Blocker code: UNKNOWN / PENDING (not recoverable from local evidence).** Verified 2026-07-19
by inspecting the persisted marker `collector/.reply-runs/run_2253b30a8e0b.json`: it is `schemaVersion 1`
(`stage=FAILED`, `parked=false`, `channelCode=naver`) and carries **no `blockerCode` field** — that field
postdates this run's v1 marker schema, so the code was never persisted. No terminal capture exists in-repo. The
exact code therefore stays PENDING the operator's terminal run-view and is **left UNKNOWN, not guessed**. The
affirmation below is retained as the as-attempted record only.

**Reply-submission G6 — FILLED + AFFIRMED (dispatching turn, 2026-07-18; single-use; bound to ONE approved review) — now VOID (above).**
Reaffirmed from the operator's explicit standing affirmations (re-invoked this turn) + current verification. The prior
2026-07-18 instance was **VOIDED unlaunched** (environment not ready) and carries nothing here. ⚠ **Single-use — consumed by
the launch; VOID after this dispatching turn.**

```
R4 live-run approval — REPLY SUBMISSION (MUTATING) — abort rehearsal
- channel:            NAVER SmartStore review reply
- seller-account:     NAVER_DEV_SELLER_SELF_01
- date:               2026-07-18
- operator:           self (operator / product owner)
- run scope:          reply submission   (sixth G3 scope, D-032 — never substitutes for a read scope)
- bound review:       ONE approved reply — approvedVersion 1, approvedFingerprint 4f0feedd9f498ce2…
                      (NAVER 스마트스토어 dev seller; RESPONSE_NEEDED; outcome null; canStartSubmissionRun true).
                      Raw review/account identifiers kept LOCAL — never in this register.
- max live window:    20 minutes (foreground + observe; no download/ingest waits)
- double-post precond: acknowledged — one approved review, one single-use submissionRef; NO second run;
                      the Runtime never auto-re-drives; recover ONLY to PARKED or SUBMISSION_ABORTED · UNVERIFIED
- write boundary:     acknowledged (r4-preparation §4.1) — operator acts manually; SellerOps highlights read-only
                      + observes ONLY; NO submit authorized this run; terminal OPERATOR_REPORTED (UNVERIFIED), never COMPLETED
- §7 abort criteria:  acknowledged — any login prompt / account mismatch / security check / unexpected dialog / drift → abort, zero clicks
- G2/G3/G5 state:     G2 ✅ affirmed (reply WRITE-surface consent; manual action; highlight + observe only; no submit) ·
                      G5 ✅ (no platform grant implied; abort triggers understood) ·
                      G3 ✅ AFFIRMED THIS RUN, scope = reply submission — environment VERIFIED this turn (operating checkout
                      sellerops-r4-runtime @ 666d334, clean; dedicated NAVER R4 Chrome profile intact; .reply-runs persistence;
                      backend healthy; HEAD == current origin/main, contained, clean); §9-3 pause lift affirmed + stable location/IP
                      operator-CONFIRMED this turn (2026-07-18); Bridge paired = N/A (CLI/loopback)
- G4 state:           ✅ affirmed — existing green real-browser proof (reply-browser.test.ts, present at HEAD); operator waived
                      a re-run; NOT re-executed this session
- P6 / P12:           ✅ signed — this single supervised abort rehearsal only; seated and ready
```

*Reply-submission approvals recorded:* **one AFFIRMED (fresh dispatching turn 2026-07-18), bound to ONE approved review,
awaiting its single launch.** Single-use; **VOID if the run is not launched this turn.** Authorizes exactly one abort-only
rehearsal (no submit, one submissionRef, ≤20 min, recover only to PARKED / `SUBMISSION_ABORTED · UNVERIFIED`). ⚠ Provenance
note (resolved before mint/launch): **G4** was operator-waived (real-browser proof not re-run this session); **stable
location/IP** is **operator-CONFIRMED this turn (2026-07-18)**; checkout SHA corrected to the **verified current
origin/main tip `666d334`** (HEAD == main, contained, clean). Choreography:
[`r4-reply-submission-abort-rehearsal-dispatch-record.md`](r4-reply-submission-abort-rehearsal-dispatch-record.md).

*Live reply-run kickoff checklist:* [`r4-reply-submission-live-kickoff.md`](r4-reply-submission-live-kickoff.md)
— the pre-dispatch runbook (build prerequisites now MET offline; every run-gate still ☐). It grants nothing.

*First reply-submission dispatch record (scaffold):*
[`r4-reply-submission-abort-rehearsal-dispatch-record.md`](r4-reply-submission-abort-rehearsal-dispatch-record.md)
— choreography + evidence sheet for one **abort-path rehearsal** (operator reaches the composer and does NOT
submit → `SUBMISSION_ABORTED · UNVERIFIED`, non-mutating by construction). ☐ NOT AUTHORIZED, all gates blank;
it grants nothing.

*Approvals recorded:* one **CONSUMED** read-only-probe instance (below). G6 is a **per-run** gate — it is
never permanently satisfied, and this record grants nothing beyond the single run it describes.

```
R4 live-run approval — CONSUMED (authorizes nothing further)
- channel:            NAVER SmartStore review export
- seller-account:     NAVER_DEV_SELLER_SELF_01
- date:               2026-07-12
- operator:           self
- run scope:          read-only session-precondition probe (no click/export/download)
- §7 abort criteria:  acknowledged
- G2/G3/G5 state:     G2 ✅ · G3 ✅ (read-only probe path) · G5 ✅
- outcome:            CONSUMED — one read-only probe executed 2026-07-12; sanitized result in
                      r4-evidence-pack.md §8-4 (ready / LOGGED_IN / seller-center; no blocker).
                      Read-only held: no click/locate/highlight/export/download/quarantine/
                      ingest/downstream/status write. Authorized ONLY this one read-only probe.
                      NOT an export pilot.
```

This instance is **spent**. Each subsequent live run — **including any export pilot** — requires a **NEW**
G6 instance filled in that dispatching turn under the full §4 boundary. Goal pressure, prior approvals,
or this consumed instance never carry over.

```
R4 live-run approval — RUN 7 (export+ingest) — CONSUMED (run FAILED closed)
- channel:            NAVER SmartStore review export (read)
- seller-account:     NAVER_DEV_SELLER_SELF_01
- date:               2026-07-23
- operator:           self (OPERATOR_SELF_01)
- run scope:          export+ingest (Run 4's ratified scope — no new scope)
- backend:            disposable sellerops_run7_20260723T233452 on SERVER_PORT=18080, confirmed as
                      the ingest target on the run's own output; NEVER the persistent dev DB;
                      dropped at teardown via the falsified name guard
- max live window:    15 minutes (exceeded ~2 min by the run's own fail-closed tail — dispatch
                      record §15.4 finding 1; no marketplace contact occurred in the overrun beyond
                      the already-open idle page timing out)
- no-reply bound:     acknowledged — no composer, no REPLY_SUBMISSION run, reply-approval flag
                      never passed; the §4.1 write boundary never in scope
- §7 abort criteria:  acknowledged, incl. Run 7's three additions (range precondition → abort
                      before the window; unconfirmed ingest target → abort; any composer surface → abort)
- G2/G3/G5 state:     G2 ✅ · G5 ✅ · G3 ✅ affirmed this same turn (export+ingest instance above)
- P6:                 ✅ signed in the dispatching turn on G6 + G3 + fresh G4 (backend 1502/0/2sk ·
                      collector-in-holder 4843/95 · frontend 765; unmodified 783a9b4 tree)
- outcome:            CONSUMED — the run drove once and FAILED closed: DOWNLOAD_TIMEOUT (2-of-3
                      steps; readiness LOGGED_IN · READY · positive_count; observe window lapsed
                      observed:false; no download ⇒ no artifact ⇒ zero ingest; disposable DB at
                      0 rows when dropped). Full record: r4-run7-reply-state-live-proof-dispatch-
                      record.md §11 + §15. A retry needs a fresh G3 + G6 — nothing carries over.
```

⚠ **Run 7's instance is spent without its claims being demonstrated** (C1–C5 all `NOT DEMONSTRATED`) —
consumption follows the *run*, not the *result*. The same rule as every instance above: a further
attempt starts from a blank template.

```
R4 live-run approval — RUN 7 ATTEMPT 2 (export+ingest) — CONSUMED (run FAILED closed)
- channel:            NAVER SmartStore review export (read)
- seller-account:     NAVER_DEV_SELLER_SELF_01
- date:               2026-07-24
- operator:           self (OPERATOR_SELF_01)
- run scope:          export+ingest
- backend:            disposable sellerops_run7_20260724T000758 on SERVER_PORT=18080, confirmed on
                      the run's own output; dropped at teardown (0 rows), name-guarded
- max live window:    25 minutes — timer-derived per dispatch record §15.4 finding 1; actual live
                      window ~2 min 15 s (00:26:55 open → 00:29:06 terminal)
- no-reply bound:     acknowledged — no composer, no REPLY_SUBMISSION, reply flag never passed
- §7 abort criteria:  acknowledged incl. Run 7's three additions
- G2/G3/G5 state:     G2 ✅ · G5 ✅ · G3 ✅ affirmed this same turn (2026-07-24 instance: same five
                      boxes as the 2026-07-23 instance above, affirmed fresh for the current
                      environment; Bridge N/A/CLI-loopback; the prior evening's UNLAUNCHED
                      affirmation was treated as VOID and never carried)
- P6:                 ✅ signed on G6 + G3 + standing same-tree G4 (783a9b4 unmodified, suites green
                      2026-07-23: backend 1502/0/2sk · collector-in-holder 4843/95 · frontend 765)
- outcome:            CONSUMED — the run drove once and FAILED closed: DOWNLOAD_TIMEOUT. One step
                      past attempt 1: the export action was OBSERVED (observed:true) and the
                      operator reports a started download, but the detector saw nothing in 60 s —
                      a download-detection gap (or NAVER delivery change), dispatch record §16.3.
                      Zero artifacts anywhere; zero ingest. NO ATTEMPT 3 until the gap is
                      reproduced and closed OFFLINE — a further attempt then still starts from a
                      blank template (fresh G3 + G6).
```

```
R4 live-run approval — RUN 7 ATTEMPT 3 (export+ingest) — CONSUMED (run COMPLETED)
- channel:            NAVER SmartStore review export (read)
- seller-account:     NAVER_DEV_SELLER_SELF_01
- date:               2026-07-24
- operator:           self (OPERATOR_SELF_01)
- run scope:          export+ingest
- code under proof:   871fccd (multi-checkpoint continuation runtime, §16.3/§17); holder-synced,
                      collector suite + 5 continuation proofs green inside the holder
- backend:            disposable sellerops_run7_20260724T011628 on 18080, confirmed on the run's
                      output; dropped at teardown (name-guarded), sellerops intact
- max live window:    55 minutes — timer-derived from the new multi-checkpoint worst case; actual
                      live window ~4 min 45 s (01:23:36 → ~01:28:21)
- no-reply bound:     acknowledged — no composer, no REPLY_SUBMISSION, reply flag never passed
- §7 abort criteria:  acknowledged incl. Run 7's three additions; §8 range confirmed on screen
- G2/G3/G5 state:     G2 ✅ · G5 ✅ · G3 ✅ affirmed this same turn (2026-07-24 attempt-3 instance:
                      five boxes for the current environment; Bridge N/A/CLI-loopback)
- P6:                 ✅ signed on G6 + G3 + G4-on-871fccd (collector suite + continuation proofs
                      green in the holder; backend 1502 / frontend 765 unaffected by the slice)
- outcome:            CONSUMED — the run drove once and COMPLETED 3-of-3: real download → validate →
                      parse-gate → ingest SUCCESS (58 rows, 0 skipped/failed); 0 continuation
                      checkpoints (this range took the Run-4 direct shape). C1 (compatibility) and
                      C3 (arrivals) PROVEN on real data; C2/C4 NOT DEMONSTRATED (§8 fallback — 0
                      answered rows in range); C5 BLOCKED by a backend-only 500. Full record:
                      r4-run7-…-dispatch-record.md §18. A retry for the reply-state headline needs
                      a fresh G3 + G6 AND a range that actually exports an answered low-rating review.
```

```
R4 live-run approval — RUN 7 ATTEMPT 4 (export+ingest) — CONSUMED (run FAILED closed)
- channel:            NAVER SmartStore review export (read)
- seller-account:     NAVER_DEV_SELLER_SELF_01
- date:               2026-07-24
- operator:           self (OPERATOR_SELF_01)
- run scope:          export+ingest
- code under proof:   b3864a7 (clean main — 871fccd continuation runtime + 3c77499 scroll-track /
                      readExportScope); holder-synced 871fccd→b3864a7, preserved paths byte-identical,
                      collector suite + visibility RUN_INTEGRATION 4/4 green in the holder
- backend:            disposable sellerops_run7_20260724T094747 on 18080, confirmed on the run's
                      output; dropped name-guarded at teardown, sellerops intact
- max live window:    55 minutes, timer-derived (multi-checkpoint worst case); actual barrier→timeout
                      ~60 s (10:06:21 observed → 10:07:21 DOWNLOAD_TIMEOUT)
- no-reply bound:     acknowledged — no composer, no REPLY_SUBMISSION, reply flag never passed
- §7 abort criteria:  acknowledged incl. Run 7's three additions; §8 read-back MECHANIZED
                      (readExportScope), operator confirmed the scope on screen before acting
- G2/G3/G5 state:     G2 ✅ · G5 ✅ · G3 ✅ affirmed this same turn (export+ingest, five boxes for the
                      current RESTORED environment; Bridge N/A/CLI-loopback)
- P6:                 ✅ signed on G6 + G3 + G4-on-b3864a7 (offline suites green: backend fresh ·
                      collector 4850/104sk + in-holder + visibility 4/4 · frontend 827)
- outcome:            CONSUMED — drove once, FAILED closed DOWNLOAD_TIMEOUT (2-of-3). The export
                      action was OBSERVED; the live NAVER surface then showed a SECOND operator-
                      required download control, but the continuation detector reported
                      checkpoints:0 (a candidate-DISCOVERY miss, dispatch record §19.3) and the 60 s
                      race lapsed. ZERO ingest, ZERO artifact, no public write, clean teardown.
                      C1/C3 stay PROVEN (attempt 3); C2/C4/C5 NOT DEMONSTRATED. A retry needs a fresh
                      G3 + G6 AND the offline candidate-discovery fix (dispatch record §20).
```

> **Read-only frame-aware probe — EXECUTED 2026-07-13:** [`r4-probe-dispatch-record.md`](r4-probe-dispatch-record.md)
> ran once under a fresh read-only-scoped G6 (now **CONSUMED**). Read-only success — the export surface is in
> the **top document** (child-frame hypothesis **refuted**), and Run-1 `UNSUPPORTED_STATE` is a
> **false-positive-empty readiness verdict** (rows visible on screen but not counted;
> [`r4-evidence-pack.md`](r4-evidence-pack.md) §8-10). No P6 / no export boundary applied. No gate flipped to
> passing; a fresh G6 is required for any further live contact.

**Export-pilot G6 — ☐ BLANK TEMPLATE (a blank template grants nothing; fill in the dispatching turn).**
The read-only-probe instance above does **not** carry over to an export run. To authorize the first
export pilot, fill and record a fresh instance of this shape in that turn:

```
R4 live-run approval — EXPORT PILOT (fill in the dispatching turn)
- channel:            NAVER SmartStore review export
- seller-account:     NAVER_DEV_SELLER_SELF_01
- date:               <YYYY-MM-DD>
- operator:           <operator>
- run scope:          export pilot (seller clicks the real export control; Runtime observes/detects/
                      validates/ingests read-only — full §4 boundary; NOT read-only, NOT unattended)
- §7 abort criteria:  acknowledged (ambiguous/missing/drifted target, unexpected post-state, session
                      invalid, artifact-validation failure → fail closed, zero clicks; operator abort
                      on withdrawn consent / unrecognized dialog / anti-abuse challenge)
- G2/G3/G5 state:     G2 ✅ recorded · G5 ✅ logged
                      G3 ☐ RE-AFFIRMED for an EXPORT run (§9-3 pause lift under full §4, not the
                      read-only scope) — per-run; the read-only ☑ does NOT carry over
- P6 state:           signed for this run (see the pre-dispatch runbook §P6 requirements)
```

This template, unfilled, **authorizes nothing** — it grants no live NAVER contact until an operator
records a filled instance in the dispatching turn. See the pre-dispatch runbook below for the full
pre-flight checklist.

**Run-5 G6 (barrier + observation) — ☐ BLANK TEMPLATE (a blank template grants nothing).**
A **third scope**, distinct from both templates above: the read-only-probe G6 was a **no-click** probe;
the export-pilot G6 is **click + confirm + ingest**. Run 5 is a real click on a real control that
**deliberately stops short of producing data**. Because the seller performs a real platform action it
still requires the **export-scoped G3 pause re-affirmation** under the full §4 boundary — the read-only
☑ does not carry over. Choreography:
[`r4-run5-barrier-observation-dispatch-record.md`](r4-run5-barrier-observation-dispatch-record.md).

```
R4 live-run approval — RUN 5 BARRIER + OBSERVATION (fill in the dispatching turn)
- channel:            NAVER SmartStore review export
- seller-account:     NAVER_DEV_SELLER_SELF_01
- date:               <YYYY-MM-DD>
- operator:           <operator>
- run scope:          barrier + observation. The seller clicks the real export control and
                      DELIBERATELY DOES NOT CONFIRM the resulting dialog — the ~60 s detect window is
                      allowed to lapse. NON-MUTATING by construction: no download → no validate → no
                      ingest. Full §4 boundary. NOT read-only (a real click occurs), NOT unattended,
                      NOT an export pilot.
- expected terminal:  FAILED · DOWNLOAD_TIMEOUT · progress 2-of-3 — the Run 3 (§8-16) shape.
                      A COMPLETED run means the seller confirmed, the run MUTATED, and the scope was
                      breached: report it plainly.
- §7 abort criteria:  acknowledged (ambiguous/missing/drifted target, unexpected post-state, session
                      invalid → fail closed, zero clicks; operator abort on withdrawn consent /
                      UNRECOGNIZED dialog / anti-abuse challenge). The expected export confirmation
                      dialog is NOT an abort trigger (§7 carve-out); NOT confirming it is the SCOPE,
                      not an abort.
- G2/G3/G5 state:     G2 ✅ recorded · G3 ☐ RE-AFFIRMED for a real-click run (§9-3 pause lift under
                      full §4 — the read-only ☑ does NOT carry over) · G5 ✅ logged
- P6 state:           ☐ signed for this run
- precondition:       the readiness-diagnostic offline slice merged + verified (G4: live is never a
                      code path's first execution). Without it the run emits nothing about
                      period/scope and cannot answer its own second question.
```

**Run-6 G6 (session recovery) — ☐ BLANK TEMPLATE (a blank template grants nothing).**
A **fourth scope**, distinct from all three above: the read-only-probe G6 was a no-click *probe*; the
export-pilot G6 is click + confirm + ingest; the Run-5 G6 is a real click that stops short of data.
**Run 6 clicks nothing at all** — it is non-mutating *by construction* (no click ⇒ no download ⇒ detect,
validate and ingest are **unreachable**, not declined), yet it drives the full engine and holds a live
browser far longer than any run to date. It needs the **`session recovery`-scoped G3** (§G3 above,
ratified 2026-07-17); no earlier scope carries over. Choreography:
[`r4-run6-session-recovery-dispatch-record.md`](r4-run6-session-recovery-dispatch-record.md).

⚠ **`max live window:` is a NEW field, ratified 2026-07-17 (product owner, [D-030](decisions.md)), and it
exists because A3 changed the answer.** D-028's boundary requires a fresh G3 + G6 per run but is **silent
on duration** —
and duration is what the recovery loop changed: ~21 min for Runs 1–5, **~32 min** here. The field makes
the operator affirm the seat time **explicitly** instead of inheriting it from the shape of earlier runs.
**It is required on this template and optional-but-encouraged on the others**; a G6 whose scope adds a
new wait must state it.

```
R4 live-run approval — RUN 6 SESSION RECOVERY (fill in the dispatching turn)
- channel:            NAVER SmartStore review export
- seller-account:     NAVER_DEV_SELLER_SELF_01
- date:               <YYYY-MM-DD>
- operator:           <operator>
- run scope:          session recovery. The seller DELIBERATELY DOES NOT LOG IN before the first
                      signal, so the run PARKS on LOGIN_REQUIRED; they then log in, RETURN TO THE
                      REVIEW-EXPORT SURFACE themselves, and signal a SECOND time; the Runtime
                      re-probes for real. ZERO CLICKS — the seller never acts on the highlighted
                      control and the observe window is allowed to lapse. NON-MUTATING BY
                      CONSTRUCTION: no click → no download → detect/validate/ingest UNREACHABLE, not
                      declined. Full §4 boundary. NOT read-only (the full engine drives a live
                      browser), NOT an export pilot, NOT a barrier run, NOT unattended.
- max live window:    ~32 min worst case — CONFIRM_TIMEOUT_MS 10m + RECOVERY_BUDGET_MS 10m (SHARED
                      across up to MAX_RECOVERY_ATTEMPTS, not per attempt) + OBSERVE_TIMEOUT_MS 10m
                      + DOWNLOAD_TIMEOUT_MS 60s = 31m of budgeted waits, plus launch/probe overhead.
                      ⚠ Affirm the FULL window, not the healthy-path ~21m: the recovery budget is
                      spent only if the run PARKS, which for this scope IS the design.
- expected terminal:  FAILED · DOWNLOAD_TIMEOUT · progress 2-of-3 — the Run 3 (§8-16) shape.
                      A PARK at 0-of-3 is NOT a failure; it is the SUBJECT of the run.
                      A COMPLETED run means the seller clicked AND confirmed, the run MUTATED, and
                      the scope was breached: report it plainly.
- §7 abort criteria:  acknowledged (ambiguous/missing/drifted target, unexpected post-state,
                      artifact-validation failure → fail closed, zero clicks; operator abort on
                      withdrawn consent / unrecognized dialog / anti-abuse challenge).
                      ⚠ Run 4's confirmation-dialog carve-out DOES NOT APPLY — no click means no
                      dialog, so ANY prompt or dialog on the export surface is an abort.
                      ⚠ A LOGIN_REQUIRED park is NOT an abort (§7, D-028).
- G2/G3/G5 state:     G2 ✅ recorded · G5 ✅ logged
                      G3 ☐ AFFIRMED FOR THIS RUN, `session recovery` scope (§G3 instance recorded in
                      this same turn) — per-run; no earlier scope carries over
- G4 state:           ☐ addressed on the record in this turn citing §8-22 (§G4 above), incl. the two
                      named live-first residuals — NOT inherited from the static ✅
- P6 state:           ☐ signed for this run
- precondition:       the tree under test CONTAINS A3 (the recovery loop) — verify, do not assume;
                      a tree without it reproduces Run 5's behaviour and answers nothing while still
                      spending the G6
```

This template is a template; unfilled it authorizes nothing. **One `session recovery` instance has now been
filled and CONSUMED (below); a fresh single-use G6 is required for any further contact.**

```
R4 live-run approval — RUN 6 SESSION RECOVERY — CONSUMED (authorizes nothing further)
- channel:            NAVER SmartStore review export
- seller-account:     NAVER_DEV_SELLER_SELF_01
- date:               2026-07-17
- operator:           self
- run scope:          session recovery — parked logged-out, recovered post-login, ZERO CLICKS,
                      non-mutating by construction. Full §4 boundary.
- max live window:    ~32 min affirmed; ~11 min recovery→terminal actually elapsed (1 recovery
                      attempt; MAX_RECOVERY_ATTEMPTS 3 never approached).
- §7 abort criteria:  acknowledged (no dialog appeared; a LOGIN_REQUIRED park is not an abort).
- G2/G3/G5 state:     G2 ✅ · G3 ✅ (`session recovery` scope, affirmed this turn) · G5 ✅
- G4 state:           addressed on the Run-6 record citing §8-22 (D-030); the two named residuals
                      (page.content() mid-nav, main()'s recovery-branch settleSpa) were live-exercised
                      in this run WITHOUT a driver-error — one observation, not a closure.
- P6 state:           signed for this run (session recovery only).
- outcome:            CONSUMED — one run executed 2026-07-17. Recovery LIVE-PROVEN
                      (aw.live.recovery { outcome: "recovered", attempt 1 }; readiness LOGGED_IN /
                      READY post-login). Terminal FAILED · DOWNLOAD_TIMEOUT · progress 2-of-3;
                      Operation Run run_57ab9b52a3c0 persists the same (humanCheckpoint reached:true
                      observed:false). NON-MUTATING held: no click/download/quarantine/ingest, backend
                      never called, downloads/ untouched, worktree clean. Sanitized detail in
                      r4-evidence-pack.md §8-23. NO retry under this G6.
```

This instance is **spent**. Each subsequent live run requires a **NEW** G6 instance filled in that
dispatching turn under the full §4 boundary; a past `recovered` is an observation, not a standing
authorization.

---

## Export-pilot pre-dispatch runbook — NOT YET AUTHORIZED (grants nothing)

> **This runbook authorizes NO live NAVER contact.** It assembles, in one place, the pre-flight checklist
> for the first supervised export pilot so a future dispatching turn has a single honest reference. Live
> is granted **only** by a filled export-scoped G6 (above) in that turn, under the full §4 boundary. No
> box below being present or checked implies live-ready; every gate here is still ☐.
>
> **Dispatch record:** [`r4-export-dispatch-record.md`](r4-export-dispatch-record.md) — the single
> G3/G6/P6 sheet for the export run. **Run 1 was EXECUTED 2026-07-13 and FAILED fail-closed
> (`UNSUPPORTED_STATE`, zero clicks, nothing captured; [`r4-evidence-pack.md`](r4-evidence-pack.md) §8-8).**
> **Status update 2026-07-15 — the pilot SUCCEEDED in Run 4**: `COMPLETED` 3-of-3, real download →
> validate → `/api/uploads` ingest, backend `SUCCESS` 55/55/0/0 ([`r4-evidence-pack.md`](r4-evidence-pack.md)
> §8-17; [`r4-run4-full-export-pilot-dispatch-record.md`](r4-run4-full-export-pilot-dispatch-record.md)).
> **No gate here is flipped to passing regardless, and this runbook still grants nothing** — every G6 and
> P6 to date is **CONSUMED**, so *any* further live contact (including a read-only diagnostic) needs a
> **fresh** G3-export + G6 in its own dispatching turn. A past success is not a standing authorization.
>
> **Operator choreography for the run itself:** [`r4-operator-runbook.md`](r4-operator-runbook.md) —
> what the human does, in order, including the ~60 s click+confirm window. It grants nothing either.

### Scope of the first authorized export pilot

ONE supervised, seller-consented, **user-direct** export run on `NAVER_DEV_SELLER_SELF_01`. The **seller
(human)** logs in, completes 2FA/CAPTCHA/account-lock, selects account/store/marketplace/period, and
**clicks the real export/download control**. The **Runtime only** prepares/validates the session
precondition → highlights the one control → **observes** (never simulates) the click → verifies the
transition → **detects** the download read-only → quarantine-validates the artifact (temporary save →
magic sniff → delete) → hands it to the existing ingestion path → persists the audited Operation Run.
Governed verbatim by [`r4-preparation.md`](r4-preparation.md) §4. **Not** in scope: unattended/scheduled
operation, multiple runs, or any SellerOps-performed click.

### 1 · G3 environment + pause re-affirmation for an EXPORT run (operator's "P4")

> **Label note:** the operator's shorthand "P4 environment/pause" maps here to **G3 + §9 item 3**. In the
> repo, **P4 = R3 Operation Run persistence (✅ merged, PR #219)** — a different, already-satisfied row —
> and is **not** what an export run re-affirms. This block does not touch P4.

**G3 is per-run** (D-026) — there is no standing G3 to carry in. The recorded §G3 instance is scoped to the
**read-only §8-4 probe only** and is **CONSUMED**. Before an export run, affirm a fresh instance **under the
full §4 scope** (all ☐ until the dispatching turn):

- ☐ Stable network / IP / location still holds (the condition that paused NAVER live work).
- ☐ Dedicated Chrome connection profile intact; Bridge paired; Operation Run persistence enabled.
- ☐ **§9 item 3 pause lift re-affirmed for an EXPORT run** — a fresh, export-scoped lift; the recorded
  read-only ☑ (§G3) does **not** carry over.

### 2 · P6 supervised-pilot internal sign-off requirements

P6 ([`r4-preparation.md`](r4-preparation.md) §1) is signed **only** when, for this export run:

- ☐ G1, G2, G4, G5 all ✅ (already: D-021/D-024; G4 synthetic ladder green). **G3 is not in this list** —
  it is per-run (D-026) and is carried by the next box, matching the signed
  [`r4-export-dispatch-record.md`](r4-export-dispatch-record.md) block A, which lists the static gates as
  G1/G2/G4/G5/P7/P10 and omits G3.
- ☐ An **export-scoped G6** recorded in the dispatching turn (§G6 template above, filled).
- ☐ **G3 affirmed for export** (block 1 above) — a fresh, export-scoped instance.
- ☐ **§7 abort criteria acknowledged** for this run (block 3 below).

**P6 stays ☐ until an actual dispatching turn records the export-scoped G6 + the G3 re-affirmation. This
runbook does not sign P6.**

### 3 · Abort criteria

Full definitions in [`r4-preparation.md`](r4-preparation.md) §7 (not re-authored here). Summary:

- **Operator-immediate:** withdrawn consent; any unrecognized prompt/dialog; any anti-abuse signal
  (CAPTCHA storm / lockout warning); any on-screen data the seller did not expect to share. The human
  completes or walks away; the Runtime never retries around it.
- **Automatic fail-closed:** ambiguous/missing/drifted target, unexpected post-state, invalid session,
  or artifact-validation failure → blocker code, **zero clicks**, run persisted and resumable per R3.
  ⚠ **CORRECTED 2026-07-16 ([D-028](decisions.md)) — this line said "persisted FAILED".** A
  `LOGIN_REQUIRED` / `SESSION_EXPIRED` session now **parks** recoverable instead (the seller can fix it;
  a recheck re-probes). Everything else still fails closed to FAILED. **The four guarantees above are
  unchanged** — blocker code, zero clicks, manual progress, persisted+resumable. Normative text is
  [`r4-preparation.md`](r4-preparation.md) §7; **this register restates it as a convenience and §7 wins.**
- **Before a run drives:** Ctrl-C aborts; a sentinel timeout aborts without driving a run.

### 4 · Live entrypoint command — DO NOT RUN (future dispatch documentation only)

```
# NAVER live work is PAUSED. Run ONLY in a dispatching turn with a filled export-scoped G6 (§G6 above).
set -a && . ./.env && set +a          # loads NAVER_REVIEW_URL + COLLECTOR_BROWSER_CHANNEL (never echo values)
npx tsx src/cli/run-action-window-live-naver.ts -- --i-understand-this-opens-live-naver
```

Built-in refusals (defense-in-depth): missing approval flag → exit 3; `NODE_ENV=production` → exit 4;
missing `NAVER_REVIEW_URL` → exit 2. **Sentinel handshake:** the CLI opens the window and waits — the
seller logs in and reaches the export surface, then signals readiness (in Claude Code, say "ready") only
**before** touching the control; the Runtime then highlights and waits for the seller's real export click.
No raw URL / path / credential value appears here — only the env-load idiom and the safety flag.

### 5 · Post-run evidence to record (sanitized)

After the run, record in [`r4-evidence-pack.md`](r4-evidence-pack.md) as a new dated **§8-N** section —
enums/booleans/counts/SHA only, per §4 and `findProhibitedFields` (**never** URL, filename, path,
selector, page content, credentials, cookies, tokens, or `eventTimeMs`). Run 1 was written up in **§8-8**;
the export pilot ran through to **§8-17** (Run 4), which is the worked example of a `COMPLETED` run —
including its mutation note:

- ☐ The filled export-scoped G6 instance (dispatching turn, date, operator, scope).
- ☐ Final run view: `{ status, progress, channelCode, blockerCode? }` only.
- ☐ Ingest outcome `{ ok, processed }`.
- ☐ Quarantine validate result + dir-emptied confirmation.
- ☐ No-leak assertion (`findProhibitedFields == []` across wire + store).
- ☐ The Operation Run id (`run_…`) for the audit trail.

---

## Gate summary

- **G1 ✅ · G2 ✅ · G4 ✅ · G5 ✅** (static — carried in). ⚠ **G4's static ✅ predates A3/A4 and is not an
  answer for code that postdates it** — a run addresses G4 on its own record, citing the proof (§G4). One
  such ratification exists: **G4 carries for Run 6 on §8-22**, with two named live-first residuals
  preserved. It is scoped to that run and generalizes to nothing.
- **G3 ☐ per-run · G6 ☐ per-run** — the two live gates ([`decisions.md`](decisions.md) D-026), both
  **never standing**, both operator/PO-owned, neither Runtime code. Each is affirmed **fresh in the
  dispatching turn**, scoped to that one run, and **consumed** with it. A read-only-probe instance of each
  was affirmed and **consumed 2026-07-12** (the §8-4 probe is complete); the seven executed dispatch records
  each spent their own. An export, ingest, real-click, or **session-recovery** run needs a **fresh,
  scope-matched G3 and a fresh single-use G6** under the full §4 boundary (§G3, §G6, runbook §1).
  ⚠ **Neither has failed** — `☐ per-run` is the category label for a gate that cannot be standing, not a
  failure marker. ⚠ **A ratified SCOPE is not an affirmed GATE:** `session recovery` was ratified as a
  fifth G3 scope 2026-07-17 and a Run-6 G6 template now exists — **no instance of either has been filled.**
- The first authorized live contact — the **read-only session-precondition probe** — **was completed
  2026-07-12**; its sanitized `{ ready, verdict }` result (`ready:true` / `LOGGED_IN`, no blocker) is
  recorded in [`r4-evidence-pack.md`](r4-evidence-pack.md) §8-4. The next live step (export pilot) needs a
  **new** G6 under the full §4 boundary.

## Related

- Gate definitions + readiness → [`r4-preparation.md`](r4-preparation.md) §3/§4/§5/§9
- Durable decisions → [`decisions.md`](decisions.md) D-019/D-021/D-024
- Dated readiness evidence → [`r4-evidence-pack.md`](r4-evidence-pack.md) §8-1/§8-5
- Living handoff state → [`current-state.md`](current-state.md)
