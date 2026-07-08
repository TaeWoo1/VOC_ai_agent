# Architecture — Action Window Runtime

Referenced canonical intent:
[`../sellerops_local_agent_runtime_adr.md`](../sellerops_local_agent_runtime_adr.md),
[`../slices/action-window-v1.md`](../slices/action-window-v1.md),
[`../product-scope-v1.md`](../product-scope-v1.md) §1.7 (OperationRun domain).
This document defines Runtime component responsibilities; it does not redefine
product intent.

## 1. Invariants (apply to every component)

- The **user performs policy-sensitive platform actions** (login, 2FA,
  account/scope select, marketplace select, export/download).
- The Runtime **observes and verifies**; it does not act on the seller's behalf
  beyond, at most, one signature-gated user-consented click where a slice
  explicitly allows it.
- The Runtime **never converts one user request into a hidden platform-click
  chain**.
- **Browser Projection is retained optional infrastructure, not a V1
  dependency.** The Action Window engine must run on the real-window overlay
  renderer without Projection.
- **FE owns product layout and copy; Runtime owns geometry, detection,
  mounting, and verification.**
- These values are **never exposed to FE or logs**: selectors, raw page text,
  raw account id, raw connection id, frame URL, CDP target id, local absolute
  path, cookies, credentials, token/session content. (See
  [`contract-boundary.md`](contract-boundary.md).)

## 2. Component responsibilities

| Component | Responsibility | Existing seam (reuse) |
|---|---|---|
| **Action Window state engine** | Channel-neutral state machine driving the synthetic V1 flow (§3); owns transitions, fail-closed exits, and step identity. Pure/deterministic core, side effects injected. | new (re-author reducer patterns from `collector/src/esm/esm-capture-gate.ts`) |
| **Local Agent** | Owns the collector process lifecycle, config, and Bridge server; hosts the engine. | `collector/src/cli/local-agent.ts`, `collector/src/agent/agent-bridge.ts` |
| **Connection / profile resolver** | Maps a connection to its dedicated Chrome profile dir and window. | `connectionProfileDirFor` (`collector/src/agent/progressive-reconnect.ts:126`), `resolveCaptureConnectionProfile` (`collector/src/cli/esm-capture-connection.ts:35`) |
| **Chrome window manager** | Launch/attach the real (or fixture) Chrome window for a connection; own CDP session; never type credentials. | reconnect/session seams (`collector/src/agent/local-agent-progressive-service.ts`) |
| **Overlay renderer** | Geometry + spotlight + step chrome mounted over the real page; default renderer for V1. Projection is the optional alternate renderer. | new; Projection alt path in `collector/src/bridge/projection-adapter.ts` |
| **Target locator** | Find the one real target; produce a **versioned salted signature**, not a raw selector. Assume no stable selectors. | `collector/src/esm/esm-candidate-signature.ts`, `esm-frame-scan.ts` |
| **User-action observer** | Watch for the user's real interaction / page change; the observe half of the loop. | `collector/src/esm/esm-marketplace-observe.ts` (parked branch — re-author), `esm-review-live-scan.ts` |
| **Transition verifier** | Confirm the observed post-state matches the **expected** transition before allowing step completion (execution ≠ completion). | `collector/src/work/types.ts` (`VerificationResult`, `WorkItemFailureReason`) |
| **Fail-closed gate** | On missing/ambiguous/changed target or unexpected state → stop with a blocker code, zero clicks. | `esm-capture-gate.ts`, `collector/src/esm/esm-sentinel.ts` |
| **Download / artifact detector** | Detect a user-initiated download's readiness and completion; read-only (no trigger click). | `collector/src/naver/export-target-readiness.ts`, `export-target-readiness-stable.ts` |
| **Bridge adapter** | Emit sanitized ordered events and accept commands over the existing Bridge protocol; expose only View Models + blocker codes. | `collector/src/bridge/protocol.ts` (`BRIDGE_PROTOCOL_VERSION`, `BridgeEventPayload`, `BridgePendingUserAction`) |
| **Downstream handoff** | Validate the artifact, then hand to existing ingestion; no new backend for V1. | `collector/src/upload.ts` → backend `/api/uploads` → `IngestionService` |
| **Operation Run persistence (future, R3)** | Persist run/step/checkpoint, refresh-recovery, audit trail. Not in V1. | `collector/src/work/*` ledger + backend `CollectionRunService`/`SyncJob` |

## 3. Synthetic V1 state flow

```
PREPARE_SESSION → OPEN_TARGET_SURFACE → LOCATE_TARGET → HIGHLIGHT_TARGET
  → WAIT_FOR_USER_ACTION → VERIFY_TRANSITION → RUN_DUMMY_DOWNSTREAM → COMPLETE
```

- `PREPARE_SESSION` — reach a valid session precondition (fixture: assume ready).
- `OPEN_TARGET_SURFACE` — open the fixture Chrome window on the target surface.
- `LOCATE_TARGET` — locate exactly one target; produce a salted signature.
- `HIGHLIGHT_TARGET` — spotlight the real control; render step chrome.
- `WAIT_FOR_USER_ACTION` — block on the user's real click; no auto-click.
- `VERIFY_TRANSITION` — confirm the observed post-state equals the expected one.
- `RUN_DUMMY_DOWNSTREAM` — one dummy automatic downstream task (no real volume).
- `COMPLETE` — mark the run complete; emit terminal sanitized event.

### Fail-closed exits (from the states above)

| Exit code (illustrative) | From state | Cause |
|---|---|---|
| `TARGET_NOT_FOUND` | `LOCATE_TARGET` | no candidate matched |
| `TARGET_AMBIGUOUS` | `LOCATE_TARGET` | more than one candidate |
| `TARGET_CHANGED` | `HIGHLIGHT_TARGET` / `VERIFY_TRANSITION` | signature drifted from expected |
| `NO_USER_ACTION` | `WAIT_FOR_USER_ACTION` | timeout / user abandoned (manual progress remains) |
| `UNEXPECTED_STATE` | `VERIFY_TRANSITION` | observed post-state ≠ expected |
| `SESSION_INVALID` | `PREPARE_SESSION` | precondition not met |

Blocker codes are enum-only in the contract; the concrete names are ratified in
R0 (see [`contract-boundary.md`](contract-boundary.md)).

## 4. Renderer boundary (Action Window vs Projection)

- **Default renderer:** real-window overlay. Runtime supplies geometry +
  spotlight + step data; FE supplies copy/layout tokens.
- **Optional renderer:** Browser Projection (`collector/src/bridge/projection-*`).
  Its remote **input-dispatch** path is **not** used in production Action Window;
  its view/transport/sanitization primitives are reusable. Not a V1 dependency.

## 5. Related

- Slice sequencing → [`implementation-plan.md`](implementation-plan.md)
- Protocol payload rules → [`contract-boundary.md`](contract-boundary.md)
- Definition of done → [`goal.md`](goal.md) §6
