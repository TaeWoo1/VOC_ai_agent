-- Proactive Operations Agent v1 (2026-08-25)
--
-- ONE table, and it owns no work.
--
-- The seller's work already has a home: an inquiry's lifecycle lives on inquiry_work_item and
-- a review's on the review row plus its reply ledger. A second queue with its own phases would
-- be a second authority over the same work, and the first time the two disagreed nobody could
-- say which was right. So this table is an ANNOTATION on work that already exists: why it is
-- worth the seller's attention right now, what was investigated, and what has been prepared.
--
-- status is DERIVED, never commanded. The reconciler recomputes it from the subject's own truth
-- (work item phase, inquiry operational state, review reply state) on every tick; nothing here
-- is transitioned by a seller action against this row. That is what keeps it a projection.
create table if not exists proactive_case (
    id                uuid         primary key,
    org_id            uuid         not null references organizations (id),

    -- WHAT this case is about. subject_id is an inquiry id or a review id; the kind says which.
    -- Deliberately not two nullable FKs: a row that could name both could name neither correctly.
    subject_kind      varchar(16)  not null,
    subject_id        uuid         not null,
    -- The inquiry's work item, when the subject is an inquiry. This is the JOIN to the existing
    -- lifecycle, and it is what the [확인하기] control navigates to.
    work_item_id      uuid         references inquiry_work_item (id),
    channel_id        uuid         references channels (id),
    product_id        uuid         references products (id),

    -- Dedupe identity: org + subject + the SOURCE STATE the investigation was performed against.
    -- A source that has not changed produces the same signature and therefore no second card; a
    -- source that HAS changed produces a new signature, and the old case is closed as superseded
    -- rather than silently edited.
    signature         varchar(64)  not null,
    source_state      varchar(200) not null,

    status            varchar(16)  not null,
    priority          varchar(16)  not null,
    reason            varchar(48)  not null,
    -- One or two sentences, seller language, composed from operational facts only. No buyer
    -- identity, no raw body, no order id — the same sanitation every other read here carries.
    reason_note       text         not null,

    -- WHAT WAS FOUND. evidence_state is DraftKnowledgeState for an inquiry (GROUNDED / NO_MATCH /
    -- NO_LIBRARY / NO_PRODUCT) and null for a review, which has no draft to ground.
    evidence_state    varchar(24),
    evidence_count    integer      not null default 0,
    knowledge_gap     text,

    -- WHAT IS PREPARED. A prepared draft is NOT an approval: the draft lands on the existing
    -- append-only inquiry_reply_draft and the human approval boundary is untouched.
    prepared_action   varchar(32)  not null,
    draft_version     integer,
    recommendation    text,

    -- Telemetry, as timestamps on the case rather than a second event stream. Everything after
    -- the seller acts (draft edited, approved, executed, verified) is already recorded on
    -- inquiry_work_item_audit / inquiry_execution / inquiry_verification and is not copied here.
    surfaced_at       timestamptz,
    opened_at         timestamptz,
    acted_at          timestamptz,
    closed_at         timestamptz,
    close_reason      varchar(32),

    created_at        timestamptz  not null,
    updated_at        timestamptz  not null
);

-- One investigation per (subject, source state). A tick that re-reads an unchanged source finds
-- this row and writes nothing.
create unique index if not exists uq_proactive_case_signature
    on proactive_case (org_id, subject_kind, subject_id, signature);

-- At most ONE open case per subject, enforced by the database rather than by the reconciler's
-- good behaviour. This is the structural form of "same signal duplicate proactive card 0".
create unique index if not exists uq_proactive_case_open_subject
    on proactive_case (org_id, subject_kind, subject_id)
    where status = 'PREPARED';

-- The list read: one org's open cases, most urgent first.
create index if not exists idx_proactive_case_org_status
    on proactive_case (org_id, status, priority, created_at desc);

comment on table proactive_case is
  'Proactive Operations Agent v1: why existing work matters now, what was investigated, what is prepared. Owns no work state.';
comment on column proactive_case.status is
  'PREPARED (waiting for the seller) / ACTED (the seller acted) / CLOSED (no longer actionable). Derived from the subject, never commanded.';
comment on column proactive_case.signature is
  'sha256 over org + subject kind + subject id + source state — the dedupe identity.';
