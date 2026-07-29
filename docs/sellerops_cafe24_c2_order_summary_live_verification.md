# Cafe24 Phase C2 — ORDER_SUMMARY live verification + order-read hardening

Records the gated live `ORDER_SUMMARY` run on real Cafe24 (전선몰딩, disposable env),
and the read-path hardening it motivated: order pagination made silent-truncation-proof
and the Admin-API version pinned + fail-closed. Sanitized: per-day counts/amounts,
booleans, and coarse categories only — no `mall_id`, tokens, credential, or buyer PII.

## Environment

Normal (non-diagnostic) backend, `sellerops.connector.cafe24.enabled=true`, scheduler
**off**, disposable Postgres `cafe24_phaseb`, same reused app + vault key. Read-only
scopes. One `POST /api/seller-accounts/{id}/sync {ORDER_SUMMARY}` (the wired manual path).

## Semantics (code-confirmed)

- **Date basis:** `date_type=order_date` (주문일). The connector collects a **fixed 14-day
  trailing window ending today (KST)** — there is no single-day mode; a run covers the
  window and emits one row per day.
- **Amount:** sums each order's current `payment_amount` (총 **실결제금액**, actual paid) on
  its `order_date`. A zero-paid order is still counted (order_count) with sales_amount 0.
- **Comparison basis** for a day is therefore the order's **current 실결제금액**, not the
  seller center's payment-date (결제일) daily stat.

## Outcome — PASS (initial run)

Window `2026-07-15 … 2026-07-29`; `status=SUCCESS`, `totalRows=4 success=4 skipped=0
failed=0`, `rateLimited=false`. refresh grant + single-use rotation write-back succeeded
(rotation timestamp advanced); credential row stayed **1** (no duplicate).

Per-day rows written to `order_daily_summaries` (CAFE24):

| summary_date | order_count | sales_amount |
|---|---|---|
| 2026-07-23 | 2 | 18,400 |
| 2026-07-25 | 1 | 17,600 |
| 2026-07-27 | 1 | 0 (a real unpaid order — counted by order_date, 실결제 0) |
| **2026-07-28** | **1** | **32,200** |

**2026-07-28 = 1건 / 32,200원** — matches the order's current 실결제금액 baseline exactly.
(The seller center's `07-28 결제 0원` is a payment-date stat — correctly NOT used as the basis;
the order was placed 2026-07-28 and paid 2026-07-29, so its current 실결제 is 32,200.)

- No order-status change, no REVIEW/INQUIRY article or product API call, no re-run.

## Order-read hardening (this slice)

1. **Pagination — silent-truncation-proof.** `ORDER_PAGE_LIMIT` lowered from an unsupported
   `1000` to the documented Admin-list max **`100`**. A full page (== 100) forces the next
   page; a short page ends the window; `MAX_ORDER_PAGES=200` caps a runaway loop (20k ceiling).
   A page size above the server cap would return ≤100 and be mis-read as the last page (silent
   truncation) — requesting exactly the documented max makes the end-of-data signal exact.
   Proven by tests: multi-page (full → next → short → stop, all orders aggregated, none dropped)
   and a mid-window 429 (partial window discarded, cursor unchanged, rotation still persisted).
2. **Admin-API version pinned + fail-closed.** New `sellerops.connector.cafe24.api-version`
   (verified value `2025-12-01`, supplied by env). The transport sends `X-Cafe24-Api-Version`
   on Admin (v2) data calls only — **not** on the OAuth token/authorize endpoints. A blank
   version **fails closed** (the enabled connector will not start), so an admin call never runs
   against an unspecified version (which Cafe24 would resolve to the app default, shifting
   behavior silently). Tested: header attached on admin URIs, absent on OAuth URIs, blank → abort.

## Idempotent replay (same 14-day window, same DB + vault key) — PASS

A second `ORDER_SUMMARY` sync over the same window, on the hardened backend (limit=100,
`api-version=2025-12-01` pinned), same disposable DB + vault key:

- `status=SUCCESS`, `totalRows=4 success=4 skipped=0 failed=0`, `rateLimited=false`.
- `order_daily_summaries` rows: **4 before → 4 after** — no duplicate summary created.
- All four days **identical** to the first run:
  `07-23 = 2/18,400`, `07-25 = 1/17,600`, `07-27 = 1/0`, `07-28 = 1/32,200`.
- **2026-07-28 still 1건 / 32,200원.**
- refresh + rotation write-back re-succeeded (rotation timestamp advanced again); credential
  row stayed **1** (no duplicate).
- The `limit=100` change did not break the single-page days (each day < 100 orders → one page),
  confirming the pagination hardening preserves the existing single-page results.

Idempotency holds by construction (per-day last-wins upsert over a fixed re-collected window),
now re-proven live on the hardened connector.

## Boundary / honesty

- One-time supervised gated runs on a disposable env; no committed test hits live Cafe24 — CI
  evidence stays synthetic. The pagination proof did not need >100 orders live (the window's
  busiest day had 2); the hardening guarantees correctness for larger windows by construction + tests.
- Not covered: REVIEW/INQUIRY article collection (unblocked by the C1 4/6 mapping match, its own phase).
