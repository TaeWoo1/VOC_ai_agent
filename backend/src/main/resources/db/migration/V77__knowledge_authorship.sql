-- Product Knowledge gains an AUTHORSHIP axis, distinct from the document KIND it already had.
--
-- Until now every row in product_knowledge_sources had the same origin: a person typing into
-- SellerOps. The 2026-08-26 product-owner decision lets a seller's own 상세페이지 text into the same
-- corpus (it is the seller's writing, not a channel fact), and reserves a third class for text a
-- model reads out of an image on that page. Those three are not interchangeable, so the column
-- states which one a row is instead of leaving it implied by who happened to write it.
--
-- Backfill is the honest one: every EXISTING row was typed by a person, so the default is exactly
-- what those rows are, and NOT NULL costs nothing.
alter table product_knowledge_sources
    add column authored_origin varchar(40) not null default 'SELLER_ENTERED_KNOWLEDGE';

-- A channel-derived document is keyed by the listing it was read from, so a re-read updates rather
-- than duplicates. Null for typed knowledge, which has no external identity — a partial index keeps
-- the uniqueness claim scoped to rows that actually make it.
alter table product_knowledge_sources
    add column channel_source_ref varchar(200);

create unique index uq_pk_sources_channel_ref
    on product_knowledge_sources (org_id, product_id, authored_origin, channel_source_ref)
    where channel_source_ref is not null;
