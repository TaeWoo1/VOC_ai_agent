-- ESM inquiry Excel-import provenance (Phase: manual ESM inquiry intake bridge).
-- Additive only: no data migration, no change to existing review/inquiry behavior.
--
-- The imported rows become canonical `inquiries` (reusing the existing ingestion +
-- dedup + work-item path). Connection identity lands on the inquiry via a new
-- nullable `seller_account_id` (null on legacy/file-upload rows). File-specific
-- provenance is kept OFF the canonical inquiry, in a dedicated per-inquiry table
-- linked to a durable import batch.

-- 1. Connection identity on the canonical inquiry (nullable; legacy rows stay null).
alter table inquiries add column if not exists seller_account_id uuid;
alter table inquiries
    add constraint fk_inquiries_seller_account
    foreign key (seller_account_id) references seller_accounts (id);
create index if not exists idx_inquiries_seller_account on inquiries (seller_account_id);

-- 2. One durable, audited import batch per confirmed upload.
create table inquiry_import_batch (
    id                uuid primary key,
    org_id            uuid        not null references organizations (id),
    seller_account_id uuid        not null references seller_accounts (id),
    channel_id        uuid        not null references channels (id),
    marketplace           varchar(16) not null,
    source_filename       text,
    file_hash             varchar(64) not null,
    header_signature      varchar(64) not null,
    canonical_preview_hash varchar(64) not null,
    row_count             integer     not null,
    uploaded_by       uuid        not null references users (id),
    inserted          integer     not null default 0,
    status_updated    integer     not null default 0,
    skipped           integer     not null default 0,
    rejected          integer     not null default 0,
    status            varchar(24) not null,
    created_at        timestamptz not null,
    updated_at        timestamptz not null
);

-- Same file re-confirmed for the same (org, account, marketplace) is idempotent:
-- it resolves to the existing batch and never inserts a second one.
create unique index uq_inquiry_import_batch_file
    on inquiry_import_batch (org_id, seller_account_id, marketplace, file_hash);

-- 3. One provenance row per imported inquiry, linking it to its batch and carrying
--    the file-origin metadata (never buyer PII, never inquiry/answer content).
create table inquiry_import_provenance (
    id                   uuid primary key,
    org_id               uuid        not null references organizations (id),
    inquiry_id           uuid        not null unique references inquiries (id),
    import_batch_id      uuid        not null references inquiry_import_batch (id),
    source_filename      text,
    source_row           integer     not null,
    marketplace          varchar(16) not null,
    registration_kind    varchar(64),
    inquiry_type         varchar(64),
    original_product_ref varchar(128),
    original_order_ref   varchar(128),
    order_type           varchar(64),
    received_at_raw      varchar(32),
    processed_at_raw     varchar(32),
    fingerprint          varchar(64) not null,
    fingerprint_version  integer     not null,
    created_at           timestamptz not null,
    updated_at           timestamptz not null
);

create index idx_inquiry_import_provenance_batch on inquiry_import_provenance (import_batch_id);

-- 4. Durably tie a status-reconciliation audit (an OPEN→COMPLETED transition caused by
--    a later ANSWERED export) back to the import batch that caused it. Null for all
--    non-import audit events.
alter table inquiry_work_item_audit add column if not exists import_batch_id uuid
    references inquiry_import_batch (id);
