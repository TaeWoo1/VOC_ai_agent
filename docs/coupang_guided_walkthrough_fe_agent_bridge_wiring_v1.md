# Coupang Guided Walkthrough — FE ↔ Local Agent Bridge Wiring v1

> **Status:** Implemented (cross-stack: collector + frontend), **offline end-to-end proven**. No live WING
> operation in this unit; **no Action Window contract change; no DB migration.** The real WING re-run stays a
> separate, fresh-approval unit.
>
> This closes the Unit-F blocker (`coupang_already_issued_guided_walkthrough_live_regression_v1.md`): the
> guided Coupang walkthrough could not be *driven* live because the browser had nothing to drive against. It
> can now be driven **offline, from the browser, without a CLI**, against a synthetic fixture host.

## What the Unit-F trace actually found

The FE ↔ agent bridge was **already wired and channel-neutral** — the blocker was mis-attributed to the FE:

- **Discovery** is a pinned loopback convention: the frontend and every agent entrypoint default to
  `http://127.0.0.1:47615` (override `VITE_BRIDGE_URL` / `BRIDGE_PORT`). There is no bootstrap file or service
  discovery; the port is a shared constant. (The Unit-F note's "random 47615" was imprecise — 47615 is the
  pinned default, not a random port.)
- **Pairing** is a 3-step HTTP handshake (`/bridge/pair/request` → human-confirm → `/bridge/pair/poll`) that
  mints a durable `sellerops_bridge_token` (localStorage), then a **single-use** WS ticket per socket. The
  durable token rides an `Authorization: Bearer` header — never the WS URL, never a log.
- **Driving** is channel-neutral: `CoupangIssuanceGuidedWalkthrough` already reuses `useBridge` +
  `useGuidedIssuance`, and the runtime sends `START_RUN` with the **agent-announced** `channelCode` (never a
  hardcoded one). The `aw_session` announcement discriminates the carrier (`issuance`) and fails closed on a
  mismatch or a run-id change (never splices two runs).

**The one missing piece was agent-side:** the general `local-agent.ts` boot hosted issuance only under the
NAVER dev fixture flag (`--dev-action-window-issuance`); the only Coupang host was the gated **live-WING**
scaffold, which this unit forbids running. So the browser had no offline Coupang run to pair to and drive.

## The change

### 1. Collector — an offline Coupang issuance fixture host (the linchpin)

`collector/src/cli/local-agent.ts` gains `--dev-action-window-coupang-issuance`, the exact mirror of the NAVER
`--dev-action-window-issuance`:

- `resolveCoupangIssuanceChannel(args, env)` — **never true under `NODE_ENV=production`**.
- `buildCoupangIssuanceConfig()` → `{ runId: run_<hex>, channelCode: "coupang", createDriver: () => new
  CoupangIssuanceFixtureDriver() }` — the **synthetic** driver (no browser, no live WING, no credential read).
- Wired into the one-carrier mutual-exclusion selection (`hostReply` → `hostIssuance` →
  `hostCoupangIssuance`) and the `createAgentBridge` `coupangIssuance` slot (which already existed, reusing
  `ApiIssuanceEndpoint` with `channelCode:"coupang"` + `CoupangIssuanceEngine` / `CoupangIssuanceGuidanceSession`).

Now the **browser product path** drives a real Coupang issuance run end-to-end offline: discovery → pair →
`START_RUN` → `REQUEST_STEP_RECHECK` → `COMPLETED`, with **no live WING and no CLI**.

### 2. Frontend — Local Network Access guidance in the pairing UX

`AgentPairingPanel` gains an optional `maybeNeedsLocalNetworkAccess` prop. On a secure, non-loopback origin
where the bridge is unreachable — indistinguishable from a helper that is *running but blocked* by Chrome's
Local Network Access permission — the searching branch adds the guidance line (the exact string reused from
`BridgeStatus`): **"브라우저에서 로컬 네트워크 접근 권한을 물어보면 허용해 주세요."** It is **additive** — the
"run the helper" line still shows. The flag is forwarded from `useBridge().state` by every pairing surface:
both issuance walkthroughs, the Coupang renewal walkthrough, and the review-import card. Previously this hint
existed **only** in `BridgeStatus` (behind the `VITE_ENABLE_AGENT_BRIDGE` dev flag), never in the walkthrough.

