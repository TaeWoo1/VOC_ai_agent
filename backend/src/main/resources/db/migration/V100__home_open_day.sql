-- Return visits — the one business hypothesis the product could not answer about itself.
-- Product-owner decision, 2026-09-13 (Pilot Launch Readiness §2).
--
-- Four of the five pilot hypotheses read from tables the product already keeps for its own work:
-- whether NEEDS_ATTENTION was processed, whether a decision was recorded, whether an action was
-- taken, whether a repeated problem was opened. The fifth — "does the seller come back" — had no
-- source at all. There is no login record, no session row, and the frontend analytics module is a
-- no-op with no vendor env. The choice was between sending a seller's screen behaviour to a third
-- party and storing a new fact about them here. This is the second, made as small as a fact can be.
--
-- THE TABLE IS ITS OWN PRIVACY STATEMENT. It has two columns and both of them are the primary key,
-- so there is nowhere to put a user id, an address, a user agent, a click, a referrer, a time of
-- day, or a single word a customer or a seller wrote. That is not a rule someone has to keep — a
-- column that does not exist cannot be filled by a later change that nobody reviewed closely.
--
-- ONE ROW PER ORGANISATION PER DAY, and the key is what makes that true rather than a query that
-- remembers to be careful. Opening 홈 nine times on a Tuesday is one usage day; the ninth open
-- writes nothing. So the table cannot describe a session, a visit frequency, or an intensity — it
-- can only answer "on which days did this organisation open 홈", which is the whole question.
--
-- THE DATE IS ASIA/SEOUL and the SERVER decides it. A client-supplied date is a client-supplied
-- fact, and the seller's Tuesday is the one this is counting.
--
-- The pilot cohort is NOT in this table: it is an explicit organisation list applied by the metric
-- query (docs/pilot_usage_loop_v1.md §4), which is how the canonical Demo Org — and this session's
-- own QA traffic — stay out of the numbers without the product carrying a "is this real" flag.
create table home_open_day
(
    org_id    uuid not null references organizations (id) on delete cascade,
    opened_on date not null,
    primary key (org_id, opened_on)
);

-- The pilot question is "how many days did each organisation come back", so every read is
-- org-first; the primary key already serves it. No second index: one insert per page open, and the
-- table gains at most one row per organisation per day.
comment on table home_open_day is
    'One row per organisation per Asia/Seoul day on which 홈 was opened. No user, no session, no content.';
