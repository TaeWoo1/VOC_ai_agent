# Slice — Reply Report Safety v1

> **Status:** IMPLEMENTED, offline. **Safety only** — no v2 frame adapter, no runtime injection, no
> carrier switching. Frontend only: no backend, no collector, no contract, no migration.

- **Workstream:** Review Operations (`docs/workstreams/review_operations_mvp.md`)
- **Loop stages:** ACT (the guided-reply terminal)
- **Date:** 2026-07-23 · **Live contact:** none

---

## 1. Why — a report that could never settle

`createBridgeReplyRuntime.report()` resolved **only** on `RUN_OPERATOR_REPORTED`. No timeout, no
rejection path, no handling of a transport that throws. A dropped socket, a rejected command, or an
agent that died mid-run left the promise **pending forever**.

`VocItemReplyPrep` awaits that promise with `inFlight = true` and `busy = "reporting"`. Its
`finally` releases both — but a promise that never settles never reaches `finally`. The panel would
sit on a spinner with every control inert, recoverable only by reloading the page, having lost the
operator's approved draft context in the process.

Nothing triggers this today: no build constructs the bridge runtime. That is exactly why it is worth
fixing **now** — wiring it later would turn a latent hang into a live one on the surface where an
operator is one click from a public reply.

## 2. What changed

**One settle path, always.** `report()` now settles exactly once through a `settle()` helper that
clears the timer, unsubscribes, and then resolves or rejects. Four ways in, one way out:

| situation | before | after |
|---|---|---|
| terminal arrives | resolve | resolve *(unchanged)* |
| nothing arrives | **pending forever** | reject `ReplyReportTimeoutError` after `REPLY_REPORT_TIMEOUT_MS` |
| transport throws on `send` | **pending forever** | reject with the transport's error |
| malformed terminal | **throws inside a listener nobody catches**, promise pending | reject |

**The subscription never outlives its promise.** That is not merely a leak: the listener closes over
a run that has finished, and a later event on a reused transport would resolve a promise nobody is
waiting on.

⚠ **The runtime keeps ONE permanent listener from construction** — the revision tracker that lets a
report carry a fresh `expectedRevision`. The tests assert cleanup against *that baseline* rather than
against zero, because asserting zero would either fail or quietly encourage removing a listener the
protocol needs. That construction-time listener has no disposal path; recorded below.

**A finite default, pinned.** `REPLY_REPORT_TIMEOUT_MS` is 12s — longer than a healthy local
round-trip by orders of magnitude, shorter than an operator's patience — and a test asserts it stays
finite and in range, so it cannot quietly become `Infinity` or long enough to feel like the hang it
replaced. Injectable per-runtime so tests do not sleep.

## 3. The guarantee, asserted where the operator feels it

The panel already had the right shape — `catch` sets an actionable failure, `finally` releases
`busy`/`inFlight`. It simply never ran. A panel-level test now drives a runtime whose `report()`
rejects and asserts the operator is released: the failure message is shown, the control is live
again (`aria-disabled="false"`), and **nothing was recorded** — a report that never terminated must
not look like one that did.

## 4. Verification

| | before | after |
|---|---|---|
| frontend | 756 | **759** |
| collector | 4843 / 95 skipped | unchanged, untouched |
| backend | 1502 (2 skipped) | unchanged, untouched |

Typecheck clean.

**Falsified — and the first one reproduces the original bug exactly:**

| revert | result |
|---|---|
| remove the timeout rejection | 3 tests **hang to their 5s limit** — the wedge, reproduced |
| leave the listener attached after settling | all 3 cleanup tests fail |

## 5. What is NOT in this slice

No envelope↔frame adapter, no `createBridgeReplyRuntime` injection, no carrier switching. The
runtime is still constructed by nothing in any build; this only guarantees that when it *is*
constructed, it cannot wedge the panel.

## 6. Recorded, not fixed

- **The construction-time listener has no disposal path.** `createBridgeReplyRuntime` subscribes once
  to track revisions and never unsubscribes; there is no `dispose()`. Bounded today (one per runtime
  instance, and nothing constructs them), but it belongs with the injection slice, which is what
  decides the runtime's lifetime.
- **The envelope↔frame adapter still does not exist** — the wire carries `{kind:"aw_command"…}` /
  `{kind:"aw_event"…}`, the runtime speaks `CommandEnvelope`/`EventEnvelope`, and the only
  implementation of `ReplyClientTransport` is a test fake. A real adapter should also surface
  `aw_command_result{accepted:false}` as a rejection — the v1 adapter already does — which would
  turn today's *timeout* into an immediate, accurate failure.
- **Run 7 stays deferred** until the approved network/IP environment returns. No gate consumed, no
  live contact.
