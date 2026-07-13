# R4 Read-Only Frame-Aware Surface Probe — Dispatch Record · EXECUTED 2026-07-13 · G6 CONSUMED

> **Filled and RUN by the operator (PO) on 2026-07-13**, seated, in one session: G3 (read-only lift), G6
> (read-only), and §7 were affirmed in-turn and the probe (block E) was run. **Outcome: read-only success —
> nothing clicked/exported/downloaded/saved; the export surface was located in the TOP DOCUMENT, refuting
> the child-frame hypothesis; Run-1 root cause pinned to a false-positive-empty readiness verdict** (full
> sanitized result in [`r4-evidence-pack.md`](r4-evidence-pack.md) §8-10, block F below). **The read-only
> G6 is now CONSUMED** — any further live contact needs a fresh read-only-scoped (or export-scoped) G6.
> Source of truth: [`r4-gate-record.md`](r4-gate-record.md) §G3/§G6/§7 + [`r4-preparation.md`](r4-preparation.md) §7/§9.

**Probe:** the frame-aware read-only export-surface probe (`probe-export-same-session`) — the diagnostic
proposed after Run 1 fail-closed `UNSUPPORTED_STATE` ([`r4-evidence-pack.md`](r4-evidence-pack.md) §8-8).
**Channel:** NAVER SmartStore review-management surface. **Seller:** `NAVER_DEV_SELLER_SELF_01`.

**Why:** decide *which* `UNSUPPORTED_STATE` branch Run 1 hit and confirm the frame-aware fix hypothesis —
does the review grid + export control live in the **top document**, a **child frame**, **shadow DOM**, or
is the result **genuinely empty**? The probe runs the sanitized per-frame signal extractor over the top
document **and every child frame** and folds them; it **never clicks, exports, downloads, or writes any
status**. It is strictly **less** than an Action Window run.

> **This is NOT the export pilot.** No P6 sign-off and no §4 export boundary apply — those govern the
> supervised export run only. A read-only probe needs G3 (read-only-scoped) + a fresh read-only-scoped G6
> + §7 abort. It captures nothing.

---

## A · Already established (static — carried in, not re-affirmed here)

| Item | State | Source |
|---|---|---|
| G1 — channel ratified | ✅ | D-021 |
| G2 — seller self-consent | ✅ | §G2 · D-024 |
| G4 — synthetic ladder green (incl. the frame-aware fix, hermetic) | ✅ | §8-2 / §8-9 · fix commit `e2be2e0` |
| G5 — policy track logged | ✅ | §G5 |

The earlier §8-4 read-only probe's **G3 read-only lift and its one-run G6 are CONSUMED** (spent 2026-07-12);
they do **not** carry over. This probe needs its own fresh read-only lift + G6.

---

## B · G3 (read-only-scoped) — environment + pause lift · ☐ FILL IN THE DISPATCHING TURN

The recorded G3 read-only lift was scoped to the §8-4 session-precondition probe and is spent. Re-affirm,
**scoped to this read-only frame-aware probe only** (no click / export / download):

- ☐ Stable network / IP / location still holds (the condition that paused NAVER live work).
- ☐ Dedicated Chrome connection profile intact · Bridge paired · Operation Run persistence enabled.
- ☐ **NAVER live-work pause lifted FOR THIS READ-ONLY PROBE ONLY** — a fresh, read-only-scoped lift
  ([`r4-preparation.md`](r4-preparation.md) §9 item 3); **not** a general lift and **not** an export lift.

*Affirmed by:* ______  *Date:* ______  *Scope:* one read-only frame-aware surface probe on `NAVER_DEV_SELLER_SELF_01`.

---

## C · G6 (per-run, read-only) — the probe authorization · ☐ FILL IN THE DISPATCHING TURN

G6 is **never standing**; the §8-4 read-only-probe instance is CONSUMED. Fill a fresh instance in the
dispatching turn (mirrors [`r4-gate-record.md`](r4-gate-record.md) §G6):

- Channel / seller:   NAVER SmartStore review-management · `NAVER_DEV_SELLER_SELF_01`
- Run scope:          ☐ **read-only frame-aware export-surface probe — no click / export / download / status write**
- §7 abort criteria:  ☐ acknowledged (any unrecognized prompt / anti-abuse signal / unexpected on-screen
                        data → operator aborts; the probe only reads, never retries around anything)
