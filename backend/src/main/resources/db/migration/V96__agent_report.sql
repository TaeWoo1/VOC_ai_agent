-- Agentic Report v1 (2026-09-04): one stored snapshot per (org, cadence, period, version).
--
-- Why a table: the seller reopens a report and must read the same thing. The facts are re-derivable
-- today and would not be tomorrow (evidence is reconciled, decisions change, a re-import lands), and
-- the narrative is a model call that must not be repeated on every refresh. So the moment of
-- generation is stored: facts as JSON, the deterministic summary as JSON, and the validated narrative
-- as JSON when there was one. `version` is how a seller asks for a newer reading without losing the
-- one they already read — regeneration appends, it never overwrites.
create table agent_report (
    id                uuid primary key,
    org_id            uuid not null references organizations (id),
    kind              varchar(16) not null,
    period_start      date not null,
    period_end        date not null,
    version           integer not null,
    facts_json        text not null,
    summary_json      text not null,
    narrative_json    text,
    narrative_status  varchar(24) not null,
    narrative_version varchar(200),
    generated_at      timestamptz not null,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);

create unique index uq_agent_report_period_version
    on agent_report (org_id, kind, period_start, version);
create index idx_agent_report_org_kind
    on agent_report (org_id, kind, period_start desc, version desc);
