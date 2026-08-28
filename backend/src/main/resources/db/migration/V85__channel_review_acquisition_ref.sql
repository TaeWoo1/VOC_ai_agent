-- Agentic Operating Workspace v2 §A4 — the Coupang WING 상품평 read becomes startable from a
-- conversation, through the same mint/spend shape `[쿠팡에서 보기]` already uses (V40).
--
-- The seller's browser gets an opaque single-use `acquisition_ref` for the Action Window
-- `START_RUN {intent: REVIEW_ACQUISITION}`; the Local Agent spends it over its own JWT and gets back
-- which account's screen to read. The handoff itself is unchanged (`POST /api/agent/review-handoff`,
-- method SELLER_CENTER_READ) — this binds a run to an account, it carries no review.
--
-- COUPANG only, checked at mint. Short-lived; spent exactly once by a conditional UPDATE.
create table if not exists channel_review_acquisition_ref (
    id                uuid         primary key,
    org_id            uuid         not null references organizations (id),
    seller_account_id uuid         not null references seller_accounts (id),
    acquisition_ref   varchar(16)  not null,
    created_by        varchar(120) not null,
    created_at        timestamptz  not null,
    expires_at        timestamptz  not null,
    consumed_at       timestamptz
);

create unique index if not exists uq_channel_review_acquisition_ref_ref
    on channel_review_acquisition_ref (acquisition_ref);
create index if not exists idx_channel_review_acquisition_ref_account
    on channel_review_acquisition_ref (org_id, seller_account_id, created_at desc);
