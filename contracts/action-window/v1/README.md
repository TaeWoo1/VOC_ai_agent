# Action Window Contract — v1

`@sellerops/action-window-contract` · protocol `sellerops.action-window` · version **1.0.0**

The single authoritative source of Action Window protocol semantics: TypeScript
types, runtime validators, and sanitized fixtures. It is **consumed, never
redefined**, by both `frontend` and `collector`.

## Ownership

Cross-workstream. This package is owned by neither the Frontend nor the Runtime
workstream. Neither consumer may define a private copy of any status, event,
command, blocker, protocol version, or View Model. Changing the contract is a
deliberate, separate change (see Versioning).

## Layout

Source-only, zero **runtime** dependencies (dev-only `typescript` + `vitest` for
its own checks). Consumers import the `.ts` source directly by relative path — no
build step, no publish, no bundled artifact:

- `frontend` → `frontend/src/lib/actionWindow/contract.ts` re-exports it.
- `collector` → imports `contracts/action-window/v1/index` directly.

It compiles under both consumers' strict TypeScript and stays isomorphic (no
Node or DOM globals).

## Versioning & compatibility

- `PROTOCOL_VERSION` starts at `1.0.0` (`major.minor.patch`).
- Compatibility is **fail-closed**: a message is accepted only when its MAJOR
  equals the current major AND its MINOR does not exceed the current minor. A
  different major, or a newer minor a consumer does not understand, is rejected.
  Patch differences are ignored.
- Unknown enum members and unsupported versions fail closed in every parser.
- A breaking change bumps the major and lands as a new `v2/` package; additive,
  backward-compatible fields bump the minor.

## State vs. event

- **State** lives on `RunStatus` / `StepStatus` and the `ActionWindowRunView`.
  The view carries a `revision`; consumers apply only strictly-newer revisions
  and never mix `runId`s.
- **Events** (`EventType`) describe *facts that happened*; they are ordered by a
  monotonic `sequence` within a run and de-duplicated by `eventId`. Events are
  not states.
- Commands (`CommandType`) carry an `expectedRevision` (optimistic concurrency)
  and a `commandId` idempotency key; stale or duplicate commands are rejected.

## Runtime completion authority

There is **no** `CONFIRM_STEP_COMPLETED` command, by design. The UI can only
`REPORT_USER_ACTION_DONE`-style report progress via `REQUEST_STEP_RECHECK` —
"the user believes this step may be done." Runtime then transitions to
observation, verifies the expected state itself, and is the **only** party that
marks a step complete, expressed solely through the `STEP_COMPLETED` event.

## Sanitization boundary

The View Model, command/event payloads, and fixtures must never contain
selectors, raw DOM, frame or marketplace URLs, CDP target IDs, cookies, tokens,
secrets, local file paths, raw account/connection IDs, browser profile paths, or
downloaded file contents. `findForbiddenFields` / `isSanitized` /
`assertNoForbiddenFields` enforce this structurally, and every parser rejects a
payload that violates it. Opaque handles (`runId`, `eventId`, `commandId`,
`stepId`) are allowed.

## Consumer rules

1. Import protocol types/values from this package; do not re-declare them.
2. Render command controls only from `ActionWindowRunView.allowedCommands`; do
   not invent independent capability flags.
3. Validate untrusted Bridge messages with `parseCommand` / `parseEvent` /
   `validateRunView` before use.
4. Treat every enum/version you do not recognize as fail-closed.

## Checks

```bash
cd contracts/action-window/v1
npm install
npm run typecheck
npm test
```
