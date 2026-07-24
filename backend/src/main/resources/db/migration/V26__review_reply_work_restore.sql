-- 내 답변 작업 recovery: an operator can bring a review they set aside (작업에서 제외) BACK onto the
-- reply to-do — "복원" — and can browse what they have set aside ("제외한 작업"). Restore, like
-- dismissal, claims nothing about the reply: it deletes/mutates no draft, writes no reported outcome,
-- and implies no completion. It only reverses the set-aside.
--
-- Two facts this migration adds:
--
-- 1. A SHARED, GLOBALLY-MONOTONIC event sequence for the two explicit reply-work actions
--    (dismissal + restore), so "which explicit action is latest" is decided by a total order rather
--    than by wall-clock time. Timestamps can tie (same clock tick) or skew; a shared sequence cannot.
--    The read arbitrates by MAX(seq): if the newest explicit event for a review is a restore, it is
--    active; if a dismissal, it is set aside. The AUTOMATIC re-entry triggers (a genuinely newer
--    RESPONSE_NEEDED decision or a newer draft revision) are preserved and stay timestamp-based —
--    they compare against the latest dismissal's dismissed_at, exactly as before.
--
-- 2. An append-only restore table, mirroring review_reply_work_dismissal field-for-field (plus seq).
--    Each operator-owned reply-work fact is its own append-only table — triage / draft / approval /
--    outcome / dismissal, and now restore. Append-only IS the history: no updated_at, no audit table.
--
-- Additive only (no drops); IF NOT EXISTS keeps re-runs safe, matching V20/V25. Postgres owns this
-- schema; the H2 test schema comes from the entities plus a test-only schema.sql that creates the
-- same sequence (Flyway is disabled under test).

-- The shared monotonic source. Both dismissal.seq and restore.seq draw from it via nextval, so every
-- explicit reply-work event across both tables gets a strictly-increasing, globally-unique position.
create sequence if not exists reply_work_event_seq;

-- Backfill seq onto the existing (V25) dismissals, in their own chronological order, then advance the
-- sequence past them so every future event outranks every historical one. Ordering among historical
-- dismissals is by (dismissed_at, id); it only ever matters relative to a FUTURE restore, and a
-- future restore always outranks them by construction of the setval below.
alter table review_reply_work_dismissal add column if not exists seq bigint;
update review_reply_work_dismissal t
   set seq = s.rn
  from (select id, row_number() over (order by dismissed_at, id) as rn
          from review_reply_work_dismissal) s
 where t.id = s.id
   and t.seq is null;
-- setval(seq, N, false) makes the NEXT nextval() return N. N = max(seq)+1 (or 1 when empty), so no
-- future event can collide with a backfilled value.
select setval('reply_work_event_seq',
              (select coalesce(max(seq), 0) + 1 from review_reply_work_dismissal),
              false);
alter table review_reply_work_dismissal alter column seq set not null;

-- The restore log. One appended row per "복원" — never updated. Idempotent on (org_id, command_id)
-- exactly like the dismissal write; the read consults MAX(seq) per review, hence the review index.
create table if not exists review_reply_work_restore (
    id           uuid         primary key,
    org_id       uuid         not null references organizations (id),
    review_id    uuid         not null references reviews (id),
    command_id   varchar(120) not null,
    restored_by  varchar(120) not null,
    restored_at  timestamptz  not null,
    seq          bigint       not null
);
create unique index if not exists uq_review_reply_work_restore_org_command
    on review_reply_work_restore (org_id, command_id);
create index if not exists idx_review_reply_work_restore_review
    on review_reply_work_restore (review_id, restored_at desc);
