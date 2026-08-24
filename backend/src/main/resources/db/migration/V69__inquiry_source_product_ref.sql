-- Inquiry Product Attribution v1 — keep the channel's own product identifier.
--
-- Attribution can fail for a reason that is not the inquiry's fault: the listing has not been
-- collected yet, or the catalogue read lacked scope. Until now that identifier was consumed by
-- resolve-or-create and then gone, so the row could never be re-attributed without re-reading the
-- marketplace. Storing what the channel said costs one nullable column and makes the repair local.
--
-- This is the SOURCE's key (Cafe24 product_no, NAVER productNo/productId), never a canonical id.
alter table inquiries add column if not exists source_product_ref varchar(64);

comment on column inquiries.source_product_ref is
    '채널이 준 상품 식별자 원문 (Cafe24 product_no · NAVER productNo). canonical product id가 아니다. '
    'null은 "이 source가 이 행에 식별자를 주지 않았다"는 뜻이며, 귀속 실패와는 다른 사실이다.';

create index if not exists idx_inquiries_source_product_ref
    on inquiries (channel_id, source_product_ref)
    where source_product_ref is not null;