- G2 / G3 / G5 state: ☐ G2 ✅ · ☐ G3 ✅ read-only lift re-affirmed (block B) · ☐ G5 ✅
- Approved by:        ______  *Date:* ______

*Single-use:* consumed by the one probe launch in block E. **VOID** if not run before this session/context
ends — never standing for a later turn.

---

## D · §7 abort criteria · ☐ ACKNOWLEDGE IN THE DISPATCHING TURN

(reference — [`r4-preparation.md`](r4-preparation.md) §7)

- ☐ **Operator-immediate:** withdrawn consent · any unrecognized prompt/dialog · any anti-abuse signal
  (CAPTCHA storm / lockout) · any unexpected on-screen data → the human completes or walks away; the probe
  never retries around it. **Ctrl-C aborts** at any point; a sentinel timeout aborts without probing.
- ☐ The probe is **structurally read-only** (no click / export / download / status write — source-guarded),
  so there is no artifact/quarantine/ingest path to fail closed; a non-usable surface simply yields a
  sanitized "unrecognized/empty" summary.

---

## E · Live probe command — DO NOT RUN (documentation only; the STOP line)

> The record ends here. The command below runs **only** after B/C/D are filled in a dispatching turn with
> explicit operator go, in this same session. This staged record does not execute it.

```
# NAVER live work is PAUSED. Run ONLY in a dispatching turn with a filled read-only G6 (block C).
set -a && . ./.env && set +a          # loads env (never echo values)
npm run probe-export-same-session -- --i-understand-this-opens-live-naver
```

Built-in refusal: missing approval flag → the CLI refuses (`live-run-approval.ts`). **Sentinel handshake:**
the CLI opens the window and waits — the seller logs in and reaches the review-management export surface,
then signals readiness (say "ready"); the probe then runs `extractExportProbeSignals` over the top document
and **every child frame** (`page.frames()`) and folds them via `summarizeFrameExportProbes`. **No click, no
export, no download, no status write** (source-guarded). Ctrl-C aborts.

---

## F · Post-run evidence — RECORDED 2026-07-13 (sanitized; full detail in [`r4-evidence-pack.md`](r4-evidence-pack.md) §8-10)

Category enums / booleans / bucketed counts only — no raw frame URL, content, selector, path, or `eventTimeMs`:

- ☑ Read-only G6 instance: filled 2026-07-13, operator (PO), one probe — **CONSUMED**.
- ☑ **Where the export surface lives:** the **TOP DOCUMENT** (`exportCandidateCount: one`, visible + enabled;
  `tableGridListCount: many`; `dateInputCount: some`). The one child frame is `frameUrlCategory: other`, all
  export/grid/review signals `none` — **unrelated**. `shadowRootHostCount: none`.
- ☑ Session `LOGGED_IN`; `frameCount: few`; `anyFrameExportCandidates: true` (the top-document control).
- ☑ **Branch:** the **export-target readiness HALT** (NOT session `UNKNOWN`) — grid containers present but
  `countDataRows` (`<tbody><tr>` / `role="row"`) found none, while the operator confirmed **rows were
  visible on screen** → a **FALSE-POSITIVE empty** (div-based / virtualized grid the counter misses).
- ☑ **REFUTES** the child-frame hypothesis → the frame-aware fix `e2be2e0` does not address Run 1 (§8-8
  correction). Next = row-shape-aware readiness (offline probe extension → one read-only probe → readiness
  correction), or a PO decision to relax the gate.
- ☑ Read-only confirmed: no click / export / download / quarantine / ingest / status write; clean teardown.

---

**Gate summary (2026-07-13):** G1 ✅ · G2 ✅ · G4 ✅ · G5 ✅ · G3 (read-only) ☑ re-affirmed · G6 (read-only)
☑ filled + **RUN + CONSUMED** · §7 ☑ acknowledged. No P6 / no export §4 boundary were in scope (read-only
probe, not the export pilot). **The probe RAN 2026-07-13 → read-only success; surface located in the top
document; Run-1 root cause = false-positive-empty readiness (§8-10 / block F).** No further live contact is
authorized by this record — a **fresh** read-only-scoped (or export-scoped) G6 is required for any next run.
