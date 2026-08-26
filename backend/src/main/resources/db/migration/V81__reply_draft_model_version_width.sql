-- Core Daily Loop UX Integration v1 §1 — room for the style digest in the stamp that already exists.
--
-- `model_version` is the provenance seam a draft's wording is read back from, and Organization Answer
-- Style v1 appended `+style/vN` to it. Making that identity actually reproducible needs a digest of
-- the profile (`style/v3@8f1c0a2b4d6e`), and the measured stamp then runs to ~115 characters on the
-- shipped OpenAI configuration and past 120 on a longer vendor model id. A stamp that silently fails
-- to insert — or that someone later "fixes" by truncating — is worse than no stamp at all.
--
-- Widening only. No new column, no new table, no backfill: every existing row is already valid at the
-- wider type, and nothing about what the string MEANS changes here.
alter table inquiry_reply_draft
    alter column model_version type varchar(200);
