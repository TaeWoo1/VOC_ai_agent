# Self-Pilot Runtime v1 — audit, design, implementation (2026-08-18)

> **What this is.** The record of one unit of work — audit → design → implementation → regression → docs —
> that turns the assembled product (A1–A7) into something the product owner can run on their own
> NAVER / Coupang / Cafe24 accounts **for days**, opening only the SellerOps UI in the normal state.
> Product-owner decision, 2026-08-18: *READ / collection / AI triage as automatic as possible; marketplace
> WRITE keeps its explicit approval; no CLI / approval id in the normal state; auth/session expiry is a
> RECONNECT_REQUIRED task, not an error.* Scope-lock consequence: `docs/product-scope-v1.md` v1.9;
> approval consequence: `docs/sellerops_live_approval_contract.md` §6a. This document owns the runtime's
> design and its honest state; it does not restate either canon.
>
> Safety fences unchanged (`CLAUDE.md`): the seller performs every marketplace click; no auto
> export/download/submit; no auth bypass; sanitized output only. **The WRITE boundary is not relaxed
> anywhere in this unit** — see §6.

## 1. Audit — what the code did before this unit

Facts re-derived from the tree at `987b34bf` (paths are current; line numbers may drift).

### 1.1 Which routine work was already schedulable
- A real scheduler existed and was **off by default**: `SyncScheduler` (`sellerops.collect.scheduler-enabled`,
  fixed-delay tick, batch 20) → `SyncScheduleClaimer` (`FOR UPDATE SKIP LOCKED`, at-most-once per tick) →
  `SyncScheduleRunner` (cadence / rate-limit / bounded backoff 1-5-25 min / DEGRADED at 3 failures + alert
  row) → `SyncRunExecutor` (the same path as 지금 수집하기 and 기간 backfill; `SyncRunGate` single-flight per
  (account, type); per-page cursor persistence; per-row ingest with DB-backed dedupe).
- Schedules were rows in `sync_schedules`, created **only** by an operator through `PUT
  /api/seller-accounts/{id}/schedule` (FE: 채널 상세 → 수집 설정 rows). Nothing created one on connect, so an
  account with no row was never polled.
- Per channel, what a schedule *could* run (real connector, `PullConnector.capabilities`): NAVER
  ORDER_SUMMARY; Coupang INQUIRY + ORDER_SUMMARY; Cafe24 REVIEW (board 4) + INQUIRY (board 6) +
  ORDER_SUMMARY. NAVER REVIEW (agent import) and Coupang REVIEW (WING walk) are Action-Window paths —
  seller-clicked, not connector-served, correctly **not** schedulable.
- Cafe24 refresh-token rotation was already automatic and single-use-safe (`Cafe24Authorizer`).

### 1.2 Which READ work was tied to a live-proof approval
- **Coupang official-API READ** (orders, inquiries, both connect-probes) shared one choke point with the
  WRITE (inquiry reply POST): `CoupangLiveCallGuard.ensureLiveCallAllowed`, opened only by a per-run
  `SELLEROPS_CONNECTOR_COUPANG_LIVE_APPROVAL_ID` (validated as *non-blank only*), minted per run by
  `tools/coupang-local/bootstrap.sh`. A missing id inside a sync surfaced as a generic FAILED run that
  **counted toward DEGRADED**.
- **Browser READ carriers** (NAVER import, Coupang WING review acquisition / locate) each carry a two-flag
  CLI gate + (Coupang) a phase-bound manifest + repo-identity check + an in-browser grant press. The
  bootstrap/preflight/one-liner ceremony was per run.
- Cafe24 API READ had **no** code interlock (only the connector flag) — an asymmetry the docs audit
  flagged; unchanged here (documented, §7).

### 1.3 Where one-agent-one-carrier blocked routine operation
- The agent hosts exactly one carrier, enforced three ways (`local-agent.ts` precedence chain,
  `agent-bridge.ts` throw, `import-mode-gate.ts` conflict list). Every carrier binds the same bridge port
  (47615), and the FE has one `VITE_BRIDGE_URL`. So a NAVER-import agent and a Coupang-locate CLI cannot
  be resident together; the honest routine shape is **process-level switching**, not in-process routing.