### 3. Collector — a gated diagnostic bridge-client CLI (secondary)

`collector/src/cli/coupang-issuance-live-proof.ts` — a bridge **client** (3-constant fork of the NAVER
`issuance-live-proof.ts`) that drives an already-hosted Coupang issuance run over `/bridge/ws` exactly as the
FE would (`START_RUN` + `REQUEST_STEP_RECHECK`, sanitized frames only). It **never opens a browser or touches
WING**, is gated on `hasCoupangWingRunApproval` (a NAVER grant never authorizes it), and is inert on import.
**This is a diagnostic/evidence tool for the future live re-run — a CLI pass never substitutes for the browser
product path.**

## Recovery (reused, now proven for Coupang)

Every recovery path is the channel-neutral transport's, now exercised for the Coupang carrier:

| Case | Behavior | Proven in |
|---|---|---|
| Agent not running / LNA-blocked | pairing panel stays in searching + the LNA hint | FE panel tests |
| Wrong / expired token | `/bridge/ws-ticket` 401 → `ticket-rejected`, fail closed | FE socket + collector E2E |
| No pairing | refuses `unpaired` without calling the agent | FE socket test |
| Wrong carrier (export/reply) | refuses `carrier-mismatch`, never mis-attaches | FE socket test |
| Refresh / reconnect / agent restart | fresh ticket + `aw_resync` from 0, reattaches the **same** run | FE socket + collector E2E |
| Different run after reconnect | goes dormant — **never splices two runs** | FE socket + collector E2E |
| Duplicate `START_RUN` | idempotent — same run, no revision jump | collector E2E |
| Agent unavailable | the text-checklist fallback (`CoupangIssuanceTutorial`) | pre-existing |

## Verification

- **Collector:** `tsc` clean; full suite **7007 tests** green. New: `local-agent-coupang-issuance-channel`
  (dev-flag host + mutual exclusion), `coupang-issuance-bridge-transport` (offline E2E over the **real** bridge
  socket: announce carrier `issuance` + channel `coupang` → `START_RUN` → drive to `COMPLETED` → reattach same
  run → idempotent replay → fail-closed on bad token/ticket, all sanitized), `coupang-issuance-live-proof-guard`
  (the diagnostic CLI drives no browser, reads no value, gated, inert).
- **Frontend:** `tsc` clean; full suite **1878 tests** green. New: `issuanceSocket.coupang` (socket-level drive
  of the issuance carrier for `channelCode:"coupang"` against a fake WebSocket — token gating, carrier
  discrimination, opaque v2 framing, reconnect-resync, never-splice); `AgentPairingPanel` LNA-hint tests;
  `bridgeClient` stale-LNA-flag-reset test.

## Independent review

Security review: **CLEAN** (production-gate symmetry, structural secret/DOM/PII isolation, Coupang-flag gating +
inert-on-import, carrier mutual exclusion, no contract/migration). UX review: **no blockers**; the actionable
SHOULD-FIX (the LNA hint gave no path for a seller who ALREADY denied the permission, whom Chrome will not
re-prompt) is fixed with a second clause pointing to the address-bar site settings, and the stale-flag NIT (the
hint lingering into a recovered `connecting`/`connecting_ws` state) is fixed by resetting the flag on those
transitions. Deferred NITs: the Korean permission label is kept consistent with the existing `BridgeStatus`
string (`로컬 네트워크 접근`) rather than guessing a different one — verifying Chrome's exact Korean wording is
external-research; a dynamic-re-announce live region and de-duplicating the shared string across the two
surfaces are cosmetic.
- **Boundaries:** the Action Window contract, the backend, and the NAVER carrier are unchanged (NAVER's
  `naver-bridge-transport` + issuance suites stay green). No migration.

## Honest scope (unchanged)

- **Proven offline:** the browser discovers, pairs, and drives a Coupang issuance run to completion + every
  recovery path — over the **real** bridge socket, against a **synthetic** fixture host.
- **NOT proven live:** a real WING guided walkthrough (opening WING, highlighting the live page). That remains a
  separate unit needing a fresh bootstrap + a fresh `Seated and ready.` grant — now unblocked, because the
  browser drive path and the diagnostic client both exist.
- **The unissued (first-issuance) form** stays **synthetic-only** — no unissued account exists. Unchanged from
  `coupang_guided_issuance_credential_lifecycle_scope_v1.md`.
