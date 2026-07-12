# R4 Export-Pilot Dispatch Record — RUN 1 EXECUTED 2026-07-13 · FAILED (fail-closed) · G6 CONSUMED

> **Blocks B (G3-export), C (G6, one run), D (P6), E (§7) were filled and signed by the operator (PO) on
> 2026-07-13, and the single live command (block F) was then RUN in the same session.** Outcome: **FAILED
> at the session/surface precondition — `UNSUPPORTED_STATE`, zero clicks, nothing captured** (full sanitized
> result in [`r4-evidence-pack.md`](r4-evidence-pack.md) §8-8, block G below).
>
> **The one-run G6 is now CONSUMED / spent** (single-use; a fail-closed run does not refund it). Any further
> live contact — including a read-only diagnostic probe of the failed surface — needs a **new** G3-export +
> G6 in a fresh dispatching turn. This record now authorizes nothing further. Source of truth:
> [`r4-gate-record.md`](r4-gate-record.md) pre-dispatch runbook + [`r4-preparation.md`](r4-preparation.md)
> §3/§4/§7/§9.

**Channel:** NAVER SmartStore review export (G1 ratified — [`decisions.md`](decisions.md) D-021).
**Pilot seller:** `NAVER_DEV_SELLER_SELF_01` — operator's own development NAVER seller account (D-024).
**Run scope:** ONE supervised, seller-consented, **user-direct** export run. Not: unattended/scheduled
operation, multiple runs, or any SellerOps-performed click.

---

## A · Already established (static — carried in, not re-affirmed here)

| Item | State | Source |
|---|---|---|
| G1 — channel ratified | ✅ | D-021 |
| G2 — seller self-consent (§4 verbatim) | ✅ | §G2 · D-024 |
| G4 — synthetic ladder (fixture + synthetic-browser, incl. entrypoint assembly, automated **and** headed PASSED) | ✅ | [`r4-evidence-pack.md`](r4-evidence-pack.md) §8-3/§8-9 |
| G5 — abort/fail-closed drills on fixtures | ✅ | §8-6 |
| P7 — live-action safety boundary acknowledged | ✅ | D-024 |
| P10 — rollback/abort criteria reviewed + drilled | ✅ | §8-6 |

These do **not** authorize live contact on their own.

---

## B · G3 (export-scoped) — environment + pause lift · ☑ RE-AFFIRMED 2026-07-13

