# Slice — Carrier Refusal Diagnostics v1

> **Status:** IMPLEMENTED, offline. **Diagnostics only** — no v2 transport, no reply-runtime
> injection, no mode switching. No backend change, no migration, §4.1 and the ledger untouched.

- **Workstream:** Review Operations (`docs/workstreams/review_operations_mvp.md`)
- **Loop stages:** ACT (the Bridge carrier beneath it)
- **Date:** 2026-07-23 · **Live contact:** none

---

## 1. Why — every failure looked the same

`connectAwBridgeSession` returned `null` for **six different situations**: bridge mode off, unpaired,
ticket rejected, agent unreachable, no announcement in time, transport-version mismatch — and, since
the carrier discriminator landed, an agent hosting the **reply** carrier.

That last one is the expensive confusion. An agent running with `--dev-action-window-reply` is
working perfectly; it is simply hosting the other carrier. Collapsed into a bare `null`, it reached
the operator as "offline", indistinguishable from a dead agent. A healthy machine looked broken, and
nothing on the screen could say otherwise.

This is also the prerequisite for the carrier-switch decision: **both** a mode switch and a second
connection need the frontend to know *why* it declined, and neither can be built on a bare `null`.

## 2. What changed

**A discriminated result.** `connectAwBridgeSession` now resolves
`{ok: true, session}` or `{ok: false, reason, announcedCarrier?}`. `AwRefusalReason` is a **closed
set of sanitized enums** — never a message, status code, origin or token — so it is safe to show and
safe to log.

**`announcedCarrier` travels only when it is knowable.** It is present for `carrier-mismatch` **and
only when the announced value was a recognised carrier**. An absent or unrecognised carrier stays
absent: that is precisely the thing that could not be identified, and naming it would be a guess
dressed as a diagnosis.

**A DEV-only surface.** `bridgeSource.connectBridgeIfEnabled` records the reason into the operations
store before falling back, and `BridgeDiagnostics` renders it as a labelled field —
"다른 캐리어 호스팅 중(reply)" where it used to show nothing at all.

**`bridge-disabled` is named, not treated as a failure.** A build that never asked for a live bridge
did not fail to reach one.

## 3. What is preserved exactly

- **Every fail-closed path still fails closed.** No reason attaches a socket the previous code would
  have rejected; the refusal set is identical, only now labelled.
- **The export attachment path is unchanged**, and proven so end-to-end: the collector's cross-stack
  tests drive the *real* frontend transport against the *real* Bridge, and they pass.
- **The honest-fallback rule is unchanged.** A refusal still leaves Operations on the contract-backed
  fixture.
- **Reconnect is unchanged**, including the carrier-switch refusal — the retry loop discriminates on
  `ok` exactly where it used to discriminate on null.

## 4. What is NOT in this slice

No v2 transport, no `createBridgeReplyRuntime` injection, no mode switching. The frontend still
speaks only v1; it now says *why* when it declines to speak anything else.

## 5. Verification

| | before | after |
|---|---|---|
| frontend | 751 | **756** |
| collector | 4843 / 95 skipped | unchanged count, 2 cross-stack call sites updated |
| backend | 1502 (2 skipped) | unchanged, untouched |

Both typechecks clean.

⚠ **The collector's cross-stack tests caught what the frontend suite could not.** They import
`connectAwBridgeSession` directly and drive it against a real Bridge, so the signature change broke
7 of them — a call site the frontend's own suite has no visibility into. They now read `.ok` /
`.session`, and their failure message carries the reason, so a future cross-stack failure names its
cause instead of saying "failed".

**Falsified:**

| revert | tests that failed |
|---|---|
| collapse `carrier-mismatch` into a generic failure label | 3 refusal-label tests |
| drop `announcedCarrier` from the refusal | `REFUSES to attach to an agent hosting the REPLY carrier` |

The label table is also asserted to be **injective** — a mapping that collapsed two reasons onto one
label would undo the point while every individual assertion still passed.

## 6. What the independent review caught

Two, both fixed:

1. **The "closed set" claim was not enforced.** The operations store typed the refusal as
   `{reason: string}`, so a typo like `"unpared"` would have flowed straight through to the panel
   while the slice's own documentation promised a closed enum. Now typed to `AwRefusalReason` /
   `AwCarrierKind` — verified with a throwaway probe that must fail to compile. The *presentation*
   input stays `string` deliberately: `refusalLabel` renders an unrecognised reason verbatim so a
   refusal nobody labelled is visible, and narrowing there would delete the only path that reaches
   that behaviour.
2. **An orphaned type.** `devMode.BridgeSession` — a duplicate of `AwBridgeSession` — became
   referenced by nothing once `resolveBridgeSession` started returning the discriminated result.
   Removed, along with its now-unused import.

## 7. Recorded, not fixed — and the next audit

- **The envelope↔frame adapter does not exist.** `createBridgeReplyRuntime` takes a
  `ReplyClientTransport` speaking `CommandEnvelope`/`EventEnvelope`, but the wire carries
  `{kind:"aw_command"…}` / `{kind:"aw_event"…}` frames. The only implementation of that interface
  today is a fake in its own unit test, so the runtime has never been driven by a real transport.
- ⚠ **`report()` can hang forever.** It resolves only on `RUN_OPERATOR_REPORTED`, with no timeout, no
  rejection, and no `aw_command_result` handling — where the v1 adapter already handles
  `if (!frame.accepted)`. Wiring it would wedge `VocItemReplyPrep` at `busy = "reporting"` with
  `inFlight = true` and no way out. **This is the next audit**, and it should be fixed before any
  injection: a wedged panel is worse than a manual handoff that works.
- **Run 7 stays deferred** until the approved network/IP environment returns. No gate consumed, no
  live contact.
