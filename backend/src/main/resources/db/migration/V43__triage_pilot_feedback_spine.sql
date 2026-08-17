-- LLM Triage Classifier v1 — the conservative production pilot (RUBRIC v2 §13.7 amendment) and the
-- feedback it records (docs/slices/production-triage-feedback-draft-v1.md §7–§8).
--
-- Four things, kept apart because they are evidence of different strengths:
--
--   review_triage_ai_current      what the surface READS: one row per review, the pilot's current
--                                 additive decision. Derived from review_triage_predictions and
--                                 rewritten on every re-classification; the prediction rows stay
--                                 immutable and are the history.
--   review_triage_corrections     (extended) the seller's explicit answer — STRONG evidence.
--   review_triage_actions         the seller's explicit act on the review — STRONG evidence.
--   review_triage_behavior_events what the seller did on the way — weighted SILVER, never a label.
--
-- None of them carries review content. None of them trains anything: a next classifier version is
-- built offline and measured against gold and a frozen, numbered snapshot before it is considered.

-- ── review_triage_ai_current ─────────────────────────────────────────────────────────────────────
-- The pilot's live decision for one review. ai_attention is the ONLY thing the list read consults,
-- and it can only ADD: the ordering takes min(rules rank, ai rank), so a true here raises a review
-- the rule left lower and a false leaves the rule's answer exactly where it was (§8.9, §13.7 item 2).
--
-- One row per review, rewritten in place, because the read path needs "the current answer" and a
-- latest-per-review subquery in the list ordering would be paid on every page. What was said before,
-- and by which version, is in review_triage_predictions.
create table if not exists review_triage_ai_current (
    id                 uuid primary key,
    org_id             uuid         not null,
    review_id          uuid         not null references reviews (id) on delete cascade,
    prediction_id      uuid         not null references review_triage_predictions (id) on delete cascade,
    ai_attention       boolean      not null,
    classifier_version varchar(160) not null,
    reason_code        varchar(32),
    predicted_at       timestamptz  not null,
    created_at         timestamptz  not null,
    updated_at         timestamptz  not null
);

create unique index if not exists uq_triage_ai_current_review on review_triage_ai_current (review_id);
create index if not exists idx_triage_ai_current_org_attention on review_triage_ai_current (org_id, ai_attention);

comment on column review_triage_ai_current.ai_attention is
    'true = the pilot marks this review AI 확인 필요. Additive only; the rules tier is never lowered by it.';

-- ── review_triage_corrections — now scoped to the REVIEW, with what was shown ────────────────────
-- V41 scoped a correction to a prediction, on the reasoning that a correction must say which answer
-- it corrected. That reasoning stands, and the pilot adds a case it did not cover: a seller may
-- correct a 확인 필요 the RULE produced, on a review no classifier has seen. That is a correction of
-- the rules tier and is worth exactly as much — so the row now names the review, records what tier
-- was on screen and which mechanism put it there, and keeps prediction_id where one exists.
--
-- One live correction per review, superseding: the seller's latest word is the one that stands, and
-- the history is the immutable prediction rows plus this row's updated_at.
alter table review_triage_corrections add column if not exists review_id     uuid;
alter table review_triage_corrections add column if not exists shown_tier    varchar(24);
alter table review_triage_corrections add column if not exists shown_source  varchar(8);
alter table review_triage_corrections alter column prediction_id drop not null;
drop index if exists uq_triage_correction_prediction;
create unique index if not exists uq_triage_correction_review on review_triage_corrections (review_id);
create index if not exists idx_triage_correction_prediction on review_triage_corrections (prediction_id);

comment on column review_triage_corrections.shown_source is
    'RULES or AI — which mechanism produced the tier the seller was looking at when they corrected it.';

-- ── review_triage_actions ────────────────────────────────────────────────────────────────────────
-- STARTED / COMPLETED / NOT_NEEDED. Explicit: the operator pressed a control that says what they
-- did about the review. COMPLETED is the strongest implicit-adjacent evidence a review was actionable
-- (§7.2 of the draft) and NOT_NEEDED is an explicit statement that it was not; both are answers to a
-- question, which is what separates them from the behaviour table below.
create table if not exists review_triage_actions (
    id               uuid primary key,
    org_id           uuid        not null,
    review_id        uuid        not null references reviews (id) on delete cascade,
    prediction_id    uuid        references review_triage_predictions (id) on delete set null,
    kind             varchar(16) not null,
    shown_tier       varchar(24),
    shown_source     varchar(8),
    actor_id         uuid,
    acted_at         timestamptz not null,
    snapshot_version varchar(40),
    created_at       timestamptz not null,
    updated_at       timestamptz not null
);

create index if not exists idx_triage_action_review on review_triage_actions (review_id, acted_at desc);
create index if not exists idx_triage_action_snapshot on review_triage_actions (org_id, snapshot_version);

-- ── review_triage_behavior_events ────────────────────────────────────────────────────────────────
-- EXPOSED / OPENED / ORIGINAL_VIEWED. Weighted silver, §7 of the draft:
--   * never a label — no row here enters labels.json, a gate, or a precision/recall figure;
--   * never sufficient on its own to change a tier;
--   * asymmetric — a review passed over N times is a reason to ask a human, not evidence of NO_ACTION.
--     There is deliberately NO "ignored" event kind: absence of rows is the record of being ignored,
--     and absence is confounded by everything (queue position, staffing, lunch), so it is not written
--     as if it were a signal.
-- The weight is NOT stored here. It is a policy applied when a silver snapshot is cut, so it can be
-- revised without rewriting history and so no consumer can read a weight without reading its policy.
create table if not exists review_triage_behavior_events (
    id               uuid primary key,
    org_id           uuid        not null,
    review_id        uuid        not null references reviews (id) on delete cascade,
    prediction_id    uuid        references review_triage_predictions (id) on delete set null,
    kind             varchar(16) not null,
    shown_tier       varchar(24),
    shown_source     varchar(8),
    occurred_at      timestamptz not null,
    snapshot_version varchar(40),
    created_at       timestamptz not null,
    updated_at       timestamptz not null
);

create index if not exists idx_triage_behavior_review on review_triage_behavior_events (review_id, occurred_at desc);
create index if not exists idx_triage_behavior_snapshot on review_triage_behavior_events (org_id, snapshot_version);
