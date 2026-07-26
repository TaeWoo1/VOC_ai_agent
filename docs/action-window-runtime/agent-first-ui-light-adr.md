# ADR: Agent-first / UI-light — the front end is a projection + command adapter, not the journey owner

Status: **Accepted** (2026-07-26). Scope: the review-import journey and every capability that follows it. This
ADR records a boundary decision; it does not, by itself, move any code. It constrains what we build next.

## Context

The review-import journey grew a front end first: a dedicated page, card, and hooks that not only *render* a
run but also decide parts of *how it proceeds* — which segment is next, when the continuation panel appears,
what "remaining" means. Each new capability threatened to repeat that: another page, another card, another
hook, each re-deriving a slice of state the Agent Runtime already owns. That path makes the runtime depend on a
rendered React tree and an open browser tab to make progress, and it scatters journey logic across two stacks
that must be kept in agreement by hand (the divergences the recent authority-consolidation work had to chase).

The Agent Runtime already owns the journey: the pure kernel (`contracts/review-import-journey/v1`) is the phase
authority, the Segment Engine owns the within-segment stages, and the backend owns plan/segment/ticket truth.

## Decision

1. **The front end is a Control Plane projection + a command adapter. It does not own journey state or
   execution order.** The FE renders what the runtime projects and issues commands the runtime authorizes.
   It never decides sequencing, never holds the source of truth for a phase, and a run's progress never
   depends on a component being mounted. The two ports are the whole surface:
   - `JourneyProjectionPort` — the runtime projects; adapters (the Bridge/WebSocket transport, a headless test
     sink, a future OperationView) consume. Observe-only.
   - `JourneyCommandPort` — someone issues a command; adapters (the Bridge/FE transport, a headless test
     adapter) carry it. Issuing a command needs no rendered UI.
   The existing Bridge/FE transport becomes **one adapter** of these ports, not the boundary itself. (See
   `collector/src/action-window/initial-import/journey-ports.ts` and `journey-live.ts`.)

2. **New capabilities do NOT each add a dedicated page, card, and hook.** A capability is, by default, new
   *state and commands* projected through the existing ports — not new bespoke UI. Adding a screen/card/hook
   per capability is the exception that needs justification, not the default. Existing FE is **frozen for new
   feature development** and kept only as a temporary compatibility adapter; it is not deleted.

3. **Direction: converge on a common `OperationView` + `HumanCheckpoint` projection.** Rather than N capability
   UIs, the FE trends toward one projection surface that renders any operation's sanitized state and one
   surface that renders a required human checkpoint (the operator's marketplace action, a scope confirmation,
   a consent). Capabilities differ in the state/commands they project, not in hand-built screens. This ADR
   fixes the direction; the consolidation itself is later, gated work.

## What this ADR does NOT do

It does not delete or rewrite the current FE, does not change the Action Window wire, does not cut over the
journey to LangGraph, and does not move any execution responsibility yet. Notably, **minting the next-segment
ticket is still initiated by the FE** today — that remains the current FE-side execution dependency, recorded
here and in the migration plan as a known point to move under Agent-first ownership in a later, gated slice,
not something to cut over speculatively.

## Consequences

- The kernel, graph, ports, projection, and live adapter import no React, no component, and no FE module — a
  source guard enforces it (`collector/test/action-window/initial-import/journey-ports.test.ts`).
- A journey can be driven and observed **headless**, with no React and no open tab, against the real runtime
  (`collector/test/crossstack/journey-live-headless.test.ts`).
- A started segment keeps running when the projection consumer (the FE tab) detaches — the runtime drives it.
- The live shadow, connected only to the collector's segment runtime, marks the parts it cannot see
  (auth/account/plan) as `UNOBSERVED_EXTERNAL` rather than inferring them.

See also: `docs/action-window-runtime/review-import-journey-langgraph-migration-plan.md`.
