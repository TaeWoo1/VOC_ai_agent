-- "When we read it" and "when the channel says it changed" were one column, and freshness was
-- computed from it.
--
-- The 2026-08-22 Cafe24 catalogue read is the proof: 144 listings read successfully in two seconds,
-- stamped observed_at as far back as 2014-09-17, and every coverage verdict came back STALE. Nothing
-- was stale — the catalogue had just been read. The age of a PRODUCT had been confused with the
-- freshness of a READ.
--
-- Worse, the three connectors disagreed about which fact the single column held: Cafe24 wrote
-- updated_date, NAVER wrote modifiedDate (falling back to regDate, then to now), and Coupang wrote the
-- read instant. So the same column meant different things per channel and no reader could tell.
--
-- Additive and nullable. NULL means the channel states no last-changed time — Coupang's seller-products
-- resource genuinely does not — and it is never defaulted to the read instant, which would assert that
-- a product changed at the moment we happened to look at it.
alter table channel_products  add column if not exists source_updated_at timestamptz;
alter table product_variants  add column if not exists source_updated_at timestamptz;
alter table product_facts     add column if not exists source_updated_at timestamptz;

comment on column channel_products.source_updated_at is
    'When the CHANNEL says this listing last changed. NULL = the channel states none. Freshness uses observed_at.';
comment on column product_variants.source_updated_at is
    'When the CHANNEL says this variant last changed. NULL = the channel states none.';
comment on column product_facts.source_updated_at is
    'When the CHANNEL says the row behind this fact last changed. NULL = the channel states none.';

-- ---------------------------------------------------------------------------------------------
-- Evidence-based repair of the rows written before the split — and ONLY those it can be proven for.
--
-- The Cafe24 catalogue read of 2026-08-22 created every one of its rows in a single 2.1s run, so for a
-- row that has never been rewritten since (updated_at = created_at) the row's own created_at IS the
-- moment we observed it. That is a record, not an inference.
--
-- The old observed_at value is not discarded: it was the mall's updated_date, which is exactly what
-- source_updated_at is for, so it moves there.
--
-- Deliberately narrow. Rows from any other source, or rewritten since, are left alone: their true
-- observation time is not recorded anywhere, and inventing one would be the same mistake in a new
-- column.
-- ---------------------------------------------------------------------------------------------
update channel_products
   set source_updated_at = observed_at,
       observed_at   = created_at,
       first_seen_at = created_at,
       last_seen_at  = created_at
 where source_kind = 'CAFE24:PRODUCT_API:v2'
   and source_updated_at is null
   and updated_at = created_at;

update product_facts
   set source_updated_at = observed_at,
       observed_at = created_at
 where source = 'CAFE24:PRODUCT_API:v2'
   and source_updated_at is null
   and updated_at = created_at;
