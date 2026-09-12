-- Seller triage correction (T-07) — the seller's own judgment, kept BESIDE the system's.
--
-- V41 created the correction row and V43 rescoped it to the review and recorded what was shown.
-- Three things were still missing, and all three are the difference between "the pilot records
-- disagreement" and "the seller can correct a review".
--
-- 1) THE ANSWER WAS BINARY. correctReview() took a boolean and derived the other half: 필요 없음 on a
--    확인 필요 row was stored as WATCH because that is what the rule would have said. So a seller who
--    meant 참고 got 지켜보기 written down, and nothing recorded that the two had ever been different.
--    The tier column always held three values; only the write path was binary.
--
--    ⚠ THIS REVERSES A WRITTEN DECISION, deliberately and on the record. TriageFeedbackRequests said
--    "There is no WATCH/FYI choice here on purpose: that split is the rule's and the pilot does not
--    own it." That reasoning was about the PILOT, whose mark is additive and binary by construction.
--    A seller correction is not the pilot's; it is the seller's, and the seller owns the whole
--    vocabulary they are shown. Product-owner decision, 2026-09-11.
--
-- 2) A CHANGE OF MIND ERASED THE PREVIOUS ANSWER. One live row per review, rewritten in place. The
--    V43 comment said "the history is the immutable prediction rows plus this row's updated_at" —
--    true for the AI's answers, not for the seller's: nothing said what the seller had said before.
--
-- 3) THERE WAS NO WAY BACK. No withdrawal, so a mis-press stood forever or was overwritten by a
--    second opinion the seller did not hold.
--
-- The shape here is not new. review_reply_approval (state STANDING/WITHDRAWN + an append-only
-- *_audit trail with *_from/*_to) and review_triage/review_triage_audit are the two structures this
-- repository already uses for "a human decision that can change and must stay answerable", and this
-- is the third instance of that same pattern rather than a fourth pattern. NO generic event platform.
--
-- WITHDRAWAL DOES NOT DELETE. A delete would cascade into review_correction_dispositions and could
-- silently remove a row from a FROZEN evaluation snapshot — the one thing that spine exists to make
-- impossible. So the row stays, its state changes, and a snapshot keeps exactly what it took.

-- ── review_triage_corrections.state ──────────────────────────────────────────────────────────────
-- STANDING  — the seller's correction stands. This is the only state any read path may act on.
-- WITHDRAWN — the seller took it back. The review shows the system's judgment alone again.
--
-- Backfilled STANDING: every pre-V99 row was written by a seller pressing a button and none of them
-- could be withdrawn, so STANDING is what they have always meant. Not a guess.
alter table review_triage_corrections add column if not exists state varchar(16);
update review_triage_corrections set state = 'STANDING' where state is null;
alter table review_triage_corrections alter column state set not null;
do $$ begin
    alter table review_triage_corrections
        add constraint ck_triage_correction_state check (state in ('STANDING', 'WITHDRAWN'));
exception when duplicate_object then null;
end $$;

create index if not exists idx_triage_correction_org_state
    on review_triage_corrections (org_id, state);

comment on column review_triage_corrections.state is
    'STANDING | WITHDRAWN. Only STANDING is the seller''s current word; a withdrawn row is kept so a frozen snapshot still contains what it took.';

-- ── review_triage_correction_audit — append-only, one row per thing the seller did ───────────────
-- kind      SET (the seller stated a tier) | WITHDRAWN (the seller took their correction back).
-- tier_from null on the first correction of a review, and after a withdrawal — in both cases there
--           was no standing seller judgment to leave. (cf. review_triage_audit.disposition_from,
--           review_reply_approval_audit.state_from, inquiry_work_item_audit.phase_from.)
-- tier_to   null exactly on WITHDRAWN. There is no tier meaning "no opinion" and inventing one would
--           put the seller's name on a judgment they withdrew.
-- shown_*   what the SYSTEM was saying at that moment, frozen onto the row like every other event in
--           this spine. It is why "the seller changed 확인 필요 → 참고" is readable a year later even
--           though the rule's tier is recomputed at read time and the pilot may have re-run since.
--
-- Append-only composes only if tier_from names the REAL predecessor; two concurrent presses would
-- otherwise both read the standing tier and both record leaving it. TriageFeedbackService takes a
-- PESSIMISTIC_WRITE lock on the correction row. The schema cannot express that; the writer owns it.
--
-- NO free-text note and no reason prose, for TriageCorrection's reason: this is a table an evaluation
-- harness reads, and every privacy guarantee in RUBRIC §5 rests on there being nowhere for prose to
-- land. corrected_reason_code stays the closed §3.1 vocabulary it already was.
create table if not exists review_triage_correction_audit (
    id            uuid        primary key,
    org_id        uuid        not null,
    review_id     uuid        not null references reviews (id) on delete cascade,
    correction_id uuid        not null references review_triage_corrections (id) on delete cascade,
    kind          varchar(16) not null,
    tier_from     varchar(24),
    tier_to       varchar(24),
    shown_tier    varchar(24),
    shown_source  varchar(8),
    reason_code   varchar(32),
    actor_id      uuid,
    decided_at    timestamptz not null,
    created_at    timestamptz not null,
    updated_at    timestamptz not null,
    constraint ck_triage_correction_audit_kind check (
        (kind = 'SET' and tier_to is not null) or (kind = 'WITHDRAWN' and tier_to is null))
);

create index if not exists idx_triage_correction_audit_review
    on review_triage_correction_audit (review_id, decided_at);
create index if not exists idx_triage_correction_audit_org
    on review_triage_correction_audit (org_id, decided_at desc);

-- Backfill the trail for corrections that predate it. Without this a review that plainly carries a
-- correction would show an empty history, which reads as "never corrected" — the screen would
-- contradict itself. tier_from is null because these ARE first corrections: nothing could have
-- preceded them, since no earlier write path existed.
insert into review_triage_correction_audit
    (id, org_id, review_id, correction_id, kind, tier_from, tier_to, shown_tier, shown_source,
     reason_code, actor_id, decided_at, created_at, updated_at)
select gen_random_uuid(), c.org_id, c.review_id, c.id, 'SET', null, c.corrected_tier,
       c.shown_tier, c.shown_source, c.corrected_reason_code, null, c.corrected_at, now(), now()
  from review_triage_corrections c
 where not exists (select 1 from review_triage_correction_audit a where a.correction_id = c.id);

comment on table review_triage_correction_audit is
    'Append-only trail of the seller''s triage corrections. Decision Data — never merged with review_triage_behavior_events, which is silver navigation.';
