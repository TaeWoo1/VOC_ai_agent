# R4 Run 2 — Live Settle-Fix Verification · Dispatch Record · EXECUTED 2026-07-14 · OBSERVE-ONLY · SETTLE **NOT** VERIFIED (negative)

> **RESULT (2026-07-14): the settle fix did NOT resolve the live failure.** Run 2 reproduced Run 1's
> `FAILED / progress 0-of-3 / UNSUPPORTED_STATE` at `prepareSurface` — the highlight never appeared.
> Fully non-mutating (no click / download / ingest / backend / status). Leading (unproven) cause: the
> readiness gate's **empty-marker precedence** short-circuits before it counts rows, which the §8-11
> probe never measured. Full write-up → [`r4-evidence-pack.md`](r4-evidence-pack.md) §8-13.

> **Run 2 is the LIVE confirmation of the readiness render-timing settle fix** (`settleExportSurface`,
> PR #250 / §8-12). Run 1 (§8-8) failed closed at `prepareSurface` with `UNSUPPORTED_STATE` — readiness
> read the surface **before** NAVER's SPA rendered the review grid. This run checks whether the settle now
> lets `prepareSurface` reach the human barrier on the **real** surface.
>
> **Posture (operator/PO decision, 2026-07-14): OBSERVE-ONLY, NO CLICK.** The seller logs in and reaches the
> export surface; the Runtime runs `prepareSurface` (with the settle) → `locate` → `highlight` → parks at
> `WAITING_FOR_HUMAN`. **The seller does NOT act on the export control.** No click → no download → no
> validate → **no ingest / no backend contact / no DB write / no status write.** Strictly less than a full
> export pilot. The entrypoint has no no-ingest mode, so the click/download/validate/ingest legs are
> avoided by simply **not clicking** and aborting at the barrier.

**Channel / seller:** NAVER SmartStore review-management export surface · `NAVER_DEV_SELLER_SELF_01`.
**Entrypoint:** `collector/src/cli/run-action-window-live-naver.ts` (gated by `--i-understand-this-opens-live-naver`).

---

## Gates — filled fresh for this run (operator/PO, 2026-07-14)

Static carried in: **G1 ✅** (D-021 channel) · **G2 ✅** (seller self-consent) · **G4 ✅** (synthetic ladder
green incl. the settle fix, offline suite 2677 passed) · **G5 ✅** (policy track). The read-only-probe G3
lifts and G6 instances are all **consumed**; this run fills its own fresh instances.

### G3 (export-scoped) — environment + §9-3 pause lift · ☑ AFFIRMED 2026-07-14
- ☑ Stable network / IP / location holds (the condition that paused NAVER live work).
- ☑ Dedicated Chrome connection profile intact · Bridge/persistence posture as recorded.
- ☑ **NAVER live-work pause lifted for THIS run** — a fresh lift scoped to one live export-surface run in
  the **observe-only, no-click** posture below. **Not** a general lift; **not** a click/download/ingest lift.

### P6 — supervised-pilot gate sign-off · ☑ AFFIRMED 2026-07-14 (observe-only scope)
- ☑ Signed off for the **observe-only readiness verification** scope only (prepare/locate/highlight, human
  barrier, no click). It does **not** authorize the click / download / validate / ingest path — a full
  export pilot would need a separate P6 + export-scoped G6 under the full §4 boundary.

### G6 — per-run approval · ☑ FILLED + CONSUMED 2026-07-14 (fresh, single-use)
- Run scope: ☑ **live export-surface run, OBSERVE-ONLY, NO CLICK** — the Runtime prepares/locates/highlights
  and parks; the seller performs **no** export action. **No click / no download / no validate / no ingest /
  no backend / no status write.**
- §7 abort criteria: ☑ acknowledged (below).
- G2 / G3 / G5 state: ☑ G2 ✅ · ☑ G3 ✅ export-scoped lift (above) · ☑ G5 ✅.
- Approved by: operator (PO) · Date: 2026-07-14 · **Single-use** — consumed by this one launch; **VOID** if
  not run this session. Any further live contact (incl. an actual click-through) needs a **new** G6.

### §7 abort criteria · ☑ ACKNOWLEDGED
- ☑ Operator-immediate: withdrawn consent · any unrecognized prompt/dialog · any anti-abuse signal
  (CAPTCHA storm / lockout) · any unexpected on-screen data → the seller aborts (**Ctrl-C**). The seller
  never acts on the export control in this run.
- ☑ The Runtime is structurally non-mutating here (no click; no download/validate/ingest is reached without
  a click; the in-page `data-aw-target` tag + `pointer-events:none` highlight overlay are read-only
  annotations torn down on cleanup).

---

## Verification plan (what the outcome means — no pass/fail number)

- **Settle PASSED (fix confirmed):** the run reaches `WAITING_FOR_HUMAN` and the **highlight overlay appears
  on the export control** (Run 1 never got there). The seller then does **not** click; we abort (Ctrl-C) at
  the barrier — no 10-min observe wait, no download, no ingest.
- **Settle did NOT fix it:** `prepareSurface` still fails closed → the CLI prints a **fast**
  `UNSUPPORTED_STATE` (progress 0 steps), exactly like Run 1 — the highlight never appears.
- Everything read is sanitized (status / progress / channelCode / blockerCode enums only). No URL, content,
  selector, filename, identity, or timestamp is emitted.

## Post-run evidence — ☑ RECORDED 2026-07-14

- ☑ **Reached `WAITING_FOR_HUMAN` + highlight?** **NO.** The run failed closed at `prepareSurface`; the
  highlight overlay never appeared — the settle did **not** reach the human barrier. **Settle FAILED live.**
- ☑ **Sanitized terminal result:** `status: FAILED` · `progress: { completedSteps: 0, totalSteps: 3 }` ·
  `channelCode: naver` · `blockerCode: UNSUPPORTED_STATE` — identical to Run 1 (§8-8).
- ☑ **Non-mutation confirmed:** failed at step 0 → no click, no download, no validate, no ingest, no
  backend contact, no status/`LAST_SUCCESS` write. Clean teardown: sentinel removed, `downloads/` empty,
  `.aw-quarantine` empty, browser closed, process exited, git worktree clean.
- ☑ **G6 consumed** (single-use, spent). Any further live contact needs a **new** G6.
- ☑ **Leading hypothesis (unproven — do NOT patch on a guess):** `evaluateExportTargetReadiness` checks
  empty-state / no-export-target **markers first (precedence 1)**, before counting rows; the settle treats
  an explicit marker as a **trusted halt** (resolves immediately). A hidden/off-screen empty phrase on the
  live surface would therefore halt on check 1 regardless of rendered rows. §8-11 measured only row buckets
  (`semanticRowCount`) via a **different** function and never saw the marker branch — so its "readiness
  would pass" inference was likely wrong.
- ☑ **Next (needs kickoff):** a read-only probe that emits the sanitized live `evaluateExportTargetReadiness`
  **decision + reason + state** (which branch fired), then correct from that evidence (§6) — **not** a
  speculative settle/marker patch. Recorded in [`r4-evidence-pack.md`](r4-evidence-pack.md) §8-13.
