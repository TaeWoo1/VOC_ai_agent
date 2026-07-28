-- Review Issue feedback: the operator tells us whether a repeated-issue CANDIDATE was useful
-- (유용함 / 관련 없음 / 나중에 보기). This is OFFLINE EVALUATION DATA ONLY — it changes no
-- lifecycle transition, no queue membership, no judgement, and asserts nothing about the customer.
-- It is the issue-side analogue of the review-eval label seed: honest signal about whether the
-- DRAFT/UNMEASURED detector is surfacing the right things, kept so a later labeling/eval session can
-- read it. See docs/slices/review-issue-action-loop-v1.md and contracts/review-issue/v1/THRESHOLDS.md.
--
-- Why its OWN table, not an existing model (migration justification, per the standing rule):
--   * review_reply_draft / review_reply_approval / review_reply_outcome are REVIEW-scoped (keyed by
--     review, not issue) and are about a reply, not about an issue candidate's usefulness.
--   * review_issue_state_events records SYSTEM/OPERATOR lifecycle TRANSITIONS with a closed reason
--     vocabulary (OBSERVING→NEEDS_REVIEW, dismiss, restore, …). Feedback is not a lifecycle
--     transition; overloading that table would corrupt the lifecycle audit and its reason enum.
--   * There is no existing issue-scoped, operator-authored, non-lifecycle record. A narrow
--     append-only table is the minimal representable addition.
--
-- Append-only IS the history — like review_reply_outcome / review_reply_work_dismissal — so no
-- updated_at and no separate audit table. Additive only (no drops); IF NOT EXISTS keeps re-runs safe.
--
-- Org-scoped only (like review_issues): issues carry no seller_account_id/channel_id, and neither
-- does their feedback. Carries no review id, no customer text, no body — only which issue, which
-- feedback, who, and the client's idempotency key.
create table if not exists review_issue_feedback (
    id          uuid         primary key,
    org_id      uuid         not null references organizations (id),
    issue_id    uuid         not null references review_issues (id),
    kind        varchar(24)  not null,
    command_id  varchar(120) not null,
    created_by  varchar(120) not null,
    created_at  timestamptz  not null
);

-- Org-scoped idempotency: a repeated feedback with the same command_id collides here rather than
-- appending a second row — the same pattern review_reply_outcome (V20) and the dismissal log (V25)
-- use. The service's replay lookup is only a fast path; concurrent idempotency comes from here.
create unique index if not exists uq_review_issue_feedback_org_command
    on review_issue_feedback (org_id, command_id);

-- Reads/eval-exports are per-issue, newest-first.
create index if not exists idx_review_issue_feedback_issue
    on review_issue_feedback (org_id, issue_id, created_at desc);
