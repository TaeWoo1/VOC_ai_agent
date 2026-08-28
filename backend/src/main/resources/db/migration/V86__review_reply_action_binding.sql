-- Agentic Operating Workspace v2 — Acceptance Closure. Two corrections the product owner added after
-- the plan was approved, both about what a review-reply ACTION is bound to.
--
-- 1) review_reply_submission_ref becomes the guided lane's action intent, not just a token. The
--    approval (V19) binds (org, review, version, fingerprint) — the seller's decision about a text.
--    The intent adds who acts where and how: the seller account, its channel, the executable
--    identity the review resolved to at mint, the operation, and the execution mode. It is spent
--    exactly once by the Local Agent (`target_resolved_at`) and expires. Rows minted before this
--    migration carry nulls and can never be spent by the target route — a binding this table cannot
--    prove is refused, not assumed.
--
-- 2) One public reply per review on the API lane. A fresh command id against a review whose
--    approved text was already POSTED (or whose delivery is unknown — it MAY have arrived) must not
--    POST again; the service refuses and this partial unique index is the boundary under a race.
alter table review_reply_submission_ref
    add column if not exists seller_account_id   uuid references seller_accounts (id),
    add column if not exists channel_id          uuid references channels (id),
    add column if not exists executable_identity varchar(16),
    add column if not exists operation           varchar(32) not null default 'REVIEW_REPLY',
    add column if not exists execution_mode      varchar(40),
    add column if not exists expires_at          timestamptz,
    add column if not exists target_resolved_at  timestamptz;

alter table review_reply_submission_ref
    drop constraint if exists chk_review_reply_submission_ref_operation;
alter table review_reply_submission_ref
    add constraint chk_review_reply_submission_ref_operation
        check (operation = 'REVIEW_REPLY');
alter table review_reply_submission_ref
    drop constraint if exists chk_review_reply_submission_ref_mode;
alter table review_reply_submission_ref
    add constraint chk_review_reply_submission_ref_mode
        check (execution_mode is null or execution_mode in ('GUIDED_BROWSER_EXECUTION', 'API_EXECUTION'));
alter table review_reply_submission_ref
    drop constraint if exists chk_review_reply_submission_ref_identity;
alter table review_reply_submission_ref
    add constraint chk_review_reply_submission_ref_identity
        check (executable_identity is null or executable_identity in ('MARKETPLACE', 'NONE'));

create unique index if not exists uq_review_reply_execution_api_sent
    on review_reply_execution (org_id, review_id)
    where lane = 'API' and status in ('POSTED', 'DELIVERY_UNKNOWN');
