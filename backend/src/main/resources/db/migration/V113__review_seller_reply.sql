-- Customer Ops Demo Closure v1 — the seller's own published reply to a review, on the canonical review row.
--
-- NAVER's export states only whether a reply exists (답글여부) and when (답글등록일시); the reply text is read from the
-- Seller Center review detail by a bounded READ enrichment. It lands here, beside the review it answers — not in a
-- second history store — and the Knowledge Spine reads it as a past seller answer with this provenance.
alter table reviews add column if not exists seller_reply_body text;
alter table reviews add column if not exists seller_reply_at timestamptz;
alter table reviews add column if not exists seller_reply_observed_at timestamptz;
alter table reviews add column if not exists seller_reply_source varchar(60);

alter table reviews drop constraint if exists ck_reviews_seller_reply_shape;
alter table reviews add constraint ck_reviews_seller_reply_shape
    check ((seller_reply_body is null and seller_reply_source is null and seller_reply_observed_at is null)
        or (seller_reply_body is not null and seller_reply_source is not null and seller_reply_observed_at is not null));
