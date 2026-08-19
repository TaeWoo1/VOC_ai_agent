# Resident helper — the guided walks on demand (2026-08-19, v1.1)

> **What this is.** One unit of work: audit → design → implementation → regression → live proof, restoring the
> **guided WING issuance walk as the PRIMARY Coupang connect path** while keeping the seller on exactly ONE
> resident SellerOps 도우미 that opens no browser when idle. Product-owner decision, 2026-08-19:
> *the seller runs one helper; idle = bridge only; `/connect/coupang` runs the guided tutorial for real;
> the existing Coupang carrier/browser is brought up on demand; after the walk the helper is idle again;
> the seller never touches a CLI, an env file, or a carrier switch; text stays a fallback; marketplace WRITE
> safety is not weakened.* It closes the "one resident helper hosting READ carriers" gap recorded in
> `docs/self_pilot_runtime_v1.md` §7 — for the Coupang guided walk.
>
> Safety fences unchanged (`CLAUDE.md`): the seller performs every marketplace click; no auto
> export/download/submit; no auth bypass; sanitized output only. **No WRITE boundary moves here** (§5).

## 1. Audit — what the code did before this unit

Re-derived from `db175373`.

### 1.1 How the guided Coupang walk was hosted
- FE: `/connect/coupang` → `CoupangIssuanceGuidedWalkthrough` → `useGuidedIssuance` → `connectIssuanceSession`
  → `wsTransport.connectAwBridgeSession({ expectedCarrier: "issuance" })`: mint a ws ticket from the stored
  pairing token, open `/bridge/ws`, and wait `sessionTimeoutMs` (4 s) for the agent's `aw_session`
  announcement. No message ever asked for a carrier — the agent announced whatever it had, or nothing.
- Agent: `createAgentBridge` mounts **exactly one** carrier endpoint in one slot, chosen at BOOT from a CLI
  flag (`local-agent.ts` precedence chain; `agent-bridge.ts` throws on two; `import-mode-gate.ts` conflict
  list). For the Coupang walk that flag is `--action-window-coupang-issuance-live` (real WING driver) or
  `--dev-action-window-coupang-issuance` (fixture).
- The live flag's gate (`coupangLiveWalkRefusal`) demands BOTH phase variables =
  `COUPANG_WING_GUIDED_ISSUANCE_WALK`, an `apr-…` approval id, a `WALKTHROUGH_GIT_COMMIT`, and repo identity
  against that SHA — minted by `tools/coupang-local/wing-walk-bootstrap.sh`, or per start by
  `tools/self-pilot/agent-supervisor.sh` for its own carriers.

### 1.2 Is that gate a product runtime contract, or a live-proof harness?
**A harness.** The canonical approval contract states it: `docs/sellerops_live_approval_contract.md` §3 —
"**The guided walk is the exception, and it is one by construction.** Its entrypoint is an installed launchd
service … there is no CLI-owned window to render a grant screen in — and none is needed: the walk begins when
the seller presses 시작 on the SellerOps screen, which is already a real press by a real person in a
SellerOps-owned surface." §6a adds that for browser READ carriers the change is "operational only — a
supervisor … mints the READ walk's environment ids so the operator does not run a bootstrap by hand". The
three ids are **environment-binding tokens, never credentials**, and nothing about them is seller-facing.
So: the ceremony belongs to *CLI-launched* WING runs (reveal, deletion, recorder, proof drivers), where
nobody pressed anything in a SellerOps surface. The product path's authorization is the seller's 시작 press.

