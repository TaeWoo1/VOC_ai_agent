-- The seller's decisions about one improvement opportunity, kept as a trail rather than as a value.
--
-- V94 stored the decision as ONE MUTABLE ROW: status flipped in place, decided_at was overwritten,
-- dismiss set draft_title/draft_body to null, and restore DELETED the row. So the sequence a seller
-- actually performs — 채택 → 수정 → 보류 → 되돌림 — left the database in exactly the state it started
-- in, and the sentences the seller had written in between were gone with no record that they had
-- ever existed. Two things were wrong with that and they are different:
--
--   1) THE DECISIONS WERE NOT ANSWERABLE. "이 기회를 언제 보류했더라" had no answer, and neither did
--      "내가 이걸 채택한 적이 있나". The product asks a seller to judge a repeated problem; a judgment
--      that leaves no trace is not recorded, it is consumed.
--   2) THE SELLER'S OWN TEXT WAS DESTROYED BY A BUTTON THAT DID NOT SAY SO. 「지금은 보류」 nulled a
--      draft the seller may have spent ten minutes editing. accept() already documented the opposite
--      intent — "Idempotent — accepting twice keeps the seller's edits" — so this was an
--      inconsistency, not a policy.
--
-- The shape here is not new. review_triage_corrections + review_triage_correction_audit and
-- review_reply_approval + review_reply_approval_audit are this repository's pattern for "a human
-- decision that can change and must stay answerable": a live row carrying the current word, and an
-- append-only trail carrying *_from/*_to for each thing the human did. This is the third instance of
-- that pattern, not a fourth pattern. NO generic event platform, NO workflow engine.
--
-- WHAT IS STILL NOT STORED: the opportunity itself. It remains derived on every read from the issue's
-- evidence and the seller's own knowledge (OpportunityRules), so neither this table nor V94's can ever
-- assert that an opportunity exists which the evidence no longer supports. A trail row about an
-- opportunity that stopped being derived simply stops being read, exactly like the decision row above
-- it — an annotation over operational truth, never a competing authority over it.

-- ── improvement_opportunity.status gains OPEN ────────────────────────────────────────────────────
-- Restore no longer deletes. A seller who takes a decision back is back at OPEN — the same thing an
-- absent row means to every reader — but the row stays so the trail beneath it keeps its subject.
-- (review_triage_corrections took the same decision for the same reason: "WITHDRAWAL DOES NOT
-- DELETE".) The column has never had a CHECK constraint, so no DDL is needed; this comment is the
-- record that the third value is deliberate.
comment on column improvement_opportunity.status is
    'OPEN (decided then taken back) | ACCEPTED | DISMISSED. An ABSENT row also means open — never decided.';

comment on column improvement_opportunity.draft_body is
    'The seller''s prepared text. Kept through a dismissal: the view hides it while DISMISSED, but 「지금은 보류」 does not erase what the seller wrote.';

-- ── improvement_opportunity_event — append-only, one row per thing the seller did ────────────────
-- kind         ACCEPTED  — the seller asked for this action to be prepared
--              EDITED    — the seller changed the prepared text (status_from == status_to)
--              DISMISSED — 지금은 보류
--              REOPENED  — the seller took their decision back
-- status_from  null on the first event about this opportunity; otherwise the status actually left.
-- evidence_count  what the suggestion rested on AT THAT MOMENT. The count is recomputed from the
--              issue's evidence on every read, so a year later "왜 이걸 채택했지" is unanswerable
--              without freezing it here — the same reason review_triage_correction_audit freezes
--              shown_tier. Null only on the rows backfilled below, where it was never observed.
--
-- NO draft text on the event. The seller's sentences live in exactly one place (the row above, which
-- no longer destroys them); a copy here would be a second text that can disagree with the first.
-- NO free-text note: the note about a repeated problem is the issue lifecycle's, and it already has
-- one. NO actor name — actor_id is the column every other trail in this schema uses.
--
-- Append-only composes only if status_from names the REAL predecessor. Two concurrent presses would
-- otherwise both read the standing status and both record leaving it; OpportunityService takes a
-- PESSIMISTIC_WRITE lock on the decision row. The schema cannot express that; the writer owns it.
create table improvement_opportunity_event (
    id             uuid        primary key,
    org_id         uuid        not null references organizations (id),
    opportunity_id uuid        not null references improvement_opportunity (id) on delete cascade,
    issue_id       uuid        not null references review_issues (id),
    kind           varchar(40) not null,
    event          varchar(16) not null,
    status_from    varchar(16),
    status_to      varchar(16) not null,
    evidence_count bigint,
    actor_id       uuid,
    decided_at     timestamptz not null,
    created_at     timestamptz not null,
    updated_at     timestamptz not null,
    constraint ck_improvement_opportunity_event
        check (event in ('ACCEPTED', 'EDITED', 'DISMISSED', 'REOPENED'))
);

create index ix_improvement_opportunity_event_opportunity
    on improvement_opportunity_event (opportunity_id, decided_at);

create index ix_improvement_opportunity_event_org_issue
    on improvement_opportunity_event (org_id, issue_id, decided_at);

-- Backfill the trail for decisions that predate it. Without this an opportunity that plainly carries
-- a decision would show an empty history, which reads as 「아무것도 결정한 적 없음」 — the screen would
-- contradict the badge beside it. status_from is null because these ARE first events as far as
-- anything can know: the mutable row kept no predecessor. evidence_count is null for the same reason
-- — it was never observed, and a number computed today would be a measurement dressed as a memory.
insert into improvement_opportunity_event
    (id, org_id, opportunity_id, issue_id, kind, event, status_from, status_to, evidence_count,
     actor_id, decided_at, created_at, updated_at)
select gen_random_uuid(), o.org_id, o.id, o.issue_id, o.kind,
       case when o.status = 'ACCEPTED' then 'ACCEPTED' else 'DISMISSED' end,
       null, o.status, null, null, o.decided_at, now(), now()
  from improvement_opportunity o
 where o.status in ('ACCEPTED', 'DISMISSED')
   and not exists (select 1 from improvement_opportunity_event e where e.opportunity_id = o.id);

comment on table improvement_opportunity_event is
    'Append-only trail of what the seller did about one derived improvement opportunity (Issue → ActionCandidate v0). Never a fact about the problem — only about the decision.';
