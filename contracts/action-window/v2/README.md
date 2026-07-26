# Action Window Protocol — v2

**Status:** normative contract, protocol version **2**. Defines the *only* FE ↔ Runtime
protocol truth for the Action Window. This slice ships the **contract + fixtures + conformance
tests only** — no Runtime engine, FE screens, Chrome/overlay, Bridge handlers, persistence, or
live channel behavior.

> The body of this file below still describes the shared v1 surface (v2 is a superset — same
> envelopes, transport, privacy boundary, and command semantics). **What v2 adds is in
> "§2 v2 additions"**; `index.ts` is authoritative where the two disagree.

## §2 v2 additions

**Run intents.** `START_RUN` may carry an `intent`; absent ⇒ `EXPORT` (the v1 read chain, so a v1
command shape stays valid).

| intent | what it drives | terminal |
|---|---|---|
| `EXPORT` | the v1 export read chain | `COMPLETED` |
| `REPLY_SUBMISSION` | guided, human-performed reply post | `OPERATOR_REPORTED` (no read-back oracle) |
| `INITIAL_REVIEW_IMPORT_DISCOVERY` | find the historical range the marketplace currently allows | `COMPLETED` |
| `INITIAL_REVIEW_IMPORT_SEGMENT` | guide ONE planned monthly segment to a downloaded, ingested file | `COMPLETED` |

Both import intents are read-only export choreography — the seller clicks every marketplace
control — so they need no new status. Discovery is separate because the **first** command has no
plan yet: there is nothing to bind a segment ref to until the available range is known.

**One binding ref per intent** (`INTENT_REQUIRED_REF`). Each intent requires exactly one opaque
16-hex ref and **prohibits every other**: `submissionRef` iff `REPLY_SUBMISSION`, `discoveryRef` iff
`INITIAL_REVIEW_IMPORT_DISCOVERY`, `importRef` iff `INITIAL_REVIEW_IMPORT_SEGMENT`; `EXPORT` carries
none. A run bound to the wrong kind of approved work is thereby unrepresentable, and an *unknown*
intent requires none — so a rejected intent cannot smuggle a binding through.

Refs resolve **server-side** to a seller account, plan, and segment. No plan id, segment id, or
date crosses this boundary; required dates reach the seller as sanitized primitive `copyParams`
under an FE-owned copy key, like any other step copy.

**Carrier kind.** v2 envelopes are spoken by two different agent worlds, so
`contracts/action-window/aw-carrier-kind.ts` announces which: `export` (v1), `reply` (v2), `import`
(v2). Version alone cannot separate `reply` from `import`; an unrecognised or absent value fails
closed rather than defaulting.

## Location & ownership

- **Neutral source of truth:** this directory (`contracts/action-window/v1/`). Neither
  `frontend/**` nor `collector/**` owns the contract.
- **Language-neutral normative source:** [`schema.json`](schema.json) (JSON Schema draft
  2020-12) — also the basis for future **Java backend DTOs**.
- **TypeScript surface:** [`index.ts`](index.ts) — enums, envelopes, the FE Run View Model, and
  pure validators, consumed by both the TS frontend and the TS collector/runtime.
- **Consistency:** a mechanical test asserts the `index.ts` `const` enum arrays equal the
  `schema.json` `$defs.*.enum` arrays, so the two representations cannot drift. FE and Runtime
  therefore consume **one** normative source, not independent copies.

## Consumers

| Consumer | How it consumes |
|---|---|
| TypeScript frontend | `import { ActionWindowRunView, RunStatus, validateRunView, ... } from "contracts/action-window/v1"` |
| TypeScript collector / runtime | same module |
| Future Java backend | generate DTOs from `schema.json` |

## Enums (normative)

- **RunStatus:** `PREPARING · RUNNING · WAITING_FOR_HUMAN · PAUSED · PROCESSING · COMPLETED ·
  FAILED · CANCELLED`. `IDLE` is **not** a persisted status — it is a UI-only scenario meaning no
  active Run exists.
- **StepStatus:** `PENDING · PREPARING · READY · AWAITING_USER · OBSERVING · PROCESSING ·
  COMPLETED · FAILED · SKIPPED`.
- **ExecutionMode:** `AUTOMATIC_OPERATION · ACTION_WINDOW · FILE_IMPORT · INTEGRATION_PENDING`.
- **BlockerCode:** `LOGIN_REQUIRED · UI_DRIFT · TARGET_NOT_FOUND · TARGET_AMBIGUOUS ·
  SESSION_EXPIRED · UNSUPPORTED_STATE · DOWNLOAD_TIMEOUT · ARTIFACT_INVALID`. Blocker codes are
  **not** Run statuses.

## Commands (FE → Runtime)

`START_RUN · PAUSE_RUN · RESUME_RUN · CANCEL_RUN · FIND_CURRENT_STEP · SWITCH_TO_MANUAL ·
REQUEST_STEP_RECHECK · SET_GUIDANCE_ENABLED`.

There is intentionally **no `CONFIRM_STEP_COMPLETED`**. `REQUEST_STEP_RECHECK` means only *"the
user reports that they performed the requested action; Runtime must observe and verify again."* It
never directly completes a Step.

Envelope: `protocolVersion, commandId, runId, expectedRevision, type, payload?`. Semantics:
duplicate `commandId` is idempotent; a stale `expectedRevision` is rejected; unknown protocol
versions **fail closed**; **FE cannot directly mutate Runtime state** — a command is an intent.

## Events (Runtime → FE)

`RUN_STARTED · RUN_STATUS_CHANGED · STEP_READY · HUMAN_ACTION_REQUIRED · TARGET_HIGHLIGHTED ·
USER_ACTION_OBSERVED · DOWNLOAD_DETECTED · STEP_COMPLETED · RUN_BLOCKED · RUN_COMPLETED ·
RUN_FAILED`.

