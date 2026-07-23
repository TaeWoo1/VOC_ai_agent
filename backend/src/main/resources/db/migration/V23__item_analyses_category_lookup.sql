-- Classification-aware review queue: the attention drill-down now facets and counts by
-- item_analyses.category over a window of reviews. The existing indexes do not serve that
-- shape: uq_item_analyses_source is keyed by source_id (right for the per-page IN lookup,
-- useless for a category predicate) and ix_item_analyses_org is too broad to help a
-- group-by that also filters on source_type.
--
-- Additive and IF NOT EXISTS, matching V5's own posture. Not CONCURRENTLY: consistent with
-- V22 and every other index migration here, and the table is small — a re-evaluation of
-- that policy belongs with the other recorded follow-ups, not inside this slice.
create index if not exists ix_item_analyses_category
    on item_analyses (org_id, source_type, category);
