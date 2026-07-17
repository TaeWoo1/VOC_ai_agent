-- Review response preparation: the operator writes a reply, approves it, and copies it.
--
-- Scope, exactly: local text + a local approval. There is still NO marketplace write path
-- behind any of this — no adapter, no action intent, no dispatcher, no verification. The
-- reply leaves SellerOps through the operator's clipboard and nowhere else. V18 said
-- "no draft, no queue, no dispatcher, no outbound path"; this migration adds the draft and
-- nothing else on that list. Scope lock v1.4 records the decision.
--
-- RESPONSE_NEEDED still promises nothing. It gates whether preparation is OFFERED; it never
-- causes it. Nothing here is written when a disposition is recorded — an operator starts
-- preparation explicitly, or it never starts. TriageDisposition's "recording RESPONSE_NEEDED
-- does not draft, queue, send, or promise a reply" remains literally true after this.
--
-- Additive only (no drops). IF NOT EXISTS keeps re-runs / partial-applies safe, matching
-- V9/V16/V18.
--
-- 1) review_reply_draft — append-only, versioned drafts. One row per (review, version).
--
--    Keyed on the review, following V18's reasoning rather than restating it: the decision
--    and now the draft are both about the review, and the signal is only how it was found.
--
--    Append-only: an edit INSERTS the next version, so a prior version can never change and
--    an approval can bind immutably to one version's fingerprint. Consequently there is NO
--    updated_at — a change is a new version, not a write to an old one. Same shape as V11's
--    inquiry_reply_draft.
--
--    ONE body, not title+comments. An ESM answer has both because ESM's answer contract has
--    both; a review reply is a single block of text. The shape follows the thing being
--    written, not the sibling table.
--
--    NO seller_account_id and NO channel_id, deliberately, and for two different reasons.
--    The account: `reviews` carries none (a file upload resolves none), exactly as V18
--    records — stamping one would invent an attribution the data cannot support. The
--    channel: V18 stores it because its read side scopes drill-down pages by channel; this
--    store is only ever read one review at a time, org-scoped, via a ref the server
--    re-authorizes on every call. A channel column here would be denormalized data with no
--    reader — a fact to keep correct forever in exchange for nothing.
create table if not exists review_reply_draft (
    id                    uuid         primary key,
    org_id                uuid         not null references organizations (id),
    review_id             uuid         not null references reviews (id),
    version               integer      not null,
    body                  text         not null,
    content_fingerprint   varchar(64)  not null,
    fingerprint_algorithm varchar(40)  not null,
    created_by            varchar(120) not null,
    created_at            timestamptz  not null,
    constraint chk_review_reply_draft_version check (version > 0)
);
-- One row per (review, version): serializes concurrent saves and makes prior versions
-- immutable by construction — the loser of a race collides here rather than overwriting.
create unique index if not exists uq_review_reply_draft_review_version
    on review_reply_draft (review_id, version);
-- Latest-version lookup (the current draft) — the read every request makes.
create index if not exists idx_review_reply_draft_latest
    on review_reply_draft (review_id, version desc);

-- 2) review_reply_approval — the CURRENT approval, one row per review, updated in place.
--
--    Revocable, and that is a real difference from V12's inquiry_approval rather than an
--    inconsistency. There, approval is immutable and single-use because a DISPATCH consumes
--    it: the approval is the authorization for a send that then happens, and unsaying it
--    afterwards would be a lie about what was sent. Here nothing consumes it. An immutable
--    approval with no dispatch behind it would make a typo permanent — the operator could
--    never edit (the approval freezes the draft) and never un-approve (immutable), for a
--    reply that was never sent anywhere. So state is APPROVED | WITHDRAWN, and the trail
--    beside it keeps the history honest.
--
--    approved_version/approved_fingerprint are NULL exactly when the state is WITHDRAWN,
--    enforced below rather than by convention. Leaving a stale binding on a withdrawn row
--    would leave a value that reads as live to anything that forgot to check state first —
--    and the one thing this table must never do is hand out an approved fingerprint for an
--    approval that does not stand. The history lives in the audit; the current row carries
--    only what is currently true.
create table if not exists review_reply_approval (
    id                   uuid         primary key,
    org_id               uuid         not null references organizations (id),
    review_id            uuid         not null references reviews (id),
    state                varchar(32)  not null,
    approved_version     integer,
    approved_fingerprint varchar(64),
    decided_by           varchar(120) not null,
    decided_at           timestamptz  not null,
    created_at           timestamptz  not null,
    updated_at           timestamptz  not null,
    constraint chk_review_reply_approval_state
        check (state in ('APPROVED', 'WITHDRAWN')),
    -- The binding exists if and only if the approval stands.
    constraint chk_review_reply_approval_binding check (
        (state = 'APPROVED' and approved_version is not null and approved_fingerprint is not null
             and approved_version > 0)
        or (state = 'WITHDRAWN' and approved_version is null and approved_fingerprint is null))
);
create unique index if not exists uq_review_reply_approval_review
    on review_reply_approval (review_id);

-- 3) review_reply_approval_audit — append-only approval trail. Written once, never updated,
--    so "this was approved, then withdrawn, then re-approved at a different version" stays
--    answerable. state_from is null on the first decision (cf. review_triage_audit's
--    disposition_from, inquiry_work_item_audit's phase_from).
--
--    Same rule as V18, same reason, and it is worth restating because it is the one thing
--    append-only does not give you for free: the trail only composes if state_from names the
--    REAL predecessor. Two concurrent decisions would otherwise both read the current state
--    and both record leaving it — two rows, one predecessor, an impossible history — and no
--    constraint here can catch it, because their command ids differ and nothing collides.
--    ReviewReplyApprovalWriter takes a PESSIMISTIC_WRITE row lock on review_reply_approval.
--    The schema cannot express that rule; the writer owns it.
--
--    (org_id, command_id) is UNIQUE — org-scoped, following V18/V16 and NOT V9's narrower
--    key. The command id is CLIENT-generated and arrives alongside the ref, so the row it
--    targets is part of what a replay must match: under a narrower key a client reusing one
--    id across two reviews would have both writes accepted as unrelated. It is also where
--    concurrent idempotency actually comes from — the service's replay lookup is only a fast
--    path, and this constraint is what serializes two simultaneous identical calls. The loser
--    re-reads and resolves to the winner's outcome rather than failing.
--
--    approved_version/approved_fingerprint record what THIS transition bound (null for a
--    withdrawal, which binds nothing). Unlike the current row these are never cleared: the
--    point of a trail is that it still says what was true at the time.
create table if not exists review_reply_approval_audit (
    id                       uuid         primary key,
    org_id                   uuid         not null references organizations (id),
    review_reply_approval_id uuid         not null references review_reply_approval (id),
    command_id               varchar(120) not null,
    state_from               varchar(32),
    state_to                 varchar(32)  not null,
    approved_version         integer,
    approved_fingerprint     varchar(64),
    actor                    varchar(120) not null,
    created_at               timestamptz  not null,
    updated_at               timestamptz  not null
);
create unique index if not exists uq_review_reply_approval_audit_org_command
    on review_reply_approval_audit (org_id, command_id);
create index if not exists idx_review_reply_approval_audit_approval
    on review_reply_approval_audit (review_reply_approval_id, created_at);
