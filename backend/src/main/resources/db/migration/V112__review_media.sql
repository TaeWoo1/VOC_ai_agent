-- Customer Ops Demo Closure v1 — a review's photos as canonical rows, and what (if anything) was seen in them.
--
-- A row is a REFERENCE the observation read off the channel (the CDN address of one attachment), never the image:
-- no bytes are stored here. Inspection is a separate, explicit fact: a row is NOT_INSPECTED until a vision model
-- actually looked at the fetched bytes, so «we saw a photo» and «we looked at the photo» can never be confused.
create table if not exists review_media (
    id                   uuid          primary key,
    org_id               uuid          not null,
    review_id            uuid          not null references reviews (id) on delete cascade,
    ordinal              integer       not null check (ordinal between 1 and 20),
    media_kind           varchar(16)   not null check (media_kind in ('IMAGE', 'VIDEO', 'UNKNOWN')),
    source_url           text          not null,
    source_host          varchar(255)  not null,
    observed_by          varchar(60)   not null,
    observed_at          timestamptz   not null,
    inspection_status    varchar(24)   not null default 'NOT_INSPECTED'
        check (inspection_status in ('NOT_INSPECTED', 'INSPECTED', 'FETCH_FAILED', 'MODEL_FAILED', 'NOT_AN_IMAGE')),
    inspected_at         timestamptz,
    inspection_model     varchar(160),
    depicts              text,
    problem_visible      varchar(12)   check (problem_visible in ('YES', 'NO', 'UNCLEAR')),
    problem_description  text,
    inspection_failure   varchar(40),
    created_at           timestamptz   not null,
    updated_at           timestamptz   not null,
    constraint uq_review_media_ordinal unique (review_id, ordinal),
    -- What was seen exists only when something was looked at.
    constraint ck_review_media_inspected_shape
        check (inspection_status = 'INSPECTED' or (depicts is null and problem_visible is null))
);

create index if not exists idx_review_media_org_review on review_media (org_id, review_id);
