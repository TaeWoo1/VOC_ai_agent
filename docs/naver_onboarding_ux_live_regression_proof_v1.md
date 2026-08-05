# NAVER Onboarding UX Live Regression Proof v1

> **Live-proof record (PARTIAL).** Real disposable environment, approval-compliant. Sanitized: no secret,
> token, IP, raw order/account id, or PII appears here. Aggregate/state evidence only.

- **Result:** the newly-fixed onboarding **UX paths are LIVE PASS**; the **connection + order-sync
  regression was DEFERRED by operator choice (option B)** — not re-run at this commit. The **engine-level
  regression risk is low, but the integrated path is E2E-unverified at `a9f8e08`** (see below). Net:
  **PARTIAL**.
- **When / where:** 2026-08-05, `main @ a9f8e08` (PR #394 merged).
- **Approval:** `apr-b5d89bcda9ae` (mode WRITE, `credential=1, test=1, sync=1`), run `wt-5e87fc401e03`, git
  `a9f8e08`. **Grant SEATED but 0 of the 3 WRITE actions consumed → REVOKED_BEFORE_ACTION.** Zero live
  NAVER-affecting action, **0 NAVER API call**, 0 DB write. Final DB state identical to baseline
  (`naver_accts=0, credentials=0, sync_jobs=0, channel_orders=0`).
- **Environment:** disposable `naver_walkthrough@127.0.0.1:55432` (Flyway **V36**; never the real `:5432`),
  scheduler **OFF**, NAVER connector ON, **advertised call IP UNSET** (backend launched without
  `SELLEROPS_CONNECTOR_NAVER_ADVERTISED_EGRESS_IPS`), **Local Agent bridge OFF**, clean new-seller
  (0 NAVER accounts, V36 unique slot free — seeded account cleared).

## Lifecycle (approval-compliant)

1. DB dropped + recreated (clean new-seller) → `bootstrap.sh` @ `a9f8e08` (fresh run/approval id) →
   `run-backend-local` (seed on → demo user; bare NAVER account then deleted) + `run-frontend-local`.
2. `preflight.sh` **PASS** — env-binding matched (URL = frontend build = backend `/context` =
   `wt-5e87fc401e03`, git `a9f8e08`), **0 NAVER call / 0 DB write** on page load; inline **WRITE manifest
   DISPLAYED** (`credential=1, test=1, sync=1`).
3. Operator single-use grant **"Seated and ready — WRITE approved"**.
4. Operator drove the browser through the onboarding UX paths, then **elected to skip** the live
   credential/test/sync (option B). No NAVER credential was entered; no test/sync ran.

## UX regression paths — LIVE

| Path | What was checked | Verdict |
|---|---|---|
| **#1** first-entry `walkthroughRun` preserved | The wizard was reached with a **matched** env-binding, which *requires* the URL to carry `?walkthroughRun=wt-5e87fc401e03` (else the fail-closed mismatch screen blocks it). | **PARTIAL** — run id present in URL confirmed live; the specific `ChannelList` CTA-preservation fix is covered by the 3 offline unit tests, its live CTA-click was not separately confirmed this session. |
| **#2** bound tab, no environment failure | The operator reached the guided wizard with **no** `WALKTHROUGH_ENVIRONMENT_MISMATCH` screen. | **LIVE PASS** |
| **#3** agent-off text path | Local Agent bridge OFF → "도우미를 찾지 못했어요" shown; operator used **"텍스트로 직접 진행하기"** and advanced to credential entry with no agent. | **LIVE PASS** |
| **#4** advertised-IP-unset "already registered" | Advertised IP unset → panel showed **"SellerOps 고정 호출 IP가 아직 설정되지 않았습니다"** (our-side, not fabricated) with the "이미 API 호출 IP를 등록했어요" affordance; the operator was **not blocked** and reached credential entry. | **LIVE PASS** |

## Connection + order-sync regression — DEFERRED (option B)

The operator chose not to re-run credential/test/first-sync/idempotency at this commit. Therefore, for
`a9f8e08` this session:

- `credential / test / first ORDER_SUMMARY sync 성공` — **DEFERRED** (not run).
- `동일 window 재수집 중복 0` — **DEFERRED** (not run).
- **실제 GW 응답** — **none captured** (0 NAVER call this session).

**Engine-level regression risk is low — but this is an argument, NOT a substitute for the E2E proof:**
PR #394 changed **only** `frontend/**`, `tools/naver-local/**`, and docs — **zero** `backend/`,
`collector/`, or `contracts/` change, no migration (Flyway top unchanged at V36). The connection/test/sync
engine at `a9f8e08` is therefore byte-identical to the one that **LIVE-PASSED** first-connection + first
sync (13 orders, all PAID) + same-window idempotency (0 duplicates) at `2c9ecac` — see
`docs/naver_live_first_connection_proof_v2.md`. Because `a9f8e08 = 2c9ecac + only FE/tools/docs`, this
change touches nothing in that engine, so an **engine-level** regression is **unlikely**. This is **not**
an end-to-end proof, though: credential → test → first sync → same-window re-sync was **not exercised at
`a9f8e08`**, so the integrated onboarding → connection → sync path remains **E2E-unverified** at this
commit. The real GW result on that unchanged engine was **2xx (order-access CONFIRMED)** at v2; the 4xx
diagnosis paths remain UNMEASURED live (no code guessed).

## Scope fences honored

No order-status change · no review/inquiry reply submission · no production change · **no code change**
this unit (code frozen; docs/memory only) · no new error code guessed. Grant consumed 0 WRITE actions.

## To close to a full PASS later

Re-bootstrap at the then-current `main` for a fresh `approvalId`, seat a new WRITE grant, and run the one
test + one first sync + one same-window re-sync — capturing the real GW response and confirming 0
duplicates — to convert the DEFERRED rows above to LIVE PASS at that commit.
