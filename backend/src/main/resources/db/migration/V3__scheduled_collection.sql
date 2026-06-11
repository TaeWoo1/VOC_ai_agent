-- Phase 3B Slice 1: scheduled-collection backbone schema.
-- Additive only (no destructive drops). IF NOT EXISTS keeps re-runs/partial-applies
-- safe. This slice adds tables + columns ONLY — no scheduler/connector/credential
-- logic, no API, no frontend. Behaviour lands in later slices.

-- Extend sync_jobs into the unified "sync run" record. The Phase 2 file-upload
-- path keeps working unchanged: it sets none of these and inherits trigger=UPLOAD.
-- "trigger" is a reserved SQL keyword, hence quoted everywhere it appears.
alter table sync_jobs add column if not exists seller_account_id uuid;
alter table sync_jobs add column if not exists data_type varchar(40);
alter table sync_jobs add column if not exists "trigger" varchar(20) not null default 'UPLOAD';
alter table sync_jobs add column if not exists attempt integer not null default 1;
alter table sync_jobs add column if not exists next_retry_at timestamptz;
alter table sync_jobs add column if not exists rate_limited boolean not null default false;
create index if not exists idx_sync_jobs_account_started
    on sync_jobs (seller_account_id, started_at desc);

-- sync_cursors already exists from V1 (channel-scoped, unused). Evolve it
-- additively toward the seller-account + data-type scoped design rather than
-- dropping it, so any already-applied local/dev DB migrates cleanly.
-- NOTE: channel_id is a legacy V1 column kept (now nullable, unused) purely for
-- backwards-compatible additive migration; the new SyncCursor entity ignores it.
alter table sync_cursors add column if not exists seller_account_id uuid;
alter table sync_cursors add column if not exists data_type varchar(40);
alter table sync_cursors alter column cursor_value type text;
alter table sync_cursors alter column channel_id drop not null;
create unique index if not exists uq_sync_cursors_natural
    on sync_cursors (org_id, seller_account_id, data_type, cursor_key);

-- Per (seller account x data type) collection schedule the operator turned on.
create table if not exists sync_schedules (
    id                 uuid primary key,
    org_id             uuid        not null,
    seller_account_id  uuid        not null,
    data_type          varchar(40) not null,
    cadence_kind       varchar(40) not null,
    interval_minutes   integer,
    cron_expr          varchar(120),
    enabled            boolean     not null default false,
    next_run_at        timestamptz,
    last_run_at        timestamptz,
    paused_reason      text,
    created_at         timestamptz not null,
    updated_at         timestamptz not null
);
create index if not exists idx_sync_schedules_due
    on sync_schedules (next_run_at) where enabled;

-- Reference data: which (channel, connector_class, data_type) combinations are
-- collectable, with an honest verification status. Seeded below from the
-- refined Phase 3B doc — claims are not overstated.
create table if not exists connector_capabilities (
    id                   uuid primary key,
    channel_code         varchar(80) not null,
    connector_class      varchar(80) not null,
    data_type            varchar(40) not null,
    supported            boolean     not null,
    verification_status  varchar(40) not null,
    notes                text,
    created_at           timestamptz not null,
    updated_at           timestamptz not null,
    unique (channel_code, connector_class, data_type)
);

-- Per-seller-account connection health driving the Channels-page status UI.
create table if not exists channel_connection_status (
    id                    uuid primary key,
    org_id                uuid        not null,
    seller_account_id     uuid        not null unique,
    state                 varchar(40) not null,
    last_success_at       timestamptz,
    consecutive_failures  integer     not null default 0,
    last_error            text,
    created_at            timestamptz not null,
    updated_at            timestamptz not null
);

-- Recorded (not delivered) connector failure/health alerts.
create table if not exists connector_alerts (
    id                 uuid primary key,
    org_id             uuid        not null,
    seller_account_id  uuid        not null,
    sync_job_id        uuid,
    severity           varchar(40) not null,
    type               varchar(80) not null,
    message            text        not null,
    acknowledged_at    timestamptz,
    created_at         timestamptz not null,
    updated_at         timestamptz not null
);
create index if not exists idx_connector_alerts_account
    on connector_alerts (seller_account_id, created_at desc);

-- Encrypted connector credentials. NO PLAINTEXT COLUMN EVER. Envelope-encrypted
-- payload + iv + key id only; write-only intake and decrypt happen in a later
-- slice's CredentialVault. This slice only defines the table + entity/repo.
create table if not exists connector_credentials (
    id                  uuid primary key,
    org_id              uuid        not null,
    seller_account_id   uuid        not null unique,
    connector_class     varchar(80) not null,
    auth_type           varchar(40) not null,
    encrypted_payload   bytea,
    encryption_key_id   varchar(120),
    iv                  bytea,
    token_expires_at    timestamptz,
    refresh_token_enc   bytea,
    last_rotated_at     timestamptz,
    created_by          uuid,
    created_at          timestamptz not null,
    updated_at          timestamptz not null
);

-- Seed connector_capabilities for the two P0 channels from the verified Phase 3B
-- findings (docs/sellerops_phase3b.md §5). connector_class 'API' = official API
-- (class 1). Reviews are confirmed unavailable via official API on both; orders/
-- products confirmed; the rest stay NEEDS_VERIFICATION so the UI tells the truth.
insert into connector_capabilities
    (id, channel_code, connector_class, data_type, supported, verification_status, notes, created_at, updated_at)
values
    (gen_random_uuid(), 'COUPANG', 'API', 'ORDER_SUMMARY', true,  'CONFIRMED',           'Purchase-order / ordersheet + returns/cancellation query documented.', now(), now()),
    (gen_random_uuid(), 'COUPANG', 'API', 'PRODUCT',       true,  'CONFIRMED',           'Product query / summary / range query documented.', now(), now()),
    (gen_random_uuid(), 'COUPANG', 'API', 'SALES',         true,  'NEEDS_VERIFICATION',  'Settlement API exists; endpoint shape not directly verified.', now(), now()),
    (gen_random_uuid(), 'COUPANG', 'API', 'INQUIRY',       true,  'NEEDS_VERIFICATION',  'Call-center inquiry check/reply exists; some answering is WING-UI-only.', now(), now()),
    (gen_random_uuid(), 'COUPANG', 'API', 'REVIEW',        false, 'UNSUPPORTED',         'No review-retrieval endpoint in the official seller API.', now(), now()),
    (gen_random_uuid(), 'NAVER',   'API', 'ORDER_SUMMARY', true,  'CONFIRMED',           'pay-order/seller/orders documented; real-time order/cancel/return.', now(), now()),
    (gen_random_uuid(), 'NAVER',   'API', 'PRODUCT',       true,  'CONFIRMED',           'Product APIs documented.', now(), now()),
    (gen_random_uuid(), 'NAVER',   'API', 'SALES',         true,  'CONFIRMED',           'Settlement API explicitly provided.', now(), now()),
    (gen_random_uuid(), 'NAVER',   'API', 'INQUIRY',       false, 'NEEDS_VERIFICATION',  'TalkTalk consultations not covered by Commerce API; product-Q&A scope unverified.', now(), now()),
    (gen_random_uuid(), 'NAVER',   'API', 'REVIEW',        false, 'UNSUPPORTED',         'Official maintainer (2024-08-30): no review API, none planned near-term.', now(), now())
on conflict (channel_code, connector_class, data_type) do nothing;
