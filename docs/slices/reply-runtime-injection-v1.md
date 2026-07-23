# Slice — Reply Runtime Injection v1

> **Status:** IMPLEMENTED, offline. The guided-reply runtime is now **constructed by something**: a
> DEV bridge session with an agent hosting the REPLY carrier, owned by a React hook that disposes it
> on unmount. `START_RUN` is acknowledged and timeout-safe. **No carrier mode switching** — a session
> is bound to one carrier for its whole life. No backend change, no migration, no contract change,
> §4.1 and the ledger untouched. Production behavior is unchanged: a shipped build still resolves no
> runtime and offers the honest manual handoff.

- **Workstream:** Review Operations (`docs/workstreams/review_operations_mvp.md`)
- **Loop stages:** ACT (the guided-reply terminal)
- **Date:** 2026-07-23 · **Live contact:** none

---

## 1. Why — a proven runtime that nothing could reach

After the frame-adapter slice, `createBridgeReplyRuntime` could be driven by the real wire shape,
refused immediately, and could be released — and was still constructed by nothing. Three gaps stood
between it and a panel:

1. **No connection spoke the reply carrier.** `connectAwBridgeSession` hardcoded the export carrier;
   an agent running `--dev-action-window-reply` was refusable but not reachable.
2. **`start()` was fire-and-forget.** It resolved the announced runId unconditionally, so a refused
   or lost `START_RUN` surfaced minutes later at the first report, wearing the wrong error.
3. **Nothing called `dispose()`** — the disposal contract's last open item.

## 2. What changed

**`expectedCarrier` on the shared transport** (`wsTransport.ts`). The caller declares which carrier
it speaks; the announcement must match or the connection refuses `carrier-mismatch`, symmetric in
both directions and reconnect included. Defaults to `export`, so every existing caller is
byte-identical — pinned by a test that omits the option and still sees the reply agent refused.
This is **not** mode switching: a session cannot change carriers, only be born into one.

**`connectGuidedReplyRuntime`** (`reply/replyBridge.ts`, new). The v2 counterpart of
`resolveBridgeSession`: DEV-only gate (`bridge-disabled` before any network in a shipped build),
declares `reply`, and wraps the session — frame adapter, then runtime — into one
`GuidedReplyHandle` whose `close()` disposes the runtime **first** (in-flight calls reject as
DISPOSED, an answer) and then closes the socket. The session transport is typed against v1 frames;
on a reply-carrier socket the envelopes inside are v2 — the framing is byte-identical by design, and
the documented cast states that fact rather than converting anything.

**Acknowledged `START_RUN`** (`replyRuntime.ts`). `start()` now settles on the agent's
`aw_command_result`: accepted → the announced runId; refused → `ReplyStartRejectedError` (sanitized
reason or null) immediately; silence → `ReplyStartTimeoutError` after `REPLY_START_TIMEOUT_MS`
(5s — an ack is machine-speed; shorter than the report bound on purpose). Same settle machinery as
`report()`: one path, listeners torn down, `dispose()` aborts it in flight. The failure now lands
where the operator caused it — opening the guided panel, inside `startHandoff`'s existing retryable
"시작하지 못했습니다" path — instead of at the first report.

**`useReplyRuntime`** (`reply/useReplyRuntime.ts`, new) — the disposal contract's missing caller.
Resolution order, releasing on unmount exactly what it created:

1. an **injected** runtime (tests) — passed through, never disposed by the hook;
2. the **bridge** runtime — connected per panel mount, `handle.close()` on unmount, and a session
   that resolves *after* unmount is closed on arrival rather than leaked;
3. the `resolveReplyRuntime()` **fallback** — simulated in DEV (disposed on unmount), null in
   production.

The fallback stays available while the bridge connects, so a DEV operator is never blocked on a
round-trip; a guided run started on it keeps its runtime through the handle it returned — only new
starts pick up the bridge.

**`VocItemReplyPrep`** — one line: the `useMemo` became `useReplyRuntime(replyRuntime)`. Every
existing panel behavior is pinned by its 40 tests, unchanged.

## 3. What is NOT in this slice

- **No carrier mode switching.** An agent hosts one carrier; the export surface and the reply panel
  each connect to the matching one and refuse the other. Running both worlds live at once still
  requires the agent-side rework recorded in the discriminator slice.
- **No reply-side resync.** A reconnect replays through `aw_resync_result`, which the reply adapter
  drops — a terminal that arrived during the gap is missed and the report times out; the retry then
  meets `INVALID_FOR_STATE` and surfaces immediately. Honest, but recorded as the reconnect gap.
- **No new UI.** The panel's copy and controls are untouched; refusal reasons from the reply connect
  are not yet surfaced in diagnostics (the export panel's `BridgeDiagnostics` is export-scoped).

## 4. Verification

| | before | after |
|---|---|---|
| frontend | 784 | **805** |
| collector | 4843 / 95 skipped | unchanged — `expectedCarrier` is additive, no call sites moved |
| backend | untouched | untouched |

Both typechecks clean.

**Falsified (each rule reverted, its tests failed):**

| revert | tests that failed |
|---|---|
| `start()` back to fire-and-forget | 5 ack tests + the loopback refused-START E2E |
| hook stops disposing fallback / closing handle | `DISPOSES the fallback…`, `adopts the BRIDGE runtime…` |
| drop the post-unmount close | `closes a session that resolves AFTER unmount` |
| hardcode the carrier check back to export | both reply-declared transport tests |

- **Run 7 stays deferred** until the approved network/IP environment returns. No gate consumed, no
  live contact.