Envelope: `protocolVersion, eventId, runId, sequence, revision, type, occurredAt, payload`.
Semantics: `sequence` is monotonic within a Run (the ordering authority — **not** `occurredAt`);
`revision` is the current aggregate revision; duplicates are ignorable by `eventId`; out-of-order
events are detectable; `RUN_BLOCKED` carries a `BlockerCode`; raw Runtime internals never enter an
event.

## FE Run View Model

`ActionWindowRunView` (see `index.ts`). Invariants enforced by `validateRunView`: `stepNumber` is
1-based; `completedSteps ≤ totalSteps`; `currentStep.totalSteps` agrees with `progress.totalSteps`;
`WAITING_FOR_HUMAN` requires a human-action context (`ACTION_WINDOW` + a step `AWAITING_USER`);
`COMPLETED` cannot expose an active blocker; `allowedCommands` is supplied by Runtime (FE does not
infer permissions).

**Copy ownership.** Runtime sends only semantic identifiers — a sanitized `channelCode`, dotted
semantic copy keys (`runCopyKey`, step `copyKey`), and sanitized primitive `runCopyParams` /
`copyParams`. **FE owns all final end-user copy and localization** and derives blocker wording from
`BlockerCode`. Runtime never sends final prose: `title` / `instruction` / `message` are prohibited
fields (below). Copy keys are dotted identifiers (validated), never sentences, so FE can tell a copy
key from prose; an unknown copy key renders a safe FE fallback and carries no command/state
authority (`allowedCommands` remains the only command source, and only the `STEP_COMPLETED` event
completes a step).

## §6 Privacy boundary (enforced by `findProhibitedFields`)

The contract **prohibits**, anywhere in any message: Runtime-authored end-user prose (`title`,
`instruction`, `message`, `html`, `displayText`), CSS/XPath selectors, arbitrary page text, raw
account IDs, raw connection IDs, frame/page URLs, CDP target IDs, local absolute file paths,
credentials, tokens, cookies, session contents, and downloaded review content. Only sanitized
references, enums, booleans, counts, **opaque 16-hex IDs** (`targetRef`, `artifactRef`), sanitized
semantic codes / dotted copy keys, and primitive copy params are allowed — a non-opaque `*Ref`
value is rejected, and copy params must be primitive with no markup.

`occurredAt` / `updatedAt` are **opaque occurrence markers** for display/staleness only; they are
never parsed for elapsed-duration logic, and ordering authority is `sequence` / `revision`.

## §8 Compatibility with the existing Bridge

**Decision: a nested Action Window contract with its own version, transported by Bridge v1** — not
new typed variants inside the Bridge `ClientMessage`/`ServerMessage` union.

Rationale: Local Agent Bridge v1 (`collector/src/bridge/protocol.ts`) is, by explicit design,
**pairing + observability only** — it carries no workflow/click/command messages. Adding Action
Window commands as Bridge message variants would change Bridge's meaning and force a Bridge major
bump, breaking current clients. Instead, Action Window messages ride **inside** the Bridge
transport as opaque payloads and are versioned independently by
`ACTION_WINDOW_PROTOCOL_VERSION`. This is the smallest additive design; it does not change the
meaning of any existing Bridge message. Bridge clients that do not understand the new payloads
degrade gracefully via the existing capability/`supportedEvents` advertisement.

**This slice does not implement message handling** — it defines and tests the contract only, and
does not modify `collector/src/bridge/protocol.ts`.

### §8.1 One frame carries prose, FE → Runtime only (added 2026-07-26)

`transport.ts` gained a third client frame, `aw_guidance_pack`. It exists because guidance moved **into the
marketplace page**: the seller works in their SmartStore window, so a sentence that lives only in the SellerOps
window is a sentence they never read (product-owner decision; evidence in
`docs/action-window-runtime/naver-initial-review-import-live-proof-record.md`).

Nothing in this README's §6 is relaxed by it, and `index.ts` is unchanged — no enum, envelope, view model or
validator moved:

- **§6 protects who decides the wording, not which process holds the string.** The frontend composes every
  sentence and hands it down; the Runtime does dictionary lookup and `{param}` substitution and nothing else.
- **A copy key with no pack entry renders NO sentence.** There is no Runtime fallback prose to fall back to. The
  collector proves it structurally: a source guard asserts its two panel modules contain no Korean string
  literal.
- **The direction is one-way.** The pack is never echoed on an event, a view, or a resync reply, so the
  Runtime→FE privacy invariant and `findProhibitedFields` are exactly as before. It is never persisted, and it is
  logged only as counts.
- **It carries no run state** — no status, no step number, no blocker. Those still come from the Runtime, which
  is the only thing that knows them.

## Fixtures & tests

- Valid fixtures: `fixtures/valid/{run-view,event,command}/` — usable directly as FE mock states
  and Runtime conformance inputs; cover the 12 required run scenarios and every event type.
- Negative fixtures: `fixtures/invalid/` — stale revision, duplicate sequence, invalid status/event
  mixing, completed-with-blocker, human-waiting-without-human-step, prohibited selector/URL/path,
  unknown enum, unsupported protocol version.
- Conformance tests: `collector/test/contracts/action-window/contract.test.ts` (run via the
  collector's vitest — the collector is a *consumer*, not the owner).

## Not in this contract / slice

Chrome, overlay, DOM detection, user-click observation, download detection, React screens, backend
persistence, live commerce behavior, and Bridge message handlers. Those are Runtime/FE slices
(R1+); see `docs/action-window-runtime/implementation-plan.md`.
