-- The index the channel-scoped "last import" lookup needs.
--
-- The channel review list asks for the newest REVIEW import of one channel, and asks twice per view (once
-- for the list, once for a detail). The existing indexes cover (org_id, job_type, upload_type, ended desc)
-- from V22, (seller_account_id, started_at desc) from V3, and (org_id, method, started_at desc) from V6 —
-- none of which this predicate can use past the org_id prefix, so it would sort the org's whole sync_jobs
-- history on every load. V22 exists because that sort was already measured as a problem once.
--
-- Column order follows the query: three equalities, then the sort key descending, so the first row of the
-- range IS the answer and no sort is needed. Additive and idempotent; touches no data.
create index if not exists idx_sync_jobs_org_channel_type_created
    on sync_jobs (org_id, channel_id, data_type, created_at desc);
