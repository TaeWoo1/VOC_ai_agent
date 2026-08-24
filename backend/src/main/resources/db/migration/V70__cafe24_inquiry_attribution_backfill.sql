-- Inquiry Product Attribution v1 — undo the invented products for Cafe24 inquiries.
--
-- WHAT WAS WRONG. Cafe24 board-6 inquiries used to resolve their product with
-- resolve-or-create keyed on products.sku, passing the mall's product_no as that sku. But
-- product_no is a LISTING key and products.sku is the seller's own code, so the two agreed only
-- for listings whose seller set no custom_product_code. When they disagreed, ingest created a
-- product named after the number. Every such number in the canonical Demo Org (91, 94, 170) is
-- present in channel_products as a real, linked listing: the exact attribution was available and
-- a fabrication was stored instead. Rows with no product_no at all were pointed at one shared
-- "(미지정 상품)" bucket, which reads as attributed everywhere while naming nothing.
--
-- WHAT THIS DOES, in the priority the package fixed:
--   1. exact match on (channel_id, external_product_id) — the listing the mall itself named;
--   2. otherwise unattributed (product_id = null) — the true statement.
-- No name matching. No fuzzy matching. No product is created, renamed, merged or deleted here.
-- Scope is CAFE24 + REAL only; DEMO_SEED and VERIFY_FIXTURE rows are not touched, so no synthetic
-- row can be laundered into a real attribution.

-- 1) Recover the identifier the old path spent and discarded. It survives in exactly one place:
--    the sku of the product it caused to be invented. A numeric-named, numeric-sku product with no
--    listing of its own is that fabrication and nothing else.
update inquiries i
set source_product_ref = p.sku
from products p, channels c
where i.product_id = p.id
  and c.id = i.channel_id
  and c.code = 'CAFE24'
  and i.data_origin = 'REAL'
  and i.source_product_ref is null
  and p.sku ~ '^[0-9]+$'
  and p.name = p.sku;

-- 2) Attribute by exact listing key, org-scoped. A listing that belongs to another org can never
--    name this org's product even though the (channel, external id) key is globally unique.
update inquiries i
set product_id = cp.product_id
from channel_products cp, channels c
where c.id = i.channel_id
  and c.code = 'CAFE24'
  and i.data_origin = 'REAL'
  and i.source_product_ref is not null
  and cp.channel_id = i.channel_id
  and cp.external_product_id = i.source_product_ref
  and (cp.org_id is null or cp.org_id = i.org_id)
  and cp.product_id is not null;

-- 3) Everything still pointing at an invented row becomes unattributed. Two shapes qualify: the
--    shared nameless bucket, and a numeric-named product that no listing points to. A numeric-named
--    product that IS a listing's canonical product is left alone — that one is a real catalogue row
--    whose name happens to be a number, and it is not this migration's business.
update inquiries i
set product_id = null
from products p, channels c
where i.product_id = p.id
  and c.id = i.channel_id
  and c.code = 'CAFE24'
  and i.data_origin = 'REAL'
  and (
        (p.sku is null and p.name = '(미지정 상품)')
     or (p.sku ~ '^[0-9]+$' and p.name = p.sku
         and not exists (select 1 from channel_products cp where cp.product_id = p.id))
  );
