# Coupang First-Connection Tutorial + Guided Initial Sync v1

> **Status:** Implemented (frontend-only), offline-verified. A first-time Coupang seller completes the
> whole connection in the UI — API prep → credential → connection test → PREPARING → first order sync →
> CONNECTED → Operations — with no developer help, no backend change, and no live marketplace call in
> this slice.
>
> Scope: `frontend/**` + this doc. No product-code, migration, connector-logic, or status-enum change.
> Live proof of the underlying order path already exists:
> [`coupang_final_main_first_connection_order_routine_proof_v1.md`](./coupang_final_main_first_connection_order_routine_proof_v1.md).

## What shipped

`/connect/coupang` is now a **6-step guided tutorial** instead of a single prerequisites-plus-form page.

| step | surface | what the seller does |
| --- | --- | --- |
| 1 · API 키 발급 | guidance | Issue the WING Open API key; choose **자체개발** (self-developed) — no separate review |
| 2 · 발급 정보 확인 | guidance | Understand 업체 코드(Vendor ID) · Access Key · Secret Key · the calling IP to register |
| 3 · 연결 정보 입력 | action | Enter the masked credential → the connection test runs once |
| 4 · 첫 주문 불러오기 | action | **PREPARING** is explained; one CTA starts the first order sync |
| 5 · 수집 진행 | observation | Honest elapsed clock + terminal result (no fabricated percentage) |
| 6 · 연결 완료 | done | **CONNECTED**; entry points to 주문 보러 가기 / 연결 상태·수집 기록 보기 |

An always-visible, accessible stepper (`<nav><ol>` with `aria-current="step"` and an `sr-only`
live-region announcement) shows where the seller is.

## Design: server-authoritative, channel-agnostic, no new backend contract

The tutorial's phase is **derived from persisted state on every load**, not from localStorage. Three
existing, channel-agnostic reads carry it — no NAVER-locked `/connection-capability` endpoint (that one
404s for a Coupang account), and **no backend change was needed**:

- **`GET /api/seller-accounts`** → the account's two-signal `connectionStatus`
  (`PENDING → PREPARING → CONNECTED`). This is the backbone of the step decision.
- **`GET /api/seller-accounts/{id}/credentials`** → whether a credential is on file (404 → none).
- **`GET /api/sync-runs?sellerAccountId&dataType=ORDER_SUMMARY`** → the latest first-sync outcome.

`resolvePhase()` (pure) maps those facts to the landing step:

- no account / no credential → **connect** (steps 1–3)
- credential on file but not PREPARING → **connect_error** (re-verify or re-enter; no invented reason)
- PREPARING + no run → **preparing** (the first-sync CTA)
- PREPARING + a RUNNING run → **syncing** — *resume observing the same run, never re-trigger it*
- PREPARING + a FAILED run → **sync_error** (retry)
- CONNECTED → **connected**

So a refresh or a return-after-leaving re-lands on the correct step, and an existing account is continued
in place (no duplicate account — the account is created lazily only on an explicit credential submit).

## Honesty & safety

- **PREPARING ≠ CONNECTED.** A passing connection test lands on PREPARING and says so; only the first
  completed order sync flips the account to CONNECTED. The first sync is an **explicit** single CTA — it
  never auto-starts (differs deliberately from the NAVER wizard).
- **The internal test fallback is never surfaced.** The backend confirms a connection via
  `returnShippingCenters` → `ordersheets` (a 400 → 200 fallback); it hides that behind sanitized reason
  codes. The UI renders only those codes and never shows `returnShippingCenters`, `ordersheets`, or a raw
  `400`.
- **Per-reason recovery.** Each connection-test `reasonCode` maps to actionable guidance:
  `INVALID_CREDENTIAL` (re-enter the key), `CALL_ENVIRONMENT_MISMATCH` (register the shown calling IP,
  then re-verify), `ORDER_ACCESS_DENIED` (check order-API permission + calling IP), `PROVIDER_UNAVAILABLE`
  (transient — retry). An unknown/absent code → a safe generic recovery. Re-verify reruns the test on the
  **stored** credential (no secret re-entry, no second account).
- **No fabricated calling IP.** The advertised IP comes only from `GET /api/connect/coupang/setup`; an
  empty value shows generic guidance, never a made-up IP (shared `AdvertisedCallIpPanel`).
- **Secrets never linger.** The keys flow straight from the form to `storeCredential`; they never enter
  component/engine state, an event, or storage, and the inputs clear on submit.
- **No duplicate run.** A synchronous single-flight guard (`inFlightRef`) plus not rendering any trigger
  during an active sync watch closes the client double-fire window; the backend single-flight is the real
  enforcement. A cut long-held sync request is disambiguated by re-reading the run list before failing.

## Files

- `frontend/src/lib/coupangTutorial.ts` — pure engine: phases, reducer, `resolvePhase`, `syncStatusFromRun`,
  `latestOrderRun`, step model, reason-code recovery copy. No React, no I/O.
- `frontend/src/components/coupang/CoupangConnectTutorial.tsx` — controlled, offline-testable presentation
  (stepper + per-phase bodies + honest sync progress).
- `frontend/src/pages/ConnectCoupang.tsx` — thin container: reads, guarded actions, polling, recovery.
- `frontend/src/components/guidedConnection/SecureCredentialForm.tsx` — parameterized `heading` / `idPrefix`
  (backward-compatible; NAVER unchanged) so the Coupang form reads correctly.

## Verification

- `coupangTutorial.test.ts` (25) — reducer transitions, `resolvePhase` for every state, sync-status
  mapping, latest-run selection, step model, reason-code recovery (incl. a guard that no recovery copy
  leaks the internal fallback).
- `ConnectCoupang.test.tsx` (14) — prereq + stepper + advertised IP; lazy create → store → test → PREPARING
  (not completed, no auto-sync); **full offline E2E** connect → PREPARING → first sync → CONNECTED →
  Operations; refresh recovery for PREPARING(no run) / PREPARING(RUNNING, no re-trigger) / CONNECTED /
  credential-present-PENDING; per-reason recovery; no `returnShippingCenters`/`400` exposure; sync retry
  fires exactly one new run; fake-timer poller resume → SUCCESS and keeps-observing-while-RUNNING.
- `CoupangConnectTutorial.a11y.test.tsx` (7) — axe scans across connect / connect_error / preparing /
  syncing / stalled / sync_error / connected.
- Full FE suite: **1770 passed** (126 files); `tsc --noEmit` clean. No live Coupang call; default-off and
  the NAVER / Cafe24 flows are unaffected.
