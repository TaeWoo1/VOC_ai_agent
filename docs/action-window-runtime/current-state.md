# Current State — Action Window Runtime

<!-- Update this file when starting or changing the active slice. Fixed top section below. -->

- **updated at:** 2026-07-08
- **baseline main SHA:** `c156c59` (`origin/main`; PR #209 product/runtime integration + PR #210 Runtime docs baseline both merged; contains the strategy docs AND the runtime foundations)
- **current branch:** `feat/action-window-contract` (R0 slice); Runtime engine work continues on `feat/action-window-runtime`
- **current worktree:** `sellerops-contract` (linked worktree of the shared SellerOps repo)
- **branch base SHA:** `c156c59` (`origin/main`, merged)
- **shared contract version/path:** **DEFINED — `contracts/action-window/v1/` (`ACTION_WINDOW_PROTOCOL_VERSION = 1`).** JSON Schema `schema.json` + TS `index.ts`; nested-in-Bridge-v1 transport (Bridge `collector/src/bridge/protocol.ts` unchanged). R0 PR **open, not yet merged.**
- **current slice:** R0 (contract baseline) — contract + fixtures + conformance tests delivered; PR open
- **last completed item:** R0 Action Window protocol v1 contract (`contracts/action-window/v1/*`) with 55/55 conformance tests
- **last verified tests:** `collector/test/contracts/action-window/contract.test.ts` — 55/55 (vitest); contract surface strict `tsc --noEmit` clean
- **current blocker:** none technical; R0 PR awaiting review/merge before R2 (FE integration) can begin
- **next single action:** build the **R1 synthetic Action Window engine** against the R0 contract fixtures (do NOT begin R1 until dispatched)
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
- **R0 (contract) is delivered** as `contracts/action-window/v1/` (protocol v1),
  PR open; the **next action is the R1 synthetic engine** built against the R0
  fixtures. R1 is **not** implemented.

## Existing foundations vs implemented Action Window capability

**Existing foundations (reusable, not delivered Action Window):** connection
profile resolver, candidate signature / frame scan, fail-closed gate / sentinel,
read-only download readiness, upload/ingestion handoff, work/run/audit domain,
Bridge protocol, Browser Projection (optional renderer).

**Implemented Action Window capability:** none yet.

## Baseline / branch caveat

Resolved: PR #209 (product/runtime integration) and PR #210 (Runtime docs
baseline) are both **merged**; `main` is now `c156c59` and contains both the
strategy docs and the runtime foundations. The R0 contract branch
(`feat/action-window-contract`) is cut directly from that merged `main`, so no
unmerged-base caveat remains.
