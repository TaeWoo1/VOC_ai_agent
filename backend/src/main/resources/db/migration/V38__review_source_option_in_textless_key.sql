-- Corrects what V37 says about source_option_id, without editing an applied migration.
--
-- V37 recorded that the purchased option is NOT folded into content_hash, and gave the reason: a key that
-- changed when a cell rendered differently would make a re-read of the same review look like a new one.
-- That reason still holds for a review WITH TEXT, and for those nothing has changed.
--
-- It stopped holding for a review with NO text, which the first live Coupang backfill showed is most of
-- them (19 of 22). Such a review has no body to tell it apart from another rating-only review of the same
-- product on the same day at the same rating, so under the text formula they collapse into one row and the
-- rating distribution — the only signal a rating-only review carries — quietly understates. Those rows are
-- keyed under dedup_key_version 3, which folds the option in.
--
-- The formula is chosen by whether the review is textless and by nothing else: if it also depended on the
-- option cell being readable, the very instability V37 warned about would be back, one level up. A textless
-- row with no option id still uses v3, with the option contributing an empty part.
--
-- Two textless reviews of the SAME option on one day at one rating still merge. That is a recorded v1
-- limitation (docs/coupang_review_acquisition_v1.md), not something to close with a row position or a
-- buyer's name.
--
-- Statements are catalog comments only: no column is added, changed, or dropped, and no row is touched.
comment on column reviews.source_option_id is
  'Purchased-option identity from the source (Coupang 옵션ID / vendorItemId). Catalog identity, never a buyer. Part of content_hash for dedup_key_version 3 (textless reviews) only; text reviews are keyed without it.';
comment on column reviews.dedup_key_version is
  'Which content-hash formula this row was keyed under. 1 = channel|product|date|body. 2 = + rating. 3 = + purchased option, used for a review whose buyer rated without writing.';
