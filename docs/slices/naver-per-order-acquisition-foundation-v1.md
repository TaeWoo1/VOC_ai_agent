# NAVER Per-Order Acquisition Foundation v1

**Status:** Offline-complete; the real NAVER response field set and status range are
`correct-IP live proof pending`. No live NAVER call, no connector-flag production activation,
no marketplace write. Additive only. One narrow migration (V32).

## Why this slice exists

The NAVER order connector (`NaverOrdersClient`) already **receives** per-order data from the
official two-call flow — `productOrderId`, `orderId`, `productOrderStatus`, `lastChangedType`,
`lastChangedDate`, `paymentDate` (call 1) and `initialPaymentAmount` (call 2) — but the current
mapper **collapses all of it into daily `(order_count, sales_amount)` aggregates** and discards
the order-level rows. The only persisted order data is `order_daily_summaries`. So even turning
the backend on and syncing loses per-order data under the current code.

Order **operations** work (risk triage, delay/cancel/return/claim candidates, per-order operator
disposition) is therefore not expressible today — the data foundation is missing. This slice builds
**only that foundation**: normalize and persist the per-order data NAVER actually returns, with
privacy minimization, and accept repeated syncs and status changes safely. **Order-risk policy and
operations UI are deferred to the next PR.**

## Honesty fences (what we will NOT invent)

- **Only real fields are stored.** Every persisted field maps to a field that already exists in the
  connector's transient DTOs (see the field table below). No shipping/cancel/return/claim **column**
  is invented — those transitions are not observable under the current request scope.
- **Raw status code is stored verbatim** (`raw_status_code` = `productOrderStatus`). The **normalized**
  status is deliberately minimal — `PAID | UNKNOWN`:
  - `PAID` ← raw `"PAYED"`, the payment-completed status the current `lastChangedType=PAYED` request
    actually yields.
  - `UNKNOWN` ← any other/unrecognized raw code (**fail closed** — never guess cancel/return/claim
    semantics from a code we have not observed live).
  Extending normalization beyond `PAID`/`UNKNOWN`, and observing real status transitions, requires
  **widening the request's `lastChangedType`** and confirming the value set against a real seller —
  `correct-IP live proof pending`. This slice does **not** change the request filter (live behaviour
  is unchanged).
- **No risk rules, no delay thresholds** are defined here.
- **No PII.** Buyer name / phone / address / shipping address / memo are never read (the connector
  already refuses nested PII objects) and never stored. **No raw API payload** is stored.
- **No order-state mutation, no NAVER write, no auto-anything.**

## What is persisted

Per-order granularity is the **product-order** (상품주문 단위) — the unit the daily summary already
counts. One NAVER `orderId` (payment unit) fans out to several `productOrderId` (product-order units).

### `channel_orders` (V32) — current per-order state, idempotent upsert
Identity: **`(org_id, seller_account_id, external_order_id)`** unique, where `external_order_id` is
the stable `productOrderId`. `parent_order_id` is the `orderId` (grouping attribute, not unique).

| column | source (real field) | note |
|---|---|---|
| `external_order_id` | `productOrderId` | stable per-line identity |
| `parent_order_id` | `orderId` | payment-unit grouping |
| `raw_status_code` | `productOrderStatus` | verbatim |
| `normalized_status` | derived | `PAID \| UNKNOWN` (fail closed) |
| `payment_amount` | `initialPaymentAmount` | post-discount payment at order time |
| `summary_date` | KST date of `paymentDate` (`lastChangedDate` fallback) | == the daily-summary bucket |
| `paid_at` | `paymentDate` | nullable — stored only when present |
| `status_changed_at` | `lastChangedDate` | nullable — the observed status time |
| `first_seen_at` / `last_seen_at` | collection clock | provenance, not order data |

### `channel_order_status_events` (V32) — append-only status history
One row per observed **raw-status change**. `from_status_code` is null on first observation.
`observed_at` = the observation's `status_changed_at`; `recorded_at` = write clock.

## Idempotent upsert + status history (repeated sync, status change)

`ChannelOrderIngestionService.ingest(orgId, channelId, sellerAccountId, orders)` — a **separate**
service (the shared `IngestionService` is untouched):

- **Requires `sellerAccountId`** (the exact connection); a null connection fails closed (per-order
  data has no home without an account).
- In-batch dedup on `productOrderId`; cross-page re-delivery is already deduped by the connector.
- **New** `productOrderId` → insert + initial status event (`null → raw`). Counts **success**.
- **Existing, raw status changed** → update `raw_status_code` / `normalized_status` /
  `status_changed_at` / `paid_at` / `payment_amount`, bump `last_seen_at`, append a status event
  (`old → new`). Counts **success** (a material update).
- **Existing, raw status unchanged** → bump `last_seen_at` only, **no** status event. Counts
  **skipped** (idempotent no-op).
- **Org/account boundary** re-checked on every read and write: the lookup is scoped by
  `(org_id, seller_account_id, external_order_id)`, so another org's or account's row can never be
  matched, updated, or aggregated.