- Bugs found: `OTHER_CARRIER_FLAGS` omitted four carriers (import silently won over
  `--action-window-coupang-issuance-live` etc.); `hostsBridgeCarrier` omitted `reviewLocate` (a locate-only
  agent exited right after boot); `run-coupang-review-locate-live.ts` ignored `listen.ok` (hosted nothing
  while printing "hosted" when the port was held).
- The agent has **no poll loop, no lease, no backend registration**: work is pushed from the seller's
  browser tab over loopback (`START_RUN` with a single-use launch ref); the backend has no idea an agent
  exists. Import restart recovery ABANDONS (by design — a launch ref at rest would be a credential).

### 1.4 Long-run recovery gaps
- **Channel auth expiry** during a scheduled sync never moved the account to `RECONNECT_REQUIRED` — only
  `POST /test-connection` did. It bumped `consecutive_failures` → `DEGRADED` + a generic 반복 실패 alert
  while the card still read 연결됨, and the schedule kept spending ticks on a dead credential. Cafe24
  `invalid_grant` had no lifecycle hook at all.
- **SellerOps session expiry** (JWT 12h) mid-day: no response interceptor; every `*Strict` read rejected and
  each screen printed its own "불러오지 못했습니다" — the 2026-07-26 failure, fixed for boot only.
- **Agent crash**: no `unhandledRejection` / `uncaughtException` handler; recovery was launchd's 10 s
  throttle (and the launchd plan pins `NODE_ENV=production`, under which the import carrier is refused).
  Long-lived-token CLIs (locate/acquire) hold a 12 h JWT with no 401 branch.
- Home 확인이 필요한 연결 already listed `RECONNECT_REQUIRED` accounts + open alerts; the connect hub already
  owned the word 재연결 필요 and the verb 다시 연결하기 (IA §4a/§4b — nothing new to add on the surface).

## 2. Design (minimal, all inside the frozen IA)

| Need | Mechanism | Boundary |
|---|---|---|
| Safe READ scheduler | Turn the existing scheduler on (`SELLEROPS_COLLECT_SCHEDULER_ENABLED=true`) and add a **reconciler** that creates the missing per-type schedule rows for CONNECTED accounts of the self-pilot org(s) — real connector only, never the mock; existing rows are the operator's and never touched | Nothing new runs that a 수집 설정 row could not already run |
| Read-only approval friction | **Standing READ grant** (`SELLEROPS_SELF_PILOT_READ_GRANT_ID`, `spr-<hex>`, shape-validated at boot) opens the Coupang READ gate; the guard is split into `ensureLiveReadAllowed` / `ensureLiveWriteAllowed`; the write gate has no parameter for the grant | Approval contract §6a; WRITE untouched |
| Persistent agent | `tools/self-pilot/agent-supervisor.sh`: restart on crash (bounded backoff, crash-loop pause), boot-refusal codes not retried, `switch <carrier>` = stop + start, first pairing in the foreground; agent gets `unhandledRejection`/`uncaughtException` → sanitized log + exit 9 | Real Chrome, dev posture, pairing still human |
| Multi-carrier routing | Process-level: one resident carrier (`naver-import` default), `coupang-locate` on demand; the three carrier bugs fixed so refusals are loud | In-process registry deferred (§7) |
| Disconnect/reconnect surface | Typed `ConnectorAuthException` (Coupang 401, NAVER token 401/403) + Cafe24 `invalid_grant` classified in the executor → `SellerAccountReauthService.markReconnectRequired`: account → `RECONNECT_REQUIRED`, schedules paused with a reason, health `NEEDS_REAUTH`, one `AUTH_EXPIRED` alert; `onReconnected` on test-connection success / credential replace / Cafe24 completion resumes + closes. Missing approval id → config failure, no health tick. FE: 401 → clear token → `/login?expired=1` ("세션이 만료되었습니다") | Existing IA words; account status still owned by each channel's lifecycle |
| Bounded automatic AI triage | Same reconciler tick: per listed org with the pilot on, `perTick` per contract channel and `perDay` per KST day metered from immutable prediction rows | Pilot run already idempotent + single-flight; nothing classifies on import |
| Restart / resume / idempotency | Reconciler is stateless (re-derived from DB every tick); schedules claim at-most-once; sync gate reclaims orphans; ingest dedupes by DB index; triage budget in DB; agent import abandons + server re-mints; supervisor state = pid/carrier files only | — |

