# Action Window Bridge — live-agent verification **readiness** (FE-owned go/no-go)

Companion to [`live-verification-protocol.md`](./live-verification-protocol.md). The protocol
says *how* to verify the Operations UI against a live paired agent; this doc answers *whether we
can run it yet* and *exactly which runtime-owned pieces are missing*.

**Bottom line: WAIT.** The frontend is fully prepared. The sole blocker is a runtime/collector-owned
**synthetic paired agent** that both completes the pairing lifecycle *and* announces a synthetic
`aw_session` over the socket. Until that exists, `npm run dev:bridge` only reproduces the honest
fixture fallback — not the live path.

This is an **assessment only**: no live run, no FE source/CI/dependency change.

## 1. What is already prepared (frontend)
- **Run recipe** — `frontend/package.json` `"dev:bridge": "VITE_AW_BRIDGE=1 vite"` (no dep added).
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

All six are **runtime/collector-owned and out of frontend ownership.** No such synthetic harness
exists that this FE workstream may create or touch.

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
- [ ] Runtime-owned **synthetic** paired agent reachable at `VITE_BRIDGE_URL`.
- [ ] Agent serves the pairing lifecycle so the FE holds a valid `sellerops_bridge_token`.
- [ ] Agent mints WS tickets and announces a synthetic `aw_session` (`transportVersion:1`) < 4 s.
- [ ] Agent streams valid `aw_view`/`aw_event` frames and answers `aw_resync` for a synthetic run.
- [ ] Operator can deterministically stop / same-run restart / different-run restart.
- [ ] Per-run approval granted; synthetic-only (no real data/credentials).
- [ ] Evidence destination is a gitignored scratch path.

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

## Status
Assessment only — protocol run remains a separate, approval-gated step that depends on the
runtime-owned synthetic agent above.
