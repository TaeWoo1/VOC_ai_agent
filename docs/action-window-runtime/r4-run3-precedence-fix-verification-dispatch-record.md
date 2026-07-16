# R4 Run 3 — Live Precedence-Fix Verification · Dispatch Record · EXECUTED 2026-07-14 · FIX CONFIRMED LIVE

> **RESULT (2026-07-14): the §8-15 precedence fix is CONFIRMED LIVE.** `prepareSurface` PASSED readiness and
> the run reached the human barrier — `progress 2-of-3`, `blockerCode: DOWNLOAD_TIMEOUT` (NOT the Run-1/Run-2
> `UNSUPPORTED_STATE` at `progress 0-of-3`). The **guide/highlight overlay appeared on the Excel download
> control** (operator-confirmed). Observe-only ended on the **expected, benign `DOWNLOAD_TIMEOUT`** — no
> click → no download → no validate → no ingest → no backend / status write. Fully non-mutating; G6 consumed.
> Full write-up → [`r4-evidence-pack.md`](r4-evidence-pack.md) §8-16.

> **STATUS: DISPATCHED 2026-07-14 — OBSERVE-ONLY.** Operator seated and gave explicit go; G3/P6/G6/§7
> affirmed fresh (below). One human-attended, OBSERVE-ONLY export-surface run to verify the §8-15 readiness
> precedence fix reaches the human barrier. No click / download / ingest / backend / status write.

## Why this run — verify the fix reaches the human barrier

The §8-14 root cause is CONFIRMED live: on the export-surface frame the gate HALTed at `empty_state_marker`
(rung 1) **while its own `semanticRowCount` was `many`** — a "no results" placeholder coexists with a fully
populated grid, and the old marker-first precedence masked a would-be-`READY` surface. The fix (§8-15, local
commit `0ee3b6e`) reorders `evaluateExportTargetReadiness` so a positive labeled count / real data rows
**outrank** the empty-state markers (with an in-table placeholder-row guard so a lone placeholder still
HALTs). It is **offline-verified only** (2702 passed); it has **not** been proven on the real surface.

Run 1 (§8-8) and Run 2 (§8-13) both failed closed at `prepareSurface` with `UNSUPPORTED_STATE` — the
highlight never appeared. This run checks the one thing that proves the fix: with the corrected precedence,
does `prepareSurface` now pass readiness and **reach the human barrier with the export control highlighted**?

## Posture — OBSERVE-ONLY, NO CLICK (operator/PO decision 2026-07-14)

Identical boundary to Run 2. The Runtime runs `prepareSurface` (with the fixed readiness) → `locate` →
`highlight` → parks at `WAITING_FOR_HUMAN`. **The seller does NOT act on the export control.** No click → no
download → no validate → **no ingest / no backend contact / no DB write / no status/`LAST_SUCCESS` write.**
Strictly less than a full export pilot. The entrypoint has no no-ingest mode, so the click/download/
validate/ingest legs are avoided simply by **not clicking** and aborting at the barrier.

> ⏩ **Forward-pointer added 2026-07-16 (A1 / [D-027](decisions.md)) — this record is NOT amended.** A
> `--no-ingest` mode now exists, so "the entrypoint has no no-ingest mode" is no longer true of the
> codebase; it was true at dispatch and this run was executed accordingly. **This run's G6 is spent.**
> The lever this run used — **not clicking** — remains the only one that is non-mutating by construction.

- This run verifies **readiness only** — that the fix flips `prepareSurface` from `UNSUPPORTED_STATE` to
  reaching the barrier. It does **not** exercise (and this record does not authorize) the click → download →
  validate → **real `/api/uploads` ingest** path; that is a separate, irreversible full-pilot authorization
  (§4.2) needing its own P6 + export-scoped G6.
- The fix runs because the entrypoint executes the working-tree source via `tsx` — `0ee3b6e` is in the tree.

**Channel / seller:** NAVER SmartStore review-management export surface · `NAVER_DEV_SELLER_SELF_01`.
**Entrypoint:** `collector/src/cli/run-action-window-live-naver.ts` (gated by `--i-understand-this-opens-live-naver`).
**Invocation (do NOT run yet):** load `.env`, then the gated live-run command with the approval flag; abort
(Ctrl-C) at the barrier without clicking.

---

## Gates — AFFIRMED FRESH at dispatch (operator/PO, 2026-07-14) · ☑ ALL AFFIRMED

Static carried in: **G1** (D-021 channel) · **G2** (seller self-consent) · **G4** (offline suite green incl.
the precedence fix — 2702 passed) · **G5** (policy track). Every earlier G3 lift / P6 / G6 is **consumed**;
this run fills its own fresh instances.

### G3 (export-scoped) — environment + §9-3 pause lift · ☑ AFFIRMED 2026-07-14
- ☑ Stable network / IP / location holds (the condition that paused NAVER live work).
- ☑ Dedicated Chrome connection profile intact.
- ☑ NAVER live-work pause lifted **for THIS one observe-only export-surface run** — scoped to prepare/
  locate/highlight + human barrier, **no click**. **Not** a general lift; **not** a click / download /
  ingest / export lift.

