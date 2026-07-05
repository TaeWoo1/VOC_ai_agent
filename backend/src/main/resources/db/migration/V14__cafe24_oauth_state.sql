-- Short-lived, tenant-bound OAuth state for the Cafe24 "Connect Cafe24" flow.
-- One row per authorization attempt: created when the seller starts the flow,
-- consumed (single-use) when the browser returns to the callback. Only the SHA-256
-- HASH of the random state token is stored — the raw token exists solely in the
-- authorization URL; the callback value is hashed before lookup, so a database read
-- never yields a usable state. `mall_id` is carried because the per-mall token host
-- is absent from the callback. Nothing secret is stored (no code, no token) — only
-- the pending binding of (org, seller account, channel).
create table cafe24_oauth_state (
    id                 uuid        primary key,
    org_id             uuid        not null references organizations (id),
    seller_account_id  uuid        not null references seller_accounts (id),
    channel_id         uuid        not null references channels (id),
    state_hash         varchar(64) not null unique,
    mall_id            varchar(64) not null,
    redirect_uri       text        not null,
    initiated_by       uuid,
    expires_at         timestamptz not null,
    consumed_at        timestamptz,
    created_at         timestamptz not null,
    updated_at         timestamptz not null
);

create index idx_cafe24_oauth_state_account on cafe24_oauth_state (seller_account_id);
create index idx_cafe24_oauth_state_expires on cafe24_oauth_state (expires_at);
