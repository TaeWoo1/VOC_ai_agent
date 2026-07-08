# Contract Boundary — FE ↔ Runtime

This document records **Runtime semantics** at the FE↔Runtime boundary. It does
**not** duplicate the normative shared-contract enums or schemas — those live in
the shared contract source (see §1). If Runtime semantics here ever disagree with
the ratified shared contract, the shared contract wins and this file is updated.

## 1. Shared-contract source status — BLOCKING DEPENDENCY

- A dedicated **Action Window shared contract** (states, commands, events, View
  Model, blocker codes, versioning) **does not exist yet** in the repository.
- The closest existing, ratified protocol is the generic **Bridge protocol**:
  - Runtime side: `collector/src/bridge/protocol.ts`
    (`BRIDGE_PROTOCOL_VERSION = 1`, `BridgeEventPayload`, `BridgeEventCategory`,
    `BridgePendingUserAction`, `BridgeConnectionView`, `ServerMessage` /
    `ClientMessage`).
  - FE side: `frontend/src/lib/bridge/bridgeProtocol.ts`.
- **Therefore R0 (contract baseline) is a blocking dependency** for R2
  (Runtime/FE integration) and for any FE work that consumes Action Window state.
  The Action Window contract is expected to **extend / version alongside** the
  Bridge protocol, not replace it.
- Until R0 is merged, the Runtime engine (R1) is built against **internal
  fixtures**, and any FE-facing shape is provisional.

Record the shared-contract path + protocol version here once it exists.

## 2. Runtime semantics at the boundary

- **FE commands request actions; they do not directly mutate completion state.**
  A command is an intent, not a state write.
- `REQUEST_STEP_RECHECK` (or the ratified equivalent) means **"the user reports
  that they acted."** It moves the Runtime into **observation**, nothing more.
- **Only a verified expected state may produce step completion.** Execution ≠
  completion; the transition verifier is the sole authority for `COMPLETE`.
- **Duplicate commands are idempotent** — replaying the same command id yields
  the same state, no double side effect (reuse the `AppliedCommand` /
  command-ledger pattern in `collector/src/work/types.ts`).
- **Stale revisions are rejected.** Commands/events carry an ordered
  sequence/revision; a command against an older revision is refused, not applied.
- **Events carry ordered sequence/revision** so FE can detect gaps and reorder.
- The Runtime exposes **only sanitized View Models and blocker codes** — never
  internal geometry, selectors, or raw page state.

## 3. Prohibited payloads (never cross the boundary; never logged)

The Runtime must **never** emit or log any of:

- selector (CSS/XPath/DOM path)
- arbitrary page text
- raw account id
- raw connection id
- frame URL / raw URL
- CDP target id
- local absolute path
- credentials
- token / cookie / session content

Allowed sanitized forms only: enums, booleans, coarse buckets, and
salted/hashed opaque references (16-hex salted hash) where an id is needed. This
matches the existing sanitization contract in `collector/src/bridge/protocol.ts`
and the standing recency/sanitization rules.

## 4. What the boundary carries (sanitized)

- **View Model:** current state (enum), step descriptor (enum + coarse hints,
  no selector), pending-user-action (enum), progress bucket, blocker code.
- **Blocker codes:** enum-only (see fail-closed exits in
  [`architecture.md`](architecture.md) §3); ratified in R0.
- **Commands (FE→Runtime):** request-open, request-step-recheck, request-cancel,
  request-manual-progress — all as intents; each idempotent and revision-checked.
- **Events (Runtime→FE):** state-changed, blocked, artifact-ready,
  run-completed — ordered, sanitized.

Exact names/enums are **owned by the shared contract (R0)**, not by this file.

## 5. Related

- Component owners of each payload → [`architecture.md`](architecture.md)
- Contract slice (R0) scope → [`implementation-plan.md`](implementation-plan.md)
