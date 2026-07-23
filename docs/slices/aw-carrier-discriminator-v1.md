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
| frontend | 746 | **751** |
| collector | 4843 / 95 skipped | unchanged count, 2 fixtures updated |
| backend | 1502 (2 skipped) | unchanged, untouched |

Both typechecks clean.

**The existing suites proved the change had teeth before any new test did:** 9 frontend and 2
collector tests failed the moment the guard landed, because their fixtures announced without
`carrier` — which is the new refusal working. They now announce as the real endpoints do.

**What the independent review caught (2, both fixed):**

1. **The typing claim was false.** `export const AW_CARRIER_EXPORT: AwCarrierKind = "export"` —
   the annotation **widens** the literal, so `typeof AW_CARRIER_EXPORT` was the union and an
   announcement field typed against it happily accepted `"reply"`. Exactly the mistake the field
   exists to prevent, reintroduced in the field's own definition. The constants are now unannotated
   so they keep their literal types, verified with a throwaway probe that must fail to compile.
2. **Reconnect was protected but unpinned.** The guard sits inside `openAnnouncedSocket`, which the
   retry loop reuses — so an agent that restarts hosting the reply carrier is already refused rather
   than spliced into an established v1 transport. That was true by construction and asserted by
   nothing; a test now pins it, and it fails when the guard is removed.

**Falsified:**

| revert | tests that failed |
|---|---|
| remove the carrier guard entirely | all 3 refusal tests |
| treat an absent carrier as `export` | `REFUSES an announcement with no carrier at all` |
| remove the guard (reconnect path) | `REFUSES a carrier switch on RECONNECT` |

And the positive case is pinned too — `still attaches to the EXPORT carrier — v1 behaviour is
unchanged` — so the guard cannot be satisfied by refusing everything.

## 5. Recorded, not fixed

- **The mode switch is still the open decision.** A second connection cannot work while
  `createAgentBridge` refuses to host both carriers; an explicit switch matches the agent's real
  model. Sequencing, UX, failure and security implications are in the branch discussion; this slice
  only supplies the discriminator every option needs.

## 6. DECISION — 2026-07-24: keep the carriers SPLIT (product owner)

**The two carriers stay split; a session is born into ONE carrier and stays there for its whole life,
reconnect included.** Neither multiplexing nor a mid-life mode switch is implemented now. This holds
until a concrete seller-facing workflow demonstrably needs both carriers live in one session — at
which point the additive option is preferred and the switching option is not.

**Why split is the right default now.** The one-carrier-per-session invariant is what makes every
fail-closed guarantee simple to state and to prove: the export surface refuses a reply announcement,
the reply panel refuses an export announcement, and both hold on reconnect because reconnect reuses
the same `openAnnouncedSocket` carrier gate. That reconnect-inclusive refusal is now proven end to
end over a real socket in `collector/test/crossstack/fe-reply-runtime-real-bridge.test.ts` (the FE
reply runtime against the real agent-hosted reply carrier). No seller flow today opens both surfaces
against one agent session, so splitting costs nothing a seller can observe.

**The three options, ranked (recap for the next reader):**

1. **Split (this decision, zero further work).** Two separate connections, one per carrier, each
   refusing the other. Safe, shipped, and honest.
2. **Concurrent multiplexing — the additive path, NOT built.** The agent hosts both carriers on one
   socket; the `aw_session` announcement carries a *set* of carriers; the client attaches to the
   one(s) it speaks and the transport demultiplexes by carrier per frame. This preserves every
   fail-closed property (it is additive, not a switch) and the cross-stack harness above extends
   directly to prove a dual-carrier announcement. **Do this — and only this — when a real workflow
   needs both carriers in one session.**
3. **Mid-life mode switch — REJECTED.** A session changing carrier mid-life breaks the invariant
   above and forces re-derivation of every refusal guarantee, including the reconnect refusal just
   proven, with no demonstrated need. Do not implement.

⚠ **`bootAttempted` note still applies to option 2:** it is once-per-app-session with a DEV-only
retry, so if multiplexing ever lands, re-attach must re-read the announcement rather than assume the
prior carrier set.
- `bootAttempted` is once-per-app-session with a DEV-only retry. A mode switch means the carrier can
  change between attempts, so re-attach must re-read the announcement rather than assume the prior
  carrier. *(Superseded by the §6 decision: the switch is rejected; this note now governs option 2.)*
- **Run 7 — EXECUTED and COMPLETED 2026-07-24** (attempt 3: real export → ingest SUCCESS). See
  `docs/action-window-runtime/r4-run7-reply-state-live-proof-dispatch-record.md` §18.
