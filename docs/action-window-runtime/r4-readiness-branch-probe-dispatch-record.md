# R4 — Read-Only Readiness-Branch Probe · Dispatch Record · EXECUTED 2026-07-14 · ROOT CAUSE CONFIRMED

> **RESULT (2026-07-14): CONFIRMED — `empty_state_marker` precedence is the Run-1/Run-2 root cause.**
> On the export-surface frame the gate HALTed at `empty_state_marker` (rung 1) **while its own
> `semanticRowCount` was `many`** — a "no results" placeholder coexists with a fully populated review grid,
> and the marker precedence masks a would-be-`READY / positive_rows` surface (rung 3). Read-only,
> non-mutating (no click / download / ingest / backend / status); G6 consumed. Full write-up →
> [`r4-evidence-pack.md`](r4-evidence-pack.md) §8-14.

> **STATUS (as prepared): PREPARED — NOT RUN.** This record was staged for one human-attended, READ-ONLY
> probe run. The gate checklist below was **PENDING operator affirmation at dispatch**; nothing here
> authorized a launch on its own. It was affirmed and executed on 2026-07-14 (see the post-run block).

## Why this run — stop guessing, observe the gate

Live Run 2 ([`r4-run2-settle-verification-dispatch-record.md`](r4-run2-settle-verification-dispatch-record.md)
· evidence pack §8-13) reproduced Run 1's `FAILED / 0-of-3 / UNSUPPORTED_STATE` at `prepareSurface`: the
render-timing **settle** did NOT close the false-positive-empty gap. The leading (still **unproven**)
hypothesis is that `evaluateExportTargetReadiness` checks empty-state / no-export-target **markers first**
(precedence rung 1), short-circuiting **before** it counts rows — so a hidden/off-screen empty phrase halts
regardless of rendered rows. §8-11 measured only row-count proxies (`semanticRowCount`/`dataRowLikeCount`)
via a **different** function and never saw the marker branch, so its "readiness would pass" inference was
likely wrong.

This run OBSERVES the actual gate decision instead of inferring it. The readiness-branch instrumentation
(commit `fa5c931`) makes the READ-ONLY frame-aware probe emit, **per frame**, the gate's verbatim
`readiness` (decision / state / reason) plus `readinessBranch` (which precedence rung fired). One live read
tells us **which branch actually fires on the real surface** — and thus which fix direction is warranted,
from evidence (collector §6), not a speculative marker/settle patch.

## Posture — READ-ONLY, NO CLICK, no driver, no barrier

Strictly less than Run 2. This does **not** run the Action-Window driver, does not
prepare/locate/highlight, does not park at a human barrier, mounts **no** overlay, and never reaches the
export control. It is the existing read-only diagnostic:

- **Entrypoint:** `collector/src/cli/probe-export-same-session.ts` (gated by
  `--i-understand-this-opens-live-naver`) — one persistent-context lifetime; the human logs in and reaches
  the export surface; a sentinel file signals readiness; the probe then reads the **top document plus every
  child frame** ONCE and prints one sanitized JSON summary.
- **Read-only by construction:** the source guard forbids `.click(` / `waitForEvent("download")` / `saveAs`
  / upload / status write; every per-frame read is a text/attribute/visibility scan only — never a click,
  focus, submit, or dispatched event. No download, no ingest, no backend contact, no DB, no
  status/`LAST_SUCCESS` write. Nothing is sent to SellerOps.
- **New in this run:** the per-frame signal now includes `readiness` + `readinessBranch` (enums + one coarse
  bucket). No new surface is touched — the same read, one richer sanitized field set.

**Channel / seller:** NAVER SmartStore review-management export surface · `NAVER_DEV_SELLER_SELF_01`.
**Invocation (do NOT run yet):**
`set -a && . ./.env && set +a` then `npm run probe-export-same-session -- --i-understand-this-opens-live-naver`.

---

## Gates — to be AFFIRMED FRESH at dispatch (operator/PO) · ☐ ALL PENDING

Static carried in: **G1** (D-021 channel) · **G2** (seller self-consent) · **G4** (offline suite green incl.
the readiness-branch instrumentation — 2693 passed) · **G5** (policy track). The prior read-only-probe G3
lift and every earlier G6 are **consumed**; this run needs its own fresh instances, unchecked until the
operator affirms them in the dispatching turn.

### G3 (read-only lift) — environment + §9-3 pause · ☐ PENDING
- ☐ Stable network / IP / location holds (the condition that paused NAVER live work).
- ☐ Dedicated Chrome connection profile intact.
- ☐ NAVER live-work pause lifted **for THIS one read-only probe run** — scoped to a read-only frame read.
  **Not** a general lift; **not** a click / download / ingest / export lift.

### G6 — per-run approval · ☐ PENDING (fresh, single-use)
- ☐ Run scope: **live export-surface READ, READ-ONLY, NO CLICK** — the probe reads sanitized signals from
  the top document + every child frame and prints one JSON summary. No click / download / validate / ingest
  / backend / status write.
- ☐ §7 abort criteria acknowledged (below).
- ☐ G2 / G3 / G5 state affirmed.
- Single-use — consumed by the one launch; **VOID** if not run this session. Any further live contact
  (including any click-through) needs a **new** G6.
