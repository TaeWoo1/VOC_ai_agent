# Run 7 — NAVER reply-state live proof — **DISPATCH RECORD (EXECUTED · COMPLETED on attempt 3)**

> ## ✅ ATTEMPT 3 — 2026-07-24 — **COMPLETED 3-of-3, REAL INGEST · G3 + G6 CONSUMED**
>
> The multi-checkpoint runtime (`871fccd`, holder-synced) drove the export to a real `COMPLETED`:
> export click **observed** (01:27:58), a **direct download** (0 continuation checkpoints — this
> range delivered the Run-4 sync shape, not the attempt-2 notification flow), validated +
> parse-gated + **ingested `SUCCESS`** (58 rows, 0 skipped / 0 failed) into the disposable backend.
> Live contact 01:23:36 → ~01:28:21, well inside the 55-min window.
>
> - **PROVEN (C1/C3):** a real NAVER export is compatible and ingests end to end — all mapped fields
>   non-null across 58 rows (`body`/`rating`/`received_at`/`external_id`/`reply_state` = 58/58),
>   `received_at` time-bearing and quantised to **UTC midnight 58/58**, and **`답글여부` matched its
>   exact-key alias** producing valid reply-states (all `PENDING`, zero `UNKNOWN` — the column was
>   present and read). Arrivals whole: 58 `NEW_REVIEW`; rating split low/mid/high = 1 / 1 / 56.
> - **NOT DEMONSTRATED (C2/C4 — the reply-state headline):** the exported range held **0 answered
>   reviews**, so "an answered review leaves the queue" and "guided reply refuses an answered review"
>   could not be shown — the **§8 fallback**, recorded not passed. ⚠ Diverges from the operator's
>   on-screen §8 confirmation; the range that actually exported evidently differed from that view
>   (all 58 rows are a single recent date). **C5** (mint on a PENDING row) was **blocked by a 500 on
>   the triage/draft endpoints** — since RESOLVED (§18.4-3): the live chain used the wrong
>   method/path; the correct chain mints a submissionRef end to end, and the investigation found +
>   fixed a real 405-masked-as-500 defect (`fix/method-not-allowed-500-masking`).
> - Teardown clean: DB dropped (name-guarded), `sellerops` intact, zero artifacts, secrets scrubbed,
>   holder `.env`/profile untouched. Both 2026-07-24 gates **CONSUMED**. Full record: **§18**.
>
> **A first live SUCCESS for the continuation-checkpoint runtime**, and the multi-step choreography
> was proven safe live even though this range happened to take the direct path.

> ## ▶ DISPATCHED 2026-07-23 (second attempt) — **RUN EXECUTED · FAILED CLOSED (`DOWNLOAD_TIMEOUT`) · G3 + G6 CONSUMED**
>
> The deferral below was lifted in a fresh dispatching turn on 2026-07-23: the operator affirmed a
> **fresh G3** (`export+ingest`, current environment — starting with the network box that voided the
> first attempt) and a **fresh single-use G6** (15-minute live window, no-reply bound), stated
> **"seated and ready"**, and the live window opened at 23:42:46 KST. The run drove once and
> **FAILED closed on `DOWNLOAD_TIMEOUT`** — readiness on the real page was fully green
> (`LOGGED_IN` · `READY` · `positive_count` · `selectedRangePresentLive=true`), the export control
> was highlighted, but no export action produced a download inside the windows. **No download ⇒ no
> artifact ⇒ nothing ingested; zero rows at teardown.** Both gates are **CONSUMED** — a retry needs
> a fresh G3 + G6. Execution record, timeline, and findings: **§15**; filled evidence template: §11.
> C1–C5 are all **NOT DEMONSTRATED** — the run ended at the human export barrier.
>
> **↳ ATTEMPT 2 — 2026-07-24, fresh G3+G6 (25-min timer-derived window), ALSO FAILED closed on
> `DOWNLOAD_TIMEOUT` — but one step further:** the runtime **observed the export action**
> (`observed:true`); the operator confirmed the expected dialog. **RECLASSIFIED (operator
> clarification, 2026-07-24): an INCOMPLETE HUMAN-CHECKPOINT WORKFLOW, not a missed download
> event** — after the confirmation a **second NAVER-native in-page notification/dialog** appears
> before the actual download, carrying a control the seller must still act on; the state machine
> modeled only ONE human step, so nothing highlighted or awaited that control and the 60 s download
> deadline ran from the FIRST action. §16.3 (reclassification) and §17 (the offline
> continuation-checkpoint slice). Zero artifacts anywhere, zero rows ingested, guarded teardown
> clean. Both 2026-07-24 gates CONSUMED (§16).

> ## ⏸ DEFERRED 2026-07-23 (first attempt) — **NOT DISPATCHED, NOT CONSUMED, NO LIVE CONTACT**
>
> **What happened:** a G6 approval was given on 2026-07-23 (channel NAVER SmartStore · REVIEW export ·
> account `NAVER_DEV_SELLER_SELF_01` · operator `OPERATOR_SELF_01` · scope `export+ingest` ·
> `max live window: 15 min`), with the G3 boxes and §7 affirmed in the same turn. **The run was never
> dispatched.** Before any browser opened, the run was found unexecutable from the development
> checkout (the code under proof and the NAVER profile were in two different repositories), and while
> that was being resolved the operator reported that the **current network / IP differs** from the
> environment the G3 affirmation described.
>
> **G3's first box — "stable network / IP / location still holds" — is therefore FALSE**, and it is the
> very condition that paused NAVER live work in the first place ([`r4-preparation.md`](r4-preparation.md)
> §3, §9-3). A G3 affirmed against a different environment cannot be carried into this one.
>
> **State of the gates:**
>
> - **G6 — UNCONSUMED.** An approval is consumed by a **run**, and no run occurred. It is **not** spent,
>   and it is equally **not** available: it named a date and an environment that no longer describe the
>   situation. A future dispatch needs a **fresh** single-use G6, not this one revived.
> - **G3 — VOID for this environment.** Per-run and non-inheritable by construction (D-026); the
>   network condition alone would invalidate it.
> - **P6 — still ☐.** It is signed only in a dispatching turn that records both.
> - **Zero live contact.** No browser launched, no login, no export, no marketplace page, no download.
>   Nothing was ingested; no disposable database was created for a live run.
>
> **What DID happen, and stands:** the offline preparation (§12) and the holder sync. The
> `naver-r4` runtime holder was synced to `b5f0683` and **stays there** — it now carries the code under
> proof, verified with every preserved path byte-for-byte unchanged (§14). That work is not wasted by
> this deferral; it is exactly the prerequisite a future dispatch would otherwise have to do first.
>
> **To dispatch later:** re-affirm G3 **for the environment as it then is** (starting with the network
> box), record a **fresh** G6 in that turn, confirm the range precondition (§8) on screen, and state
> **"seated and ready"** before the browser opens.

> **STATUS: DRAFT. This document authorizes NOTHING.** No gate below is filled, and a filled gate is
> the only thing that authorizes live contact. A live NAVER run needs a **per-run G3** (`export+ingest`
> scope) **and a fresh single-use G6** naming channel / seller account owner / date / operator / the
> §7 abort criteria / `max live window:` — both affirmed **in the dispatching turn**
> ([`r4-preparation.md`](r4-preparation.md) §3, [`r4-gate-record.md`](r4-gate-record.md)). A plan, a
> prior approval, and goal pressure are never authorization.

