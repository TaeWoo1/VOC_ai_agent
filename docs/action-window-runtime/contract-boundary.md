# Contract Boundary — FE ↔ Runtime

This document records **Runtime semantics** at the FE↔Runtime boundary. It does
**not** duplicate the normative shared-contract enums or schemas — those live in
the shared contract source (see §1). If Runtime semantics here ever disagree with
the ratified shared contract, the shared contract wins and this file is updated.

## 1. Shared-contract source status — MERGED (R0, PR #212)

- **Normative path:** `contracts/action-window/v1/` — neutral top-level, owned by
  neither `frontend/**` nor `collector/**`.
  - Language-neutral source: `contracts/action-window/v1/schema.json` (JSON Schema,
    also the basis for future Java DTOs).
  - TypeScript surface: `contracts/action-window/v1/index.ts` (enums, envelopes, FE
    Run View Model, pure validators).
  - Conformance tests: `collector/test/contracts/action-window/contract.test.ts`
    (collector is a *consumer*, not the owner).
- **Protocol version:** `ACTION_WINDOW_PROTOCOL_VERSION = 1`.
- **Canonical shape (PR #214 — copy ownership).** Execution modes are
  `AUTOMATIC_OPERATION`/`ACTION_WINDOW`/`FILE_IMPORT`/`INTEGRATION_PENDING`;
  `START_RUN` carries `channelCode`; the RunView carries a sanitized `channelCode`
  plus dotted semantic `runCopyKey`/step `copyKey` and sanitized primitive
  `copyParams`. **Runtime emits NO final user prose** — `title`/`instruction`/
  `message`/`html`/`displayText` are prohibited keys; FE owns all localized copy.
- **Version governance.** PR #214 changed the shape *without* bumping the protocol
  version — accepted as the final pre-release v1 reconciliation. Any future breaking
  change MUST bump `ACTION_WINDOW_PROTOCOL_VERSION` or ship an explicit migration.
  Runtime (R1) was realigned to this shape in `fix/action-window-runtime-contract`.
- **Transport decision (contract README §8):** Action Window messages are a
  **nested contract with their own version, transported inside Bridge v1** as
  opaque payloads — NOT new variants in the Bridge `ClientMessage`/`ServerMessage`
  union. This is additive; it does not change the meaning of any existing Bridge
  message and does not force a Bridge major bump. `collector/src/bridge/protocol.ts`
  is unchanged by R0 (no message handling in this slice).
- **Status:** contract **MERGED** (PR #212, `026eb77`); conformance tests green.
  R1 (`collector/src/action-window/*`) consumes it directly — engine emits
  contract-valid events and projects `ActionWindowRunView`, verified by
  `collector/test/action-window/*`. Real Bridge transport of these messages is R2.
- A mechanical consistency test asserts the TS enum arrays equal the `schema.json`
  `$defs.*.enum` arrays, so FE and Runtime consume one non-drifting source.

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
