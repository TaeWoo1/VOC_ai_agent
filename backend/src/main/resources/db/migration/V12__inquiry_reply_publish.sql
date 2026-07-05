-- Phase: seller-confirmed ESM reply publish — approval binding + action intent +
-- execution + verification. Additive only; IF NOT EXISTS keeps re-runs safe.
--
-- Flow: PROPOSED -(confirm+bind)-> ACTION_PENDING -(dispatch)-> DISPATCHING ->
-- EXECUTED | DELIVERY_UNKNOWN -(verify by re-query informStatus == 처리완료)->
-- COMPLETED | FAILED. Approval binds immutably to one draft (version + fingerprint);
-- the draft is frozen by the phase gate once it leaves PROPOSED.

-- Immutable approval binding (one per work item), bound to the exact draft version.
create table if not exists inquiry_approval (
    id                    uuid         primary key,
    org_id                uuid         not null references organizations (id),
    work_item_id          uuid         not null references inquiry_work_item (id),
    approved_draft_version integer     not null,
    approved_fingerprint  varchar(64)  not null,
    command_id            varchar(120) not null,
    approver              varchar(120) not null,
    created_at            timestamptz  not null,
    constraint chk_inquiry_approval_version check (approved_draft_version > 0)
);
create unique index if not exists uq_inquiry_approval_work_item
    on inquiry_approval (work_item_id);

-- The publish intent — what WOULD be sent, bound to the approved fingerprint.
create table if not exists inquiry_action_intent (
    id                   uuid         primary key,
    org_id               uuid         not null references organizations (id),
    work_item_id         uuid         not null references inquiry_work_item (id),
    approved_fingerprint varchar(64)  not null,
    action_kind          varchar(40)  not null,
    created_at           timestamptz  not null
);
create unique index if not exists uq_inquiry_action_intent_work_item
    on inquiry_action_intent (work_item_id);

-- The execution record + its explicit state. dispatch_key is a single-dispatch
-- guard (NOT a guarantee of exactly-once external delivery); status is the
-- authoritative execution state.
create table if not exists inquiry_execution (
    id                   uuid         primary key,
    org_id               uuid         not null references organizations (id),
    work_item_id         uuid         not null references inquiry_work_item (id),
    action_intent_id     uuid         not null references inquiry_action_intent (id),
    dispatch_key         varchar(64)  not null,
    status               varchar(32)  not null,
    failure_reason       varchar(40),
    provider_message_no  varchar(120),
    result_code          integer,
    verify_attempts      integer      not null,
    created_at           timestamptz  not null,
    updated_at           timestamptz  not null
);
create unique index if not exists uq_inquiry_execution_work_item
    on inquiry_execution (work_item_id);
create unique index if not exists uq_inquiry_execution_dispatch_key
    on inquiry_execution (dispatch_key);

-- Append-only verification attempts (re-query of informStatus). verified is true
-- only when the exact inquiry returned 처리완료; answerDate is never consulted.
create table if not exists inquiry_verification (
    id             uuid         primary key,
    org_id         uuid         not null references organizations (id),
    work_item_id   uuid         not null references inquiry_work_item (id),
    execution_id   uuid         not null references inquiry_execution (id),
    verified       boolean      not null,
    observed_status varchar(40),
    created_at     timestamptz  not null
);
create index if not exists idx_inquiry_verification_execution
    on inquiry_verification (execution_id, created_at);
