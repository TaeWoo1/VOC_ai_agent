# review-import-journey / v1 — internal state contract

An **internal** state/event/effect contract for the NAVER historical-review-import journey. It is **not** an
Action Window wire contract and is versioned **separately** from `ACTION_WINDOW_TRANSPORT_VERSION`. Nothing
here crosses the FE ↔ Runtime socket.

## What it is

A pure decision kernel. Given the host's state and an event, it returns an effect the host carries out. No I/O,
no logging, no network, no browser, no clock — type-checked under `contracts/tsconfig.json` (no DOM, no Node),
so it stays portable and testable in isolation.

## v1 scope

The **segment-entry decision only** — "may this launch host a segment run?", in two phases around the one
scope-resolve I/O the host performs:

- `START_RUN_RECEIVED` (pre-resolve): idempotent same-ref re-send, concurrent-start race.
- `SCOPE_RESOLVED` (post-resolve): scope kind, declared-vs-server kind agreement, required range, channel match.

The frame parse (`importRefFromStartRun`) and run assembly remain in `collector/.../import-host.ts`; the host
maps each `REFUSE` reason to its **existing, unchanged** log line and `HOST_SEGMENT` to minting/assembling the
run. Behaviour and log semantics are identical to the pre-extraction host.

## Out of v1 scope

The wider journey (auth, connect, plan, next-segment, completion), any LangGraph wiring, and the scope-evidence
single-source unification. See the migration plan and its Appendix A:
`docs/action-window-runtime/review-import-journey-langgraph-migration-plan.md`.

## Verify

```bash
npx tsc -p contracts/tsconfig.json          # pure-portability type-check (no DOM/Node)
cd collector && npm test                    # host delegation + kernel unit tests
```
