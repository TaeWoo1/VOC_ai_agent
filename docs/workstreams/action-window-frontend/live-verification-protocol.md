# Action Window Bridge — live-agent verification protocol (FE-owned)

Manual protocol for verifying the Operations UI against a **live paired local agent** over
the Bridge (`VITE_AW_BRIDGE=1`). FE-6/FE-7/FE-8/FE-9 cover the UI automatically but always
with `bridgeSource` **mocked** and the store **seeded** — no real socket. This document
covers the gap that only a real agent can exercise.

**Status:** the runtime/collector-owned **synthetic UI-verification agent** now exists
(`collector` — `npm run action-window-ui-harness`), so this protocol is runnable. It stays a
**separate, approval-gated** manual browser step: the FE side only starts the dev server and
observes; the agent + its drive controls are runtime/collector-owned.

## Run recipe
Two loopback processes — no connections file, no browser automation, no marketplace.

```bash
# Terminal A — synthetic agent (collector). Refused under NODE_ENV=production.
cd collector && npm run action-window-ui-harness
#   → {"event":"AW_UI_HARNESS_LISTENING","bridgePort":47615,"controlPort":47616,"runId":"run_synthetic_…"}
#     Bridge on 47615 (the FE's VITE_BRIDGE_URL, auto-approve pairing, DEV);
#     loopback control server on 47616 drives the connection states below.

# Terminal B — the FE dev server.
cd frontend && npm run dev:bridge     # = VITE_ENABLE_AGENT_BRIDGE=true VITE_AW_BRIDGE=1 vite → http://localhost:5173
```
- `VITE_AW_BRIDGE=1` (string `"1"`) turns on the Action Window bridge mode (DEV-gated);
  `VITE_ENABLE_AGENT_BRIDGE=true` shows the **로컬 에이전트 연결 상태** pairing dock. `dev:bridge` sets **both**.
- **Pair once to go live:** the AW transport only reuses a pairing token the status dock stored; it never
  pairs on its own. So on first load, click **`연결하기`** in the bottom-right `로컬 에이전트 연결 상태` dock
  (the harness auto-approves → token saved), then **hard-reload** — now the AW boot finds the token and the
  verdict flips to `라이브 브리지 사용 중`. Without this the UI stays on fixtures (`픽스처로 폴백됨`).
- Optional `VITE_BRIDGE_URL` (HTTP base; ws derived). Default `http://127.0.0.1:47615` — matches the harness.
- The bridge only engages once paired **and** the agent announces an `aw_session`; otherwise the UI
  **stays on fixtures** and the dev diagnostics panel reads `픽스처로 폴백됨` (honest fallback).
- **Control server** (loopback, default `http://127.0.0.1:47616`): `POST /control/complete-user-action`,
  `POST /control/drop-socket`, `POST /control/host {"runId?":"…","up?":true|false}`, `GET /control/status`.

## Preconditions
- DEV build, `frontend/` + `collector/` deps installed.
- The **synthetic agent above** running (hosts a synthetic `aw_session` at `VITE_BRIDGE_URL`,
  auto-approve pairing) — runtime/collector-owned, not this FE workstream.
- Deterministic control via the loopback control server (drop / pause-resume / same-run / different-run).
- Synthetic run only — no real seller data, credentials, or marketplace content.

## Steps & expected results
Open the Operations page and the **브리지 진단 (개발용)** diagnostics region.

Below, `CTRL` = `http://127.0.0.1:47616` (the harness control server). `curl -s -X POST` for the POSTs.

