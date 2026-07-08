# Current State — Action Window Runtime

<!-- Update this file when starting or changing the active slice. Fixed top section below. -->

- **updated at:** 2026-07-09
- **baseline main SHA:** `dc84546` (`origin/main`; incl. PR #212 R0, PR #214 canonical contract, PR #213 R1, PR #215 FE mock-flow, PR #216 R1.1, and **PR #217 R2A** all merged)
- **current branch:** `feat/action-window-bridge-transport` (R2B — live Bridge-WS passthrough transport)
- **current worktree:** `sellerops-action-window-integrate` (linked worktree of the shared SellerOps repo)
- **branch base SHA:** `dc84546` (`origin/main`)
- **shared contract version/path:** **`contracts/action-window/v1/` (`ACTION_WINDOW_PROTOCOL_VERSION = 1`, `ACTION_WINDOW_TRANSPORT_VERSION = 1`) — UNCHANGED by R2B.** The R2B wire binding implements the existing `AwClientTransport`/`AwServerTransport` interfaces over the real Bridge WS; frames ride the authenticated `/bridge/ws` socket as opaque `{type:"aw", payload}` carriers plus an agent→client `{type:"aw_session"}` announcement (both defined in `collector/src/bridge/action-window-endpoint.ts` / consumed by `frontend/src/lib/actionWindow/wsTransport.ts`). The typed Bridge v1 `ClientMessage`/`ServerMessage` unions in `bridge/protocol.ts` are untouched — no Bridge version bump.
- **current slice:** **R2B (live Bridge-WS passthrough) — IMPLEMENTED + offline-VERIFIED** on this branch: FE command → paired/ticketed Bridge WS → `ActionWindowSession` → sanitized events/View Model → Bridge WS → FE, proven over a REAL loopback WebSocket with real pairing/authentication (synthetic driver; no live channel, no browser).
- **last completed item:** `ActionWindowEndpoint` (collector) binds the R2A `ActionWindowSession` to `/bridge/ws` (broadcast events/views to every paired tab; command/resync results routed to the sender only); `BridgeServer` relays `{type:"aw"}` opaquely and announces the hosted run after hello+snapshot; `createAgentBridge` hosts the session via optional `actionWindow` config; `local-agent` CLI gains the DEV-only `--dev-action-window-synthetic` flag (refused under `NODE_ENV=production`). FE: `wsTransport.ts` implements `AwClientTransport` over the Bridge WS (pairing-token reuse via `BRIDGE_TOKEN_KEY`, single-use ticket, `aw_session` gate, reconnect with fresh ticket + `aw_resync` from 0, run-identity pinning); `resolveBridgeSession()` now really connects (async) and the controller falls back to the mock at runtime when no live session is reachable.
- **last verified tests:** collector `bridge-transport.test.ts` (10, offline, REAL loopback WS) — announcement, full loop (start→checkpoint→test-driver action→recheck→completed), reconnect replay, stale-revision, duplicate-idempotent, cancel/cleanup, unauthorized/unpaired rejection, malformed-frame drop, broadcast-vs-reply routing, prod-gate; full collector suite **2424 passed / 12 skipped**, `tsc --noEmit` clean. FE `wsTransport.test.ts` (8) + `devMode.test.ts` (3); full FE suite **202 passed**, `tsc --noEmit` clean, `vite build` OK. Wire privacy: `findProhibitedFields` == [] for every frame crossing the real WS.
- **current blocker:** none for R2B offline scope. Remaining live gaps (deliberate): no live channel (R4), no Operation Run persistence (R3), no browser-driver-over-Bridge QA (synthetic driver only in this slice), production hosts **no** Action Window session (dev flag refused under production).
- **next single action:** after this R2B PR merges, start **R3** (Operation Run persistence) from updated `main`.
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
  click**.
- **R2B (live Bridge-WS passthrough) is IMPLEMENTED + offline-VERIFIED** on
  `feat/action-window-bridge-transport`: the same session runs behind the REAL
  Bridge WebSocket — real pairing (request→local confirm→poll), single-use
  ticket, origin allow-list — with Action Window frames as opaque `{type:"aw"}`
  carriers and an `aw_session` run announcement. Verified over a real loopback
  WS with the synthetic driver (10 tests). Still **no live channel**, no
  persistence, and production hosts no Action Window session.

## Existing foundations vs implemented Action Window capability

**Existing foundations (reusable, not delivered Action Window):** connection
profile resolver, candidate signature / frame scan, fail-closed gate / sentinel,
read-only download readiness, upload/ingestion handoff, work/run/audit domain,
Bridge protocol, Browser Projection (optional renderer).

**Implemented Action Window capability:** R1 channel-neutral synthetic loop
(`collector/src/action-window/*`) — pure state engine, target locator, overlay,
user-action observer, transition verifier, fail-closed blockers, dummy downstream,
in-memory event sink, `ActionWindowRunView` projection, cleanup — plus the R2A
command-driven `ActionWindowSession`/FE adapter integration and the R2B Bridge-WS
passthrough (opaque `{type:"aw"}` carriers over the paired/ticketed `/bridge/ws`,
`aw_session` announcement, reconnect resync). Synthetic-only; automated + headed
operator-QA + real-loopback-WS verified. **Not live** (no real channel, no
persistence; production hosts no Action Window session).

## Baseline / branch caveat

R1 (#213) merged on top of PR #214, which had rewritten the contract shape
(breaking) — so `main` briefly failed collector typecheck in the action-window
module. This R1.1 slice (`fix/action-window-runtime-contract`, from `377a103`)
reconciles R1 to the canonical #214 contract and restores a green `main`. Lesson
recorded above: a breaking contract change must bump `ACTION_WINDOW_PROTOCOL_VERSION`
or ship an explicit migration, and Runtime changes must be re-typechecked against
the contract actually on `main` (not the branch base).
