-- Agentic Operating Workspace v2 §A2/§A3 — what reviewnary DID with an approved review reply, and
-- what it could VERIFY about it. Two lanes, one table:
--
--   API lane (Cafe24)   — reviewnary POSTs the approved body as a board comment, exactly once, then
--                         reads the comments back and compares a content hash.
--   Guided lane (NAVER) — the collector fills the seller-center composer with the approved body and
--                         the SELLER submits; reviewnary only observes.
--
-- `review_reply_outcome` (V20) is left exactly as it is, CHECK and all: it records the operator's
-- own report and can only ever say UNVERIFIED. This table records reviewnary's own actions and
-- observations, whose vocabulary is different and closed:
--
--   status        POSTED | REFUSED | DELIVERY_UNKNOWN | COMPOSER_FILLED | SELLER_SUBMISSION_OBSERVED
--   verification  VERIFIED | STATUS_UNRESOLVED | DELIVERY_UNKNOWN | UNVERIFIABLE
--               | COMPOSER_FILLED | SELLER_SUBMISSION_OBSERVED | SUBMISSION_OBSERVED_CONTENT_UNVERIFIED
--
-- VERIFIED is reachable ONLY on the API lane, where the posted comment's content hash can be read
-- back and compared to the approved fingerprint's body. The guided lane has no content oracle, so
-- its ceiling is SUBMISSION_OBSERVED_CONTENT_UNVERIFIED (a later channel read says a reply exists;
-- nothing says it is the approved text). Answer Memory reads nothing below VERIFIED.
--
-- Append-only: every row is one action or one observation, never updated. (org_id, command_id) is
-- UNIQUE — the client's idempotency key, org-scoped like V18/V19/V20. The reply body is NOT here;
-- the approved fingerprint identifies it and `provider_ref` is the channel's own handle (a comment
-- number) — never a person, never page content.
create table if not exists review_reply_execution (
    id                    uuid         primary key,
    org_id                uuid         not null references organizations (id),
    review_id             uuid         not null references reviews (id),
    seller_account_id     uuid         not null references seller_accounts (id),
    channel_code          varchar(32)  not null,
    lane                  varchar(16)  not null,
    approved_version      integer      not null,
    approved_fingerprint  varchar(64)  not null,
    command_id            varchar(120) not null,
    submission_ref        varchar(16),
    status                varchar(40)  not null,
    provider_ref          varchar(64),
    -- Why a REFUSED row was refused, closed (ReviewExecutionReason); null on every other status.
    reason                varchar(48),
    verification          varchar(48),
    observed_at           timestamptz,
    recorded_by           varchar(120) not null,
    created_at            timestamptz  not null,
    constraint chk_review_reply_execution_version check (approved_version > 0),
    constraint chk_review_reply_execution_lane check (lane in ('API', 'GUIDED')),
    constraint chk_review_reply_execution_status check (status in (
        'POSTED', 'REFUSED', 'DELIVERY_UNKNOWN', 'COMPOSER_FILLED', 'SELLER_SUBMISSION_OBSERVED')),
    constraint chk_review_reply_execution_verification check (verification is null or verification in (
        'VERIFIED', 'STATUS_UNRESOLVED', 'DELIVERY_UNKNOWN', 'UNVERIFIABLE',
        'COMPOSER_FILLED', 'SELLER_SUBMISSION_OBSERVED', 'SUBMISSION_OBSERVED_CONTENT_UNVERIFIED'))
);

create unique index if not exists uq_review_reply_execution_org_command
    on review_reply_execution (org_id, command_id);
create index if not exists idx_review_reply_execution_review
    on review_reply_execution (org_id, review_id, created_at desc);
create index if not exists idx_review_reply_execution_submission
    on review_reply_execution (submission_ref, created_at desc)
    where submission_ref is not null;
