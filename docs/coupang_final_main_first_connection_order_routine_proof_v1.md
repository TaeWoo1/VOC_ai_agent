# Coupang Final Main First-Connection + Idempotent Order Routine Proof v1

> **Status:** COMPLETE — live-proven on `main` `59c2e6c` (2026-08-06), disposable environment.
> This is the final read-only order-pilot-readiness proof for Coupang: on a pristine `main` DB, a real
> WING credential achieved first connection, first `ORDER_SUMMARY` sync, `PREPARING → CONNECTED`, and
> same-window idempotent re-sync — with zero code modification and zero secret/PII/provider-body leakage.
>
> Canonical live-run rules: [`sellerops_live_approval_contract.md`](./sellerops_live_approval_contract.md).
> Predecessors: [`coupang_ordersheets_response_contract_hardening_v1.md`](./coupang_ordersheets_response_contract_hardening_v1.md)
> (the parse fix this proof exercises on `main`),
> [`coupang_connection_failure_diagnostic_hardening_v1.md`](./coupang_connection_failure_diagnostic_hardening_v1.md)
> (the connect-test fix).

## Scope & authorization

- **Code:** `main` `59c2e6c`, Flyway top **V36**, **zero code modification** during the proof (empty
  tracked diff at start and end). No new migration.
- **Grant:** fresh single-use approval `apr-01212e2da29a` / run `cp-781c4c7a2484`, git `59c2e6c`, mode
  **WRITE**, max actions `credential=1, test=1, sync=1, re-sync=1`. Operator grant: one line
  "Seated and ready." bound to the displayed sanitized Approval Manifest. Preflight **9/9 PASS**
  (including the pristine-baseline gate).
- **Marketplace calls:** read-only GETs only (`returnShippingCenters`, `ordersheets`). No
  order/shipping/product/inventory write.
- **Environment:** disposable backend `:18091` (connector enabled, scheduler **OFF**, base URL the real
  `https://api-gateway.coupang.com`, live-call interlock **armed** with the approval id), FE `:5173`,
  disposable Postgres `coupang_proof@127.0.0.1:55432` (never the real `:5432`/`sellerops`).

### Pristine-baseline note (precondition reconciliation)

The retained disposable DB from the Landing was found **down** and the `coupang_proof` database
**absent** (dropped after the Landing; the cluster itself restarted cleanly). It was reconstructed to
the stated pristine baseline the standard way: restart the disposable cluster → recreate `coupang_proof`
**empty** → backend Flyway migrates to **V36** + seeds the demo user/reference channels → truncate the 2
seeded demo accounts (NAVER + a demo COUPANG) back out. Verified pristine before any Coupang call:
`seller_accounts=0, connector_credentials=0, channel_orders=0, sync_jobs=0, order_daily_summaries=0,
sync_cursors=0, users=1` (+ reference `channels=13`).

## Proof timeline (live, 2026-08-06)

### 1. First connection (operator-entered credential + connect test)

The operator entered Vendor ID / Access Key / Secret Key in the masked FE (`/connect/coupang`), which
created the COUPANG account, stored the credential (write-only, masked), and ran the connect test once
(`credential=1 + test=1`).

- Account `08bf0709-…` created; `connector_credentials=1`.
- Connect test (sanitized WARN, endpoint + status + category only):
  `returnShippingCenters httpStatus=400 category=CLIENT_ERROR` → **`ordersheets` fallback 200 CONFIRMED**.
- `connection_status: PENDING → PREPARING` (two-signal: credential test verified).

### 2. First `ORDER_SUMMARY` sync (`sync=1`)

Run `af8d4ddf` — **SUCCESS · 64 / 64 / 0 / 0** (total/success/skipped/failed), MANUAL.