The recorded read-only **G3 ✅ (§8-4 probe) does not carry over.** Re-affirmed by the operator, **under the
full §4 scope**, in this dispatching turn (on the operator's assertion of current environment state):

- ☑ Stable network / IP / location still holds (the condition that paused NAVER live work — §9 item 3).
- ☑ Dedicated Chrome connection profile intact · Bridge paired · Operation Run persistence enabled.
- ☑ **§9 item 3 pause lift re-affirmed *for an export run*** — a fresh, export-scoped lift; the read-only
  lift does **not** carry over.

*Affirmed by:* operator (PO), `NAVER_DEV_SELLER_SELF_01` owner  *Date:* 2026-07-13  *Scope:* one export run
on `NAVER_DEV_SELLER_SELF_01`.

---

## C · G6 (per-run) — the live authorization · ☑ FILLED 2026-07-13 (one run)

Fresh instance under the full §4 boundary. The prior read-only-probe G6 is CONSUMED; this is a **new**
one-run instance:

- Channel / seller:   NAVER SmartStore review export · `NAVER_DEV_SELLER_SELF_01`
- Run scope:          ☑ exactly ONE supervised, seller-consented, user-direct export run
- §7 abort criteria:  ☑ acknowledged (ambiguous/missing/drifted target, unexpected post-state, invalid
                        session, artifact-validation failure → fail closed, **zero clicks**; operator
                        abort on withdrawn consent / unrecognized dialog / anti-abuse challenge)
- G2 / G3 / G5 state: ☑ G2 ✅ · ☑ G3 ✅ re-affirmed for export (block B) · ☑ G5 ✅
- P6 state:           ☑ signed for this run (block D)
- Approved by:        operator (PO)  *Date:* 2026-07-13

*Consumption — single-use:* this instance is consumed by the **one** live command in block F when it runs
in this same session. It is **VOID** if block F is not executed before this session/context ends — it never
becomes standing authorization for a later turn.

---

## D · P6 — supervised-pilot internal sign-off · ☑ SIGNED 2026-07-13

P6 ([`r4-preparation.md`](r4-preparation.md) §1/§3), for this export run:

- ☑ G1–G5 all ✅ (block A).
- ☑ Export-scoped G6 recorded (block C, filled).
- ☑ G3 re-affirmed for export (block B).
- ☑ §7 abort criteria acknowledged (block C / §7).

*Signed by:* operator (PO)  *Date:* 2026-07-13

**This sign-off is scoped to the single run authorized in block C; it lapses with block C if block F is not
executed this session.**

---

## E · §7 abort criteria · ☑ ACKNOWLEDGED by the operator for this run — 2026-07-13

(reference — full text in [`r4-preparation.md`](r4-preparation.md) §7)

- **Operator-immediate:** withdrawn consent · any unrecognized prompt/dialog · any anti-abuse signal
  (CAPTCHA storm / lockout) · any unexpected on-screen data → the human completes or walks away; the
  Runtime never retries around it.
- **Automatic fail-closed:** ambiguous/missing/drifted target, unexpected post-state, invalid session, or
  artifact-validation failure → blocker code, **zero clicks**, run persisted FAILED (resumable per R3).
- **Before a run drives:** Ctrl-C aborts; a sentinel timeout aborts without driving a run.

---

## F · Live entrypoint command — DO NOT RUN (documentation only; the STOP line)

> B/C/D/E are now **filled and signed** (above). The single live command below is the **only** remaining
> step. **This record does not execute it — the operator elected to stop here (2026-07-13).** Run it **only**
> with explicit operator go, in **this same continuous session**; if the session breaks first, block C is
> VOID and G3-export/G6 must be re-affirmed before the command may run.

```
# NAVER live work is PAUSED. Run ONLY in a dispatching turn with a filled export-scoped G6 (block C).
set -a && . ./.env && set +a          # loads env (never echo values)
npx tsx src/cli/run-action-window-live-naver.ts -- --i-understand-this-opens-live-naver
```

Built-in refusals (defense-in-depth): missing approval flag → exit 3 · `NODE_ENV=production` → exit 4 ·
missing review URL → exit 2. **Sentinel handshake:** the CLI opens the window and waits — the seller logs
in and reaches the export surface, then signals readiness (say "ready") **before** touching the control;
the Runtime then highlights and waits for the seller's real export click.

---

## G · Post-run evidence — RECORDED 2026-07-13 (sanitized; full detail in [`r4-evidence-pack.md`](r4-evidence-pack.md) §8-8)

Enums / booleans / counts / SHA only (`findProhibitedFields` enforced):

- ☑ Export-scoped G6 instance: filled 2026-07-13, operator (PO), one run — **CONSUMED**.
- ☑ Final run view: `{ status: FAILED, progress: {0,3}, channelCode: naver, blockerCode: UNSUPPORTED_STATE }`.
- ☑ Ingest outcome: not reached — no artifact (`processed: 0`).
- ☑ Quarantine dir empty (0); `downloads/` unchanged (0) — nothing captured/saved/uploaded.
- ☑ No-leak: clean teardown (process exited, sentinel removed, context closed); nothing beyond the view.
- ☑ Operation Run id: `run_f81fc0b19fdd` (`RESUME_FROM_FAILURE`).
- **Human checkpoint never reached** (`reached:false, observed:false`) → no highlight, no observed action,
  **zero clicks**. Fail-closed at the precondition; cause is one of two `UNSUPPORTED_STATE` branches (§8-8).

---

**Gate summary (2026-07-13):** G1 ✅ · G2 ✅ · G4 ✅ · G5 ✅ · P7 ✅ · P10 ✅ · G3 (export-scoped) ☑
re-affirmed · G6 ☑ filled + **RUN + CONSUMED** · P6 ☑ signed · §7 ☑ acknowledged. Block C was the **P12**
per-run PO approval for the one run, now spent. **Block F was RUN on 2026-07-13 → FAILED
(`UNSUPPORTED_STATE`, zero clicks, nothing captured; §8-8 / block G).** No further live contact is
authorized by this record — a **new** G3-export + G6 is required for any next run or read-only diagnostic.

> **Canonical-register sync — still deferred by design.** The living gate registers
> ([`r4-gate-record.md`](r4-gate-record.md) §G6 / [`r4-preparation.md`](r4-preparation.md) §1 P6·P12) are
> **not** flipped to a satisfied/passing state: the pilot **fail-closed**, so nothing here represents a
> successful supervised export. The registers record the §8-8 FAILED evidence, not a passed gate.