| # | Action | Expect |
|---|--------|--------|
| 1 | Agent up (Terminal A), `npm run dev:bridge` (Terminal B), **pair via the `연결하기` dock, then hard-reload**. *(optional: `POST $CTRL/control/complete-user-action` to advance the run past the checkpoint)* | Verdict `라이브 브리지 사용 중`; 소스 모드 = bridge; 연결 상태 = connected; 부트 시도됨 = `예` |
| 2 | `POST $CTRL/control/host` `{"up":false}` (agent down for the AW channel), then hard-reload (flag still on) | Verdict `픽스처로 폴백됨`; 소스 모드 = fixture; **부트 시도됨 = `예`** (reactive — no re-render needed) |
| 3 | Restart dev **without** the AW flag (`npm run dev`; still DEV) | Diagnostics panel still renders; verdict `픽스처 데모 (브리지 꺼짐)`; 브리지 모드 = `아니오` |
| 4 | Live session, then `POST $CTRL/control/drop-socket` (a **real** socket drop) | Banner `다시 연결하는 중이에요`; **no** reconnect button; commands gone |
| 5 | `POST $CTRL/control/host` `{"up":false}` then `POST $CTRL/control/drop-socket`; wait past retry exhaustion | Banner `연결이 끊겼어요` **with** `다시 연결` button; 연결 상태 = offline; 연결 변경 횟수 incremented |
| 6 | Click `다시 연결` while agent down (still paused) | Button → `다시 연결하는 중…` (`aria-busy`, disabled), then safe note `아직 연결할 수 없어요. 로컬 에이전트가 실행 중인지 확인해 주세요.` |
| 7 | `POST $CTRL/control/host` `{"up":true}` (resume the **same runId**), then click `다시 연결` | Return to connected; banner gone; commands restored; timeline resynced (no dup/gap) |
| 8 | `POST $CTRL/control/host` `{"up":true,"runId":"run_synthetic_other"}` (a **different** runId), then `POST $CTRL/control/drop-socket` (or click `다시 연결`) | Settles to offline (never spliced) — not a corrupted merge |

> The wire-level behaviour behind steps 1/4/5/7/8 is also proven hermetically (no browser) by
> `collector/test/crossstack/synthetic-ui-harness-controls.test.ts`, which drives the FE's own transport
> against this harness through the same control endpoints. This manual protocol adds the **browser-rendered
> UI** layer (verdict labels, banners, the `다시 연결` button) that only a real browser + operator can confirm.

## Pass / fail criteria
- **Live vs fixture-fallback verdict** — PASS: agent up → `라이브 브리지 사용 중`; agent down,
  flag on → `픽스처로 폴백됨`; flag off → `픽스처 데모 (브리지 꺼짐)`. FAIL: `live` while no
  agent, or `fixture-fallback` while the agent is confirmed serving.
- **Real drop → reconnecting → offline** — PASS: drop → `다시 연결하는 중이에요` (no button),
  then exhaustion → `연결이 끊겼어요` (button). FAIL: stuck connected, skips reconnecting, or
  no offline banner.
- **Manual reconnect path** — PASS: click shows `다시 연결하는 중…` busy; failure shows the safe
  note; same-run success returns to connected. FAIL: click no-ops, stays busy forever, or leaks
  a raw error.
- **Command suppression while disconnected** — PASS: START_RUN / checkpoint card / control panel
  all absent-or-disabled while offline/reconnecting; nav links remain. FAIL: any command fireable
  while disconnected.
- **Fresh resync after reconnect** — PASS: same-run reconnect restores connected with a coherent
  timeline (no dup/gap); different-run → offline, never spliced. FAIL: duplicated/dropped events
  or a spliced cross-run timeline.

## Evidence to capture (redacted)
Per observation: screenshot of the banner **and** the diagnostics region, plus the transcribed
verdict label + 연결 상태 + 연결 변경 횟수 + 마지막 전이. Optionally the DOM subtree of
`ConnectionBanner` / `BridgeDiagnostics` (no network payloads).

**Redaction (standing rules):** never capture seller IDs, credentials, tokens, cookies, a
sensitive runId, raw page content, PII, or marketplace-data screenshots. UI chrome + Korean
labels only. Store evidence in a **gitignored scratch** location; do **not** commit it.

## Safety
- Do not run without explicit per-run approval and a runtime-owned synthetic agent.
- No live NAVER/ESM/marketplace, no browser automation, no credentials/real data/uploads/DB.
- FE side only starts `npm run dev:bridge` and observes; it must not stand up or drive the agent.
