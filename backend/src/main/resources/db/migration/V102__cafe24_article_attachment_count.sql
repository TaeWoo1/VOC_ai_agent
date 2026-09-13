-- Media Presence Projection v1 — carry Cafe24's attachment COUNT to the review promoter.
--
-- `attach_file_urls` has ridden on every board-article response this connector has ever received and
-- was discarded at the parse boundary. An approved bounded READ (2026-09-13) measured 1 of 7 board-4
-- articles in the last 365 days carrying 1 file, so the field is real and populated on this mall.
-- Projecting its LENGTH costs no new request, no new endpoint and no new scope — it is already in the
-- answer we are already given.
--
-- `null` is the whole point of the column being nullable: it means «this row was stored before the
-- length was projected, or the response did not carry the key». It is NOT zero, and it travels to
-- `reviews.media_count_observed = false`. Every one of the 134 rows already in this table stays null:
-- there is no backfill here and no estimate, because an estimate is exactly what the observation flag
-- was added to make impossible.
--
-- What this column is NOT: it holds no URL, no filename, no `name`, and no file. The array those come
-- from has no field anywhere in the connector — `Cafe24BoardArticleRow.fromJson` takes its size and
-- lets the parameter go.
alter table cafe24_community_articles
    add column attachment_count integer;

comment on column cafe24_community_articles.attachment_count is
    'How many files attach_file_urls held when this article was last read. NULL = never observed (not zero). Never a URL or a filename.';
