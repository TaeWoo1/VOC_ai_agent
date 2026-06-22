-- Add the collection "method" dimension to collection runs.
--
-- Values: API / SELLER_CENTER_EXPORT / MANUAL_UPLOAD.
-- Additive and nullable, so existing rows (method unknown) stay valid; the common
-- collection runtime populates it going forward.
--
-- No new tables are created here: collection_runs is sync_jobs, and channel_connections
-- is seller_accounts + channel_connection_status. This single column is the only schema
-- change for the runtime skeleton.
alter table sync_jobs
    add column if not exists method varchar(40);

create index if not exists idx_sync_jobs_org_method_started
    on sync_jobs (org_id, method, started_at desc);
