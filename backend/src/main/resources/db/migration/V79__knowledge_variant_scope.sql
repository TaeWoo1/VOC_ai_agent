-- Product Knowledge gains an APPLICABILITY scope: the whole listing, or one 규격.
--
-- Why a column and not a convention. The 2026-08-26 NAVER case ended with a figure written at
-- product level being stated as a fact about a customer whose 규격 nobody knew. SpecApplicability
-- closed the half of that we could close without new data — it can say "this answer moves with the
-- option" — but it had nothing to read that says WHICH option a sentence is about, because no row in
-- this schema could carry that claim. A seller who knows 2호 takes 3~4가닥 and 3호 takes 4~5가닥 had
-- exactly two ways to record it: one document stating both (and then the drafter picks), or two
-- documents whose scope lives in their prose ("[2호] 3~4가닥") to be recovered later by pattern
-- matching. The second is the worse one: a meaning encoded in text and decoded by regex is a schema
-- with no migration and no constraint.
--
-- Null is not "unknown". Null is 전체 상품 공통 — the scope every existing row already has, which is
-- why the backfill is the absence of one. Two scopes exist and no third is representable: this is a
-- binding to a variant the channel itself stated, not a free-text label, so the FK is the fence that
-- makes 「임의로 만든 규격 이름」 impossible rather than discouraged.
alter table product_knowledge_sources
    add column variant_id uuid references product_variants (id);

-- Retrieval reads by (org, product) and then splits on this column, so it rides the same lookup.
create index idx_pk_sources_variant on product_knowledge_sources (org_id, product_id, variant_id);
