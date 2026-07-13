# R4 Read-Only Row-Shape Probe — Dispatch Record · EXECUTED 2026-07-13 · G6 CONSUMED · hypothesis REFUTED

> **EXECUTED 2026-07-13** — the fresh read-only G6 (block C) is now **CONSUMED** by one seated-operator run.
> **Result (block G): the row-shape-miss hypothesis is REFUTED** — the top document read `semanticRowCount:
> many` **and** `dataRowLikeCount: many` (zero gap), so the readiness gate's `countDataRows` would have
> counted rows; Run 1's false-positive-empty is **not** a row-shape miss. Diagnosis widens to a **render-timing**
> gap. Full sanitized reading → [`r4-evidence-pack.md`](r4-evidence-pack.md) §8-11. Gates B/C/D as originally
> filled are retained below for the record. Source of truth:
> [`r4-gate-record.md`](r4-gate-record.md) §G3/§G6/§7 + [`r4-preparation.md`](r4-preparation.md) §7/§9.

**Probe:** the frame-aware read-only export-surface probe (`probe-export-same-session`) — **unchanged CLI**,
now emitting two additional sanitized row-shape signals (commit `802f0a0`,
[`export-probe.ts`](../../collector/src/naver/export-probe.ts)). No new command, no new code path.
**Channel:** NAVER SmartStore review-management surface. **Seller:** `NAVER_DEV_SELLER_SELF_01`.

**Why:** the 2026-07-13 read-only probe ([`r4-probe-dispatch-record.md`](r4-probe-dispatch-record.md),
[`r4-evidence-pack.md`](r4-evidence-pack.md) §8-10) pinned Run 1's `UNSUPPORTED_STATE` to a
**false-positive-empty** readiness verdict — rows were visible on screen, but the readiness gate's
`countDataRows` (`<tbody><tr>` / `role="row"`) matched none, so NAVER renders the grid as div-based /
virtualized rows the gate misses. This slice's offline signal (`802f0a0`) now lets the **same probe**
report both counts. Running it once measures the gap directly and turns the operator's "rows were visible"
into a sanitized, bucketed observation — the evidence required (collector §6) **before** any readiness-gate
correction is written. The probe **never clicks, exports, downloads, or writes any status**; it is strictly
**less** than an Action Window run.

> **This is NOT the export pilot.** No P6 sign-off and no §4 export boundary apply — those govern the
> supervised export run only. A read-only probe needs G3 (read-only-scoped) + a fresh read-only-scoped G6
> + §7 abort. It captures nothing.

---

## A · Already established (static — carried in, not re-affirmed here)

| Item | State | Source |
|---|---|---|
| G1 — channel ratified | ✅ | D-021 |
| G2 — seller self-consent | ✅ | §G2 · D-024 |
| G4 — synthetic ladder green (incl. the offline row-shape signal, hermetic +8) | ✅ | §8-2 / §8-9 · commit `802f0a0` |
| G5 — policy track logged | ✅ | §G5 |

The 2026-07-13 read-only probe's **G3 read-only lift and its one-run G6 are CONSUMED** (spent 2026-07-13);
they do **not** carry over. This probe needs its own fresh read-only lift + G6.

---

## B · G3 (read-only-scoped) — environment + pause lift · ☑ AFFIRMED 2026-07-13

Re-affirmed, **scoped to this read-only row-shape probe only** (no click / export / download):

- ☑ Stable network / IP / location still holds (the condition that paused NAVER live work).
- ☑ Dedicated Chrome connection profile intact · Bridge paired · Operation Run persistence enabled.
- ☑ **NAVER live-work pause lifted FOR THIS READ-ONLY PROBE ONLY** — a fresh, read-only-scoped lift
  ([`r4-preparation.md`](r4-preparation.md) §9 item 3); **not** a general lift and **not** an export lift.

*Affirmed by:* operator (PO)  *Date:* 2026-07-13  *Scope:* one read-only row-shape surface probe on `NAVER_DEV_SELLER_SELF_01`.

---

## C · G6 (per-run, read-only) — the probe authorization · ☑ FILLED 2026-07-13 (fresh instance)

G6 is **never standing**; the earlier 2026-07-13 read-only-probe instance is CONSUMED. This is a **fresh**
single-use instance for the row-shape probe (mirrors [`r4-gate-record.md`](r4-gate-record.md) §G6):

- Channel / seller:   NAVER SmartStore review-management · `NAVER_DEV_SELLER_SELF_01`
- Run scope:          ☑ **read-only frame-aware export-surface probe — no click / export / download / status write**
- §7 abort criteria:  ☑ acknowledged (any unrecognized prompt / anti-abuse signal / unexpected on-screen
                        data → operator aborts; the probe only reads, never retries around anything)
- G2 / G3 / G5 state: ☑ G2 ✅ · ☑ G3 ✅ read-only lift re-affirmed (block B) · ☑ G5 ✅
- Approved by:        operator (PO)  *Date:* 2026-07-13

