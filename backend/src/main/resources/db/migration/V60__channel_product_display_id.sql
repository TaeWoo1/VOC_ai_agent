-- Coupang names one product three ways, and until now we kept two of them.
--
--   등록상품ID  sellerProductId  → channel_products.external_product_id (and products.sku)
--   옵션ID      vendorItemId     → product_variants.external_variant_id
--   노출상품ID  productId        → nowhere
--
-- The third is the one the buyer-facing surfaces speak. The WING 상품평 screen prints it in the
-- `노출상품ID (옵션ID)` column, so every acquired review names its product with an identifier this
-- database could not match — and the review path, keying on SKU, would have built a second product
-- beside the one the catalogue already holds. Up to 68 of them for the org that motivated this.
--
-- It is not a value we lacked. The 2026-08-23 wire observation found `productId` present on 68 of 68
-- seller-product details (`docs/demo_org_and_channel_knowledge_v1.md` §5h). We read past it.
--
-- ADDITIVE and nullable, and it does not touch identity. `external_product_id` remains the listing
-- key and `products.sku` remains the catalogue SKU; this column is a second, channel-published ALIAS
-- for the same listing — the id a channel shows buyers when it publishes one separate from the
-- catalogue id. NAVER has the same shape (원상품 vs 채널상품), which is why the column is named for
-- the concept and not for Coupang.
--
-- NULL means the channel publishes no such id, or we have not read one yet. It is never defaulted
-- from external_product_id: they are different identifiers, and equating them is precisely the
-- confusion this column exists to end.
alter table channel_products add column if not exists external_display_product_id varchar(120);

comment on column channel_products.external_display_product_id is
    'The channel-published DISPLAY id for this listing (Coupang 노출상품ID / productId), when the channel publishes one separate from external_product_id. NULL = none known. Never derived from external_product_id.';

-- Not unique: uniqueness of a display id is the channel's claim, not ours, and a non-unique index is
-- what the lookup needs. Partial, because the column is null for every channel that publishes no
-- display id and an index over those rows would be dead weight.
create index if not exists idx_channel_products_display
    on channel_products (org_id, channel_id, external_display_product_id)
 where external_display_product_id is not null;
