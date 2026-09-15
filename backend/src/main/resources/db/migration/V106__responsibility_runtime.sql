-- Responsibility Runtime v1 — Package A (docs/responsibility_runtime_v1.md §16, §19-A).
--
-- Three tables and nothing else. No existing table changes; proactive_case is not touched (PD-3 open).
--
--   responsibility            "this organisation handed Reviewnary this job"      — one per org × template
--   responsibility_run        "this logical 2-hour window was worked like this"    — identity = (responsibility, window_start)
--   responsibility_run_source "this source was observed this far, in this attempt" — the observation fact
--
-- The windows are fixed 2-hour slots aligned to Asia/Seoul even hours. A window is a pure function of the
-- instant, so a scheduler restart cannot produce a different window for the same moment.

create table responsibility (
    id               uuid        primary key,
    org_id           uuid        not null references organizations (id) on delete cascade,
    template_code    varchar(48) not null,
    template_version integer     not null,
    status           varchar(16) not null,
    next_run_at      timestamptz,
    activated_by     uuid,
    activated_at     timestamptz,
    paused_at        timestamptz,
    stopped_at       timestamptz,
    created_at       timestamptz not null,
    updated_at       timestamptz not null,
    constraint uq_responsibility_org_template unique (org_id, template_code),
    constraint chk_responsibility_status check (status in ('ACTIVE', 'PAUSED', 'STOPPED')),
    constraint chk_responsibility_template check (template_code in ('CUSTOMER_OPERATIONS_V1')),
    -- Only an ACTIVE responsibility has a next window. PAUSED/STOPPED cannot be picked up by the materializer
    -- even by a query that forgot to filter on status.
    constraint chk_responsibility_next_run check (status = 'ACTIVE' or next_run_at is null)
);

create index idx_responsibility_due on responsibility (next_run_at) where status = 'ACTIVE';

comment on table responsibility is
    'Responsibility Runtime v1: an organisation handed Reviewnary a job (template). One row per org x template.';
comment on column responsibility.next_run_at is
    'Start of the next 2h Asia/Seoul window to materialize. Always a window boundary. Null unless ACTIVE.';

create table responsibility_run (
    id                uuid        primary key,
    org_id            uuid        not null references organizations (id) on delete cascade,
    responsibility_id uuid        not null references responsibility (id) on delete cascade,
    template_version  integer     not null,
    window_start      timestamptz not null,
    window_end        timestamptz not null,
    run_trigger       varchar(16) not null,
    status            varchar(16) not null,
    attempt           integer     not null default 0,
    lease_owner       varchar(64),
    lease_until       timestamptz,
    next_attempt_at   timestamptz,
    started_at        timestamptz,
    finished_at       timestamptz,
    failure_reason    varchar(40),
    created_at        timestamptz not null,
    updated_at        timestamptz not null,
    -- R1: one logical run per window.
    constraint uq_responsibility_run_window unique (responsibility_id, window_start),
    constraint chk_responsibility_run_window check (window_end > window_start),
    constraint chk_responsibility_run_status
        check (status in ('PENDING', 'RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED', 'CANCELLED')),
    constraint chk_responsibility_run_trigger check (run_trigger in ('ACTIVATION', 'SCHEDULED', 'RESUME')),
    constraint chk_responsibility_run_attempt check (attempt >= 0),
    -- A RUNNING run always names who holds it and until when; that is what makes a crash recoverable.
    constraint chk_responsibility_run_lease
        check (status <> 'RUNNING' or (lease_owner is not null and lease_until is not null)),
    -- Only a run that may be retried carries a retry time.
    constraint chk_responsibility_run_retry
        check (next_attempt_at is null or status in ('PARTIAL', 'FAILED'))
);

-- R2: at most one RUNNING run per responsibility, enforced by the database rather than by the scheduler
-- remembering to check. Two instances that both think they may claim collide here.
create unique index uq_responsibility_run_active on responsibility_run (responsibility_id) where status = 'RUNNING';
create index idx_responsibility_run_claimable on responsibility_run (status, window_start);

comment on table responsibility_run is
    'Responsibility Runtime v1: one logical 2h work window. Retries reuse the row (attempt++); never a second row.';

create table responsibility_run_source (
    id                uuid        primary key,
    org_id            uuid        not null references organizations (id) on delete cascade,
    run_id            uuid        not null references responsibility_run (id) on delete cascade,
    attempt           integer     not null,
    seller_account_id uuid        not null references seller_accounts (id) on delete cascade,
    channel_code      varchar(32) not null,
    data_type         varchar(32) not null,
    method            varchar(16) not null,
    recipe_version    varchar(80),
    window_from       timestamptz not null,
    window_to         timestamptz not null,
    cursor_from       text,
    cursor_to         text,
    started_at        timestamptz not null,
    observed_at       timestamptz,
    completeness      varchar(16),
    observed_count    integer,
    new_count         integer,
    changed_count     integer,
    failure_reason    varchar(32),
    identity_verdict  varchar(16) not null,
    sync_job_id       uuid references sync_jobs (id) on delete set null,
    created_at        timestamptz not null,
    updated_at        timestamptz not null,
    constraint uq_responsibility_run_source_attempt unique (run_id, seller_account_id, data_type, attempt),
    constraint chk_responsibility_run_source_completeness
        check (completeness is null or completeness in ('COMPLETE', 'BOUNDED', 'PARTIAL', 'NONE')),
    constraint chk_responsibility_run_source_identity
        check (identity_verdict in ('MATCH', 'MISMATCH', 'UNRESOLVED', 'NOT_APPLICABLE')),
    -- R5, in the schema: a source that was not observed cannot carry a count. «0건 관측» and «확인하지 못함»
    -- are different rows, and the second one has no number to misread.
    constraint chk_responsibility_run_source_none_has_no_count
        check (completeness is distinct from 'NONE'
               or (observed_count is null and new_count is null and changed_count is null)),
    constraint chk_responsibility_run_source_none_has_reason
        check (completeness is distinct from 'NONE' or failure_reason is not null),
    constraint chk_responsibility_run_source_complete_has_no_reason
        check (completeness is distinct from 'COMPLETE' or failure_reason is null)
);

create index idx_responsibility_run_source_run on responsibility_run_source (run_id);

comment on table responsibility_run_source is
    'Responsibility Runtime v1: how far one source was observed in one attempt of a run. NONE carries no count.';
comment on column responsibility_run_source.observed_count is
    'Rows actually received in this observation. With BOUNDED/PARTIAL it is the rows of THIS read, never the source total.';
