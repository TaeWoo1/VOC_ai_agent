# Action Window Bridge — live-agent verification **readiness** (FE-owned go/no-go)

Companion to [`live-verification-protocol.md`](./live-verification-protocol.md). The protocol
says *how* to verify the Operations UI against a live paired agent; this doc answers *whether we
can run it yet* and *exactly which runtime-owned pieces are missing*.

**Bottom line (updated 2026-07-13): the runtime-owned pieces now EXIST, and the wire contract is
proven hermetically.** When this doc was written the sole blocker was a runtime/collector-owned
**synthetic paired agent** that both completes the pairing lifecycle *and* announces a synthetic
`aw_session` over the socket — and it did not exist. It does now: the dedicated **synthetic
UI-verification agent** `collector` → `npm run action-window-ui-harness` hosts exactly that agent
(synthetic driver, no `--connections`, no browser, no marketplace; refused under production) and exposes
loopback drive controls; and the runtime-verification workstream added a **hermetic
cross-stack test** — `collector/test/crossstack/fe-transport-real-bridge.test.ts` — that drives the
FE's OWN transport modules (`wsTransport.ts` → `bridgeAdapter.ts` → `bridgeSource.ts`, unmodified)
against a **real** `BridgeServer`, proving all six wire behaviours below (pairing→token, ws-ticket,
`aw_session` < 4 s, `aw_view`/`aw_event` frames, `aw_resync`, and deterministic
same-run-reconnect + different-run→offline). See [`../../action-window-runtime/checklist.md`](../../action-window-runtime/checklist.md) row **12c**.

**What still requires the manual protocol (approval-gated):** the cross-stack test proves the FE
*transport/adapter/source* over the real socket; it does **not** exercise the browser-rendered
Operations UI (React components, the `브리지 진단` diagnostics labels, the reconnect banner copy)
against a live agent. Running [`live-verification-protocol.md`](./live-verification-protocol.md) —
`npm run dev:bridge` pointed at the synthetic agent above — remains the way to validate that
browser-rendered surface, and stays a separate, per-run approval-gated step.

This is an **assessment only**: no live run, no FE source/CI/dependency change (the reconciliation
above is docs-only; the harness and cross-stack test live in `collector/`, owned by the runtime workstream).

