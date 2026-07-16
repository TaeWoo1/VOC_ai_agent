-- Review triage: the first per-review operator state.
--
-- Until now `reviews` was write-once at ingest with no companion state table — an
-- operator could see a low-rating review on the attention surface and had nowhere to
-- record what they concluded about it. These two tables are that record, and nothing
-- more: no draft, no queue, no dispatcher, no outbound path. Recording RESPONSE_NEEDED
-- states a judgement; it does not promise a reply.
--
-- Additive only (no drops). IF NOT EXISTS keeps re-runs / partial-applies safe, matching
-- V9/V16.
--
-- 1) review_triage — the CURRENT decision, one row per review.
--
--    review_id is UNIQUE, and that is load-bearing rather than incidental: the attention
--    signal ranges overlap by construction (a 2-star review matches both LOW_RATING_REVIEW
--    (1-3) and NEW_REVIEW (all)), so keying on (review, signal) would let one review carry
--    two contradictory decisions and which one an operator saw would depend on the card
--    they happened to click. The decision is about the review; the signal is only how they
--    found it.
--
--    NO seller_account_id, deliberately. `reviews` carries none (a file upload resolves no
--    account — FileUploadConnector passes null), so org+channel is the finest identity this
--    store actually has, and IngestedReviewVocItemSource already refuses to answer
--    per-account when an org holds two accounts on one channel. A column here would record
--    an attribution the data cannot support. channel_id IS stored: it is the review's own
--    channel, and it is what the read side scopes by. If account-scoped ingest ever lands,
--    the column can be added from real data instead of from a guess.
--
--    decided_by/decided_at are the decision's own actor + time, kept distinct from the
--    inherited created_at/updated_at (which move on ANY write to the row) — same split as
--    inquiry_work_item_dismissal_batch's executed_by/executed_at.
create table if not exists review_triage (
    id          uuid         primary key,
    org_id      uuid         not null references organizations (id),
    review_id   uuid         not null references reviews (id),
    channel_id  uuid         not null references channels (id),
    disposition varchar(32)  not null,
    decided_by  varchar(120) not null,
    decided_at  timestamptz  not null,
    created_at  timestamptz  not null,
    updated_at  timestamptz  not null
);
create unique index if not exists uq_review_triage_review
    on review_triage (review_id);
create index if not exists idx_review_triage_org_disposition
    on review_triage (org_id, disposition, decided_at desc);

-- 2) review_triage_audit — append-only decision trail. Written once, never updated, so
--    "this was RESPONSE_NEEDED for a week before someone closed it out" stays answerable.
--    disposition_from is null on a review's first decision (cf. inquiry_work_item_audit's
--    phase_from at open).
--
--    Append-only is necessary but not sufficient for that: it only holds if disposition_from
--    names the REAL predecessor. Two concurrent decisions would otherwise both read the
--    current value and both record leaving it — two rows, one predecessor, an impossible
--    history — and no constraint below can catch it, because their command ids differ and
--    nothing collides. ReviewTriageWriter takes a PESSIMISTIC_WRITE row lock on review_triage
--    so the chain composes. The schema cannot express that rule; the writer owns it.
--
--    (org_id, command_id) is UNIQUE — following V16's uq_dismissal_batch_org_command, NOT
--    V9's narrower (work_item_id, command_id). The command id is CLIENT-generated and
--    arrives alongside the ref, so the row it targets is part of what a replay must match:
--    under the narrower key a client reusing one command id across two different reviews
--    would have both writes accepted as unrelated, each unique within its own triage row,
--    and the reuse would be invisible. Org-scoped catches it — one command id, one effect,
--    per org. It is also where concurrent idempotency actually comes from: the service's
--    replay lookup is only a fast path — two simultaneous identical calls can both pass it —
--    and this constraint is what serializes them. The loser does not fail: it re-reads and
--    resolves to the winner's outcome (ReviewTriageService.resolveRace), so a concurrent
--    exact replay returns the same 200 as a sequential one. Together with
--    uq_review_triage_review (which catches two concurrent FIRST decisions, retried once as
--    an update) the two constraints cover both insert races.
create table if not exists review_triage_audit (
    id               uuid         primary key,
    org_id           uuid         not null references organizations (id),
    review_triage_id uuid         not null references review_triage (id),
    command_id       varchar(120) not null,
    disposition_from varchar(32),
    disposition_to   varchar(32)  not null,
    actor            varchar(120) not null,
    created_at       timestamptz  not null,
    updated_at       timestamptz  not null
);
create unique index if not exists uq_review_triage_audit_org_command
    on review_triage_audit (org_id, command_id);
create index if not exists idx_review_triage_audit_triage
    on review_triage_audit (review_triage_id, created_at);
