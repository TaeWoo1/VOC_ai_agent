-- NAVER Initial Review Import (V1): the onboarding historical backfill plan.
--
-- A seller populates SellerOps with their available historical reviews by exporting them from the NAVER
-- seller center in bounded segments. Until now the only record of an import was one `sync_jobs` row per
-- upload — enough to answer "did THIS file work", but with no notion of a PLAN (a chosen period divided
-- into segments), of per-segment STATE, of RESUMING the remaining work, or of what is COVERED vs MISSING.
-- These three tables are that record. They add no export/download/click path of their own: each segment
-- is still exported by the human via the Action Window, and ingested through the existing upload path.
--
-- Additive only (no drops). IF NOT EXISTS keeps re-runs / partial-applies safe, matching V8/V18/V21/V22.
--
-- Two orthogonal state axes are kept in SEPARATE columns, deliberately (they answer different questions
-- and a real segment can hold any combination):
--   * EXECUTION  — what happened to the last attempt: PENDING | ACTIVE | COMPLETED | FAILED.
--   * COVERAGE   — the conclusion about the data: UNVERIFIED | COVERED | MISSING.
-- FAILED is an attempt outcome; MISSING is a coverage conclusion. A valid EMPTY export is COMPLETED +
-- COVERED with zero rows — not MISSING. A range NAVER will not let the seller reach (earlier than the
-- earliest selectable date) is COVERAGE = MISSING with no failed attempt. Conflating the two would either
-- hide real gaps or cry failure over correct empties, so they never share a column.

-- 1) review_import_plan — one operator-chosen historical import for one seller account.
--
--    Stores the REQUESTED period verbatim. The earliest date NAVER actually permits is unknown up front
--    (the export UI, read back by readExportScope, is the source of truth), so the requested start is NOT
--    clamped here — any earlier-than-reachable portion surfaces later as MISSING coverage on its segment.
create table if not exists review_import_plan (
    id                uuid         primary key,
    org_id            uuid         not null references organizations (id),
    seller_account_id uuid         not null references seller_accounts (id),
    channel_id        uuid         not null references channels (id),
    requested_start   date         not null,
    requested_end     date         not null,
    -- DRAFT (segments proposed, none run) | ACTIVE (in progress) | COMPLETED (no remaining work) | ABANDONED.
    status            varchar(24)  not null default 'DRAFT',
    created_at        timestamptz  not null,
    updated_at        timestamptz  not null
);
create index if not exists idx_review_import_plan_account
    on review_import_plan (org_id, seller_account_id, created_at desc);

-- 2) review_import_segment — one bounded export window within a plan (V1 default: one calendar month).
--
--    The operator may adjust/merge/split segments before or during the run. A SPLIT replaces a segment
--    with shorter child ranges (parent_segment_id set on the children); the parent is marked `superseded`
--    and drops out of the coverage rollup while staying reachable for history. `superseded` is a separate
--    flag rather than an execution value so the execution enum stays exactly the four decision-4 states.
--
--    covered_rows is the row total the covering export brought (0 = a valid empty). rows_reconciled is the
--    honest completeness flag: with NAVER's per-export row cap UNKNOWN we cannot PROVE every expected row
--    arrived, so it stays false — "scope exported successfully" is not "all expected rows reconciled".
create table if not exists review_import_segment (
    id                uuid         primary key,
    plan_id           uuid         not null references review_import_plan (id),
    org_id            uuid         not null references organizations (id),
    parent_segment_id uuid         references review_import_segment (id),
    ordinal           integer      not null,
    segment_start     date         not null,
    segment_end       date         not null,          -- inclusive
    execution_state   varchar(16)  not null default 'PENDING',    -- PENDING | ACTIVE | COMPLETED | FAILED
    coverage_state    varchar(16)  not null default 'UNVERIFIED',  -- UNVERIFIED | COVERED | MISSING
    covered_rows      integer,
    rows_reconciled   boolean      not null default false,
    superseded        boolean      not null default false,
    created_at        timestamptz  not null,
    updated_at        timestamptz  not null
);
-- Ordered by segment_start: date order is the display order and stays correct across split/merge, where
-- ordinal (a creation-time index kept for reference) would need renumbering.
create index if not exists idx_review_import_segment_plan
    on review_import_segment (plan_id, segment_start);

-- 3) review_import_segment_attempt — each export+ingest attempt for a segment, with retry history.
--
--    One row per attempt (attempt_no 1-based per segment). Each links its OWN sync_job_id — a segment
--    never stores a single mutable sync_job pointer, so a retry after a failure preserves the earlier
--    attempt and its job. result is the attempt outcome (ACTIVE while running, then SUCCEEDED | FAILED);
--    the segment's execution_state is derived from the latest attempt. scope_confirmed records that the
--    operator confirmed the actual readExportScope matched this segment before exporting.
create table if not exists review_import_segment_attempt (
    id                uuid         primary key,
    segment_id        uuid         not null references review_import_segment (id),
    org_id            uuid         not null references organizations (id),
    attempt_no        integer      not null,
    sync_job_id       uuid         references sync_jobs (id),
    scope_confirmed   boolean      not null default false,
    result            varchar(16)  not null default 'ACTIVE',      -- ACTIVE | SUCCEEDED | FAILED
    rows_new          integer,
    rows_duplicate    integer,
    rows_failed       integer,
    error_message     text,
    started_at        timestamptz,
    finished_at       timestamptz,
    created_at        timestamptz  not null,
    updated_at        timestamptz  not null
);
create unique index if not exists uq_review_import_attempt_no
    on review_import_segment_attempt (segment_id, attempt_no);
create index if not exists idx_review_import_attempt_segment
    on review_import_segment_attempt (segment_id, attempt_no);