## Row accounting (keeps existing behaviour green)

For a **per-order channel** (the connector emits per-order records) the per-order rows are the counted
unit; the daily summary is still written but not separately counted. For an **aggregate-only channel**
(mock / Cafe24 / ESM emit no per-order records) the daily-summary rows remain the counted unit,
exactly as before. A 1-order NAVER run therefore still reports `successRows == 1` and one
`order_daily_summaries` row — no existing assertion changes.

## Daily ↔ per-order consistency

`channel_orders` and `order_daily_summaries` derive from the **same** deduped `countable` set inside
one `fetchOrderSummaryPage`, so after a collection, for each date `D`:
`count(channel_orders where summary_date=D) == order_daily_summaries(D).order_count` and
`sum(payment_amount where summary_date=D) == order_daily_summaries(D).sales_amount`. A test asserts
this over a multi-order fixture. (The invariant is scoped to within the connector's day-total
retention horizon; pruned-date items are skipped by both paths, so neither diverges.)

**Known scope boundaries** (surfaced by review, acceptable for a foundation): `order_daily_summaries`
is keyed `(org, channel, date)` while per-order rows are `(org, account)` — if two accounts in one org
ever share a channel their daily rows would collide (a pre-existing property of the daily table, not
introduced here). And a per-order row's `payment_amount` is refreshed only on a raw-status change; under
the current PAYED-only scope `initialPaymentAmount` is immutable per order, so this cannot drift — a
corrected-amount-without-status-change case is out of scope until the request filter widens.

## Disposable-Postgres proof (2026-07-28)

Beyond the H2 gate, the whole thing was proven on a throwaway PostgreSQL 15 via a gated opt-in
integration test (`ChannelOrderPostgresProofIT`, `@EnabledIfEnvironmentVariable SELLEROPS_PG_PROOF=1`
— skipped in the normal suite/CI, which have no Postgres):

- **Real Flyway applied V1→V32** on a clean DB: `Successfully applied 31 migrations … now at version
  v32`; `flyway_schema_history` shows `32 | channel orders | success=true`. V32 applies cleanly on top
  of the whole chain — no SQL error.
- **Schema (psql `\d`)**: both tables exist with the expected columns/types/nullability; the identity
  **`uq_channel_orders_identity` UNIQUE (org_id, seller_account_id, external_order_id)** index; and the
  real **foreign keys the H2 test schema did not generate** — `channel_orders` → organizations /
  seller_accounts / channels, and `channel_order_status_events` → channel_orders / organizations.
  (Those FKs surfaced a test-only harness gap — random parent ids — that H2 silently allowed; the
  product code was unaffected.)
- **Behavior on the real schema**: synthetic ingest → re-collect (dedup, no duplicate) → status change
  (`PAYED→DELIVERED`, one event appended, normalized `UNKNOWN`) → restart (fresh service instance,
  idempotent); and a full NAVER sync (fake HTTP) landing **both** the daily summary and per-order rows,
  with `count(channel_orders)==order_daily_summaries.order_count` and matching amount sums.
- **Privacy**: every stored value is an order id / status code / amount / date — no buyer PII; no
  `text`/`json`/`jsonb` free-form column exists; and the app logs carried **0** raw response bodies or
  order ids (connector sanitization holds end-to-end).

## Migration note (V32)

`order_daily_summaries` cannot express per-order rows or status history (it is one aggregate row per
(org, channel, day)). No other existing table is order-scoped. Two strictly-additive tables are the
narrowest home; nothing existing is altered. (V32 is the next free number on `main`; PR #371 —
unmerged — also claims V32, so whichever lands second renumbers, per the V29→V31 precedent.)

## Offline E2E (11)

1. Ingest several new orders → rows + initial status events.
2. Re-collect the same orders → no duplicates, all skipped.
3. Status change → current row updated + status event appended.
4. Unchanged re-collect → no unnecessary status event.
5. Same `productOrderId` under a different org/account → isolated, never mixed.
6. Duplicate items within one page → deduped.
7. Zero orders → clean success, no rows.
8. A row that fails to persist → honest PARTIAL/failed count, others land.
9. Per-order aggregate == `order_daily_summaries` for every date.
10. No PII field in the canonical record, entity, or any log/DTO; no raw payload stored.
11. Restart (fresh service instance) → durable current status + history intact; re-sync stays idempotent.

## Independent-review points

1. Per-order rows never cross org/account (identity + every query scoped by both).
2. No PII / no raw payload reaches the DB, a log, or a DTO.
3. The daily path is byte-for-byte unchanged; per-order is purely additive.
4. Normalized status never overstates an unobserved lifecycle (`UNKNOWN` fail-closed).
5. Idempotency holds across pages, reruns, and restart; status history is append-only and only on change.
6. Daily ↔ per-order consistency cannot silently drift.

## Explicitly out of scope (deferred / gated)

Order-risk policy, delay/cancel/return/claim classification, operations UI, widening the request
`lastChangedType`, any live NAVER call, connector-flag production activation, other channels, a
generic workflow/OperationRun engine.