- **Proposed run:** Run 7 — reply-state live proof
- **Channel / DataType:** NAVER SmartStore · REVIEW export (read)
- **G3 scope required:** `export+ingest` — an already-ratified scope (Run 4's). **No new scope**, and
  scopes never substitute for one another.
- **Mutating?** Yes, exactly as Run 4 was: a real export is ingested. **Into a disposable database
  that is dropped when the run ends** (see *Data-protection posture*).
- **Posts a reply?** **No. Never.** See *The one thing this run must not do*.

---

## 1. Why this run

Two slices landed offline — the acquisition spine and reply-state preservation — and **every claim in
both rests on synthetic fixtures**. The measurement that motivated them (33% of a real export's
low-rating reviews were already answered) came from reading a real export **offline**; it has never
passed through the running pipeline.

What no offline test can establish:

- that a **real** export is **compatible** with the mapping — that the columns the canonical model
  depends on are present under names the aliases match, that its review date is the time-bearing
  form, that `답글여부` / `답글등록일시` are there on rows the seller recognises as answered, and that
  the whole file **ingests successfully**;
- that reply state survives the real acquisition path end to end;
- that an already-answered review actually leaves the operator's queue on real data;
- that the guided reply flow **refuses** a review the channel already answered.

## 2. The one thing this run must not do

**No public reply is posted, drafted into a composer, or typed anywhere.**

The duplicate-reply guarantee is proven by a **refusal** — a `409` from `startSubmissionRun`. That is
inherently safe to demonstrate: the evidence *is* the absence of an action. Concretely:

- `--i-understand-this-posts-a-live-naver-reply` (`collector/src/cli/live-run-approval.ts:58`) is
  **never passed**, and no `REPLY_SUBMISSION` run is started.
- No composer is opened, highlighted, or observed. The reply-submission engine is not invoked.
- §4.1's amendment (the write-side boundary) is **not** in scope, because there is no write.
- The verification steps that touch the reply flow (§6) are **HTTP calls to the local disposable
  backend** — they involve **no NAVER contact at all** and sit entirely outside the live window.

## 3. Posture

| | |
|---|---|
| Live contact | ONE export run, human-driven, on the operator's own dev seller |
| Runtime does | prepare/validate session precondition · foreground the window · highlight ONE control · observe · verify · detect download read-only · quarantine-validate · parse-gate (D-037) · ingest · persist the audited run |
| Runtime never | types credentials · bypasses login/2FA/CAPTCHA · selects account/range · **clicks export** · chains clicks · runs unattended · emits selectors/URLs/page content/paths |
| Seller does | logs in · selects the range · **clicks export** · **confirms the expected NAVER dialog** |
| Ingest | **ON** (`--no-ingest` deliberately OMITTED — the run's whole point is what lands) |
| Backend | **disposable**, dropped at teardown |

**Product-boundary check** (`collector/CLAUDE.md` §4.7), answered before dispatch: this is
**product-path behaviour**, not a diagnostic exception. The seller performs the platform action;
SellerOps detects, validates, and processes the result. The human-driven alternative *is* the design.

## 4. Preconditions — ☐ to be verified at dispatch

- ☑ Offline suites green on the unmodified tree (backend 1418 · collector 4843/95 · frontend 668) —
  **G4: live is never the first execution of any code path.** Verified 2026-07-23 (§12).
- ☐ Dedicated Chrome profile intact; stable network / IP / location.
- ☐ Operation Run persistence enabled.
- ☑ Disposable-DB path rehearsed (Phase A + Phase D, guard falsified) 2026-07-23 (§12).
  ☐ A **fresh** disposable database created for the actual run and confirmed as the ingest target.
- ☐ Operator seated and ready ("a no-click failure means operator-absent first, not a code bug").
- ☐ **Range precondition (§8) confirmed ON SCREEN by the seller BEFORE the live window opens.**

## 5. Choreography

### Phase A — prepare (no live contact)

1. Create a uniquely-named disposable database — `sellerops_run7_<stamp>` — with a name guard that
   refuses any target not carrying that prefix, so `sellerops` can never be the argument to `dropdb`.
2. Start the backend on `SERVER_PORT=18080` against it (Flyway migrates; `MockDataSeeder` seeds the
   channels because the database has no organizations).
3. Point the collector's ingest at it via **environment only** — `SELLEROPS_BASE_URL`,
   `SELLEROPS_EMAIL`, `SELLEROPS_PASSWORD` (`collector/src/config.ts:120-122`). **No code change.**
4. **Dry-run teardown now** (drop it, confirm `sellerops` intact, re-create) so the blast-radius
   controls are rehearsed before a single real row exists.

### Phase B — the live window

The seller logs in on the dedicated profile, reaches 리뷰 관리, and selects the range confirmed in §8.
Then, with approval affirmed in the dispatching turn:

```
npx tsx src/cli/run-action-window-live-naver.ts --i-understand-this-opens-live-naver
```

The export is a **TWO-step human action** (Run 4 finding): acting on the highlighted control raises an
**expected** NAVER confirmation dialog the seller must confirm, and the download fires only then. Both
steps land inside the observe → download windows, whose durations the CLI prompt interpolates from the
timers. That dialog is **expected and is NOT a §7 abort trigger**; every *unrecognized* prompt still is.

Live contact ends when the browser closes.

### Phase C — verification (no NAVER contact)

Documented `curl` against the disposable backend. Each step records a **sanitized** result.

**C1 — the real export is COMPATIBLE and ingests.** The run's own sanitized output: status `SUCCESS`,
row counts. Compatibility is then read off the Phase D census, not off the file:

- every **required mapped column** landed — `body`, `rating`, `received_at`, `external_id` non-null
  across the ingested rows;
- `received_at` parsed from the **time-bearing** review date (non-null, quantised to UTC midnight by
  the shared `DateParse` path — the branch a date-only value never exercises);
- the **reply-state fields** landed — `reply_state` populated on every row, with `replied_at` where
  the export supplied one.

⚠ **Deliberately NOT claimed: "all 25 headers, in exact order."** That would need the artifact
retained to hash, which the D-021 delete-after-validate posture forbids — and it is the wrong
question. A populated field proves the column was present **and its header matched the alias**, which
is what the pipeline actually depends on; a header hash proves only that a string appeared. Column
order is irrelevant to `HeaderAliases.pick`, which is an exact-key lookup on a header-keyed map. The
seller's on-screen view of the column set is recorded as an operator observation, nothing more.

**C2 — the queue excludes answered reviews.**
`GET /api/seller-accounts/{id}/attention?from=&to=` → low-rating counts.
`GET …/attention/items?type=LOW_RATING_REVIEW&from=&to=` → **every** row's `replyStatus` is `PENDING`
or `UNKNOWN`, **never `ANSWERED`**.

**C3 — arrivals stay whole.**
`GET …/attention/items?type=NEW_REVIEW&from=&to=` → the answered rows **are** present. C2 and C3
together are the claim: excluded from the queue, still counted as arrivals.

**C4 — the refusal (the headline).** Take an **ANSWERED** row's `actionRef` **from the C3
`NEW_REVIEW` list** — ⚠ **it cannot come from the `LOW_RATING_REVIEW` list, because its absence there
is precisely what C2 proves.** Then, against the disposable backend only:

```
PUT  …/attention/items/{actionRef}/triage        {"disposition":"RESPONSE_NEEDED", …}
POST …/attention/items/{actionRef}/reply         (save draft)
POST …/attention/items/{actionRef}/reply/approval (approve)
POST …/attention/items/{actionRef}/reply/submission-run
```
→ **expect `409`**, with the message naming the already-answered reason.

**C5 — the refusal is not vacuous.** The **same** chain on a **PENDING** row → **expect a minted
`submissionRef`** → **STOP.** The ref is left unused and no outcome is recorded; **no guided run is
started**. Without C5, a 409 caused by an unrelated defect would read as success.

### Phase D — pre-teardown evidence capture (sanitized), THEN teardown

Captured **before** the database is dropped, because the aggregates are the evidence and the rows are
not:

- **Mapped-field census** — per-field non-null counts across the ingested rows: `body`, `rating`,
  `received_at`, `external_id`, `reply_state`, `replied_at`. This is C1's compatibility evidence: a
  populated field means the column was present **and its header matched the alias**, which is what
  the pipeline depends on. ⚠ **A header count/order hash is deliberately NOT taken** — it would
  require retaining the artifact (D-021 forbids it) and proves less. The column set the seller sees
  on screen is recorded as an operator observation instead.
- **Timestamp distribution** — how many `received_at` values are non-null and at UTC midnight
  (the shared `DateParse` quantisation), confirming the 20-char form parsed.
- **Reply-state distribution** — counts of `ANSWERED` / `PENDING` / `UNKNOWN`, plus the low-rating
  split (answered vs not).
- **`replied_at` correlation** — how many `ANSWERED` rows carry a date, and how many `PENDING` rows
  wrongly do. **Recorded, never asserted** — see §7.

Then: stop the backend · `dropdb` the run's database (name-guarded) · confirm `sellerops` intact ·
sweep quarantine · confirm no downloaded artifact remains anywhere.

## 6. Data-protection posture

A real export carries real customer review bodies plus `등록자` / `상품주문번호` / `유저정보 등록 항목`
(High/Medium sensitivity in the §S analysis). Three bounds:

1. **A narrow range** — the smallest window that can still demonstrate the claims (§8).
2. **A disposable database, dropped at teardown** — real review text never outlives the run. This is
   deliberately stronger than Run 4, which left 55 real rows in the persistent dev database.
3. **Sanitized evidence only** — counts, distributions, booleans, HTTP statuses. No review text, no
   reviewer, no order number, no raw channel id, no raw timestamp. The quarantine artifact is deleted
   inside the validation window (D-021) and the browser's own copy is dropped by the driver.

## 7. `replied_at` — an observation, not an assertion

On the one real export inspected offline, the correlation is perfect: **1,230 of 1,230** answered rows
carry `답글등록일시`, and **0 of 2,621** pending rows do.

**It is still recorded, not asserted.** One file is not a platform guarantee, and the implementation
deliberately tolerates the gap: `IngestionService.refreshReplyState` supports a date that arrives in a
*later* import than the state it belongs to, and `ReviewRowMapper` swallows an unparseable reply date
rather than failing the row. Aborting this run on a missing `replied_at` would contradict the
tolerance the code was written to have. If the census shows an `ANSWERED` row without a date, that is
a **finding to record**, not a failure.

## 8. Range precondition — and the abort it implies

Claim C2 needs at least one **answered low-rating** review inside the exported range. On the real
export, low-rating rows were ~2% of the file and about a third of those were answered, so a very
narrow range may contain **none**.

**Therefore: the seller confirms on screen, BEFORE the live window opens, that the chosen range shows
at least one answered low-rating review.**

- **Preferred: abort before the live run.** If no answered low-rating review is visible, widen the
  range slightly and re-check, or **do not open the live window at all**. No live contact is spent on
  a run that cannot demonstrate its own headline claim.
- **Fallback, only if this is discovered after the fact:** the run still stands for C1/C3/C4/C5, and
  **C2 is recorded as `NOT DEMONSTRATED — no answered low-rating review in range`**. It is never
  quietly dropped, and never reported as passed on an empty set.

## 9. Abort criteria

[`r4-preparation.md`](r4-preparation.md) §7 applies verbatim and unchanged — including the carve-out
that the **expected** NAVER export confirmation dialog is not an abort trigger while every
*unrecognized* prompt is. Run-specific additions:

- ☐ The range precondition (§8) fails at the seat → **abort before opening the live window**.
- ☐ The disposable database is not confirmed as the ingest target → **abort** (a real export must
  never land in the persistent dev database on this run).
- ☐ Any prompt suggesting a reply/composer surface → **abort**; this run has no write scope.

## 10. Non-claims — written before the run, not after

- **Does NOT prove the monotonic refresh transition.** Observing `PENDING → ANSWERED` across two
  exports would require a reply to be posted between them, which this run forbids. That rule stays
  offline-proven (`ReviewReplyStateIngestTest`).
- **Does NOT prove reply submission.** Never attempted; `COMPLETED` remains impossible for a reply.
- **Promotes nothing in §4.1.** NAVER REVIEW is already `라이브 검증`; a second run adds evidence, not
  status, and `운영 지원` stays file-upload-only. The ledger is untouched.
- **Says nothing about ESM+**, whose `답변 상태` vocabulary remains unobserved.
- **One seller, one account, one range, one run**, on a local disposable backend — never production.

## 11. Post-run evidence — FILLED 2026-07-23 (sanitized)

```
Run 7 — 2026-07-23 — OPERATOR_SELF_01 — G3 (export+ingest) CONSUMED · G6 CONSUMED
Outcome:            FAILED + DOWNLOAD_TIMEOUT (2-of-3 steps; fail-closed)
Ingest:             not reached — no download, no artifact; disposable DB at 0 reviews / 0 sync_jobs
C2 queue exclusion: NOT DEMONSTRATED — run ended at the export barrier (before any export)
C3 arrivals whole:  NOT DEMONSTRATED
C4 refusal:         NOT ATTEMPTED          C5 non-vacuity: NOT ATTEMPTED
Census:             none — nothing ingested, so no census exists
Teardown:           DB dropped ☑ (name-guarded) · sellerops intact ☑ (only surviving sellerops* DB)
                    quarantine empty ☑ · no artifact ☑ · run-local credentials file removed ☑
Findings:           see §15.4 — the 15-minute cap cannot contain the CLI's own timers; the highlight
                    moment is not logged; live readiness path proven green up to the human barrier
```

## 12. Pre-dispatch preparation — ☑ COMPLETED 2026-07-23 (no live contact)

> ⏸ **Superseded in part by the deferral at the top of this file.** The evidence below stands as
> recorded; what it no longer implies is readiness — the environment it was gathered in is not the
> environment a future run will start from.

Recorded here because these are the two things that must be true *before* a dispatching turn, and
neither of them is a gate.

**G4 evidence — offline suites green on the unmodified tree** (live is never the first execution of
any code path):

| Suite | Result |
|---|---|
| backend | **1418 passed**, 0 failures, 0 errors |
| collector | **4843 passed / 95 skipped** (218 files); `typecheck` clean |
| frontend | **668 passed** (62 files); `tsc --noEmit` clean |

Working tree carried only this document — no uncommitted code.

**Disposable-DB rehearsal — Phase A + Phase D exercised end to end, with no live window:**

- created `sellerops_run7_rehearsal_<stamp>`; booted the backend against it on `SERVER_PORT=18080`;
- confirmed it answers (`/api/channels` 401 unauthenticated → authenticates → **NAVER channel seeded**,
  so a fresh org can resolve the channel and register its file-channel account);
- **name guard falsified**: the drop guard was tested against `sellerops` and `sellerops_dev` and
  refused both, so the persistent dev database cannot be the argument;
- stopped the backend, dropped the rehearsal database, confirmed **`sellerops` is the only remaining
  `sellerops*` database**, and confirmed no quarantine residue.

The blast-radius controls are therefore rehearsed before a single real row can exist.

## 13. PROPOSED gate values — ⚠ **NOT AFFIRMED, NOT A SIGN-OFF**

> **Nothing below is a gate.** These are the values the operator/PO would *copy into* the affirmation
> blocks **in a dispatching turn**, after deciding to run. Reading them here affirms nothing, and this
> document cannot affirm anything: `r4-gate-record.md` is the register, G3/G6 are per-run and
> consumed with the run, and **P6 is signed only in a dispatching turn that records both**.

| Field | Proposed value |
|---|---|
| Channel / DataType | NAVER SmartStore · REVIEW export (read) |
| Seller account | `NAVER_DEV_SELLER_SELF_01` — the operator's own dev seller (G2 self-consent, D-024) |
| Operator / PO | `OPERATOR_SELF_01` — seller = operator; the real identity is named at the seat, never in this file |
| Date | _(the dispatching turn's date)_ |
| Backend | disposable `sellerops_run7_<stamp>` on `SERVER_PORT=18080`; **never** the persistent dev DB |

**G3 — proposed instance (`export+ingest` scope).** Each box is affirmed fresh at the seat; none may
be inherited from Run 4 or from anything else:

- ☐ Stable network / IP / location still holds.
- ☐ Dedicated Chrome profile for the connection intact.
- ☐ Bridge paired — **CORRECTED 2026-07-23 → record `N/A, with reason`, not ☑.** An earlier draft of
  this record proposed ☑ on the reasoning that the `session recovery` carve-out belongs to that scope
  alone. That is true of the carve-out's *scope* but wrong about *this run's control boundary*: this
  is a **CLI run over a loopback**, and the live driver **is not Bridge-wired**
  ([`r4-preparation.md`](r4-preparation.md) §6 says so verbatim). A ☑ would assert a fact the run does
  not exercise; a silent drop would hide the question. **The CLI is the control boundary here.**
- ☐ Operation Run persistence enabled.
- ☐ §9 item 3 pause lift, **for `export+ingest` only** — not a blanket lift, not inherited.

**G6 — proposed one-run approval.** Channel / seller account owner / date / operator as above, §7
abort criteria acknowledged, plus:

- `max live window:` **~15 min** proposed — one drive, no recovery loop (this run does not use the
  A3 recovery budget that took Run 6's worst case to ~32 min). The seller's two-step action sits
  inside the observe → download windows the CLI prompt interpolates from the timers.

**P6 — proposed sign-off inputs** (per `r4-gate-record.md` §2): G1 ✅ (D-021) · G2 ✅ (D-024) ·
G4 ☑ *(offline suites green on the unmodified tree — §12)* · G5 ✅ (none required) ·
export-scoped G6 ☐ · export-scoped G3 ☐ · §7 acknowledged ☐. **P6 stays ☐ until the dispatching turn
records the G6 and the G3.**

**§7 abort criteria — proposed acknowledgement.** `r4-preparation.md` §7 verbatim, including the
carve-out that the **expected** NAVER export confirmation dialog is not a trigger while any
*unrecognized* prompt is; plus this run's three additions in §9 above (range precondition fails →
abort before the window; ingest target not confirmed disposable → abort; any composer/reply surface
→ abort).

*Boundary: this record is a plan for a run that has not been authorized. Every live-run gate applies
per-run, and this document grants none of them.*

## 14. Holder sync — ☑ COMPLETED 2026-07-23 (no live contact)

The run was found unexecutable from the development checkout: the code under proof and the NAVER
browser profile lived in **two different repositories**. `sellerops/repo` is its own clone;
`runtime-holders/naver-r4` is a worktree of the **`aiagent/.git`** host and was detached at `bc7d5d8`
(PR #317), carrying the profile but not the parse gate, the reply-state code, or `V21`. They share one
remote, so the commit could travel.

Performed, with the operator's approval, entirely offline:

1. `feat/review-acquisition-spine` pushed to origin at **`b5f0683`** — a new branch, no force, no PR,
   `main` untouched (`origin/main...main` = `0 0`).
2. `git fetch origin feat/review-acquisition-spine` in the holder — **fetch only**, never `pull`,
   which would try to merge into a detached HEAD. HEAD stayed at `bc7d5d8`; no working file moved.
3. `git checkout --detach b5f0683` — the same detached shape the holder was already in, so no branch
   can collide with another worktree of the host. **No commit is ever created in the holder.**

**Verification — all passed:**

| Check | Result |
|---|---|
| HEAD / cleanliness | `b5f0683`, `git status --porcelain` empty |
| **Preserved paths** (`.profile` 961 files / 132,176K · `.env` · `.status` · `downloads` · `.operation-runs` · `.aw-quarantine`) | **byte-for-byte identical** to the pre-sync fingerprint — file count, size, and newest mtime unchanged for all six |
| Code under proof present | `artifact-parse.ts` · `workbook-shape-read.ts` · `ReviewReplyState.java` · `V21` · the golden fixtures · D-037 · this record |
| Collector suite **inside the holder** | typecheck clean · **4843 passed / 95 skipped** — proving `node_modules` survived a 773-file rewrite |
| `.env` | mtime unchanged, **never opened** |
| Profile | still unheld (no `Singleton*`/lock, `lsof` clean) |

⚠ The checkout rewrote 773 tracked files (+6,761 / −238,800). The deletions are the **legacy
VOC/OliveYoung/cardnews lineage** removed by the repo-purpose cleanup — all tracked, and restored by
the rollback. **No ignored file was touched, no `git clean` was run, nothing was deleted by hand.**

**The holder stays at `b5f0683`** (product-owner decision): it is now the runtime baseline, and the
checkout matches the code a future Run 7 would exercise. Rollback remains one command —
`git checkout --detach bc7d5d8`, an ancestor of `origin/main`, so it survives any fetch.

> **↳ SUPERSEDED 2026-07-23:** on the operator's instruction the holder was re-synced
> `b5f0683 → 783a9b4` (merged `origin/main`, which contains `b5f0683` as an ancestor) for the second
> dispatch attempt — same fetch-only + `checkout --detach` shape, preserved paths re-fingerprinted
> byte-for-byte identical. Details in §15.1. The holder now stays at **`783a9b4`**.

## 15. Execution record — 2026-07-23, second attempt (sanitized)

### 15.1 Pre-dispatch preparation (no live contact; all before the dispatching turn's affirmation)

- **Holder re-sync:** `naver-r4` moved `b5f0683 → 783a9b4` (fetch-only, `checkout --detach`; no
  commit created in the holder, no `git clean`, nothing deleted by hand). The six preserved paths
  (`.profile` / `.env` / `.status` / `downloads` / `.operation-runs` / `.aw-quarantine`)
  fingerprinted **byte-for-byte identical** across the sync (count, size, newest mtime); `.env`
  mtime unchanged and never opened; profile unheld (no `Singleton*`/lock, `lsof` clean).
  ⚠ One observation: `.profile` counted **897 files** where §14 recorded 961 — size identical to
  the kilobyte (132,176K) and the newest profile mtime **predates the §14 sync itself**, so nothing
  wrote to the profile in between; recorded as counting/ephemeral-file drift, not use.
- **G4, fresh, on the unmodified `783a9b4` tree:** backend **1502** passed / 0 failures / 2 skipped ·
  collector **inside the holder** **4843 / 95 skipped** + typecheck clean · frontend **765** passed +
  `tsc --noEmit` clean.
- **Phase A executed:** drop guard falsified (refused `sellerops` and `sellerops_dev`); rehearsal
  create/drop clean; fresh disposable DB `sellerops_run7_20260723T233452` created; backend booted on
  `SERVER_PORT=18080` against it (Flyway 24 migrations, NAVER channel seeded); run-local operator
  org registered; ingest pointing via environment only. The credentials existed only in a
  `chmod 600` scratchpad file, never printed, and were removed at teardown.

### 15.2 Gates (affirmed by the operator in the dispatching turn — register: `r4-gate-record.md`)

Fresh G3 (`export+ingest`; network box affirmed **for the current environment**; Bridge = N/A with
reason, CLI/loopback; §9-3 lift for this scope only) + fresh single-use G6 (channel / account /
date / operator as §13 proposed; **max live window 15 min**; no-reply bound; §7 + this record's three
abort additions acknowledged) + P6 signed on both plus the fresh G4 above. The operator stated
**"seated and ready"**, and committed to confirming the §8 range precondition on screen after login,
aborting before export if it failed — the run ended before that step became observable.

### 15.3 Timeline (KST, sanitized — from the CLI's own output and the operator turn)

| Time | Event |
|---|---|
| 23:42:46 | Live window opens — headed Chrome on the dedicated profile; ingest target printed and confirmed `http://127.0.0.1:18080` (the disposable backend) |
| 23:48:47 | Operator signals ready; sentinel created |
| ~23:48:50 | Highlight (inferred — the CLI logs no line for it; the overlay is the only signal, §15.4) |
| 23:58:50 | Observe window lapses — `aw.live.barrier {"observed":false}` |
| 23:59:50 | `DOWNLOAD_TIMEOUT` → **FAILED (2-of-3 steps), fail-closed**; readiness line confirms `LOGGED_IN` · `READY` · `positive_count` · `selectedRangePresentLive=true`; browser closed, process exited 0 |

Teardown followed immediately: backend stopped · guarded drop of `sellerops_run7_20260723T233452` ·
`sellerops` confirmed the only surviving `sellerops*` database · quarantine/downloads/`.status`
empty · no artifact anywhere · profile released (no locks) · `.env` byte-identical · the run
persisted its Operation Run marker (8 → 9 files).

### 15.4 Findings

1. **The 15-minute cap cannot contain the CLI's own timers.** Sentinel wait (up to 10 min) +
   observe (10 min) + download (60 s) structurally exceed a 15-minute window unless the human
   completes login → range → signal in under ~4 minutes and acts on the highlight quickly. This
   run's fail-closed tail ran ~2 minutes past the cap (barrier 23:58:50 vs cap 23:57:46) with no
   way to stop it that was safer than letting it lapse. **A future capped run must either size the
   G6 window to the timers (Run 6 precedent: budget stated from the timers) or shorten the CLI
   timers for the run.** Killing the process mid-flight against the preserved profile was rejected
   deliberately.
2. **The highlight moment is not logged.** Between sentinel pickup and the barrier line the CLI is
   silent; the overlay in Chrome is the only signal the observe window has started. A seated
   operator being relayed CLI output (the "say ready in Claude Code" path this CLI itself
   documents) has no relayable confirmation — this run's observe window lapsed with the operator
   never acting. One sanitized `aw.live.highlighted` log line would close the gap. (Code change —
   belongs to a future slice, not this record.)
3. **The live readiness path is proven green up to the human barrier.** Real login, real page,
   populated grid, range control present, readiness `positive_count` — every runtime-side step of
   the choreography worked; the run failed at the one step the design reserves for the human, which
   is the boundary behaving exactly as specified (fail closed, zero clicks, nothing written).
4. **What Run 7 set out to prove remains unproven** — C1–C5 all `NOT DEMONSTRATED`. The claims
   still rest on synthetic fixtures plus the one offline-read real export. This record adds
   evidence about the *choreography*, not the *pipeline*.

## 16. Execution record — 2026-07-24, third attempt (attempt 2 of the run; sanitized)

### 16.1 Dispatch

Fresh G3 (`export+ingest`, five boxes incl. network-for-current-environment; Bridge N/A with
reason) + fresh single-use G6 affirmed in the dispatching turn of **2026-07-24**, with the window
re-sized per §15.4 finding 1: **max live window 25 minutes, timer-derived**. Same channel /
account / operator / no-reply bound as §15.2. Disposable backend `sellerops_run7_20260724T000758`
on 18080 (fresh DB; survived a session restart mid-preparation — the prior turn's unlaunched
affirmation was treated as VOID and re-affirmed fresh, per the register rule). The first launch
attempt of this turn was blocked by the operator-side permission classifier; the operator granted
the permission explicitly and the same affirmation carried the immediate retry — no live contact
occurred in between.

### 16.2 Timeline (KST)

| Time | Event |
|---|---|
| 00:26:55 | Live window opens; ingest target confirmed `http://127.0.0.1:18080` on the run's own output |
| 00:27:47 | Operator signals ready; sentinel created (**52 s** from window open — the §15.4-2 act-on-sight seat protocol worked) |
| 00:28:05 | `aw.live.barrier {"observed":true}` — the runtime OBSERVED the export action (attempt 1 never got here) |
| 00:29:06 | `DOWNLOAD_TIMEOUT` (exactly 60 s later) → **FAILED (2-of-3), fail-closed**; readiness green (`LOGGED_IN` · `READY` · `positive_count` · `selectedRangePresentLive=true`); exit 0 |

Teardown: 0 rows before drop · guarded drop clean · `sellerops` the only surviving `sellerops*`
DB · credentials file removed · quarantine/downloads/profile/`~/Downloads`/Playwright temp all
swept — **zero artifacts anywhere**.

### 16.3 The finding — a download-detection miss, now the blocking question

**Operator observation, recorded verbatim (2026-07-24, seconds after the observed action):**

> "clicked export and confirmed the dialog, download started"

**That is the complete observation. Deliberately NOT recorded, because it was not stated:** how the
download's start manifested (a Chrome download indicator, a filename, a save dialog, a NAVER-side
"파일 생성/다운로드" surface, a new tab/page — none of these was reported), whether it visibly
completed, or where it was delivered. Both delivery hypotheses below therefore remain open, and the
offline reproduction must cover **both**.

**RECLASSIFIED — operator clarification (2026-07-24, after the run):** what the operator saw was
**not a Chrome download indicator and not necessarily a popup page**: after confirming the export
dialog, a **second NAVER-native in-page notification/dialog appeared before the actual download**,
carrying its own download/confirm control. Attempt 2 is therefore an **INCOMPLETE HUMAN-CHECKPOINT
WORKFLOW**, not a missed download event: the export choreography carries more human steps than the
state machine modeled. The runtime highlighted and awaited only the FIRST control; the follow-up
checkpoint was never highlighted, never awaited, and the 60 s download deadline ran from the first
action — so the run failed closed exactly as designed, one human step short of the download.

Supporting history (this step was not unforeseeable):

- Run 4 (`COMPLETED` 3-of-3) observed a **two**-step flow — click → expected confirmation dialog →
  download on the confirmation — and both steps happened to land inside one 60 s window. The
  dialog's identity (whether it is the copyright/usage consent recorded in
  `export-click-signals.ts`) is an **open question** in the evidence pack, in neither direction.
- The collector's classify layer has always modeled an **async** export that delivers via a
  follow-up surface (`ASYNC_JOB_MARKERS`: 다운로드 목록/센터/요청 · 처리 중 · 대기열 — "confirmed
  against the live page's wording"), precisely so an async mechanism is never mistaken for a sync
  capture. The Action Window engine simply had no counterpart for it until §17.
- An earlier hypothesis this session — a popup-initiated download invisible to the page-level
  listener — reproduced offline but is **not established as attempt 2's cause**; that change is
  parked as optional hardening, uncommitted, pending independent justification.
- Whatever fired, nothing survived: no artifact existed anywhere at teardown, which is the data
  posture working as designed.

**Consequence: no attempt 3 until the multi-checkpoint choreography is modeled and proven
OFFLINE** — live is never the first execution of a code path (G4), and it is equally not the
debugging environment. That work is §17.

### 16.4 Gate state after attempt 2

G3 #2 and G6 #2 (2026-07-24) are **CONSUMED** — register updated. C1–C5 remain `NOT DEMONSTRATED`.

## 17. Continuation-checkpoint slice — built OFFLINE 2026-07-24, committed `871fccd`

The §16.3 reclassification made the fix a **choreography extension**, implemented entirely inside
`NaverLiveProbeDriver` — no engine, contract, `STEP_PLAN`, or FE change:

- **`detectDownload` is now a bounded multi-checkpoint state machine.** The Run-4 direct shape is
  the unchanged fast path (armed download raced against the deadline). While the race waits, the
  driver polls **read-only** for a NEW single control matching the confirmed export wording — every
  previously highlighted control stays excluded via a persistent `data-aw-seen` stamp, so a
  checkpoint control that its own click removes from the DOM can never cause the original export
  button to be re-highlighted. On exactly one match the tag MOVES (the old control also loses its
  observer listener — a stale click on it can no longer satisfy observation), the control is
  **HIGHLIGHTED** with continuation copy, and the driver **WAITS for the seller's own click** —
  it never clicks. Only after that click does a fresh download deadline run.
- **Fail-closed from every exit, timers accounted:** ≥2 simultaneous candidates → ambiguous → fail
  closed; checkpoint never acted on within the continuation observe window (defaults to
  `observeTimeoutMs`) → fail closed; more than 3 checkpoints → fail closed; no download and no
  checkpoint at any deadline → the unchanged `DOWNLOAD_TIMEOUT` shape. Poll accounting is
  iteration-count based (the sentinel-wait convention), never a wall-clock read.
- **Evidence seam:** sanitized `aw.live.continuation { checkpoints, observedLast, ambiguous }`
  logged by the CLI (booleans + small count; never transported/persisted), and the CLI prompt now
  tells the seated operator a follow-up NAVER control may be highlighted and is theirs to click.
- **Proof** (`test/action-window/naver-live-continuation.test.ts`, RUN_INTEGRATION; headed variant
  available): the operator-described flow end-to-end (confirm → async notification → highlighted
  control → operator click → download DETECTED); a consent-worded dialog as checkpoint 1 with the
  notification as checkpoint 2; Run 4's direct shape pinned at zero checkpoints; fail-closed pinned
  for unacted checkpoint and for ambiguity. **Falsified:** with the state machine reverted, all
  five fail. **Headed operator proof 2026-07-24:** the operator personally performed every click
  through four headed runs (the described flow, the two-checkpoint consent shape, Run 4's direct
  shape, and the ambiguity fail-closed) — all passed with no issue observed at the seat; the
  unacted-checkpoint exit stays proven by the automated run (a four-minute deliberate no-click
  adds nothing).
- **Verification:** collector hermetic **4843 / 100 skipped** (+5 gated, zero existing tests
  moved), typecheck clean. Two `RUN_INTEGRATION` browser tests fail identically on unmodified
  `main` (their synthetic blob predates the D-037 parse gate) — **pre-existing, recorded for a
  follow-up fixlet, untouched by this slice.**

The popup-listener hardening from the earlier hypothesis is **parked** (patch preserved locally,
not committed, not part of this slice) pending independent justification.

## 18. Execution record — 2026-07-24, attempt 3 (COMPLETED · sanitized)

### 18.1 Dispatch

Fresh G3 (`export+ingest`, five boxes for the current environment; Bridge N/A/CLI-loopback) +
fresh single-use G6 (**max live window 55 min**, timer-derived from the new worst case: sentinel
≤10 + observe ≤10 + detect ≤34 for 3 checkpoints × [continuation observe + re-race]; no-reply
bound) affirmed in the dispatching turn, operator **seated and ready**, §8 range **confirmed on
screen**. Code under proof: the multi-checkpoint runtime at **`871fccd`**, holder-synced from the
local repo (fetch-only + `checkout --detach`; preserved paths re-fingerprinted byte-identical;
collector suite + the five continuation proofs green **inside the holder**). Disposable backend
`sellerops_run7_20260724T011628` on 18080, ingest confirmed on the run's own output.

### 18.2 Timeline (KST)

| Time | Event |
|---|---|
| 01:23:36 | Live window opens; ingest target `http://127.0.0.1:18080` on the run's output |
| 01:25:02 | Operator signals ready; sentinel created |
| — | ⚠ **Highlight off-screen finding:** the export control was below the fold; the overlay is fixed at the control's highlight-time position and **does not follow scroll**, so no highlight was visible until the operator scrolled. Observation is bound to the CONTROL, not the overlay, so a direct click still registered. Recorded as §18.4-1. |
| 01:27:58 | `aw.live.barrier {"observed":true}` — export action observed |
| ~01:28:21 | Direct download → validate → parse-gate → `upload.done SUCCESS` (tens rows, 0 skipped/0 failed) → **`COMPLETED`**; `aw.live.continuation {checkpoints:0, observedLast:false, ambiguous:false}` |

Live contact ended when the browser closed. Teardown immediately after: backend stopped · guarded
drop of `sellerops_run7_20260724T011628` · `sellerops` the only surviving `sellerops*` DB · run-local
credentials/token/response bodies scrubbed · holder quarantine/downloads empty · profile unheld ·
`.env` byte-identical.

### 18.3 Claim results (filled §11 template)

```
Run 7 — 2026-07-24 (attempt 3) — OPERATOR_SELF_01 — G3 (export+ingest) CONSUMED · G6 CONSUMED
Outcome:            COMPLETED 3-of-3 (real download → validate → parse-gate → ingest SUCCESS)
Ingest:             SUCCESS — 58 rows, 0 skipped, 0 failed
C1 compatibility:   PASS — body/rating/received_at/external_id/reply_state = 58/58 non-null;
                    received_at UTC-midnight 58/58; 답글여부 matched its exact-key alias
                    (all PENDING, 0 UNKNOWN → column present + read); reply-state ingest proven
C2 queue exclusion: NOT DEMONSTRATED (§8) — 0 answered reviews in the exported range
C3 arrivals whole:  PASS — 58 NEW_REVIEW; low/mid/high = 1/1/56
C4 refusal:         NOT DEMONSTRABLE — no answered review exists to refuse
C5 non-vacuity:     was recorded BLOCKED (500) — RESOLVED §18.4-3: the live chain used wrong
                    method/path; the CORRECT chain mints a submissionRef end to end. A real
                    405-masked-as-500 defect was found + fixed (fix/method-not-allowed-500-masking)
Census:             rating 58 · received_at 58 (UTC-midnight 58) · external_id 58
                    reply_state PENDING 58 / ANSWERED 0 / UNKNOWN 0
                    replied_at on ANSWERED 0/0 · on PENDING 0 (expect 0) ✓
Teardown:           DB dropped ☑ · sellerops intact ☑ · quarantine empty ☑ · no artifact ☑
Findings:           §18.4
```

### 18.4 Findings

1. **The highlight overlay does not follow scroll.** `mountOverlay` fixes the box at the control's
   viewport position at highlight time; a control below the fold gets an off-screen overlay and the
   seated operator sees nothing until they scroll. It cost minutes this run and would read as "no
   highlight" to any operator. The observer is bound to the control (a direct click still worked),
   so this is a visibility defect, not a correctness one. **Fix candidate:** scroll the control into
   view before mounting, and/or reposition the overlay on scroll. Recorded for a follow-up slice —
   not fixed here (it is orthogonal to the choreography work and wants its own headed proof).
2. **The exported range carried 0 answered reviews**, diverging from the operator's on-screen §8
   confirmation. All 58 rows are a single recent date with a 1/1/56 rating split — consistent with a
   narrow recent window in which nothing has been answered yet, while the §8 eyeball was evidently
   on a broader view. This is the §8 fallback working exactly as written: C2/C4 recorded
   `NOT DEMONSTRATED`, never quietly passed on an empty set. A future attempt wanting the reply-state
   headline must confirm the answered row is **inside the range that will actually export**, not just
   visible somewhere on screen.
3. **The C5 "500" — RESOLVED 2026-07-24, offline reproduction complete.** It was **not** a
   triage/draft business-logic defect. The live C5 chain used the **wrong method and path** on two
   calls: `PUT …/triage` (the route is `POST …/triage`) and `POST …/reply` (the draft route is
   `PUT …/reply/draft`). Reproduced on a disposable Postgres backend with a seeded RESPONSE_NEEDED
   review: the **correct** chain works end to end — `POST /triage` → 200, `PUT /reply/draft` → 200,
   `POST /reply/approval` → 200, `POST /reply/submission-run` → **200 with a `submissionRef`
   minted**. So C5's underlying capability (mint on a PENDING row) is in fact **sound**; the live
   run simply exercised it wrongly.
   ⚠ **But the investigation found a real, separate defect and fixed it:** a wrong HTTP method on a
   known route returned **500 instead of 405** — `GlobalExceptionHandler`'s catch-all
   `@ExceptionHandler(Exception.class)` was swallowing `HttpRequestMethodNotSupportedException`. That
   masking is exactly what made the C5 method-mismatch read as a backend failure and cost the
   diagnostic time. Fixed with a dedicated 405 handler + a regression test (a `PUT` on the POST-only
   triage route is 405, never a masked 500; reverting the handler fails it with 500). Backend 1502 →
   1503. Fix: `fix/method-not-allowed-500-masking`.

### 18.5 Gate state after attempt 3

G3 #3 and G6 #3 (2026-07-24) are **CONSUMED** — register updated. C1 and C3 are **PROVEN on real
data**; C2/C4 stay `NOT DEMONSTRATED` (§8 fallback); C5's capability is **sound** (§18.4-3 — the
live "500" was a wrong-method test error; a real 405-masking defect was found + fixed). The
reply-state *headline* (answered reviews leave the queue; guided reply refuses an answered review)
still awaits a range that contains an answered low-rating review — a future run starts from a blank
template.

## 19. Execution record — 2026-07-24, attempt 4 (reply-state headline; sanitized)

### 19.1 Dispatch

Fresh G3 (`export+ingest`, five boxes for the current — **restored** — environment; Bridge
N/A/CLI-loopback) + fresh single-use G6 (**max live window 55 min**, timer-derived: sentinel 10 +
observe 10 + multi-checkpoint detect 34 + ~1 overhead; recovery budget excluded — no park; no-reply
bound) affirmed in the dispatching turn, operator **seated and ready**. Code under proof: **clean main
`b3864a7`** — carries `871fccd`'s multi-checkpoint continuation runtime AND `3c77499`'s scroll-tracking
overlay + `readExportScope`. Holder `naver-r4` synced `871fccd → b3864a7` (fetch-only + `checkout
--detach`; six preserved paths re-fingerprinted **byte-for-byte identical**; collector suite +
`naver-live-visibility` RUN_INTEGRATION 4/4 green **inside the holder**). Disposable backend
`sellerops_run7_20260724T094747` on 18080 (26 migrations, NAVER seeded, 0 reviews; run-local org
registered), ingest target confirmed `http://127.0.0.1:18080` on the run's own output.

### 19.2 Timeline (log times UTC)

| Time | Event |
|---|---|
| 10:06:21 | `aw.live.barrier {observed:true}` — the export action was OBSERVED. `readExportScope` had reflected the operator's range **2026.01.25–2026.07.24** before they acted; scope confirmed on screen |
| 10:07:21 | `DOWNLOAD_TIMEOUT` (exactly 60 s later) → **FAILED (2-of-3), fail-closed**; readiness green (`LOGGED_IN` · `READY` · `positive_count` · `selectedRangePresentLive:true`); exit 0 |
| — | `aw.live.continuation {checkpoints:0, observedLast:false, ambiguous:false}` |

Teardown immediately: backend stopped · **guarded drop** of the disposable DB · `sellerops` the only
surviving `sellerops*` DB · run-local creds + the operator-local scope read-back **scrubbed** ·
holder quarantine/downloads empty · profile unheld · `.env` byte-identical · **holder kept at
`b3864a7`** (not rolled back).

### 19.3 The finding — a continuation-candidate DISCOVERY miss (NOT a timing miss)

After the observed export click, the live NAVER surface showed a **second operator-required download
control** — exactly the multi-checkpoint case `§17` targets — but the continuation detector reported
`checkpoints:0` across the whole 60 s race: `markContinuationTarget` matched **no** new control on any
poll, so the deadline lapsed one human step short of the download. **Zero ingest, zero artifact, no
public write.**

This is **not** attempt 2's timing miss (there the state machine modeled only one human step). §17's
multi-checkpoint runtime WAS on the tree and DID poll — it simply never **matched** the live second
control. **Reclassified (operator direction): a continuation-candidate DISCOVERY defect.** The
matcher's candidate set is `button, a, [role="button"], input[type=button|submit]` filtered by
visible+enabled + `EXPORT_TARGET_KEYWORDS`; likely real shapes it misses — a **role-less custom
clickable** (`div`/`span`), a control in a **different frame** than the resolved surface, or a bare
**확인**-worded control — are the audit targets. Any fix belongs **OFFLINE** — tracked as a **separate,
focused collector candidate-discovery change**, independent of this record; live is never the debugging
environment (G4).

Claim results: **C1/C3 remain PROVEN** from attempt 3; **C2/C4/C5 NOT DEMONSTRATED** — the run never
reached ingest.

### 19.4 Gate state after attempt 4

**G3 #4 and G6 #4 (2026-07-24) are CONSUMED** — register updated. The reply-state headline still awaits
a **fresh G3 + G6 AND** an offline candidate-discovery fix, tracked separately as a focused collector
change (its own PR). **This record stands on the observed facts regardless of whether that fix is ever
merged** — the run was consumed and failed closed, and that is what it records.

## 20. Execution record — 2026-07-24, attempt 5 (export tutorial live proof — COMPLETED · sanitized)

### 20.1 Dispatch

Re-scoped by the operator to the **NAVER Review Export Tutorial** — success = one bounded live
export-and-ingest; C2/C4 answered-review checks are the separate Reply-State Live Validation package,
captured only opportunistically. Fresh G3 (`export+ingest`, five boxes, current restored environment;
Bridge N/A/CLI-loopback) + fresh single-use G6 (max live window 55 min, timer-derived; no-reply bound)
affirmed in the dispatching turn, operator **seated and ready**, scope confirmed on screen via
`readExportScope`. Code under proof: clean main **`661bcca`** (role-less continuation discovery #350 +
scroll-tracking highlight + `readExportScope`), holder synced **forward** `b3864a7 → 661bcca`
(fetch-only + `checkout --detach`; six preserved paths byte-identical; in-holder collector 4850 +
RUN_INTEGRATION browser proofs 17/17). The consent-flow reframing (label/comments/tests) is a local,
unpushed, **zero-behavior** change — runtime behavior is identical. Disposable backend
`sellerops_run7_20260724T112501` on 18080, ingest target confirmed on the run's output.

### 20.2 Timeline (log times UTC)

| Time | Event |
|---|---|
| 12:10:59 | `aw.live.barrier {observed:true}` — export action observed (scope 2026.01.25–2026.07.24 confirmed via `readExportScope`) |
| 12:11:04 | `login.ok` (`http://127.0.0.1:18080`) · `channel.resolved` NAVER · `upload.done SUCCESS` (rows few, 0 skipped, 0 failed) → **COMPLETED 3-of-3** |
| — | `aw.live.continuation {checkpoints:0}` — the confirm fired the download directly (Run-4 direct variant; no separate consent control needed highlighting this range) |

### 20.3 Evidence (sanitized census, captured before teardown)

- Ingest **SUCCESS: 7 reviews, 0 skipped, 0 failed**.
- Mapped-field census: `body` / `rating` / `received_at` / `external_id` / `reply_state` = **7/7 non-null** — **C1 compatibility on real data**.
- `reply_state`: **ANSWERED 2 / PENDING 5 / UNKNOWN 0**; all 7 low-rating (1점 filter) → **2 answered low-rating reviews present**, reply-state preserved.
- ⚠ `reviews` carry **no `seller_account_id`** (org/channel-scoped by design) → account-scoped C2/C4 API verification is the separate Reply-State Live Validation package; the DB census is the opportunistic evidence.
- **Teardown clean:** DB dropped (name-guarded) · `sellerops` the only surviving `sellerops*` DB · quarantine / downloads / `~/Downloads` empty · profile unheld · holder at `661bcca` (not rolled back) · scope read-back + run-local creds scrubbed · **zero residual data**.

### 20.4 Result

**The NAVER Review Export Tutorial's completion criterion is MET** — one bounded live export-and-ingest
success with the fixed runtime, no public write, clean teardown. `checkpoints:0` (direct variant); the
one-consent-checkpoint normal flow + role-less discovery are proven by the headed operator verification
and the synthetic proofs, and were simply not exercised by this range. **G3 #5 / G6 #5 CONSUMED.**

## 21. Execution record — 2026-07-24, attempt 6 (reply-state headline C2/C4; sanitized)

### 21.1 Dispatch

Reply-State Live Validation package. Fresh G3 (`export+ingest`, five boxes, restored environment;
Bridge N/A/CLI-loopback) + fresh single-use G6 (max live window 55 min, timer-derived; no-reply bound)
affirmed in the dispatching turn, operator **seated and ready**. Code under proof: holder **`661bcca`**
— which already contains the **PR #350 role-less continuation discovery fix** + scroll-tracking
highlight + `readExportScope`. Disposable backend `sellerops_run7_20260724T133337` on 18080 (26
migrations, NAVER file-channel account registered for the run-local org, 0 reviews pre-run), ingest
target confirmed as `http://127.0.0.1:18080` before Chrome opened.

### 21.2 Timeline (log times UTC)

| Time | Event |
|---|---|
| 13:51:12 | `profile.launch {headless:false,channel:chrome}` — Chrome opened |
| — | operator login + scope select; `readExportScope` reflected **2026.01.25–2026.07.24 · 스마트스토어 · 1점 · 정상** (operator confirmed on screen) |
| 13:55:30 | `aw.live.barrier {observed:true}` — first export action observed |
| — | NAVER showed a **second consent control** (operator: "another button waiting") |
| 13:56:32 | `aw.live.run {status:FAILED, blockerCode:DOWNLOAD_TIMEOUT}` · `aw.live.continuation {checkpoints:0, observedLast:false, ambiguous:false}` |

### 21.3 The finding — the continuation-discovery miss REPEATS despite #350

The **exact same `checkpoints:0` symptom as attempt 4**, now on `661bcca` which **includes the #350
role-less discovery fix**. So #350 did **not** close the live gap: the real NAVER second control is
matched by neither the native selector, the `cursor:pointer` role-less path, nor the keyword-name
filter. Its structure differs from all five synthetic shapes AND the role-less `div` reproduced in
`naver-live-continuation-shapes.test.ts`.

Contrast with attempt 5 (§20): the *same* scope produced a **direct** download (`checkpoints:0`,
succeeded) — NAVER **interposes** the consent modal only intermittently. When it does not, export
succeeds; when it does, discovery misses it and the run fails closed. This matches the CLI prompt's own
warning that NAVER "may interpose FURTHER steps."

**Primary hypothesis (operator-directed):** the second control is a **generic `확인`/`동의`** action
whose *export meaning lives in the surrounding modal context* (review-export / Excel / usage-consent),
not in the button text — so keyword-name matching on the button alone cannot find it, and bare-`확인`
global matching is unsafe. Prior evidence: the read-only frame-aware probe (2026-07-13) found the
export **surface** in the **top document**; whether the consent **modal** is same-frame is a new,
separately-diagnosed question (§21 fix adds sanitized frame diagnostics; iframe traversal stays out
unless evidence proves cross-frame).

### 21.4 Fail-closed evidence (sanitized)

- **0 reviews ingested** (disposable DB `reviews` count 0 post-run) · **0 export artifact** (holder
  `downloads/` held only a stale empty `diagnostic/` from 07-20) · browser closed by `finally` · **no
  public write**.
- **Teardown clean:** backend stopped, DB dropped name-guarded, `sellerops` the only surviving
  `sellerops*` DB, run-local creds + scope scrubbed, ready sentinel cleared, holder unheld at
  `661bcca`.

### 21.5 Gate state after attempt 6

**G3 #6 / G6 #6 CONSUMED** (run FAILED closed). C1/C3 remain proven (attempts 3, 5); **C2/C4 still NOT
demonstrated live.** No further live contact until the contextual-dialog discovery shape is green
offline (headed synthetic + operator verification) under a fresh G3/G6.