### P6 — supervised-pilot gate sign-off · ☑ AFFIRMED 2026-07-14 (observe-only scope)
- ☑ Signed off for the **observe-only readiness verification** scope only (prepare/locate/highlight, human
  barrier, no click). It does **not** authorize the click / download / validate / **ingest** path — a full
  export pilot needs a separate P6 + export-scoped G6 under the full §4 boundary.

### G6 — per-run approval · ☑ AFFIRMED + CONSUMED 2026-07-14 (fresh, single-use)
- ☑ Run scope: **live export-surface run, OBSERVE-ONLY, NO CLICK** — the Runtime prepares/locates/highlights
  and parks; the seller performs **no** export action. **No click / no download / no validate / no ingest /
  no backend / no status write.**
- ☑ §7 abort criteria acknowledged (below).
- ☑ G2 / G3 / G5 state affirmed.
- Approved by operator (PO) · Date 2026-07-14 · Single-use — consumed by this launch; **VOID** thereafter.
  Any further live contact (including an actual click-through) needs a **new** G6.

### §7 abort criteria · ☑ ACKNOWLEDGED AT DISPATCH 2026-07-14
- ☑ Operator-immediate: withdrawn consent · any unrecognized prompt/dialog · any anti-abuse signal
  (CAPTCHA storm / lockout) · any unexpected on-screen data → the seller aborts (**Ctrl-C**). The seller
  never acts on the export control in this run.
- ☑ The Runtime is structurally non-mutating here (no click; no download/validate/ingest is reached without
  a click; the in-page `data-aw-target` tag + `pointer-events:none` highlight overlay are read-only
  annotations torn down on cleanup).

---

## Verification plan (what the outcome means — no pass/fail number)

- **Fix CONFIRMED live:** the run reaches `WAITING_FOR_HUMAN` and the **highlight overlay appears on the
  export control** (Run 1 & 2 never got there). This proves the corrected precedence now reads the populated
  surface as `READY / positive_rows` instead of halting on the coexisting marker. The seller then does
  **not** click; we abort (Ctrl-C) at the barrier — no observe wait, no download, no ingest.
- **Fix did NOT resolve it:** `prepareSurface` still fails closed → a **fast** `UNSUPPORTED_STATE` (progress
  0 steps), like Runs 1–2 — the highlight never appears. Then the surface's live shape differs from the
  §8-14 reading (e.g. rows the gate still can't see, or another marker path); record it and re-diagnose from
  a fresh read-only readiness-branch probe — **not** a speculative patch.
- Everything read is sanitized (status / progress / channelCode / blockerCode enums only). No URL, content,
  selector, filename, identity, or timestamp is emitted.

## Post-run evidence — ☑ RECORDED 2026-07-14

- ☑ **Reached the human barrier + highlight? YES — fix CONFIRMED live.** `prepareSurface` passed readiness;
  the run advanced prepare → locate → **highlight** and reached the barrier. The **guide/highlight overlay
  appeared on the Excel download control** (operator-confirmed, visual corroboration of the sanitized
  result).
- ☑ **Sanitized terminal result:** `status: FAILED` · `progress: { completedSteps: 2, totalSteps: 3 }` ·
  `channelCode: naver` · `blockerCode: DOWNLOAD_TIMEOUT`. The discriminator vs. Runs 1–2
  (`completedSteps: 0`, `UNSUPPORTED_STATE`): readiness no longer halts — `completedSteps` rose 0 → 2 and the
  blocker moved from the readiness gate to the (benign, no-click) download-detect step.
- ☑ **`DOWNLOAD_TIMEOUT` is the EXPECTED, benign observe-only terminal.** After the barrier, `driveOneRun`
  auto-armed the download observer; with **no click → no download**, detect timed out (~60 s) and failed
  closed. A `FAILED` terminal is correct here — the run *should* fail closed when the seller does not click.
  The verification target was "does readiness stop blocking?", not "COMPLETED".
- ☑ **Non-mutation confirmed:** `DOWNLOAD_TIMEOUT` at detect ⇒ no download captured → no validate → no
  ingest → no backend / DB / status / `LAST_SUCCESS` write. Clean teardown: sentinel auto-removed
  (`.status/` empty), no `downloads/`, no `.aw-quarantine/`, browser closed, process exited, git worktree
  clean.
- ☑ **G6 consumed** (single-use, spent). Any further live contact — in particular the click → download →
  validate → **real `/api/uploads` ingest** full pilot — needs a **new** P6 + export-scoped G6 under the
  full §4 boundary.
- ☑ **Recorded** in [`r4-evidence-pack.md`](r4-evidence-pack.md) §8-16; §8-15 flipped from offline-verified
  to **live-verified for the readiness gate**. §6 / current-state updated.