### 1.3 The runtime gap
`--bridge-only` (#466) is the resident helper: pairing/health bridge, **no carrier**, no browser, no
marketplace env. So a seller with the resident helper paired asked for a guided walk and got no announcement
— the 4 s timeout, `no-announcement`. #467 then made that silent and dropped them into the text checklist. The
text flow is a correct fallback, but it had become the *only* reachable path for the resident-helper posture:
guided was reachable only by stopping the helper and starting a flag-selected carrier boot from a terminal —
exactly the CLI/env/carrier switching the product intent forbids.

### 1.4 Where #467 hid the guided UX
`CoupangIssuanceGuidedWalkthrough`: `guidanceImpossible = agentUnreachable || cannotPair || hostRefused` →
render the static text checklist. `hostRefused` includes `no-announcement`, which for a resident helper meant
"nobody hosts this walk **yet**" rather than "this machine cannot run it". The rule stays (it is the honest
fallback); what changed is that "yet" is now resolved by activating the carrier instead of by giving up.

### 1.5 One-agent-one-carrier / supervisor
Unchanged and not in conflict. The slot is still ONE carrier: the resident helper's slot holds an on-demand
host that owns at most one activated carrier at a time and refuses a second, different one while it is live
(`OTHER_CARRIER_ACTIVE`). `agent-supervisor.sh` and its `switch` are untouched; a flag-selected boot still
wins its own slot and still refuses to be combined with `--bridge-only`.

## 2. Design

| Need | Mechanism | Boundary |
|---|---|---|
| A tab can say WHICH carrier it wants | One optional wire message, client→agent, on the already-authenticated socket: `{type:"aw_attach", carrier, channelCode}` (`bridge-server.ts`, validated to a known `AwCarrierKind` + `^[a-z][a-z0-9_-]{0,31}$` before any endpoint sees it) | Additive: fixed-carrier agents ignore it; an older agent ignores unknown types; a transport that does not ask behaves byte-identically |
| The resident helper can host on demand | `bridge/on-demand-carrier-host.ts` occupies the single carrier slot: idle (announces nothing, holds nothing) → activates on a servable request → delegates every announce/payload to the REAL endpoint → releases back to idle | One carrier at a time; a second, different request is refused, not queued |
| Reuse the EXISTING guided walk | `activateCoupangGuidedWalk` (in `local-agent.ts`) assembles the same pieces the flag boot assembles: `buildCoupangIssuanceLiveConfig` (lazy real-WING driver, ONE landing navigation, `raiseSurface`, `returnToSellerOps`) + `ApiIssuanceEndpoint` + `CoupangIssuanceEngine` + `CoupangIssuanceGuidanceSession` | No new engine, driver, stage plan, copy, or capability. Nothing was rewritten |
| No browser at idle | Activation builds the carrier only; the window comes up on the session's FIRST driver call, i.e. after the seller's `START_RUN` (`LazyCoupangIssuanceDriver`) | Attaching opens nothing; a seller who opens the page and leaves opens no window |
| Back to idle afterwards | Release when no tab is attached AND (run settled AND window closed) → immediately; otherwise after a 15-minute grace from the last detach (settled-but-window-open = the seller is copying the secret key; not-settled = abandoned). Release closes the window and disposes the session | A completion screen with a live "쿠팡 윙 키 화면 다시 보기" keeps its socket, so the window is never pulled out from under the seller |
| FE asks for its channel | `useGuidedIssuance(runtime, { channelCode })` → `connectIssuanceSession({ channelCode })` → `attachChannelCode` on the transport, sent on every socket (re)open | The announced `channelCode` still decides what the run IS; the request is only an ask |
| Guided stays primary | Unchanged fallback rule: text only when the walk is known impossible (no helper / pairing will not fix it / the paired helper cannot host it) | Text remains a complete way to issue the key |

**Why the ask lives on the socket and not in a new HTTP endpoint:** the socket is already authenticated
(origin allow-list + single-use ticket + pairing), already carries the opaque `{type:"aw"}` frames, and is the
exact channel whose `aw_session` answer the request is about. A second endpoint would need its own auth and
could not be answered by an announcement on this socket.

## 3. What changed (files)

Collector:
- **new** `src/bridge/on-demand-carrier-host.ts` — the idle→active→idle host (`OnDemandCarrierHost`,
  `ActivatedCarrier`).
- `src/bridge/aw-carrier.ts` — optional `onClientAttachRequest` + `AwAttachRequest`.
- `src/bridge/bridge-server.ts` — route + validate `aw_attach` (drops anything else, as before).
- `src/agent/agent-bridge.ts` — `carrierEndpoint` config (a prebuilt endpoint for the single slot), inside the
  same mutual-exclusion guard and precedence chain.
- `src/cli/local-agent.ts` — `activateCoupangGuidedWalk` (reuses `buildCoupangIssuanceLiveConfig`, which now
  also reports `isSurfaceOpen`); `runBridgeOnlyBoot` mounts the host, prints `onDemandCarriers`, and disposes
  an active carrier on shutdown; `BridgeOnlyBootHandle.carrierHost`.
- `src/cli/bridge-only-gate.ts` — wording only: `--bridge-only` refuses flag-selected carriers; its own carrier
  is the on-demand one.

Frontend:
- `src/lib/actionWindow/wsTransport.ts` — optional `attachChannelCode`; sends the request on socket open
  (including every reconnect).
- `src/lib/actionWindow/issuance/issuanceSession.ts` — optional `channelCode` passthrough.
- `src/lib/actionWindow/issuance/useGuidedIssuance.ts` — `{ channelCode }` option; a terminal run KEEPS the
  socket (the completion screen still raises the WING window, and an attached tab is what tells the helper the
  seller is still there) and starts no second run; teardown on unmount is unchanged.
- `CoupangIssuanceGuidedWalkthrough` / `CoupangRenewalGuidedWalkthrough` ask for `coupang`;
  `NaverIssuanceGuidedWalkthrough` asks for `naver`.

Two defects the FIRST live run exposed, fixed here (§4 has the proof):
- `useGuidedIssuance` released itself on StrictMode's simulated unmount, so `attach()` returned null forever and
  no socket was ever opened — the walk could not start at all. `releasedRef` is now cleared on every mount.
- A RELEASED session kept its own timers: `awaitSurface` polled `probeSurface()` once a second and the lazy
  driver re-opened the window the host had just closed. The session now has a `stopped` latch checked by every
  loop and every drive, `closeSurface` RETIRES the driver (`LazyCoupangIssuanceDriver.retire()` — no call may
  open a window again, unlike `markClosed`), and a fault raised by the teardown itself is not parked.
- And one UX defect: a walk the seller CANCELLED still rendered "쿠팡(윙) 창에서 화면 안내를 따라 진행하세요 ·
  0/8" beside "지금은 할 수 있는 동작이 없어요". `CANCELLED`/`FAILED` now hands over to the text checklist
  (`COMPLETED` keeps its completion + hand-off).

Regression: `test/bridge/on-demand-carrier-host.test.ts` (6), `test/agent/local-agent-bridge-only.test.ts`
(+2, incl. a REAL-socket boot proof: idle silence → `aw_attach` → announcement → `START_RUN` → walk →
release → idle → shutdown), `coupang-issuance-session.test.ts` (+2, the released-session loops),
`wing-issuance-flow-discovery.test.ts` (+1, release retires the driver), `issuanceSocket.coupang.test.ts` (+2),
`CoupangIssuanceGuidedWalkthrough.test.tsx` (+3), `useGuidedIssuance.test.tsx` (updated).
Collector 9000 passed / 150 skipped; frontend 2167 passed; both typecheck clean.

## 3a. Live proof (2026-08-19, this machine)

Resident helper: `npx tsx src/cli/local-agent.ts --bridge-only` (proof runs added `--dev-insecure-auto-approve`
so a fresh Playwright browser could pair without a TTY, and `SELLEROPS_AGENT_CARRIER_IDLE_GRACE_MS=20000` so the
release was observable; the resident helper was restored to the plain command afterwards). Boot line:
`{"mode":"BRIDGE_ONLY","ok":true,"port":47615,"browserLaunched":false,"marketplaceOpened":false,
"onDemandCarriers":["issuance/coupang"]}`.

| Step | Observed |
|---|---|
| idle, `/connect/coupang` open | helper Chrome processes: **0** — no browser for merely having the page open |
| 쿠팡 연결 안내 시작 → pairing | `aw_on_demand_carrier_activated {carrier:"issuance",channelCode:"coupang"}` |
| the walk starts | `aw_coupang_walk_landing {urlCategory:"wing_host"}` — the ONE landing navigation; the WING window is up |
| SellerOps screen | "쿠팡(윙) 창에서 화면 안내를 따라 진행하세요 · 0 / 8 단계 완료", 쿠팡 윙 창 앞으로 가져오기, 취소. **No** text fallback, **no** alert, **no** "실행할 수 없어요/준비하지 못했어요/찾지 못했어요", no literal `**` anywhere on the page |
| the seller leaves (tab closed) | `aw_on_demand_all_clients_detached` → after the grace `aw_on_demand_carrier_released {reason:"ABANDONED_GRACE_ELAPSED"}` → `aw_coupang_walk_surface_closed` → helper Chrome processes: **0**, and the window does not come back |
| a SECOND walk afterwards | activates again from idle; 취소 → `released {reason:"SETTLED_SURFACE_CLOSED"}` immediately once the tab left |

Nothing was clicked, typed, or submitted in WING; the window landed on the WING host page (the agent's profile
is not signed in to Coupang, so it showed WING's own login screen) and was closed by the release.

## 4. Operating it

Nothing new for the seller: run `npx tsx src/cli/local-agent.ts --bridge-only` once (or the supervisor), pair
from a SellerOps screen, then use `/connect/coupang` → **쿠팡 연결 안내 시작**. The helper stays idle until that
press, brings the WING window up on the walk's start, and returns to idle after it. No flag, no env, no
`switch`.

`--dev-action-window-coupang-issuance` (fixture) and `--action-window-coupang-issuance-live` (flag-selected,
gated) still exist for CLI proofs and are unchanged.

## 5. Safety — what did NOT move
- **WRITE is untouched.** This is a READ-only guidance walk: the runtime never logs in, clicks, types,
  submits, issues a key, or reads a value. Marketplace WRITE still needs its own fresh, single-use, mode-`WRITE`
  approval (`docs/sellerops_live_approval_contract.md` §3, §6a); `CoupangLiveCallGuard.ensureLiveWriteAllowed`
  has no parameter that any of this can supply.
- **Exactly one agent navigation**, the WING landing, at window open, never again — the property
  `buildCoupangIssuanceLiveConfig` already owned, reused verbatim.
- **Pairing is unchanged**: origin allow-list, single-use ticket, human-approved pairing. `aw_attach` is only
  reachable on a socket that already passed all three.
- **Sanitized output**: the new log events carry a carrier kind, a channel code, counts, and a release reason —
  no URL, no page content, no identity.
- The CLI ceremony (phase + approval id + repo identity) still gates every **CLI-launched** WING run. It does
  not gate the product path, which is authorized by the seller's own 시작 press in a SellerOps-owned surface —
  the exception §3 already states. Recorded here because the on-demand host is the first thing that reaches the
  real WING driver without a flag.

## 5a. v1.1 — the NAVER API-center walk on the same resident helper (2026-08-19)

The Coupang walk was the first carrier through the on-demand seam; it was not the only one that had lost its
runtime. `/connect/naver`'s guided walkthrough already sent `{type:"aw_attach", carrier:"issuance",
channelCode:"naver"}` — the FE has been channel-parameterised since this unit's first commit — and the resident
helper's activator only knew `issuance`/`coupang`, so the host refused `NOT_SERVABLE` and the screen sat on
"도우미는 연결됐지만 안내 실행을 준비하지 못했어요". Everything behind it existed: `NaverIssuanceDriver`, the
`IssuanceEngine`/`IssuanceGuidanceSession` pair, and four fixed-label locators live-measured at
`matchCount === 1` on the real API center. The ONLY agent that ever mounted them was
`run-api-issuance-live-naver.ts`, behind an operator-owned `NAVER_API_CENTER_URL` a seller cannot set.

What was added is plumbing, not capability:

- `LazyNaverIssuanceDriver` (`api-issuance/lazy-naver-issuance-driver.ts`) — the sibling of
  `LazyCoupangIssuanceDriver`, same shape and same two properties (one launch shared by concurrent first
  calls; a window the seller closed is forgotten). `retire()` for release.
- `buildNaverIssuanceLiveConfig()` + `activateNaverGuidedWalk()` in `local-agent.ts` — the same assembly the
  live entrypoint performs. The landing is `NAVER_API_CENTER_GUIDED_WALK_LANDING_URL`, which is the SAME URL
  the product's own text checklist opens (`frontend/src/lib/guidedConnection/tutorial.ts`), pinned equal by
  test so guided and text cannot drift apart about where the seller goes. One navigation per carrier,
  `screenApiCenterUrl`-screened before it is used.
- `RESIDENT_CARRIER_ACTIVATORS` / `activateResidentCarrier()` — the activator is now a LIST tried in turn, so
  the boot knows no channel name. `onDemandCarriers` prints `["issuance/coupang","issuance/naver"]`.
- `IssuanceGuidanceSession` gained the `stopped` latch the Coupang session got after a released walk re-opened
  the window it had just closed. This session's `watchBarrier` has the same re-arm shape, so it got the same
  latch before the same thing could be observed here. Both sessions' detached barrier watchers now catch — a
  driver retired mid-await would otherwise reject a floating promise.
- `NaverIssuanceGuidedWalkthrough` — a CANCELLED/FAILED walk hands over to the text checklist. It previously
  kept the timeline on screen beside an empty control panel: a step count with nothing to press. Same dead end
  the Coupang sibling had, same fix. COMPLETED is untouched (it has its own credential hand-off).

Live proof, one resident helper, both walks in sequence (see §3a for the Coupang cycle's shape):

```
BRIDGE_ONLY … onDemandCarriers:["issuance/coupang","issuance/naver"]   0 walk browsers
/connect/naver → "네이버 연결 안내 시작"
  aw_on_demand_carrier_activated {carrier:issuance, channelCode:naver}
  aw_issuance_walk_landing        {urlCategory:api_center_host}
  aw_issuance_probe               {pageCategory:app_list, ok:true}
  SellerOps: 진행 단계 0/7 · step-1 copy · [취소]      (no text fallback, no refusal notice)
  취소 → "화면 안내를 끝냈어요. 아래에서 텍스트 안내로 계속 진행하실 수 있습니다." + [텍스트로 직접 진행하기]
  tab closed → aw_on_demand_carrier_released {SETTLED_GRACE_ELAPSED} → aw_issuance_walk_surface_closed → 0 browsers
/connect/coupang → "쿠팡 연결 안내 시작"   (the SAME helper, no restart, no flag, no env)
  aw_on_demand_carrier_activated {carrier:issuance, channelCode:coupang}
  aw_coupang_walk_landing         {urlCategory:wing_host}
  SellerOps: 0 / 8 단계 완료 · [쿠팡 윙 창 앞으로 가져오기] · [취소]
  → aw_on_demand_carrier_released {SETTLED_SURFACE_CLOSED} → aw_coupang_walk_surface_closed → 0 browsers
```

Zero marketplace clicks, types, submissions or key issuances on either walk; one screened navigation each.

## 6. Known gaps (recorded, not hidden)
- `issuance`/`coupang` and `issuance`/`naver` are servable on demand. NAVER review import and Coupang review
  locate still need their own boots — see `docs/channel_integration_completeness_audit_v1.md` §3 for why each
  is a product-owner decision rather than a missing line of wiring; the seam (`activate`) is where they go.
- A resident helper that is already hosting a walk refuses a *different* carrier request rather than queueing
  it; the asking tab falls back exactly as it does against a fixed-carrier agent of the other kind.
- The release grace is time-based (15 min, ops-overridable with `SELLEROPS_AGENT_CARRIER_IDLE_GRACE_MS` —
  clamped to 5 s–2 h, used by the live proof so the idle→guided→idle cycle is observable) for the
  "window still open, no tab" case. A seller who closes the
  SellerOps tab but keeps WING open keeps the window that long; closing WING releases immediately.
- The guided walk still needs the seller to log in to WING themselves, and every WING control is theirs.
