-- V58's repair predicate was `updated_at = created_at`, meant as "this row has not been re-observed
-- since it was written". Two Cafe24 fact rows failed it and were left with the conflated timestamp —
-- not because they had been re-observed, but because the fact upsert writes and then updates within
-- the same run, so the two differ by microseconds.
--
-- The intent was a tolerance, not an equality. A row re-observed later differs by a collection
-- interval — an hour at the current cadence — never by microseconds. One minute is far outside any
-- single run's write-then-update and far inside any gap between runs.
--
-- Same evidence and same narrowness as V58: the row's own created_at is when the run that wrote it
-- observed it, and rows from any other source, or genuinely re-observed since, are left alone.
update product_facts
   set source_updated_at = observed_at,
       observed_at = created_at
 where source = 'CAFE24:PRODUCT_API:v2'
   and source_updated_at is null
   and updated_at - created_at < interval '1 minute';

update channel_products
   set source_updated_at = observed_at,
       observed_at   = created_at,
       first_seen_at = created_at,
       last_seen_at  = created_at
 where source_kind = 'CAFE24:PRODUCT_API:v2'
   and source_updated_at is null
   and updated_at - created_at < interval '1 minute';
