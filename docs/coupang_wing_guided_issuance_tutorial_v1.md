# Coupang WING Guided Issuance Tutorial v1

> **Status:** Implemented (cross-stack: collector + frontend), **offline-synthetic-verified**. No live WING
> operation in this unit; no contract change; no migration.
>
> A first-time Coupang seller starts the connection in SellerOps, the **Local Agent opens the real Coupang
> WING in Chrome and highlights each step** (observe-and-annotate — the seller performs every real action),
> issues the Open API key themselves, returns to SellerOps to paste it into a masked form, and the existing
> connection test → PREPARING → first `ORDER_SUMMARY` sync → CONNECTED → Operations flow completes it.
>
> Supersedes the text-only approach of PR #401 (its server-authoritative recovery, PREPARING/CONNECTED UI,
> first-sync CTA+poller, per-reason recovery, Operations nav, and a11y are **carried over** as the base).

## Shape: agent-hosted Action Window run, zero contract change

The walkthrough is an **Action Window `API_ISSUANCE_GUIDANCE` run** — the same channel-agnostic runtime,
carrier, transport, and sanitized view the NAVER issuance walkthrough uses. Coupang needed **no contract
change**: the intent is already channel-neutral, so it rides `channelCode: "coupang"` (a free sanitized
string) with new copyKeys/stepIds/`targetKind` values (all FE/agent-owned free strings — `CopyParams` is
`Record<string, CopyParamValue>`, not an enum), reusing every v2 enum. WING's flow is **linear**, so it
never emits `appBranch` (no NAVER-style existing/new-app branch).

### The pinned 7-step WING plan (collector emits ⇄ frontend consumes — verified identical)

| # | stepId | copyKey | targetKind | what the seller does |
|---|--------|---------|-----------|----------------------|
| 1 | `aw.coupang_issuance_reach_open_api` | `…coupangIssuance.reachOpenApi` | — (auto) | navigate WING to 오픈API 키 발급 |
| 2 | `aw.coupang_issuance_self_dev` | `…coupangIssuance.selfDev` | `self_dev` | choose **자체개발** |
| 3 | `aw.coupang_issuance_vendor_info` | `…coupangIssuance.vendorInfo` | `vendor_info` | enter 업체명 / URL (safe-copy values) |
| 4 | `aw.coupang_issuance_call_ip` | `…coupangIssuance.callIp` | `call_ip` | register the advertised 호출 IP |
| 5 | `aw.coupang_issuance_issue_checkpoint` | `…coupangIssuance.issueCheckpoint` | `issue` | **explicit human checkpoint** — the seller clicks 발급 |
| 6 | `aw.coupang_issuance_copy_keys` | `…coupangIssuance.copyKeys` | `credentials` | copy Access Key / Secret Key / 업체코드 |
| 7 | `aw.coupang_issuance_return` | `…coupangIssuance.return` | `return` | return to SellerOps' masked form |

`runCopyKey = actionWindow.coupangIssuance.run`. All eight keys exist in the FE `COPY` (timeline labels) +
`ISSUANCE_STEP_DETAIL` (full prose) maps.

## Security — secret access is 0 by construction

- **The driver interface has no login/click/type/submit/issue/read-value method.** `CoupangIssuanceProbeDriver`
  can only probe a sanitized page category, locate/highlight a semantic target read-only, arm/observe the
  seller's own action, and clean up. There is no method that could press 발급 or read a key — the guarantee is
  the interface shape, not discipline.
- **No credential value is ever read.** Access Key / Secret Key / 업체코드(Vendor ID) values are never touched
  on any path (no `.inputValue`/`.value`/`.textContent`/`.getAttribute`/`clipboard`/`.screenshot`/`page.content`).
  The `credentials` step highlights the *region* so the seller copies each value themselves.
- **Only opaque 16-hex signatures cross the wire** as `targetRef`; the census is value-free (counts/booleans).
  A raw value can never become a `targetRef` — the engine parks `target_not_found` instead of emitting it.
- **Source-guard tests enforce this**: the pure `coupang-issuance/` tree forbids `.evaluate`/`.click`/`.fill`/
  `.type`/`.press`/`.selectOption`/`.check`/`.submit` and every value-read token; the live driver additionally
  forbids `.goto`/navigation while allowing `.evaluate`+overlay; and a test asserts the interface has no
  read-value/click method (secret-access = 0, structurally).
- **No auto-issue / auto-submit / auto-click.** The `issue` step (`checkpoint_before_issue`) highlights the 발급
  button, **arms no observer**, treats an observed action on it as a no-op, and advances only on the operator's
  own 다음 (`REQUEST_STEP_RECHECK`). The agent never performs a destructive/write action.
- **Live WING is inert this unit.** `coupang-wing-issuance-driver.ts` and `cli/run-coupang-wing-issuance-live.ts`
  are gated by the live-run-approval flag, `main()` is inert on import, and no test runs them. WING selectors are
  proposed fixed-label candidates marked `LIVE_DOM_CALIBRATION_PENDING` — never claimed calibrated.
