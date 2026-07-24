-- 내 답변 작업 "작업에서 제외": the operator sets a review ASIDE from their reply to-do list without
-- claiming a reply happened. It removes the review from the to-do ONLY; it deletes/mutates no draft,
-- writes no reported outcome, and implies no completion.
--
-- Scope, exactly: an append-only dismissal record. A dismissal is the operator's own decision to
-- stop treating a review as active reply work — a fact about their intent, not about NAVER and not
-- about the reply's fate. It is deliberately its OWN table, not a column on review_triage (a
-- draft-only review may carry no triage row, and a dismissal is not a triage disposition) and not an
-- outcome (an outcome claims a post; this claims nothing).
--
-- Re-entry is automatic and read-time, never a stored "restore": the to-do predicate includes an
-- otherwise-eligible review again once its latest RESPONSE_NEEDED triage decision OR its latest saved
-- draft version is NEWER than its latest dismissal. So this table only ever records dismissals; the
-- two committing actions (re-mark RESPONSE_NEEDED, save a new draft) supersede by timestamp.
--
-- Append-only IS the history — like review_reply_outcome / review_reply_draft — so no updated_at and
-- no separate audit table. Additive only (no drops); IF NOT EXISTS keeps re-runs safe, matching V20.
--
-- NO seller_account_id and NO channel_id — same reasons as V19/V20: reviews carries no account, and a
-- channel column would be a reader-less denormalization (the read resolves the channel via the
-- account, exactly like every other reply-work read).
create table if not exists review_reply_work_dismissal (
    id            uuid         primary key,
    org_id        uuid         not null references organizations (id),
    review_id     uuid         not null references reviews (id),
    command_id    varchar(120) not null,
    dismissed_by  varchar(120) not null,
    dismissed_at  timestamptz  not null
);
-- Org-scoped idempotency: a repeated dismissal with the same command_id collides here rather than
-- appending a second row — the same pattern review_reply_outcome uses (V20). The service's replay
-- lookup is only a fast path; this is where concurrent idempotency actually comes from.
create unique index if not exists uq_review_reply_work_dismissal_org_command
    on review_reply_work_dismissal (org_id, command_id);
-- The read compares MAX(dismissed_at) per review against the latest committing signal; index for it.
create index if not exists idx_review_reply_work_dismissal_review
    on review_reply_work_dismissal (review_id, dismissed_at desc);