## 3. What changed (files)

Backend (`backend/`):
- `selfpilot/SelfPilotProperties` (env → validated config), `selfpilot/SelfPilotReconciler` (+ `SelfPilotScheduler`),
  `selfpilot/SellerAccountReauthService`; `application.yml` `sellerops.self-pilot.*`.
- `connector/ConnectorAuthException`; throw sites: `CoupangOrdersClient.getOrdersheets` (401),
  `CoupangInquiriesClient.getInquiries` (401), `NaverTokenClient.mint` (401/403).
- `CoupangLiveCallGuard.ensureLiveReadAllowed / ensureLiveWriteAllowed`; orders/inquiries clients take the
  standing grant (READ gate); `CoupangInquiryReplyClient.signedPost` → explicit WRITE gate;
  `CoupangConnectorConfiguration` wires `sellerops.self-pilot.read-grant-id`.
- `SyncRunExecutor`: classifies auth failure / missing approval after a run; reauth wiring.
- `CollectControlService`: `onReconnected` on verified test-connection and credential replace;
  `Cafe24OnboardingService.onConnected` hook wired in `Cafe24OnboardingConfiguration`.
- `TriagePredictionRepository.countByOrgIdAndPredictedAtGreaterThanEqual`.

Frontend (`frontend/`): `apiClient.ts` response interceptor + `SESSION_EXPIRED_PATH` + `isSessionExpiry`;
`Login.tsx` `?expired=1` notice.

Collector (`collector/`): crash handlers in `local-agent.ts`; `hostsBridgeCarrier` includes `reviewLocate`;
`OTHER_CARRIER_FLAGS` complete; `run-coupang-review-locate-live.ts` refuses on a held port (exit 8).

Tools: `tools/self-pilot/agent-supervisor.sh`, `mint-read-grant.sh`, `self-pilot.env.example`; `.gitignore`
`tools/self-pilot/.run/`.

Regression: `SelfPilotReconcilerTest` (11), `CoupangLiveCallGuardTest` (+4), `SyncRunExecutorTest` (+6),
`apiClient.session.test.ts` (+2), `import-mode-gate.test.ts` (+1); the affected backend packages (1003
tests), full FE and collector suites green at the time of writing.

## 4. Operating it (names only — values are the operator's)

Backend `.env.local` (restart after editing; a long-lived `bootRun` is a version pin):
`SELLEROPS_SELF_PILOT_ENABLED=true` · `SELLEROPS_SELF_PILOT_ORG_IDS=<self-pilot org uuid>` ·
`SELLEROPS_SELF_PILOT_READ_GRANT_ID=<tools/self-pilot/mint-read-grant.sh>` ·
`SELLEROPS_COLLECT_SCHEDULER_ENABLED=true` · connectors + vault as in `demo_runbook_v1.md` §0.1 ·
optionally `SELLEROPS_SELF_PILOT_TRIAGE_AUTO_ENABLED=true` (with the AI pilot env for the same org).
Nothing else changes for channel 1–3 connection: the seller connects in the UI; the reconciler creates
the schedules within 5 minutes of an account becoming CONNECTED; the collect scheduler runs them.

Local agent: `tools/self-pilot/.run/self-pilot.env` from the example (self-pilot org credentials, URLs) →
`tools/self-pilot/agent-supervisor.sh start` (foreground the first time: pair from `/connect/review-history`
도우미 연결하기 with the code on that terminal) → later `start -d`; `switch coupang-locate` for
`[쿠팡에서 보기]`, `switch naver-import` back; `status` / `stop` / `logs`.

