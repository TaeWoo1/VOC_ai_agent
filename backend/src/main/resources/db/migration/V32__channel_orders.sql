-- NAVER Per-Order Acquisition Foundation — persist the per-order data the NAVER connector already
-- receives but currently discards, with privacy minimization and an append-only status history.
--
-- WHY THIS EXISTS. The only order table today is `order_daily_summaries` — one aggregate row per
-- (org, channel, day) holding order_count + sales_amount. The NAVER two-call flow returns per-order
-- rows (productOrderId, orderId, productOrderStatus, paymentDate, initialPaymentAmount), but the
-- mapper collapses them into the daily total and throws the order-level data away. No existing table
-- is order-scoped, so per-order state and its status history have no home. These two strictly-additive
-- tables are the narrowest foundation; nothing existing is altered. Order-risk policy and operations
-- UI are deliberately deferred to a later slice.
--
-- WHAT IS AND ISN'T STORED. Only fields the API actually returns are persisted. No buyer PII
-- (name / phone / address / shipping address / memo) is read or stored, and no raw payload is stored.
-- `raw_status_code` is the channel status verbatim; `normalized_status` is deliberately minimal
-- (PAID | UNKNOWN) and fails closed — shipping/cancel/return/claim semantics are not inferred from
-- codes not observed live (correct-IP live proof pending).
--
-- ============================================================================================
-- VERSION NUMBERING
-- This file is V32 — the next free version above everything on main (max is V31). Flyway
-- `out-of-order` is NOT enabled, so a version at or below main's max would fail boot on an already-
-- migrated database. NOTE: the unmerged branch `feat/review-issue-action-loop` (PR #371) also authors
-- a V32; whichever of the two merges second must renumber to V33+ (same forward-only rule).
-- ============================================================================================

-- Current per-order (product-order granularity) state for one seller connection.
create table channel_orders (
    id                 uuid primary key,
    org_id             uuid         not null references organizations (id),
    seller_account_id  uuid         not null references seller_accounts (id),
    channel_id         uuid         not null references channels (id),
    -- The channel's stable per-line id (NAVER productOrderId). Identity within (org, account).
    external_order_id  varchar(120) not null,
    -- The payment-unit grouping id (NAVER orderId); not unique.
    parent_order_id    varchar(120),
    -- The channel status code, verbatim.
    raw_status_code    varchar(60)  not null,
    -- Minimal normalization: PAID | UNKNOWN (fail closed).
    normalized_status  varchar(24)  not null,
    payment_amount     bigint       not null default 0,
    -- KST bucket, identical to order_daily_summaries.summary_date, so the two stay consistent.
    summary_date       date         not null,
    paid_at            timestamptz,
    status_changed_at  timestamptz,
    first_seen_at      timestamptz  not null,
    last_seen_at       timestamptz  not null,
    created_at         timestamptz  not null,
    updated_at         timestamptz  not null
);
-- Identity: one row per (org, account, product order). The unique key is also the org/account
-- isolation guarantee — a product order can never collide across the boundary.
create unique index uq_channel_orders_identity
    on channel_orders (org_id, seller_account_id, external_order_id);
create index idx_channel_orders_org_channel_date
    on channel_orders (org_id, channel_id, summary_date);

-- Append-only history: one row per observed raw-status change. from_status_code is null on the
-- first observation. Never updated or deleted.
create table channel_order_status_events (
    id                 uuid         primary key,
    org_id             uuid         not null references organizations (id),
    channel_order_id   uuid         not null references channel_orders (id),
    from_status_code   varchar(60),
    to_status_code     varchar(60)  not null,
    observed_at        timestamptz,
    recorded_at        timestamptz  not null,
    created_at         timestamptz  not null,
    updated_at         timestamptz  not null
);
create index idx_channel_order_status_events_order
    on channel_order_status_events (channel_order_id, recorded_at);
