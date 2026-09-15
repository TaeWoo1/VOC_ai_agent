-- Responsibility Runtime v1 — Package B: OperationsCase (docs/responsibility_runtime_v1.md §22).
--
-- PD-3 is decided: an OperationsCase is NOT a new table. It is a row of proactive_case that a responsibility owns,
-- and every column below is ADDITIVE and NULLABLE, so a proactive row written before this migration — or by the
-- proactive loop after it — is byte-identical in meaning. The two producers are told apart by one fact:
-- responsibility_id is null for a proactive case and not null for an operations case, and each entity reads only
-- its own half (Hibernate @SQLRestriction on both mappings).
--
-- What stays exactly as it was, deliberately:
--   * uq_proactive_case_open_subject — still ONE open card per subject, now across both producers. The proactive
--     loop yields an organisation whose customer-operations responsibility is ACTIVE, so they do not compete.
--   * uq_proactive_case_signature — an operations signature is computed over different material (prefix `rr:`), so
--     the two identity spaces cannot collide.
--   * status is still DERIVED: the operations reconciler re-reads the inquiry / review / run-source truth and is the
--     only writer. Nothing here can mark a customer answered, a refund issued or a reply sent.

alter table proactive_case add column if not exists responsibility_id uuid references responsibility (id);
-- The run whose observation first raised this case, and the latest run that saw it again.
alter table proactive_case add column if not exists origin_run_id uuid references responsibility_run (id);
alter table proactive_case add column if not exists last_run_id uuid references responsibility_run (id);
-- CUSTOMER_WORK: one inquiry or review. OBSERVATION_GAP: a source Reviewnary could not read, for a reason only
-- the seller can fix (subject_kind = SOURCE, subject_id = the seller account).
alter table proactive_case add column if not exists case_kind varchar(24);
-- Who may carry the next step: AUTO (Reviewnary's own state only) or HUMAN (a customer message, money, an uncertain
-- judgement — anything that leaves Reviewnary).
alter table proactive_case add column if not exists required_authority varchar(8);
alter table proactive_case add column if not exists disposition varchar(24);
-- RULE (deterministic Attention / thread / status rules) or AGENT (the backend investigator's strict output).
alter table proactive_case add column if not exists decided_by varchar(8);
alter table proactive_case add column if not exists summary text;
alter table proactive_case add column if not exists recommended_action_type varchar(32);
-- A JSON array of short seller-language strings. Never a customer sentence.
alter table proactive_case add column if not exists missing_information text;
alter table proactive_case add column if not exists confidence varchar(8);
alter table proactive_case add column if not exists resolution_reason varchar(32);
alter table proactive_case add column if not exists reconciled_at timestamptz;
-- When the one exception summary mail that included this case was sent. Each case is mailed at most once.
alter table proactive_case add column if not exists notified_at timestamptz;

alter table proactive_case add constraint ck_proactive_case_owner_shape check (
    (responsibility_id is null and case_kind is null and origin_run_id is null and required_authority is null
        and disposition is null and decided_by is null and resolution_reason is null)
    or (responsibility_id is not null and case_kind is not null and origin_run_id is not null
        and required_authority is not null)
);
alter table proactive_case add constraint ck_proactive_case_kind check (
    case_kind is null or case_kind in ('CUSTOMER_WORK', 'OBSERVATION_GAP'));
alter table proactive_case add constraint ck_proactive_case_kind_subject check (
    case_kind is null
    or (case_kind = 'CUSTOMER_WORK' and subject_kind in ('INQUIRY', 'REVIEW'))
    or (case_kind = 'OBSERVATION_GAP' and subject_kind = 'SOURCE'));
alter table proactive_case add constraint ck_proactive_case_authority check (
    required_authority is null or required_authority in ('AUTO', 'HUMAN'));
alter table proactive_case add constraint ck_proactive_case_disposition check (
    disposition is null or disposition in ('AUTO_RESOLVED', 'MONITORING', 'NEEDS_DECISION'));
-- A case Reviewnary resolved on its own is not waiting for anyone.
alter table proactive_case add constraint ck_proactive_case_auto_resolved_closed check (
    disposition is distinct from 'AUTO_RESOLVED' or status <> 'PREPARED');
-- A gap is never "decided" by the agent; its disposition column stays empty.
alter table proactive_case add constraint ck_proactive_case_gap_no_disposition check (
    case_kind is distinct from 'OBSERVATION_GAP' or disposition is null);
alter table proactive_case add constraint ck_proactive_case_decider check (
    decided_by is null or decided_by in ('RULE', 'AGENT'));
alter table proactive_case add constraint ck_proactive_case_confidence check (
    confidence is null or confidence in ('LOW', 'MEDIUM', 'HIGH'));

create index if not exists idx_operations_case_responsibility
    on proactive_case (responsibility_id, status, updated_at desc)
    where responsibility_id is not null;

-- The case's history. Append-only: a row is written and never changed or removed.
--
-- provenance is metadata only — model, prompt/schema/tool/evidence versions, tool names with argument DIGESTS,
-- short local evidence refs, token counts and elapsed time. No customer sentence, no seller sentence, no draft
-- body (the copy of each of those is the one row that owns it).
create table if not exists operations_case_event (
    id                uuid         primary key,
    org_id            uuid         not null references organizations (id),
    case_id           uuid         not null references proactive_case (id),
    run_id            uuid         references responsibility_run (id),
    actor             varchar(8)   not null check (actor in ('SYSTEM', 'AGENT', 'SELLER')),
    kind              varchar(32)  not null,
    disposition       varchar(24),
    resolution_reason varchar(32),
    provenance        text,
    created_at        timestamptz  not null,
    updated_at        timestamptz  not null
);

create index if not exists idx_operations_case_event_case on operations_case_event (case_id, created_at);
create index if not exists idx_operations_case_event_run on operations_case_event (org_id, run_id);

create or replace function operations_case_event_append_only() returns trigger as $$
begin
    raise exception 'operations_case_event is append-only';
end;
$$ language plpgsql;

drop trigger if exists trg_operations_case_event_append_only on operations_case_event;
create trigger trg_operations_case_event_append_only
    before update or delete on operations_case_event
    for each row execute function operations_case_event_append_only();

-- One exception summary per run end, at most. NONE_NEEDED: nothing new needed the seller. UNDELIVERABLE: something
-- did, and this deployment has no way to mail it (the cases stay un-notified and are included next time).
alter table responsibility_run add column if not exists notification_state varchar(16);
alter table responsibility_run add column if not exists notified_at timestamptz;
alter table responsibility_run add constraint ck_responsibility_run_notification check (
    notification_state is null or notification_state in ('NONE_NEEDED', 'SENT', 'UNDELIVERABLE', 'FAILED'));

comment on column proactive_case.responsibility_id is
  'Null for a Proactive Operations Agent case; the owning responsibility for an OperationsCase (Package B).';
comment on table operations_case_event is
  'OperationsCase history, append-only. Provenance is metadata only — never customer or seller text.';