What still needs the seller's hands (by contract, not by omission): logging into NAVER / WING in the agent's
Chrome; every export click / page turn; the in-browser grant press for a Coupang walk; the Coupang review
**acquisition** walk (`acquire-coupang-reviews.ts`) which remains a bootstrap+preflight run — no schedule
can perform it.

## 5. Recovery matrix (what the seller sees, what happens underneath)

| Event | Underneath | Surface |
|---|---|---|
| Channel credential/token rejected during a scheduled sync | run FAILED with the typed reason; account `RECONNECT_REQUIRED`; schedules paused (reason shown on the row); health `NEEDS_REAUTH`; one `AUTH_EXPIRED` alert | 홈 확인이 필요한 연결 lists the channel (→ `/connect`) and the alert; hub says 재연결 필요 / 다시 연결하기 |
| Seller reconnects (test-connection success / renew / Cafe24 re-consent) | schedules resume due-now; alert closed; health CONNECTED; account status by the channel's own lifecycle | next collect tick collects |
| SellerOps session (JWT) expires | 401 → token cleared → `/login?expired=1` | "세션이 만료되었습니다 … 하던 자리로 이어집니다" |
| Agent crash / unhandled rejection | exit 9 → supervisor restarts (backoff 5→60 s; 5 crashes/2 min → 60 s pause); pairing survives on disk | 도우미 dock: 다시 연결 중 → 연결됨 |
| Agent boot refusal (env / gate) | exit 2–8 → supervisor stops, logs the code | operator fixes env, `start` again |
| Missing read grant / approval on Coupang | run FAILED with the env names; **no** health tick, no DEGRADED | 수집 이력 shows the reason |
| Backend restart mid-tick | schedule claim at-most-once (skips one occurrence); orphan RUNNING reclaimed after 60 min; reconciler stateless | nothing to do |
| Duplicate ingest on re-run | DB unique indexes → skip counts | 저장 0 · 건너뜀 N |

## 6. WRITE boundary — unchanged, and now more explicit
- `CoupangLiveCallGuard.ensureLiveWriteAllowed(baseUrl, liveApprovalId)` has **no parameter** for the standing
  grant; `CoupangInquiryReplyClient.signedPost` calls it. Test pins it.
- The supervisor cannot select the reply-submission carrier; the reply live CLI keeps its own mode-WRITE flag.
- No scheduler, reconciler, or tick can reach a marketplace mutation. Marketplace WRITE still needs the product
  owner's explicit in-turn approval (`sellerops_live_approval_contract.md` §3).

## 7. Known gaps (recorded, not hidden)
- Cafe24 API READ has no backend interlock analogous to Coupang's (flag-only). Adding one would be a new fence,
  not a relaxation; deferred until the contract names it.
- In-process multi-carrier routing (one bridge, N carriers, per-`START_RUN` lookup) is not built; the port is
  the constraint. Coupang review acquisition stays a per-run bootstrapped CLI.
- Coupang locate/acquire CLIs hold one JWT for the process; a 401 mid-run still degrades to "no target".
- The reconciler is single-instance in spirit (schedules are, too); multi-instance safety relies on the
  existing `SKIP LOCKED` claim and the sync gate. A concurrent duplicate schedule insert is skipped (unique
  index holds); the per-day triage meter is read-then-spend, so two instances ticking together could exceed
  the day by up to one tick's worth — single-instance is exact.
- The standing READ grant is **process-scoped**: it arms the backend process only while
  `SELLEROPS_SELF_PILOT_ENABLED=true` (a leftover grant with the runtime off arms nothing — pinned by test),
  but within an enabled process it opens Coupang READs for any org's account on that backend;
  `SELLEROPS_SELF_PILOT_ORG_IDS` scopes what the reconciler/triage act on, not the gate. Correct for the
  one-operator local backend this runtime is for; a shared deployment would need an org-aware gate.
- Capability wording is unchanged: nothing here promotes any channel×type to 운영 지원 (roadmap §4.1); the
  self-pilot is the operator's own use, not a support claim.
