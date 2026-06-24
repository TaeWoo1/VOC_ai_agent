# Cafe24 ORDER_SUMMARY — Gated live verification record

Records the one-time supervised live run that promoted the Cafe24
`ORDER_SUMMARY` capability from `NEEDS_VERIFICATION` to **CONFIRMED**
(`Cafe24ApiConnector.capabilities()`). The connector ships **flag-off by
default** (`sellerops.connector.cafe24.enabled`); this run used a dev backend +
disposable dev DB with the flag on and the scheduler off. Evidence is sanitized:
aggregates and field-presence only — no `mall_id`, tokens, order IDs, customer
data, or raw response bodies.

## Outcome — PASS

One manual `ORDER_SUMMARY` sync against the **correct target mall** credential.

| field | value |
|---|---|
| `jobType` | `CAFE24_API` (real connector, not mock) |
| `status` | **SUCCESS** |
| `rateLimited` | `false` |
| row counters | total 4 · success 4 · skipped 0 · failed 0 |
| `errorMessage` | (none) |
| token rotation | persisted (single-use refresh token rotated and written back during the run) |
| `channel_connection_status` | `CONNECTED`, 0 consecutive failures |

### Per-day aggregates written to `order_daily_summaries`

| summary_date (KST) | order_count | sales_amount |
|---|---|---|
| 2026-06-14 | 1 | 11,500 |
| 2026-06-21 | 1 | 0 |
| 2026-06-23 | 2 | 27,250 |
| 2026-06-24 | 1 | 12,500 |

## What was validated end-to-end

- **Credential chain** — vault decrypt → refresh-token grant succeeded; the
  rotated single-use refresh token was persisted before the orders call (the
  fail-closed write-back invariant), leaving the credential usable for the next
  run.
- **Real connector path** — `jobType=CAFE24_API`, not the generic mock; the flag
  was confirmed on at startup.
- **Orders GET** — Admin orders list paged and parsed over the fixed trailing
  14-day window with `date_type=order_date`; terminated cleanly on a short page.
- **Field shapes** — `order_date` present and bucketed to the correct KST day;
  `payment_amount` present, KRW scale-0 (no minor units), summed per day.
- **Aggregation** — multi-order day folded correctly (2026-06-23: two orders →
  one row).

## UI reconciliation (sales_amount)

DB `sales_amount` was reconciled against the Cafe24 seller-center order list for
the same window:

- The DB `sales_amount` matches the seller-center **총 실결제금액** (total actual
  paid amount) aggregate — **not** 총 상품구매금액 (product-purchase amount).
- 2026-06-21 `sales_amount = 0` is **correct**: that order's 총 실결제금액 is also
  0 in the UI (a real zero-paid order, included because `date_type=order_date`
  counts the order regardless of payment).

**Verified semantic definition (v1):**

- `order_count` = count of orders by `order_date`.
- `sales_amount` = sum of **총 실결제금액 / actual paid total** by `order_date`.

## Cleanup performed

- Throwaway gated diagnostic controller removed (it was never committed).
- Diagnostic-only flags (`sellerops.connector.cafe24.diagnostic.*`) were injected
  via dev env only — never added to `application.yml` — so no source revert was
  needed. Unset them and restart to drop the diagnostic route entirely.
