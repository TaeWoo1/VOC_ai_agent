-- Review response COMPLETION: the operator, guided by the Action Window, posts the approved reply
-- into NAVER themselves, and SellerOps records a LOCAL, OPERATOR-REPORTED, explicitly UNVERIFIED
-- outcome next to the review.
--
-- Scope, exactly: a binding token + an append-only outcome. There is STILL no marketplace write
-- path in the backend — SellerOps never types or submits; the seller does. Nothing here verifies a
-- post, because nothing can: NAVER exposes no REVIEW API and the export carries no reply state
-- (IngestedReviewVocItemSource: `null // replyStatus`). So the outcome carries TWO separate facts —
-- what the operator reported, and that SellerOps did not verify it — and there is deliberately NO
-- 'COMPLETED' value in either enum. Scope lock v1.6 records the decision.
--
-- Approval stays revocable: this table does NOT consume the approval (unlike inquiry_approval + a
-- dispatch). An outcome is a historical fact that references the approved head; a later withdrawal
-- reopens editing and never erases what was recorded.
--
-- Additive only (no drops). IF NOT EXISTS keeps re-runs safe, matching V18/V19.

-- 1) review_reply_submission_ref — the mint binding.
--
--    The Action Window contract carries no review identity and no reply text (both are prohibited
--    on the wire). So the backend mints an OPAQUE 16-hex `submission_ref` bound to the approved
--    head; the FE passes only that ref into START_RUN, and resolves it to the body it already
--    holds. The ref is what lets a guided run reference an approved reply without any identity or
--    text crossing the boundary.
--
--    NO seller_account_id and NO channel_id — same reasons as V19 (reviews carries no account; a
--    channel column would be a reader-less denormalization).
create table if not exists review_reply_submission_ref (
    id                uuid         primary key,
    org_id            uuid         not null references organizations (id),
    review_id         uuid         not null references reviews (id),
    submission_ref    varchar(16)  not null,
    bound_version     integer      not null,
    bound_fingerprint varchar(64)  not null,
    created_by        varchar(120) not null,
    created_at        timestamptz  not null,
    constraint chk_review_reply_submission_ref_version check (bound_version > 0)
);
-- Opaque, globally unique — collisions on the 16-hex token fail closed here rather than binding two
-- runs to one row.
create unique index if not exists uq_review_reply_submission_ref_ref
    on review_reply_submission_ref (submission_ref);
create index if not exists idx_review_reply_submission_ref_review
    on review_reply_submission_ref (review_id, created_at desc);

-- 2) review_reply_outcome — append-only, the operator's report about their own manual post.
--
--    Outcome and verification are SEPARATE columns, on purpose. `operator_outcome` is what the
--    operator reports (OPERATOR_REPORTED_SUBMITTED | SUBMISSION_ABORTED — an abort is a deliberate,
--    benign end, NOT a fault). `verification` is what SellerOps confirmed — only UNVERIFIED is
--    reachable; a VERIFIED value is deliberately absent, so nothing can claim a verification that
--    cannot happen. There is NO 'COMPLETED' value anywhere in this table.
--
--    Its versions ARE its history — like review_reply_draft, an append-only table needs no separate
--    audit table.
--
--    SINGLE-USE binding: uq …_submission_ref makes one outcome per `submission_ref`, so a retry
--    after a reported submission requires a FRESH mint (a new binding re-confirming the approved
--    head), never a silent re-drive. Multiple outcomes per review head ARE legitimate across
--    retries (abort → re-mint → submit), each through its own fresh ref — so there is deliberately
--    NO (review, version, fingerprint) unique.
--
--    (org_id, command_id) is UNIQUE — org-scoped idempotency, following V18/V19; the service's
--    replay lookup is only a fast path and this constraint is where concurrent idempotency comes
--    from.
--
--    aw_run_ref is the opaque Action Window runId the guided post ran under — never an account id,
--    never page content.
create table if not exists review_reply_outcome (
    id                    uuid         primary key,
    org_id                uuid         not null references organizations (id),
    review_id             uuid         not null references reviews (id),
    submission_ref        varchar(16)  not null,
    recorded_version      integer      not null,
    recorded_fingerprint  varchar(64)  not null,
    fingerprint_algorithm varchar(40)  not null,
    operator_outcome      varchar(40)  not null,
    verification          varchar(24)  not null,
    aw_run_ref            varchar(128) not null,
    command_id            varchar(120) not null,
    recorded_by           varchar(120) not null,
    created_at            timestamptz  not null,
    constraint chk_review_reply_outcome_version check (recorded_version > 0),
    constraint chk_review_reply_outcome_operator_outcome
        check (operator_outcome in ('OPERATOR_REPORTED_SUBMITTED', 'SUBMISSION_ABORTED')),
    -- No COMPLETED. Only UNVERIFIED is reachable — a reply post has no read-back oracle.
    constraint chk_review_reply_outcome_verification
        check (verification in ('UNVERIFIED'))
);
-- Single-use: one outcome per binding. A second record against a spent ref collides here.
create unique index if not exists uq_review_reply_outcome_submission_ref
    on review_reply_outcome (submission_ref);
-- Org-scoped idempotency: this is where concurrent replay actually comes from.
create unique index if not exists uq_review_reply_outcome_org_command
    on review_reply_outcome (org_id, command_id);
create index if not exists idx_review_reply_outcome_review
    on review_reply_outcome (review_id, created_at);