- Contract, backend, and the NAVER issuance path are **untouched**; `agent-bridge.ts` gains only an additive,
  mutually-exclusive `coupangIssuance` carrier slot (NAVER's path byte-identical).

## Collector runtime (`collector/src/action-window/coupang-issuance/`)

An isolated sibling of the NAVER issuance runtime (the idiomatic fork pattern):
- `coupang-issuance-stages.ts` — the 14-stage machine, barrier/park/terminal sets, the fixed 7-step plan, the
  v2 enum mappings, and `allowedCommands` (never a click/submit/read command).
- `coupang-issuance-driver.ts` — the secret-safe `CoupangIssuanceProbeDriver` interface + semantic targets +
  checkpoint/transition sets.
- `coupang-issuance-engine.ts` — the pure linear reducer: `reach_open_api` is a transition-observe target
  (WING home → issuance page), everything after is a same-page viewport checkpoint; 16-hex `targetRef` gate;
  `view()` emits `channelCode:"coupang"`, the intent, the plan copyKeys, `allowedCommands`, progress, blocker.
- `coupang-issuance-session.ts` — the async supervisor over the v2 transport (batched locate→highlight guide).
- `coupang-issuance-fixture-driver.ts` — the **offline scripted driver** that validates the whole walk with no
  browser (page categories, per-target locate/highlight/action, and locate/highlight throws to model a
  navigation race).
- `cli/coupang-wing-classifier.ts` — the value-free WING page classifier (`login | wing_home | open_api_issuance
  | credential_shown | unknown`), URL→host enum, never logging a raw URL.
- `coupang-wing-issuance-driver.ts` + `cli/run-coupang-wing-issuance-live.ts` — the gated, never-run live scaffold.

## Frontend (`frontend/`)

- `components/coupang/CoupangIssuanceGuidedWalkthrough.tsx` — hosts the Action Window run via the shared
  channel-agnostic issuance stack (`useGuidedIssuance`/`issuanceRuntime`/`issuanceSession`), rendering the shared
  `OperationRunTimeline` + `ActionWindowControlPanel` + `BlockerNotice` + `issuanceStepDetail(copyKey)`. Controls
  render **only** from `run.allowedCommands` (`REQUEST_STEP_RECHECK`, `CANCEL_RUN`); `channelCode` comes from the
  agent announcement, never faked. Offline-testable via `run`/`hostRuntime` prop seams.
- `lib/coupangTutorial.ts` — extended with an `issuance` phase: a fresh seller (`resolvePhase` → `issuance`) walks
  the guided issuance first; `ISSUANCE_DONE` transitions to the unchanged PR #401 `connect` → PREPARING → first
  sync → CONNECTED → Operations. **Already-issued sellers skip issuance** — any credential-on-file / PREPARING /
  CONNECTED account lands past it (server-authoritative recovery).
- `components/coupang/CoupangIssuanceTutorial.tsx` — the **text fallback** (agent-unavailable or seller choice):
  opens WING in a new tab (`window.open(url, "_blank", "noopener,noreferrer")` — the FE never scripts the page),
  checkbox progress, the advertised call-IP panel at the register-IP step. Agent env is classified by the reused
  `classifyAgentEnv` + `AgentEnvNotice` (NOT_RUNNING / SESSION_MISMATCH / HOST_UNAVAILABLE).
- `pages/ConnectCoupang.tsx` — renders the walkthrough in the `issuance` phase, then the existing #401 tutorial;
  single-flight guards + no account/sync duplication intact.
- `lib/actionWindow/copy.ts`, `lib/guidedConnection/tutorial.ts`, `components/guidedConnection/SecureCredentialForm.tsx`
  (`heading`/`idPrefix` params, NAVER defaults preserved) — additive.

## Recovery

- **Agent not running** → `AgentEnvNotice` guidance + the manual text path (issuance always completable).
- **Target not found / page mismatch / login** → the agent parks recoverably; a 다음 re-probes or re-guides in
  place; the FE offers the per-step text fallback. Never `RUN_FAILED`.
- **Refresh / close** → server-authoritative (`resolvePhase`); the hosted run reattaches idempotently, never
  re-triggers; a sync already RUNNING is resumed by observation.

## Verification

- **Collector:** `tsc` clean (incl. the cross-stack tsconfig). Coupang slice **316 tests / 6 files** (guards
  168) green; full collector suite **6670 tests** green; NAVER bridge + issuance **1053 tests** unaffected by the
  additive bridge slot. Offline fixture-driven tests prove the full walk, target **re-find after a navigation
  race**, each recovery park, and that the `issue` checkpoint never auto-advances.
- **Frontend:** `tsc` clean; full suite **1806 tests / 127 files** green, including the issuance-first journey,
  already-issued skip, the credential→PREPARING→first-sync→CONNECTED→Operations flow, and axe a11y scans across
  the issuance + connect states.
- **Boundaries:** contract, backend, and NAVER issuance files unchanged.

## Deferred (out of scope this unit)

- **Live WING calibration + a live guided-issuance proof** (the driver's fixed-label selectors are
  calibration-pending; the live CLI is gated and never run here).
- **The walkthroughRun disposable-run *backend* binding for Coupang** (`WalkthroughContextView` Coupang baseline,
  a Coupang `expectedWalkthroughUrl`) — needed only for a live disposable-run proof, which this unit forbids.

Both are future live-proof units; nothing in this slice performs or enables a live Coupang WING operation.
