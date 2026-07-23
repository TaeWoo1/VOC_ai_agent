# Slice — Action Window Carrier Discriminator v1

> **Status:** IMPLEMENTED, offline. **Safety slice only** — it makes a mis-attach impossible; it does
> **not** wire the mode switch or the production reply runtime. No migration, no backend change,
> §4.1 and the ledger untouched.

- **Workstream:** Review Operations (`docs/workstreams/review_operations_mvp.md`)
- **Loop stages:** ACT (the Bridge carrier beneath it)
- **Date:** 2026-07-23 · **Live contact:** none

---

## 1. Why — the two carriers were indistinguishable on the wire

The Bridge hosts two Action Window carriers: **v1 export** (`action-window-endpoint.ts`) and **v2
reply-submission** (`reply-submission-endpoint.ts`). They are byte-for-byte identical at the
transport layer by design — same `/bridge/ws` socket, same `{type:"aw", payload}` framing, same
`aw_session` announcement — because the Bridge treats the payload as opaque and never inspects it.
They differ only in the contract version of what is *inside* that payload.

That left a client with **nothing to discriminate on**:

| candidate field | why it does not work |
|---|---|
| `transportVersion` | **`1` in BOTH** (`contracts/action-window/v{1,2}/transport.ts`) — correctly, since it versions the framing, which really is identical |
| `channelCode` | `naver` on both |
| `runId` | opaque by design |

So `connectAwBridgeSession` — which serves the **v1 export world only** — would have *accepted* an
announcement from an agent hosting the reply carrier, built a v1 client, and fed it v2 envelopes.
The result is the worst failure shape available: **connected but dormant**, rather than an honest
fallback to the contract-backed fixture.

Nothing triggers this today (`local-agent.ts` hosts one carrier and the reply one is DEV-only), which
is exactly why it was worth closing before the mode switch makes both reachable.

## 2. What changed

**`contracts/action-window/aw-carrier-kind.ts`** — a shared `AwCarrierKind` (`export` | `reply`),
deliberately **outside** `v1/` and `v2/`: it is the field that tells a client which of those two to
use, so it cannot live inside either without the client already knowing the answer in order to read
it. Both endpoints and the frontend import it.

**Both endpoints announce it.** `aw_session` gains `carrier`, typed to the literal each endpoint can
emit — so an endpoint cannot announce the other one's kind even by mistake.

**The frontend routes or fails closed.** `connectAwBridgeSession` attaches only when
`carrier === "export"`. Anything else — `reply`, an unknown value, or **absence** — closes the socket
and resolves null, leaving the operations surface on its fixture.

⚠ **Absence fails closed, and that is the load-bearing choice.** Both endpoints predate this field,
so an announcement without it is genuinely ambiguous. Resolving that ambiguity by assuming `export`
is precisely how the mis-attach would come back, so it is refused instead. The cost is bounded: the
Bridge is DEV-only, and agent and frontend ship from this repo together.

**A reply carrier is not an error.** It is a different world this caller does not speak — so the FE
declines rather than reporting a failure, and the export surface degrades to the contract-backed
demo exactly as it does for an unpaired or unreachable agent.

## 3. What is NOT in this slice

- **No mode switch.** The FE still speaks only v1; it now refuses v2 instead of mis-reading it.
- **No production reply runtime.** `resolveReplyRuntime()` still returns null outside DEV, and
  `createBridgeReplyRuntime` is still constructed by nothing.
- **No change to the one-carrier constraint.** `createAgentBridge` still throws when both are
  configured. That constraint is agent-side, which is why a *second connection* remains unavailable
  without reworking the agent — recorded for the wiring decision, not acted on here.

## 4. Verification

| | before | after |
|---|---|---|
| frontend | 746 | **750** |
| collector | 4843 / 95 skipped | unchanged count, 2 fixtures updated |
| backend | 1502 (2 skipped) | unchanged, untouched |

Both typechecks clean.

**The existing suites proved the change had teeth before any new test did:** 9 frontend and 2
collector tests failed the moment the guard landed, because their fixtures announced without
`carrier` — which is the new refusal working. They now announce as the real endpoints do.

**Falsified:**

| revert | tests that failed |
|---|---|
| remove the carrier guard entirely | all 3 refusal tests |
| treat an absent carrier as `export` | `REFUSES an announcement with no carrier at all` |

And the positive case is pinned too — `still attaches to the EXPORT carrier — v1 behaviour is
unchanged` — so the guard cannot be satisfied by refusing everything.

## 5. Recorded, not fixed

- **The mode switch is still the open decision.** A second connection cannot work while
  `createAgentBridge` refuses to host both carriers; an explicit switch matches the agent's real
  model. Sequencing, UX, failure and security implications are in the branch discussion; this slice
  only supplies the discriminator every option needs.
- `bootAttempted` is once-per-app-session with a DEV-only retry. A mode switch means the carrier can
  change between attempts, so re-attach must re-read the announcement rather than assume the prior
  carrier.
- **Run 7 stays deferred** until the approved network/IP environment returns. No gate consumed, no
  live contact.