- P6 is **not** in scope: no supervised-pilot / export path is exercised here.

### §7 abort criteria · ☐ ACKNOWLEDGED AT DISPATCH
- ☐ Operator-immediate: withdrawn consent · any unrecognized prompt/dialog · any anti-abuse signal
  (CAPTCHA storm / lockout) · any unexpected on-screen data → abort (**Ctrl-C**). The probe never acts on
  the export control.
- ☐ Structurally non-mutating: read-only scans only; the sentinel file is the sole continuation; the
  context is closed and the sentinel removed on cleanup.

---

## Verification plan (what each observed branch MEANS — no pass/fail number)

The probe prints, per frame (top document + each child), `frameUrlCategory`, the row-shape proxies
(`semanticRowCount` / `dataRowLikeCount`), and — new — the gate's `readiness` + `readinessBranch`. Read the
branch on the frame that actually hosts the export UI (the one with export candidates), and compare it to
the row proxies:

- **`empty_state_marker` / `no_export_target_marker`** (HALT) on the surface frame, while `dataRowLikeCount`
  is `some`/`many` → **CONFIRMS the empty-marker-precedence hypothesis**: a marker short-circuits rung 1
  before rows count. Fix direction (later slice): make the marker check visibility/precedence-aware, or
  subordinate it to positive row evidence. **Refutes** the settle as the fix (already refuted).
- **`labeled_count_zero`** (HALT) → an explicit "0건"-style count drove the halt, distinct from a marker.
  Different fix: the labeled count, not a stray phrase.
- **`results_container_zero_rows`** (HALT) with `dataRowLikeCount` `some`/`many` → a container exists but the
  gate's semantic counter misses div-based / virtualized rows the page renders. Fix direction: teach
  `countDataRows` the div-grid shape (evidence for this already exists offline; this confirms it live).
- **`ambiguous_no_signal`** (HALT) → the gate sees nothing decidable in the read frame (SPA rows not in
  static HTML, or the read frame is not the surface frame). Cross-check `anyFrameExportCandidates` and which
  frame carries the candidates to tell "rows not in static HTML" from "wrong frame read."
- **`data_rows_present` / `labeled_count_positive`** (READY) on the surface frame → readiness WOULD pass on
  that frame; the driver's live failure is then a **frame-resolution** problem (it evaluated a different
  frame than the one with rows), NOT the gate. Fix direction moves to the driver's surface/frame targeting.

Everything read is sanitized (decision / state / reason / branch enums + coarse buckets + URL categories
only). No URL, content, selector, filename, identity, timestamp, or raw HTML is emitted.

## Post-run evidence — ☑ RECORDED 2026-07-14

- ☑ **Gates affirmed at dispatch:** operator seated + explicit go; G3 (read-only lift), fresh single-use G6,
  §7 acknowledged. Executed the read-only frame-aware probe once; `sessionVerdict: LOGGED_IN`.
- ☑ **Export-surface frame (top document — the frame carrying the visible + enabled export candidate,
  `exportCandidateCount: one`, `excelLike`/`downloadLike` true):**
  - `readinessBranch: empty_state_marker`
  - `readiness: HALT · EXPORT_TARGET_EMPTY · empty_state`
  - `semanticRowCount: many` · `dataRowLikeCount: many`
- ☑ **Child frame (`other`):** a non-export utility frame — no candidates, `readinessBranch:
  ambiguous_no_signal`. Not the surface; irrelevant to the cause.
- ☑ **Which hypothesis:** **CONFIRMED — `empty_state_marker` precedence.** The gate's own row counter sees
  `many` rows (rung 3 would return `READY / positive_rows`) but never reaches it: rung 1's empty-state
  marker short-circuits and HALTs. A "no results" placeholder coexists with a populated grid, and the
  marker wrongly outranks the positive row evidence.
- ☑ **Competing explanations ruled out by the same read:**
  - NOT div-grid/virtualized rows the gate can't see — `semanticRowCount` is `many`, not `none`.
  - NOT a frame-resolution bug — the surface frame IS the top document and carries both the rows and the
    candidate.
  - NOT the render-timing gap — the surface was never row-empty; that is precisely why the settle (Run 2)
    could not fix it (it waited for rows that were already present while a marker masked them).
- ☑ **Non-mutation confirmed:** read-only frame reads only; no click / download / validate / ingest /
  backend / status / `LAST_SUCCESS` write. Clean teardown: sentinel auto-removed (`.status/` empty), no
  `downloads/`, context closed, process exited, git worktree clean.
- ☑ **G6 consumed** (single-use, spent). Any further live contact needs a **new** G6.
- ☑ **Next (evidence-based, offline slice — NOT a speculative patch):** in `evaluateExportTargetReadiness`,
  positive row/count evidence must outrank the empty-state marker (check rows/count before the marker, or
  require the empty-state node to be the *visible* state — the placeholder is almost certainly
  present-but-hidden while the grid is populated). Design + hermetic tests offline, then re-verify.
  Recorded in [`r4-evidence-pack.md`](r4-evidence-pack.md) §8-14.
