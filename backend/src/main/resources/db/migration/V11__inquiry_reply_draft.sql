-- Phase: seller-editable ESM answer reply-draft (pre-approval).
-- Additive only. IF NOT EXISTS keeps re-runs / partial-applies safe.
--
-- Append-only, versioned drafts: a change never mutates a row — it inserts the
-- next version, so an approved version can later bind immutably to one fingerprint.
-- Only the minimal identity is kept (org_id, work_item_id, version); the inquiry/
-- proposal are reachable via the work item, so no redundant inquiry_id/proposal_id.
-- There is no updated_at (a change is a new version). The draft stores ONLY the
-- seller-owned answer fields (title, comments) — never a token, messageNo, author,
-- or buyer data. answer_status is backend-fixed (2) but the check allows the ESM
-- reply set {1,2}.
create table if not exists inquiry_reply_draft (
    id                    uuid         primary key,
    org_id                uuid         not null references organizations (id),
    work_item_id          uuid         not null references inquiry_work_item (id),
    version               integer      not null,
    answer_status         integer      not null,
    title                 text         not null,
    comments              text         not null,
    content_fingerprint   varchar(64)  not null,
    fingerprint_algorithm varchar(40)  not null,
    created_by            varchar(120) not null,
    created_at            timestamptz  not null,
    constraint chk_inquiry_reply_draft_version check (version > 0),
    constraint chk_inquiry_reply_draft_answer_status check (answer_status in (1, 2))
);

-- One row per (work item, version): serializes concurrent saves and makes prior
-- versions immutable by construction.
create unique index if not exists uq_inquiry_reply_draft_work_item_version
    on inquiry_reply_draft (work_item_id, version);
-- Latest-version lookup (the current draft).
create index if not exists idx_inquiry_reply_draft_latest
    on inquiry_reply_draft (work_item_id, version desc);
