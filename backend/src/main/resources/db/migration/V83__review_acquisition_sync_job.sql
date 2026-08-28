-- Agentic Operating Workspace v2 §A1 — a review remembers the run that brought it in.
--
-- `executableIdentity` (MARKETPLACE | NONE) is derived from ACQUISITION PROVENANCE, never from the
-- shape of an external id or the label on a channel. `inquiries` already carries the link it needs
-- (`seller_account_id`, written by the connector clients). `reviews` did not: the file-shaped ingests
-- — a bounded NAVER seller-center export (SELLER_CENTER_EXPORT via /launches/{ref}/ingest) and an
-- arbitrary manual upload (MANUAL_UPLOAD) — landed in the same table with nothing that told them
-- apart, and the Coupang WING handoff (SELLER_CENTER_READ) recorded its sync_job AFTER the rows.
--
-- ONE nullable column, written at ingest time only, NO backfill. A row written before this migration
-- has no provenance anyone can prove now; leaving it null makes it NONE, which is the fail-closed
-- reading. A backfill that promoted rows to MARKETPLACE would be inventing the very fact this column
-- exists to record.
alter table reviews
    add column if not exists acquisition_sync_job_id uuid references sync_jobs (id);

create index if not exists idx_reviews_acquisition_sync_job
    on reviews (acquisition_sync_job_id)
    where acquisition_sync_job_id is not null;

comment on column reviews.acquisition_sync_job_id is
    'The sync_jobs row of the run that inserted this review (method = SELLER_CENTER_EXPORT / '
    'SELLER_CENTER_READ / MANUAL_UPLOAD). Null on rows predating 2026-08-28 and on rows written by '
    'a path that records no run. Read by ExecutableIdentityResolver; never backfilled.';
