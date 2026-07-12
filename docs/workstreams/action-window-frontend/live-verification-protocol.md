# Action Window Bridge — live-agent verification protocol (FE-owned)

Manual protocol for verifying the Operations UI against a **live paired local agent** over
the Bridge (`VITE_AW_BRIDGE=1`). FE-6/FE-7/FE-8/FE-9 cover the UI automatically but always
with `bridgeSource` **mocked** and the store **seeded** — no real socket. This document
covers the gap that only a real agent can exercise.

**Status:** protocol only. Running it is a **separate, approval-gated** step and requires a
runtime/collector-owned synthetic agent (out of frontend ownership). The FE can only start
the dev server and observe.

## Run recipe
From `frontend/`:
```bash
npm run dev:bridge     # = VITE_AW_BRIDGE=1 vite  → http://localhost:5173
```
- `VITE_AW_BRIDGE=1` (string `"1"`) turns on bridge mode (DEV-gated).
- Optional `VITE_BRIDGE_URL` (HTTP base; ws derived). Default `http://127.0.0.1:47615`.
- The bridge only engages once a paired agent announces an `aw_session`; otherwise the UI
  **stays on fixtures** and the dev diagnostics panel reads `픽스처로 폴백됨` (honest fallback).

## Preconditions
- DEV build, `frontend/` deps installed.
- A **paired local agent** hosting a **synthetic** `aw_session` at `VITE_BRIDGE_URL`
  (runtime/collector-owned — not this workstream).
- Deterministic agent control: start / stop / same-run restart / different-run.
- Synthetic run only — no real seller data, credentials, or marketplace content.

## Steps & expected results
Open the Operations page and the **브리지 진단 (개발용)** diagnostics region.

| # | Action | Expect |
|---|--------|--------|
| 1 | Agent up, `npm run dev:bridge` | Verdict `라이브 브리지 사용 중`; 소스 모드 = bridge; 연결 상태 = connected; 부트 시도됨 = yes |
| 2 | Stop agent, hard-reload (flag still on) | Verdict `픽스처로 폴백됨` (fixture, boot attempted) |
| 3 | Restart dev **without** the flag | Verdict `픽스처 데모 (브리지 꺼짐)` |
| 4 | Live session, induce a **real** socket drop | Banner `다시 연결하는 중이에요`; **no** reconnect button; commands gone |
| 5 | Keep agent down past retry exhaustion | Banner `연결이 끊겼어요` **with** `다시 연결` button; 연결 상태 = offline; 연결 변경 횟수 incremented |
| 6 | Click `다시 연결` while agent down | Button → `다시 연결하는 중…` (`aria-busy`, disabled), then safe note `아직 연결할 수 없어요. 로컬 에이전트가 실행 중인지 확인해 주세요.` |
| 7 | Restart agent on **same runId**, click `다시 연결` | Return to connected; banner gone; commands restored; timeline resynced (no dup/gap) |
| 8 | (Optional) reconnect while agent hosts a **different** runId | Settles to offline (never spliced) — not a corrupted merge |

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
