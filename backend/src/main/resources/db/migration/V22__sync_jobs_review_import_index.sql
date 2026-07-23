-- Index the review-import history read.
--
-- `GET /api/imports/reviews` selects (org_id, job_type='FILE_UPLOAD', upload_type='REVIEW') ordered
-- by the import's own instant. The limit bounds the RESULT, not the scan — without this the query
-- sorts an org's whole sync_jobs history on every page load, and sync_jobs grows once per import
-- forever.
--
-- Ordered on coalesce(finished_at, created_at) to match the query's ORDER BY exactly: an index on a
-- different expression would be ignored for the sort. Additive, IF NOT EXISTS, no drops — the same
-- shape as the index V6 added alongside the method column.
create index if not exists idx_sync_jobs_review_imports
    on sync_jobs (org_id, job_type, upload_type, (coalesce(finished_at, created_at)) desc);