## 1. What is already prepared (frontend)
- **Run recipe** — `frontend/package.json` `"dev:bridge": "VITE_ENABLE_AGENT_BRIDGE=true VITE_AW_BRIDGE=1 vite"`
  (no dep added). Both flags are needed: `VITE_AW_BRIDGE=1` arms the AW bridge path, and
  `VITE_ENABLE_AGENT_BRIDGE=true` shows the pairing dock so the FE can store a token — then pair via
  `연결하기` + hard-reload to reach `라이브 브리지 사용 중` (see the protocol doc's Run recipe).
- **README note** — `frontend/README.md` documents the paired-agent run, `VITE_BRIDGE_URL`
  default `http://127.0.0.1:47615`, and the honest fixture-fallback behaviour.
- **Protocol doc** — `live-verification-protocol.md` (run recipe, 8-step observation table,
  pass/fail keyed to exact Korean labels, redaction rules).
- **Automated coverage** — FE-6 component DOM/a11y, FE-7 page-level DOM integration, FE-8 frontend
  CI, FE-9 jest-axe scans, plus pure-logic tests for `describeBridgeDiagnostics` and `wsTransport`.
  **All run with `bridgeSource` mocked + the store seeded — no real socket.** That mocked seam is
  exactly the gap only a live agent can close.

## 2. What the paired agent MUST provide (verified against the FE wire contract)
The FE leaves fixtures for the live source **only** when a paired agent at `VITE_BRIDGE_URL`
provides all of the following. (Citations are to `frontend/src`.)

1. **Pairing lifecycle → token.** `GET /bridge/health`; `POST /bridge/pair/request` →
   `{requestId, confirmationCode}`; `POST /bridge/pair/poll` → `paired` + `pairingToken`, so the FE
   stores `sellerops_bridge_token` in `localStorage` (`lib/bridge/bridgeClient.ts`). **Without this
   token the go-live path never even mints a ws-ticket** — it resolves `null` and stays on fixtures
   (`lib/actionWindow/wsTransport.ts`).
2. **WS ticket.** `POST /bridge/ws-ticket` (Bearer token, body `{clientProtocolVersion}`) →
   `{"ticket":"<string>"}`.
3. **Socket + session announcement.** Accept `ws://127.0.0.1:47615/bridge/ws?ticket=…` and send, as
   the **first** frame within **4 s**, a Bridge envelope
   `{"type":"aw_session","transportVersion":1,"runId":"<str>","channelCode":"<str>"}`.
4. **Live frames.** Thereafter wrap every Action Window frame as
   `{"type":"aw","payload":"<JSON.stringify(AwServerFrame)>"}` with `.kind` ∈
   `aw_event | aw_view | aw_command_result | aw_resync_result`, carrying valid
   `EventEnvelope` / `ActionWindowRunView` per `contracts/action-window/v1`.
5. **Resync.** Answer an inbound `aw_resync {runId, sinceSequence:0}` with an `aw_resync_result`
   (view + events).
6. **Deterministic drive.** Operator can stop / same-`runId` restart / **different**-`runId` restart
   to walk `connected → reconnecting → offline`. Retry envelope: 4 s session timeout, 1.5 s **fixed**
   retry delay (no backoff), 5 attempts before offline. A changed `runId` on reconnect forces
   **offline, never spliced**.

All six are **runtime/collector-owned and out of frontend ownership.** **(Updated 2026-07-13: the
runtime workstream now provides the dedicated synthetic UI-verification agent — `collector` →
`npm run action-window-ui-harness` (`cli/action-window-ui-harness.ts`) — with loopback drive controls,
and proves all six against the FE's own transport modules over a real `BridgeServer` in
`collector/test/crossstack/fe-transport-real-bridge.test.ts` and
`collector/test/crossstack/synthetic-ui-harness-controls.test.ts`. This FE workstream still neither
creates nor touches it.)**

## 3. What FE may / may not do during a run
**May:** start `cd frontend && npm run dev:bridge`, open Operations, open the **브리지 진단 (개발용)**
region, observe; click **`다시 연결`**, hard-reload, toggle the flag; transcribe verdict label +
연결 상태 + 연결 변경 횟수 + 마지막 전이; capture redacted UI-chrome screenshots to a gitignored
scratch path.

**May not:** stand up / pair / script / drive the agent; implement the pairing lifecycle or a
synthetic run host; run live NAVER/ESM/marketplace, browser automation, credentials, real data,
uploads, or DB; touch `backend/**`, `collector/**`, `contracts/**` (consumed only), runtime docs,
canonical docs, or FE source/CI/`setup.ts`; commit evidence, real `runId`s, tokens, or
`sellerops_bridge_token`.

## 4. Go / no-go checklist (all YES to run the full protocol)
The first five are now satisfied by the runtime harness + the hermetic cross-stack proof (2026-07-13);
they are no longer blockers. The last two remain per-run gates for the **manual** browser-UI protocol.
- [x] Runtime-owned **synthetic** paired agent reachable at `VITE_BRIDGE_URL` — `npm run action-window-ui-harness`.
- [x] Agent serves the pairing lifecycle so the FE holds a valid `sellerops_bridge_token` — proven in `fe-transport-real-bridge.test.ts`.
- [x] Agent mints WS tickets and announces a synthetic `aw_session` (`transportVersion:1`) < 4 s — proven.
- [x] Agent streams valid `aw_view`/`aw_event` frames and answers `aw_resync` for a synthetic run — proven.
- [x] Operator can deterministically drive checkpoint / drop / same-run reconnect / different-run→offline — via the harness's loopback control server, proven in `synthetic-ui-harness-controls.test.ts`.
- [ ] Per-run approval granted; synthetic-only (no real data/credentials). *(manual-run gate)*
- [ ] Evidence destination is a gitignored scratch path. *(manual-run gate)*

## 5. Optional FE-only sanity check (needs no runtime, runnable today)
`npm run dev:bridge` with nothing paired must show verdict **`픽스처로 폴백됨`**; with the flag off,
**`픽스처 데모 (브리지 꺼짐)`**. This confirms the honest-fallback verdicts — it is a sanity check,
**not** the live verification, and is separate/approval-gated like any run.

## 6. Prompt for the Runtime/collector side
> Stand up a **synthetic** paired local agent for FE live-verification of the Action Window Bridge
> at `http://127.0.0.1:47615` (no real data/credentials). It must: (1) serve the pairing lifecycle
> (`/bridge/health`, `/bridge/pair/request` → `{requestId,confirmationCode}`, `/bridge/pair/poll`
> → `paired` + `pairingToken`) so the FE stores a bridge token; (2) serve `POST /bridge/ws-ticket`
> (Bearer, body `{clientProtocolVersion}`) → `{"ticket":"<str>"}`; (3) accept
> `ws://127.0.0.1:47615/bridge/ws?ticket=…` and send as its first frame within 4 s
> `{"type":"aw_session","transportVersion":1,"runId":"<synthetic>","channelCode":"<synthetic>"}`;
> (4) stream frames wrapped as `{"type":"aw","payload":<JSON of an AwServerFrame>}` with kind in
> `aw_event|aw_view|aw_command_result|aw_resync_result` per `contracts/action-window/v1`, and answer
> `aw_resync {runId, sinceSequence:0}` with an `aw_resync_result`; (5) let the operator stop /
> same-`runId` restart / **different**-`runId` restart on demand. Retry envelope to design around:
> 4 s session timeout, 1.5 s fixed retry delay, 5 attempts before offline.

**Fulfilled (2026-07-13):** the runtime workstream delivered (1)–(4) via the dedicated synthetic
UI-verification agent `npm run action-window-ui-harness` (`cli/action-window-ui-harness.ts` →
`agent/synthetic-ui-harness.ts`) over the existing `BridgeServer`, and delivered (5) as a **loopback
control server** (`/control/complete-user-action`, `/control/drop-socket`, `/control/host {runId?,up?}`).
All are verified hermetically against the FE's own transport in
`collector/test/crossstack/fe-transport-real-bridge.test.ts` (test-owned rehosting) and
`collector/test/crossstack/synthetic-ui-harness-controls.test.ts` (driven through the shipped controls).

## Status
Updated 2026-07-13. The runtime-owned synthetic agent now **exists** and the FE↔Bridge **wire contract
is proven hermetically** (cross-stack test, checklist row 12c). What remains is the **manual browser-UI
protocol** ([`live-verification-protocol.md`](./live-verification-protocol.md)) — validating the
Operations UI / Korean diagnostic labels against a live paired agent — which stays a separate, per-run
approval-gated step.
