# Slice — Reply Frame Adapter & Runtime Disposal v1

> **Status:** IMPLEMENTED, offline. **Adapter + lifecycle only** — the v2 reply runtime can now be
> driven by something shaped like the real wire, refuses immediately when the agent refuses, and can
> be released. It is still **injected into nothing**: no production UI wiring, no carrier switching.
> No backend change, no migration, no contract change, §4.1 and the ledger untouched.

- **Workstream:** Review Operations (`docs/workstreams/review_operations_mvp.md`)
- **Loop stages:** ACT (the guided-reply terminal)
- **Date:** 2026-07-23 · **Live contact:** none

---

## 1. Why — the runtime spoke a language nothing else did

`createBridgeReplyRuntime` consumes a `ReplyClientTransport` speaking v2
`CommandEnvelope`/`EventEnvelope`. The wire speaks `{kind:"aw_command"…}` / `{kind:"aw_event"…}`
frames (`contracts/action-window/v2/transport.ts`). Nothing translated between them — the only
implementation of the runtime's transport interface was a fake inside its own unit test, so the
runtime had **never been driven by anything shaped like the real wire**.

Two consequences sat behind that gap, both recorded by the previous two slices:

1. **A refusal hid behind the timeout.** The agent answers every command with
   `aw_command_result{accepted}` — the v1 export adapter already branches on `if (!frame.accepted)`
   — but the reply runtime had no channel for it. A `STALE_REVISION` or `INVALID_FOR_STATE`
   rejection, an answer the agent had *already given*, surfaced as a 12-second
   `ReplyReportTimeoutError`: finite (last slice's fix), but late and mislabelled.
2. **The construction-time listener had no disposal path.** The runtime subscribes once at
   construction (the revision tracker), and nothing could ever remove it — the exact leak the
   documented DISPOSAL CONTRACT required the next slice to close before injection.

## 2. What changed

**`replyFrameTransport.ts` (new)** — `createReplyFrameTransport(frames)` adapts the contract's
frame-level `AwClientTransport` into the envelope-level `ReplyClientTransport`:

- `send(command)` → `{kind:"aw_command", command}`;
- `aw_event` frames → event listeners, unwrapped;
- `aw_command_result` frames → the new `subscribeResults` listeners;
- `aw_view` / `aw_resync_result` are dropped — the reply runtime renders no View Model and requests
  no resync, so delivering them would invent an audience. (Reply-side resync recovery is recorded,
  not wired.)

One reply subscription ↔ one frame subscription, so the frame layer's listener count mirrors the
reply layer's — which is what makes the disposal pin measurable where a real socket would feel it.

**Immediate rejection.** `ReplyClientTransport` gains `subscribeResults`; `report()` correlates by
its own `commandId` and rejects with **`ReplyReportRejectedError`** (carrying the agent's sanitized
reason code, or `null` — never an invented one) the moment `accepted:false` arrives. An
`accepted:true` result settles nothing: acceptance is permission to keep waiting for the terminal,
not the terminal. A result addressed to a different command is ignored — correlation is by id, not
arrival.

**`dispose()`** — on the `ReplyRuntime` interface, honoring the recorded contract:

- releases the construction-time revision tracker;
- rejects any **in-flight** `report()` with `ReplyRuntimeDisposedError` (unmount mid-report leaks
  nothing and waits for nothing);
- makes later `start`/`report` fail closed with the same error — a disposed runtime can neither
  attach a listener to a torn-down session nor send into one;
- idempotent. The simulated runtime honors the same lifecycle, so a consumer written against it
  cannot accidentally keep driving a disposed bridge runtime.

**The pin the contract demanded:** after `dispose()`, the transport's listener count is **ZERO** —
not the construction baseline the report-cleanup tests deliberately use — including when disposal
lands mid-report.

## 3. What is NOT in this slice

- **No injection.** `resolveReplyRuntime()` is unchanged; `createBridgeReplyRuntime` is still
  constructed by nothing in any build. The contract's remaining item — a caller that actually
  invokes `dispose()` (a React effect cleanup) — belongs to the injection slice.
- **No carrier switching**, no change to `connectAwBridgeSession`, no v1 export-path change.
- **`start()` remains fire-and-forget.** It resolves the announced runId immediately and does not
  consume results; a refused `START_RUN` therefore still surfaces at the first report. Recorded —
  fixing it changes `start`'s semantics and belongs with injection, which decides who awaits what.
- **No reply-side resync.** `aw_resync` / `aw_resync_result` stay unused by this path.

## 4. Verification

| | before | after |
|---|---|---|
| frontend | 765 | **784** |
| collector | 4843 / 95 skipped | unchanged, no call sites moved |
| backend | untouched (no files in diff) | untouched |

Both typechecks clean (frontend `tsc --noEmit`; collector main + cross-stack).

The loopback E2E uses the contract's `createLoopbackChannel`, which round-trips every frame through
`serializeFrame`/`deserializeFrame` and delivers **synchronously** — the harshest honest model of
the in-process wire. It drives the real runtime through the real adapter to a real terminal, and
separately through an immediate serialized refusal.

**Falsified (each rule reverted, its tests failed):**

| revert | tests that failed |
|---|---|
| drop the `accepted:false` settle | `REJECTS IMMEDIATELY…` and the loopback refusal E2E — both hang to the 5s limit, reproducing the exact defect |
| `dispose()` releases nothing | 4 disposal tests, including both ZERO pins |
| drop the report-after-dispose guard | `a report AFTER dispose fails closed…` |
| adapter's `subscribeResults` loses its unsubscribe | `each unsubscribe releases exactly its own frame listener` |

## 5. Honesty notes

- The post-`subscribeResults` sync-delivery guard is **currently unreachable** (a replay cannot
  match a commandId that has not been sent yet, and a sync event-replay returns before the results
  subscription exists) — it is kept, and commented as such, because the reachability argument rests
  on that exact ordering. The reachable synchronous path — a transport that rejects **inside
  `send()`**, which is precisely the loopback's shape — is tested directly.
- `ReplyReportRejectedError.reason` carries the agent's sanitized code (`STALE_REVISION`,
  `INVALID_FOR_STATE`, `INVALID_ENVELOPE`) verbatim, per the transport contract's sanitization
  invariant; the FE maps errors to its own copy and never renders the code as UI text.
- **Run 7 stays deferred** until the approved network/IP environment returns. No gate consumed, no
  live contact.