| signal | value |
| --- | --- |
| status / rows | **SUCCESS · 64 / 64 / 0** |
| status sweep (raw_status_code) | FINAL_DELIVERY **42** · DELIVERING **12** · ACCEPT **10** (= 64); INSTRUCT / DEPARTURE / NONE_TRACKING returned empty |
| pagination | not exercised this window — each status ≤ `maxPerPage=50`, so no `nextToken` (paging code present + unit-tested) |
| `channel_orders` total / distinct external id | **64 / 64** (duplicates **0**) |
| canonical normalization | `payment_amount` canonical KRW `Long`; `summary_date` KST span **2026-07-30 … 2026-08-06** (8 days); `paid_at` set; `raw_status_code` preserved verbatim |
| `normalized_status` | **UNKNOWN** for all 64 — **by design**: `NormalizedOrderStatus` vocabulary is `{PAID, UNKNOWN}`; Coupang ordersheet fulfillment states (ACCEPT/DELIVERING/FINAL_DELIVERY) have no canonical member, so they fail-safe to UNKNOWN while the **raw** enum is preserved. Not a defect — the connector never invents a canonical status it cannot justify. |
| `order_daily_summaries` | 8 days · 64 orders · ₩2,016,170 |
| cursor | `{"initialized":true,"throughDate":"2026-08-06"}` |
| `connection_status` | **PREPARING → CONNECTED** |
| Operations UI | `connection-status` → state **CONNECTED**, 0 failures; `sync-runs` → 1 run (ORDER_SUMMARY SUCCESS 64/64/0) |
| shape-only parse diagnostic | fired **0×** — the hardened DTO (`984d067`) binds the live 200 cleanly on `main` code |

### 3. Same-window idempotent re-sync (`re-sync=1`)

Run `54d8bf0f` — **SUCCESS · 34 seen / 0 inserted / 34 skipped / 0 failed**. The cursor
(`throughDate=2026-08-06`) bounded the re-sync to the incremental window; all 34 re-encountered orders
were deduped by `external_order_id`.

| idempotency invariant | result |
| --- | --- |
| total order count (was 64) | **64** — increase **0** |
| distinct external id | **64** |
| duplicate inserts | **0** |
| new rows (`max first_seen_at` unchanged) | **0** (stayed 20:27:05) |
| upsert consistency | **34** rows touched (`last_seen_at` bumped → 20:30:19); 30 outside the cursor window untouched; 34 + 30 = 64 |
| sync terminal | **SUCCESS** |

## Leak audit

Across both sync windows and the connect test: grep for `Authorization` / `Bearer` / secret /
access-key / `signature` / `hmac` / `orderer` / `receiver` / phone / address = **0**. The shape-only
parse diagnostic (which itself records only keys/types/counts/path) fired **0×**. No raw provider body,
header, signature, credential, order id, or buyer PII was logged, recorded, or persisted beyond the
normalized `channel_orders` (external order id + status + amount + date only).

## Completion criteria — all met

- credential test SUCCESS (PREPARING) ✓
- real `ordersheets` 200 confirmed (fallback CONFIRMED; first sync bound the 200) ✓
- first sync SUCCESS (64/64/0/0) ✓
- status sweep executed (6-status sweep; 3 populated, 3 empty) ✓
- pagination complete (no `nextToken` this window; ≤50 per status) ✓
- `channel_orders` total == distinct external id (64 == 64) ✓
- PREPARING → CONNECTED ✓
- Operations UI displays the connected account + run ✓
- re-sync SUCCESS ✓
- order-count increase after re-sync = 0 ✓
- duplicates 0 ✓
- secret / IP / provider-body / order-PII leakage 0 ✓
- `main` clean, code modification 0 ✓

## Outcome

**Coupang read-only order pilot readiness is proven on `main`.** First connection, first order sync,
canonical normalization, connection completion, and idempotent re-sync all pass on `main` `59c2e6c`
against a real WING vendor, with the response-contract hardening confirmed live (parse diagnostic never
needed). Two honest, non-blocking observations for follow-up (not defects): (1) `normalized_status` is
UNKNOWN for Coupang fulfillment states because the canonical vocabulary is `{PAID, UNKNOWN}` — a future
unit could extend the enum with fulfillment-phase members; (2) `nextToken` pagination was not exercised
by this live window (each status ≤ 50) — it remains unit-tested only, not live-proven.

## Post-proof environment

Backend `:18091` + FE `:5173` torn down; live-call interlock disarmed (approval `apr-01212e2d` dead).
Disposable Postgres `coupang_proof@:55432` **kept with the proof evidence** (account + credential + both
runs + 64 orders), inert (backend off), **not live-ready**, wipe on request.
