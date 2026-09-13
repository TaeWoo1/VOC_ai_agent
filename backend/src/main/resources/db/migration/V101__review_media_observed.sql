-- Media Semantics Closeout v1 — tell a counted zero apart from a silence.
--
-- `reviews.media_count` is `int not null` and its own docblock says «0 when unreported», so one
-- value has always carried two different claims: «this review has no photo» and «nobody counted».
-- Measured 2026-09-13 across the whole database: media_count > 0 on 0 of 4,832 rows — and 4,800 of
-- those zeros were the column default rather than any reader's answer, because only the Coupang WING
-- handoff supplies a counted value. A number that cannot distinguish those two is not evidence, and
-- every media decision after this one would have rested on it.
--
-- One boolean, and the backfill is deliberately the conservative one:
--
--   observed = false            → UNKNOWN.  Nobody looked, or the reader could not have seen it.
--   observed = true, count = 0  → observed none.
--   observed = true, count > 0  → observed present.
--
-- Every existing row becomes `false`, including the 32 Coupang rows a counter did produce. That is a
-- deliberate under-claim: `mediaCountOf` counts inside the body cell only and the WING column
-- vocabulary has no media role, so those rows are exactly the case the three words exist to keep
-- honest — a reader ran, and it could not have seen media outside the cell it looked in. Claiming
-- them as «observed none» would put this migration's authority behind a reading that did not have it.
-- New observations start from the next acquisition.
--
-- What this column is NOT: it stores no URL, no filename, no reference and no image. It stores
-- whether a number is an answer.
alter table reviews
    add column media_count_observed boolean not null default false;

comment on column reviews.media_count_observed is
    'Whether media_count is a reading rather than a default. false = UNKNOWN; true with 0 = observed none; true with >0 = observed present. Never a URL or a reference.';
