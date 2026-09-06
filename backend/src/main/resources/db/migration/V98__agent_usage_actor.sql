-- Agent Runtime Pilot QA (2026-09-06): separate WHO spent a model call from WHOSE org spent it.
--
-- The daily budget existed to stop a seller's own use running away, but it counted every call against
-- the org with no notion of who initiated one. A benchmark and a QA sitting both sign in as a real
-- account, so their calls landed in that seller's meter: on the demo org, 1,211 runs against a limit
-- of 200. With `enforced=true` — the pilot default — that is a seller refused for the day by work
-- they never asked for.
--
-- METERING IS UNCHANGED: every call still writes a row, so usage, latency and cost reporting see
-- exactly what they saw before. Only ENFORCEMENT narrows, and it narrows to USER.
--
-- USER for every existing row: it is the value the product wrote when there was only one, and a
-- backfill that guessed otherwise would relabel calls nobody observed.
alter table agent_llm_usage
    add column actor varchar(16) not null default 'USER';

-- Enforcement counts USER rows for one org and day; reporting reads the whole table.
create index if not exists ix_agent_llm_usage_org_date_actor
    on agent_llm_usage (org_id, usage_date, actor);
