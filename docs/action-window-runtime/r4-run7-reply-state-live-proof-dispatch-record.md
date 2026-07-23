# Run 7 — NAVER reply-state live proof — **DISPATCH RECORD (DRAFT · DEFERRED)**

> ## ⏸ DEFERRED 2026-07-23 — **NOT DISPATCHED, NOT CONSUMED, NO LIVE CONTACT**
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

## 11. Post-run evidence template (to be filled after execution, sanitized)

```
Run 7 — <date> — <operator> — G3 (export+ingest) CONSUMED · G6 CONSUMED
Outcome:            <COMPLETED n-of-3 | FAILED + blocker code>
Ingest:             <status> <success/skipped/failed>
C2 queue exclusion: <PASS | NOT DEMONSTRATED (§8)>  low-rating: <answered excluded: y/n>
C3 arrivals whole:  <PASS/FAIL>
C4 refusal:         <409 | other>          C5 non-vacuity: <ref minted | other>
Census:             rating <n> · received_at <n> (UTC-midnight <n>) · external_id <n>
                    reply_state ANSWERED <n> / PENDING <n> / UNKNOWN <n>
                    replied_at on ANSWERED <n>/<n> · on PENDING <n> (expect 0)
Teardown:           DB dropped ☐ · sellerops intact ☐ · quarantine empty ☐ · no artifact ☐
Findings:           <...>
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
