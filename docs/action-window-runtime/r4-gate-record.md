# R4 Supervised-Pilot Gate Record — NAVER SmartStore review export

**Opened:** 2026-07-12 · **Channel:** NAVER SmartStore review export (G1 ratified, [`decisions.md`](decisions.md) D-021).
**Pilot seller:** `NAVER_DEV_SELLER_SELF_01` — the operator's **own development NAVER seller account**
([`decisions.md`](decisions.md) D-024). **Status:** LIVING register of the §3 supervised-pilot gate.

> **This record authorizes NO live NAVER contact beyond what a filled per-run G6 grants.** It records the
> gate state only. A **read-only session-precondition probe was completed 2026-07-12** under a **consumed
> one-run G6** (§G6 below, §8-4 result). **Live export stays blocked** — it needs **G3** (stable
> environment + a live-work pause lift under the full §4 scope) and a **fresh per-run G6** in the
> dispatching turn; the consumed read-only-probe instance carries over to nothing.

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

## G3 — Environment · ✅ CONFIRMED 2026-07-12 (read-only probe path only)

The §3 G3 preconditions, confirmed by the operator **in a stable environment**. The pause lift below
is **scoped to the first read-only session-precondition probe only** ([`r4-preparation.md`](r4-preparation.md)
§9 item 3) — it is **not** a blanket lift of the NAVER live-work pause.

- ☑ Stable network / IP / location (the condition that paused NAVER live work).
- ☑ Dedicated Chrome profile for the connection.
- ☑ Bridge paired.
- ☑ Operation Run persistence enabled.
- ☑ **NAVER live-work pause LIFTED** — **for the first read-only session-precondition probe only**
  (no click / export / download); not a general lift.

*Owner:* operator. *Confirmed:* 2026-07-12 — G3 satisfied **for the read-only probe path**. This alone
authorizes **no live contact**: G6 per-run approval is still required in the dispatching turn before any
probe.

---

## G4 — Synthetic ladder green · ✅

Every §6 adapter-readiness item green on NAVER fixtures — [`r4-evidence-pack.md`](r4-evidence-pack.md)
§8-2 (offline suite), §8-3 (headed human-click proof).

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
- G2/G3/G5 state:     G2 ✅ recorded · G3 ✅ confirmed (checklist above all ☑, pause lifted) · G5 ✅ logged
```

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
- G2/G3/G5 state:     G2 ✅ recorded · G3 ✅ RE-AFFIRMED for an EXPORT run (§9-3 pause lift under full §4,
                      not the read-only scope) · G5 ✅ logged
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

The existing **G3 ✅** (above) is scoped to the **read-only §8-4 probe only**; it does **not** carry over.
Before an export run, re-affirm the following **under the full §4 scope** (all ☐ until the dispatching turn):

- ☐ Stable network / IP / location still holds (the condition that paused NAVER live work).
- ☐ Dedicated Chrome connection profile intact; Bridge paired; Operation Run persistence enabled.
- ☐ **§9 item 3 pause lift re-affirmed for an EXPORT run** — a fresh, export-scoped lift; the recorded
  read-only ☑ (§G3) does **not** carry over.

### 2 · P6 supervised-pilot internal sign-off requirements

P6 ([`r4-preparation.md`](r4-preparation.md) §1) is signed **only** when, for this export run:

- ☐ G1–G5 all ✅ (already: D-021/D-024; G4 synthetic ladder green).
- ☐ An **export-scoped G6** recorded in the dispatching turn (§G6 template above, filled).
- ☐ **G3 re-affirmed for export** (block 1 above).
- ☐ **§7 abort criteria acknowledged** for this run (block 3 below).

**P6 stays ☐ until an actual dispatching turn records the export-scoped G6 + the G3 re-affirmation. This
runbook does not sign P6.**

### 3 · Abort criteria

Full definitions in [`r4-preparation.md`](r4-preparation.md) §7 (not re-authored here). Summary:

- **Operator-immediate:** withdrawn consent; any unrecognized prompt/dialog; any anti-abuse signal
  (CAPTCHA storm / lockout warning); any on-screen data the seller did not expect to share. The human
  completes or walks away; the Runtime never retries around it.
- **Automatic fail-closed:** ambiguous/missing/drifted target, unexpected post-state, invalid session,
  or artifact-validation failure → blocker code, **zero clicks**, run persisted FAILED (resumable per R3).
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

- **G1 ✅ · G2 ✅ · G4 ✅ · G5 ✅** (static) · **G3 (read-only §8-4 probe path) ✅ — confirmed 2026-07-12.**
  The §9 item 3 pause lift is scoped to that one probe and does **not** carry over: an export, ingest, or
  real-click run needs a **fresh, run-scoped G3 re-affirmation** under the full §4 boundary (§G3, runbook §1).
- **G6 is a per-run gate** — a **read-only-probe instance was approved and consumed 2026-07-12** (the
  §8-4 probe is complete). G6 is **never standing**: an **export pilot still requires a fresh per-run G6**
  in the dispatching turn, operator/PO-owned, not Runtime code.
- The first authorized live contact — the **read-only session-precondition probe** — **was completed
  2026-07-12**; its sanitized `{ ready, verdict }` result (`ready:true` / `LOGGED_IN`, no blocker) is
  recorded in [`r4-evidence-pack.md`](r4-evidence-pack.md) §8-4. The next live step (export pilot) needs a
  **new** G6 under the full §4 boundary.

## Related

- Gate definitions + readiness → [`r4-preparation.md`](r4-preparation.md) §3/§4/§5/§9
- Durable decisions → [`decisions.md`](decisions.md) D-019/D-021/D-024
- Dated readiness evidence → [`r4-evidence-pack.md`](r4-evidence-pack.md) §8-1/§8-5
- Living handoff state → [`current-state.md`](current-state.md)
