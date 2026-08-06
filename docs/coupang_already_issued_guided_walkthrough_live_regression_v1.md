# Coupang Already-Issued Guided Walkthrough — Live Regression v1 (BLOCKED)

> **Status: BLOCKED** — partial live evidence, then a genuine live-wiring blocker. 2026-08-06/07 @ main
> `7301eed`. Observe-only, fresh single-use grant `apr-c00e52f0f093` / walkthroughRun `run-502afae3b5e8`.
> **Zero secret/DOM/PII read, zero 발급/재발급/삭제 click, no product-code change, no migration.** Live env
> torn down; the full FE-driven guided walkthrough was **not** driven live (blocker below).

## What this attempt set out to prove

On real WING (already-issued account), the **full FE-driven guided walkthrough**: SellerOps `/connect/coupang`
(walkthrough-bound) start → Local Agent opens WING → login/navigation → Open API page → `open_api_issuance`
classification → already-issued detection → return to the masked credential step — with recovery checks
(refresh/reconnect/stale-fail-closed/target-refind/text-fallback/no-dup).

## LIVE-VERIFIED (this attempt, on main 7301eed)

1. **walkthroughRun binding (FE ↔ backend)** — the disposable env (backend `:18091` walkthrough/COUPANG/
   scheduler-off/pristine DB `coupang_regression`, FE `:5173` walkthrough) bound to `run-502afae3b5e8`.
   `GET /api/walkthrough/context` → `channelCode: COUPANG`, `connectorEnabled: true`, run id, git `7301eed`;
   handshake **matched** on the run + origin and **failed closed** on a stale run. (Re-confirms #402's
   binding on the merged main.)
2. **Agent-side hosting** — the gated live entry (`--i-understand-this-opens-live-coupang-wing`) opened WING
   in headed Chrome and **hosted the Coupang issuance Action Window run** (`run_023726e9ba38`, `channelCode:
   coupang`) over the bridge (`127.0.0.1:47615`). Sanitized log only (no value/DOM/PII); no click; no
   navigation driven.

## BLOCKER — the full guided walkthrough could not be driven live

Driving the agent-hosted guided run requires a **driver** connected to the agent bridge, and neither path is
wired for Coupang:

- **Frontend browser path** — the FE reaches the agent bridge only through a **pairing bootstrap** (a
  long-lived `sellerops_bridge_token` in browser localStorage) + Chrome's **Local Network Access** permission,
  and the agent bridge listens on a **random port** (`47615` this run) the fresh FE cannot discover. No paired
  token, no port alignment, no permission were established — so the FE goes dormant (agent-unavailable) rather
  than hosting the run.
- **Bridge-client path** — NAVER has a bridge-CLIENT live-proof driver (`collector/src/cli/issuance-live-proof.ts`)
  that drives an issuance run like the FE (`START_RUN` + `REQUEST_STEP_RECHECK`) over the bridge, needing no
  browser pairing. **Coupang has no equivalent.** Building one is a code change, which under the live-approval
  contract revokes the in-run grant — so it cannot be done inside this observe-only run.

This is consistent with #402's canonical scope
([`coupang_guided_issuance_credential_lifecycle_scope_v1.md`](./coupang_guided_issuance_credential_lifecycle_scope_v1.md)),
which lists **"the full FE-driven real-WING guided walkthrough"** as **SYNTHETIC-ONLY** — its live path was
never wired.

## Honest scope after this attempt

- **NOT live-proven this attempt:** the already-issued end-to-end guided walkthrough (start → highlight → detect
  → return) — the run was hosted but not driven.
- Already-issued **page classification** (`open_api_issuance` via the credential-region anchor) was live-proven
  earlier via the read-only recorder ([`coupang_wing_live_calibration_v1.md`](./coupang_wing_live_calibration_v1.md)),
  not via the guided walkthrough.
- The **unissued form** (자체개발 / 업체명 / 호출 IP / first-issuance checkpoint) remains **SYNTHETIC-ONLY**
  (no unissued account available).

## Proposed follow-up (separate feature branch)

**`Coupang Guided Walkthrough Live Bridge Wiring v1`** — wire a driver for the agent-hosted Coupang issuance run
so the full guided walkthrough can be driven + live-proven, WITHOUT relaxing any safety fence:
- Build `collector/src/cli/coupang-issuance-live-proof.ts` — a Coupang bridge-CLIENT live-proof driver mirroring
  NAVER's `issuance-live-proof.ts` (adopts the hosted run; sends ONLY `START_RUN` + `REQUEST_STEP_RECHECK`;
  prints sanitized frames; never touches WING / reads a value; gated + inert-on-import), and/or establish the
  FE↔agent bridge pairing + a discoverable/pinned bridge port for Coupang walkthrough mode.
- Then re-run this already-issued live regression to prove the end-to-end guided walkthrough + the recovery
  checks. The unissued path stays synthetic-only until a real unissued account is available.

That work is a code change (a new gated CLI), so it needs its own branch, its own tests, and — for the live
re-run — a fresh bootstrap + a fresh `Seated and ready.` grant.
