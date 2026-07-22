# Run 7 — NAVER reply-state live proof — **DISPATCH RECORD (DRAFT)**

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

- that a **real** export still carries the 25 columns in that order, the `yyyy.MM.dd. HH:mm:ss`
  timestamp, and `답글여부` on rows the seller recognises as answered;
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

- ☐ Offline suites green on the unmodified tree (backend 1418 · collector 4843/95 · frontend 668) —
  **G4: live is never the first execution of any code path.**
- ☐ Dedicated Chrome profile intact; stable network / IP / location.
- ☐ Operation Run persistence enabled.
- ☐ Disposable database created and the backend pointed at it (§5 Phase A), **verified by a dry run
  of Phase A + teardown before any live contact**.
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

**C1 — ingest.** The run's own sanitized output: status `SUCCESS`, row counts.

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

- **Mapped-field census** — per-field non-null counts across the ingested rows: `rating`,
  `received_at`, `external_id`, `reply_state`, `replied_at`. This is the *schema* evidence: a field
  populated means its column was present **and its header matched the alias**, which is strictly
  stronger than a header hash. ⚠ **A header count/order hash is deliberately NOT taken** — it would
  require retaining the artifact, which the D-021 delete-after-validate posture forbids. The column
  set the seller sees on screen is recorded as an operator observation instead.
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

*Boundary: this record is a plan for a run that has not been authorized. Every live-run gate applies
per-run, and this document grants none of them.*