*Single-use:* consumed by the one probe launch in block E — **not yet consumed** (held at the STOP line this
turn; to be spent by the seated "ready" run next turn, same session). **VOID** if not run before this
session/context ends — never standing for a later turn.

---

## D · §7 abort criteria · ☑ ACKNOWLEDGED 2026-07-13

(reference — [`r4-preparation.md`](r4-preparation.md) §7)

- ☑ **Operator-immediate:** withdrawn consent · any unrecognized prompt/dialog · any anti-abuse signal
  (CAPTCHA storm / lockout) · any unexpected on-screen data → the human completes or walks away; the probe
  never retries around it. **Ctrl-C aborts** at any point; a sentinel timeout aborts without probing.
- ☑ The probe is **structurally read-only** (no click / export / download / status write — source-guarded),
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
the CLI opens the window and waits — the seller logs in and reaches the review-management export surface
(with the review list actually rendered on screen), then signals readiness (say "ready"); the probe then
runs `extractExportProbeSignals` over the top document and **every child frame** (`page.frames()`) and folds
them via `summarizeFrameExportProbes`. Each frame's signals now carry **`semanticRowCount`** and
**`dataRowLikeCount`**. **No click, no export, no download, no status write** (source-guarded). Ctrl-C aborts.

---

## F · What to read from the result (measurement plan — no pass/fail gate)

This is a **measurement**, not an acceptance test — record the sanitized observation; do not treat any bucket
as a gate (per the metrics-as-hypotheses discipline). Read, from the frame that hosts the grid (per §8-10,
the **top document**):

- **The gap** = `semanticRowCount` vs `dataRowLikeCount`.
  - *Expected (hypothesis, not a gate):* `semanticRowCount: none` while `dataRowLikeCount: some` / `many`
    → **confirms + quantifies** the false-positive-empty; the div/virtualized rows the gate misses are real.
  - *If both are `none`:* the grid truly wasn't rendered at signal time (operator readiness / timing) —
    re-check the "rows visible on screen" precondition, do **not** conclude the surface is empty.
  - *If `semanticRowCount` is positive:* the gate would already have seen rows — Run 1's empty verdict was
    **not** purely a row-shape miss; widen the diagnosis.
- Also note (context, already emitted): `sessionVerdict`, `tableGridListCount`, `dateInputCount`,
  `exportCandidateCount` / visible / enabled, `shadowRootHostCount`, `frameUrlCategory` of any child frame.

Everything is enums / booleans / coarse buckets — **no** raw frame URL, content, selector, path, review
text, exact counts, identity, or `eventTimeMs`. The full sanitized reading goes to
[`r4-evidence-pack.md`](r4-evidence-pack.md) (new §8-11) and block G below **after** the run.

---

## G · Post-run evidence — ☑ RECORDED 2026-07-13 (one seated-operator read-only run)

- ☑ Read-only G6 instance: filled 2026-07-13, operator (PO), one probe — **CONSUMED**.
- ☑ **Row-shape gap:** `semanticRowCount: many` vs `dataRowLikeCount: many` (top document) — **ZERO gap.**
- ☑ Verdict on the false-positive-empty hypothesis: **☑ semantic-positive (widen diagnosis)** — block F's
  third branch. `semanticRowCount` mirrors `countDataRows`; reading `many` means the gate **would** have
  counted rows, so Run 1's empty verdict was **not** a row-shape miss. Hypothesis **REFUTED**.
- ☑ Context: `sessionVerdict: LOGGED_IN`; `tableGridListCount: many`; `exportCandidateCount/visible/enabled:
  one`; `dateInputCount: some`; `shadowRootHostCount: none`; child `frameUrlCategory: other` (unrelated,
  rows none/none).
- ☑ Read-only confirmed: no click / export / download / quarantine / ingest / status write; clean teardown
  (process exited, sentinel removed, `downloads/` + quarantine empty, git worktree clean).
- ☑ Next (needs explicit kickoff): **not** the row-shape-aware readiness correction (refuted) — instead a
  **readiness wait/timing** slice (wait for the grid to render before evaluating). The offline row-shape
  signal `802f0a0` stays a valid general signal but is **not** the Run-1 fix. Full reading →
  [`r4-evidence-pack.md`](r4-evidence-pack.md) §8-11.

---

**Gate summary (EXECUTED · G6 CONSUMED):** G1 ✅ · G2 ✅ · G4 ✅ · G5 ✅ · G3 (read-only) ☑ re-affirmed
2026-07-13 · G6 (read-only) ☑ filled + **CONSUMED** 2026-07-13 by one seated-operator run · §7 ☑ acknowledged
(no abort triggered). No P6 / no export §4 boundary were in scope (read-only probe, not the export pilot).
**Result:** the row-shape-miss hypothesis is **REFUTED** (zero gap, both `many`); diagnosis widens to a
render-timing gap (§8-11). The consumed G6 is spent — **any further live contact needs a fresh G6.**
