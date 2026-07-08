# Current State — Action Window Runtime

<!-- Update this file when starting or changing the active slice. Fixed top section below. -->

- **updated at:** 2026-07-08
- **baseline main SHA:** `026eb77` (`origin/main`; PR #209 + PR #210 + **PR #212 R0 contract** all merged; `contracts/action-window/v1/` present on main)
- **current branch:** `feat/action-window-runtime-r1` (R1 slice)
- **current worktree:** `sellerops-runtime` (linked worktree of the shared SellerOps repo)
- **branch base SHA:** `026eb77` (`origin/main`, merged)
- **shared contract version/path:** **MERGED — `contracts/action-window/v1/` (`ACTION_WINDOW_PROTOCOL_VERSION = 1`), R0 PR #212 merge SHA `026eb77`.** nested-in-Bridge-v1 transport (Bridge `collector/src/bridge/protocol.ts` unchanged).
- **current slice:** R1 (synthetic Action Window loop) — **VERIFIED** (automated + headed operator-click QA passed); PR open
- **last completed item:** R1 channel-neutral synthetic loop under `collector/src/action-window/*` (engine, locator, overlay, observer, verifier, dummy downstream, sink, view projection, harness) + synthetic fixture + headed QA CLI
- **last verified tests:** `engine.test.ts` (17, offline) + `fixture-browser.test.ts` (8, `RUN_INTEGRATION=1`); full collector suite **2403 passed / 9 skipped**; `tsc --noEmit` clean. **Headed operator QA:** `normal` → real human click → COMPLETED (13-event loop, `USER_ACTION_OBSERVED` from the human click); `multi-candidate` → failed closed `TARGET_AMBIGUOUS`, no click.
- **current blocker:** none — R1 verified; awaiting dispatch of R2.
- **next single action:** proceed to **R2 Runtime/FE synthetic integration** over the real Bridge (do NOT begin R2 until dispatched)
- **parked work:** ESM marketplace-attribution experiment in `sellerops-esm-live` (`5a43dcb` + 8 uncommitted files) — frozen; do not clean, commit, merge, or continue
- **forbidden work:** editing canonical product docs from this branch; touching the FE worktree; touching/cleaning `sellerops-esm-live`; launching Chrome / live commerce action; automatic marketplace selection or export click as default; wiring Projection as a V1 dependency

## Truth snapshot

- The **Action Window target architecture is accepted** (see canonical
  `../product-scope-v1.md` §1.5, `../slices/action-window-v1.md`).
- The **Action Window Runtime is not implemented yet.** Nothing here is
  live-verified.
- Existing **reconnect / profile / Bridge / candidate-signature / download**
  primitives may be **reused**, but their existence is not Action Window
  capability (see [`checklist.md`](checklist.md)).
- **Browser Projection is retained** infrastructure (State B: committed at
  `a0e4f6f`, not wired into the `local-agent` boot — confirmed: no projection
  wiring in `collector/src/cli/local-agent.ts`) and is **not a V1 dependency**.
- The **ESM auto-click marketplace-attribution work is parked**, not completed.
- **No live Action Window capture is complete.**
- **R0 (contract) is MERGED** (PR #212, `026eb77`) as `contracts/action-window/v1/`
  (protocol v1). **R1 (synthetic loop) is VERIFIED** under
  `collector/src/action-window/*` — automated tests green AND the headed
  operator-click QA passed end-to-end. No live channel, Bridge transport, or FE
  screen yet.

## Existing foundations vs implemented Action Window capability

**Existing foundations (reusable, not delivered Action Window):** connection
profile resolver, candidate signature / frame scan, fail-closed gate / sentinel,
read-only download readiness, upload/ingestion handoff, work/run/audit domain,
Bridge protocol, Browser Projection (optional renderer).

**Implemented Action Window capability:** R1 channel-neutral synthetic loop
(`collector/src/action-window/*`) — pure state engine, target locator, overlay,
user-action observer, transition verifier, fail-closed blockers, dummy downstream,
in-memory event sink, `ActionWindowRunView` projection, cleanup. Synthetic-only;
automated + headed-operator-QA verified. Not live, not FE-integrated.

## Baseline / branch caveat

Resolved: PR #209 (product/runtime integration) and PR #210 (Runtime docs
baseline) are both **merged**; `main` is now `c156c59` and contains both the
strategy docs and the runtime foundations. The R0 contract branch
(`feat/action-window-contract`) is cut directly from that merged `main`, so no
unmerged-base caveat remains.
