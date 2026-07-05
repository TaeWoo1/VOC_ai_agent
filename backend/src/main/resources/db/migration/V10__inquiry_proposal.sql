-- Phase: seller-initiated inquiry proposal (OPEN -> PROPOSED).
-- Additive only. IF NOT EXISTS keeps re-runs / partial-applies safe.
--
-- One coarse proposal per work item. It stores ONLY sanitized decision metadata:
-- the action kind, a coarse summary_category, the approval requirement, the actor
-- that authored it, and provider provenance. It deliberately persists NO inquiry
-- body, NO reply-draft text, NO buyer identity, and NO reply token.
create table if not exists inquiry_proposal (
    id                uuid         primary key,
    org_id            uuid         not null references organizations (id),
    work_item_id      uuid         not null references inquiry_work_item (id),
    inquiry_id        uuid         not null references inquiries (id),
    action_kind       varchar(40)  not null,
    summary_category  varchar(80)  not null,
    requires_approval boolean      not null,
    proposed_by       varchar(120) not null,
    provider_kind     varchar(40)  not null,
    provider_name     varchar(80)  not null,
    provider_version  varchar(40)  not null,
    created_at        timestamptz  not null,
    updated_at        timestamptz  not null
);

-- One proposal per work item: backs replay-safety and the concurrent-uniqueness race.
create unique index if not exists uq_inquiry_proposal_work_item
    on inquiry_proposal (work_item_id);
create index if not exists idx_inquiry_proposal_org
    on inquiry_proposal (org_id, created_at desc);
