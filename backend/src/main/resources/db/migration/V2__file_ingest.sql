-- Phase 2: file-upload ingestion — dedup columns, natural keys, sync-job results.
-- Additive only (no drops). IF NOT EXISTS keeps re-runs/partial-applies safe.

-- Reviews: external id + content hash for duplicate prevention.
alter table reviews add column if not exists external_id varchar(120);
alter table reviews add column if not exists content_hash varchar(64);
create unique index if not exists uq_reviews_external
    on reviews (org_id, channel_id, external_id) where external_id is not null;
create unique index if not exists uq_reviews_hash
    on reviews (org_id, channel_id, content_hash) where content_hash is not null;

-- Inquiries: same dedup scheme.
alter table inquiries add column if not exists external_id varchar(120);
alter table inquiries add column if not exists content_hash varchar(64);
create unique index if not exists uq_inquiries_external
    on inquiries (org_id, channel_id, external_id) where external_id is not null;
create unique index if not exists uq_inquiries_hash
    on inquiries (org_id, channel_id, content_hash) where content_hash is not null;

-- Order summaries: one row per (org, channel, day) — enables upsert of counts.
create unique index if not exists uq_order_summary_natural
    on order_daily_summaries (org_id, channel_id, summary_date);

-- Products: idempotent resolve-or-create by SKU within an org.
create unique index if not exists uq_products_sku
    on products (org_id, sku) where sku is not null;

-- Sync jobs: record ingestion outcome.
alter table sync_jobs add column if not exists upload_type varchar(40);
alter table sync_jobs add column if not exists total_rows integer not null default 0;
alter table sync_jobs add column if not exists success_rows integer not null default 0;
alter table sync_jobs add column if not exists skipped_rows integer not null default 0;
alter table sync_jobs add column if not exists failed_rows integer not null default 0;
alter table sync_jobs add column if not exists error_message text;
