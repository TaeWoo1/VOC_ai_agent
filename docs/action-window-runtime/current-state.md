# Current State — Action Window Runtime

<!-- Update this file when starting or changing the active slice. Fixed top section below. -->

- **updated at:** 2026-07-09
- **baseline main SHA:** `3dcfff2` (`origin/main`; incl. PR #212 R0, PR #214 canonical contract, PR #213 R1, **PR #215 FE mock-flow**, and **PR #216 R1.1** all merged)
- **current branch:** `integ/action-window-v1` (R2 — FE↔Bridge↔Runtime synthetic integration)
- **current worktree:** `sellerops-action-window-integrate` (linked worktree of the shared SellerOps repo)
- **branch base SHA:** `3dcfff2` (`origin/main`)
- **shared contract version/path:** **`contracts/action-window/v1/` (`ACTION_WINDOW_PROTOCOL_VERSION = 1`).** Canonical message shape set by **PR #214**. R2 adds an **additive** transport sibling `contracts/action-window/v1/transport.ts` (`ACTION_WINDOW_TRANSPORT_VERSION = 1`) — frames that carry the already-normative envelopes/View Model **inside Bridge v1 as opaque payloads**; `index.ts`/`schema.json`/`bridge/protocol.ts` are unchanged (no drift, no message-protocol bump).
- **current slice:** R2A (offline FE↔Runtime integration) — **VERIFIED** (offline synthetic E2E + headed operator-click browser proof both green); PR #217. **R2B (real Bridge-WS passthrough transport) is reserved for the next PR.**
- **last completed item:** built the command-driven `ActionWindowSession` + `ProbeDriver` (synthetic + browser), the shared loopback transport, and the FE `bridgeAdapter`/`controller` selected through the dev/runtime boundary (mock default). FE `contract.ts` remains a **zero-drift re-export** of the canonical source (now also re-exporting the transport types).
- **last verified tests:** collector `session-integration.test.ts` (8, offline) — full loop + stale/dup/pause/resume/cancel/reconnect/privacy; full collector suite **2414 passed / 12 skipped**, `tsc --noEmit` clean. FE `bridgeAdapter.test.ts` (9), full FE suite **192 passed**, `tsc --noEmit` clean, `vite build` OK. **`session-browser.test.ts` RUN under `RUN_INTEGRATION=1`:** automated headless (simulated click) green, and **headed operator proof (`AW_HEADED=1`) with a REAL human click** green — start→checkpoint (overlay visible)→user click (observation ≠ completion)→recheck→verify→downstream→COMPLETED, clean teardown (overlay/observer removed).
- **current blocker:** none for R2A. Live gaps reserved for **R2B**: the **real Bridge-WS transport** (opaque passthrough — a Bridge slice) + Local Agent startup wiring + Operation Run identity. Until R2B lands, `resolveBridgeSession()` returns `null` and the shipped Operations screen runs the mock.
- **next single action:** after PR #217 merges, start **R2B** (live Bridge-WS passthrough transport) in a fresh session/branch from updated `main`; then R3 persistence.
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
- **R0 (contract) is MERGED** (PR #212). **R1 (synthetic loop) is VERIFIED against
  the canonical post-#214 contract** under `collector/src/action-window/*` —
  automated tests green AND the headed operator-click QA passed end-to-end using
  `channelCode`/`copyKey` and the canonical execution modes.
- **R2A (offline FE↔Runtime integration) is VERIFIED** (`integ/action-window-v1`,
  PR #217): the FE Bridge adapter drives the real R1 engine through the
  `ActionWindowSession` over a loopback transport — full command/event/View-Model
  loop, reconnect resync, idempotency/revision/ordering, and a privacy scan, all
  green offline AND against real Chromium with a **headed operator (real human)
  click**. **R2B (real Bridge-WS passthrough transport + Local Agent startup
  wiring) is reserved for the next PR;** no live channel yet.

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

R1 (#213) merged on top of PR #214, which had rewritten the contract shape
(breaking) — so `main` briefly failed collector typecheck in the action-window
module. This R1.1 slice (`fix/action-window-runtime-contract`, from `377a103`)
reconciles R1 to the canonical #214 contract and restores a green `main`. Lesson
recorded above: a breaking contract change must bump `ACTION_WINDOW_PROTOCOL_VERSION`
or ship an explicit migration, and Runtime changes must be re-typechecked against
the contract actually on `main` (not the branch base).
