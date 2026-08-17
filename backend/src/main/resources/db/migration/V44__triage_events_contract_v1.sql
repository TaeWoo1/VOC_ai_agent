-- Review Triage Events v1 — contracts/review-triage-events/v1/CONTRACT.md §2.
--
-- The three event tables of V43 keep their shape; the KIND vocabulary becomes the contract's, and the
-- columns are widened to hold the longer names. Nothing here weights anything, and there is still no
-- IGNORED — see the contract's §2.3.
--
--   behaviour: EXPOSED         → AI_ATTENTION_SHOWN   (only where the row was shown as AI — see below)
--              OPENED          → REVIEW_OPENED
--              ORIGINAL_VIEWED → ORIGINAL_OPENED
--              (new)             MARKETPLACE_LOCATED  (a locate run reported the row found; Coupang only)
--   actions:   STARTED         → ACTION_STARTED
--              COMPLETED       → ACTION_COMPLETED
--              NOT_NEEDED      → ACTION_NOT_NEEDED
--              (new)             REPLY_DRAFTED / REPLY_SUBMITTED  (channel-gated; never Coupang)

alter table review_triage_behavior_events alter column kind type varchar(32);
alter table review_triage_actions          alter column kind type varchar(32);

-- V43's EXPOSED fired for EVERY rendered row and stamped which mechanism the seller saw. The contract
-- defines only the AI-shown half as an event (AI_ATTENTION_SHOWN); a rendered rules row is not an event
-- in v1. Those rows are removed rather than renamed into a kind the contract does not define — they
-- were silver of the weakest class about the rating rule, never counted by any reader, and keeping
-- them under an undefined name would be a vocabulary nobody agreed to. Recorded here so the deletion
-- is visible: it is the one place this migration drops a row.
delete from review_triage_behavior_events where kind = 'EXPOSED' and (shown_source is null or shown_source <> 'AI');

update review_triage_behavior_events set kind = 'AI_ATTENTION_SHOWN' where kind = 'EXPOSED';
update review_triage_behavior_events set kind = 'REVIEW_OPENED'      where kind = 'OPENED';
update review_triage_behavior_events set kind = 'ORIGINAL_OPENED'    where kind = 'ORIGINAL_VIEWED';

update review_triage_actions set kind = 'ACTION_STARTED'    where kind = 'STARTED';
update review_triage_actions set kind = 'ACTION_COMPLETED'  where kind = 'COMPLETED';
update review_triage_actions set kind = 'ACTION_NOT_NEEDED' where kind = 'NOT_NEEDED';

comment on column review_triage_behavior_events.kind is
    'contracts/review-triage-events/v1 §2.1: AI_ATTENTION_SHOWN | REVIEW_OPENED | ORIGINAL_OPENED | MARKETPLACE_LOCATED. No IGNORED, by design.';
comment on column review_triage_actions.kind is
    'contracts/review-triage-events/v1 §2.1–2.2: ACTION_STARTED | ACTION_COMPLETED | ACTION_NOT_NEEDED | REPLY_DRAFTED | REPLY_SUBMITTED (reply kinds channel-gated; never Coupang).';
