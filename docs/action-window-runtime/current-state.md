# Current State — Action Window Runtime

<!-- Update this file when starting or changing the active slice. Fixed top section below. -->

- **updated at:** 2026-07-08
- **baseline main SHA:** `5a43dcb` (`origin/main`, PR #208 merged; contains ESM foundations + profile resolver, does NOT contain the strategy docs)
- **current branch:** `feat/action-window-runtime`
- **current worktree:** `sellerops-runtime` (linked worktree of the shared SellerOps repo)
- **branch base SHA:** `cf0c845` (`integ/sellerops-main`, PR #209 **OPEN, not merged**) — the reconciled baseline that contains both the strategy docs (`5889a1d`) and the main runtime foundations (`5a43dcb`)
- **shared contract version/path:** **NONE yet.** No Action Window shared contract exists. Nearest ratified protocol: `collector/src/bridge/protocol.ts` (`BRIDGE_PROTOCOL_VERSION = 1`) + `frontend/src/lib/bridge/bridgeProtocol.ts`. → R0 blocking dependency.
- **current slice:** pre-R0 (documentation baseline established; no Runtime code)
- **last completed item:** Runtime documentation baseline (`docs/action-window-runtime/*`)
- **last verified tests:** none for Action Window (no Runtime code yet)
- **current blocker:** shared Action Window contract (R0) not authored/merged; PR #209 (reconciled baseline) still open
- **next single action:** confirm/author the R0 shared contract (states, commands, events, View Model, blocker codes, versioning) extending the Bridge protocol, then build the R1 synthetic proof
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
- The **next action is contract confirmation (R0) followed by the R1 synthetic
  proof.**

## Existing foundations vs implemented Action Window capability

**Existing foundations (reusable, not delivered Action Window):** connection
profile resolver, candidate signature / frame scan, fail-closed gate / sentinel,
read-only download readiness, upload/ingestion handoff, work/run/audit domain,
Bridge protocol, Browser Projection (optional renderer).

**Implemented Action Window capability:** none yet.

## Baseline / branch caveat

This branch is based on **unmerged PR #209** (`cf0c845`) because it is the only
tree containing both the canonical strategy docs (to reference) and the runtime
foundations (to describe). When PR #209 merges to `main`, this branch's base
becomes an ancestor of `main` (merge-commit workflow; no rebase/squash/force
expected). If PR #209 changes materially before merge, re-verify this base.
