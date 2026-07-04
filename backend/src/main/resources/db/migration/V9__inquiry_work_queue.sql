-- Phase: durable seller inquiry work queue (contract-alignment slice).
-- Additive only (no drops). IF NOT EXISTS keeps re-runs / partial-applies safe.
--
-- 1) Inquiry gains the confirmed ESM fields we persist: the seller-visible title
--    and the RAW source reply-status token (inform_status). Canonical status stays
--    in inquiries.status; messageNo lands in the existing external_id column. The
--    buyer `author` column is intentionally left in place but nullable — buyer PII
--    is no longer written (see IngestionService). The reply token is never stored.
alter table inquiries add column if not exists title text;
alter table inquiries add column if not exists inform_status varchar(40);

-- 2) inquiry_work_item — one durable OPEN work item per new connector inquiry.
--    seller_account_id is the EXACT seller connection (never a bare channel).
--    inquiry_id is UNIQUE so re-ingestion can never fan out duplicate work items.
create table if not exists inquiry_work_item (
    id                 uuid        primary key,
    org_id             uuid        not null references organizations (id),
    inquiry_id         uuid        not null references inquiries (id),
    seller_account_id  uuid        not null references seller_accounts (id),
    channel_id         uuid        not null references channels (id),
    phase              varchar(32) not null,
    created_at         timestamptz not null,
    updated_at         timestamptz not null
);
create unique index if not exists uq_inquiry_work_item_inquiry
    on inquiry_work_item (inquiry_id);
create index if not exists idx_inquiry_work_item_org_phase
    on inquiry_work_item (org_id, phase, created_at desc);

-- 3) inquiry_work_item_audit — append-only lifecycle trail. (work_item_id,
--    command_id) is UNIQUE for idempotent event emission. phase_from is null at open.
create table if not exists inquiry_work_item_audit (
    id             uuid        primary key,
    org_id         uuid        not null references organizations (id),
    work_item_id   uuid        not null references inquiry_work_item (id),
    command_id     varchar(120) not null,
    event_type     varchar(40) not null,
    phase_from     varchar(32),
    phase_to       varchar(32) not null,
    actor          varchar(120) not null,
    created_at     timestamptz not null,
    updated_at     timestamptz not null
);
create unique index if not exists uq_inquiry_work_item_audit_command
    on inquiry_work_item_audit (work_item_id, command_id);
create index if not exists idx_inquiry_work_item_audit_work_item
    on inquiry_work_item_audit (work_item_id, created_at);
