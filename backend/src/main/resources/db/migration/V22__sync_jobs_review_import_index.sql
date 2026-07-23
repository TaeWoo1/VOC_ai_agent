-- Index the review-import history read.
--
-- `GET /api/imports/reviews` selects (org_id, job_type='FILE_UPLOAD', upload_type='REVIEW') ordered
-- by the import's own instant. The limit bounds the RESULT, not the scan — without this the query
-- sorts an org's whole sync_jobs history on every page load, and sync_jobs grows once per import
-- forever.
--
-- Ordered on coalesce(finished_at, created_at) because that is what the query orders by; an index on
-- a different expression would not help the sort at all.
--
-- It does NOT satisfy the ORDER BY end to end, and the earlier wording here overstated that: the
-- query breaks ties on `id desc`, which this index does not carry, so PostgreSQL still adds a Sort
-- above the index scan. Verified on PG 15 — the plan is `Limit -> Sort -> Index Scan using
-- idx_sync_jobs_review_imports`, with the Index Cond covering org_id/job_type/upload_type. The win
-- is the scan: the sort runs over one org's review imports instead of its whole sync_jobs history.
--
-- Additive, IF NOT EXISTS, no drops — the same shape as the index V6 added alongside the method column.
create index if not exists idx_sync_jobs_review_imports
    on sync_jobs (org_id, job_type, upload_type, (coalesce(finished_at, created_at)) desc);
