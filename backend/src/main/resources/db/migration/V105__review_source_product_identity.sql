-- What the CHANNEL said this review is about, kept whether or not this org holds the product.
--
-- Until now a Coupang 상품평 whose 노출상품ID / 옵션ID matched no listing was DROPPED by the handoff
-- (AgentReviewHandoffService counted it `UNRESOLVED_DISPLAY_PRODUCT_ID` and stored nothing). Measured
-- live 2026-09-13 on a browser-only org: read ok, 10 rows, handoff received 9 · stored 0 · failed 9,
-- because that org holds zero products — the catalogue comes from the OpenAPI product sync, and a
-- seller who connected nothing but the browser has none. So review READ was independent of the
-- OpenAPI and review INGEST was not, which is the dependency this column removes.
--
-- `reviews.product_id` was ALREADY nullable and the read paths already null-guard it (Cafe24 promoted
-- reviews have carried a null product since Cafe24ReviewPromoter). What was missing is what this row
-- is about when the link is absent: the channel's own product id, and the name the channel printed.
-- The purchased option was already kept (`source_option_id`), so this is the rest of that same record.
--
-- Mirrors `inquiries.source_product_ref` exactly — same width, same partial index, same meaning: a
-- verbatim record of what the source said, sitting beside the resolution rather than replacing it. It
-- is also what a later reconcile reads: when the catalogue arrives, `channel_products` can be joined on
-- (channel_id, source_product_ref) and the link written WITHOUT re-reading the marketplace.
--
-- No backfill. The 4,830 stored reviews were resolved at ingest and their source ref is not recoverable
-- from anything this database holds; `null` here means "this row predates the column", which is the true
-- statement, and it is never read as "the channel named nothing".
alter table reviews add column source_product_ref varchar(64);
alter table reviews add column source_product_name varchar(255);

create index idx_reviews_source_product_ref
    on reviews (channel_id, source_product_ref)
    where source_product_ref is not null;
